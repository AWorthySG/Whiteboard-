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
import { preloadRoomWhenIdle } from "@/lib/preloadRoom";
import { Star, X } from "@phosphor-icons/react";
import BrandLogo from "@/components/BrandLogo";
import Sticker, { SUBJECT_STICKERS } from "@/components/Sticker";
import PwaInstallBanner from "@/components/PwaInstallBanner";
import { useToast } from "@/components/Toast";

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
  // Most visits here end in a room: warm its chunks (the whiteboard is the
  // big one) once the landing page has settled, so the room opens faster.
  useEffect(() => preloadRoomWhenIdle(), []);
  const toast = useToast();
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
      try {
        await markAsHost(id, user, name.trim() || displayUsername(user) || undefined);
      } catch (e) {
        // markAsHost records local ownership before it touches the network,
        // so the host is still the host on THIS device — go in regardless.
        // Only the cross-device claim failed; say so rather than stranding
        // them on the landing page with a room they can't enter.
        toast.error(
          `Room created, but it couldn't be linked to your account (${(e as Error).message}). You're host on this device — use Settings → Claim this room to retry.`,
        );
      }
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
    // The page sat on flat #ffffff behind a #ffffff card, so the card
    // read as a floating seam rather than a surface. A warm cream wash
    // (the same paper tone as the whiteboard canvas) gives it something
    // to sit on. The three soft blooms are the LMS hero's — sun top-left,
    // bloom centre-right, sky bottom-right — as absolutely-positioned
    // divs behind the card. Pure CSS gradients: no image, no extra bytes.
    // The bloom colours are tokens, so alpha comes from `opacity` on the
    // div rather than a hex-alpha suffix (a var() can't take one).
    <main className="relative overflow-hidden min-h-[100dvh] flex items-center justify-center px-4 py-8 sm:px-6 bg-[var(--bg)]">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -left-40 w-[560px] h-[560px] rounded-full opacity-[0.28]"
        style={{ background: "radial-gradient(circle, var(--sun) 0%, transparent 68%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-[8%] -translate-y-1/2 w-[480px] h-[480px] rounded-full opacity-[0.16]"
        style={{ background: "radial-gradient(circle, var(--bloom) 0%, transparent 68%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-48 -right-40 w-[600px] h-[600px] rounded-full opacity-[0.22]"
        style={{ background: "radial-gradient(circle, var(--sky) 0%, transparent 68%)" }}
      />

      {/* The six-up sticker sheet from the collection, pressed into the
          bottom-left of the paper at large widths — the LMS hero's
          illustration slot. Behind the card in DOM order, so the card's
          hard shadow paints over it if the two ever meet; hidden below
          lg where there is no margin for it to sit in. */}
      <Sticker
        name="sheet"
        size={200}
        className="hidden lg:block pointer-events-none absolute left-[4%] bottom-[6%] -rotate-6"
      />

      <div className="relative w-full max-w-xl rounded-3xl bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-lg p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col items-start sm:flex-row sm:items-center gap-2 sm:gap-4 min-w-0">
            {/* Stacks above the wordmark on phones rather than hiding:
                side-by-side at phone width would squeeze the heading onto
                three lines, but dropping the mascot entirely was the
                "no branding on mobile" complaint. Height is set with
                classes (not the `size` prop) because only a class can
                carry a breakpoint. */}
            <Sticker
              name="teaching"
              size={104}
              priority
              className="shrink-0 -ml-1 h-[76px] sm:h-[104px] w-auto"
            />
            <div className="min-w-0">
              {/* Wordmark sits ABOVE the product name rather than beside it:
                  at 4.18:1 it needs the full card width, and "A-Worthy
                  Education" (the company) reads as a header over "A Worthy
                  Whiteboard" (the product) instead of competing with it. */}
              <BrandLogo
                size={36}
                variant="wordmark"
                priority
                className="mb-3"
              />
              <h1 className="text-2xl sm:text-3xl font-black tracking-display">
                A Worthy <span className="squiggle">Whiteboard</span>
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

        {/* Subject "sticker sheet" — the five tutor+student duos in a strip
            between the hero copy and the form, as on the LMS hero. Alternate
            tilt so it reads as stickers pressed on by hand, not a row of
            icons. Hidden on phones: at 72px tall five of them don't fit
            beside a 16px gutter without wrapping into a second messy row. */}
        <div className="hidden sm:flex items-end justify-center gap-3 mt-6" aria-hidden>
          {SUBJECT_STICKERS.map((s, i) => (
            <Sticker
              key={s}
              name={s}
              size={72}
              className={`shrink-0 ${i % 2 === 0 ? "rotate-[-3deg]" : "rotate-[2deg]"}`}
            />
          ))}
        </div>

        <div className="mt-6 sm:mt-8 space-y-4">
          <label className="block">
            <span className="font-label text-[var(--text-muted)]">Your name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Alex"
              className="mt-1.5 w-full rounded-lg bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-sm px-3.5 py-2.5 text-base font-semibold outline-none focus:border-brand-600 focus:shadow-[0_0_0_3px_var(--accent-soft)] placeholder:text-[var(--text-dim)] placeholder:font-semibold"
            />
          </label>

          <div className="flex flex-col sm:flex-row gap-3">
            <input
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="Room code (optional)"
              className="flex-1 min-w-0 rounded-lg bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-sm px-3.5 py-2.5 text-base font-semibold outline-none focus:border-brand-600 focus:shadow-[0_0_0_3px_var(--accent-soft)] placeholder:text-[var(--text-dim)] placeholder:font-semibold"
            />
            <button
              onClick={onCreateOrJoin}
              // Spelled out (not .btn-primary) because that class is declared
              // after Tailwind's utilities and would win over the larger
              // padding + font-size needed to match the 48px input beside it.
              className="shrink-0 rounded-full bg-brand-600 hover:bg-brand-700 text-white border-2 border-ink font-extrabold shadow-sticker-primary sticker-press px-6 py-2.5 text-base"
            >
              {room.trim() ? "Join" : "Create"}
            </button>
          </div>

          <p className="text-xs font-semibold text-[var(--text-muted)]">
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
              className="text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text)] underline underline-offset-2"
            >
              Continue as guest (host status only on this browser)
            </button>
          )}
        </div>

        {recent.length > 0 && (
          <section className="mt-8 border-t-2 border-dashed border-[color:var(--border)] pt-5">
            <div className="flex items-center justify-between gap-3 mb-3">
              <h2 className="font-label text-[var(--text-muted)]">
                Your rooms
              </h2>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                aria-label="Search rooms by title or room ID"
                className="flex-1 max-w-[16rem] rounded-full bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-sm px-3.5 py-1.5 text-sm font-semibold outline-none focus:border-brand-600 focus:shadow-[0_0_0_3px_var(--accent-soft)] placeholder:text-[var(--text-dim)]"
              />
            </div>

            {filtered.length === 0 ? (
              <p className="text-sm font-semibold text-[var(--text-muted)] px-2 py-3">
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
        className="text-xs font-extrabold rounded-full bg-[var(--bg-elev)] hover:bg-[var(--bg-elev-2)] border-2 border-ink shadow-sticker-sm sticker-press px-3.5 py-1.5 shrink-0"
      >
        Sign in
      </button>
    );
  }
  const name = displayUsername(user);
  return (
    <div className="text-xs text-right shrink-0 max-w-[10rem]">
      <div className="text-[var(--text-muted)] font-bold truncate" title={name ?? ""}>
        {name}
      </div>
      <button
        onClick={onSignOut}
        className="text-[var(--text-muted)] font-semibold hover:text-[var(--text)] underline underline-offset-2 mt-0.5"
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
        <div className="font-label text-[var(--text-muted)] mb-1.5 px-1">
          {label}
        </div>
      )}
      {/* Each row is its own light sticker (3px hard shadow), so the list
          needs real gaps — space-y-0.5 would let one row's shadow sit on
          the next row's outline. */}
      <ul className="space-y-2">
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
    <li className="group flex items-center gap-2 rounded-lg bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-sm card-lift px-2.5 py-1.5">
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
          className={`rounded-full text-[10px] font-extrabold uppercase tracking-label px-2 py-0.5 border-[1.5px] border-ink-faint shrink-0 ${
            r.role === "host"
              ? "bg-brand-50 text-brand-700"
              : "bg-[var(--bg-elev-2)] text-[var(--text-muted)]"
          }`}
        >
          {r.role}
        </span>
        <span className="truncate text-sm font-bold" title={r.title ?? r.roomId}>
          {r.title || r.roomId}
        </span>
        {r.title && r.title !== r.roomId && (
          <span className="text-xs font-semibold text-[var(--text-dim)] truncate shrink-0">
            {r.roomId}
          </span>
        )}
      </button>
      <span className="text-xs font-semibold text-[var(--text-dim)] shrink-0">
        {r.lastVisitedAt ? formatRelative(r.lastVisitedAt) : ""}
      </span>
      {/* Pin toggle — filled star when pinned (always visible), outline
          on hover only when unpinned (keeps the row visually quiet). */}
      <button
        onClick={() => (pinned ? unpinRoom(r.roomId) : pinRoom(r.roomId))}
        className={`inline-flex items-center px-1 ${
          pinned
            ? "text-[color:var(--accent)]"
            : "opacity-0 group-hover:opacity-100 text-[var(--text-dim)] hover:text-[color:var(--accent)]"
        }`}
        aria-label={pinned ? "Unpin room" : "Pin room"}
        title={pinned ? "Unpin" : "Pin to top"}
      >
        <Star size={15} weight={pinned ? "fill" : undefined} aria-hidden />
      </button>
      <button
        onClick={() => removeRoomFromRecents(r.roomId)}
        className="opacity-0 group-hover:opacity-100 inline-flex items-center text-[var(--text-dim)] hover:text-danger-600 px-1"
        aria-label="Remove from recent rooms"
        title="Remove from recent"
      >
        <X size={14} aria-hidden />
      </button>
    </li>
  );
}
