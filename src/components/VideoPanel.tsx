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
import CaptionsManager from "./CaptionsManager";
import { useEffect, useMemo, useRef, useState } from "react";
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
  const initialAutoJoin = useMemo(() => settings.autoJoinCall, []);
  // Camera respects the audio-only setting on first join — if the user
  // has audio-only enabled, never even ask for camera permission.
  const initialCamera = useMemo(
    () => settings.defaultCamera && !settings.audioOnly,
    [],
  );
  const initialMic = useMemo(() => settings.defaultMicrophone, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
      <div role="alert" className="p-4 text-sm text-red-700">
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
      {participants.length === 1 && (
        // Compact chip, centred low in the tile. Was a full-width
        // dark banner — the old version overlapped the new unified
        // toolbar on phone portrait.
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 text-[11px] text-white/90 bg-black/55 rounded-full px-2.5 py-0.5 pointer-events-none whitespace-nowrap">
          Alone in the call · share the invite link
        </div>
      )}
    </div>
  );
}

// Coordinates "raise hand" + "mute all" messages between participants via
// the LiveKit data channel. Each client tracks its own raised state plus
// the latest known state of everyone else.
type DataMsg =
  | { type: "hand"; up: boolean; name: string }
  | { type: "mute-request" };

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
    <div className="border-t border-[color:var(--border)] bg-[var(--bg-elev)] text-[var(--text)]">
      {raisedHands.size > 0 && (
        <ul className="max-h-28 overflow-y-auto px-2 pt-2 pb-1 space-y-1 text-sm">
          {[...raisedHands.entries()].map(([id, info]) => (
            <li
              key={id}
              className="flex items-center gap-2 bg-amber-50 border border-amber-300 rounded-md px-2 py-1"
            >
              <span aria-hidden>✋</span>
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
          icon={isMicrophoneEnabled ? "🎤" : "🔇"}
          active={isMicrophoneEnabled}
          onClick={() =>
            void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)
          }
        />
        <BarButton
          label={isCameraEnabled ? "Camera off" : "Camera on"}
          icon={isCameraEnabled ? "📷" : "🚫"}
          active={isCameraEnabled}
          onClick={() =>
            void localParticipant.setCameraEnabled(!isCameraEnabled)
          }
        />
        {/* Screen-share hidden on small viewports — mobile browsers
            can't share screen, and the button just errored. */}
        <BarButton
          label={isScreenShareEnabled ? "Stop sharing" : "Share screen"}
          icon="🖥"
          active={isScreenShareEnabled}
          onClick={() =>
            void localParticipant.setScreenShareEnabled(!isScreenShareEnabled)
          }
          className="hidden md:inline-flex"
        />
        <BarButton
          label={handUp ? "Lower hand" : "Raise hand"}
          icon="✋"
          active={handUp}
          activeClass="bg-amber-500 text-black border-amber-400"
          onClick={toggleHand}
        />
        {isHost && (
          <BarButton
            label={muteAllArmed ? "Tap to confirm" : "Mute all"}
            icon={muteAllArmed ? "✓" : "🔕"}
            active={muteAllArmed}
            activeClass="bg-amber-500 text-black border-amber-400"
            onClick={armMuteAll}
            collapseTextBelow="sm"
          />
        )}
        <span className="flex-1" />
        <BarButton
          label="Leave call"
          icon="↩"
          onClick={onLeave}
          className="bg-red-600 text-white border-red-600 hover:bg-red-500"
          collapseTextBelow="sm"
        />
      </div>
    </div>
  );
}

// Single icon+label button used in the unified bar so every control
// has the same touch target and visual rhythm.
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
  icon: string;
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
      <span aria-hidden className="text-base leading-none">
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
