"use client";

import { useEffect, useRef, useState } from "react";
import {
  CaretDown,
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
  onStateChange,
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
  // Fires on every state transition (idle → recording → paused →
  // saving → idle). Parent uses this for cosmetic affordances like
  // the canvas inset border + REC badge. Optional — recording works
  // without a listener.
  onStateChange?: (state: State) => void;
}) {
  const toast = useToast();
  const [state, setState] = useState<State>("idle");
  // Fire onStateChange whenever the recorder transitions so parent
  // components (RoomShell) can update cosmetic affordances like the
  // canvas inset border. Effect dep on state keeps this in sync
  // even if the recorder mutates state in a tight loop.
  useEffect(() => {
    onStateChange?.(state);
  }, [state, onStateChange]);
  const [elapsed, setElapsed] = useState(0);
  const [uploadPct, setUploadPct] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // Wall-clock duration accounting. `activeMsRef` accumulates completed
  // non-paused segments; `segmentStartRef` marks the start of the current
  // active segment (0 while paused/stopped). Duration is derived from
  // these timestamps, NOT from the 1 s display interval — browsers
  // throttle setInterval to ~once/min in a backgrounded tab, so an
  // interval-counted duration would badly undercount a lesson recorded
  // while the host worked in another window (and PlaybackViewer would
  // then drop real frames whose t exceeds the undercounted duration).
  const activeMsRef = useRef<number>(0);
  const segmentStartRef = useRef<number>(0);
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
    // Drive the visible counter from wall-clock active time so it
    // self-corrects after the tab was backgrounded (a throttled interval
    // would otherwise show a frozen/slow count). Inlined rather than
    // sharing a helper so this effect's deps stay just [state].
    const tick = () =>
      setElapsed(
        Math.floor(
          (activeMsRef.current +
            (segmentStartRef.current
              ? Date.now() - segmentStartRef.current
              : 0)) /
            1000,
        ),
      );
    tick();
    const id = window.setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [state]);

  // Release active media tracks when the component unmounts mid-recording
  // (e.g. React navigation) so the OS camera/mic indicator turns off.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  const togglePause = () => {
    const rec = recorderRef.current;
    if (!rec) return;
    if (state === "recording" && rec.state === "recording") {
      try {
        rec.pause();
        // Close the current active segment into the running total.
        if (segmentStartRef.current) {
          activeMsRef.current += Date.now() - segmentStartRef.current;
          segmentStartRef.current = 0;
        }
        setState("paused");
      } catch (e) {
        console.warn("[record] pause failed", e);
      }
    } else if (state === "paused" && rec.state === "paused") {
      try {
        rec.resume();
        // Open a new active segment.
        segmentStartRef.current = Date.now();
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
          return null;
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

  // preferTab biases the OS picker toward the current browser tab, so a
  // one-click "record the whiteboard" captures the canvas (+ the tab's
  // audio, which includes remote LiveKit participants playing in-page)
  // without the host hunting through the window list. preferCurrentTab
  // is a Chromium hint; other browsers ignore it and fall back to the
  // normal picker, so this degrades safely.
  const start = async (preferTab = false) => {
    setMenuOpen(false);
    if (!recordingSupported()) {
      toast.error(
        "Screen recording isn't supported on this browser. Try Chrome, Edge, or Firefox on desktop.",
      );
      return;
    }
    try {
      const constraints: DisplayMediaStreamOptions & {
        preferCurrentTab?: boolean;
      } = {
        video: { frameRate: 30 },
        audio: true,
      };
      if (preferTab) constraints.preferCurrentTab = true;
      const display =
        await navigator.mediaDevices.getDisplayMedia(constraints);
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
        // Close the final active segment, then derive duration from
        // accumulated wall-clock active time — pauses excluded and safe
        // against background-tab interval throttling.
        if (segmentStartRef.current) {
          activeMsRef.current += Date.now() - segmentStartRef.current;
          segmentStartRef.current = 0;
        }
        const durationSec = Math.round(activeMsRef.current / 1000);
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
        // Safari fetches the blob URL asynchronously after click(); revoking
        // immediately produces an empty download on Safari. 1 s is enough
        // since the blob is in memory (no network fetch).
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);

        await uploadToCloud(blob, finalMime, durationSec);
      };

      display.getVideoTracks()[0]?.addEventListener("ended", () => {
        const s = recorderRef.current?.state;
        if (s === "recording" || s === "paused") stop();
      });

      activeMsRef.current = 0;
      segmentStartRef.current = Date.now();
      setElapsed(0);
      recorder.start(1000);
      recorderRef.current = recorder;
      // Generate the id once, here, so the upload path and the
      // parent-side frame capture both label data with the same id.
      recordingIdRef.current = crypto.randomUUID();
      setState("recording");
      onRecordingStarted?.(recordingIdRef.current);
    } catch (err) {
      // If display/mic tracks were acquired before the failure (e.g. the
      // MediaRecorder constructor threw on an unsupported mimeType), stop
      // them so the OS screen-share/mic indicator turns off and the next
      // start() doesn't overwrite streamRef and orphan them.
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
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
      <div ref={menuRef} className="relative flex items-center">
        {/* Primary: record the whiteboard tab itself (the canvas). */}
        <button
          onClick={() => start(true)}
          className="touch-target text-sm rounded-l-md border border-danger-600 text-danger-700 hover:bg-danger-50 px-2.5 lg:px-3 py-1 flex items-center gap-1.5"
          title="Record the whiteboard — captures this tab plus everyone's audio, saves to the cloud, and downloads a backup"
        >
          <RecordIcon weight="fill" aria-hidden size={14} className="text-danger-600" />
          <span className="hidden lg:inline">Record</span>
        </button>
        {/* Caret: pick what to capture (whiteboard tab vs full screen). */}
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="touch-target text-sm rounded-r-md border border-l-0 border-danger-600 text-danger-700 hover:bg-danger-50 px-1.5 py-1 flex items-center"
          aria-label="Recording options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="Recording options"
        >
          <CaretDown aria-hidden size={12} weight="bold" />
        </button>
        {menuOpen && (
          <div
            role="menu"
            className="absolute right-0 top-full mt-1 w-60 rounded-lg bg-[var(--bg)] border border-[color:var(--border)] shadow-2xl p-1 z-50"
          >
            <RecordModeItem
              onClick={() => start(true)}
              title="Record whiteboard"
              subtitle="This tab — the canvas and call audio"
            />
            <RecordModeItem
              onClick={() => start(false)}
              title="Record screen or window…"
              subtitle="Pick any screen, window, or tab"
            />
          </div>
        )}
      </div>
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

function RecordModeItem({
  onClick,
  title,
  subtitle,
}: {
  onClick: () => void;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="w-full text-left rounded-md px-2 py-1.5 hover:bg-[var(--hover)]"
    >
      <div className="text-sm text-[var(--text)]">{title}</div>
      <div className="text-xs text-[var(--text-muted)]">{subtitle}</div>
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
