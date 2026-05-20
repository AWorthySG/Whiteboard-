# A Worthy Whiteboard — Claude project notes

Live tutoring app for a solo tutor (Jeremy Lim). One host (the teacher) runs a
room; students join via invite link, are held in a waiting room, and the host
admits them. The room contains a real-time whiteboard, audio/video, document
upload, homework, chat, and recording.

**Production URL**: <https://whiteboard.a-worthy.com>

## Stack & topology

| Layer | Service | Purpose |
| --- | --- | --- |
| Web app | **Vercel** (Next.js 15 app router, React 19) | Landing, room shell, API routes |
| Whiteboard sync | **Cloudflare Worker + Durable Objects** (`sync-worker/`) | One DO per room; snapshots persist in DO SQLite (chunked at 96 KiB to fit the 128 KiB cap). Worker deploys via GitHub Actions on push to `sync-worker/**`. |
| Realtime DB / storage / auth | **Supabase** (project `ipctffwruitjeirdgyhy`, region `ap-southeast-1`) | Postgres + Realtime + Storage + Auth |
| Video / audio | **LiveKit Cloud** (`live-whiteboard-a-worthy-3vxt4yg7.livekit.cloud`) | WebRTC SFU, screen share, data channel |
| Domain | `whiteboard.a-worthy.com` via Cloudflare DNS → Vercel | CNAME on Cloudflare with proxy **off** (grey cloud) |

All four services are auto-deployed:
- Push to `main` on the GitHub repo → Vercel auto-builds (~30-60s) and replaces production
- Push touching `sync-worker/**` → GitHub Actions runs `wrangler deploy` (needs `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` repo secrets)
- Supabase + LiveKit are managed services, no deploy

## Env vars (all in Vercel + `.env.example`)

```
NEXT_PUBLIC_SUPABASE_URL=https://ipctffwruitjeirdgyhy.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_TjAAsr0aepCPESt92FUAeA_pcSwS07s
NEXT_PUBLIC_LIVEKIT_URL=wss://live-whiteboard-a-worthy-3vxt4yg7.livekit.cloud
LIVEKIT_API_KEY=<secret>
LIVEKIT_API_SECRET=<secret>
NEXT_PUBLIC_TLDRAW_SYNC_URL=wss://whiteboard-sync.jeremylimguanfong.workers.dev
NEXT_PUBLIC_TLDRAW_LICENSE_KEY=<commercial license, removes the "Made with tldraw" watermark>
```

The Supabase **anon** key is what the client uses. Uploads bypass `service_role`
entirely — they go through `/api/uploads` with the anon key + an RLS insert
policy on the `whiteboard-assets` bucket. The `service_role` key is **not**
needed anywhere in this codebase.

## Routes

| Path | Purpose |
| --- | --- |
| `/` | Landing — sign-in chip, name/room form, recent rooms list |
| `/r/[roomId]` | Room shell — canvas, video panel, all the drawers |
| `/auth/callback` | Supabase magic-link return URL (wrapped in `<Suspense>`) |
| `/api/livekit/token` | Mints LiveKit room JWT. Identity = `u-<userId>` for stable cross-tab dedup |
| `/api/uploads` | POST FormData → Supabase Storage `whiteboard-assets` bucket + insert into `room_documents` |
| `/api/math` | POST `{ latex, displayMode }` → server-side KaTeX → SVG data URL (KaTeX never enters the client bundle) |

## Database schema (Supabase Postgres)

Run `supabase/setup.sql` on a fresh project to bootstrap. Tables:

| Table | Purpose |
| --- | --- |
| `rooms` | Hosted-room ownership. `host_user_id` → `auth.users`. RLS lets the owner upsert their own row; everyone can read. |
| `room_metadata` | Per-room title + `leader_mode` + `leader_user_id`. Realtime broadcast for live updates. |
| `room_documents` | Every file uploaded into a room |
| `room_homework` | Homework assignments |
| `homework_submissions` | Student work attached to a homework item |
| `room_messages` | Compact chat messages |
| `room_recordings` | Cloud-uploaded recording metadata (file lives in `whiteboard-recordings` bucket) |
| `join_requests` | Knock/admission state per (room, user) |

All app tables are added to the `supabase_realtime` publication so the React
hooks just subscribe and re-fetch on change. RLS is **permissive** on the
non-rooms tables (anyone can read/write) because the app doesn't have proper
auth boundaries for student data — host-only actions are enforced client-side.
The `rooms` table is the exception: ownership writes require the matching
authenticated user.

Two Supabase Storage buckets:
- `whiteboard-assets` — public read, anon insert (uploaded docs/images)
- `whiteboard-recordings` — public read, anon insert, 5 GB per-file cap (lesson recordings)

## Host detection (two-tier)

A user is host of a room if either:
1. **Signed in** and their Supabase user id matches `rooms.host_user_id`, OR
2. The room id is in `localStorage.wb_hosted_rooms` (legacy / pre-auth fallback)

`useIsHost(roomId)` returns true if either is true. `markAsHost(roomId, user?, name?)`
always writes to localStorage and additionally upserts the `rooms` row when a user
is provided. A "Claim this room for my account" button in **Settings → Account**
promotes a legacy localStorage room into a proper `rooms` row.

## Key components (`src/components/`)

```
RoomShell.tsx          Top-level room layout — header, canvas wrapper, side video panel (or
                       mobile bottom sheet), drawers, modals, chat bubble.

WhiteboardCanvas.tsx   Hosts the <Tldraw> instance. Wires assetStore → /api/uploads,
                       drop handler for PDFs (pdfjs-dist), exportRef for PNG export,
                       custom CanvasTopRightActions (Upload/Pointer/Equation/Lead view
                       /color picker), CanvasWatermark background, SlimToolbar (replaces
                       tldraw's default 20-shape grid with just select/draw/highlight
                       /eraser/note/asset), and leader-mode follow logic via
                       editor.startFollowingUser.

VideoPanel.tsx         LiveKit room — token fetch, Tiles grid, CameraReleaseGuard (calls
                       track.stop() on disable so the macOS green light turns off),
                       RoomCoordinator (raise hand / mute-all via data channel),
                       ControlBar with leave enabled.

PagesTabBar.tsx        Bottom-center pill listing tldraw pages — switch / rename / delete
                       / + menu with lesson templates (blank, grid, dotted, lined,
                       coordinate plane, music staves). Templates are SVG generated
                       client-side and stored as locked image shapes.

KnockGate.tsx          Wraps the room for non-hosts; renders the "waiting to be admitted"
                       screen until their join_requests row flips to admitted.

AdmissionPanel.tsx     Host-only floating panel showing pending join_requests.

Toast.tsx              Stacked toast notifications (ToastProvider in root layout).

ChatBubble.tsx         Floating chat button + 320×440 popover. Persists to room_messages.

EquationModal.tsx      LaTeX input + live debounced preview. POSTs /api/math and inserts
                       the returned SVG data URL as an image asset.

InvitePanel.tsx        QR code (lazy-loaded qrcode-svg) + copy link + native Web Share.

Documents/Homework
/Recordings Drawer     Right-side drawers backed by their respective Supabase tables.

ColorPickerRow.tsx     Compact 8-color row that replaces tldraw's full StylePanel.

SettingsModal.tsx      Profile, account (sign in / claim room / sign out), appearance
                       (theme), whiteboard (pen-only/palm-rejection), documents, call
                       defaults, room (invite link, leave room).

PresenceBadge.tsx      Header live-participant count via Supabase Realtime presence.

ReconnectBanner.tsx    Floating banner when tldraw sync is loading/offline/errored.

OnboardingHint.tsx     One-time tutorial modal (settings.hasSeenOnboarding flag).

BrandLogo.tsx          next/image wrapper for /icon.png.

ThemeApplier.tsx       Toggles html.theme-light based on useSettings().theme.

PwaRegister.tsx        Registers /sw.js client-side.

RecordButton.tsx       getDisplayMedia + getUserMedia + MediaRecorder; saves local
                       MP4/WebM AND uploads to Supabase Storage with progress.

VideoPanelResizer.tsx  Drag handle on the desktop video panel's left edge. Width persists
                       in localStorage.
```

## Hooks (`src/hooks/`)

- `useSettings()` — localStorage-backed app preferences (theme, PDF layout, pen-only, defaults, hasSeenOnboarding)
- `useAuth()` — Supabase user + `signOut()`
- `useIsHost(roomId)` — combined server + localStorage host check
- `useRoomMeta(roomId)` — room title + leader-mode state, with `setTitle` / `setLeaderMode`
- `useRecentRooms()` + `trackRoomVisit()` — localStorage list shown on home page

## Theming

CSS variables in `globals.css`:

```css
:root {
  --bg / --bg-elev / --bg-elev-2  /* surfaces */
  --text / --text-muted / --text-dim  /* text tiers */
  --border / --border-subtle  /* line tiers */
  --hover  /* subtle hover overlay */
}
html.theme-light { /* same vars, light values */ }
```

`ThemeApplier` flips `html.theme-light` based on settings. tldraw's own colors
follow via `editor.user.updateUserPreferences({ colorScheme })`.

**Convention**: never hardcode `bg-[#11141b]`, `text-white/70`, `border-white/10`,
etc. Use `bg-[var(--bg-elev)]`, `text-[var(--text-muted)]`, `border-[color:var(--border)]`.
A previous sweep (commit `d4e5c7d`) replaced 158 instances. If you add a new
component, follow the same pattern or light mode will be unreadable.

## Operational gotchas

- **GitHub Actions for the Worker**: the workflow is at `.github/workflows/deploy-worker.yml`. It needs `CLOUDFLARE_API_TOKEN` (a user-scoped token, prefix `cfut_`, not the account-scoped `cfat_` flavor — the latter fails `/user/tokens/verify`) and `CLOUDFLARE_ACCOUNT_ID`.
- **R2 is NOT used.** Snapshots live in the Durable Object's own SQLite via chunked storage. R2 was tried and abandoned (requires the user to add a card on file to enable it).
- **tldraw watermark removal** requires the license key in `NEXT_PUBLIC_TLDRAW_LICENSE_KEY`. The key is necessarily exposed in the client bundle — keep it out of git history (env var only) so a public fork doesn't accidentally reuse it.
- **LiveKit identity must be stable**. The token endpoint uses `u-<userId>` so opening the room in a second tab on the same browser kicks the first tab instead of creating a ghost participant.
- **Camera release**: LiveKit by default just mutes when you disable camera/mic. `CameraReleaseGuard` explicitly calls `track.stop()` 150 ms after disable so the OS hardware indicator goes off. Mic uses `publishDefaults.stopMicTrackOnMute: true`.
- **Pen mode / palm rejection**: tldraw auto-enables `isPenMode` on first pointerType==='pen' event. We also expose an explicit `penOnly` setting that forces it on at mount.
- **Magic-link redirect**: Supabase project's Authentication → URL Configuration must list `https://whiteboard.a-worthy.com/auth/callback` (and any Vercel preview hosts).
- **Free tiers**: Supabase Storage 1 GB, Supabase Auth ~4 emails/hour, LiveKit 10k participant-min/month. Watch the Recordings drawer for big files eating Supabase Storage.

## Common commands

```bash
npm run dev          # Next.js on :3000
npm run dev:sync     # wrangler dev for the sync worker
npm run dev:all      # both concurrently
npm run typecheck    # tsc --noEmit (run before committing)
npm run build        # production build + size report
```

The bundle is currently ~178 KB First Load JS for the room route. Anything that
adds significantly to that should be lazy-loaded via `dynamic(() => import(...))`.

## Watch-outs for future changes

1. **Don't reintroduce hardcoded `white/x` Tailwind classes.** Theme sweep is enforced
   by the CSS-variable convention; one stray class breaks light mode contrast.
2. **Don't add LiveKit tokens to client-side env.** Token minting must stay server-side.
3. **Bundle budget**: keep heavy libraries (KaTeX, pdfjs, exportToBlob) lazy-loaded.
   Server-side render where possible (KaTeX already is).
4. **Schema migrations**: use the Supabase MCP's `apply_migration` tool; don't write to
   `supabase/migrations` directly.
5. **GitHub repo is public**. Treat anything committed as world-readable. License key,
   tokens, and secrets go in Vercel env vars only.
