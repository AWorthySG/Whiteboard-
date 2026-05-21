"use client";

// Coloured circle with the user's initials. Used in the PresenceBadge
// popover and as the camera-off placeholder for LiveKit tiles. Same
// colour as PresenceBadge so a participant's identity reads
// consistently across surfaces.
export default function InitialsAvatar({
  name,
  id,
  size = 32,
  className,
}: {
  name: string;
  id: string;
  size?: number;
  className?: string;
}) {
  const initials =
    name
      .split(" ")
      .map((w) => w[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";
  const bg = colorForId(id);
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full text-white font-semibold shrink-0 ${className ?? ""}`}
      style={{
        width: size,
        height: size,
        background: bg,
        fontSize: Math.round(size * 0.4),
      }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

// Deterministic colour per user-id. Same id always gets the same hue,
// so a user's avatar circle stays consistent across renders and tabs.
function colorForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 55%, 45%)`;
}
