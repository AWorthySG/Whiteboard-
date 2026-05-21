# Spike: Cloudflare Pages migration

Branch: `claude/cf-pages-spike` (do not merge). Goal: assess whether we can
host the Next.js app on Cloudflare Pages instead of Vercel, to escape
Vercel's free-tier deploy rate limit.

## Verdict

**Partially viable but not turnkey.** The build, bundling, and most
routes work; the `/r/[roomId]` route — i.e. the room shell — hits a
known `@cloudflare/next-on-pages` webpack-chunking bug at runtime. Fix
requires either restructuring RoomShell's dynamic imports or trying the
newer `@opennextjs/cloudflare` adapter. **Estimated additional work to
production-ready: 1–2 days.**

## What works

- ✅ `npx @cloudflare/next-on-pages` build completes cleanly
- ✅ Worker bundle 1.68 MiB uncompressed → ~500 KiB gzipped (under CF's
  1 MiB compressed limit)
- ✅ `/` (home page) — 200 OK
- ✅ `/tg` — 200 OK
- ✅ `/api/math` — verified locally; returns valid SVG data URL
- ✅ `/api/livekit/token` — compiles + runs; returns expected 500 with
  env vars absent (would mint tokens once env is configured)
- ✅ `/api/uploads` — compiles cleanly
- ✅ Typecheck passes

## What had to change

1. **LiveKit token route** (`src/app/api/livekit/token/route.ts`) — replaced
   `livekit-server-sdk`'s `AccessToken` with a direct `jose` JWT call.
   The SDK's top-level export pulls `WebhookReceiver`, which transitively
   imports `node:crypto`. The dynamic-import guard in the SDK isn't
   enough — webpack still walks the import at build time and fails the
   edge build.
2. **Math route** (`src/app/api/math/route.ts`) — dropped the
   `node:fs`/`node:path` disk read; KaTeX CSS now fetched once from
   jsdelivr and module-cached. Replaced `Buffer.from(..).toString('base64')`
   with a manual TextEncoder + `btoa` (no `Buffer` on edge).
3. **All API routes** — `runtime = "nodejs"` → `runtime = "edge"`.
4. **Dynamic page routes** — `/r/[roomId]` and `/playback/[recordingId]`
   now `export const runtime = "edge"` (required for next-on-pages).
5. **Added deps**: `@cloudflare/next-on-pages`, `wrangler`, `jose`.
6. **Added `wrangler.toml`** with `nodejs_compat` flag.

## What blocks production

Hitting `/r/test` returns 500 with a runtime error:

```
ReferenceError: async__chunk_6818 is not defined
  at .vercel/output/static/_worker.js/__next-on-pages-dist__/functions/r/%5BroomId%5D.func.js:46:6022
```

`RoomShell.tsx` has 17 `dynamic(() => import(...))` calls. The
next-on-pages webpack-chunk splitter is generating a reference to a
chunk it didn't actually emit. This is a class of issue tracked
[upstream](https://github.com/cloudflare/next-on-pages/issues) and
typically resolved by either:

- collapsing some of the dynamic imports (e.g. eager-import the small
  ones, keep `WhiteboardCanvas` / `VideoPanel` lazy), or
- migrating to `@opennextjs/cloudflare`, which uses a different bundling
  strategy and is now Cloudflare's recommended adapter for new projects.

## Comparison vs Vercel Pro

| | Vercel Pro | Cloudflare Pages |
|---|---|---|
| Cost | $20/mo | $0 |
| Rate limits | None | None (different — request limits on Workers, but generous) |
| Migration work | Zero — already deployed | 1–2 more days to clear the chunking bug + retest |
| Risk | Known-good prod env | Adapter compatibility quirks; less battle-tested for tldraw + livekit-react stack |
| Domain | `whiteboard.a-worthy.com` via CF DNS | Same — already CF DNS, would point at Pages instead of Vercel |

## Recommendation

For a solo-tutor app where uptime matters more than $240/year, **Vercel
Pro is the safer bet today**. The CF Pages route is viable but the
adapter quirks could chew through more debugging time than the savings
justify. Revisit if:

- traffic grows enough that CF's edge network matters more than Vercel's
- `@opennextjs/cloudflare` matures further
- a longer maintenance window opens up

## Reverting the spike

Nothing in this branch has been merged. To clean up:

```bash
git checkout main
git branch -D claude/cf-pages-spike
```
