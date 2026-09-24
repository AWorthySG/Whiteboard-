"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { X } from "@phosphor-icons/react";
import { useSettings } from "@/hooks/useSettings";
import { useAuth, signOut, displayUsername } from "@/hooks/useAuth";
import { markAsHost } from "@/hooks/useHostStatus";
import { useToast } from "./Toast";

const SignInModal = dynamic(() => import("./SignInModal"), { ssr: false });

// Sticker-book input: 2px ink outline, small hard shadow, red outline +
// soft red halo on focus.
const INPUT_CLASS =
  "w-full rounded-lg bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-sm px-3.5 py-2 text-sm font-semibold outline-none focus:border-brand-600 focus:shadow-[0_0_0_3px_var(--accent-soft)]";

// Destructive = the PALE red pill (pale fill, red text, ink outline).
// Solid red is reserved for the one primary action per surface.
const DESTRUCTIVE_BTN =
  "rounded-full bg-danger-50 text-danger-700 border-2 border-ink font-extrabold shadow-sticker sticker-press hover:bg-danger-100 disabled:opacity-40 disabled:cursor-not-allowed";

export default function SettingsModal({
  open,
  onClose,
  roomId,
  userName,
  onUserNameChange,
  isHost,
}: {
  open: boolean;
  onClose: () => void;
  roomId: string;
  userName: string;
  onUserNameChange: (name: string) => void;
  // Gates "Claim this room". markAsHost writes local ownership before the
  // rooms upsert, so a signed-in student pressing it would get an RLS
  // error toast yet become a local host on reload.
  isHost: boolean;
}) {
  const [settings, setSettings] = useSettings();
  const [copied, setCopied] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const { user, loading: authLoading } = useAuth();
  const toast = useToast();

  const claimRoom = async () => {
    if (!user || !isHost) return;
    setClaiming(true);
    try {
      await markAsHost(roomId, user, userName);
      toast.success("Room claimed — you're now the cross-device host");
    } catch (e) {
      toast.error(`Couldn't claim room: ${(e as Error).message}`);
    } finally {
      setClaiming(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const inviteUrl =
    typeof window !== "undefined" ? `${window.location.origin}/r/${roomId}` : "";

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-[rgba(28,27,25,0.4)] backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-lg scale-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b-2 border-dashed border-[color:var(--border)]">
          <h2 className="text-lg font-extrabold tracking-display">Settings</h2>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-sm sticker-press inline-flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text)]"
            aria-label="Close settings"
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        {/* Sections are separated by the dashed rule the LMS uses between
            groups, rather than by whitespace alone. */}
        <div className="px-5 py-2 divide-y-2 divide-dashed divide-[color:var(--border)]">
          <Section title="Profile">
            <Field label="Display name">
              <input
                value={userName}
                onChange={(e) => onUserNameChange(e.target.value)}
                placeholder="Your name"
                className={INPUT_CLASS}
              />
            </Field>
          </Section>

          {!authLoading && (
            <Section title="Account">
              {user ? (
                <>
                  <Field label="Signed in as">
                    <div className="text-sm font-bold text-[var(--text)] px-1">
                      {displayUsername(user)}
                    </div>
                  </Field>
                  {isHost && (
                    <button
                      onClick={claimRoom}
                      disabled={claiming}
                      className="btn-primary"
                      title="Make sure you're the registered host of this room on every device"
                    >
                      {claiming ? "Claiming…" : "Claim this room for my account"}
                    </button>
                  )}
                  <button
                    onClick={() => signOut()}
                    className={`block text-xs px-3.5 py-1.5 ${DESTRUCTIVE_BTN}`}
                  >
                    Sign out
                  </button>
                </>
              ) : (
                <>
                  <p className="text-xs text-[var(--text-muted)]">
                    Sign in to keep host access to your rooms across all your
                    devices.
                  </p>
                  <button
                    onClick={() => setSignInOpen(true)}
                    className="btn-primary"
                  >
                    Sign in
                  </button>
                </>
              )}
            </Section>
          )}

          <Section title="Whiteboard">
            <Toggle
              label="Force pen-only mode (your finger won't draw)"
              hint="When ON, only an Apple Pencil or stylus draws — finger and palm touches are ignored from the moment the canvas opens. Leave this OFF if you sometimes use a finger: pencil-only mode still auto-enables the first time tldraw sees a real pencil touch, so you get palm rejection without losing finger drawing. Two-finger pan and pinch-zoom always work regardless."
              checked={settings.penOnly}
              onChange={(v) => setSettings({ penOnly: v })}
            />
            <Toggle
              label="Fountain-pen nib"
              hint="Pen strokes take on an angled-nib look: down-strokes come out fuller and up-strokes finer, like writing with an italic fountain pen. Horizontal lines (minus signs, fraction bars) stay clearly visible. It applies to new strokes only, and everyone in the room sees your strokes the same way. Turn it off for a plain, even line."
              checked={settings.fountainPen}
              onChange={(v) => setSettings({ fountainPen: v })}
            />
            <Toggle
              label="Show performance readout"
              hint="Diagnostic overlay on the canvas showing live frame rate, input-to-frame latency, how many shapes are actually being painted, and main-thread stalls. Use it to pin down what's making a lesson feel laggy, then turn it back off. You can also add ?perf=1 to the room link to switch it on without opening Settings."
              checked={settings.perfHud}
              onChange={(v) => setSettings({ perfHud: v })}
            />
          </Section>

          <Section title="Documents">
            <Field
              label="PDF page layout"
              hint="How multi-page PDFs are arranged when you upload them."
            >
              <Segmented
                value={settings.pdfLayout}
                onChange={(v) => setSettings({ pdfLayout: v })}
                options={[
                  { value: "vertical", label: "Vertical" },
                  { value: "horizontal", label: "Horizontal" },
                ]}
              />
            </Field>

            <Field
              label="PDF render quality"
              hint="Higher = sharper but larger files and slower uploads."
            >
              <Segmented
                value={String(settings.pdfScale)}
                onChange={(v) =>
                  setSettings({ pdfScale: Number(v) as 1 | 2 | 3 })
                }
                options={[
                  { value: "1", label: "Low" },
                  { value: "2", label: "Medium" },
                  { value: "3", label: "High" },
                ]}
              />
            </Field>

            <Toggle
              label="Add a writing space beside PDFs"
              checked={settings.pdfWritingSpace}
              onChange={(v) => setSettings({ pdfWritingSpace: v })}
              hint="Places a blank ruled sheet (same size as the page) to the right of each uploaded PDF page for students to write on."
            />
          </Section>

          <Section title="Call defaults">
            <Toggle
              label="Open video panel on entry"
              checked={settings.showVideoOnEntry}
              onChange={(v) => setSettings({ showVideoOnEntry: v })}
            />
            <Toggle
              label="Join call automatically"
              checked={settings.autoJoinCall}
              onChange={(v) => setSettings({ autoJoinCall: v })}
              hint="If off, you'll see a 'Join call' button instead of auto-connecting."
            />
            <Toggle
              label="Start with camera on"
              checked={settings.defaultCamera}
              onChange={(v) => setSettings({ defaultCamera: v })}
            />
            <Toggle
              label="Start with microphone on"
              checked={settings.defaultMicrophone}
              onChange={(v) => setSettings({ defaultMicrophone: v })}
            />
            <Toggle
              label="Audio-only by default"
              checked={settings.audioOnly}
              onChange={(v) => setSettings({ audioOnly: v })}
              hint="Skip the camera entirely. Saves bandwidth and battery — useful on phone data. You can still toggle video on once you've joined."
            />
            <Toggle
              label="Live captions"
              checked={settings.captionsEnabled}
              onChange={(v) => setSettings({ captionsEnabled: v })}
              hint="Transcribes everyone's speech and shows the words on screen. Chrome, Edge, and Samsung Internet contribute their own captions; Safari and Firefox can read others' captions but can't transcribe their own voice. If your own speech isn't being captioned, open the room in Google Chrome instead. Toggle the 'CC' button in the header for the same effect."
            />
          </Section>

          <Section title="Room">
            <Field label="Invite link">
              <div className="flex gap-2">
                <input
                  readOnly
                  value={inviteUrl}
                  className={`flex-1 min-w-0 ${INPUT_CLASS} text-[var(--text-muted)]`}
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(inviteUrl).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1200);
                    }).catch(() => {});
                  }}
                  className="shrink-0 rounded-full bg-[var(--bg-elev)] border-2 border-ink font-extrabold shadow-sticker sticker-press hover:bg-[var(--bg-elev-2)] px-3.5 py-2 text-sm"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </Field>
            <button
              onClick={() => {
                window.location.href = "/";
              }}
              className={`w-full px-3 py-2 text-sm ${DESTRUCTIVE_BTN}`}
            >
              Leave room
            </button>
          </Section>
        </div>
      </div>
      <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="py-5">
      <h3 className="font-label text-[var(--text-muted)] mb-3">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-sm font-bold text-[var(--text)]">{label}</label>
      <div className="mt-1.5">{children}</div>
      {hint && <p className="text-xs text-[var(--text-dim)] mt-1.5">{hint}</p>}
    </div>
  );
}

// Switch: a 2px-ink pill track (pale red when on) with a round knob that
// turns brand red when on. Track is 44×24 outer; the 2px border leaves a
// 40×20 well, so a 16px knob at 2px inset travels 20px to the far side.
function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-3 cursor-pointer">
      <span className="text-sm font-bold text-[var(--text)]">
        {label}
        {hint && <span className="block text-xs font-normal text-[var(--text-dim)] mt-0.5">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative shrink-0 w-11 h-6 rounded-full border-2 border-ink shadow-sticker-sm transition-colors ${
          checked ? "bg-brand-50" : "bg-[var(--bg-elev-2)]"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full transition-transform ${
            checked ? "translate-x-5 bg-brand-600" : "translate-x-0 bg-[var(--text-dim)]"
          }`}
        />
      </button>
    </label>
  );
}

// Segmented pill: ink-outlined track on the muted inset colour; the
// active segment is a red pill with white text inside it.
function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-full bg-[var(--bg-elev-2)] border-2 border-ink p-1">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1 text-sm rounded-full border-2 font-extrabold transition ${
            value === opt.value
              ? "bg-brand-600 text-white border-ink shadow-sticker-sm"
              : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
