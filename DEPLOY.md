# Deployment

Four free-tier services. All wiring already done; you only need to click a few times.

| Piece                | Where                    | Auto-deploys on push? |
| -------------------- | ------------------------ | --------------------- |
| Next.js app          | Vercel                   | yes (Git integration) |
| Sync server          | Cloudflare Workers + R2  | yes (GitHub Action)   |
| Database + Storage   | Supabase                 | one-time SQL run      |
| Video / audio        | LiveKit Cloud            | n/a (managed)         |

## Your todo list

### A. Enable Cloudflare R2 (one time, ~30 sec)

R2 needs to be turned on before the Worker can use it. Open
https://dash.cloudflare.com/ → R2 in the left nav → **Enable R2**. It's free
under 10 GB; Cloudflare requires a card on file but won't charge you for this
app's traffic.

### B. Add 2 secrets to GitHub (~1 min)

GitHub repo → **Settings → Secrets and variables → Actions → New repository
secret**. Add both:

| Name                     | Value                                  |
| ------------------------ | -------------------------------------- |
| `CLOUDFLARE_API_TOKEN`   | the token you generated for me earlier |
| `CLOUDFLARE_ACCOUNT_ID`  | `8224de7cd8f3279895c8590d73f10c27`     |

Once added, the **Deploy sync worker** workflow runs on the next push to your
branch and deploys the Worker. (It'll print the live URL in the workflow log,
something like `https://whiteboard-sync.<your-subdomain>.workers.dev`.)

### C. Connect Vercel to GitHub (~3 min)

1. Open https://vercel.com/new
2. **Import** the `aworthysg/whiteboard-` repo. Framework preset: Next.js (auto-detected).
3. Production branch: `claude/whiteboard-collaboration-app-44GFP` (or merge to `main` first).
4. Expand **Environment Variables** and paste these seven. The values are in
   the chat where you set up the project; do not commit them to the repo.

   ```
   NEXT_PUBLIC_SUPABASE_URL=<from chat>
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<from chat>
   NEXT_PUBLIC_LIVEKIT_URL=<from chat>
   LIVEKIT_API_KEY=<from chat>
   LIVEKIT_API_SECRET=<from chat>
   NEXT_PUBLIC_TLDRAW_SYNC_URL=wss://whiteboard-sync.<your-subdomain>.workers.dev
   ```

   For `NEXT_PUBLIC_TLDRAW_SYNC_URL`, use the URL the GitHub Action printed in
   step B. (If you deploy Vercel first with a placeholder, just edit the env
   var and redeploy after the Worker is up.)

5. **Deploy**. You get a `https://...vercel.app` URL.

### D. Smoke test

1. Open the Vercel URL on your laptop.
2. Create a room, copy the invite link, open it on your iPad in Safari.
3. Draw with the Pencil. Talk over video. Upload a PDF.

## Local development

```bash
npm install
cp .env.example .env.local      # fill in keys
npm run dev:all                 # Next on :3000, wrangler dev on :5858
```

## Architecture notes

- The sync server lives on Cloudflare Workers because Vercel's serverless model
  doesn't support long-lived WebSocket connections. Each room is a Durable
  Object instance; snapshots persist to R2.
- The Next.js upload route uses Supabase's `anon` key + an RLS insert policy
  scoped to the `whiteboard-assets` bucket, so no `service_role` key is needed.
- LiveKit tokens are minted server-side in `/api/livekit/token` so the secret
  never reaches the browser.
