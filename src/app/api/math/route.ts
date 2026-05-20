import { NextResponse } from "next/server";
import katex from "katex";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

// Cache the KaTeX CSS in module scope so each request doesn't re-read it
// from disk. Inlining the CSS into the SVG means the math renders
// correctly when the SVG is used as an <image> shape on the canvas.
let cachedCss: string | null = null;
async function loadKatexCss(): Promise<string> {
  if (cachedCss !== null) return cachedCss;
  const file = path.join(
    process.cwd(),
    "node_modules",
    "katex",
    "dist",
    "katex.min.css",
  );
  try {
    const css = await fs.readFile(file, "utf8");
    // Strip @font-face blocks — we don't ship KaTeX's web fonts as
    // base64 (too heavy). The default browser fonts render math
    // adequately when the KaTeX glyph fonts aren't available, and
    // production deployments could later inline base64 fonts if
    // perfect typography is needed.
    cachedCss = css.replace(/@font-face\s*\{[^}]*\}/g, "");
    return cachedCss;
  } catch {
    cachedCss = "";
    return cachedCss;
  }
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
  // Heuristic sizing — KaTeX's HTML output is hard to measure server-side
  // without a real DOM. We pick a width based on character count and let
  // the SVG scale to fit on the canvas. The client can resize the shape
  // after insert.
  const charCount = latex.length;
  const width = Math.min(1200, Math.max(180, charCount * 18));
  const height = displayMode ? 96 : 64;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;align-items:center;justify-content:center;height:100%;color:#0b0d12;font-family:'Latin Modern Math','Cambria Math',serif;font-size:24px;line-height:1.2;padding:8px;box-sizing:border-box;background:#fff;border-radius:6px;"><style>${css}</style>${rendered}</div></foreignObject></svg>`;

  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
  return NextResponse.json({ dataUrl, width, height });
}
