"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { markAsHost } from "@/hooks/useHostStatus";
import { useAuth, signOut, displayUsername } from "@/hooks/useAuth";
import {
  useRecentRooms,
  removeRoomFromRecents,
  type RecentRoom,
} from "@/hooks/useRecentRooms";
import { getSupabase } from "@/lib/supabase";
import BrandLogo from "@/components/BrandLogo";
import PwaInstallBanner from "@/components/PwaInstallBanner";

const SignInModal = dynamic(() => import("@/components/SignInModal"), { ssr: false });

function generateRoomId() {
  const adj = ["bright", "swift", "quiet", "warm", "bold", "calm", "lucky", "neat"];
  const noun = ["otter", "comet", "river", "ember", "cloud", "harbor", "willow", "ridge"];
  const pick = (xs: string[]) => xs[Math.floor(Math.random() * xs.length)];
  const n = Math.floor(Math.random() * 900 + 100);
  return `${pick(adj)}-${pick(noun)}-${n}`;
}

type ServerRoom = {
  id: string;
  host_name: string | null;
  updated_at: string | null;
};

export default function Home() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [name, setName] = useState("");
  const [room, setRoom] = useState("");
  const [signInOpen, setSignInOpen] = useState(false);
  const [pendingSignIn, setPendingSignIn] = useState(false);

  const localRooms = useRecentRooms();
  const [hostedRooms, setHostedRooms] = useState<ServerRoom[]>([]);

  // Pull rooms this signed-in user is registered as host for, so they
  // show up even on devices that haven't been into them locally.
  useEffect(() => {
    if (!user) {
      setHostedRooms([]);
      return;
    }
    const supabase = getSupabase();
    if (!supabase) return;
    let cancelled = false;
    supabase
      .from("rooms")
      .select("id, host_name, updated_at")
      .eq("host_user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(30)
      .then(({ data }) => {
        if (!cancelled) setHostedRooms((data as ServerRoom[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Merge local + hosted rooms, dedup by roomId, local entries take
  // precedence (they have visit timestamps).
  const recent = useMemo(() => {
    const map = new Map<string, RecentRoom>();
    for (const r of localRooms) map.set(r.roomId, r);
    for (const h of hostedRooms) {
      if (!map.has(h.id)) {
        map.set(h.id, {
          roomId: h.id,
          title: h.host_name ?? h.id,
          lastVisitedAt: h.updated_at ? new Date(h.updated_at).getTime() : 0,
          role: "host",
        });
      } else {
        // Mark hosted rooms as host even if local cache says guest (signed-in
        // ownership is the source of truth).
        const r = map.get(h.id)!;
        map.set(h.id, { ...r, role: "host" });
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.lastVisitedAt - a.lastVisitedAt)
      .slice(0, 12);
  }, [localRooms, hostedRooms]);

  const start = async (id: string, isNew: boolean) => {
    if (isNew) {
      await markAsHost(id, user, name.trim() || displayUsername(user) || undefined);
    }
    const params = new URLSearchParams();
    if (name.trim()) params.set("name", name.trim());
    router.push(`/r/${encodeURIComponent(id)}?${params.toString()}`);
  };

  const onCreateOrJoin = async () => {
    const trimmed = room.trim();
    if (trimmed) {
      await start(trimmed, false);
      return;
    }
    if (!user && !pendingSignIn) {
      setSignInOpen(true);
      return;
    }
    await start(generateRoomId(), true);
  };

  return (
    <main className="min-h-[100dvh] flex items-center justify-center px-4 py-8 sm:px-6">
      <div className="w-full max-w-xl rounded-2xl bg-[var(--bg-elev)] border border-[color:var(--border-subtle)] shadow-xl p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <BrandLogo size={64} priority className="rounded-xl shrink-0" />
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
                A Worthy Whiteboard
              </h1>
              <p className="text-[var(--text-muted)] mt-1 text-sm sm:text-base">
                Real-time collaborative whiteboard with video, audio, and document upload.
              </p>
            </div>
          </div>
          {!authLoading && (
            <AccountChip
              user={user}
              onSignIn={() => setSignInOpen(true)}
              onSignOut={() => signOut()}
            />
          )}
        </div>

        <div className="mt-6 sm:mt-8 space-y-4">
          <label className="block">
            <span className="text-sm text-[var(--text-muted)]">Your name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Alex"
              className="mt-1 w-full rounded-lg bg-[var(--bg)] border border-[color:var(--border)] px-3 py-2.5 text-base outline-none focus:border-brand-500"
            />
          </label>

          <div className="flex flex-col sm:flex-row gap-3">
            <input
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="Room code (optional)"
              className="flex-1 rounded-lg bg-[var(--bg)] border border-[color:var(--border)] px-3 py-2.5 text-base outline-none focus:border-brand-500"
            />
            <button
              onClick={onCreateOrJoin}
              className="rounded-lg bg-brand-600 hover:bg-brand-500 text-white px-4 py-2.5 font-medium"
            >
              {room.trim() ? "Join" : "Create"}
            </button>
          </div>

          <p className="text-xs text-[var(--text-dim)]">
            {user
              ? "Signed in — any rooms you create are tied to your account, so you stay the host on every device."
              : "Tip: sign in with your host username and password before creating a room to keep host access on every device."}
          </p>

          {!user && !authLoading && (
            <button
              onClick={() => {
                setPendingSignIn(true);
                void start(generateRoomId(), true);
              }}
              className="text-xs text-[var(--text-dim)] hover:text-[var(--text-muted)] underline underline-offset-2"
            >
              Continue as guest (host status only on this browser)
            </button>
          )}
        </div>

        {recent.length > 0 && (
          <section className="mt-8 border-t border-[color:var(--border-subtle)] pt-5">
            <h2 className="text-xs uppercase tracking-wider text-[var(--text-dim)] mb-2">
              Recent rooms
            </h2>
            <ul className="space-y-1">
              {recent.map((r) => (
                <li
                  key={r.roomId}
                  className="group flex items-center gap-2 rounded-lg hover:bg-[var(--hover)] px-2 py-1.5"
                >
                  <button
                    onClick={() => start(r.roomId, false)}
                    className="flex-1 min-w-0 text-left flex items-center gap-2"
                  >
                    {/* Deterministic colour dot from roomId — helps
                        the eye scan a long list of recent rooms at
                        a glance. */}
                    <span
                      aria-hidden
                      className="shrink-0 w-2.5 h-2.5 rounded-full"
                      style={{ background: hashHue(r.roomId) }}
                    />
                    <span
                      className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${
                        r.role === "host"
                          ? "bg-brand-100 text-brand-800"
                          : "bg-[var(--hover)] text-[var(--text-dim)]"
                      }`}
                    >
                      {r.role}
                    </span>
                    <span className="truncate text-sm" title={r.title ?? r.roomId}>
                      {r.title || r.roomId}
                    </span>
                    {r.title && r.title !== r.roomId && (
                      <span className="text-xs text-[var(--text-dim)] truncate shrink-0">
                        {r.roomId}
                      </span>
                    )}
                  </button>
                  <span className="text-xs text-[var(--text-dim)] shrink-0">
                    {r.lastVisitedAt
                      ? formatRelative(r.lastVisitedAt)
                      : ""}
                  </span>
                  <button
                    onClick={() => removeRoomFromRecents(r.roomId)}
                    className="opacity-0 group-hover:opacity-100 text-[var(--text-dim)] hover:text-danger-600 text-xs px-1"
                    aria-label="Remove from recent rooms"
                    title="Remove from recent"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
      <PwaInstallBanner />
    </main>
  );
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.round(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  return `${d}d`;
}

function AccountChip({
  user,
  onSignIn,
  onSignOut,
}: {
  user: { email?: string | null } | null;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  if (!user) {
    return (
      <button
        onClick={onSignIn}
        className="text-xs rounded-md border border-[color:var(--border)] hover:bg-[var(--hover)] px-3 py-1.5 shrink-0"
      >
        Sign in
      </button>
    );
  }
  const name = displayUsername(user);
  return (
    <div className="text-xs text-right shrink-0 max-w-[10rem]">
      <div className="text-[var(--text-muted)] truncate" title={name ?? ""}>
        {name}
      </div>
      <button
        onClick={onSignOut}
        className="text-[var(--text-dim)] hover:text-[var(--text-muted)] underline underline-offset-2 mt-0.5"
      >
        Sign out
      </button>
    </div>
  );
}

// Stable colour from a string — used to give each recent-room
// row its own visual marker so a list of similar-named rooms is
// easier to scan.
function hashHue(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360}, 55%, 50%)`;
}
