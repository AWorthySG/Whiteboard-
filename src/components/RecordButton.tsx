"use client";

import { useEffect, useRef, useState } from "react";
import { useToast } from "./Toast";
import { getSupabase } from "@/lib/supabase";

type State = "idle" | "recording" | "saving";

export default function RecordButton({
  roomId,
  hostUserId,
  hostName,
  roomTitle,
}: {
  roomId: string;
  hostUserId: string;
  hostName: string;
  roomTitle: string;
}) {
  const toast = useToast();
  const [state, setState] = useState<State>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [uploadPct, setUploadPct] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);

  // Block accidental tab close mid-recording / mid-upload.
  useEffect(() => {
    if (state === "idle") return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [state]);

  useEffect(() => {
    if (state !== "recording") return;
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [state]);

  const uploadToCloud = async (blob: Blob, mimeType: string, durationSec: number) => {
    setState("saving");
    setUploadPct(0);

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      toast.error("Cloud upload skipped — Supabase env vars missing");
      setState("idle");
      return null;
    }

    const ext = mimeType.includes("mp4") ? "mp4" : "webm";
    const fileName = `${roomId}-${Date.now()}.${ext}`;
    const path = `${roomId}/${fileName}`;
    const endpoint = `${url}/storage/v1/object/whiteboard-recordings/${path}`;

    try {
      // XHR for upload progress (supabase-js doesn't expose it).
      const publicUrl: string = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", endpoint);
        xhr.setRequestHeader("Authorization", `Bearer ${key}`);
        xhr.setRequestHeader("apikey", key);
        xhr.setRequestHeader("Content-Type", mimeType);
        xhr.setRequestHeader("x-upsert", "false");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setUploadPct(Math.round((e.loaded / e.total) * 100));
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(
              `${url}/storage/v1/object/public/whiteboard-recordings/${path}`,
            );
          } else {
            reject(new Error(`Upload failed: HTTP ${xhr.status} ${xhr.responseText}`));
          }
        };
        xhr.onerror = () => reject(new Error("Network error during upload"));
        xhr.send(blob);
      });

      // Save metadata row.
      const supabase = getSupabase();
      if (supabase) {
        const date = new Date();
        const title =
          (roomTitle?.trim() || roomId) +
          " · " +
          date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
        await supabase.from("room_recordings").insert({
          room_id: roomId,
          title,
          file_url: publicUrl,
          file_path: path,
          mime_type: mimeType,
          size_bytes: blob.size,
          duration_sec: durationSec,
          host_user_id: hostUserId,
          host_name: hostName,
        });
      }

      toast.success("Recording uploaded — open Recordings to view");
      return publicUrl;
    } catch (e) {
      toast.error(`Upload failed: ${(e as Error).message}`);
      return null;
    } finally {
      setUploadPct(0);
      setState("idle");
      setElapsed(0);
    }
  };

  const start = async () => {
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true,
      });
      let combined = display;
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        const tracks: MediaStreamTrack[] = [
          ...display.getVideoTracks(),
          ...display.getAudioTracks(),
          ...mic.getAudioTracks(),
        ];
        combined = new MediaStream(tracks);
      } catch {
        // Mic denied or unavailable — record without it.
      }

      streamRef.current = combined;
      chunksRef.current = [];

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(
        combined,
        mimeType ? { mimeType } : undefined,
      );
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        const finalMime = mimeType || "video/webm";
        const blob = new Blob(chunksRef.current, { type: finalMime });
        const durationSec = Math.floor(
          (Date.now() - startedAtRef.current) / 1000,
        );
        chunksRef.current = [];
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        // Keep a local download as a safety net while the cloud upload runs.
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        const date = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const ext = finalMime.includes("mp4") ? "mp4" : "webm";
        a.download = `whiteboard-${roomId}-${date}.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(objectUrl);

        await uploadToCloud(blob, finalMime, durationSec);
      };

      display.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (recorderRef.current?.state === "recording") stop();
      });

      recorder.start(1000);
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setState("recording");
    } catch (err) {
      toast.error(
        "Couldn't start recording: " +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  };

  const stop = () => {
    if (!recorderRef.current) return;
    setState("saving");
    recorderRef.current.stop();
    recorderRef.current = null;
  };

  if (state === "idle") {
    return (
      <button
        onClick={start}
        className="touch-target text-sm rounded-md border border-red-500/40 text-red-300 hover:bg-red-500/10 px-2.5 lg:px-3 py-1 flex items-center gap-1.5"
        title="Record this lesson — saves to cloud and downloads a backup MP4"
      >
        <span className="w-2 h-2 rounded-full bg-red-500" />
        <span className="hidden lg:inline">Record</span>
      </button>
    );
  }

  if (state === "recording") {
    return (
      <button
        onClick={stop}
        className="touch-target text-sm rounded-md bg-red-600 hover:bg-red-500 text-white px-2.5 lg:px-3 py-1 flex items-center gap-1.5"
        title="Stop and upload"
      >
        <span className="w-2 h-2 rounded-sm bg-white animate-pulse" />
        <span>{formatTime(elapsed)}</span>
        <span className="hidden lg:inline">Stop</span>
      </button>
    );
  }

  // saving
  return (
    <button
      disabled
      className="touch-target text-sm rounded-md border border-white/10 px-2.5 lg:px-3 py-1 flex items-center gap-1.5 opacity-90"
      title="Uploading recording to cloud"
    >
      <span className="inline-block w-3 h-3 rounded-full border-2 border-white/30 border-t-white animate-spin" />
      <span>{uploadPct > 0 ? `${uploadPct}%` : "Saving…"}</span>
    </button>
  );
}

function pickMimeType(): string | undefined {
  const candidates = [
    "video/mp4;codecs=avc1,mp4a.40.2",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  for (const t of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) {
      return t;
    }
  }
  return undefined;
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
