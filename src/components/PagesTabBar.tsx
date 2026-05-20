"use client";

import { useEffect, useState } from "react";
import {
  Editor,
  AssetRecordType,
  getHashForString,
  uniqueId,
} from "tldraw";
import { useToast } from "./Toast";

type Template = "blank" | "grid" | "lined" | "music" | "coords" | "dots";

export default function PagesTabBar({ editor }: { editor: Editor | null }) {
  // Force re-render when tldraw's page state changes.
  const [, setTick] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!editor) return;
    const unsubs: Array<() => void> = [];
    unsubs.push(
      editor.store.listen(() => setTick((n) => n + 1), {
        scope: "document",
        source: "user",
      }),
    );
    unsubs.push(
      editor.store.listen(() => setTick((n) => n + 1), {
        scope: "document",
        source: "remote",
      }),
    );
    return () => unsubs.forEach((u) => u());
  }, [editor]);

  if (!editor) return null;

  const pages = editor.getPages();
  const currentId = editor.getCurrentPageId();

  const addPage = (template: Template) => {
    setMenuOpen(false);
    try {
      const num = pages.length + 1;
      editor.createPage({ name: `Page ${num}` });
      // Navigate to the new page (the one just created is the last in list now).
      const newPages = editor.getPages();
      const newPage = newPages[newPages.length - 1];
      if (newPage) editor.setCurrentPage(newPage.id);
      if (template !== "blank") {
        applyTemplate(editor, template).catch((e) => {
          toast.error(`Template failed: ${(e as Error).message}`);
        });
      }
    } catch (e) {
      toast.error(`Couldn't add page: ${(e as Error).message}`);
    }
  };

  const renamePage = (id: string) => {
    const page = pages.find((p) => p.id === id);
    if (!page) return;
    const next = prompt("Rename page", page.name);
    if (next !== null && next.trim()) {
      editor.renamePage(page.id, next.trim());
    }
  };

  const removePage = (id: string) => {
    if (pages.length <= 1) {
      toast.error("Can't delete the last page");
      return;
    }
    if (!confirm("Delete this page? Drawings on it will be removed.")) return;
    editor.deletePage(id as never);
  };

  return (
    <div
      className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-1 rounded-full bg-[var(--bg-elev)] border border-[color:var(--border)] shadow-2xl px-1.5 py-1 max-w-[92vw]"
      style={{ pointerEvents: "auto" }}
    >
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
        {pages.map((page) => {
          const active = page.id === currentId;
          return (
            <div key={page.id} className="flex items-center group shrink-0">
              <button
                onClick={() => editor.setCurrentPage(page.id)}
                onDoubleClick={() => renamePage(page.id)}
                className={`text-xs px-3 py-1.5 rounded-full transition truncate max-w-[10rem] ${
                  active
                    ? "bg-brand-600 text-[var(--text)]"
                    : "text-[var(--text-muted)] hover:bg-[var(--hover)]"
                }`}
                title={`${page.name} (double-click to rename)`}
              >
                {page.name}
              </button>
              {active && pages.length > 1 && (
                <button
                  onClick={() => removePage(page.id)}
                  className="text-[var(--text-dim)] hover:text-red-600 text-xs px-1"
                  aria-label="Delete page"
                  title="Delete page"
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="relative">
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="text-sm w-7 h-7 rounded-full bg-[var(--border)] hover:bg-[var(--border)] flex items-center justify-center shrink-0"
          aria-label="New page"
          title="New page"
        >
          +
        </button>
        {menuOpen && (
          <div className="absolute bottom-full mb-1 right-0 w-52 rounded-lg bg-[var(--bg)] border border-[color:var(--border)] shadow-2xl p-1 z-50">
            <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)] px-2 pt-1 pb-1">
              New page
            </div>
            <TemplateBtn onClick={() => addPage("blank")} emoji="📄">
              Blank
            </TemplateBtn>
            <TemplateBtn onClick={() => addPage("grid")} emoji="▦">
              Grid paper
            </TemplateBtn>
            <TemplateBtn onClick={() => addPage("dots")} emoji="⋮⋮">
              Dotted grid
            </TemplateBtn>
            <TemplateBtn onClick={() => addPage("lined")} emoji="📋">
              Lined paper
            </TemplateBtn>
            <TemplateBtn onClick={() => addPage("coords")} emoji="📐">
              Coordinate plane
            </TemplateBtn>
            <TemplateBtn onClick={() => addPage("music")} emoji="🎵">
              Music staves
            </TemplateBtn>
          </div>
        )}
      </div>
    </div>
  );
}

function TemplateBtn({
  onClick,
  emoji,
  children,
}: {
  onClick: () => void;
  emoji: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left text-sm rounded-md px-2 py-1.5 hover:bg-[var(--hover)] flex items-center gap-2"
    >
      <span className="text-base shrink-0">{emoji}</span>
      <span>{children}</span>
    </button>
  );
}

async function applyTemplate(editor: Editor, template: Template) {
  const w = 1600;
  const h = 1200;
  const svg = renderTemplateSvg(template, w, h);
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);

  // Convert to PNG via canvas so it persists across reload (data URLs aren't
  // re-fetchable). For now, embed as a data URL; this stays inside the room
  // snapshot so it's available to everyone.
  const dataUrl = await blobToDataUrl(blob);
  URL.revokeObjectURL(url);

  const assetId = AssetRecordType.createId(getHashForString(dataUrl));
  editor.createAssets([
    {
      id: assetId,
      type: "image",
      typeName: "asset",
      props: {
        name: `template-${template}.svg`,
        src: dataUrl,
        w,
        h,
        mimeType: "image/svg+xml",
        isAnimated: false,
      },
      meta: {},
    },
  ]);
  editor.createShape({
    id: `shape:${uniqueId()}` as never,
    type: "image",
    x: -w / 2,
    y: -h / 2,
    isLocked: true,
    props: { assetId, w, h },
  });
  // Send template to back so users draw on top of it.
  const last = editor.getCurrentPageShapes().slice(-1)[0];
  if (last) editor.sendToBack([last.id]);
}

function renderTemplateSvg(template: Template, w: number, h: number): string {
  const bg = "#ffffff";
  const line = "#cdd5e2";
  const lineSoft = "#e6ebf3";
  switch (template) {
    case "grid": {
      const step = 40;
      return svgWrap(w, h, bg, `
        <defs>
          <pattern id="grid" width="${step}" height="${step}" patternUnits="userSpaceOnUse">
            <path d="M ${step} 0 L 0 0 0 ${step}" fill="none" stroke="${lineSoft}" stroke-width="1"/>
          </pattern>
          <pattern id="bigGrid" width="${step * 5}" height="${step * 5}" patternUnits="userSpaceOnUse">
            <path d="M ${step * 5} 0 L 0 0 0 ${step * 5}" fill="none" stroke="${line}" stroke-width="1.2"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)"/>
        <rect width="100%" height="100%" fill="url(#bigGrid)"/>
      `);
    }
    case "dots": {
      const step = 40;
      return svgWrap(w, h, bg, `
        <defs>
          <pattern id="dots" width="${step}" height="${step}" patternUnits="userSpaceOnUse">
            <circle cx="0" cy="0" r="1.5" fill="${line}"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dots)"/>
      `);
    }
    case "lined": {
      const step = 48;
      let lines = "";
      for (let y = step; y < h; y += step) {
        lines += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="${line}" stroke-width="1"/>`;
      }
      lines += `<line x1="80" y1="0" x2="80" y2="${h}" stroke="#f0a8a8" stroke-width="1.2"/>`;
      return svgWrap(w, h, bg, lines);
    }
    case "coords": {
      const step = 40;
      const cx = w / 2;
      const cy = h / 2;
      let content = `<rect width="100%" height="100%" fill="url(#g)"/>`;
      content = `
        <defs>
          <pattern id="g" width="${step}" height="${step}" patternUnits="userSpaceOnUse">
            <path d="M ${step} 0 L 0 0 0 ${step}" fill="none" stroke="${lineSoft}" stroke-width="1"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#g)"/>
        <line x1="0" y1="${cy}" x2="${w}" y2="${cy}" stroke="#2563eb" stroke-width="1.5"/>
        <line x1="${cx}" y1="0" x2="${cx}" y2="${h}" stroke="#2563eb" stroke-width="1.5"/>
        <text x="${w - 14}" y="${cy - 6}" font-size="14" fill="#2563eb" text-anchor="end">x</text>
        <text x="${cx + 6}" y="14" font-size="14" fill="#2563eb">y</text>
      `;
      return svgWrap(w, h, bg, content);
    }
    case "music": {
      const lineSpacing = 14;
      const staffHeight = lineSpacing * 4;
      const groupSpacing = 80;
      let staves = "";
      let y = 60;
      while (y + staffHeight < h - 60) {
        for (let i = 0; i < 5; i++) {
          const yy = y + i * lineSpacing;
          staves += `<line x1="40" y1="${yy}" x2="${w - 40}" y2="${yy}" stroke="#1a1d24" stroke-width="1"/>`;
        }
        y += staffHeight + groupSpacing;
      }
      return svgWrap(w, h, bg, staves);
    }
    case "blank":
    default:
      return svgWrap(w, h, bg, "");
  }
}

function svgWrap(w: number, h: number, bg: string, inner: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="${bg}"/>${inner}</svg>`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
