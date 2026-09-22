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
| `room_templates` | Host's private, account-scoped library of reusable board layouts. `owner_user_id` → `auth.users`; `content` is a tldraw `TLContent` jsonb blob; `thumbnail` is a small WebP data URL for the library preview (nullable). **Owner-only RLS** (no public read) and **NOT** in the realtime publication — see exception note below. |

All app tables **except `room_templates`** are added to the `supabase_realtime`
publication so the React hooks just subscribe and re-fetch on change. RLS is
**permissive** on the non-rooms tables (anyone can read/write) because the app
doesn't have proper auth boundaries for student data — host-only actions are
enforced client-side. Two tables are the exception: `rooms` ownership writes
require the matching authenticated user, and `room_templates` is **owner-only
for every operation** (a private host library — no public read, and
deliberately left out of the realtime publication since only the owner ever
reads it, in their own modal).

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
                       ControlBar with leave enabled. Tiles also renders a
                       ConnectionQualityChip per participant (via
                       useConnectionQualityIndicator) that only appears when that
                       participant's LiveKit quality drops to Poor (amber) or Lost
                       (red), naming who — so a freeze reads as a network issue.
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
                       Admit / Deny buttons (+ "Admit all" when 2+ pending, one
                       batch UPDATE of every pending row → admitted). Also fires a
                       toast ("X is asking to join") the first time it sees each new
                       pending request so the host can't miss it. Fetches ALL the
                       room's join_requests (not just pending) to drive a collapsible
                       roster of already-decided students (excludes the host's
                       self-admit row): admitted → "Remove" (deny), denied →
                       "Re-admit" (admit). KnockGate live-subscribes to each row, so
                       Remove kicks the student and Re-admit lets them straight back
                       in. When nobody's pending the panel shrinks to a compact
                       collapsed "Class roster (n)" pill (w-56, subtle border); a
                       pending knock expands it to the full brand-bordered panel.

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

HomeworkDrawer.tsx     Student submission picker passes allowCapture to AttachmentPicker
                       so students get a one-tap "Take photo" (rear camera) for
                       snapping handwritten work; host worksheet-attach path omits it.
                       Assignments past their due date render "Overdue · {date}" in
                       red (vs amber "Due {date}"). The host's Homework nav tab shows
                       a "needs review" count badge fed by useHomeworkReviewCount
                       (count of homework_submissions in the room with feedback IS
                       NULL, live via Realtime); see useHomeworkReviewCount below.
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
                       host-only controls (bring everyone to my view, hide
                       annotations, lead view) AND the
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
                       column of status indicators and context-sensitive controls.
                       All pills share one shape (rounded-full, text-[11px],
                       shadow-lg) so the cluster reads as one system — the bottom
                       pills (ZoomControls, PagesTabBar) use the same rounded-full +
                       shadow-lg so the whole canvas-pill system matches. On phones
                       the column sits at top-14 (md:top-3) so the wider status pills
                       clear the centred LessonTimer/clock and never overlap it.
                       - "Bring everyone to my view" (host only) used to live here
                         as an always-on pill but was MOVED OFF the canvas — it now
                         sits in LeftRail (desktop) and the mobile "More" menu, so
                         the canvas top stays clear and doesn't collide with the
                         centred LessonTimer/clock on narrow phones. The viewport
                         broadcast itself is exposed via bringEveryoneRef (mirrors
                         openUploadRef); broadcastViewport still sends bounds over
                         Supabase Realtime channel vp-{roomId} (see gotcha below).
                       - "Point at board" (non-host, hand/laser mode only): toggles
                         the laser pointer tool so students can point without drawing
                       - "Clear my work" (non-host): deletes all shapes where
                         meta.authorId === userId; pill shows count and auto-hides
                         when the page is clean
                       - DeleteSelectionButton: appears whenever ≥1 shape is
                         selected and deletes the selection in one tap (shows
                         "Delete (n)" for multi-select). Shown on ALL breakpoints,
                         not md:hidden — tldraw's native delete (QuickActions) is
                         nulled when the toolbar is collapsed (phones) and hidden
                         by CSS at md+ (iPad has no keyboard), so this is the only
                         touch path to remove a sticky note without the eraser.
                         Notes are intentionally eraser-immune (see the
                         registerBeforeDeleteHandler note below), making this pill
                         (or Backspace) the way to remove them.
                       - UndoRedoControls: md:hidden grouped pill (undo · redo)
                         shown only on phones. Desktop has undo/redo in LeftRail;
                         on phones they otherwise sit in the collapsed SlimToolbar
                         (behind the Tools toggle), so this surfaces one-tap undo
                         for a stray stroke. Buttons grey out via getCanUndo/Redo.
                       - PenModeIndicator: tap-to-dismiss pen-mode pill
                       - StrokeSizePicker + ColorPickerRow: md:hidden (in LeftRail).
                         On phones both sit behind a single collapsible "Stroke
                         size & colour" preview toggle (styleOpen state, default
                         closed) that mirrors LeftRail — the preview shows the
                         active colour swatch with the active size as a centred
                         dot + a caret. ColorPickerRow takes an `embedded` prop
                         here so it renders the full grid (no double-collapse)
                         and skips its own auto-collapse-on-pick.
                       - "Tools / Hide tools" toggle: md:hidden — it only collapses
                         the mobile SlimToolbar; on desktop the LeftRail is the toolset
                         and tldraw's toolbar is hidden anyway, so it's removed there.
                       (SyncStatusDot was removed — ReconnectBanner is the single
                       connection-status home.)

TemplatesModal.tsx     Host-only, lazy-loaded modal (entry points: desktop "More" ⋯
                       menu + mobile menu, both host-gated). Reusable board
                       templates: "Save this page as a template" captures the
                       current page via editor.getContentFromCurrentPage(
                       [...getCurrentPageShapeIds()]) and inserts a row into
                       room_templates; "Load" calls putContentOntoCurrentPage(
                       content, { select: true }) + zoomToSelection, adding the
                       template's shapes to the CURRENT page (not replacing it).
                       Account-scoped (owner_user_id = auth.uid()), so it requires
                       sign-in — a localStorage-only host sees a "sign in to save"
                       prompt instead. Takes editor={canvasEditorRef.current} like
                       EndLessonModal. Each save also captures a small WebP
                       thumbnail (exportToBlob → canvas downscale to 320px, stored
                       in room_templates.thumbnail; best-effort, null on failure →
                       placeholder icon) shown in the list, and rows can be renamed
                       inline (pencil → input → Enter/blur updates name).

SettingsModal.tsx      Profile, account (sign in / claim room / sign out), appearance
                       (theme), whiteboard (pen-only/palm-rejection), documents, call
                       defaults, room (invite link, leave room).

PresenceBadge.tsx      Header live-participant count via Supabase Realtime presence.

ReconnectBanner.tsx    Floating banner when tldraw sync is loading/offline/errored.

ErrorBoundary.tsx      Reusable React error boundary (class component) with a
                       `fallback(reset, error)` render prop. RoomShell wraps the
                       volatile subtrees in it — VideoPanel (both the desktop aside
                       and mobile sheet) and the three drawers — so one widget
                       throwing during render shows a scoped fallback instead of
                       tripping the route-level error.tsx and taking down the live
                       whiteboard. VideoErrorFallback / DrawerErrorFallback are the
                       fallbacks (in RoomShell). The boundary is a STABLE wrapper, so
                       it never remounts VideoPanel (safe w.r.t. the LiveKit-position
                       caveat #17 — PiP still moves the aside, not the parent chain).
                       App-router error files: `src/app/error.tsx` (route-segment
                       crashes) and `src/app/global-error.tsx` (root-layout crashes;
                       ships its own <html>/<body>, no theme vars since the shell may
                       have failed to mount).

OnboardingHint.tsx     One-time tutorial modal (settings.hasSeenOnboarding flag).

BrandLogo.tsx          next/image wrapper with TWO variants. `variant="mark"`
                       (default) renders the square /icon.png — correct wherever
                       space is tight or the box is square. `variant="wordmark"`
                       renders /logo-wordmark.png, the full "A-Worthy Education"
                       lockup at 919x220 (~4.18:1); `size` is the HEIGHT and the
                       width is derived so it never distorts. The wordmark
                       already contains the company name, so never put brand
                       text beside it. Used as wordmark on the landing hero, the
                       room header at sm+, and the Telegram redirect splash;
                       stays the mark on phones and in the Telegram mini-app
                       header, where a ~117px lockup would crowd the row.

Sticker.tsx            next/image wrapper for the mascot stickers, addressed by
                       NAME (`<Sticker name="teaching" size={104} />`). The
                       intrinsic w/h of every sticker is recorded in its
                       STICKERS map, so `size` is the HEIGHT and the width is
                       derived — they range 0.65–0.89 in aspect, and a shared
                       square box would letterbox some and distort others.
                       `alt` defaults to "" (decorative). Two groups:
                       - Scene stickers (400px tall sources): teaching,
                         reading, encourage, dad, feeding.
                       - Subject stickers (400px tall, tutor + student per
                         subject): mathematics, calculus, chemistry, economics,
                         finance — exported together as `SUBJECT_STICKERS` in
                         reading order. Used for the landing hero's sticker
                         sheet and the room welcome modal.
                       - Solo stickers (240px tall sources): avocado, heart,
                         rocket, icecream — also the CanvasWatermark set.
                       Placed at: landing hero (teaching), OnboardingHint
                       welcome modal (teaching), KnockGate waiting screen
                       (encourage), HomeworkDrawer empty state (reading),
                       ChatBubble empty state (feeding), Telegram redirect
                       splash (dad).
                       **`dad` and `feeding` are the two family-themed ones**
                       (a "#1 DAD" mug, a baby being bottle-fed) and their
                       placements are deliberately constrained: both depict
                       "a big one looking after a little one", so they sit on
                       surfaces about warmth (chat) or pure brand decoration
                       (the Telegram splash, which is a wordmark + spinner
                       and makes no claim about the viewer). Do NOT move
                       `dad` onto a lesson-outcome surface — EndLessonModal,
                       a homework result, a profile — where "#1 DAD" reads as
                       an assertion about the user rather than as brand art.
                       For a breakpoint-varying size, pass the desktop
                       value as `size` and override with `h-[..] sm:h-[..]
                       w-auto` classes — an inline height can't carry a media
                       query.

ThemeApplier.tsx       Toggles html.theme-light based on useSettings().theme. Default
                       theme is "light" — dark mode still exists but isn't the default,
                       and active UI tuning targets light contrast.

IconDefaults.tsx       Client wrapper mounted in the root layout: a Phosphor
                       IconContext.Provider with `weight: "bold"`. The LMS draws
                       every icon bold (its Iconify names are all `ph:*-bold`),
                       and that heavier stroke is what lets an icon sit inside
                       a 2px-outlined sticker without looking thinner than its
                       own frame. An explicit `weight` on an icon still wins.

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
- `useHomeworkReviewCount(roomId, enabled)` — live count of the room's `homework_submissions` with `feedback IS NULL` (host-only; returns 0 when disabled). Drives the Homework nav "needs review" badge. One `count: "exact", head: true` query + a Realtime subscription on `homework_submissions` filtered by `room_id`.
- `useSyncToken(roomId, userId)` — fetches an HS256 sync token from `/api/sync-token` and auto-refreshes ~2 min before its 15-min TTL. Until the first token arrives, `WhiteboardCanvas` uses a placeholder URI that 401s — useSync briefly shows offline state and swaps to the real URI when the token lands.

## Module-level stores (`src/lib/`)

- `captionsStore.ts` — singleton store for live caption lines. `pushCaption()` writes; `subscribeToCaptions()` / `getCaptionsSnapshot()` are consumed by `CaptionsHost` via `useSyncExternalStore`. The store lives outside React because caption updates arrive 5-10×/sec during active speech, and putting that churn into RoomShell state was forcing a full-tree re-render on every interim. Moving it out also frees ~10-30ms of frame budget per interim, which directly improves pen latency while someone is speaking.
- `fileValidation.ts` — centralised upload allow-list used by every upload path (WhiteboardCanvas, DocumentsDrawer, AttachmentPicker). `validateFileForUpload(file)` throws with a user-facing message for disallowed types; `getSafeMimeType(file)` returns a safe `Content-Type` for the Storage PUT (falls back to `application/octet-stream` rather than echoing untrusted browser MIME). **SVG is intentionally absent**: `image/svg+xml` files served from the public Supabase CDN and opened via `target=_blank` execute embedded `<script>` tags — stored XSS. Do not add SVG back without serving it through a sanitising proxy.

## Theming — the LMS "sticker-book" design system

The whiteboard shares its visual language with **lms.a-worthy.com** (the
company's learning platform). Its tokens are copied verbatim from the LMS's
`src/theme/theme.js` / inline `:root` block, so the two apps read as one
product. If the LMS restyles, re-sync from there — do not invent values here.

**The look**: warm cream paper (`#FAF6EE`, with a faint 22px dot "paper fibre"
texture on `body`) on which every surface is a **die-cut sticker** — white
fill, a **2px navy outline** (`--ink` `#22304A`), and a **hard offset shadow
straight down** (`0 4px 0 rgba(34,48,74,.14)`). Cards are `rounded-xl` (20px),
buttons and floating canvas controls are pills. Text is near-black; the ONE
accent is red `#C0392B`. Primary buttons are red pills with a darker-red hard
shadow, white text, weight 800. Headings are Nunito 800 with −0.02em tracking.
Eyebrow labels are `.font-label` (10px / 600 / uppercase / 0.06em). Icons are
Phosphor **bold** (app-wide default via `IconDefaults`). Pills push into the
paper on press (`.sticker-press`); clickable cards lift on hover (`.card-lift`).

CSS variables in `globals.css` (legacy names kept as the API — every existing
`var(--…)` consumer re-themed for free when the palette was swapped):

```css
:root {
  --bg / --bg-elev / --bg-elev-2 / --bg-sidebar   /* cream page · white card · muted inset · rail/drawer tint */
  --canvas                                        /* the whiteboard fill — same cream, solid (no dots under ink) */
  --text / --text-muted / --text-dim              /* text tiers */
  --border / --border-subtle / --border-strong    /* hairlines (dividers only — outlines are --ink) */
  --hover                                         /* warm hover tint #EEE7D6 */
  --accent / --accent-dark / --accent-mid / --accent-soft   /* the red */
  --ink / --ink-shadow / --ink-faint              /* sticker outline + hard shadow. NEVER text. */
  --sun / --grass / --bloom / --sky (+ -deep, -bg) /* pastel chip set */
  --success / --warning / --danger (+ -bg)
  --shadow-sticker / -sm / -lg, --shadow-1/2/3
}
```

Tailwind (`tailwind.config.ts`) mirrors them: `brand-*` is the **red** scale
(600 fill, 700 hard shadow), `danger-*` is the **same red** (see rule below),
`ink` / `ink-shadow` / `ink-faint`, the pastel set, `shadow-sticker*`,
`shadow-sticker-primary`, and the LMS radius ladder `md`=10 `lg`=14 `xl`=20
`2xl`=26 `3xl`=32. tldraw's `--radius-1..4` and LiveKit's `--lk-border-radius`
are bumped to the same ladder in globals.css.

Utility classes in `globals.css`: `.sticker` · `.sticker-pill` · `.sticker-sm` ·
`.sticker-press` · `.card-lift` · `.squiggle` (the red hand-drawn underline, as
an inline heading span) · `.font-label` · `.glass-header` · `.scale-pop` ·
`.fade-up` · and the three button tiers `.btn-primary` (red pill) /
`.btn-secondary` (white pill) / `.btn-tertiary` (ghost).

`ThemeApplier` still flips `html.theme-light`, but light is the only palette —
`html.theme-light` is an alias of `:root`. tldraw's own colours follow via
`editor.user.updateUserPreferences({ colorScheme: "light" })` in
`WhiteboardCanvas.onMount`; its active-tool highlight is `var(--accent)`.

**Conventions**

- Never hardcode a hex or a `white/xx` / `black/xx` class. Use tokens
  (`bg-[var(--bg-elev)]`, `text-[var(--text-muted)]`, `border-ink`…). The one
  exception is `src/app/global-error.tsx`, which ships before the theme
  variables can mount and carries the LMS values inline with a comment.
- **Brand-button rule**: any `bg-brand-600` / `bg-brand-500` element MUST set
  `text-white` explicitly. The fill is saturated red, so inheriting
  `text-[var(--text)]` gives dark-on-dark.
- **Destructive is a variant, not a hue.** `brand` and `danger` are the same
  red on purpose (as on the LMS). A destructive action — End lesson, Delete,
  Remove, Deny — is the PALE variant: `bg-danger-50 text-danger-700` inside the
  same `border-2 border-ink` pill. Never a second solid red: solid red means
  "go". The single non-button solid red is the live REC indicator.
- `--ink` is for outlines and hard shadows only. Body text is `--text`.
- Icons stay Phosphor; don't pass `weight="regular"` — bold is the context
  default. `weight="fill"` for an active/on state still wins.
- A 2px outline adds 4px to a control; on phone controls that were already at
  the 40px touch minimum, trim padding rather than let the pill grow.

## Operational gotchas

- **GitHub Actions for the Worker**: the workflow is at `.github/workflows/deploy-worker.yml`. It needs `CLOUDFLARE_API_TOKEN` (a user-scoped token, prefix `cfut_`, not the account-scoped `cfat_` flavor — the latter fails `/user/tokens/verify`) and `CLOUDFLARE_ACCOUNT_ID`.
- **R2 is NOT used.** Snapshots live in the Durable Object's own SQLite via chunked storage. R2 was tried and abandoned (requires the user to add a card on file to enable it).
- **tldraw watermark removal** requires the license key in `NEXT_PUBLIC_TLDRAW_LICENSE_KEY`. The key is necessarily exposed in the client bundle — keep it out of git history (env var only) so a public fork doesn't accidentally reuse it.
- **LiveKit identity must be stable**. The token endpoint uses `u-<userId>` so opening the room in a second tab on the same browser kicks the first tab instead of creating a ghost participant.
- **Camera release**: LiveKit by default just mutes when you disable camera/mic. `CameraReleaseGuard` explicitly calls `track.stop()` 150 ms after disable so the OS hardware indicator goes off. Mic uses `publishDefaults.stopMicTrackOnMute: true`.
- **LiveKit room options are perf-tuned — don't drop them.** All the room options live in `ROOM_OPTIONS`, a module-level constant in `VideoPanel.tsx` hoisted so its identity is stable across renders (it was an inline object literal, recreated every render). Three of the five entries exist purely to keep video off the whiteboard's frame budget: video encode/decode competes with tldraw's canvas rendering and pointer handling for the same main thread, and on an iPad that competition is what a lesson *feels* as pen lag. `adaptiveStream: true` pauses/downgrades video for tiles that are small or not visible — load-bearing because the video panel is a ~300px column and is `display:none` in audio-only mode, so without it we decode full-size streams to paint thumbnails. `dynacast: true` stops publishing simulcast layers nobody subscribes to. `videoCaptureDefaults.resolution` is capped at `VideoPresets.h360.resolution` — the panel is far too narrow to show more, and 720p (the LiveKit default) costs several times the CPU for no visible gain. That cap is on the **camera** only; screen share has its own `screenShareEncoding` and stays full resolution, which is what you want for a shared worksheet. The other two entries are `publishDefaults` (mic hardware release, see above) and `reconnectPolicy` (the patient reconnect window). If someone reports lag returning, check these are still set before reaching for bigger changes. Audio is cheap by comparison — dropping voice to fix lag buys essentially nothing; drop or downgrade video instead (the welcome modal's "audio only" path already does).
- **Pen mode / palm rejection**: tldraw auto-enables `isPenMode` on first pointerType==='pen' event. We also expose an explicit `penOnly` setting that forces it on at mount.
- **Stroke thickness**: default size is `"s"` (small) — set via `editor.setStyleForNextShapes(DefaultSizeStyle, "s")` in `WhiteboardCanvas.onMount`. Users can still pick any size from the size picker. **TWO separate things set the rendered width, and both are overridden** — get them straight before tuning:
  1. **`STROKE_SIZES`** in `default-shape-constants.{js,mjs}` — the nominal width per size option. tldraw ships `{ s: 2, m: 3.5, l: 5, xl: 10 }`; we run **`{ s: 1, m: 2.5, l: 3.5, xl: 7 }`** — the whole ladder scaled for handwriting, since this is dense maths working rather than diagramming.
  2. **The `size` expression in the pressure settings** in `getPath.{js,mjs}` — what actually reaches perfect-freehand. `simulatePressureSettings` (finger/mouse) uses a bare `size: strokeWidth`, but `realPressureSettings` (the stylus path, so the Apple Pencil) shipped `size: 1 + strokeWidth * 1.2`. That `1 +` is a FIXED floor, so it fattens small sizes disproportionately — at the old `s: 1.5` it rendered **2.8**, nearly double the nominal. We now use **`size: 0.5 + strokeWidth`**, keeping a small floor so a hairline stays visible without the multiplier.

  Net effect at `"s"`: the Pencil went from an effective **2.8 → 1.5**. If someone asks for thinner or thicker strokes, change these two, not `thinning` (that is the pressure-contrast curve, and lowering it flattens the pen feel). Both are already-patched values, so **both must be changed in `scripts/cleanup-tldraw-patch.mjs`**, not just the patch — see the pen-feel note.
- **Pen feel tuning**: three layers, all targeting Apple Pencil latency + fountain-pen aesthetic.
  1. `editor.user.updateUserPreferences({ animationSpeed: 0 })` in `WhiteboardCanvas.onMount` (and the theme-applying useEffect) skips tldraw's default 1-frame ease on stroke commit. Strokes snap into place instead of fading in.
  2. `patches/tldraw+<version>.patch` rewrites `getFreehandOptions` constants in `getPath.{js,mjs}` for both `realPressureSettings` (stylus path, `isPen=true`) and `simulatePressureSettings` (finger/mouse fallback). Targets: `thinning` ~0.8 (strong pressure contrast), **`streamline: 0`** (see stabilisation note below), `smoothing` ~0.55. The SAME patch also sets `realPressureSettings`'s `size` to `0.5 + strokeWidth` (from tldraw's `1 + strokeWidth * 1.2`) and edits `default-shape-constants.{js,mjs}` to scale `STROKE_SIZES` down to `{ s: 1, m: 2.5, l: 3.5, xl: 7 }` — see the Stroke thickness note for how those two combine. **DO NOT re-add `start/end: { cap: true, taper: 25–30 }` to either pressure-settings function** — those tapered/capped ends triggered tldraw's per-shape error fallback (every draw shape rendered as an "Error" rectangle) on Apple Pencil Pro / iOS 18 because perfect-freehand couldn't generate a stable outline for the resulting stroke. If you want tapered ends back, upgrade tldraw + perfect-freehand first and re-test on a real iPad Pencil. Applied via `patch-package --partial` on every `npm install` (postinstall hook). **The `--partial` flag is load-bearing for CI**: Vercel caches `node_modules`, so when the patch FILE changes, a cached build has the OLD edits already applied but the NEW ones not — a mixed state that strict `git apply` can resolve neither forward (old hunks already applied) nor reverse (new hunks absent), hard-failing the build. `--partial` downgrades the already-applied hunks to warnings and still applies the new ones forward. Trade-off: a GENUINELY broken patch after a tldraw upgrade becomes a warning instead of a hard error, so the pen feel could silently revert — when upgrading tldraw, watch the install output and test drawing locally. **Critical caveat for shrinking the patch**: `patch-package` only applies forward, never reverses. If you REMOVE hunks (as we did for `start/end`), `--partial` on a cached `node_modules` will leave the removed lines stuck in place because there's nothing in the patch left to apply or undo. The first attempted workaround (a `prebuild` that did `npm install --no-save tldraw && patch-package`) failed on Vercel because `npm install <pkg>` mid-build, with `NODE_ENV=production` set, prunes devDependencies from `node_modules/.bin` — including `patch-package` itself, so the next step couldn't find its binary. Instead, the `prebuild` script now runs `node scripts/cleanup-tldraw-patch.mjs && rm -rf .next/cache`, a small idempotent Node script that normalises `getPath.{js,mjs}` AND `default-shape-constants.{js,mjs}` in both `dist-cjs` and `dist-esm` — **followed by clearing the Next.js webpack cache**. It does four passes: (1) strips any `start/end: { taper: N, cap: true }` lines if present; (2) forces `streamline: 0` in `realPressureSettings` + `simulatePressureSettings`; (3) forces `realPressureSettings`'s `size` to `0.5 + strokeWidth`; (4) rewrites the whole `STROKE_SIZES` object. Every pass is value-agnostic and idempotent, so it converges from any prior state — pristine, half-patched or fully patched. They all exist for the same reason as the taper strip: the patch's hunks carry tldraw's ORIGINAL values as context, so on a cached `node_modules` where an earlier patch already wrote our values, the hunk no longer matches, `--partial` downgrades it to a warning, and the stale value ships. **This is not hypothetical — it was observed firing on the `streamline` deploy**, whose Vercel log shows "Restored build cache", then `patch-package` writing to `patch-package-errors.log`, then this script doing the actual work. **Any change to an already-patched VALUE (not just a removed hunk) hits this trap — change it HERE, or it silently won't reach production.** Treat the patch as a convenience for fresh installs and this script as what actually guarantees production. No npm install dance, no binary lookups — just `fs.readFileSync` + `replace` + `fs.writeFileSync`. The `rm -rf .next/cache` is load-bearing on Vercel: webpack's persistent module cache is keyed on file content hashes that are computed BEFORE the prebuild edits the file, so without busting `.next/cache` webpack will happily serve the pre-cleanup compiled tldraw module out of cache even though the source on disk no longer matches — exactly the bug that made my "fix" not actually reach production for two deploys in a row. Becomes a logged no-op once the cache rebuilds cleanly. Leave it in place as a guard against both the cached-node_modules trap AND the webpack-cache trap. When tldraw upgrades: bump `tldraw@<version>` in the prebuild too, `rm -rf node_modules/tldraw && npm install` locally, re-edit BOTH files (`getPath` pressure settings AND `STROKE_SIZES.s`) in `dist-cjs` + `dist-esm`, then `npx patch-package tldraw` to regenerate.
  3. Per-stroke local rendering is unconditionally optimistic — tldraw renders the line as you draw before sync ack. Network RTT does not gate the visible stroke.
  4. **Pen stabilisation is OFF — `streamline: 0`.** `streamline` is perfect-freehand's input stabiliser: it interpolates the rendered point *toward* the raw input rather than at it, which smooths jitter but makes the ink visibly trail the pencil tip. tldraw ships `0.62`; we ran `0.4` (stylus) / `0.5` (finger) for a while, and both are now `0` so the stroke follows the raw input with no lag. Zeroed in **exactly two** blocks in `getPath.{js,mjs}` — `realPressureSettings` (stylus) and `simulatePressureSettings` (finger/mouse), which is what `getFreehandOptions` selects for `dash === "draw"`. Deliberately NOT zeroed: `getHighlightFreehandSettings` (the highlighter) and `solidSettings` / `solidRealPressureSettings` (the zoomed-out low-detail render path) — none of those are writing. `smoothing` (0.55) is untouched and is a *different* thing: it softens the rendered outline's corners, it does not delay the ink. If someone asks for stabilisation back, raise `streamline`, never `smoothing`. Trade-off to expect: strokes now show hand tremor and low-poll-rate stair-stepping that the stabiliser used to hide, most visibly with a finger or mouse rather than a Pencil.
- **Captions on iOS**: all iOS browsers — Safari, Firefox, Chrome, Edge — are WKWebView wrappers and have no reliable `webkitSpeechRecognition`. The host's own voice can't be transcribed from an iPad or iPhone. `CaptionsManager` detects this on captions-enable and fires a one-time toast pointing the user to desktop or Android Chrome. Other participants on supported browsers still see their own captions broadcast; the iOS user receives them. Don't try to "fix" this with a polyfill — the platform doesn't expose the API.
- **Captions performance**: caption state is held in `src/lib/captionsStore.ts`, NOT in RoomShell. Interim captions arrive 5-10× per second during active speech; if you put them into a top-level useState, every interim re-renders the whole room tree (header, drawers, etc.) and visibly degrades both perceived caption latency AND pen latency. New caption-adjacent UI should subscribe to the store via `useSyncExternalStore` (see `CaptionsHost.tsx`), not pass `captionLines` as props.
- **Upload validation is centralised** — all upload entry points (canvas drag-drop, Documents drawer, AttachmentPicker) call `validateFileForUpload` from `src/lib/fileValidation.ts` before the XHR fires. SVG is blocked at this layer (stored XSS risk via public CDN). Do not add a new upload path without importing and calling `validateFileForUpload` first, and use `getSafeMimeType` for the `Content-Type` header — never echo `file.type` directly to Supabase Storage.
- **PDF writing space**: when `settings.pdfWritingSpace` is on (default), uploading a PDF also drops a blank ruled "answer sheet" of the SAME page size directly to the right of each page, so students can write where a worksheet has no allocated answer space. Because the sheet reuses the page's `w`/`h` (which are PDF points), an A4 page → an A4 sheet automatically. The sheet is a self-contained `data:image/svg+xml;base64,…` URL built by `makeLinedSheetDataUrl(w,h)` and placed via `insertLinedSheet()` as a LOCKED image (students draw on top). It's a data URL, not an uploaded/CDN-served file, so the SVG-XSS rule in `fileValidation.ts` doesn't apply. Both PDF paths support it: `insertPdfAsImages` (canvas images — vertical layout puts sheets in a parallel right column; horizontal layout advances the per-page stride past page+sheet) and `insertPdfAsPageBackgrounds` (one tldraw page per PDF page — sheet sits at `x = w/2 + 40`, sent to back like the page background). Sheets of the same size share one hash-keyed asset.
- **Non-host default tool is hand**: in `WhiteboardCanvas.onMount` we call `editor.setCurrentTool("hand")` when `!isHost`. With `touch-action: none` on the canvas, a single-finger swipe goes to tldraw's gesture pipeline — defaulting students to the hand tool means a swipe pans rather than drawing a stray line. The host stays on `draw`. The student can still switch tools if they want to annotate.
- **Toolbar active state**: globals.css forces a brand-blue background + white icon for the selected tool button (`[aria-pressed="true"]` / `[data-state="selected"]`). tldraw's default light-mode highlight was too subtle.
- **Keyboard focus rings (a11y)**: globals.css has a global `:focus-visible` outline. The outline-suppression rule is scoped to `.tldraw-shell .tl-container *:focus-visible` (NOT `.tldraw-shell *`) on purpose: our custom canvas controls (ZoomControls, PagesTabBar, CanvasFloatingPanel) live in `.tldraw-shell` but OUTSIDE `.tl-container`, so they keep the keyboard focus ring while tldraw's own interaction layer stays clean. Don't re-broaden it back to `.tldraw-shell *` — that silently kills focus visibility on every custom canvas control. Icon-only header buttons whose visible label is `hidden sm:inline` (the "+ New page" and "Pages" controls) carry an explicit `aria-label` since the label is display:none (and thus absent from the a11y tree) on phones.
- **Leader mode UI**: when on, the host sees a yellow "LEADING VIEW" pill top-right of the canvas, AND the eye icon in the toolbar gets a filled amber background with white icon (vs. a thin amber outline before). Guests being followed see the existing "Following host" pill.
- **Geometric shape lockout**: the `tools()` override in `WhiteboardCanvas` clears the keyboard `kbd` field for `arrow`, `line`, `geo`, `text`, and `frame` so they're unreachable. They were already hidden from the SlimToolbar; this also kills the R/O/A/L/T/F shortcuts.
- **Shapes-per-page ceiling is raised — and the value is load-bearing.** `src/lib/tldrawOptions.ts` exports `TLDRAW_OPTIONS = { maxShapesPerPage: 1_000_000 }`, passed as the `options` prop to **every** `<Tldraw>` instance (the live `WhiteboardCanvas` and `PlaybackViewer`). tldraw's default is 4000; past it the editor silently refuses to create shapes and fires a `max-shapes` event, which in a dense handwriting lesson reads to the tutor as "the pen stopped working" (every stroke is a shape). Two reasons the value is a big finite number and not `Infinity`: (1) `maxShapesPerPage` doubles as a **z-index stride** — `getUnorderedRenderingShapes()` seeds `nextIndex = maxShapesPerPage * 2` and adds another `maxShapesPerPage` per background-providing nesting level, and those land in CSS `z-index`, a 32-bit signed int capped at 2,147,483,647, so `Infinity`/`MAX_SAFE_INTEGER` overflows it and breaks layering; (2) that same stride assumes a page never holds more shapes than `maxShapesPerPage` — exceed it and the background index range collides with the foreground range, so shapes layer wrongly. It is a true ceiling, not a hint: keep it comfortably above any real page's shape count. **Pass `TLDRAW_OPTIONS` to any new `<Tldraw>` you add** — an instance left on the 4000 default will mis-layer a recording or board that came from a room using the raised ceiling. Note this raises a limit, it does not make big pages fast: render cost and sync-worker snapshot size still scale with shape count, so a slow room is worth checking for shape count per page first. (tldraw's other default caps are untouched — notably `maxPages: 40`.)
- **Performance HUD (`PerfHud.tsx`)**: diagnostic overlay for "the board feels laggy", which has at least three causes that are indistinguishable by feel — input latency, per-frame main-thread work, and shape-count scaling. Shows live fps, worst frame time, input→frame latency, rendered-vs-total shapes on the page, and long-task count. Enabled by `settings.perfHud` (Settings → Whiteboard) **or** `?perf=1` on the room URL — the latter is how you switch it on from an iPad mid-lesson without opening Settings. Lazy-loaded via `dynamic()` and only rendered when on, so its chunk never enters the room bundle otherwise (verify with `grep -rl "Copy reading" .next/static/chunks/app/r/` — it must NOT be in the room page chunk). Deliberately cheap while running, because an instrument that perturbs what it measures is useless: all accumulation is in refs inside one rAF loop, React state is written at 2 Hz and only re-renders the HUD itself (it is a SIBLING of the canvas, never a parent), the pointer listener is `passive` + capture and only assigns a timestamp, and shape counts come from tldraw's cached computed getters (`getCurrentPageShapeIds` / `getCulledShapes`) rather than a DOM walk. **Read "input→frame" honestly**: it measures pointer-event → next-frame-start, which is the portion the app controls; it EXCLUDES compositor and display time, so real pen-to-pixel latency is always higher. It is for spotting regressions and comparing configurations, never for claiming parity with a native app. `longtask` is Chromium-only — Safari (so every iPad browser) shows "n/a" there, which is expected, not a bug.
- **Two-finger scroll & touch**: `.tldraw-shell` sets `touch-action: none` + `overscroll-behavior: contain` + `-webkit-user-select: none` + `-webkit-touch-callout: none` + a fallback `touch-action: none` on every nested `.tl-container` / `.tl-canvas` / `canvas` (Firefox sometimes ignores the parent value). `userScalable: false` in the viewport meta lets two-finger gestures reach tldraw's pan/zoom code instead of zooming the whole page.
- **Supabase "Confirm email" must be OFF** for password sign-up to work — we use synthetic `@a-worthy.local` emails that can't receive mail. Set in Supabase Dashboard → Authentication → Providers → Email → Confirm email → toggle OFF.
- **Guests don't sign up**. Anyone with a room link can join: they land on `/r/<roomId>`, see the `GuestNameEntry` form (or skip it if they have a remembered name), then KnockGate creates a `join_requests` row and waits for the host to Admit. The host sees an `AdmissionPanel` floating top-right + a toast for every new knocker.
- **Admission is persistent per (room, user_id)**. KnockGate now reads-then-conditionally-inserts: if a row already exists for this device it preserves the status (admitted → straight in, pending → still waiting, denied → stays denied). An older version unconditionally upserted 'pending', which clobbered admitted rows on every visit and effectively required re-admission every time. If you re-introduce an upsert here, use `ignoreDuplicates: true` or read first — never overwrite without intent.
- **Magic invite links** (`/api/invite/mint` + `/api/invite/redeem`). Host-only feature in InvitePanel: generates an HS256 JWT signed with `WORKER_SHARED_SECRET` containing `{ kind: "invite", roomId, exp }`. Default 90-day expiry. Mint is gated by Supabase session — the caller must present a Bearer token that resolves to the `rooms.host_user_id` for this room (so localStorage-only hosts can't mint until they claim the room to their account in Settings). Redeem is anonymous + token-gated: any guest opening `/r/<roomId>?invite=<token>` has the token verified, then their `join_requests` row is upserted to admitted. KnockGate detects the `invite` URL param and calls redeem before the normal knock flow. Invite tokens deliberately OMIT the `userId` claim so the Cloudflare worker's `verifySyncToken` (which requires both `roomId` and `userId`) won't accept them as sync tokens — leaking an invite link only grants the right to redeem into the knock flow, not direct whiteboard sync. There's no server-side revocation list; rotate `WORKER_SHARED_SECRET` to invalidate all outstanding invites. **`SUPABASE_SERVICE_ROLE_KEY` must be set in Vercel** — the redeem route uses it to bypass the RLS UPDATE policy; if the var is missing the route hard-fails with 500 (deliberately, not a silent fallback).
- **Zoom UI is custom**. tldraw's default `MenuPanel` (which holds its ZoomMenu) AND its `NavigationPanel` (the native zoom/minimap pill) are both nulled in our `components` override, so we render our own `ZoomControls` bottom-left (was bottom-right; moved so the video panel doesn't cover it). If `NavigationPanel` is ever un-nulled you get TWO zoom pills stacked bottom-left — that was the "duplicate zoom panel" bug.
- **PWA orientation lock**: `public/manifest.webmanifest` sets `"orientation": "portrait"`. This is honoured for installed PWAs on Android Chrome; iOS Safari ignores it for non-installed sessions.
- **PWA icons**: `public/icon.svg` is a vector recreation of the A Worthy brand mark — the arched A with the `+` inside, sitting above the W swoosh — drawn in `#2c5c8c` on a transparent field. The PNG set (`public/icon-{152,167,180,192}.png`, `public/icon.png` at 512, and the Next.js favicon source `src/app/icon.png`) is regenerated from that SVG via sharp (`~15` lines; see commit `7f81a18` for the original script pattern) and stays transparent across the board. iOS doesn't read the manifest icon list reliably on first install, so `src/app/layout.tsx` adds explicit `<link rel="apple-touch-icon" sizes="...">` tags for 152/167/180 so Safari picks the right one. **Maskable is a separate file**: `public/icon-maskable.png` is the same mark composited onto a white 512×512 background, and the manifest's `purpose: "maskable"` entry points at it (not `icon.png`). Transparent maskable icons fail the Android spec — the safe-zone has no fill, so the launcher composites the mark onto whatever system background the user's phone happens to use. Don't re-collapse the maskable entry back into `icon.png`. When regenerating from the SVG, output the transparent variants AND composite the SVG over a white 512×512 square for `icon-maskable.png`.
- **Fonts: Nunito is the ONLY family, and an unused `next/font` variable is a preload, not a no-op.** `layout.tsx` used to also load Caveat (`--font-hand`) and JetBrains Mono (`--font-mono`), but nothing ever rendered in either: every Tailwind family maps to `--font-sans`, and `globals.css` forces Nunito on `*` plus tldraw's `--tl-font-*` and LiveKit's `--lk-font-family`. Because `next/font` preloads by default and both `variable` classes were on `<html>`, every page load fetched ~103 kB of woff2 for type that never appeared on screen. Both were removed. If a second family is ever genuinely wanted, add it back **and** give it a real consumer.
- **Three kinds of brand asset, and they are not interchangeable.** `public/logo-wordmark.png` is the horizontal "A-Worthy Education" lockup (919×220, ~4.18:1, transparent) used for *display* via `BrandLogo variant="wordmark"`. `public/sticker-*.webp` are the mascot stickers, rendered through `Sticker.tsx` (see its component note) and by `CanvasWatermark` (see its own note below) — they are decorative and carry their own copy of the company name, so never pair one with brand text or use one as an icon. `public/icon.png` + the `icon-*` set is the square app icon and is **now generated from the heart mascot sticker** (caption cropped off), not the old navy arch-and-swoosh — changed on request so the Chrome/PWA icon matches the sticker branding. It is what every square slot uses: PWA manifest icons, the favicon (`src/app/icon.png`), apple-touch-icons, the `AdmissionPanel` notification icon, and `insertBrandLogo` (the "Insert A Worthy logo" command, which stamps a 200×200 image shape). **`public/icon.svg` is the OLD navy mark and is no longer referenced by the manifest** — it was removed from the icon list because Chrome prefers a scalable SVG over PNGs, which would have silently kept serving the old logo. The file itself is deliberately left on disk because `sw.js` lists it in `SHELL_ASSETS` and `cache.addAll` rejects the whole service-worker install if any entry 404s; don't delete it without also editing `sw.js` and bumping the cache bucket names. `CanvasWatermark` is NOT a square slot — it's the faded backdrop behind the canvas, and it renders TWO things: the **wordmark** centred at `width: min(55vw, 680px)` with `height: auto` (so the 4.18:1 aspect holds; setting both axes, as it did with the square mark, letterboxes the lockup inside a square and wastes most of the box), plus the four **mascot stickers** inset at 12%/15% from the corners. Phones get a DIAGONAL PAIR (avocado top-left, ice cream bottom-right) at `h-[68px]` with tighter 6%/10% insets; `md:` and up gets all four at `h-[120px]`. An earlier version hid every sticker below `md`, which meant **phones showed no stickers at all** — that was the reported bug. Note the height is set with Tailwind classes, NOT an inline `style`, because an inline height cannot carry a media query. Opacity is **0.14 for stickers and 0.16 for the wordmark**, raised from the first pass (0.10/0.14) which was too faint to register on a bright tablet screen because saturated colour reads heavier than grey text at equal alpha. They're inset rather than flush to the corners because every canvas corner already has UI (LeftRail, CanvasFloatingPanel, ZoomControls, PagesTabBar, ChatBubble) and a sticker tucked under a control just looks like a smudge.
- **The mascot stickers were keyed from white JPEGs, and the method matters.** The source art was 400×400 JPEG with a hard white background and NO alpha. A naive "white → transparent" key guts the character, because the mascot's own body is white; and a plain border flood-fill leaks through gaps in the hand-drawn outline — that cost the ice-cream sticker 53% of its body on the first attempt. The working recipe (in the scratchpad script, not committed): build a wall mask at luminance < 250, **dilate it ~2px to seal outline gaps**, flood-fill from the border over non-wall pixels, then **regrow the background ~2px across near-white pixels only** so the edge lands back where it belongs (regrowth can't cross the outline, which is darker than the regrow threshold), and finally feather residual JPEG fringe. Output is WebP (`quality: 82, alphaQuality: 90`) at 240px tall — PNG was 3-6× larger for this paper-textured art, and 240px is 2× the 120px display size, which is ample at 10% opacity. If more stickers are added, reuse that recipe and **verify by compositing over a saturated colour** — a white halo or a leaked body is invisible against the app's own near-white canvas. **Regenerating the app icons**: they come from the heart sticker's source JPEG via the same keying recipe, then the caption is cropped off at a FIXED fraction (`H * 0.74`). Do not try to auto-detect the caption by scanning for a blank row — the decorative sparkles bridge every row between mascot and caption, so there is no gap to find, and a detector silently picks the bottom margin instead. Art is fitted to 76% of a 512 square (transparent) for the normal icons and 62% for `icon-maskable.png` (white ground, inside the maskable safe zone). **Known trade-off, accepted on request**: the mascot is tall and narrow, so below ~32 px the app icon reads as a blob where the old navy mark stayed crisp. If favicon legibility matters more than brand match, the old mark is still in git history.
- **PWA install banner**: `PwaInstallBanner.tsx` listens for `beforeinstallprompt` (Android Chrome only — iOS Safari doesn't fire this) and persists dismissal in `wb_pwa_install_dismissed`. iOS users install via Share → Add to Home Screen.
- **Service worker caching strategy**: `public/sw.js` runs two cache buckets. `wb-static-v2` is cache-first for `/_next/static/*` (content-hashed by Next so safe-to-cache-forever) — every PWA cold launch after the first boots from cache, dropping startup ~1s. `wb-shell-v2` is stale-while-revalidate for `manifest.webmanifest` + `icon.svg`. Everything else (HTML routes, API calls, Supabase, LiveKit, sync worker) is network-only — no risk of a stale room shell or stale auth token. If you change the cache schema, bump both bucket names (`-v2` → `-v3`); the `activate` listener sweeps any older bucket.
- **Notch / Dynamic Island**: `viewport: { viewportFit: "cover" }` in `layout.tsx` lets the canvas paint behind the iPhone X+ cutout in landscape PWA mode. Interactive UI stays clear via `safe-area-inset-*` paddings in `globals.css`.
- **No horizontal scroll**: `html, body { overflow-x: hidden; max-width: 100vw; }` in `globals.css` keeps the room shell from sliding sideways even if a child overflows. tldraw's canvas still pans freely because it sets its own touch-action and is inside an `inset-0` container.
- **Header is two rows on md+**: row 1 = Documents / Homework / Recordings / Record; row 2 = Export / Invite / Hide-video / Settings. Mobile collapses both rows into the existing kebab/hamburger menu.
- **`/auth/callback` is a no-op stub** now that magic-link auth is gone. Don't remove it — it's wrapped in `<Suspense>` and harmless if hit, and password reset / OAuth could re-use it later.
- **Annotation stamp and draw-grant students**: `WhiteboardCanvas.onMount` stamps every new shape with `meta.annotation = !isHostRef.current && userId !== drawGrantUserIdRef.current`. The draw-grant exclusion means shapes drawn by a student the host has promoted to draw are NOT tagged as annotations and will NOT be hidden by "Hide student work". If you change the stamping logic, preserve this exclusion — the whole point of draw-grant is to have the student's work visible alongside the host's.
- **Shape authorship stamp**: every shape also gets `meta.authorId = userId` (alongside `meta.annotation`). This is what the "Clear my work" button in CanvasFloatingPanel uses to find and delete only the current student's shapes. If you change the stamping logic in `registerBeforeCreateHandler`, preserve BOTH fields.
- **Sticky notes are eraser-immune AND host-uploaded assets are non-host-delete-immune**: `WhiteboardCanvas.onMount` registers ONE `registerBeforeDeleteHandler("shape", …)` that vetoes two distinct delete paths. (1) Sticky notes: returns `false` when `source === "user"` AND `shape.type === "note"` AND `editor.getCurrentToolId() === "eraser"`, so a stray eraser stroke can't wipe a note's content; notes are removed deliberately via select + the DeleteSelectionButton pill or Backspace instead. (2) Uploaded documents: returns `false` when `source === "user"` AND `shape.meta?.uploadedDocument === true` AND `!isHostRef.current`, so a student can't accidentally (or deliberately) delete any host-placed asset by any means — select-all + Backspace, eraser sweep, command-palette delete, drag-drop replace, anything. The host can still delete (`isHost = true` bypasses the second veto). Both vetoes share one handler and an early-return `if (source !== "user") return` for remote deletes — that's load-bearing for sync consistency (a host's delete arrives on every other client as `source === "remote"` and must be allowed to propagate or the canvas diverges). The `meta.uploadedDocument: true` marker is stamped at insert time in every host-side canvas insertion path: `runUpload` (direct drag-drop / paste / "Upload" action), `insertPdfAsImages` (PDF page sequence), `insertPdfAsPageBackgrounds` (one-page-per-PDF-page layout), `insertLinedSheet` (the writing-space sheet beside PDFs), `insertBrandLogo`, and `PagesTabBar`'s page-template background. Most of those also set `isLocked: true` for the natural-UX guard (locked = can't be selected/moved); `runUpload` and `insertBrandLogo` had `isLocked: true` added in the same change. **If you add a new canvas insertion path, stamp `meta: { uploadedDocument: true }` (and set `isLocked: true`) at `createShape` time** or the new shape will be deletable by students. The handler runs per-record, so a student erasing a stroke that crosses a locked PDF page still deletes the stroke. tldraw adds the locked shape to the eraser's "erasing" set mid-drag (it dims), then restores it on release — that transient fade is expected, not a bug. Deregister this handler alongside the create handler in onMount's cleanup.
- **"Bring everyone here" uses Supabase Realtime, not LiveKit**: the host triggers it from the LeftRail (desktop) or the mobile "More" menu — both call `broadcastViewport` via `bringEveryoneRef` (the openUploadRef-style ref WhiteboardCanvas assigns on mount). It sends the current viewport bounds over Supabase Realtime Broadcast channel `vp-{roomId}`. Guests subscribe in a useEffect in WhiteboardCanvas and call `editor.zoomToBounds` when a `vp` event arrives. This avoids needing access to the LiveKit room context from outside the LiveKitRoom tree. Don't switch it to LiveKit data channel without threading the send function all the way up to WhiteboardCanvas. (It used to be a floating pill in CanvasFloatingPanel; moved off-canvas to declutter the top + avoid colliding with the centred timer on phones.)
- **Desktop/mobile drawing controls split**: LeftRail owns the color and size pickers on desktop (md+). The same pickers inside CanvasFloatingPanel carry `md:hidden` so they're only visible on mobile. If you add a new drawing style control, add it to BOTH LeftRail AND CanvasFloatingPanel (with `md:hidden`), keeping parity between breakpoints.
- **RecordButton paused-state stop**: the screen-share track's `ended` event now checks `state === "recording" || state === "paused"` before calling `stop()`. If you see a UI deadlock where the recorder appears stuck after the user stops sharing mid-pause, re-check this guard.
- **LessonTimer expiry**: the 250 ms tick interval self-clears when `computeRemaining(timer) <= 0`. Nobody writes `timer_running=false` to the DB when the client clock hits zero (the timer just shows "Time's up"), so without the self-clear the interval would fire indefinitely. `addMinute` is capped at 480 minutes remaining so values stay well below the PostgreSQL `INTEGER` overflow boundary.
- **LessonTimer clock**: the widget also shows a live current-time readout in Singapore time (GMT+8) via `Intl.DateTimeFormat({ timeZone: "Asia/Singapore" })`, ticked by its own always-on 1 s interval (`now` state). The clock is shown to everyone (host + students), even when no countdown is set — so the idle-state early-return for students was removed. On phones the clock is `hidden sm:block` while a countdown is ACTIVE so the running pill + host controls don't overflow a narrow viewport.
- **Header dropdown z-order vs the timer**: the centred LessonTimer (`absolute top-3 left-1/2 z-[80]`) and the header dropdowns live in the SAME (root) stacking context — the `<header>` is static (its `z-10` is inert) and the canvas-area wrappers are `relative` with no z-index, so neither creates a context. That means the header popovers must use a literal z **above 80** or the timer paints over them. The Pages dropdown, desktop "More" menu and mobile menu are therefore `z-[90]` (a regression to `z-50` reproduces the bug where the centred clock/Timer covers the open Pages dropdown on a narrow iPhone). Keep them below the AdmissionPanel (`z-[100]`) and the modals (`z-[10000]+`).
- **Free tiers**: Supabase Storage 1 GB, LiveKit 10k participant-min/month. The Recordings drawer shows a host-only `StorageMeter` at the top: it sums `size_bytes` across ALL `room_recordings` rows (account-wide, not just the open room) and bars it against `FREE_TIER_BYTES` (1 GB), turning amber at 70% and red at 90%. It refreshes on open and on this room's realtime changes. Note the 1 GB is shared with the `whiteboard-assets` bucket (uploaded docs/images), so the meter is an under-estimate of total Storage — it tracks the dominant consumer (videos).
- **ChatBubble draft restore**: `send()` clears `draft` before the Supabase insert, then re-sets it to the original text if the insert fails so the user doesn't silently lose a composed message. If you touch the send path, preserve this order — clearing first is correct UX (immediate feedback), but the error path must restore the value.
- **Lesson recap (End lesson)**: `EndLessonModal` fetches `room_homework` + `room_recordings` for the room, passes them to `exportLessonPdf` as a `summary` (prepends a text cover page: title/date/host + homework + recordings titles), and posts a multi-line chat recap (PDF link + recording links + homework). The chat message relies on ChatBubble's `whitespace-pre-wrap` for the newlines; recording URLs are plain copyable text (not auto-linkified, consistent with existing chat). The PDF cover page intentionally omits the long recording URLs (titles only) to keep the layout predictable — links live in the chat recap. `downloadAllPagesPdf` (command palette) calls `exportLessonPdf` WITHOUT a summary, so it stays a pages-only export.
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
    The values all live in `scripts/cleanup-tldraw-patch.mjs`, so the upgrade is:
    `rm -rf node_modules/tldraw && npm install`, run `node scripts/cleanup-tldraw-patch.mjs`
    (it rewrites the new version's files to our values — `thinning: 0.82/0.7`,
    `streamline: 0`, `smoothing: 0.55`, `size: 0.5 + strokeWidth`, and
    `STROKE_SIZES { s: 1, m: 2.5, l: 3.5, xl: 7 }`), then `npx patch-package tldraw`
    to regenerate the patch from that state. Don't hand-edit the patch file —
    changing a context line into a +/- pair shifts the hunk headers and is easy to
    get wrong; let the script produce the state and patch-package capture it. **Do NOT re-add `start/end: { cap: true,
    taper: 25–30 }`** — those tapered/capped ends crashed every draw shape on Apple
    Pencil Pro / iOS 18 (perfect-freehand couldn't generate a stable outline). If
    you want them back, upgrade perfect-freehand alongside tldraw and re-test on a
    real iPad Pencil first. Delete the old patch file and commit the new one.
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
19. **Icons: use `@phosphor-icons/react` everywhere.** Don't hand-roll inline
    `<svg>` icon components or use emojis for UI icons — both break visual
    consistency (mismatched stroke weight; emojis render per-OS). The header
    controls and the PagesTabBar template menu were converted from ad-hoc SVGs /
    emojis to Phosphor; keep new icons on Phosphor at a matching size + `aria-hidden`.
    Phosphor icons are individually tree-shaken but still add ~0.4 kB each to the
    room bundle (currently ~197 kB First Load, budget 200 kB) — be mindful near the cap.
    The remaining emoji in the codebase are **content, not icons**, and are meant to
    stay: `VideoPanel`'s `REACTIONS` (👍 ❓ 🎉 are literally emoji reactions),
    `HomeworkDrawer`'s `FEEDBACK_PRESETS` (✓ / ⭐ are text the student receives),
    the `EndLessonModal` chat recap, and ChatBubble's "Say hi 👋" copy. The ones
    that WERE icons — OnboardingHint's four bullets, `PlaybackViewer`'s error
    glyph, `DocumentsDrawer`'s group-header folder — are now Phosphor.
20. **Landing page background is deliberately not `--bg`.** `src/app/page.tsx` sets an
    inline `background` on `<main>`: a soft `--accent-soft` radial bloom over
    `--canvas` (the warm cream paper tone). Both `--bg` and `--bg-elev` are
    `#ffffff`, so on the default background the landing card had nothing to sit on
    and read as a seam rather than a surface. Pure CSS gradients — no image, no
    added bytes. Don't "simplify" it back to `bg-[var(--bg)]`.
