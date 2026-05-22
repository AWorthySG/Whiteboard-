"use client";

import "@livekit/components-styles";
import {
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useDataChannel,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import { Track, type LocalTrack } from "livekit-client";
import {
  BellSlash,
  Check,
  Hand,
  Microphone,
  MicrophoneSlash,
  Monitor,
  SignOut,
  VideoCamera,
  VideoCameraSlash,
  X,
} from "@phosphor-icons/react";
import CaptionsManager from "./CaptionsManager";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSettings } from "@/hooks/useSettings";
import { useToast } from "./Toast";

export default function VideoPanel({
  roomId,
  userId,
  userName,
  isHost,
  captionsEnabled,
  onCaption,
}: {
  roomId: string;
  userId: string;
  userName: string;
  isHost: boolean;
  captionsEnabled?: boolean;
  onCaption?: (line: import("./CaptionsManager").CaptionLine) => void;
}) {
  const [settings] = useSettings();
  const [token, setToken] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialAutoJoin = useMemo(() => settings.autoJoinCall, []);
  // Camera respects the audio-only setting on first join — if the user
  // has audio-only enabled, never even ask for camera permission.
  const initialCamera = useMemo(
    () => settings.defaultCamera && !settings.audioOnly,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialMic = useMemo(() => settings.defaultMicrophone, []);
  const [inCall, setInCall] = useState(initialAutoJoin);
  // Track whether the user chose to join audio-only — separate from
  // the setting so we can flip it per-call without persisting.
  const [audioOnlyMode, setAudioOnlyMode] = useState(settings.audioOnly);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/livekit/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room: roomId, name: userName, userId }),
        });
        if (!res.ok) throw new Error(`Token request failed (${res.status})`);
        const data = (await res.json()) as { token: string; url: string };
        if (!cancelled) {
          setToken(data.token);
          setServerUrl(data.url);
        }
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Failed to join call");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId, userName, userId]);

  if (error) {
    return (
      <div role="alert" className="p-4 text-sm text-danger-700">
        Couldn't connect to video: {error}
        <p className="mt-2 text-[var(--text-dim)]">
          Make sure{" "}
          <code className="bg-[var(--bg)] rounded px-1">LIVEKIT_API_KEY</code>,{" "}
          <code className="bg-[var(--bg)] rounded px-1">LIVEKIT_API_SECRET</code>,
          and{" "}
          <code className="bg-[var(--bg)] rounded px-1">NEXT_PUBLIC_LIVEKIT_URL</code>{" "}
          are set.
        </p>
      </div>
    );
  }

  if (!token || !serverUrl) {
    return <div className="p-4 text-sm text-[var(--text-muted)]">Joining call…</div>;
  }

  if (!inCall) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-2 p-6 text-center">
        <p className="text-sm text-[var(--text-muted)]">
          You've left the call. You're still in the whiteboard.
        </p>
        <button
          onClick={() => {
            setAudioOnlyMode(false);
            setInCall(true);
          }}
          className="touch-target w-full max-w-[14rem] rounded-md bg-brand-600 hover:bg-brand-500 text-white px-4 py-2 text-sm font-medium"
        >
          Rejoin with video
        </button>
        <button
          onClick={() => {
            setAudioOnlyMode(true);
            setInCall(true);
          }}
          className="touch-target w-full max-w-[14rem] rounded-md border border-[color:var(--border)] hover:bg-[var(--hover)] px-4 py-2 text-sm font-medium"
        >
          Rejoin audio only
        </button>
        <p className="text-xs text-[var(--text-dim)] mt-1">
          Audio-only saves bandwidth on phone data.
        </p>
      </div>
    );
  }

  return (
    <LiveKitRoom
      token={token}
      serverUrl={serverUrl}
      connect={inCall}
      video={audioOnlyMode ? false : initialCamera}
      audio={initialMic}
      data-lk-theme="default"
      style={{ height: "100%" }}
      onDisconnected={() => setInCall(false)}
      options={{
        // Release the local microphone hardware when the user mutes,
        // so the system mic indicator turns off.
        publishDefaults: { stopMicTrackOnMute: true },
      }}
    >
      <div className="flex flex-col h-full">
        <div className="flex-1 min-h-0">
          <Tiles />
        </div>
        <RoomAudioRenderer />
        <CameraReleaseGuard />
        {onCaption && (
          <CaptionsManager
            userName={userName}
            enabled={!!captionsEnabled}
            onCaption={onCaption}
          />
        )}
        <RoomCoordinatorBar isHost={isHost} userName={userName} />
      </div>
    </LiveKitRoom>
  );
}

function Tiles() {
  const participants = useParticipants();
  // Local dismissal of the 'alone in call' pill. The pill re-shows
  // naturally if the host is left alone again later in the same
  // session (e.g. last student dropped off), since participants.length
  // returning to 1 doesn't carry the dismissal forward — but a single
  // click silences it for the current 'alone' streak, which is what
  // the user actually wanted.
  const [dismissedAt, setDismissedAt] = useState<number>(0);
  // Re-arm the pill whenever someone else joins — so the next time
  // the host is alone, the hint reappears.
  useEffect(() => {
    if (participants.length > 1 && dismissedAt > 0) setDismissedAt(0);
  }, [participants.length, dismissedAt]);
  const tracks = useTracks(
    [
      // withPlaceholder ensures every participant gets a tile even if
      // their camera is off — so the host can always see who's joined.
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  return (
    <div className="relative h-full">
      {/* Participant count badge — gives the host instant feedback
          that the call has more than one person, even when remote
          tiles are scrolled out of view. */}
      <div className="absolute top-2 left-2 z-10 text-[10px] font-medium uppercase tracking-wider bg-black/60 text-white rounded px-1.5 py-0.5 pointer-events-none">
        {participants.length} in call
      </div>
      <GridLayout tracks={tracks} style={{ height: "100%" }}>
        <ParticipantTile />
      </GridLayout>
      {participants.length === 1 && dismissedAt === 0 && (
        // Compact chip, centred low in the tile. Was a full-width
        // dark banner — the old version overlapped the new unified
        // toolbar on phone portrait. The whole pill is now clickable
        // (and has an explicit × hit target) so the user can dismiss
        // it once they know they're alone.
        <button
          type="button"
          onClick={() => setDismissedAt(Date.now())}
          className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 text-[11px] text-white/90 bg-black/55 rounded-full pl-2.5 pr-1.5 py-0.5 whitespace-nowrap inline-flex items-center gap-1.5 hover:bg-black/70 transition-colors"
          aria-label="Dismiss 'alone in call' hint"
          title="Dismiss"
        >
          Alone in the call · share the invite link
          <X size={11} aria-hidden className="opacity-70" />
        </button>
      )}
    </div>
  );
}

// Coordinates "raise hand" + "mute all" messages between participants via
// the LiveKit data channel. Each client tracks its own raised state plus
// the latest known state of everyone else.
type DataMsg =
  | { type: "hand"; up: boolean; name: string }
  | { type: "mute-request" }
  | { type: "reaction"; emoji: string; name: string };

// Pool of quick reactions surfaced in the bar. Order chosen so the
// most common (got it, question, fun) sit left → right.
const REACTIONS = ["👍", "❓", "🎉"] as const;

// Single unified control bar. Replaces the previous two-tier UI
// (LiveKit ControlBar + RoomCoordinator), so phone/tablet users get
// one row of thumb-reachable controls instead of stacked bars eating
// 2× the vertical space.
//
// Layout (left → right): mic | camera | screen-share (desktop only) |
// raise-hand | host-only Mute all | spacer | red Leave.
// Above the bar, two stacks may appear:
//  - raised-hands list when non-empty
//  - 'Sent mute request' / 'mute all' two-tap confirmation chip
function RoomCoordinatorBar({
  isHost,
  userName,
}: {
  isHost: boolean;
  userName: string;
}) {
  const room = useRoomContext();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } =
    useLocalParticipant();
  const toast = useToast();
  const [handUp, setHandUp] = useState(false);
  const [muteAllArmed, setMuteAllArmed] = useState(false);
  const muteAllArmedTimer = useRef<number | null>(null);
  const [raisedHands, setRaisedHands] = useState<
    Map<string, { name: string; up: boolean }>
  >(() => new Map());
  // Active floating reactions — each one auto-removes after 2s.
  const [reactions, setReactions] = useState<
    { id: number; emoji: string; name: string }[]
  >([]);

  const { send } = useDataChannel((msg) => {
    try {
      const payload = JSON.parse(new TextDecoder().decode(msg.payload)) as DataMsg;
      const fromIdentity = msg.from?.identity ?? "unknown";
      const fromName = msg.from?.name ?? "Someone";
      if (payload.type === "hand") {
        setRaisedHands((prev) => {
          const next = new Map(prev);
          if (payload.up) next.set(fromIdentity, { name: payload.name || fromName, up: true });
          else next.delete(fromIdentity);
          return next;
        });
        if (payload.up && isHost) toast.info(`✋ ${payload.name || fromName} raised their hand`);
      } else if (payload.type === "reaction") {
        const id = Date.now() + Math.random();
        const display = { id, emoji: payload.emoji, name: payload.name || fromName };
        setReactions((prev) => [...prev, display]);
        window.setTimeout(
          () => setReactions((prev) => prev.filter((r) => r.id !== id)),
          2400,
        );
      } else if (payload.type === "mute-request") {
        if (localParticipant.isMicrophoneEnabled) {
          void localParticipant.setMicrophoneEnabled(false);
          toast.info(`Muted by ${fromName}`);
        }
      }
    } catch {
      // ignore malformed
    }
  });

  const sendMsg = (msg: DataMsg) => {
    const bytes = new TextEncoder().encode(JSON.stringify(msg));
    void send(bytes, { reliable: true });
  };

  const sendReaction = (emoji: string) => {
    sendMsg({ type: "reaction", emoji, name: userName });
    // Mirror it locally so the sender sees their own bubble too.
    const id = Date.now() + Math.random();
    setReactions((prev) => [...prev, { id, emoji, name: userName }]);
    window.setTimeout(
      () => setReactions((prev) => prev.filter((r) => r.id !== id)),
      2400,
    );
  };

  const toggleHand = () => {
    const next = !handUp;
    setHandUp(next);
    sendMsg({ type: "hand", up: next, name: userName });
    if (next) toast.info("Hand raised");
  };

  // Two-tap mute-all (matches the ConfirmButton pattern used in the
  // drawers — window.confirm() is bypassed on iOS WebViews).
  const armMuteAll = () => {
    if (muteAllArmed) {
      // Confirm tap.
      sendMsg({ type: "mute-request" });
      toast.success("Sent mute request to all participants");
      setMuteAllArmed(false);
      if (muteAllArmedTimer.current !== null) {
        window.clearTimeout(muteAllArmedTimer.current);
        muteAllArmedTimer.current = null;
      }
      return;
    }
    setMuteAllArmed(true);
    muteAllArmedTimer.current = window.setTimeout(() => {
      setMuteAllArmed(false);
      muteAllArmedTimer.current = null;
    }, 4000);
  };

  const lowerHand = (identity: string) => {
    setRaisedHands((prev) => {
      const next = new Map(prev);
      next.delete(identity);
      return next;
    });
  };

  // Clean up our own raise state on unmount.
  useEffect(() => {
    return () => {
      if (handUp) sendMsg({ type: "hand", up: false, name: userName });
      if (muteAllArmedTimer.current !== null) {
        window.clearTimeout(muteAllArmedTimer.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onLeave = () => {
    void room.disconnect();
  };

  return (
    <div className="relative border-t border-[color:var(--border)] bg-[var(--bg-elev)] text-[var(--text)]">
      {/* Floating reactions — anchored to the top of the bar and
          animate up out of frame. pointer-events-none so they
          don't block toolbar taps. */}
      {reactions.length > 0 && (
        <div
          className="absolute left-0 right-0 bottom-full pointer-events-none flex flex-wrap justify-center gap-x-2 gap-y-1 px-3 pb-2"
          aria-live="polite"
        >
          {reactions.map((r) => (
            <span
              key={r.id}
              className="inline-flex items-center gap-1 bg-black/65 text-white rounded-full px-2 py-0.5 text-xs animate-[reactionRise_2.4s_ease-out_forwards]"
            >
              <span aria-hidden className="text-base leading-none">
                {r.emoji}
              </span>
              <span className="truncate max-w-[8rem]">{r.name}</span>
            </span>
          ))}
        </div>
      )}
      {raisedHands.size > 0 && (
        <ul className="max-h-28 overflow-y-auto px-2 pt-2 pb-1 space-y-1 text-sm">
          {[...raisedHands.entries()].map(([id, info]) => (
            <li
              key={id}
              className="flex items-center gap-2 bg-amber-50 border border-amber-300 rounded-md px-2 py-1"
            >
              <Hand weight="fill" aria-hidden className="text-amber-700 shrink-0" />
              <span className="flex-1 truncate text-amber-900">{info.name}</span>
              {isHost && (
                <button
                  onClick={() => lowerHand(id)}
                  className="text-xs text-amber-800 hover:text-amber-950 font-medium"
                >
                  Lower
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div
        role="toolbar"
        aria-label="Call controls"
        className="flex items-center gap-1 px-1.5 py-1.5 overflow-x-auto"
      >
        <BarButton
          label={isMicrophoneEnabled ? "Mute mic" : "Unmute mic"}
          icon={
            isMicrophoneEnabled ? (
              <Microphone weight="fill" />
            ) : (
              <MicrophoneSlash weight="fill" />
            )
          }
          active={isMicrophoneEnabled}
          onClick={() =>
            void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)
          }
        />
        <BarButton
          label={isCameraEnabled ? "Camera off" : "Camera on"}
          icon={
            isCameraEnabled ? (
              <VideoCamera weight="fill" />
            ) : (
              <VideoCameraSlash weight="fill" />
            )
          }
          active={isCameraEnabled}
          onClick={() =>
            void localParticipant.setCameraEnabled(!isCameraEnabled)
          }
        />
        {/* Screen-share hidden on small viewports — mobile browsers
            can't share screen, and the button just errored. */}
        <BarButton
          label={isScreenShareEnabled ? "Stop sharing" : "Share screen"}
          icon={<Monitor weight="fill" />}
          active={isScreenShareEnabled}
          onClick={() =>
            void localParticipant.setScreenShareEnabled(!isScreenShareEnabled)
          }
          className="hidden md:inline-flex"
        />
        <BarButton
          label={handUp ? "Lower hand" : "Raise hand"}
          icon={<Hand weight="fill" />}
          active={handUp}
          activeClass="bg-amber-500 text-black border-amber-400"
          onClick={toggleHand}
        />
        {isHost && (
          <BarButton
            label={muteAllArmed ? "Tap to confirm" : "Mute all"}
            icon={
              muteAllArmed ? (
                <Check weight="bold" />
              ) : (
                <BellSlash weight="fill" />
              )
            }
            active={muteAllArmed}
            activeClass="bg-amber-500 text-black border-amber-400"
            onClick={armMuteAll}
            collapseTextBelow="sm"
          />
        )}
        {/* Quick reactions — small icon-only chips so they don't
            crowd the main controls. Each click broadcasts via
            the data channel and mirrors locally. */}
        {REACTIONS.map((r) => (
          <button
            key={r}
            onClick={() => sendReaction(r)}
            aria-label={`Send ${r} reaction`}
            title={`Send ${r}`}
            className="shrink-0 inline-flex items-center justify-center rounded-md border border-[color:var(--border)] hover:bg-[var(--hover)] min-w-[36px] min-h-[40px] text-base"
          >
            <span aria-hidden>{r}</span>
          </button>
        ))}
        <span className="flex-1" />
        <BarButton
          label="Leave call"
          icon={<SignOut weight="fill" />}
          onClick={onLeave}
          className="bg-danger-600 text-white border-danger-600 hover:bg-danger-500"
          collapseTextBelow="sm"
        />
      </div>
    </div>
  );
}

// Single icon+label button used in the unified bar so every control
// has the same touch target and visual rhythm. The icon is a React
// node (Phosphor component) — sized via the wrapper so we don't
// re-style every call site.
function BarButton({
  label,
  icon,
  active,
  activeClass,
  onClick,
  className,
  collapseTextBelow,
}: {
  label: string;
  icon: ReactNode;
  active?: boolean;
  activeClass?: string;
  onClick: () => void;
  className?: string;
  // Hide the text label below this Tailwind breakpoint so very narrow
  // viewports collapse to icon-only. Default: 'md' — text disappears
  // on phone-sized screens. Use 'sm' for less-important buttons that
  // should keep their text longer.
  collapseTextBelow?: "sm" | "md";
}) {
  const hideText =
    collapseTextBelow === "sm" ? "hidden sm:inline" : "hidden md:inline";
  const stateClass =
    active && activeClass
      ? activeClass
      : active
        ? "bg-brand-600 text-white border-brand-600"
        : "border-[color:var(--border)] text-[var(--text)] hover:bg-[var(--hover)]";
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`touch-target shrink-0 inline-flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm min-w-[44px] min-h-[40px] ${stateClass} ${className ?? ""}`}
    >
      <span aria-hidden className="text-[18px] leading-none inline-flex">
        {icon}
      </span>
      <span className={hideText}>{label}</span>
    </button>
  );
}

// When the user disables their camera via the LiveKit ControlBar,
// LiveKit's default behaviour only mutes the track — the underlying
// MediaStreamTrack stays alive, so the OS camera indicator (the
// little green light on macOS) keeps glowing. This guard watches the
// camera-enabled state and explicitly stop()s the local camera track
// after disable, releasing the hardware. Re-enabling re-creates the
// track automatically.
function CameraReleaseGuard() {
  const { localParticipant, isCameraEnabled } = useLocalParticipant();
  useEffect(() => {
    if (isCameraEnabled || !localParticipant) return;
    const pub = localParticipant.getTrackPublication(Track.Source.Camera);
    const track = pub?.track as LocalTrack | undefined;
    if (track && track.mediaStreamTrack?.readyState === "live") {
      // Defer slightly so LiveKit finishes its mute handshake first.
      const id = setTimeout(() => {
        try {
          track.stop();
        } catch {
          // ignore — track may already be released
        }
      }, 150);
      return () => clearTimeout(id);
    }
  }, [isCameraEnabled, localParticipant]);
  return null;
}
