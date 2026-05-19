"use client";

import "@livekit/components-styles";
import {
  ControlBar,
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useTracks,
} from "@livekit/components-react";
import { Track } from "livekit-client";
import { useEffect, useMemo, useState } from "react";
import { useSettings } from "@/hooks/useSettings";

export default function VideoPanel({
  roomId,
  userName,
}: {
  roomId: string;
  userName: string;
}) {
  const [settings] = useSettings();
  const [token, setToken] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Latch initial values so toggling settings mid-call doesn't disconnect us.
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
          body: JSON.stringify({ room: roomId, name: userName }),
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
  }, [roomId, userName]);

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
