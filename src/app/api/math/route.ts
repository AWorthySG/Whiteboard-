import { NextResponse } from "next/server";
import katex from "katex";

export const runtime = "edge";

// On Edge / CF Workers we can't read from disk, so fetch the KaTeX CSS
// once at first request and cache in module scope. CF caches the
// fetch() response globally across requests within the worker isolate.
const KATEX_VERSION = "0.16.21";
const KATEX_CSS_URL = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.css`;
let cachedCss: string | null = null;
async function loadKatexCss(): Promise<string> {
  if (cachedCss !== null) return cachedCss;
  try {
    const res = await fetch(KATEX_CSS_URL, {
      cf: { cacheTtl: 86400, cacheEverything: true },
    } as RequestInit);
    if (!res.ok) {
      cachedCss = "";
      return cachedCss;
    }
    const css = await res.text();
    // Strip @font-face blocks — we don't ship KaTeX's web fonts.
    cachedCss = css.replace(/@font-face\s*\{[^}]*\}/g, "");
    return cachedCss;
  } catch {
    cachedCss = "";
    return cachedCss;
  }
}

function utf8ToBase64(input: string): string {
  // Edge runtime has no Buffer; encode manually.
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function POST(req: Request) {
  let body: { latex?: string; displayMode?: boolean };
  try {
    body = (await req.json()) as { latex?: string; displayMode?: boolean };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const latex = (body.latex ?? "").trim();
  const displayMode = !!body.displayMode;
  if (!latex) {
    return NextResponse.json({ error: "Empty equation" }, { status: 400 });
  }
  if (latex.length > 4000) {
    return NextResponse.json({ error: "Equation too long" }, { status: 400 });
  }

  let rendered: string;
  try {
    rendered = katex.renderToString(latex, {
      displayMode,
      throwOnError: true,
      strict: "ignore",
      output: "html",
    });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message },
      { status: 400 },
    );
  }

  const css = await loadKatexCss();
  const charCount = latex.length;
  const width = Math.min(1200, Math.max(180, charCount * 18));
  const height = displayMode ? 96 : 64;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;align-items:center;justify-content:center;height:100%;color:#0b0d12;font-family:'Latin Modern Math','Cambria Math',serif;font-size:24px;line-height:1.2;padding:8px;box-sizing:border-box;background:#fff;border-radius:6px;"><style>${css}</style>${rendered}</div></foreignObject></svg>`;

  const dataUrl = `data:image/svg+xml;base64,${utf8ToBase64(svg)}`;
  return NextResponse.json({ dataUrl, width, height });
}
