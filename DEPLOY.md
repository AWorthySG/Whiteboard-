# Deployment

Four free-tier services:

| Piece                | Where             |
| -------------------- | ----------------- |
| Next.js app          | Vercel            |
| Database + Storage   | Supabase          |
| Video / audio        | LiveKit Cloud     |
| tldraw sync server   | Cloudflare Workers + R2 |

The sync server lives on Cloudflare Workers because Vercel's serverless model
doesn't support long-lived WebSocket connections. Workers + Durable Objects
fit the per-room sync pattern natively and stay on the free tier indefinitely
for hobby use.

## Quick start

```bash
# Next.js app
npm install
cp .env.example .env.local      # fill in keys

# Sync worker
cd sync-worker
npm install

# In sync-worker: log into Cloudflare and deploy.
npx wrangler r2 bucket create whiteboard-snapshots
npx wrangler deploy

# Back at the repo root: run the app
npm run dev:all
```

See `sync-worker/wrangler.toml` for the Worker config (Durable Object + R2 binding).

## Provisioning each service

### Supabase

Run `supabase/setup.sql` in your project's SQL editor. It creates one public
bucket (`whiteboard-assets`) and a policy that lets anyone upload + read. The
Next.js app talks to Supabase Storage with only the `anon` key — no
`service_role` needed.

Required env vars (both `NEXT_PUBLIC_` since the upload route is in the Next.js
server and we use the publishable key only):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### LiveKit Cloud

https://cloud.livekit.io → create project → Settings → Keys.

- `NEXT_PUBLIC_LIVEKIT_URL` — `wss://your-project.livekit.cloud`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`

### Cloudflare Worker

Two ways to authenticate `wrangler`:

1. **OAuth (local laptop):** `npx wrangler login` → opens your browser.
2. **API token (CI / cloud):** create a token at
   https://dash.cloudflare.com/profile/api-tokens with the "Edit Cloudflare
   Workers" template, then `export CLOUDFLARE_API_TOKEN=...`.

Then from `sync-worker/`:

```bash
npx wrangler r2 bucket create whiteboard-snapshots
npx wrangler deploy
```

The deploy URL prints at the end (e.g. `https://whiteboard-sync.<account>.workers.dev`).
Convert it to `wss://...` and set it as `NEXT_PUBLIC_TLDRAW_SYNC_URL`.

### Vercel

Push the repo to GitHub. `vercel.com` → New Project → import the repo → set the
seven env vars from `.env.example` → deploy.

## Local development

You need both the Next.js app and the sync Worker running locally.

```bash
npm run dev:all      # web on :3000, worker on :5858 (via wrangler dev)
```
