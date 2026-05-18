# Whiteboard

A live, collaborative whiteboard with document upload and video/audio calling — built like Lessonspace.

- **Whiteboard**: [tldraw](https://tldraw.dev) with multiplayer sync (Apple Pencil / stylus pressure works natively in iPad Safari).
- **Document upload**: drop in PDFs or images. PDFs are rendered to one image per page and placed on the canvas. Files are stored in Supabase Storage.
- **Video / audio / screen share**: [LiveKit](https://livekit.io) — bring your own LiveKit Cloud project or self-host.
- **Real-time sync**: a tiny WebSocket sync server using `@tldraw/sync-core`. Snapshots persist to Supabase Storage so canvases survive restarts.
- **Auth + storage + DB**: [Supabase](https://supabase.com).

## Project layout

```
src/app
  page.tsx                  Landing / room launcher
  r/[roomId]/page.tsx       Room route
  api/livekit/token/route.ts  Issues LiveKit JWTs server-side
  api/uploads/route.ts      Uploads files to Supabase Storage
src/components
  RoomShell.tsx             Layout — canvas + video panel
  WhiteboardCanvas.tsx      tldraw canvas + multiplayer + uploads
  VideoPanel.tsx            LiveKit video grid + controls
sync-server/server.mjs      Standalone tldraw sync WebSocket server
supabase/setup.sql          One-time storage bucket bootstrap
```

## Setup

### 1. Install

```bash
npm install
cp .env.example .env.local
```

### 2. Supabase

1. Create a project at https://supabase.com.
2. From Settings → API, copy:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server only)
3. Open the SQL editor and run [`supabase/setup.sql`](./supabase/setup.sql). This creates the
   `whiteboard-assets` (public) and `whiteboard-snapshots` (private) buckets.

### 3. LiveKit

1. Create a free project at https://cloud.livekit.io (or self-host).
2. Copy the websocket URL, API key, and secret into `.env.local`:
   - `NEXT_PUBLIC_LIVEKIT_URL` (e.g. `wss://your-project.livekit.cloud`)
   - `LIVEKIT_API_KEY`
   - `LIVEKIT_API_SECRET`

### 4. Run it

You need two processes: the Next.js app and the tldraw sync server.

```bash
npm run dev:all
```

Or in separate terminals:

```bash
npm run dev       # Next.js on http://localhost:3000
npm run dev:sync  # tldraw sync on ws://localhost:5858
```

Then visit http://localhost:3000, create a room, and share the URL with another browser/tab/device.

## Apple Pencil / stylus

tldraw uses Pointer Events with pressure detection, so on iPad Safari / iPadOS the Apple Pencil
works out of the box — including pressure sensitivity on the draw tool. We disable browser
gestures (`touch-action: none`) on the body so palm-rejection works while you draw.

## Production

- **Web app**: `npm run build && npm start` — host on Vercel, Fly.io, etc. Set the env vars from `.env.example`.
- **Sync server**: any Node host (Fly.io, Render, a VPS). It exposes port `5858` over WebSocket.
  Point `NEXT_PUBLIC_TLDRAW_SYNC_URL` at its `wss://` URL. Give it the same Supabase service-role
  key so it can persist snapshots.

## Roadmap / nice-to-haves

These aren't built yet, but the architecture supports them:

- Supabase Auth (sign-in, room ownership, persistent user identity).
- Per-room PDF/file list panel (currently files are dropped onto the canvas).
- Recording (LiveKit's egress API can record the whole room to S3).
- iOS/Android wrapper via Capacitor.
