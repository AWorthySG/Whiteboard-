// Copies tldraw's icons, fonts, embed icons and translations out of
// node_modules/@tldraw/assets into public/tldraw-assets/<version>/, so the
// whiteboard loads them from our own origin instead of cdn.tldraw.com (one
// fewer third-party connection on every cold load, and the service worker
// can keep them). The folder is versioned, so a tldraw upgrade gets a fresh
// URL and the long immutable cache never serves stale files. Generated, not
// committed (see .gitignore). Runs from predev and prebuild; idempotent.
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const src = join(process.cwd(), "node_modules", "@tldraw", "assets");
const { version } = JSON.parse(readFileSync(join(src, "package.json"), "utf8"));
const root = join(process.cwd(), "public", "tldraw-assets");
const dest = join(root, version);

if (existsSync(join(dest, "icons"))) {
  console.log(`[tldraw-assets] ${version} already in public/`);
} else {
  // Drop older versions so public/ doesn't accumulate them.
  rmSync(root, { recursive: true, force: true });
  for (const dir of ["fonts", "icons", "embed-icons", "translations"]) {
    cpSync(join(src, dir), join(dest, dir), { recursive: true });
  }
  console.log(`[tldraw-assets] copied ${version} to public/tldraw-assets/`);
}
