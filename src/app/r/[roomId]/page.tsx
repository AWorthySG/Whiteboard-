import RoomShellClient from "@/components/RoomShellClient";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  // Neither `searchParams` nor the room shell itself is rendered on the
  // server — see RoomShellClient for why. `?name=` is read client-side.
  return <RoomShellClient roomId={decodeURIComponent(roomId)} />;
}
