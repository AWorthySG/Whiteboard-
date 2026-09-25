"use client";

import "@livekit/components-styles";
import {
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useConnectionQualityIndicator,
  useDataChannel,
  useLocalParticipant,
  useParticipants,
  useRoomContext,
  useTracks,
} from "@livekit/components-react";
import {
  ConnectionQuality,
  DefaultReconnectPolicy,
  DisconnectReason,
  Track,
  VideoPresets,
  type LocalTrack,
  type RemoteTrackPublication,
  type RoomOptions,
} from "livekit-client";
import type { Participant } from "livekit-client";
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
import { isWriting, subscribeToWriting } from "@/lib/writingActivity";

// More patient than livekit-client's default reconnect policy. The
// stock policy retries 10 times at [0, 300, 1200, 2700, 4800, 7000,
// 7000, 7000, 7000, 7000] ms — total budget ~42s before
// onDisconnected fires and our "Call dropped. Reconnecting…" panel
// takes over. On flaky tutoring-from-home networks, a ~1-minute
// Wi-Fi flutter (router reboot, 5G/Wi-Fi handoff, kid loading
// YouTube) was tipping past 42s and showing the disconnect screen
// mid-lesson. We keep the early aggressive retries for sub-second
// blips (no spurious user-visible churn), then settle into 10-second
// steady tries for another ~2 minutes. Total budget ~2m45s — long
// enough to silently ride out a kettle-boil-grade outage. If the
// network is genuinely dead beyond that, the "Call dropped" path
// still takes over.
const PATIENT_LIVEKIT_RECONNECT_DELAYS_MS = [
  0, 300, 1200, 2700, 4800, 7000,
  10_000, 10_000, 10_000, 10_000, 10_000, 10_000,
  10_000, 10_000, 10_000, 10_000, 10_000, 10_000,
];
const PATIENT_LIVEKIT_RECONNECT_POLICY = new DefaultReconnectPolicy(
  PATIENT_LIVEKIT_RECONNECT_DELAYS_MS,
);

// Static room options, hoisted so the object identity is stable across
// renders. Three of these exist purely to keep video off the whiteboard's
// frame budget: encode/decode competes with tldraw's canvas rendering and
// pointer handling for the same main thread, and on an iPad that
// competition is what a lesson feels as pen lag. See CLAUDE.md.
const ROOM_OPTIONS: RoomOptions = {
  // Pause / downgrade video for tiles that are small or not visible. The
  // video panel is a ~300px column (and is display:none in audio-only
  // mode), so without this we decode full-size streams to paint thumbnails.
  adaptiveStream: true,
  // Stop publishing simulcast layers nobody is subscribed to.
  dynacast: true,
  // Cap camera capture at 360p. The panel is far too narrow to show more,
  // and encoding 720p (the LiveKit default) costs several times as much
  // CPU for no visible gain. Screen share has its own screenShareEncoding
  // and is deliberately left at full resolution for shared worksheets.
  videoCaptureDefaults: { resolution: VideoPresets.h360.resolution },
  // Release the local microphone hardware when the user mutes,
  // so the system mic indicator turns off.
  publishDefaults: { stopMicTrackOnMute: true },
  // Stretch the internal reconnect window from ~42s to ~2m45s
  // so a network blip resolves silently inside LiveKit instead
  // of bouncing us through our "Call dropped" UI. See the
  // PATIENT_LIVEKIT_RECONNECT_DELAYS_MS comment above.
  reconnectPolicy: PATIENT_LIVEKIT_RECONNECT_POLICY,
};

// The join / rejoin / dropped prompts all share one sticker card so the
// panel reads as a single "card on the sidebar" whichever state it is in.
// max-w keeps the card ~the old 14rem button width plus padding; the
// buttons inside are w-full so they line up edge to edge.
const PROMPT_CARD_CLASS =
  "sticker scale-pop w-full max-w-[17rem] p-5 flex flex-col items-center gap-2";

// Human-friendly label for the disconnect reason livekit-client gives
// us in onDisconnected. We surface this in the "Call dropped" panel
// so a drop carries enough context to diagnose (esp. DUPLICATE_IDENTITY,
// which means another tab/device on the same browser took our slot).
function describeDisconnectReason(reason: DisconnectReason | undefined): string {
  switch (reason) {
    case DisconnectReason.DUPLICATE_IDENTITY:
      return "Joined from another tab or device";
    case DisconnectReason.SERVER_SHUTDOWN:
      return "Call server restarted";
    case DisconnectReason.PARTICIPANT_REMOVED:
      return "Removed from the room";
    case DisconnectReason.ROOM_DELETED:
      return "Room closed";
    case DisconnectReason.STATE_MISMATCH:
      return "Sync state mismatch";
    case DisconnectReason.JOIN_FAILURE:
      return "Couldn't join the room";
    case DisconnectReason.MIGRATION:
      return "Server migration";
    case DisconnectReason.SIGNAL_CLOSE:
      return "Connection to call server lost";
    case DisconnectReason.CONNECTION_TIMEOUT:
      return "Connection timed out";
    case DisconnectReason.MEDIA_FAILURE:
      return "Audio/video stream failed";
    case DisconnectReason.CLIENT_INITIATED:
      return "You ended the call";
    case DisconnectReason.UNKNOWN_REASON:
    case undefined:
    default:
      return "Connection lost";
  }
}

export default function VideoPanel({
  roomId,
  userId,
  userName,
  isHost,
  captionsEnabled,
  onCaption,
  onLeaveCall,
  autoConnect,
}: {
  roomId: string;
  userId: string;
  userName: string;
  isHost: boolean;
  captionsEnabled?: boolean;
  onCaption?: (line: import("./CaptionsManager").CaptionLine) => void;
  // Called when the user intentionally leaves the call from the control bar
  // so RoomShell can unmount VideoPanel and show the whiteboard-only state.
  onLeaveCall?: () => void;
  // Set by the welcome-screen choice in RoomShell. When provided, the panel
  // connects immediately in the chosen mode and skips its own join prompt —
  // the user already chose how to join, so we don't ask twice.
  autoConnect?: "video" | "audio" | null;
}) {
  const [settings] = useSettings();
  const [token, setToken] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // An explicit welcome-screen choice (autoConnect) overrides the saved
  // auto-join setting — the user has just told us how they want to join.
  const initialAutoJoin = useMemo(
    () => autoConnect != null || settings.autoJoinCall,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  // Camera respects the audio-only setting on first join — if the user
  // has audio-only enabled, never even ask for camera permission.
  const initialCamera = useMemo(
    () => settings.defaultCamera && !settings.audioOnly && autoConnect !== "audio",
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const initialMic = useMemo(() => settings.defaultMicrophone, []);
  const [inCall, setInCall] = useState(initialAutoJoin);
  // Track whether the user chose to join audio-only — separate from
  // the setting so we can flip it per-call without persisting.
  const [audioOnlyMode, setAudioOnlyMode] = useState(() =>
    autoConnect === "audio" ? true : settings.audioOnly,
  );
  // Distinguish user-initiated leave from an unexpected drop so we can
  // auto-reconnect on drops instead of silently showing the rejoin screen.
  const intentionalLeaveRef = useRef(false);
  const [dropped, setDropped] = useState(false);
  // Reason livekit-client gave us on the most recent unexpected drop.
  // Surfaced in the dropped panel so the user has actual diagnostic
  // signal ("Joined from another tab or device" vs. "Connection lost").
  // Some reasons (notably DUPLICATE_IDENTITY) ALSO change behaviour:
  // we skip auto-reconnect so two tabs in the same browser don't
  // ping-pong kicking each other every 3 seconds.
  const [dropReason, setDropReason] = useState<DisconnectReason | undefined>(
    undefined,
  );
  const dropWasDuplicateIdentity =
    dropReason === DisconnectReason.DUPLICATE_IDENTITY;
  // Tracks whether the user has successfully been in the call at least once
  // this session — used to show "Join the call" vs "You've left" messaging.
  const hasJoinedBeforeRef = useRef(false);

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

  // Auto-reconnect after an unexpected drop. 3-second delay gives the
  // network a moment to recover before we hammer the server. We skip
  // this entirely on DUPLICATE_IDENTITY: another tab/device on the
  // same browser took our LiveKit slot (identity is `u-<userId>`,
  // derived from per-browser localStorage). Auto-reconnecting here
  // would kick the OTHER tab, which would then auto-reconnect and
  // kick us, forever. Require manual user action to take the slot
  // back, after they (hopefully) close the other tab.
  useEffect(() => {
    if (!dropped || inCall) return;
    if (dropWasDuplicateIdentity) return;
    const t = window.setTimeout(() => {
      setDropped(false);
      setInCall(true);
    }, 3000);
    return () => window.clearTimeout(t);
  }, [dropped, inCall, dropWasDuplicateIdentity]);

  // Record that the user has been in the call at least once this session
  // so we can distinguish "never joined" from "intentionally left".
  useEffect(() => {
    if (inCall) hasJoinedBeforeRef.current = true;
  }, [inCall]);

  if (error) {
    return (
      <div role="alert" className="p-4 text-sm font-bold text-danger-700">
        Couldn't connect to video: {error}
        <p className="mt-2 text-[var(--text-muted)] font-semibold">
          Make sure{" "}
          <code className="bg-[var(--bg-elev-2)] rounded-md px-1">LIVEKIT_API_KEY</code>,{" "}
          <code className="bg-[var(--bg-elev-2)] rounded-md px-1">LIVEKIT_API_SECRET</code>,
          and{" "}
          <code className="bg-[var(--bg-elev-2)] rounded-md px-1">NEXT_PUBLIC_LIVEKIT_URL</code>{" "}
          are set.
        </p>
      </div>
    );
  }

  if (!token || !serverUrl) {
    return <div className="p-4 text-sm font-semibold text-[var(--text-muted)]">Joining call…</div>;
  }

  if (!inCall) {
    if (dropped) {
      // DUPLICATE_IDENTITY gets its own copy: the auto-reconnect is
      // intentionally suppressed (ping-pong avoidance — see the
      // auto-reconnect effect above), and the action the user needs
      // to take is different (close the other tab/device, not wait).
      if (dropWasDuplicateIdentity) {
        return (
          <div className="flex flex-col h-full items-center justify-center p-4 text-center">
            <div className={PROMPT_CARD_CLASS}>
              <p className="text-base font-extrabold tracking-display text-[var(--text)]">
                You joined this call from another tab or device.
              </p>
              <p className="text-xs font-semibold text-[var(--text-muted)] max-w-[18rem]">
                The other window is now in the call. Close it (or just
                switch to it) — auto-reconnect is paused here so the two
                don&apos;t keep kicking each other.
              </p>
              <button
                onClick={() => {
                  setDropped(false);
                  setDropReason(undefined);
                  setInCall(true);
                }}
                className="btn-primary touch-target w-full mt-2"
              >
                Take the call back here
              </button>
              <button
                onClick={() => {
                  setDropped(false);
                  setDropReason(undefined);
                  onLeaveCall?.();
                }}
                className="btn-secondary touch-target w-full"
              >
                Stay on whiteboard only
              </button>
            </div>
          </div>
        );
      }
      return (
        <div className="flex flex-col h-full items-center justify-center p-4 text-center">
          <div className={PROMPT_CARD_CLASS}>
            <p className="text-base font-extrabold tracking-display text-[var(--text)]">
              Call dropped. Reconnecting…
            </p>
            <p className="text-xs font-semibold text-[var(--text-muted)]">
              Reason: {describeDisconnectReason(dropReason)}
            </p>
            <button
              onClick={() => {
                setDropped(false);
                setDropReason(undefined);
                setInCall(true);
              }}
              className="btn-primary touch-target w-full mt-2"
            >
              Reconnect now
            </button>
            <button
              onClick={() => {
                setDropped(false);
                setDropReason(undefined);
                onLeaveCall?.();
              }}
              className="btn-secondary touch-target w-full"
            >
              Stay on whiteboard only
            </button>
          </div>
        </div>
      );
    }

    // First entry (never joined yet): show a clear "join" prompt so users
    // know they can use the whiteboard without the call.
    if (!hasJoinedBeforeRef.current) {
      return (
        <div className="flex flex-col h-full items-center justify-center p-4 text-center">
          <div className={`${PROMPT_CARD_CLASS} gap-3`}>
            <p className="text-lg font-extrabold tracking-display text-[var(--text)]">
              Join the call
            </p>
            <p className="text-xs font-semibold text-[var(--text-muted)] -mt-1">
              You're on the whiteboard. Add audio &amp; video when you're ready.
            </p>
            <button
              onClick={() => {
                setAudioOnlyMode(false);
                setInCall(true);
              }}
              className="btn-primary touch-target w-full"
            >
              Join with video
            </button>
            <button
              onClick={() => {
                setAudioOnlyMode(true);
                setInCall(true);
              }}
              className="btn-secondary touch-target w-full"
            >
              Audio only
            </button>
            <p className="text-xs font-semibold text-[var(--text-dim)]">
              Audio only saves bandwidth on phone data.
            </p>
            <button
              onClick={() => onLeaveCall?.()}
              className="btn-tertiary touch-target w-full text-xs"
            >
              Whiteboard only — skip the call
            </button>
          </div>
        </div>
      );
    }

    // User has joined before and intentionally left — offer to rejoin.
    return (
      <div className="flex flex-col h-full items-center justify-center p-4 text-center">
        <div className={PROMPT_CARD_CLASS}>
          <p className="text-base font-extrabold tracking-display text-[var(--text)]">
            You've left the call. The whiteboard is still active.
          </p>
          <button
            onClick={() => {
              setAudioOnlyMode(false);
              setInCall(true);
            }}
            className="btn-primary touch-target w-full mt-1"
          >
            Rejoin with video
          </button>
          <button
            onClick={() => {
              setAudioOnlyMode(true);
              setInCall(true);
            }}
            className="btn-secondary touch-target w-full"
          >
            Rejoin audio only
          </button>
          <button
            onClick={() => onLeaveCall?.()}
            className="btn-tertiary touch-target w-full text-xs"
          >
            Close panel · stay on whiteboard
          </button>
          <p className="text-xs font-semibold text-[var(--text-dim)]">
            Audio only saves bandwidth on phone data.
          </p>
        </div>
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
      onDisconnected={(reason) => {
        if (intentionalLeaveRef.current) {
          intentionalLeaveRef.current = false;
          setDropped(false);
          setDropReason(undefined);
          setInCall(false);
          // Propagate to RoomShell so it can unmount VideoPanel and show
          // the whiteboard-only state with a clear "Join call" button.
          onLeaveCall?.();
        } else {
          setDropReason(reason);
          setDropped(true);
          setInCall(false);
        }
      }}
      options={ROOM_OPTIONS}
    >
      <div className="flex flex-col h-full">
        <div className="flex-1 min-h-0">
          <Tiles />
        </div>
        <RoomAudioRenderer />
        <CameraReleaseGuard />
        <PauseVideoWhileWriting enabled={settings.pauseVideoWhileWriting} />
        {onCaption && (
          <CaptionsManager
            userName={userName}
            enabled={!!captionsEnabled}
            onCaption={onCaption}
          />
        )}
        <RoomCoordinatorBar
          isHost={isHost}
          userName={userName}
          onBeforeLeave={() => { intentionalLeaveRef.current = true; }}
        />
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
      <div className="absolute top-2 left-2 z-10 font-label text-[var(--text-muted)] bg-[var(--bg-elev)] border-[1.5px] border-ink-faint rounded-full px-2 py-0.5 pointer-events-none">
        {participants.length} in call
      </div>
      {/* Connection-quality warnings: a named chip appears for any
          participant whose LiveKit connection drops to poor/lost, so the
          host knows why a student froze instead of guessing. */}
      <div className="absolute top-2 right-2 z-10 flex flex-col items-end gap-1 pointer-events-none">
        {participants.map((p) => (
          <ConnectionQualityChip key={p.identity} participant={p} />
        ))}
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
          className="absolute bottom-2 left-1/2 -translate-x-1/2 z-10 text-[11px] font-extrabold text-[var(--text-muted)] bg-[var(--bg-elev)] border-[1.5px] border-ink-faint shadow-sticker-sm rounded-full pl-3 pr-2 py-0.5 whitespace-nowrap inline-flex items-center gap-1.5 hover:border-ink hover:text-[var(--text)] transition-colors"
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

// Per-participant connection-quality chip. Renders nothing unless the
// participant's LiveKit connection drops to poor or lost — then a named
// chip surfaces it (sun tint for poor, pale red for lost) so the host can
// tell a freeze is a network problem, not the app.
function ConnectionQualityChip({ participant }: { participant: Participant }) {
  const { quality } = useConnectionQualityIndicator({ participant });
  if (quality !== ConnectionQuality.Poor && quality !== ConnectionQuality.Lost) {
    return null;
  }
  const lost = quality === ConnectionQuality.Lost;
  const who = participant.isLocal
    ? "Your connection"
    : participant.name?.trim() || participant.identity;
  return (
    <span
      className={`text-[10px] font-extrabold rounded-full px-2.5 py-0.5 border-[1.5px] border-ink-faint shadow-sticker-sm ${
        lost ? "bg-danger-50 text-danger-700" : "bg-sun-bg text-sun-deep"
      }`}
    >
      {who}: {lost ? "connection lost" : "weak connection"}
    </span>
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
  onBeforeLeave,
}: {
  isHost: boolean;
  userName: string;
  onBeforeLeave: () => void;
}) {
  const room = useRoomContext();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } =
    useLocalParticipant();
  const toast = useToast();
  const [handUp, setHandUp] = useState(false);
  const [muteAllArmed, setMuteAllArmed] = useState(false);
  const muteAllArmedTimer = useRef<number | null>(null);
  const reactionTimers = useRef<number[]>([]);
  const [raisedHands, setRaisedHands] = useState<
    Map<string, { name: string; up: boolean }>
  >(() => new Map());
  // Active floating reactions — each one auto-removes after 2s.
  const [reactions, setReactions] = useState<
    { id: number; emoji: string; name: string }[]
  >([]);

  useEffect(() => {
    return () => {
      reactionTimers.current.forEach((t) => window.clearTimeout(t));
    };
  }, []);

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
        const timer = window.setTimeout(
          () => setReactions((prev) => prev.filter((r) => r.id !== id)),
          2400,
        );
        reactionTimers.current.push(timer);
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
    onBeforeLeave();
    void room.disconnect();
  };

  return (
    <div className="relative border-t-2 border-ink bg-[var(--bg-sidebar)] text-[var(--text)]">
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
              className="inline-flex items-center gap-1 bg-[var(--bg-elev)] text-[var(--text)] border-2 border-ink shadow-sticker-sm rounded-full px-2.5 py-0.5 text-xs font-bold animate-[reactionRise_2.4s_ease-out_forwards]"
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
              className="flex items-center gap-2 bg-sun-bg border-[1.5px] border-ink-faint rounded-full px-2.5 py-1"
            >
              <Hand weight="fill" aria-hidden className="text-sun-deep shrink-0" />
              <span className="flex-1 truncate font-bold text-sun-deep">{info.name}</span>
              {isHost && (
                <button
                  onClick={() => lowerHand(id)}
                  className="text-xs text-sun-deep hover:underline underline-offset-2 font-extrabold"
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
        // pb-2.5 (not 1.5) leaves room for the 4px hard shadow under each
        // pill so it isn't clipped by the bar's overflow-x scroll box.
        className="flex items-center gap-1.5 px-2 pt-2 pb-2.5 overflow-x-auto"
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
          activeClass="bg-sun text-[var(--text)] border-ink"
          onClick={toggleHand}
        />
        {isHost && (
          <BarButton
            label={muteAllArmed ? "Tap to confirm" : "Mute all"}
            icon={
              muteAllArmed ? (
                <Check />
              ) : (
                <BellSlash weight="fill" />
              )
            }
            active={muteAllArmed}
            activeClass="bg-sun text-[var(--text)] border-ink"
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
            className="shrink-0 inline-flex items-center justify-center rounded-full bg-[var(--bg-elev)] border-2 border-ink shadow-sticker sticker-press hover:bg-[var(--bg-elev-2)] min-w-[40px] min-h-[40px] text-base"
          >
            <span aria-hidden>{r}</span>
          </button>
        ))}
        <span className="flex-1" />
        <BarButton
          label="Leave call"
          icon={<SignOut weight="fill" />}
          onClick={onLeave}
          destructive
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
  destructive,
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
  // Pale-red destructive variant (Leave). A prop rather than a passed-in
  // className because the idle state now carries its own `bg-*`, and two
  // competing Tailwind bg utilities resolve by stylesheet order, not
  // className order — so the fill has to be chosen here.
  destructive?: boolean;
}) {
  const hideText =
    collapseTextBelow === "sm" ? "hidden sm:inline" : "hidden md:inline";
  // Every state is a 2px-ink sticker pill; only the fill changes. Active =
  // solid red + white text (the primary look) with the darker-red hard
  // shadow; destructive = pale red + red text; idle = white.
  const stateClass =
    active && activeClass
      ? `${activeClass} shadow-sticker`
      : active
        ? "bg-brand-600 text-white border-ink shadow-sticker-primary hover:bg-brand-700"
        : destructive
          ? "bg-danger-50 text-danger-700 border-ink shadow-sticker hover:bg-danger-100"
          : "bg-[var(--bg-elev)] text-[var(--text)] border-ink shadow-sticker hover:bg-[var(--bg-elev-2)]";
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`touch-target sticker-press shrink-0 inline-flex items-center justify-center gap-1.5 rounded-full border-2 px-2.5 py-1 text-sm font-extrabold min-w-[44px] min-h-[40px] ${stateClass} ${className ?? ""}`}
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

// While this person writes on the board (src/lib/writingActivity.ts), stop
// the server sending everyone else's CAMERA video: decoding it competes with
// the pen for the main thread, which on an iPad is felt as pen lag. The
// tiles freeze on their last frame and resume ~2 s after the pen lifts.
// Audio and screen shares are untouched. Only tracks that are currently
// flowing are paused, so ones adaptive stream has already turned off (a
// hidden panel in audio-only mode) are left to it.
function PauseVideoWhileWriting({ enabled }: { enabled: boolean }) {
  const room = useRoomContext();
  useEffect(() => {
    if (!enabled) return;
    const paused = new Set<RemoteTrackPublication>();
    const pause = () => {
      for (const p of room.remoteParticipants.values()) {
        const pub = p.getTrackPublication(Track.Source.Camera) as
          | RemoteTrackPublication
          | undefined;
        if (pub?.isSubscribed && pub.isEnabled && !paused.has(pub)) {
          pub.setEnabled(false);
          paused.add(pub);
        }
      }
    };
    const resume = () => {
      for (const pub of paused) handBackToAdaptiveStream(pub);
      paused.clear();
    };
    const unsub = subscribeToWriting((w) => (w ? pause() : resume()));
    if (isWriting()) pause();
    return () => {
      unsub();
      resume();
    };
  }, [room, enabled]);
  return null;
}

// setEnabled(true) would pin the track ON for good, overriding adaptive
// stream, which then keeps streaming into a hidden or tiny tile. Clearing
// the publication's manual override instead hands control back to it.
// livekit-client has no public API for that; writingActivity.test.ts pins
// the internals used here so an upgrade that changes them fails loudly.
function handBackToAdaptiveStream(pub: RemoteTrackPublication) {
  const p = pub as unknown as {
    requestedDisabled?: boolean;
    emitTrackUpdate?: () => void;
  };
  if (typeof p.emitTrackUpdate === "function" && "requestedDisabled" in p) {
    p.requestedDisabled = undefined;
    p.emitTrackUpdate();
  } else {
    pub.setEnabled(true);
  }
}
