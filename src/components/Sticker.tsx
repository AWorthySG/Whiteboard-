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
  // Solo stickers — also used as the faded canvas watermark.
  avocado: { src: "/sticker-avocado.webp", w: 183, h: 240 },
  heart: { src: "/sticker-heart.webp", w: 155, h: 240 },
  rocket: { src: "/sticker-rocket.webp", w: 171, h: 240 },
  icecream: { src: "/sticker-icecream.webp", w: 160, h: 240 },
} as const;

export type StickerName = keyof typeof STICKERS;

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
