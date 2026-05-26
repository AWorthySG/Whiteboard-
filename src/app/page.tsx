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
import { pinRoom, unpinRoom, usePinnedRooms } from "@/hooks/usePinnedRooms";
import { getSupabase } from "@/lib/supabase";
import BrandLogo from "@/components/BrandLogo";
import PwaInstallBanner from "@/components/PwaInstallBanner";

const SignInModal = dynamic(() => import("@/components/SignInModal"), { ssr: false });

function generateRoomId() {
  // Neutral short code (no cutesy adjective-noun names). Ambiguous
  // characters (l/1/i, o/0) are omitted so codes are easy to read aloud.
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 8; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
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
  const pinnedIds = usePinnedRooms();
  const [hostedRooms, setHostedRooms] = useState<ServerRoom[]>([]);
  const [search, setSearch] = useState("");

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
      .slice(0, 30);
  }, [localRooms, hostedRooms]);

  // Filter by search query (matches title OR room id, case-insensitive).
  // Search overrides grouping — when filtering, show a flat list so the
  // user can see all matches without context-switching between buckets.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return recent;
    return recent.filter((r) => {
      const title = (r.title ?? "").toLowerCase();
      const id = r.roomId.toLowerCase();
      return title.includes(q) || id.includes(q);
    });
  }, [recent, search]);

  // Split pinned from unpinned. Pinned section floats above the
  // time-bucketed unpinned list and preserves the pin order.
  const { pinnedRooms, unpinnedRooms } = useMemo(() => {
    const pinned: RecentRoom[] = [];
    const unpinned: RecentRoom[] = [];
    for (const r of filtered) {
      if (pinnedIds.has(r.roomId)) pinned.push(r);
      else unpinned.push(r);
    }
    return { pinnedRooms: pinned, unpinnedRooms: unpinned };
  }, [filtered, pinnedIds]);

  // Bucket unpinned rooms by date so the list reads as a timeline.
  // Today / Yesterday / This week / This month / Older. Disabled when
  // the user is searching — flat list is easier to scan when filtering.
  const buckets = useMemo(() => {
    if (search.trim()) return null;
    return bucketByDate(unpinnedRooms);
  }, [unpinnedRooms, search]);

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
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="text-xs uppercase tracking-wider text-[var(--text-dim)]">
                Your rooms
              </h2>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                aria-label="Search rooms by title or room ID"
                className="flex-1 max-w-[16rem] rounded-md bg-[var(--bg)] border border-[color:var(--border)] px-2.5 py-1 text-sm outline-none focus:border-brand-500"
              />
            </div>

            {filtered.length === 0 ? (
              <p className="text-sm text-[var(--text-dim)] px-2 py-3">
                No rooms match “{search.trim()}”.
              </p>
            ) : (
              <>
                {pinnedRooms.length > 0 && (
                  <RoomSection
                    label="Pinned"
                    rooms={pinnedRooms}
                    pinnedIds={pinnedIds}
                    onOpen={(id) => start(id, false)}
                  />
                )}
                {buckets ? (
                  buckets.map((b) => (
                    <RoomSection
                      key={b.label}
                      label={b.label}
                      rooms={b.rooms}
                      pinnedIds={pinnedIds}
                      onOpen={(id) => start(id, false)}
                    />
                  ))
                ) : (
                  // Searching — flat list, no buckets.
                  <RoomSection
                    label={null}
                    rooms={unpinnedRooms}
                    pinnedIds={pinnedIds}
                    onOpen={(id) => start(id, false)}
                  />
                )}
              </>
            )}
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

// Date buckets — Today / Yesterday / This week / This month / Older.
// We compute boundaries at midnight in the user's local time so a
// session at 11:55 PM doesn't roll to Yesterday at midnight while
// they're still looking at it.
type Bucket = { label: string; rooms: RecentRoom[] };

function bucketByDate(rooms: RecentRoom[]): Bucket[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 86_400_000;
  const startOfWeek = startOfToday - 6 * 86_400_000; // last 7 days inclusive
  const startOfMonth = startOfToday - 30 * 86_400_000;

  const today: RecentRoom[] = [];
  const yesterday: RecentRoom[] = [];
  const thisWeek: RecentRoom[] = [];
  const thisMonth: RecentRoom[] = [];
  const older: RecentRoom[] = [];

  for (const r of rooms) {
    const t = r.lastVisitedAt || 0;
    if (t >= startOfToday) today.push(r);
    else if (t >= startOfYesterday) yesterday.push(r);
    else if (t >= startOfWeek) thisWeek.push(r);
    else if (t >= startOfMonth) thisMonth.push(r);
    else older.push(r);
  }

  return [
    { label: "Today", rooms: today },
    { label: "Yesterday", rooms: yesterday },
    { label: "This week", rooms: thisWeek },
    { label: "This month", rooms: thisMonth },
    { label: "Older", rooms: older },
  ].filter((b) => b.rooms.length > 0);
}

function RoomSection({
  label,
  rooms,
  pinnedIds,
  onOpen,
}: {
  label: string | null;
  rooms: RecentRoom[];
  pinnedIds: Set<string>;
  onOpen: (roomId: string) => void;
}) {
  return (
    <div className="mb-4 last:mb-0">
      {label && (
        <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)] font-semibold mb-1 px-2">
          {label}
        </div>
      )}
      <ul className="space-y-0.5">
        {rooms.map((r) => (
          <RoomRow
            key={r.roomId}
            room={r}
            pinned={pinnedIds.has(r.roomId)}
            onOpen={() => onOpen(r.roomId)}
          />
        ))}
      </ul>
    </div>
  );
}

function RoomRow({
  room: r,
  pinned,
  onOpen,
}: {
  room: RecentRoom;
  pinned: boolean;
  onOpen: () => void;
}) {
  return (
    <li className="group flex items-center gap-2 rounded-lg hover:bg-[var(--hover)] px-2 py-1.5">
      <button
        onClick={onOpen}
        className="flex-1 min-w-0 text-left flex items-center gap-2"
      >
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
        {r.lastVisitedAt ? formatRelative(r.lastVisitedAt) : ""}
      </span>
      {/* Pin toggle — filled star when pinned (always visible), outline
          on hover only when unpinned (keeps the row visually quiet). */}
      <button
        onClick={() => (pinned ? unpinRoom(r.roomId) : pinRoom(r.roomId))}
        className={`text-sm px-1 leading-none ${
          pinned
            ? "text-[color:var(--accent)]"
            : "opacity-0 group-hover:opacity-100 text-[var(--text-dim)] hover:text-[color:var(--accent)]"
        }`}
        aria-label={pinned ? "Unpin room" : "Pin room"}
        title={pinned ? "Unpin" : "Pin to top"}
      >
        {pinned ? "★" : "☆"}
      </button>
      <button
        onClick={() => removeRoomFromRecents(r.roomId)}
        className="opacity-0 group-hover:opacity-100 text-[var(--text-dim)] hover:text-danger-600 text-xs px-1"
        aria-label="Remove from recent rooms"
        title="Remove from recent"
      >
        ×
      </button>
    </li>
  );
}
