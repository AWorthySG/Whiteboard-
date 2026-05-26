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
SUPABASE_SERVICE_ROLE_KEY=<secret — server-side only, never in client bundle>
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
endpoint, no Vercel hop), and DB inserts. The `service_role` key is used
server-side only by `/api/invite/redeem` to bypass the RLS UPDATE policy
on `join_requests` (the anon key can INSERT but not UPDATE existing rows).
**Never expose it to the client bundle.**

## Routes

| Path | Purpose |
| --- | --- |
| `/` | Landing — sign-in chip, name/room form, recent rooms list. `generateRoomId()` makes a neutral 8-char code (e.g. `k3fmqp8r`) — no cutesy `bright-comet-815` adjective-noun names (removed per request), and ambiguous chars (l/1/i, o/0) are omitted so codes read aloud cleanly. |
| `/r/[roomId]` | Room shell — canvas, video panel, all the drawers |
| `/auth/callback` | Legacy Supabase auth return URL. Currently unused (username/password sign-in doesn't redirect) but kept as a no-op stub in case OAuth or password reset gets added later. |
| `/api/livekit/token` | Mints LiveKit room JWT. Identity = `u-<userId>` for stable cross-tab dedup |
| `/api/uploads` | **No longer in the hot path.** All upload paths (canvas, Documents drawer, Homework submissions) POST directly to Supabase Storage from the browser using the anon key, saving a Vercel function hop. The route file still exists as a fallback / for future server-side upload needs but isn't called by any current client code. |

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
                       On md+ the header is a SINGLE row; secondary actions
                       (Export, captions, display name) live behind a "More" (⋯)
                       overflow menu (deskMenuOpen). Inline: Record · Invite ·
                       video toggle · Settings · End lesson.
                       Welcome screen: an entry-choice modal (entryChoiceMade)
                       shows once on room entry — Join with video / Join with
                       audio only / Whiteboard only. callJoined + videoPanelVisible
                       now START FALSE (no auto-join); the modal decides. The chosen
                       mode is held in `joinMode` ("video"|"audio"|null) and passed
                       to VideoPanel as `autoConnect` so it connects directly without
                       prompting again. Whiteboard-only leaves callJoined false.
                       Video/call state is split into two booleans:
                       - `callJoined` — whether VideoPanel is mounted (LiveKit token
                         fetched, connection active).
                       - `videoPanelVisible` — whether the aside/sheet is shown in the
                         layout. When false but callJoined is true, the desktop aside
                         renders with `display:none` so the LiveKit connection stays
                         alive for audio (audio-only mode). The mobile sheet is
                         conditionally rendered only when both are true.
                       Picture-in-picture: `videoPip` floats the desktop aside as a
                       fixed-positioned draggable tile (pipPos) so the canvas reflows
                       full-width while the LiveKit element keeps its React position
                       (connection never torn down). Slimmer default width (300px).
                       The header "Join call / Hide video / Show video" button reflects
                       all three states. `joinCall()` sets both visibility flags to
                       true; `leaveCall()` (passed as VideoPanel's onLeaveCall) sets
                       both to false AND resets joinMode to null.

WhiteboardCanvas.tsx   Hosts the <Tldraw> instance. Uploads go BROWSER → SUPABASE STORAGE
                       directly (uploadAsset() POSTs to /storage/v1/object/whiteboard-assets/
                       with the anon key; room_documents row is inserted client-side after).
                       Sets default stroke size to "s" on mount so Apple Pencil pressure
                       reads as pen-on-paper, not marker. Clears keyboard shortcuts for
                       geometric shape tools (arrow/line/geo/text/frame) so R/O/A/L/T
                       can't accidentally switch tools mid-lesson. Exposes exportRef and
                       addPageRef MutableRefObjects to the parent shell.
                       tldraw `components` override nulls MenuPanel, StylePanel AND
                       NavigationPanel (the native zoom/minimap pill) — our custom
                       ZoomControls is the single zoom UI. The insert-equation
                       feature was removed (no EquationModal, no /api/math).

VideoPanel.tsx         LiveKit room — token fetch, Tiles grid, CameraReleaseGuard (calls
                       track.stop() on disable so the macOS green light turns off),
                       RoomCoordinator (raise hand / mute-all via data channel),
                       ControlBar with leave enabled.
                       Accepts an `onLeaveCall` prop; when the user intentionally
                       leaves via the control bar, the LiveKit disconnect fires
                       onLeaveCall so RoomShell can unmount the panel and show the
                       whiteboard-only state. The `autoConnect` prop ("video" |
                       "audio" | null) is set from RoomShell's welcome-screen choice
                       (joinMode); when present the panel connects directly in that
                       mode and skips its own join prompt (no double-ask). When null
                       (e.g. re-joining via the header), it falls back to the
                       settings-based auto-join. On re-entry after an intentional
                       leave the panel shows "Join the call" with three options:
                       Join with video / Audio only / Whiteboard only — skip the
                       call. `hasJoinedBeforeRef` tracks
                       whether the user has been in the call at all this session,
                       distinguishing first-entry from after-leave so the copy stays
                       accurate. Auto-reconnect on unexpected drops (3-second delay,
                       fires onLeaveCall on the "Stay on whiteboard only" button).

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

ZoomControls.tsx       Bottom-left pill: zoom out / current % (clickable for preset
                       menu) / zoom in. Preset menu has Fit to content, Reset to
                       100%, and 50/75/100/150/200%. Subscribes to editor.store
                       session scope so the % stays live. Works on phone, tablet,
                       and desktop (touch targets sized for thumb taps). This is the
                       ONLY zoom UI — tldraw's native NavigationPanel is nulled in the
                       components override (don't re-add it; you'll get two zoom pills).

CaptionsManager.tsx    Lives inside the LiveKitRoom context. Runs the browser-native
                       SpeechRecognition API (webkitSpeechRecognition) on the local
                       mic when captions are enabled + the mic is on. Each finalised
                       or interim utterance is broadcast over the LiveKit data
                       channel as {type: "caption", text, isFinal, name}. Also
                       listens for incoming caption messages from peers and writes
                       them into the module-level captionsStore (see Captions
                       architecture note below). Auto-restarts every ~60s when
                       Chrome ends the session — 50ms delay closes the gap so
                       long sentences don't lose words. On unsupported browsers
                       (Safari, Firefox, all iOS browsers including iPad Chrome
                       since it's a WKWebView wrapper) it fires a one-time
                       toast.info telling the user to switch to desktop Chrome
                       or Android Chrome to caption their own voice.

CaptionsHost.tsx       Subscribes to the captions store via useSyncExternalStore
                       and renders CaptionsOverlay. RoomShell mounts this once;
                       only this subtree re-renders on a caption tick. Prevents
                       the whole RoomShell tree (header, drawers, ~14 children)
                       from re-rendering 5-10×/sec during active speech, which
                       was the previous bottleneck — both perceived caption lag
                       AND a drag on pen latency while someone was speaking.

CaptionsOverlay.tsx    Bottom-center floating panel that renders the last ~3 caption
                       lines with the speaker's name. Final lines render solid;
                       interim lines render italic + lighter. Lines fade after 8s
                       and disappear after 10s. Shows a quiet-moment notice when
                       the local browser can't transcribe AND no other captions
                       are on screen (the up-front toast in CaptionsManager
                       handles the noisy case).

Toast.tsx              Stacked toast notifications (ToastProvider in root layout). Solid
                       red / green variants have explicit text-white (the bg is saturated
                       so var(--text) reads as dark-on-dark in light mode).

ChatBubble.tsx         Floating chat button + 320×440 popover. Persists to room_messages.

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
                       On desktop (md+) this is hidden in the floating panel — the
                       same colors are available directly in LeftRail (see below).
                       On mobile it stays in the top-right CanvasFloatingPanel.

StrokeSizePicker.tsx   Four stroke-size options (s/m/l/xl) shown as dot swatches.
                       Same desktop/mobile split as ColorPickerRow — hidden at md+
                       in the floating panel, lives in LeftRail on desktop.

LeftRail.tsx           Vertical tool rail on the left edge of the canvas (md+ only).
                       Phase 4 design: contains the full tool set (select / hand /
                       pen / highlighter / eraser / note / upload) plus
                       host-only toggles (hide annotations, lead view) AND the
                       drawing style controls (2×2 size grid, 2×4 color grid) below
                       a divider. This makes it the single unified drawing control
                       strip on desktop. Phones keep the SlimToolbar + floating panel.
                       Tool buttons show keyboard shortcuts in the browser tooltip
                       (Select V, Hand H, Pen D, Highlighter Q, Eraser E, Note N).
                       The size + colour pickers are COLLAPSED behind a single
                       "Stroke size & colour" toggle (styleOpen state, default
                       closed) so the rail stays short. The toggle previews the
                       active colour (swatch) with the active size as a centred dot,
                       and a caret that flips when open; expanding it reveals the
                       2×2 size grid and 2×4 colour grid.

CanvasSearch.tsx       Full-text search overlay (⌘F / Ctrl+F). Floats at the top of
                       the canvas; keyboard-navigable result list (↑↓ Enter). Jumps
                       to and selects the matched shape via editor.zoomToBounds.
                       Searches props.text and props.name across all shape types.

ShortcutsModal.tsx     Keyboard shortcuts cheatsheet modal (? or toolbar button).
                       Three sections: Drawing tools, Actions, View & navigation.
                       Geometric shape tool shortcuts (R/O/A/L/T/F) intentionally
                       omitted — their kbd bindings are cleared in the tools() override.

CanvasFloatingPanel    Internal component in WhiteboardCanvas. Top-right floating
                       column of status indicators and context-sensitive controls:
                       - "Bring everyone here" (host only): broadcasts viewport bounds
                         over Supabase Realtime channel vp-{roomId} so every guest
                         zooms to match in 400 ms
                       - "Point at board" (non-host, hand/laser mode only): toggles
                         the laser pointer tool so students can point without drawing
                       - "Clear my work" (non-host): deletes all shapes where
                         meta.authorId === userId; pill shows count and auto-hides
                         when the page is clean
                       - PenModeIndicator: tap-to-dismiss pen-mode pill
                       - StrokeSizePicker + ColorPickerRow: md:hidden (in LeftRail)
                       - "Tools / Hide tools" toggle: md:hidden — it only collapses
                         the mobile SlimToolbar; on desktop the LeftRail is the toolset
                         and tldraw's toolbar is hidden anyway, so it's removed there.
                       (SyncStatusDot was removed — ReconnectBanner is the single
                       connection-status home.)

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
                       Exposes onStateChange so RoomShell can render the
                       RecordingIndicator overlay while idle/recording/paused/
                       saving — "active" = recording OR paused.

RecordingIndicator.tsx Red inset border + pulsing 'REC' badge painted over
                       the canvas while recording is live. pointer-events:
                       none so it doesn't block drawing. Mounted inside the
                       canvas wrapper div in RoomShell so it tracks the canvas
                       exactly (not the room shell — wouldn't want it framing
                       the video panel too).

VideoPanelResizer.tsx  Drag handle on the desktop video panel's left edge. Width persists
                       in localStorage.
```

## Hooks (`src/hooks/`)

- `useSettings()` — localStorage-backed app preferences (theme, PDF layout, pen-only, defaults, hasSeenOnboarding). Default theme is "light".
- `useAuth()` — Supabase user + `signOut()` + `displayUsername(user)` helper that strips the `@a-worthy.local` suffix for display.
- `useIsHost(roomId)` — combined server + localStorage host check
- `useRoomMeta(roomId)` — room title + leader-mode state, with `setTitle` / `setLeaderMode`
- `useRecentRooms()` + `trackRoomVisit()` — localStorage list shown on home page
- `useSyncToken(roomId, userId)` — fetches an HS256 sync token from `/api/sync-token` and auto-refreshes ~2 min before its 15-min TTL. Until the first token arrives, `WhiteboardCanvas` uses a placeholder URI that 401s — useSync briefly shows offline state and swaps to the real URI when the token lands.

## Module-level stores (`src/lib/`)

- `captionsStore.ts` — singleton store for live caption lines. `pushCaption()` writes; `subscribeToCaptions()` / `getCaptionsSnapshot()` are consumed by `CaptionsHost` via `useSyncExternalStore`. The store lives outside React because caption updates arrive 5-10×/sec during active speech, and putting that churn into RoomShell state was forcing a full-tree re-render on every interim. Moving it out also frees ~10-30ms of frame budget per interim, which directly improves pen latency while someone is speaking.
- `fileValidation.ts` — centralised upload allow-list used by every upload path (WhiteboardCanvas, DocumentsDrawer, AttachmentPicker). `validateFileForUpload(file)` throws with a user-facing message for disallowed types; `getSafeMimeType(file)` returns a safe `Content-Type` for the Storage PUT (falls back to `application/octet-stream` rather than echoing untrusted browser MIME). **SVG is intentionally absent**: `image/svg+xml` files served from the public Supabase CDN and opened via `target=_blank` execute embedded `<script>` tags — stored XSS. Do not add SVG back without serving it through a sanitising proxy.

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
- **Captions on iOS**: all iOS browsers — Safari, Firefox, Chrome, Edge — are WKWebView wrappers and have no reliable `webkitSpeechRecognition`. The host's own voice can't be transcribed from an iPad or iPhone. `CaptionsManager` detects this on captions-enable and fires a one-time toast pointing the user to desktop or Android Chrome. Other participants on supported browsers still see their own captions broadcast; the iOS user receives them. Don't try to "fix" this with a polyfill — the platform doesn't expose the API.
- **Captions performance**: caption state is held in `src/lib/captionsStore.ts`, NOT in RoomShell. Interim captions arrive 5-10× per second during active speech; if you put them into a top-level useState, every interim re-renders the whole room tree (header, drawers, etc.) and visibly degrades both perceived caption latency AND pen latency. New caption-adjacent UI should subscribe to the store via `useSyncExternalStore` (see `CaptionsHost.tsx`), not pass `captionLines` as props.
- **Upload validation is centralised** — all upload entry points (canvas drag-drop, Documents drawer, AttachmentPicker) call `validateFileForUpload` from `src/lib/fileValidation.ts` before the XHR fires. SVG is blocked at this layer (stored XSS risk via public CDN). Do not add a new upload path without importing and calling `validateFileForUpload` first, and use `getSafeMimeType` for the `Content-Type` header — never echo `file.type` directly to Supabase Storage.
- **PDF writing space**: when `settings.pdfWritingSpace` is on (default), uploading a PDF also drops a blank ruled "answer sheet" of the SAME page size directly to the right of each page, so students can write where a worksheet has no allocated answer space. Because the sheet reuses the page's `w`/`h` (which are PDF points), an A4 page → an A4 sheet automatically. The sheet is a self-contained `data:image/svg+xml;base64,…` URL built by `makeLinedSheetDataUrl(w,h)` and placed via `insertLinedSheet()` as a LOCKED image (students draw on top). It's a data URL, not an uploaded/CDN-served file, so the SVG-XSS rule in `fileValidation.ts` doesn't apply. Both PDF paths support it: `insertPdfAsImages` (canvas images — vertical layout puts sheets in a parallel right column; horizontal layout advances the per-page stride past page+sheet) and `insertPdfAsPageBackgrounds` (one tldraw page per PDF page — sheet sits at `x = w/2 + 40`, sent to back like the page background). Sheets of the same size share one hash-keyed asset.
- **Non-host default tool is hand**: in `WhiteboardCanvas.onMount` we call `editor.setCurrentTool("hand")` when `!isHost`. With `touch-action: none` on the canvas, a single-finger swipe goes to tldraw's gesture pipeline — defaulting students to the hand tool means a swipe pans rather than drawing a stray line. The host stays on `draw`. The student can still switch tools if they want to annotate.
- **Toolbar active state**: globals.css forces a brand-blue background + white icon for the selected tool button (`[aria-pressed="true"]` / `[data-state="selected"]`). tldraw's default light-mode highlight was too subtle.
- **Leader mode UI**: when on, the host sees a yellow "LEADING VIEW" pill top-right of the canvas, AND the eye icon in the toolbar gets a filled amber background with white icon (vs. a thin amber outline before). Guests being followed see the existing "Following host" pill.
- **Geometric shape lockout**: the `tools()` override in `WhiteboardCanvas` clears the keyboard `kbd` field for `arrow`, `line`, `geo`, `text`, and `frame` so they're unreachable. They were already hidden from the SlimToolbar; this also kills the R/O/A/L/T/F shortcuts.
- **Two-finger scroll & touch**: `.tldraw-shell` sets `touch-action: none` + `overscroll-behavior: contain` + `-webkit-user-select: none` + `-webkit-touch-callout: none` + a fallback `touch-action: none` on every nested `.tl-container` / `.tl-canvas` / `canvas` (Firefox sometimes ignores the parent value). `userScalable: false` in the viewport meta lets two-finger gestures reach tldraw's pan/zoom code instead of zooming the whole page.
- **Supabase "Confirm email" must be OFF** for password sign-up to work — we use synthetic `@a-worthy.local` emails that can't receive mail. Set in Supabase Dashboard → Authentication → Providers → Email → Confirm email → toggle OFF.
- **Guests don't sign up**. Anyone with a room link can join: they land on `/r/<roomId>`, see the `GuestNameEntry` form (or skip it if they have a remembered name), then KnockGate creates a `join_requests` row and waits for the host to Admit. The host sees an `AdmissionPanel` floating top-right + a toast for every new knocker.
- **Admission is persistent per (room, user_id)**. KnockGate now reads-then-conditionally-inserts: if a row already exists for this device it preserves the status (admitted → straight in, pending → still waiting, denied → stays denied). An older version unconditionally upserted 'pending', which clobbered admitted rows on every visit and effectively required re-admission every time. If you re-introduce an upsert here, use `ignoreDuplicates: true` or read first — never overwrite without intent.
- **Magic invite links** (`/api/invite/mint` + `/api/invite/redeem`). Host-only feature in InvitePanel: generates an HS256 JWT signed with `WORKER_SHARED_SECRET` containing `{ kind: "invite", roomId, exp }`. Default 90-day expiry. Mint is gated by Supabase session — the caller must present a Bearer token that resolves to the `rooms.host_user_id` for this room (so localStorage-only hosts can't mint until they claim the room to their account in Settings). Redeem is anonymous + token-gated: any guest opening `/r/<roomId>?invite=<token>` has the token verified, then their `join_requests` row is upserted to admitted. KnockGate detects the `invite` URL param and calls redeem before the normal knock flow. Invite tokens deliberately OMIT the `userId` claim so the Cloudflare worker's `verifySyncToken` (which requires both `roomId` and `userId`) won't accept them as sync tokens — leaking an invite link only grants the right to redeem into the knock flow, not direct whiteboard sync. There's no server-side revocation list; rotate `WORKER_SHARED_SECRET` to invalidate all outstanding invites. **`SUPABASE_SERVICE_ROLE_KEY` must be set in Vercel** — the redeem route uses it to bypass the RLS UPDATE policy; if the var is missing the route hard-fails with 500 (deliberately, not a silent fallback).
- **Zoom UI is custom**. tldraw's default `MenuPanel` (which holds its ZoomMenu) AND its `NavigationPanel` (the native zoom/minimap pill) are both nulled in our `components` override, so we render our own `ZoomControls` bottom-left (was bottom-right; moved so the video panel doesn't cover it). If `NavigationPanel` is ever un-nulled you get TWO zoom pills stacked bottom-left — that was the "duplicate zoom panel" bug.
- **PWA orientation lock**: `public/manifest.webmanifest` sets `"orientation": "portrait"`. This is honoured for installed PWAs on Android Chrome; iOS Safari ignores it for non-installed sessions.
- **PWA icons**: the manifest lists five PNG sizes (152/167/180/192/512) plus a maskable variant and an SVG. iOS doesn't read the manifest list reliably on first install — `src/app/layout.tsx` adds explicit `<link rel="apple-touch-icon" sizes="...">` tags for 152/167/180 so Safari picks the right one. Regenerate the smaller PNGs from `public/icon.svg` whenever the source art changes (sharp can do this in ~10 lines; see commit `7f81a18` for the original pass).
- **PWA install banner**: `PwaInstallBanner.tsx` listens for `beforeinstallprompt` (Android Chrome only — iOS Safari doesn't fire this) and persists dismissal in `wb_pwa_install_dismissed`. iOS users install via Share → Add to Home Screen.
- **Service worker caching strategy**: `public/sw.js` runs two cache buckets. `wb-static-v2` is cache-first for `/_next/static/*` (content-hashed by Next so safe-to-cache-forever) — every PWA cold launch after the first boots from cache, dropping startup ~1s. `wb-shell-v2` is stale-while-revalidate for `manifest.webmanifest` + `icon.svg`. Everything else (HTML routes, API calls, Supabase, LiveKit, sync worker) is network-only — no risk of a stale room shell or stale auth token. If you change the cache schema, bump both bucket names (`-v2` → `-v3`); the `activate` listener sweeps any older bucket.
- **Notch / Dynamic Island**: `viewport: { viewportFit: "cover" }` in `layout.tsx` lets the canvas paint behind the iPhone X+ cutout in landscape PWA mode. Interactive UI stays clear via `safe-area-inset-*` paddings in `globals.css`.
- **No horizontal scroll**: `html, body { overflow-x: hidden; max-width: 100vw; }` in `globals.css` keeps the room shell from sliding sideways even if a child overflows. tldraw's canvas still pans freely because it sets its own touch-action and is inside an `inset-0` container.
- **Header is two rows on md+**: row 1 = Documents / Homework / Recordings / Record; row 2 = Export / Invite / Hide-video / Settings. Mobile collapses both rows into the existing kebab/hamburger menu.
- **`/auth/callback` is a no-op stub** now that magic-link auth is gone. Don't remove it — it's wrapped in `<Suspense>` and harmless if hit, and password reset / OAuth could re-use it later.
- **Annotation stamp and draw-grant students**: `WhiteboardCanvas.onMount` stamps every new shape with `meta.annotation = !isHostRef.current && userId !== drawGrantUserIdRef.current`. The draw-grant exclusion means shapes drawn by a student the host has promoted to draw are NOT tagged as annotations and will NOT be hidden by "Hide student work". If you change the stamping logic, preserve this exclusion — the whole point of draw-grant is to have the student's work visible alongside the host's.
- **Shape authorship stamp**: every shape also gets `meta.authorId = userId` (alongside `meta.annotation`). This is what the "Clear my work" button in CanvasFloatingPanel uses to find and delete only the current student's shapes. If you change the stamping logic in `registerBeforeCreateHandler`, preserve BOTH fields.
- **"Bring everyone here" uses Supabase Realtime, not LiveKit**: the host clicking the button in CanvasFloatingPanel sends the current viewport bounds over Supabase Realtime Broadcast channel `vp-{roomId}`. Guests subscribe in a useEffect in WhiteboardCanvas and call `editor.zoomToBounds` when a `vp` event arrives. This avoids needing access to the LiveKit room context from outside the LiveKitRoom tree. Don't switch it to LiveKit data channel without threading the send function all the way up to WhiteboardCanvas.
- **Desktop/mobile drawing controls split**: LeftRail owns the color and size pickers on desktop (md+). The same pickers inside CanvasFloatingPanel carry `md:hidden` so they're only visible on mobile. If you add a new drawing style control, add it to BOTH LeftRail AND CanvasFloatingPanel (with `md:hidden`), keeping parity between breakpoints.
- **RecordButton paused-state stop**: the screen-share track's `ended` event now checks `state === "recording" || state === "paused"` before calling `stop()`. If you see a UI deadlock where the recorder appears stuck after the user stops sharing mid-pause, re-check this guard.
- **LessonTimer expiry**: the 250 ms tick interval self-clears when `computeRemaining(timer) <= 0`. Nobody writes `timer_running=false` to the DB when the client clock hits zero (the timer just shows "Time's up"), so without the self-clear the interval would fire indefinitely. `addMinute` is capped at 480 minutes remaining so values stay well below the PostgreSQL `INTEGER` overflow boundary.
- **LessonTimer clock**: the widget also shows a live current-time readout in Singapore time (GMT+8) via `Intl.DateTimeFormat({ timeZone: "Asia/Singapore" })`, ticked by its own always-on 1 s interval (`now` state). The clock is shown to everyone (host + students), even when no countdown is set — so the idle-state early-return for students was removed. On phones the clock is `hidden sm:block` while a countdown is ACTIVE so the running pill + host controls don't overflow a narrow viewport.
- **Free tiers**: Supabase Storage 1 GB, LiveKit 10k participant-min/month. Watch the Recordings drawer for big files eating Supabase Storage.
- **ChatBubble draft restore**: `send()` clears `draft` before the Supabase insert, then re-sets it to the original text if the insert fails so the user doesn't silently lose a composed message. If you touch the send path, preserve this order — clearing first is correct UX (immediate feedback), but the error path must restore the value.
- **SettingsModal clipboard**: the invite-URL copy button awaits `navigator.clipboard.writeText()` before showing the "Copied" badge, with a `.catch(() => {})` for denied access. Before the fix, the badge showed synchronously even when the browser rejected the write. Never show success feedback for async operations before the Promise resolves.
- **HomeworkDrawer submission delete**: `removeSubmission()` checks `{ error }` from Supabase and surfaces failures as `toast.error`. Silent deletes fail invisibly and confuse both host and student — always handle the error on destructive DB operations.
- **API routes JSON parse guard**: all four token/invite routes (`/api/sync-token`, `/api/livekit/token`, `/api/invite/mint`, `/api/invite/redeem`) wrap `req.json()` in `try/catch` and return a `{ error: "Invalid JSON" }` 400 on parse failure. Without the guard, a malformed body throws past the route handler and produces a generic 500. Any new API route that calls `req.json()` must include this guard.
- **`paletteCommands` useMemo must include all callback deps**: RoomShell's command-palette list is built in a `useMemo`. When that memo closes over a `useCallback` such as `downloadAllPagesPdf`, the callback itself must appear in the dep array — not only its leaf inputs. Omitting it creates a stale closure: renaming the room mid-session would produce a PDF export with the old title. ESLint's `react-hooks/exhaustive-deps` warnings inside this memo are real bugs, not false positives. Exception: `toast` from `useToast()` is stable (memo'd in the context provider) and can safely be omitted.

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
4. **Bundle budget**: keep heavy libraries (pdfjs, exportToBlob) lazy-loaded.
   Server-side render where possible.
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
    referenced by other rows and must not be deleted. **Every new upload path must
    call `validateFileForUpload(file)` from `src/lib/fileValidation.ts` before the
    XHR fires, and use `getSafeMimeType(file)` for the `Content-Type` header.**
    Never add SVG to the allow-list — see the fileValidation.ts note above.
14. **`SUPABASE_SERVICE_ROLE_KEY` is server-side only.** It must live in Vercel env
    vars and never be referenced from client components or exposed in the browser.
    Currently only `/api/invite/redeem` uses it. Any future server route that needs
    to bypass RLS should follow the same pattern: hard-fail with 500 if the var is
    absent rather than silently degrading to the anon key.
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
15. **`useMemo` / `useCallback` dep completeness in RoomShell**: when a `useMemo`
    (e.g. `paletteCommands`) closes over a `useCallback`, include the callback in
    the dep array — stale-closure bugs from missing callback deps are silent and
    hard to reproduce. ESLint `react-hooks/exhaustive-deps` warnings in that memo
    are real bugs. `toast` from `useToast()` is the one known exception (stable
    via its context `useMemo`).
16. **Async UI state must await its Promise**: never show success feedback (copy
    badge, toast, etc.) synchronously for an async operation — await the Promise
    and handle the rejection. The `navigator.clipboard.writeText()` pattern in
    `SettingsModal` is the canonical example.
17. **VideoPanel call state — `callJoined` vs `videoPanelVisible`**: these two
    booleans in RoomShell are distinct. `callJoined` gates VideoPanel mounting and
    the LiveKit connection; `videoPanelVisible` controls the aside/sheet layout.
    Don't collapse them back into a single `videoOpen` flag — that would break
    audio-only mode (panel hidden, call connected). The desktop aside is always
    mounted when `callJoined = true` (even when hidden), so the LiveKit connection
    stays alive. The mobile sheet is unmounted when `videoPanelVisible = false`
    because `display:none` on the aside already keeps the connection alive on
    mobile too (the aside's VideoPanel is hidden but mounted).
    `onLeaveCall` must always set BOTH `callJoined = false` AND
    `videoPanelVisible = false` (and reset `joinMode = null`) — leaving the call
    with the aside still mounted would keep a dead LiveKit component in the tree.
    Both booleans now START FALSE; the welcome-screen entry modal
    (`entryChoiceMade`) sets them. The chosen mode (`joinMode`) is passed to
    VideoPanel as `autoConnect` so it connects directly without re-prompting.
    Don't wire VideoPanel mounting back to the `showVideoOnEntry` setting —
    the modal is the single entry decision now. There's also a PiP mode
    (`videoPip` + `pipPos`): when on, the desktop aside is `position: fixed`
    (out of flow) so the canvas reflows full-width while VideoPanel keeps its
    React position — never move VideoPanel to a different parent or the
    LiveKit connection remounts.
18. **`StrokeSizePicker` and `ColorPickerRow` ARE used inside `WhiteboardCanvas`.**
    They render in the internal `CanvasFloatingPanel` (wrapped in `md:hidden` so
    they only appear on phones — desktop uses the copies in `LeftRail`). The two
    imports near the top of `WhiteboardCanvas.tsx` are therefore required. Do NOT
    "clean up" these as unused imports: removing them produces a
    `react/jsx-no-undef` build error that fails the Vercel deploy. If ESLint ever
    reports them as unused, the real cause is upstream (a refactor removed the JSX
    usage) — fix that, don't delete the import blindly.
