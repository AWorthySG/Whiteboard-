"use client";

import { useCallback, useEffect, useRef } from "react";
import type { Editor } from "tldraw";
import { getSupabase } from "@/lib/supabase";

type Frame = { t: number; snapshot: unknown };

// Captures the whiteboard state every `intervalMs` while a recording
// is active, then uploads them as a JSONL file alongside the video.
// The playback page reads the JSONL and renders the snapshot whose
// timestamp matches the current video time.
//
// Design notes:
// - Snapshots can be large; we hash each one and skip if unchanged
//   since the previous capture, so a still canvas doesn't burn
//   storage.
// - The buffer lives in a ref so React re-renders don't reset it.
// - On stop we upload directly to Supabase Storage (browser POST,
//   same pattern as the rest of the upload paths) then UPDATE the
//   recording row with the frames_url.
export function useWhiteboardRecorder(
  roomId: string,
  getEditor: () => Editor | null,
  intervalMs = 5_000,
) {
  const sessionRef = useRef<{
    id: string;
    startedAt: number;
    frames: Frame[];
    lastHash: number;
    timer: number | null;
  } | null>(null);

  const captureNow = useCallback(() => {
    const s = sessionRef.current;
    const editor = getEditor();
    if (!s || !editor) return;
    let snapshot: unknown;
    try {
      // tldraw v3 surface: getSnapshot returns the document + session.
      // We keep document-only to slim the payload; the playback page
      // only needs to render shapes, not restore the host's camera.
      const full = (editor as unknown as { getSnapshot(): unknown }).getSnapshot();
      const doc = (full as { document?: unknown })?.document ?? full;
      snapshot = doc;
    } catch (e) {
      console.warn("[wb-recorder] getSnapshot failed", e);
      return;
    }
    const serial = JSON.stringify(snapshot);
    const hash = cheapHash(serial);
    if (hash === s.lastHash) return; // canvas unchanged — skip frame
    s.lastHash = hash;
    s.frames.push({
      t: Math.round((Date.now() - s.startedAt) / 1000),
      snapshot,
    });
  }, [getEditor]);

  const start = useCallback(
    (recordingId: string) => {
      // Defensive: stop any previous session that wasn't cleanly
      // ended (e.g. the user hit Record twice in a row).
      const prev = sessionRef.current;
      if (prev?.timer !== null && prev?.timer !== undefined) {
        window.clearInterval(prev.timer);
      }
      sessionRef.current = {
        id: recordingId,
        startedAt: Date.now(),
        frames: [],
        lastHash: 0,
        timer: null,
      };
      // Snapshot once immediately so even very short recordings have
      // at least one frame at t=0.
      captureNow();
      sessionRef.current.timer = window.setInterval(captureNow, intervalMs);
    },
    [captureNow, intervalMs],
  );

  const finish = useCallback(async (recordingId: string) => {
    const s = sessionRef.current;
    if (!s || s.id !== recordingId) return;
    if (s.timer !== null) window.clearInterval(s.timer);
    // One last capture so the final state is in the timeline.
    captureNow();
    const frames = s.frames;
    sessionRef.current = null;

    if (frames.length === 0) return;

    const supabase = getSupabase();
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabase || !url || !key) return;

    const jsonl = frames.map((f) => JSON.stringify(f)).join("\n");
    const blob = new Blob([jsonl], { type: "application/x-ndjson" });
    const path = `${roomId}/${recordingId}-frames.jsonl`;
    const endpoint = `${url}/storage/v1/object/whiteboard-recordings/${path}`;

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          apikey: key,
          "Content-Type": "application/x-ndjson",
          "x-upsert": "true",
        },
        body: blob,
      });
      if (!res.ok) {
        console.warn(
          "[wb-recorder] frames upload failed",
          res.status,
          await res.text(),
        );
        return;
      }
      const framesUrl = `${url}/storage/v1/object/public/whiteboard-recordings/${path}`;
      const { error } = await supabase
        .from("room_recordings")
        .update({ frames_url: framesUrl })
        .eq("id", recordingId);
      if (error) {
        console.warn("[wb-recorder] frames_url update failed", error);
      }
    } catch (e) {
      console.warn("[wb-recorder] frames upload threw", e);
    }
  }, [captureNow, roomId]);

  // Clean up on unmount so a host who closes the tab mid-recording
  // doesn't leave a dangling interval.
  useEffect(() => {
    return () => {
      const s = sessionRef.current;
      if (s?.timer !== null && s?.timer !== undefined) {
        window.clearInterval(s.timer);
      }
      sessionRef.current = null;
    };
  }, []);

  return { start, finish };
}

// Tiny non-cryptographic hash for deduping consecutive identical
// frames. djb2.
function cheapHash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  }
  return h;
}
