# Whiteboard

A live, collaborative whiteboard with document upload, video/audio calling, homework, and lesson recording — designed for a solo tutor.

> **Deploying?** Follow the step-by-step walkthrough in [DEPLOY.md](./DEPLOY.md).
> **Architecture & operational notes:** [CLAUDE.md](./CLAUDE.md) is the source of truth.

- **Whiteboard**: [tldraw](https://tldraw.dev) with multiplayer sync (Apple Pencil / stylus pressure works natively in iPad Safari).
- **Document upload**: drop in PDFs or images. PDFs are rendered to one image per page and placed on the canvas. Files are stored in Supabase Storage.
- **Video / audio / screen share**: [LiveKit](https://livekit.io) Cloud (or self-host).
- **Real-time sync**: tldraw's `TLSocketRoom` running inside a Cloudflare Worker + Durable Object. Snapshots persist in the DO's own SQLite (chunked at 96 KiB) — no R2 needed.
- **Auth + storage + DB**: [Supabase](https://supabase.com). The app uses only the anon key; RLS handles authorization.

## Project layout

```
src/app
  page.tsx                    Landing / room launcher
  r/[roomId]/page.tsx         Room route
  api/livekit/token/route.ts  Issues LiveKit JWTs server-side
  api/math/route.ts           Renders LaTeX to SVG via KaTeX
  api/uploads/route.ts        Fallback upload proxy (clients now POST direct to Supabase)
src/components
  RoomShell.tsx               Layout — canvas + video panel + drawers
  WhiteboardCanvas.tsx        tldraw canvas + multiplayer + uploads
  VideoPanel.tsx              LiveKit video grid + controls
sync-worker/                  Cloudflare Worker: TLSocketRoom in a Durable Object,
                              snapshots persisted in DO SQLite
supabase/setup.sql            One-time storage bucket + schema bootstrap
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
3. **No `service_role` key is needed** — the app uses anon + RLS for everything (auth sign-in, file uploads, DB writes).
4. In Authentication → Providers → Email, turn **Confirm email OFF**. Accounts use synthetic `<username>@a-worthy.local` emails that can't receive mail.
5. Open the SQL editor and run [`supabase/setup.sql`](./supabase/setup.sql) to create the buckets, tables, RLS policies, and realtime publication.

### 3. LiveKit

1. Create a free project at https://cloud.livekit.io (or self-host).
2. Copy into `.env.local`:
   - `NEXT_PUBLIC_LIVEKIT_URL` (e.g. `wss://your-project.livekit.cloud`)
   - `LIVEKIT_API_KEY`
   - `LIVEKIT_API_SECRET`

### 4. Cloudflare Worker (sync server)

The sync worker lives in `sync-worker/`. For local dev it runs via `npx wrangler dev`. For production, push to `main` and the GitHub Action in `.github/workflows/deploy-worker.yml` deploys it (needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repo secrets).

Point `NEXT_PUBLIC_TLDRAW_SYNC_URL` at the deployed `wss://` URL.

### 5. Run it

```bash
npm run dev:all       # Next.js (:3000) + wrangler dev for the sync worker
```

Or in separate terminals:

```bash
npm run dev           # Next.js on http://localhost:3000
npm run dev:sync      # wrangler dev for the sync worker on :5858
```

## Apple Pencil / stylus

tldraw uses Pointer Events with pressure detection, so on iPad Safari / iPadOS the Apple Pencil
works out of the box — including pressure sensitivity on the draw tool. We disable browser
gestures (`touch-action: none`) on the body so palm-rejection works while you draw.

## Production

- **Web app**: deployed to Vercel from `main`. See [DEPLOY.md](./DEPLOY.md).
- **Sync server**: Cloudflare Worker, auto-deployed on push to `main` touching `sync-worker/**`.
- **DB / storage / auth**: managed Supabase (region `ap-southeast-1`).

## Roadmap

See the "Watch-outs for future changes" section of [CLAUDE.md](./CLAUDE.md).
