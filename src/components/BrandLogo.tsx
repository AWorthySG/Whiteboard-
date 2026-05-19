import Image from "next/image";

export default function BrandLogo({
  size = 32,
  className,
  priority,
}: {
  size?: number;
  className?: string;
  priority?: boolean;
}) {
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
