"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { markAsHost } from "@/hooks/useHostStatus";
import { useAuth, signOut } from "@/hooks/useAuth";
import BrandLogo from "@/components/BrandLogo";

const SignInModal = dynamic(() => import("@/components/SignInModal"), { ssr: false });

function generateRoomId() {
  const adj = ["bright", "swift", "quiet", "warm", "bold", "calm", "lucky", "neat"];
  const noun = ["otter", "comet", "river", "ember", "cloud", "harbor", "willow", "ridge"];
  const pick = (xs: string[]) => xs[Math.floor(Math.random() * xs.length)];
  const n = Math.floor(Math.random() * 900 + 100);
  return `${pick(adj)}-${pick(noun)}-${n}`;
}

export default function Home() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [name, setName] = useState("");
  const [room, setRoom] = useState("");
  const [signInOpen, setSignInOpen] = useState(false);
  const [pendingSignIn, setPendingSignIn] = useState(false);

  const start = async (id: string, isNew: boolean) => {
    if (isNew) {
      await markAsHost(id, user, name.trim() || user?.email);
    }
    const params = new URLSearchParams();
    if (name.trim()) params.set("name", name.trim());
    router.push(`/r/${encodeURIComponent(id)}?${params.toString()}`);
  };

  const onCreateOrJoin = async () => {
    const trimmed = room.trim();
    if (trimmed) {
      // Joining an existing room — sign-in not required.
      await start(trimmed, false);
      return;
    }
    // Creating a new room. If signed in, host status is portable. If not,
    // offer sign-in but allow creating locally as a fallback.
    if (!user && !pendingSignIn) {
      setSignInOpen(true);
      return;
    }
    await start(generateRoomId(), true);
  };

  return (
    <main className="min-h-[100dvh] flex items-center justify-center px-4 py-8 sm:px-6">
      <div className="w-full max-w-xl rounded-2xl bg-[#11141b] border border-white/5 shadow-xl p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <BrandLogo size={64} priority className="rounded-xl shrink-0" />
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
                A Worthy Whiteboard
              </h1>
              <p className="text-white/60 mt-1 text-sm sm:text-base">
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
            <span className="text-sm text-white/70">Your name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Alex"
              className="mt-1 w-full rounded-lg bg-[#0b0d12] border border-white/10 px-3 py-2.5 text-base outline-none focus:border-brand-500"
            />
          </label>

          <div className="flex flex-col sm:flex-row gap-3">
            <input
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="Room code (optional)"
              className="flex-1 rounded-lg bg-[#0b0d12] border border-white/10 px-3 py-2.5 text-base outline-none focus:border-brand-500"
            />
            <button
              onClick={onCreateOrJoin}
              className="rounded-lg bg-brand-600 hover:bg-brand-500 px-4 py-2.5 font-medium"
            >
              {room.trim() ? "Join" : "Create"}
            </button>
          </div>

          <p className="text-xs text-white/40">
            {user
              ? "Signed in — any rooms you create are tied to your account and you can host them from any device."
              : "Tip: sign in before creating a room to keep host access on every device you use."}
          </p>

          {!user && !authLoading && (
            <button
              onClick={() => {
                setPendingSignIn(true);
                void start(generateRoomId(), true);
              }}
              className="text-xs text-white/40 hover:text-white/70 underline underline-offset-2"
            >
              Continue as guest (host status only on this browser)
            </button>
          )}
        </div>
      </div>

      <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
    </main>
  );
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
        className="text-xs rounded-md border border-white/10 hover:bg-white/5 px-3 py-1.5 shrink-0"
      >
        Sign in
      </button>
    );
  }
  return (
    <div className="text-xs text-right shrink-0 max-w-[10rem]">
      <div className="text-white/70 truncate" title={user.email ?? ""}>
        {user.email}
      </div>
      <button
        onClick={onSignOut}
        className="text-white/40 hover:text-white/70 underline underline-offset-2 mt-0.5"
      >
        Sign out
      </button>
    </div>
  );
}
