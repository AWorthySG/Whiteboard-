"use client";

import { useEffect, useRef } from "react";
import {
  useDataChannel,
  useLocalParticipant,
} from "@livekit/components-react";
import { useToast } from "./Toast";

// Each line corresponds to one speaker's most-recent utterance, kept
// short (last sentence or two) and replaced as new text arrives.
export type CaptionLine = {
  // Stable identity for dedup — LiveKit participant identity is unique.
  identity: string;
  name: string;
  text: string;
  // Whether this is finalised (gray) or interim (lighter, will be
  // overwritten as the recogniser refines).
  isFinal: boolean;
  // Ms timestamp so we can fade lines older than ~10s.
  at: number;
};

// Data-channel payload for caption broadcasts.
type CaptionMsg = {
  type: "caption";
  text: string;
  isFinal: boolean;
  name: string;
};

// Browser-native SpeechRecognition is webkit-prefixed in Chrome /
// Samsung / Edge and not implemented at all on Safari / Firefox.
function getSpeechRecognitionCtor():
  | (new () => SpeechRecognitionLike)
  | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// Minimal subset of the SpeechRecognition interface we use. The DOM
// types ship with TypeScript but they're patchy across versions, so
// we redeclare just what we need.
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
  resultIndex: number;
}

export default function CaptionsManager({
  userName,
  enabled,
  onCaption,
}: {
  userName: string;
  enabled: boolean;
  onCaption: (line: CaptionLine) => void;
}) {
  const { localParticipant } = useLocalParticipant();
  const toast = useToast();
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const wantRunningRef = useRef(false);
  // Stops the auto-restart loop if SpeechRecognition keeps erroring
  // (offline, network blip, mic device error). Without this guard the
  // recogniser would re-throw 'network-error' every 250 ms forever.
  const consecutiveErrorsRef = useRef(0);
  const errorToastShownRef = useRef(false);

  // Receive captions broadcast by other participants.
  const { send } = useDataChannel((msg) => {
    try {
      const payload = JSON.parse(new TextDecoder().decode(msg.payload)) as
        | CaptionMsg
        | { type: string };
      if (payload.type !== "caption") return;
      const cap = payload as CaptionMsg;
      onCaption({
        identity: msg.from?.identity ?? "unknown",
        name: cap.name || msg.from?.name || "Someone",
        text: cap.text,
        isFinal: cap.isFinal,
        at: Date.now(),
      });
    } catch {
      // ignore malformed
    }
  });

  // Local speech recognition. Starts when (a) captions are enabled,
  // (b) the local mic is on, and (c) the browser actually supports it.
  // Restarts automatically if the browser pauses the session.
  useEffect(() => {
    const stopLocal = () => {
      wantRunningRef.current = false;
      const rec = recognitionRef.current;
      if (rec) {
        try {
          rec.abort();
        } catch {
          // ignore
        }
      }
      recognitionRef.current = null;
    };

    if (!enabled) {
      stopLocal();
      // Reset error gates so the user can re-enable later without
      // being blocked by a stale toast flag.
      consecutiveErrorsRef.current = 0;
      errorToastShownRef.current = false;
      return;
    }
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      // Safari, Firefox, and any iOS browser (including iPad Chrome,
      // which is a WKWebView wrapper) — receive-only. Tell the user
      // up-front instead of letting them wonder why their own voice
      // never produces captions. The overlay also surfaces a notice
      // in quiet moments, but that's easy to miss if other people
      // are speaking.
      if (!errorToastShownRef.current) {
        toast.info(
          "Your voice can't be transcribed on this browser. Switch to desktop Chrome (Mac/Windows) or Android Chrome to caption your speech. You'll still see captions from others.",
        );
        errorToastShownRef.current = true;
      }
      return;
    }

    const startIfPossible = () => {
      if (!enabled) return;
      if (!localParticipant?.isMicrophoneEnabled) return;
      if (recognitionRef.current) return;
      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang =
        (typeof navigator !== "undefined" && navigator.language) || "en-US";
      rec.onresult = (e) => {
        // Concatenate everything since the last final result so the
        // current interim phrase shows in full, not fragment-by-fragment.
        let interim = "";
        let final = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) final += r[0].transcript;
          else interim += r[0].transcript;
        }
        const text = (final || interim).trim();
        if (!text) return;
        const isFinal = !!final && !interim;
        // Show our own caption immediately (no round-trip).
        onCaption({
          identity: localParticipant?.identity ?? "self",
          name: userName,
          text,
          isFinal,
          at: Date.now(),
        });
        // Broadcast to others.
        const payload: CaptionMsg = {
          type: "caption",
          text,
          isFinal,
          name: userName,
        };
        try {
          void send(new TextEncoder().encode(JSON.stringify(payload)), {
            reliable: false,
          });
        } catch {
          // data channel may not be ready briefly; safe to drop
        }
      };
      rec.onerror = (e) => {
        // 'no-speech' and 'aborted' are normal — the recogniser
        // re-emits these constantly and the auto-restart in onend
        // handles them. Anything else is unusual.
        const benign = e.error === "no-speech" || e.error === "aborted";
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          wantRunningRef.current = false;
          if (!errorToastShownRef.current) {
            toast.error(
              "Microphone permission denied — captions are off for this session.",
            );
            errorToastShownRef.current = true;
          }
          return;
        }
        if (!benign) {
          consecutiveErrorsRef.current += 1;
          // Three real errors in a row (e.g. 'network-error' while
          // offline) — stop the auto-restart loop and let the user
          // know once.
          if (consecutiveErrorsRef.current >= 3) {
            wantRunningRef.current = false;
            if (!errorToastShownRef.current) {
              toast.error(
                `Live captions paused after repeated errors (${e.error ?? "unknown"}). Click CC to retry.`,
              );
              errorToastShownRef.current = true;
            }
          }
        }
      };
      rec.onend = () => {
        recognitionRef.current = null;
        // The browser ends sessions every ~60s; restart promptly to
        // close the gap during active speech. 50ms is enough for
        // Chrome to release the previous session without spamming.
        if (wantRunningRef.current) {
          window.setTimeout(startIfPossible, 50);
        }
      };
      try {
        rec.start();
        recognitionRef.current = rec;
        wantRunningRef.current = true;
        // A clean start means whatever recent burst of errors was
        // probably transient — reset the counter.
        consecutiveErrorsRef.current = 0;
      } catch {
        recognitionRef.current = null;
      }
    };

    startIfPossible();

    // Watch for mic mute/unmute via LiveKit's participant events
    // instead of polling. This drops CPU + battery use on long
    // lessons. A slow safety-net poll (5s) still catches any event
    // we might miss from edge-case LiveKit reconnect flows.
    const onMicChanged = () => {
      if (localParticipant?.isMicrophoneEnabled) startIfPossible();
      else if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
      }
    };
    type EmitterLike = {
      on(event: string, listener: (...args: unknown[]) => void): unknown;
      off(event: string, listener: (...args: unknown[]) => void): unknown;
    };
    const lp = localParticipant as unknown as EmitterLike | null;
    const subscribed = !!lp && typeof lp.on === "function";
    if (subscribed) {
      lp!.on("trackMuted", onMicChanged);
      lp!.on("trackUnmuted", onMicChanged);
      lp!.on("localTrackPublished", onMicChanged);
      lp!.on("localTrackUnpublished", onMicChanged);
    }

    return () => {
      if (subscribed) {
        lp!.off("trackMuted", onMicChanged);
        lp!.off("trackUnmuted", onMicChanged);
        lp!.off("localTrackPublished", onMicChanged);
        lp!.off("localTrackUnpublished", onMicChanged);
      }
      stopLocal();
    };
  }, [enabled, localParticipant, userName, onCaption, send]);

  return null;
}

// Lets parents check up-front whether the local browser can contribute
// captions. We don't want to lie to Safari users that their mic is
// being transcribed.
export function localCaptionsSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}
