"use client";

import { useEffect, useRef, useState } from "react";
import {
  Pause,
  Play,
  Record as RecordIcon,
} from "@phosphor-icons/react";
import { useToast } from "./Toast";
import { getSupabase } from "@/lib/supabase";

type State = "idle" | "recording" | "paused" | "saving";

// XHR uploads with no timeout can hang forever on flaky networks,
// stranding the host in 'saving' state with no recovery short of a
// page refresh. 90s is generous for typical recordings; if it's
// genuinely a slow upload of a long lesson, the user can re-try.
const UPLOAD_TIMEOUT_MS = 90_000;

// Browsers without screen capture support: iPhone Safari (no
// getDisplayMedia at all), some embedded WebViews, and pre-2020
// browsers. We render a clear 'unsupported' button rather than a
// dead one that silently does nothing. Telegram WebApp is also
// in this bucket — its WebView blocks getDisplayMedia entirely,
// so we hide the button rather than offering a control that
// always errors when tapped.
function recordingSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (!("MediaRecorder" in window)) return false;
  const md = navigator?.mediaDevices as MediaDevices | undefined;
  if (!md || typeof md.getDisplayMedia !== "function") return false;
  // Running inside Telegram Mini App → no screen capture available.
  if (window.Telegram?.WebApp?.initData) return false;
  return true;
}

function inTelegramWebApp(): boolean {
  if (typeof window === "undefined") return false;
  return !!window.Telegram?.WebApp?.initData;
}

export default function RecordButton({
  roomId,
  hostUserId,
  hostName,
  roomTitle,
  onRecordingStarted,
  onRecordingFinished,
}: {
  roomId: string;
  hostUserId: string;
  hostName: string;
  roomTitle: string;
  // Lets the parent capture a synchronised whiteboard timeline
  // alongside the screen recording. Started fires when the user
  // grants screen-capture permission and the MediaRecorder is live;
  // finished fires after the video has uploaded AND the row has
  // been inserted, so the parent can attach companion data
  // (frames.jsonl) to the same recording id.
  onRecordingStarted?: (recordingId: string) => void;
  onRecordingFinished?: (recordingId: string) => void;
}) {
  const toast = useToast();
  const [state, setState] = useState<State>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [uploadPct, setUploadPct] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  // Recording id is generated upfront (before any upload) so the
  // parent's frame capture can label its data with the same id from
  // the very first second — no waiting for the video upload to
  // complete before frames know where they belong.
  const recordingIdRef = useRef<string>("");

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

  const togglePause = () => {
    const rec = recorderRef.current;
    if (!rec) return;
    if (state === "recording" && rec.state === "recording") {
      try {
        rec.pause();
        setState("paused");
      } catch (e) {
        console.warn("[record] pause failed", e);
      }
    } else if (state === "paused" && rec.state === "paused") {
      try {
        rec.resume();
        setState("recording");
      } catch (e) {
        console.warn("[record] resume failed", e);
      }
    }
  };

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
        xhr.timeout = UPLOAD_TIMEOUT_MS;
        xhr.ontimeout = () =>
          reject(
            new Error(
              `Upload timed out after ${UPLOAD_TIMEOUT_MS / 1000}s — your connection may be unstable. The recording is saved locally as a backup file.`,
            ),
          );
        xhr.send(blob);
      });

      // Save metadata row using the pre-generated id so the parent's
      // frame capture (if any) can attach to the same recording.
      const supabase = getSupabase();
      if (supabase) {
        const date = new Date();
        const title =
          (roomTitle?.trim() || roomId) +
          " · " +
          date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
        const { error: dbErr } = await supabase
          .from("room_recordings")
          .insert({
            id: recordingIdRef.current,
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
        if (dbErr) {
          console.error("[record] metadata insert failed", dbErr);
          // File is in Storage but no recordings row references it —
          // orphan cleanup. Best-effort: if the delete fails the file
          // will hang around but the user already got the toast.
          void supabase.storage
            .from("whiteboard-recordings")
            .remove([path]);
          toast.error(
            `Recording couldn't be listed: ${dbErr.message}. The file was removed; please re-record.`,
          );
        } else {
          // Tell the parent the recording row exists — it can now
          // upload its companion whiteboard timeline.
          onRecordingFinished?.(recordingIdRef.current);
        }
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
    if (!recordingSupported()) {
      toast.error(
        "Screen recording isn't supported on this browser. Try Chrome, Edge, or Firefox on desktop.",
      );
      return;
    }
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
      // Generate the id once, here, so the upload path and the
      // parent-side frame capture both label data with the same id.
      recordingIdRef.current = crypto.randomUUID();
      setState("recording");
      onRecordingStarted?.(recordingIdRef.current);
    } catch (err) {
      console.error("[record] start failed", err);
      const e = err as { name?: string; message?: string };
      const name = e?.name ?? "";
      const message = e?.message ?? String(err);
      let hint = message;
      if (name === "NotAllowedError") {
        hint =
          "Permission denied. Click 'Allow' in the browser prompt — and on macOS check System Settings → Privacy & Security → Screen Recording.";
      } else if (name === "NotFoundError") {
        hint = "No screen/window was selected to share.";
      } else if (name === "NotSupportedError") {
        hint = "This browser doesn't support screen recording.";
      } else if (name === "AbortError") {
        hint = "Recording was cancelled before it started.";
      }
      toast.error(`Couldn't start recording: ${hint}`);
    }
  };

  const stop = () => {
    if (!recorderRef.current) return;
    setState("saving");
    recorderRef.current.stop();
    recorderRef.current = null;
  };

  if (state === "idle") {
    const supported = recordingSupported();
    if (!supported) {
      // In Telegram Mini App, hide the button completely — there's no
      // path forward (no getDisplayMedia, no fallback), so a disabled
      // tap target just clutters the header. Elsewhere we keep a
      // greyed-out chip so the user understands recording is an
      // option, just not on this browser.
      if (inTelegramWebApp()) return null;
      return (
        <button
          onClick={() =>
            toast.error(
              "Screen recording isn't supported on this browser. Use Chrome, Edge, or Firefox on desktop.",
            )
          }
          className="touch-target text-sm rounded-md border border-[color:var(--border)] text-[var(--text-muted)] px-2.5 lg:px-3 py-1 flex items-center gap-1.5 opacity-60"
          title="Screen recording isn't supported on this browser/device"
        >
          <span className="w-2 h-2 rounded-full bg-[var(--text-muted)]" />
          <span className="hidden lg:inline">Record (n/a)</span>
        </button>
      );
    }
    return (
      <button
        onClick={start}
        className="touch-target text-sm rounded-md border border-danger-600 text-danger-700 hover:bg-danger-50 px-2.5 lg:px-3 py-1 flex items-center gap-1.5"
        title="Record this lesson — saves to cloud and downloads a backup MP4"
      >
        <RecordIcon weight="fill" aria-hidden size={14} className="text-danger-600" />
        <span className="hidden lg:inline">Record</span>
      </button>
    );
  }

  if (state === "recording" || state === "paused") {
    const paused = state === "paused";
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={stop}
          className="touch-target text-sm rounded-md bg-danger-600 hover:bg-danger-500 text-white px-2.5 lg:px-3 py-1 flex items-center gap-1.5"
          title="Stop and upload"
        >
          <span
            className={`w-2 h-2 rounded-sm bg-white ${paused ? "" : "animate-pulse"}`}
          />
          <span className="tabular-nums">{formatTime(elapsed)}</span>
          <span className="hidden lg:inline">Stop</span>
        </button>
        <button
          onClick={togglePause}
          className={`touch-target text-sm rounded-md border px-2.5 py-1 flex items-center gap-1.5 ${
            paused
              ? "border-amber-600 text-amber-700 bg-amber-50"
              : "border-[color:var(--border)] text-[var(--text-muted)] hover:bg-[var(--hover)]"
          }`}
          title={paused ? "Resume recording" : "Pause recording"}
          aria-pressed={paused}
        >
          {paused ? (
            <>
              <Play weight="fill" aria-hidden size={14} />
              <span className="hidden lg:inline">Resume</span>
            </>
          ) : (
            <>
              <Pause weight="fill" aria-hidden size={14} />
              <span className="hidden lg:inline">Pause</span>
            </>
          )}
        </button>
      </div>
    );
  }

  // saving — show a visual fill across the bottom of the button so
  // the user can see at a glance whether progress is happening or
  // the upload has stalled.
  return (
    <button
      disabled
      className="touch-target relative overflow-hidden text-sm rounded-md border border-[color:var(--border)] px-2.5 lg:px-3 py-1 flex items-center gap-1.5 opacity-90"
      title="Uploading recording to cloud"
    >
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-0.5 bg-danger-600 transition-[width] duration-300"
        style={{ width: `${Math.max(2, uploadPct)}%` }}
      />
      <span className="inline-block w-3 h-3 rounded-full border-2 border-[color:var(--border)] border-t-[var(--text)] animate-spin" />
      <span className="tabular-nums">
        {uploadPct > 0 ? `${uploadPct}%` : "Saving…"}
      </span>
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
