"use client";

import "@livekit/components-styles";
import {
  ControlBar,
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
import { useEffect, useMemo, useState } from "react";
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
        <RoomCoordinator isHost={isHost} userName={userName} />
        {onCaption && (
          <CaptionsManager
            userName={userName}
            enabled={!!captionsEnabled}
            onCaption={onCaption}
          />
        )}
        <ControlBar
          variation="minimal"
          controls={{
            microphone: true,
            camera: true,
            screenShare: true,
            leave: true,
          }}
        />
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
        <div className="absolute bottom-2 left-2 right-2 z-10 text-xs text-white/80 bg-black/60 rounded px-2 py-1 pointer-events-none">
          You're the only one here. Share the invite link to bring
          students in.
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

function RoomCoordinator({
  isHost,
  userName,
}: {
  isHost: boolean;
  userName: string;
}) {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const toast = useToast();
  const [handUp, setHandUp] = useState(false);
  // identity → { name, up }
  const [raisedHands, setRaisedHands] = useState<Map<string, { name: string; up: boolean }>>(
    () => new Map(),
  );

  // Use LiveKit React's data channel hook to send/receive messages.
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

  const muteAll = () => {
    if (!confirm("Send a mute request to everyone in the call?")) return;
    sendMsg({ type: "mute-request" });
    toast.success("Sent mute request to all participants");
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  void room; // keep ref so the hook is bound to the right room

  return (
    <div className="border-t border-[color:var(--border)] bg-[var(--bg-elev)] text-[var(--text)]">
      {raisedHands.size > 0 && (
        <ul className="max-h-32 overflow-y-auto px-3 py-2 space-y-1 text-sm">
          {[...raisedHands.entries()].map(([id, info]) => (
            <li key={id} className="flex items-center gap-2">
              <span>✋</span>
              <span className="flex-1 truncate">{info.name}</span>
              {isHost && (
                <button
                  onClick={() => lowerHand(id)}
                  className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
                >
                  Lower
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2 px-3 py-2">
        <button
          onClick={toggleHand}
          className={`flex-1 text-sm rounded-md px-3 py-1.5 border ${
            handUp
              ? "bg-amber-500 text-black border-amber-400"
              : "border-[color:var(--border)] text-[var(--text)] hover:bg-[var(--hover)]"
          }`}
        >
          {handUp ? "Lower hand" : "✋ Raise hand"}
        </button>
        {isHost && (
          <button
            onClick={muteAll}
            className="text-sm rounded-md px-3 py-1.5 border border-[color:var(--border)] text-[var(--text)] hover:bg-[var(--hover)]"
            title="Send everyone a request to mute"
          >
            Mute all
          </button>
        )}
      </div>
    </div>
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
