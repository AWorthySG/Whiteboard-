"use client";

import { useEffect, useRef, useState } from "react";
import {
  CaretDown,
  ChartLine,
  DotsNine,
  File as FileIcon,
  FilePdf,
  GridFour,
  MusicNotes,
  Notebook,
  Textbox,
} from "@phosphor-icons/react";
import {
  Editor,
  AssetRecordType,
  getHashForString,
  uniqueId,
  useValue,
  type TLPageId,
} from "tldraw";
import { useToast } from "./Toast";
import { canAddPage, createNextPage, pageLimitMessage } from "@/lib/pageNames";
import type { RequestRenamePage } from "./RenamePageDialog";

type Template = "blank" | "grid" | "lined" | "music" | "coords" | "dots";

export default function PagesTabBar({
  editor,
  isHost,
  onImportPdf,
  onRequestRenamePage,
}: {
  editor: Editor | null;
  // Add, rename and delete are host-only — pages sync to every student
  // via tldraw, so a non-host change would affect the whole class (a
  // student's × used to delete the current page for everyone). Students
  // get a read-only strip they can switch pages with.
  isHost: boolean;
  // Opens a PDF picker and imports each page as its own background page
  // (wired from WhiteboardCanvas, which owns the upload pipeline).
  onImportPdf?: () => void;
  // Opens RoomShell's RenamePageDialog. Every rename goes through that
  // one dialog, which commits only on an explicit Save / Return — never
  // on blur (see the CLAUDE.md "never commit on blur on iPad" gotcha).
  onRequestRenamePage?: RequestRenamePage;
}) {
  // Re-render only when the page list or the current page changes.
  // (It used to re-render on EVERY document change — every point of every
  // pen stroke, local or remote — rebuilding the bar and its icons dozens
  // of times a second while anyone wrote.) useValue tracks exactly the
  // records these getters read, and getPages() keeps its array identity
  // until a page record changes.
  const pages = useValue("pages", () => (editor ? editor.getPages() : []), [editor]);
  const currentId = useValue(
    "currentPageId",
    () => (editor ? editor.getCurrentPageId() : null),
    [editor],
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  // The ACTIVE page's whole group (tab + rename button + ×), not the tab
  // alone — scrolling only the tab into view left its controls clipped.
  const activeGroupRef = useRef<HTMLDivElement | null>(null);
  const toast = useToast();

  // Close the template menu when tapping/clicking outside. A CAPTURE
  // listener on `document`: tldraw stops pointerdown propagation at its
  // container, so a bubbling window listener never heard canvas taps and
  // the menu stayed open on the board.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [menuOpen]);

  const currentName = pages.find((p) => p.id === currentId)?.name;

  // Keep the active tab AND its rename / × controls visible. The strip is
  // a hidden-scrollbar overflow container, so without this a freshly added
  // page (the 7th at 1024px, the 4th beside the video column) sat clipped
  // out of view with its controls. Measures the whole group (the controls
  // are siblings AFTER the tab) and re-runs on a rename, which can widen
  // it. Scrolls ONLY the strip: Element.scrollIntoView would also scroll
  // every overflow:hidden ancestor, .tldraw-shell included, and could
  // shove the whole canvas sideways.
  useEffect(() => {
    const strip = stripRef.current;
    const group = activeGroupRef.current;
    if (!strip || !group) return;
    const s = strip.getBoundingClientRect();
    const g = group.getBoundingClientRect();
    if (g.left < s.left) strip.scrollLeft -= s.left - g.left + 8;
    else if (g.right > s.right) strip.scrollLeft += g.right - s.right + 8;
  }, [currentId, currentName, pages.length, isHost]);

  if (!editor) return null;

  const addPage = (template: Template) => {
    setMenuOpen(false);
    if (!canAddPage(editor)) {
      toast.error(pageLimitMessage(editor));
      return;
    }
    try {
      const newPageId = createNextPage(
        editor,
        `page:${uniqueId()}` as TLPageId,
      );
      if (!newPageId) {
        toast.error("Couldn't add a page");
        return;
      }
      // Offer a name straight away — inside this tap, so the dialog's
      // input focuses within the user gesture and iOS shows the keyboard.
      // "Skip" keeps "Page N". A template keeps rendering in the
      // background (it targets the page that is current right now).
      onRequestRenamePage?.(newPageId, { isNew: true });
      if (template !== "blank") {
        applyTemplate(editor, template).catch((e) => {
          toast.error(`Template failed: ${(e as Error).message}`);
        });
      }
    } catch (e) {
      toast.error(`Couldn't add page: ${(e as Error).message}`);
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
      // Hidden on phones — the header 'Pages (n) ▾' dropdown already
      // covers navigation and template-add there, and stacking the
      // bottom pill on a narrow screen overlaps the ZoomControls. From
      // tablet up (md), the bottom tabs are still nicer for fast
      // switching between many pages.
      // Sized to the CANVAS, not the viewport: the bottom band's centre
      // grid column caps this at the canvas width, so beside the video
      // column the strip scrolls instead of running under the aside.
      className="flex items-center gap-1 rounded-full bg-[var(--bg-elev)] border-2 border-ink shadow-sticker px-1.5 py-1 max-w-full min-w-0"
    >
      <div
        ref={stripRef}
        className="flex items-center gap-1 overflow-x-auto no-scrollbar min-w-0"
      >
        {pages.map((page) => {
          const active = page.id === currentId;
          return (
            <div
              key={page.id}
              ref={active ? activeGroupRef : undefined}
              className="flex items-center group shrink-0"
            >
              <button
                // Host: tapping the ALREADY-active tab renames it — a big,
                // natural touch target that replaces double-click (which
                // iOS never reliably delivered). Any other tab switches.
                onClick={() => {
                  if (!active) editor.setCurrentPage(page.id);
                  else if (isHost) onRequestRenamePage?.(page.id, { isNew: false });
                }}
                aria-current={active ? "page" : undefined}
                // Segmented-toggle recipe: the active tab is a red pill
                // inside an ink outline (no offset shadow — it sits inside
                // the bar's own sticker). Inactive tabs keep a transparent
                // 2px border so every tab is the same height.
                className={`text-xs font-bold px-3 py-1 rounded-full border-2 transition truncate max-w-[10rem] ${
                  active
                    ? "bg-brand-600 text-white border-ink font-extrabold"
                    : "border-transparent text-[var(--text-muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
                }`}
                title={
                  isHost
                    ? `${page.name} — tap again to rename`
                    : `${page.name} — only the host can rename pages`
                }
              >
                {page.name}
              </button>
              {/* A labelled, thumb-sized rename control on the active tab.
                  Textbox rather than PencilSimple: the pencil is also the
                  Pen tool's glyph, so it read as "draw", not "rename". */}
              {active && isHost && onRequestRenamePage && (
                <button
                  onClick={() => onRequestRenamePage(page.id, { isNew: false })}
                  className="touch-target min-w-[32px] min-h-[28px] rounded-full inline-flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
                  aria-label="Rename page"
                  title="Rename page"
                >
                  <Textbox size={14} aria-hidden />
                </button>
              )}
              {active && isHost && pages.length > 1 && (
                // Same thumb-sized target as the rename button beside it
                // (a bare × was 15×16 px); confirm() still guards a mis-tap.
                <button
                  onClick={() => removePage(page.id)}
                  className="touch-target min-w-[32px] min-h-[28px] ml-1 rounded-full inline-flex items-center justify-center text-[var(--text-muted)] hover:bg-[var(--hover)] hover:text-danger-600 text-xs font-extrabold"
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
      {isHost && (
        <div ref={menuRef} className="relative shrink-0">
          <div className="flex items-center">
            {/* Big primary action: blank page in one click. Most users
                just want another blank sheet — surfacing this directly
                saves a click vs. opening the template menu. */}
            <button
              onClick={() => addPage("blank")}
              className="text-xs px-3 py-1 rounded-full bg-brand-600 hover:bg-brand-700 text-white font-extrabold border-2 border-ink shadow-sticker-primary sticker-press flex items-center gap-1.5 shrink-0"
              aria-label="Add a new blank page"
              title="Add a new blank page"
            >
              <span className="text-base leading-none">+</span>
              <span>New page</span>
            </button>
            {/* Secondary: open template picker for grid / lined / coords / etc. */}
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="ml-1 px-2 py-1.5 rounded-full hover:bg-[var(--hover)] text-[var(--text-muted)] hover:text-[var(--text)] shrink-0 inline-flex items-center"
              aria-label="New page from template"
              title="New page from template"
            >
              <CaretDown size={12} weight="bold" aria-hidden />
            </button>
          </div>
          {menuOpen && (
            <div className="absolute bottom-full mb-2 right-0 w-52 rounded-xl bg-[var(--bg-elev)] border-2 border-ink shadow-sticker p-1.5 z-50 scale-pop">
              <div className="font-label text-[var(--text-muted)] px-2 pt-1 pb-1.5">
                New page from template
              </div>
              <TemplateBtn onClick={() => addPage("blank")} icon={<FileIcon size={16} aria-hidden />}>
                Blank
              </TemplateBtn>
              <TemplateBtn onClick={() => addPage("grid")} icon={<GridFour size={16} aria-hidden />}>
                Grid paper
              </TemplateBtn>
              <TemplateBtn onClick={() => addPage("dots")} icon={<DotsNine size={16} aria-hidden />}>
                Dotted grid
              </TemplateBtn>
              <TemplateBtn onClick={() => addPage("lined")} icon={<Notebook size={16} aria-hidden />}>
                Lined paper
              </TemplateBtn>
              <TemplateBtn onClick={() => addPage("coords")} icon={<ChartLine size={16} aria-hidden />}>
                Coordinate plane
              </TemplateBtn>
              <TemplateBtn onClick={() => addPage("music")} icon={<MusicNotes size={16} aria-hidden />}>
                Music staves
              </TemplateBtn>
              {onImportPdf && (
                <>
                  <div className="my-1.5 border-t-2 border-dashed border-[color:var(--border)]" />
                  <TemplateBtn
                    onClick={() => {
                      setMenuOpen(false);
                      onImportPdf();
                    }}
                    icon={<FilePdf size={16} aria-hidden />}
                  >
                    Import PDF as pages…
                  </TemplateBtn>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TemplateBtn({
  onClick,
  icon,
  children,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left text-sm font-bold rounded-md px-2 py-1.5 hover:bg-[var(--hover)] flex items-center gap-2"
    >
      <span className="shrink-0 text-[var(--text-muted)] inline-flex">{icon}</span>
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
  // Capture the ID upfront so sendToBack always targets this shape, not
  // whatever slice(-1)[0] returns (could be a concurrent remote shape).
  const bgShapeId = `shape:${uniqueId()}` as never;
  editor.createShape({
    id: bgShapeId,
    type: "image",
    x: -w / 2,
    y: -h / 2,
    isLocked: true,
    meta: { uploadedDocument: true },
    props: { assetId, w, h },
  });
  editor.sendToBack([bgShapeId]);
}

function renderTemplateSvg(template: Template, w: number, h: number): string {
  const bg = "#ffffff";
  const line = "#D8D0BF"; // warm rule, same tone as the LMS scrollbar thumb
  const lineSoft = "#ECE6D6";
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
      lines += `<line x1="80" y1="0" x2="80" y2="${h}" stroke="#F5BDB5" stroke-width="1.2"/>`;
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
        <line x1="0" y1="${cy}" x2="${w}" y2="${cy}" stroke="#22304A" stroke-width="1.5"/>
        <line x1="${cx}" y1="0" x2="${cx}" y2="${h}" stroke="#22304A" stroke-width="1.5"/>
        <text x="${w - 14}" y="${cy - 6}" font-size="14" fill="#22304A" text-anchor="end">x</text>
        <text x="${cx + 6}" y="14" font-size="14" fill="#22304A">y</text>
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
          staves += `<line x1="40" y1="${yy}" x2="${w - 40}" y2="${yy}" stroke="#1C1B19" stroke-width="1"/>`;
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
