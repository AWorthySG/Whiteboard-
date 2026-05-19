"use client";

import { useEffect, useState } from "react";
import { useSettings } from "@/hooks/useSettings";

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
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-[#11141b] border border-white/10 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="text-white/60 hover:text-white text-2xl leading-none"
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
                className="w-full rounded-md bg-[#0b0d12] border border-white/10 px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
            </Field>
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
          </Section>

          <Section title="Room">
            <Field label="Invite link">
              <div className="flex gap-2">
                <input
                  readOnly
                  value={inviteUrl}
                  className="flex-1 rounded-md bg-[#0b0d12] border border-white/10 px-3 py-2 text-sm text-white/70 outline-none"
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(inviteUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1200);
                  }}
                  className="rounded-md border border-white/10 px-3 py-2 text-sm hover:bg-white/5"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </Field>
            <button
              onClick={() => {
                window.location.href = "/";
              }}
              className="w-full rounded-md border border-red-500/40 text-red-300 hover:bg-red-500/10 px-3 py-2 text-sm"
            >
              Leave room
            </button>
          </Section>
        </div>
      </div>
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
      <h3 className="text-xs font-medium uppercase tracking-wider text-white/40 mb-2">
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
      <label className="text-sm text-white/80">{label}</label>
      <div className="mt-1">{children}</div>
      {hint && <p className="text-xs text-white/40 mt-1">{hint}</p>}
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
      <span className="text-sm text-white/80">
        {label}
        {hint && <span className="block text-xs text-white/40 mt-0.5">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative shrink-0 w-10 h-6 rounded-full transition ${
          checked ? "bg-brand-600" : "bg-white/10"
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
    <div className="inline-flex rounded-md bg-[#0b0d12] border border-white/10 p-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1.5 text-sm rounded-[5px] transition ${
            value === opt.value
              ? "bg-brand-600 text-white"
              : "text-white/70 hover:text-white"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
