import RoomShell from "@/components/RoomShell";

export const runtime = "edge";

export default async function RoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ roomId: string }>;
  searchParams: Promise<{ name?: string }>;
}) {
  const { roomId } = await params;
  const { name } = await searchParams;
  return <RoomShell roomId={decodeURIComponent(roomId)} userName={name ?? ""} />;
}
