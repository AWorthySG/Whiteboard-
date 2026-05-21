"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useSettings } from "@/hooks/useSettings";
import { useAuth, signOut, displayUsername } from "@/hooks/useAuth";
import { markAsHost } from "@/hooks/useHostStatus";
import { useToast } from "./Toast";

const SignInModal = dynamic(() => import("./SignInModal"), { ssr: false });

export default function SettingsModal({
  open,
  onClose,
  roomId,
  userName,
  onUserNameChange,
}: {
  open: boolean;
  onClose: () => void;
  roomId: string;
  userName: string;
  onUserNameChange: (name: string) => void;
}) {
  const [settings, setSettings] = useSettings();
  const [copied, setCopied] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const { user, loading: authLoading } = useAuth();
  const toast = useToast();

  const claimRoom = async () => {
    if (!user) return;
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
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-[var(--bg-elev)] border border-[color:var(--border)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-[color:var(--border-subtle)]">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text)] text-2xl leading-none"
            aria-label="Close settings"
          >
            ×
          </button>
        </header>

        <div className="px-5 py-4 space-y-6">
          <Section title="Profile">
            <Field label="Display name">
              <input
                value={userName}
                onChange={(e) => onUserNameChange(e.target.value)}
                placeholder="Your name"
                className="w-full rounded-md bg-[var(--bg)] border border-[color:var(--border)] px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
            </Field>
          </Section>

          {!authLoading && (
            <Section title="Account">
              {user ? (
                <>
                  <Field label="Signed in as">
                    <div className="text-sm text-[var(--text)] px-1">
                      {displayUsername(user)}
                    </div>
                  </Field>
                  <button
                    onClick={claimRoom}
                    disabled={claiming}
                    className="text-xs rounded-md bg-brand-600 text-white hover:bg-brand-500 px-2.5 py-1 disabled:opacity-50"
                    title="Make sure you're the registered host of this room on every device"
                  >
                    {claiming ? "Claiming…" : "Claim this room for my account"}
                  </button>
                  <button
                    onClick={() => signOut()}
                    className="block text-xs text-[var(--text-dim)] hover:text-[var(--text)] underline underline-offset-2"
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
                    className="text-sm rounded-md bg-brand-600 hover:bg-brand-500 text-white px-3 py-1.5"
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
                  className="flex-1 rounded-md bg-[var(--bg)] border border-[color:var(--border)] px-3 py-2 text-sm text-[var(--text-muted)] outline-none"
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(inviteUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1200);
                  }}
                  className="rounded-md border border-[color:var(--border)] px-3 py-2 text-sm hover:bg-[var(--hover)]"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </Field>
            <button
              onClick={() => {
                window.location.href = "/";
              }}
              className="w-full rounded-md border border-red-600 text-red-700 hover:bg-red-50 px-3 py-2 text-sm"
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
    <section>
      <h3 className="text-xs font-medium uppercase tracking-wider text-[var(--text-dim)] mb-2">
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
      <label className="text-sm text-[var(--text)]">{label}</label>
      <div className="mt-1">{children}</div>
      {hint && <p className="text-xs text-[var(--text-dim)] mt-1">{hint}</p>}
    </div>
  );
}

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
      <span className="text-sm text-[var(--text)]">
        {label}
        {hint && <span className="block text-xs text-[var(--text-dim)] mt-0.5">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative shrink-0 w-10 h-6 rounded-full transition ${
          checked ? "bg-brand-600" : "bg-[var(--border)]"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
            checked ? "translate-x-[18px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </label>
  );
}

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
    <div className="inline-flex rounded-md bg-[var(--bg)] border border-[color:var(--border)] p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1.5 text-sm rounded-[5px] transition ${
            value === opt.value
              ? "bg-brand-600 text-[var(--text)]"
              : "text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
