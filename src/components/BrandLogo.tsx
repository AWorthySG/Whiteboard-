import Image from "next/image";

/** Intrinsic size of public/logo-wordmark.png, used to derive the width
 *  from the requested height so the wordmark never distorts. */
const WORDMARK_W = 919;
const WORDMARK_H = 220;

export default function BrandLogo({
  size = 32,
  variant = "mark",
  className,
  priority,
}: {
  /** Rendered HEIGHT in px. For "mark" this is also the width (it's
   *  square); for "wordmark" the width is derived from the aspect ratio. */
  size?: number;
  /** "mark" is the square arch-and-swoosh icon — correct wherever space is
   *  tight or the container is square (app chrome, favicons, notifications).
   *  "wordmark" is the full "A-Worthy Education" lockup at ~4.18:1, for
   *  places with horizontal room. The wordmark already contains the company
   *  name, so don't put brand text next to it — you'll say it twice. */
  variant?: "mark" | "wordmark";
  className?: string;
  priority?: boolean;
}) {
  if (variant === "wordmark") {
    const width = Math.round((size * WORDMARK_W) / WORDMARK_H);
    return (
      <Image
        src="/logo-wordmark.png"
        alt="A-Worthy Education"
        width={width}
        height={size}
        priority={priority}
        className={className}
        sizes={`${width}px`}
      />
    );
  }
  return (
    <Image
      src="/icon.png"
      alt="A Worthy"
      width={size}
      height={size}
      priority={priority}
      className={className}
      sizes={`${size}px`}
    />
  );
}
