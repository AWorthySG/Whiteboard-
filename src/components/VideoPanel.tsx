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
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { useEffect, useMemo, useState } from "react";
import { useSettings } from "@/hooks/useSettings";
import { useToast } from "./Toast";

export default function VideoPanel({
  roomId,
  userId,
  userName,
  isHost,
}: {
  roomId: string;
  userId: string;
  userName: string;
  isHost: boolean;
}) {
  const [settings] = useSettings();
  const [token, setToken] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const initialAutoJoin = useMemo(() => settings.autoJoinCall, []);
  const initialCamera = useMemo(() => settings.defaultCamera, []);
  const initialMic = useMemo(() => settings.defaultMicrophone, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const [inCall, setInCall] = useState(initialAutoJoin);

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
      <div className="p-4 text-sm text-red-300">
        Couldn't connect to video: {error}
        <p className="mt-2 text-white/50">
          Make sure <code>LIVEKIT_API_KEY</code>, <code>LIVEKIT_API_SECRET</code>,
          and <code>NEXT_PUBLIC_LIVEKIT_URL</code> are set.
        </p>
      </div>
    );
  }

  if (!token || !serverUrl) {
    return <div className="p-4 text-sm text-white/60">Joining call…</div>;
  }

  if (!inCall) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-white/70">
          You've left the call. You're still in the whiteboard.
        </p>
        <button
          onClick={() => setInCall(true)}
          className="rounded-md bg-brand-600 hover:bg-brand-500 px-4 py-2 text-sm font-medium"
        >
          Rejoin call
        </button>
      </div>
    );
  }

  return (
    <LiveKitRoom
      token={token}
      serverUrl={serverUrl}
      connect={inCall}
      video={initialCamera}
      audio={initialMic}
      data-lk-theme="default"
      style={{ height: "100%" }}
      onDisconnected={() => setInCall(false)}
    >
      <div className="flex flex-col h-full">
        <div className="flex-1 min-h-0">
          <Tiles />
        </div>
        <RoomAudioRenderer />
        <RoomCoordinator isHost={isHost} userName={userName} />
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
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  return (
    <GridLayout tracks={tracks} style={{ height: "100%" }}>
      <ParticipantTile />
    </GridLayout>
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
    <div className="border-t border-white/10 bg-[var(--bg-elev)]">
      {raisedHands.size > 0 && (
        <ul className="max-h-32 overflow-y-auto px-3 py-2 space-y-1 text-sm">
          {[...raisedHands.entries()].map(([id, info]) => (
            <li key={id} className="flex items-center gap-2">
              <span>✋</span>
              <span className="flex-1 truncate">{info.name}</span>
              {isHost && (
                <button
                  onClick={() => lowerHand(id)}
                  className="text-xs text-white/40 hover:text-white"
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
              : "border-white/10 hover:bg-white/5"
          }`}
        >
          {handUp ? "Lower hand" : "✋ Raise hand"}
        </button>
        {isHost && (
          <button
            onClick={muteAll}
            className="text-sm rounded-md px-3 py-1.5 border border-white/10 hover:bg-white/5"
            title="Send everyone a request to mute"
          >
            Mute all
          </button>
        )}
      </div>
    </div>
  );
}
