"use client";

import { useEffect, useRef, useState } from "react";
import { useToast } from "./Toast";

type State = "idle" | "recording" | "saving";

export default function RecordButton({ roomId }: { roomId: string }) {
  const toast = useToast();
  const [state, setState] = useState<State>("idle");
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);

  useEffect(() => {
    if (state !== "recording") return;
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [state]);

  const start = async () => {
    try {
      // Capture the current tab (screen + tab audio) + the host's mic.
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
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: mimeType || "video/webm",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const date = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        const ext = (mimeType || "video/webm").includes("mp4") ? "mp4" : "webm";
        a.download = `whiteboard-${roomId}-${date}.${ext}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        chunksRef.current = [];
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setState("idle");
        setElapsed(0);
      };

      // Stop if the user revokes the screen-share permission.
      display.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (recorderRef.current?.state === "recording") stop();
      });

      recorder.start(1000); // gather chunks every second
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
        className="text-sm rounded-md border border-red-500/40 text-red-300 hover:bg-red-500/10 px-3 py-1 flex items-center gap-1.5"
        title="Record this lesson to a local MP4/WebM file"
      >
        <span className="w-2 h-2 rounded-full bg-red-500" />
        Record
      </button>
    );
  }

  if (state === "recording") {
    return (
      <button
        onClick={stop}
        className="text-sm rounded-md bg-red-600 hover:bg-red-500 text-white px-3 py-1 flex items-center gap-1.5"
        title="Stop and download"
      >
        <span className="w-2 h-2 rounded-sm bg-white animate-pulse" />
        Stop · {formatTime(elapsed)}
      </button>
    );
  }

  return (
    <button
      disabled
      className="text-sm rounded-md border border-white/10 px-3 py-1 opacity-60"
    >
      Saving…
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
