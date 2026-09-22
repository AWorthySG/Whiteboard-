import Image from "next/image";

/**
 * The mascot stickers, addressed by name.
 *
 * Intrinsic sizes are recorded here so a caller can ask for a HEIGHT and get
 * the correct width back — they have differing aspect ratios (0.65 to 0.89),
 * so a shared square box would letterbox some and distort others. Sizing by
 * height is also what makes a row of different stickers read as one set.
 *
 * Decorative by default: `alt` is "" so screen readers skip them. Pass a real
 * `alt` only if a sticker is ever the sole carrier of meaning.
 */
const STICKERS = {
  // Scene stickers — larger, used in marketing / empty / waiting states.
  teaching: { src: "/sticker-teaching.webp", w: 350, h: 400 },
  reading: { src: "/sticker-reading.webp", w: 298, h: 400 },
  encourage: { src: "/sticker-encourage.webp", w: 357, h: 400 },
  dad: { src: "/sticker-dad.webp", w: 282, h: 400 },
  feeding: { src: "/sticker-feeding.webp", w: 315, h: 400 },
  // Subject stickers — tutor + student per subject. The landing hero's
  // sticker sheet and the room's welcome screen draw from these.
  calculus: { src: "/sticker-calculus.webp", w: 380, h: 400 },
  economics: { src: "/sticker-economics.webp", w: 465, h: 400 },
  chemistry: { src: "/sticker-chemistry.webp", w: 408, h: 400 },
  finance: { src: "/sticker-finance.webp", w: 426, h: 400 },
  mathematics: { src: "/sticker-mathematics.webp", w: 427, h: 400 },
  // More tutor + student duos from the collection (400px tall). Each is
  // registered so a future placement is one line; only the ones listed in
  // CLAUDE.md's placement map are rendered anywhere.
  essay: { src: "/sticker-essay.webp", w: 399, h: 400 },
  readingbuddies: { src: "/sticker-readingbuddies.webp", w: 414, h: 400 },
  studying: { src: "/sticker-studying.webp", w: 396, h: 400 },
  civics: { src: "/sticker-civics.webp", w: 409, h: 400 },
  checklist: { src: "/sticker-checklist.webp", w: 425, h: 400 },
  calculus2: { src: "/sticker-calculus2.webp", w: 380, h: 400 },
  chemistry2: { src: "/sticker-chemistry2.webp", w: 363, h: 400 },
  mathematics2: { src: "/sticker-mathematics2.webp", w: 386, h: 400 },
  economics2: { src: "/sticker-economics2.webp", w: 421, h: 400 },
  // The six-up "sticker sheet" illustration — decorative only.
  sheet: { src: "/sticker-sheet.webp", w: 522, h: 480 },
  // Solo stickers — also used as the faded canvas watermark.
  avocado: { src: "/sticker-avocado.webp", w: 183, h: 240 },
  heart: { src: "/sticker-heart.webp", w: 155, h: 240 },
  rocket: { src: "/sticker-rocket.webp", w: 171, h: 240 },
  icecream: { src: "/sticker-icecream.webp", w: 160, h: 240 },
} as const;

export type StickerName = keyof typeof STICKERS;

/** The five subject DUO stickers, in the order they read best left-to-right. */
export const SUBJECT_STICKERS = [
  "mathematics",
  "calculus",
  "chemistry",
  "economics",
  "finance",
] as const satisfies readonly StickerName[];


export default function Sticker({
  name,
  size = 96,
  className,
  priority,
  alt = "",
}: {
  name: StickerName;
  /** Rendered HEIGHT in px; width is derived from the intrinsic ratio. */
  size?: number;
  className?: string;
  priority?: boolean;
  alt?: string;
}) {
  const s = STICKERS[name];
  const width = Math.round((size * s.w) / s.h);
  return (
    <Image
      src={s.src}
      alt={alt}
      width={width}
      height={size}
      priority={priority}
      className={className}
      sizes={`${width}px`}
    />
  );
}
