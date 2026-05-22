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
WORKER_SHARED_SECRET=<random 256-bit secret shared with the worker>
```

`WORKER_SHARED_SECRET` lives in two places: Vercel (for `/api/sync-token`
to sign HS256 tokens) and the Cloudflare Worker secret store (for the
worker to verify them). Set it on the worker with `npx wrangler secret
put WORKER_SHARED_SECRET` from inside `sync-worker/`. Tokens are
15-minute TTL and auto-refreshed by `useSyncToken` on the client.

The Supabase **anon** key is what the client uses for everything: auth
sign-in/sign-up, file uploads (browser POSTs directly to the Storage REST
endpoint, no Vercel hop), and DB inserts. The `service_role` key is **not**
needed anywhere in this codebase.

## Routes

| Path | Purpose |
| --- | --- |
| `/` | Landing — sign-in chip, name/room form, recent rooms list |
| `/r/[roomId]` | Room shell — canvas, video panel, all the drawers |
| `/auth/callback` | Legacy Supabase auth return URL. Currently unused (username/password sign-in doesn't redirect) but kept as a no-op stub in case OAuth or password reset gets added later. |
| `/api/livekit/token` | Mints LiveKit room JWT. Identity = `u-<userId>` for stable cross-tab dedup |
| `/api/uploads` | **No longer in the hot path.** All upload paths (canvas, Documents drawer, Homework submissions) POST directly to Supabase Storage from the browser using the anon key, saving a Vercel function hop. The route file still exists as a fallback / for future server-side upload needs but isn't called by any current client code. |
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

## Auth (username + password)

Sign-in uses Supabase Auth's email+password provider, but the UI presents
a **Username** field instead. The username is mapped to a synthetic email
of the form `<username>@a-worthy.local` before being sent to Supabase, so:

- Users pick and remember a plain username — never see an email field.
- Supabase still hashes/salts the password properly (Argon2 / bcrypt).
- The `@a-worthy.local` domain is a placeholder — it doesn't need to resolve.
  **Do not change the domain after accounts exist**, or every existing password
  will appear to "stop working" (the mapped email won't match).
- `displayUsername(user)` strips the suffix for display everywhere
  (home page chip, settings, `rooms.host_name`).
- For password sign-up to work, Supabase Auth's **"Confirm email"** must be
  toggled OFF (Authentication → Providers → Email → Confirm email → OFF).
  We can't deliver confirmation links to `@a-worthy.local`.

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
                       The room header has a host-only "+ New page" pill in the top-left
                       plus a "Pages (n) ▾" dropdown that lists every page in the room
                       (click to switch). Both call into WhiteboardCanvas via
                       addPageRef / switchPageRef, mirroring the exportRef pattern.
                       The page list itself is mirrored up via the onPagesChange callback
                       (subscribed to editor.store) so the dropdown stays live across
                       renames + remote edits.

WhiteboardCanvas.tsx   Hosts the <Tldraw> instance. Uploads go BROWSER → SUPABASE STORAGE
                       directly (uploadAsset() POSTs to /storage/v1/object/whiteboard-assets/
                       with the anon key; room_documents row is inserted client-side after).
                       Sets default stroke size to "s" on mount so Apple Pencil pressure
                       reads as pen-on-paper, not marker. Clears keyboard shortcuts for
                       geometric shape tools (arrow/line/geo/text/frame) so R/O/A/L/T
                       can't accidentally switch tools mid-lesson. Exposes exportRef and
                       addPageRef MutableRefObjects to the parent shell.

VideoPanel.tsx         LiveKit room — token fetch, Tiles grid, CameraReleaseGuard (calls
                       track.stop() on disable so the macOS green light turns off),
                       RoomCoordinator (raise hand / mute-all via data channel),
                       ControlBar with leave enabled.

PagesTabBar.tsx        Bottom-center pill listing tldraw pages — switch / rename / delete.
                       Primary action is a labeled "+ New page" button (one-click blank
                       page); a small ▾ caret next to it opens the template picker for
                       grid / dotted / lined / coords / music staves. Templates are SVG
                       generated client-side and stored as locked image shapes.

KnockGate.tsx          Wraps the room for non-hosts; renders the "waiting to be admitted"
                       screen until their join_requests row flips to admitted.

GuestNameEntry         Inline in RoomShell.tsx. Shown to guests who land on a room
                       link without a name (no ?name= URL param, no
                       wb_user_name in localStorage). One field, no sign-up. Once
                       submitted, the name is saved to localStorage and KnockGate
                       takes over. A nameBootstrapped flag prevents a one-frame
                       flash for guests whose name is already remembered.

AdmissionPanel.tsx     Host-only floating panel showing pending join_requests with
                       Admit / Deny buttons. Also fires a toast ("X is asking to
                       join") the first time it sees each new pending request so
                       the host can't miss it.

ZoomControls.tsx       Bottom-right pill: zoom out / current % (clickable for preset
                       menu) / zoom in. Preset menu has Fit to content, Reset to
                       100%, and 50/75/100/150/200%. Subscribes to editor.store
                       session scope so the % stays live. Works on phone, tablet,
                       and desktop (touch targets sized for thumb taps).

CaptionsManager.tsx    Lives inside the LiveKitRoom context. Runs the browser-native
                       SpeechRecognition API (webkitSpeechRecognition) on the local
                       mic when captions are enabled + the mic is on. Each finalised
                       or interim utterance is broadcast over the LiveKit data
                       channel as {type: "caption", text, isFinal, name}. Also
                       listens for incoming caption messages from peers and calls
                       onCaption to push them up to RoomShell.

CaptionsOverlay.tsx    Bottom-center floating panel that renders the last ~3 caption
                       lines with the speaker's name. Final lines render solid;
                       interim lines render italic + lighter. Lines fade after 8s
                       and disappear after 10s. On Safari/Firefox it shows a single
                       'your browser can't transcribe locally' notice when the user
                       turns captions on themselves.

Toast.tsx              Stacked toast notifications (ToastProvider in root layout). Solid
                       red / green variants have explicit text-white (the bg is saturated
                       so var(--text) reads as dark-on-dark in light mode).

ChatBubble.tsx         Floating chat button + 320×440 popover. Persists to room_messages.

EquationModal.tsx      LaTeX input + live debounced preview. POSTs /api/math and inserts
                       the returned SVG data URL as an image asset.

InvitePanel.tsx        QR code (lazy-loaded qrcode-svg) + copy link + native Web Share.

DocumentsDrawer.tsx    Right-side drawer listing uploaded files. Has its own "Upload"
                       button in the header AND a big "Upload a document" CTA in the
                       empty state. Uploads go browser → Supabase Storage directly,
                       then a client-side insert into room_documents.

HomeworkDrawer.tsx
RecordingsDrawer.tsx   Right-side drawers backed by their respective Supabase tables.

SignInModal.tsx        Username + Password form with Sign in / Create account toggle.
                       Username is mapped to <username>@a-worthy.local before hitting
                       Supabase Auth (see "Auth" section above).

ColorPickerRow.tsx     Compact 8-color row that replaces tldraw's full StylePanel.

SettingsModal.tsx      Profile, account (sign in / claim room / sign out), appearance
                       (theme), whiteboard (pen-only/palm-rejection), documents, call
                       defaults, room (invite link, leave room).

PresenceBadge.tsx      Header live-participant count via Supabase Realtime presence.

ReconnectBanner.tsx    Floating banner when tldraw sync is loading/offline/errored.

OnboardingHint.tsx     One-time tutorial modal (settings.hasSeenOnboarding flag).

BrandLogo.tsx          next/image wrapper for /icon.png.

ThemeApplier.tsx       Toggles html.theme-light based on useSettings().theme. Default
                       theme is "light" — dark mode still exists but isn't the default,
                       and active UI tuning targets light contrast.

PwaRegister.tsx        Registers /sw.js client-side.

RecordButton.tsx       getDisplayMedia + getUserMedia + MediaRecorder; saves local
                       MP4/WebM AND uploads to Supabase Storage with progress.

VideoPanelResizer.tsx  Drag handle on the desktop video panel's left edge. Width persists
                       in localStorage.
```

## Hooks (`src/hooks/`)

- `useSettings()` — localStorage-backed app preferences (theme, PDF layout, pen-only, defaults, hasSeenOnboarding). Default theme is "light".
- `useAuth()` — Supabase user + `signOut()` + `displayUsername(user)` helper that strips the `@a-worthy.local` suffix for display.
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

`ThemeApplier` flips `html.theme-light` based on settings. Default theme
is `"light"` (set in `useSettings.ts`). tldraw's own colors follow via
`editor.user.updateUserPreferences({ colorScheme: "light" })` in `WhiteboardCanvas.onMount`.

**Convention**: never hardcode `bg-[#11141b]`, `text-white/70`, `border-white/10`,
etc. Use `bg-[var(--bg-elev)]`, `text-[var(--text-muted)]`, `border-[color:var(--border)]`.

**Brand-button rule**: any `bg-brand-600` button MUST also set `text-white`
explicitly. The brand fill is dark saturated indigo, so inheriting `text-[var(--text)]`
in light mode gives dark-on-dark. The full contrast sweep covering this lives in
commit `45a340e` (15+ classes swept).

## Operational gotchas

- **GitHub Actions for the Worker**: the workflow is at `.github/workflows/deploy-worker.yml`. It needs `CLOUDFLARE_API_TOKEN` (a user-scoped token, prefix `cfut_`, not the account-scoped `cfat_` flavor — the latter fails `/user/tokens/verify`) and `CLOUDFLARE_ACCOUNT_ID`.
- **R2 is NOT used.** Snapshots live in the Durable Object's own SQLite via chunked storage. R2 was tried and abandoned (requires the user to add a card on file to enable it).
- **tldraw watermark removal** requires the license key in `NEXT_PUBLIC_TLDRAW_LICENSE_KEY`. The key is necessarily exposed in the client bundle — keep it out of git history (env var only) so a public fork doesn't accidentally reuse it.
- **LiveKit identity must be stable**. The token endpoint uses `u-<userId>` so opening the room in a second tab on the same browser kicks the first tab instead of creating a ghost participant.
- **Camera release**: LiveKit by default just mutes when you disable camera/mic. `CameraReleaseGuard` explicitly calls `track.stop()` 150 ms after disable so the OS hardware indicator goes off. Mic uses `publishDefaults.stopMicTrackOnMute: true`.
- **Pen mode / palm rejection**: tldraw auto-enables `isPenMode` on first pointerType==='pen' event. We also expose an explicit `penOnly` setting that forces it on at mount.
- **Stroke thickness**: default size is `"s"` (small) — set via `editor.setStyleForNextShapes(DefaultSizeStyle, "s")` in `WhiteboardCanvas.onMount`. tldraw's `"m"` was too thick under Apple Pencil pressure. Users can still pick any size from the size picker.
- **Pen feel tuning**: three layers, all targeting Apple Pencil latency + fountain-pen aesthetic.
  1. `editor.user.updateUserPreferences({ animationSpeed: 0 })` in `WhiteboardCanvas.onMount` (and the theme-applying useEffect) skips tldraw's default 1-frame ease on stroke commit. Strokes snap into place instead of fading in.
  2. `patches/tldraw+<version>.patch` rewrites `getFreehandOptions` constants for both `realPressureSettings` (stylus path, `isPen=true`) and `simulatePressureSettings` (finger/mouse fallback). Targets: `thinning` ~0.8 (strong pressure contrast), `streamline` ~0.4 (less smoothing, more direct), `smoothing` ~0.55, plus `start/end.taper` 25–30 for calligraphic tapered ends. Applied via `patch-package` on every `npm install` (postinstall hook). When tldraw upgrades: `rm -rf node_modules/tldraw && npm install` — if patch-package warns, edit the new version's `getPath.js` in `dist-cjs` + `dist-esm`, then `npx patch-package tldraw` to regenerate.
  3. Per-stroke local rendering is unconditionally optimistic — tldraw renders the line as you draw before sync ack. Network RTT does not gate the visible stroke.
- **Non-host default tool is hand**: in `WhiteboardCanvas.onMount` we call `editor.setCurrentTool("hand")` when `!isHost`. With `touch-action: none` on the canvas, a single-finger swipe goes to tldraw's gesture pipeline — defaulting students to the hand tool means a swipe pans rather than drawing a stray line. The host stays on `draw`. The student can still switch tools if they want to annotate.
- **Toolbar active state**: globals.css forces a brand-blue background + white icon for the selected tool button (`[aria-pressed="true"]` / `[data-state="selected"]`). tldraw's default light-mode highlight was too subtle.
- **Leader mode UI**: when on, the host sees a yellow "LEADING VIEW" pill top-right of the canvas, AND the eye icon in the toolbar gets a filled amber background with white icon (vs. a thin amber outline before). Guests being followed see the existing "Following host" pill.
- **Geometric shape lockout**: the `tools()` override in `WhiteboardCanvas` clears the keyboard `kbd` field for `arrow`, `line`, `geo`, `text`, and `frame` so they're unreachable. They were already hidden from the SlimToolbar; this also kills the R/O/A/L/T/F shortcuts.
- **Two-finger scroll & touch**: `.tldraw-shell` sets `touch-action: none` + `overscroll-behavior: contain` + `-webkit-user-select: none` + `-webkit-touch-callout: none` + a fallback `touch-action: none` on every nested `.tl-container` / `.tl-canvas` / `canvas` (Firefox sometimes ignores the parent value). `userScalable: false` in the viewport meta lets two-finger gestures reach tldraw's pan/zoom code instead of zooming the whole page.
- **Supabase "Confirm email" must be OFF** for password sign-up to work — we use synthetic `@a-worthy.local` emails that can't receive mail. Set in Supabase Dashboard → Authentication → Providers → Email → Confirm email → toggle OFF.
- **Guests don't sign up**. Anyone with a room link can join: they land on `/r/<roomId>`, see the `GuestNameEntry` form (or skip it if they have a remembered name), then KnockGate creates a `join_requests` row and waits for the host to Admit. The host sees an `AdmissionPanel` floating top-right + a toast for every new knocker.
- **Zoom UI is custom**. tldraw's default `MenuPanel` (which holds its ZoomMenu) is disabled in our `components` override, so we render our own `ZoomControls` bottom-left (was bottom-right; moved so the video panel doesn't cover it).
- **PWA orientation lock**: `public/manifest.webmanifest` sets `"orientation": "portrait"`. This is honoured for installed PWAs on Android Chrome; iOS Safari ignores it for non-installed sessions.
- **PWA icons**: the manifest lists five PNG sizes (152/167/180/192/512) plus a maskable variant and an SVG. iOS doesn't read the manifest list reliably on first install — `src/app/layout.tsx` adds explicit `<link rel="apple-touch-icon" sizes="...">` tags for 152/167/180 so Safari picks the right one. Regenerate the smaller PNGs from `public/icon.svg` whenever the source art changes (sharp can do this in ~10 lines; see commit `7f81a18` for the original pass).
- **PWA install banner**: `PwaInstallBanner.tsx` listens for `beforeinstallprompt` (Android Chrome only — iOS Safari doesn't fire this) and persists dismissal in `wb_pwa_install_dismissed`. iOS users install via Share → Add to Home Screen.
- **Service worker caching strategy**: `public/sw.js` runs two cache buckets. `wb-static-v2` is cache-first for `/_next/static/*` (content-hashed by Next so safe-to-cache-forever) — every PWA cold launch after the first boots from cache, dropping startup ~1s. `wb-shell-v2` is stale-while-revalidate for `manifest.webmanifest` + `icon.svg`. Everything else (HTML routes, API calls, Supabase, LiveKit, sync worker) is network-only — no risk of a stale room shell or stale auth token. If you change the cache schema, bump both bucket names (`-v2` → `-v3`); the `activate` listener sweeps any older bucket.
- **Notch / Dynamic Island**: `viewport: { viewportFit: "cover" }` in `layout.tsx` lets the canvas paint behind the iPhone X+ cutout in landscape PWA mode. Interactive UI stays clear via `safe-area-inset-*` paddings in `globals.css`.
- **No horizontal scroll**: `html, body { overflow-x: hidden; max-width: 100vw; }` in `globals.css` keeps the room shell from sliding sideways even if a child overflows. tldraw's canvas still pans freely because it sets its own touch-action and is inside an `inset-0` container.
- **Header is two rows on md+**: row 1 = Documents / Homework / Recordings / Record; row 2 = Export / Invite / Hide-video / Settings. Mobile collapses both rows into the existing kebab/hamburger menu.
- **`/auth/callback` is a no-op stub** now that magic-link auth is gone. Don't remove it — it's wrapped in `<Suspense>` and harmless if hit, and password reset / OAuth could re-use it later.
- **Free tiers**: Supabase Storage 1 GB, LiveKit 10k participant-min/month. Watch the Recordings drawer for big files eating Supabase Storage.

## Common commands

```bash
npm run dev          # Next.js on :3000
npm run dev:sync     # wrangler dev for the sync worker
npm run dev:all      # both concurrently
npm run typecheck    # tsc --noEmit (run before committing)
npm run build        # production build + size report
npm test             # vitest run (29 tests across 5 files)
npm run test:watch   # vitest watch mode
```

The bundle is currently ~186 KB First Load JS for the room route (200 KB budget).
Anything that adds significantly to that should be lazy-loaded via `dynamic(() => import(...))`.

`postinstall` runs `patch-package`, which reapplies the tldraw fountain-pen patch
in `patches/tldraw+*.patch`. Don't disable this — drawing will revert to tldraw's
default stroke profile if the patch isn't applied.

## Watch-outs for future changes

1. **Don't reintroduce hardcoded `white/x` Tailwind classes.** Theme sweep is enforced
   by the CSS-variable convention; one stray class breaks light mode contrast.
2. **Always pair `bg-brand-600` with `text-white`** — see Theming section. Easy regression.
3. **Don't add LiveKit tokens to client-side env.** Token minting must stay server-side.
4. **Bundle budget**: keep heavy libraries (KaTeX, pdfjs, exportToBlob) lazy-loaded.
   Server-side render where possible (KaTeX already is).
5. **Schema migrations**: write the SQL to `supabase/migrations/<timestamp>_<name>.sql` first,
   then apply via the Supabase MCP `apply_migration` tool with the same name. Update
   `supabase/setup.sql` (the consolidated fresh-project snapshot) in the same commit.
6. **Don't change the `@a-worthy.local` synthetic-email domain** in `SignInModal` —
   it's part of every existing user's stored email, and changing it locks everyone out.
7. **Don't re-enable Supabase "Confirm email"** — accounts can't be confirmed because
   the synthetic domain doesn't receive mail.
8. **Don't re-add the geometric shape tools to the toolbar** without also restoring
   their `kbd` shortcuts in the `tools()` override.
9. **GitHub repo is public**. Treat anything committed as world-readable. License key,
   tokens, and secrets go in Vercel env vars only.
10. **Upload path is now direct browser → Supabase** — if you add a new upload entry
    point, mirror the existing pattern (`uploadAsset()` in WhiteboardCanvas, or the
    inline POSTs in DocumentsDrawer / HomeworkDrawer). Don't reintroduce the
    `/api/uploads` proxy hop. Always pair the storage upload with the DB insert,
    and on DB-insert failure call `supabase.storage.from(bucket).remove([path])`
    so orphans don't accumulate. For uploads sourced from `AttachmentPicker`,
    check `att.freshUploadPath` before removing — picked existing documents are
    referenced by other rows and must not be deleted.
11. **The tldraw patch survives upgrades only if you re-apply it.** When you bump
    tldraw, `npm install` will warn that `patches/tldraw+OLD.patch` no longer applies.
    Open `node_modules/tldraw/dist-{cjs,esm}/lib/shapes/draw/getPath.{js,mjs}` in the
    new version, re-edit `realPressureSettings` and `simulatePressureSettings` with
    the fountain-pen values (`thinning: 0.82/0.7`, `streamline: 0.4/0.5`,
    `smoothing: 0.55`, `start/end: { taper: 30/25, cap: true }`), then run
    `npx patch-package tldraw`. Delete the old patch file and commit the new one.
12. **Service worker is intentionally narrow.** Don't widen `sw.js` to cache HTML
    routes, API responses, Supabase, LiveKit, or the sync worker. Cache only
    `/_next/static/*` (content-hashed, immutable) and the small shell set. A
    cached room shell or a cached auth token is far more confusing to debug than
    a slow first launch.
13. **Worker auth must stay configured.** `WORKER_SHARED_SECRET` lives in two
    places (Vercel env + Cloudflare Worker secret). Both must be set to the same
    value — and the worker fails closed without it (returns 500 on every connect
    attempt). When rotating: update Cloudflare first (`wrangler secret put`),
    then Vercel, then redeploy. Tokens currently in flight will keep working
    until their 15-minute TTL expires.
