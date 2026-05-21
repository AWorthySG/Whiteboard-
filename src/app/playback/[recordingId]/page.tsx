import { notFound } from "next/navigation";
import PlaybackViewer from "@/components/PlaybackViewer";
import { createClient } from "@supabase/supabase-js";

export const runtime = "edge";

// Server-side fetch — we don't need realtime here, and going via
// fetch on the server avoids shipping the recording row through
// the client just so the viewer can re-fetch it.
async function loadRecording(id: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const supabase = createClient(url, key);
  const { data } = await supabase
    .from("room_recordings")
    .select(
      "id, room_id, title, file_url, frames_url, duration_sec, recorded_at",
    )
    .eq("id", id)
    .maybeSingle();
  return data as Recording | null;
}

type Recording = {
  id: string;
  room_id: string;
  title: string | null;
  file_url: string;
  frames_url: string | null;
  duration_sec: number | null;
  recorded_at: string | null;
};

export default async function PlaybackPage({
  params,
}: {
  params: Promise<{ recordingId: string }>;
}) {
  const { recordingId } = await params;
  const recording = await loadRecording(decodeURIComponent(recordingId));
  if (!recording) notFound();
  return <PlaybackViewer recording={recording} />;
}
