// tldraw's icons, fonts and translations, served from our own origin
// (public/tldraw-assets/<version>/, copied there by
// scripts/copy-tldraw-assets.mjs) instead of cdn.tldraw.com. Pass
// TLDRAW_ASSET_URLS as `assetUrls` to EVERY <Tldraw>, like TLDRAW_OPTIONS.
import { getAssetUrls } from "@tldraw/assets/selfHosted";
import { version } from "@tldraw/assets/package.json";

export const TLDRAW_ASSETS_BASE = `/tldraw-assets/${version}`;

export const TLDRAW_ASSET_URLS = getAssetUrls({ baseUrl: TLDRAW_ASSETS_BASE });
