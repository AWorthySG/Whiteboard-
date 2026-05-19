import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

const BUCKET = "whiteboard-assets";

function makeClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req: Request) {
  const supabase = makeClient();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase env vars not configured" },
      { status: 500 },
    );
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  const roomId = (form.get("roomId") as string | null) || null;
  const uploadedByUserId = (form.get("userId") as string | null) || null;
  const uploadedByName = (form.get("userName") as string | null) || null;
  const originalName = (form.get("originalName") as string | null) || file.name;

  const ext = file.name.split(".").pop() ?? "bin";
  const path = `${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, bytes, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);

  // Track the upload in room_documents so it appears in the Documents drawer.
  // Only record originals, not the per-page PNGs we generate from PDFs.
  if (roomId && !originalName.match(/-page-\d+\.png$/i)) {
    await supabase.from("room_documents").insert({
      room_id: roomId,
      name: originalName,
      url: data.publicUrl,
      mime_type: file.type || null,
      uploaded_by_user_id: uploadedByUserId,
      uploaded_by_name: uploadedByName,
    });
  }

  return NextResponse.json({ url: data.publicUrl, path });
}
