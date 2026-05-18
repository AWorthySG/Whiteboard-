# Deployment walkthrough

You'll deploy four things, all on free tiers. Plan for ~25–30 minutes.

| Piece                | Where        | Why                                                          |
| -------------------- | ------------ | ------------------------------------------------------------ |
| Next.js app          | Vercel       | Free, instant deploys from GitHub                            |
| Database + Storage   | Supabase     | Free Postgres, file storage, auth                            |
| Video / audio        | LiveKit Cloud| Free 10k participant-minutes / month                         |
| tldraw sync server   | Render       | Free Node host. Vercel can't run persistent WebSockets       |

> Render's free tier sleeps after 15 min idle and takes ~30s to wake. Fine for a
> demo; upgrade to the $7/mo Starter plan once you're using it for real.

---

## 1. Supabase (5 min)

1. Sign up at **https://supabase.com** with GitHub.
2. Click **New project**. Pick any name and region. Save the database password
   somewhere (you won't need it for this app, but Supabase makes you set one).
3. Wait ~2 min for the project to provision.
4. In the left sidebar: **SQL editor → New query**. Paste the contents of
   [`supabase/setup.sql`](./supabase/setup.sql) and click **Run**. This creates
   the two storage buckets and their policies.
5. In the left sidebar: **Project settings → API**. Copy these — you'll paste
   them into Vercel and Render later:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **`anon public`** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **`service_role`** key (click to reveal) → `SUPABASE_SERVICE_ROLE_KEY`
     ⚠️ This one is server-only; never expose it to a browser.

---

## 2. LiveKit Cloud (3 min)

1. Sign up at **https://cloud.livekit.io** with GitHub.
2. Click **Create project**. Pick any name and the closest region.
3. On the project page, click **Settings → Keys**. Click **Add Key** (or use the
   default one). Copy these:
   - **WebSocket URL** (e.g. `wss://your-project-xxxx.livekit.cloud`) →
     `NEXT_PUBLIC_LIVEKIT_URL`
   - **API Key** → `LIVEKIT_API_KEY`
   - **API Secret** → `LIVEKIT_API_SECRET`

---

## 3. Render — sync server (5 min)

The sync server is the WebSocket relay that keeps everyone's drawings in
sync. It needs to run somewhere that supports long-lived connections.

1. Sign up at **https://render.com** with GitHub.
2. Click **New → Blueprint**.
3. Connect the `aworthysg/whiteboard-` repo. Render will detect
   [`render.yaml`](./render.yaml) and offer to create the `whiteboard-sync`
   service.
4. When it prompts for env vars, paste:
   - `NEXT_PUBLIC_SUPABASE_URL` → the Project URL from Supabase
   - `SUPABASE_SERVICE_ROLE_KEY` → the `service_role` key from Supabase
5. Click **Apply**. Render builds and deploys (~3 min).
6. When it's live, copy the service's URL — it'll look like
   `https://whiteboard-sync.onrender.com`. Convert that to a WebSocket URL by
   swapping the scheme: `wss://whiteboard-sync.onrender.com`. This is your
   `NEXT_PUBLIC_TLDRAW_SYNC_URL`.

---

## 4. Vercel — Next.js app (5 min)

1. Sign up at **https://vercel.com** with GitHub.
2. Click **Add New → Project**. Import `aworthysg/whiteboard-`.
3. Leave the framework preset as **Next.js**. Don't touch build settings.
4. Expand **Environment Variables** and add all eight:

   | Variable                          | Value                                            |
   | --------------------------------- | ------------------------------------------------ |
   | `NEXT_PUBLIC_SUPABASE_URL`        | Supabase Project URL                             |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | Supabase `anon public` key                       |
   | `SUPABASE_SERVICE_ROLE_KEY`       | Supabase `service_role` key                      |
   | `NEXT_PUBLIC_LIVEKIT_URL`         | LiveKit `wss://...livekit.cloud` URL             |
   | `LIVEKIT_API_KEY`                 | LiveKit API key                                  |
   | `LIVEKIT_API_SECRET`              | LiveKit API secret                               |
   | `NEXT_PUBLIC_TLDRAW_SYNC_URL`     | `wss://whiteboard-sync.onrender.com` from step 3 |

5. Click **Deploy**. Vercel builds and gives you a `https://...vercel.app` URL.

---

## 5. Test it

1. Open your Vercel URL on your laptop.
2. Enter a name, click **Create**. You're now in a room.
3. Copy the invite link from the top-right.
4. Open the link on your iPad in Safari. The Apple Pencil should draw with
   pressure. The video panel should ask for camera/mic and then show both
   participants.
5. Click **Upload document** on the canvas and drop in a PDF. Each page appears
   as an image on the canvas in real time on the other device.

---

## Troubleshooting

**Video panel says "LiveKit env vars not configured":** the three LiveKit vars
on Vercel are missing or were added after the last deploy. Redeploy from the
Vercel dashboard (**Deployments → ··· → Redeploy**) so the new envs are picked
up.

**Upload says "Supabase env vars not configured":** same fix — redeploy after
adding the Supabase vars.

**Whiteboard loads but doesn't sync across devices:** check that
`NEXT_PUBLIC_TLDRAW_SYNC_URL` starts with `wss://` (not `https://`) and points
at the Render service. Visit `https://whiteboard-sync.onrender.com/health` —
it should return `tldraw sync server ok`. If Render is asleep, the first
request can take 30s.

**Render service sleeps too aggressively:** upgrade to the $7/mo Starter plan,
or move the sync server to Fly.io (which can scale to zero with much faster
wake-up).
