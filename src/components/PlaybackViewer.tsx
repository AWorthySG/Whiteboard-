"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowLeft } from "@phosphor-icons/react";
import type { Editor } from "tldraw";
import "tldraw/tldraw.css";

const Tldraw = dynamic(() => import("tldraw").then((m) => m.Tldraw), {
  ssr: false,
});

type Recording = {
  id: string;
  room_id: string;
  title: string | null;
  file_url: string;
  frames_url: string | null;
  duration_sec: number | null;
  recorded_at: string | null;
};

type Frame = { t: number; snapshot: unknown };

// Synchronised playback: video on top, whiteboard timeline below
// (or side-by-side on wide screens). Scrubbing the video binds the
// canvas to the most recent frame at or before the current video
// time. Frames are sparse (one every 5s, plus deduped no-op frames),
// so the canvas updates discretely — good enough to follow the
// lesson without the cost of replaying every event.
export default function PlaybackViewer({ recording }: { recording: Recording }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const [frames, setFrames] = useState<Frame[] | null>(null);
  const [framesErr, setFramesErr] = useState<string | null>(null);
  const [currentFrameIdx, setCurrentFrameIdx] = useState<number>(-1);
  const lastAppliedIdxRef = useRef<number>(-1);

  // Fetch + parse the JSONL frames file once.
  useEffect(() => {
    let cancelled = false;
    if (!recording.frames_url) {
      setFramesErr(
        "This recording has no synchronised whiteboard timeline (it was made before the feature shipped, or the timeline upload failed).",
      );
      return;
    }
    (async () => {
      try {
        const res = await fetch(recording.frames_url!);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        const parsed: Frame[] = [];
        for (const line of text.split("\n")) {
          if (!line.trim()) continue;
          try {
            parsed.push(JSON.parse(line));
          } catch {
            // Skip malformed lines rather than fail the whole file.
          }
        }
        parsed.sort((a, b) => a.t - b.t);
        if (!cancelled) setFrames(parsed);
      } catch (e) {
        if (!cancelled) setFramesErr((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recording.frames_url]);

  // Helper: binary-search the frame at or before `t` seconds.
  const frameIndexAt = useCallback(
    (t: number): number => {
      if (!frames || frames.length === 0) return -1;
      let lo = 0;
      let hi = frames.length - 1;
      let best = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (frames[mid].t <= t) {
          best = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return best;
    },
    [frames],
  );

  // Apply the matching snapshot whenever the active frame changes.
  // We don't apply on every video timeupdate tick — only when the
  // active index changes — so the canvas only redraws on real
  // transitions.
  useEffect(() => {
    if (currentFrameIdx < 0 || !frames) return;
    if (lastAppliedIdxRef.current === currentFrameIdx) return;
    const editor = editorRef.current;
    if (!editor) return;
    const snapshot = frames[currentFrameIdx].snapshot;
    try {
      (editor as unknown as { loadSnapshot(s: unknown): void }).loadSnapshot(
        snapshot as never,
      );
      lastAppliedIdxRef.current = currentFrameIdx;
    } catch (e) {
      console.warn("[playback] loadSnapshot failed", e);
    }
  }, [currentFrameIdx, frames]);

  // Subscribe to video timeupdate.
  const onTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const idx = frameIndexAt(v.currentTime);
    if (idx !== currentFrameIdx) setCurrentFrameIdx(idx);
  }, [frameIndexAt, currentFrameIdx]);

  // Pre-compute frame markers on the timeline scrubber so the user
  // can see where state changes occurred. Just a UI hint — purely
  // decorative.
  const markers = useMemo(() => {
    if (!frames || !recording.duration_sec) return [];
    return frames
      .filter((f) => f.t > 0 && f.t < (recording.duration_sec ?? Infinity))
      .map((f) => f.t / (recording.duration_sec ?? 1));
  }, [frames, recording.duration_sec]);

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] flex flex-col">
      <header className="border-b border-[color:var(--border-subtle)] px-4 py-3 flex items-center gap-3">
        <Link
          href={`/r/${encodeURIComponent(recording.room_id)}`}
          className="text-sm text-[var(--text-muted)] hover:text-[var(--text)] inline-flex items-center gap-1"
        >
          <ArrowLeft size={14} aria-hidden />
          Back to room
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-medium truncate">
            {recording.title ?? "Recording"}
          </h1>
          {recording.recorded_at && (
            <p className="text-xs text-[var(--text-dim)]">
              {new Date(recording.recorded_at).toLocaleString()}
            </p>
          )}
        </div>
        {frames && (
          <span className="text-xs text-[var(--text-dim)] tabular-nums">
            {frames.length} frame{frames.length === 1 ? "" : "s"}
          </span>
        )}
      </header>

      <div className="flex-1 flex flex-col xl:flex-row min-h-0">
        {/* Video — top on portrait, left on wide */}
        <div className="bg-black flex items-center justify-center xl:w-[55%] xl:border-r xl:border-[color:var(--border-subtle)]">
          <video
            ref={videoRef}
            src={recording.file_url}
            controls
            playsInline
            preload="metadata"
            onTimeUpdate={onTimeUpdate}
            onSeeked={onTimeUpdate}
            className="max-w-full max-h-[60vh] xl:max-h-screen"
          />
        </div>

        {/* Whiteboard timeline */}
        <div className="flex-1 relative min-h-[40vh]">
          {framesErr && (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
              <div className="max-w-md">
                <div className="text-3xl mb-3">⏱️</div>
                <p className="text-sm text-[var(--text-muted)]">{framesErr}</p>
                <p className="text-xs text-[var(--text-dim)] mt-3">
                  You can still watch the video above — the whiteboard
                  is visible inside it.
                </p>
              </div>
            </div>
          )}
          {!framesErr && !frames && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="inline-block w-8 h-8 border-2 border-[color:var(--border)] border-t-brand-500 rounded-full animate-spin" />
            </div>
          )}
          {!framesErr && frames && (
            <>
              <Tldraw
                onMount={(ed) => {
                  editorRef.current = ed;
                  ed.updateInstanceState({ isReadonly: true });
                  if (frames.length > 0) {
                    try {
                      (
                        ed as unknown as { loadSnapshot(s: unknown): void }
                      ).loadSnapshot(frames[0].snapshot as never);
                      lastAppliedIdxRef.current = 0;
                      setCurrentFrameIdx(0);
                    } catch (e) {
                      console.warn("[playback] initial snapshot failed", e);
                    }
                  }
                }}
                hideUi
              />
              {markers.length > 0 && (
                <div
                  className="absolute left-0 right-0 bottom-0 h-1 bg-black/10 pointer-events-none"
                  aria-hidden
                >
                  {markers.map((pct, i) => (
                    <span
                      key={i}
                      className="absolute top-0 w-px h-full bg-brand-500/70"
                      style={{ left: `${pct * 100}%` }}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
