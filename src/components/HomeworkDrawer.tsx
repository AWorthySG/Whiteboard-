"use client";

import { useEffect, useState } from "react";
import {
  CaretDown,
  CaretUp,
  Check,
  Paperclip,
  X,
} from "@phosphor-icons/react";
import { getSupabase } from "@/lib/supabase";
import { useEscapeToClose } from "@/hooks/useEscapeToClose";
import { useToast } from "./Toast";
import ConfirmButton from "./ConfirmButton";
import AttachmentPicker, { type Attachment } from "./AttachmentPicker";
import DrawerSkeleton from "./Skeleton";

type Homework = {
  id: string;
  room_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  created_at: string;
  attachment_url: string | null;
  attachment_name: string | null;
};

type Submission = {
  id: string;
  homework_id: string;
  student_user_id: string;
  student_name: string;
  file_url: string | null;
  file_name: string | null;
  note: string | null;
  submitted_at: string;
  feedback: string | null;
  feedback_at: string | null;
};

// Preset feedback chips for the host — quick one-click responses
// for the common cases. The host can also write a custom comment
// in the freeform field; either path persists to feedback +
// feedback_at on homework_submissions.
const FEEDBACK_PRESETS = [
  { label: "✓ Good job", value: "✓ Good job" },
  { label: "⭐ Excellent", value: "⭐ Excellent" },
  { label: "Try again", value: "Try again — see my notes" },
];

export default function HomeworkDrawer({
  open,
  onClose,
  roomId,
  userId,
  userName,
  isHost,
}: {
  open: boolean;
  onClose: () => void;
  roomId: string;
  userId: string;
  userName: string;
  isHost: boolean;
}) {
  const toast = useToast();
  const [items, setItems] = useState<Homework[] | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  useEscapeToClose(open, onClose);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [newAttachment, setNewAttachment] = useState<Attachment | null>(null);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  // When a student taps 'Attach my work' on a given homework row,
  // that row's id goes into submittingFor and an inline
  // <AttachmentPicker/> is shown. Once they pick or upload, the
  // submission is persisted and submittingFor clears.
  const [submittingFor, setSubmittingFor] = useState<string | null>(null);
  const [submissionDraft, setSubmissionDraft] = useState<Attachment | null>(
    null,
  );

  useEffect(() => {
    if (!open) return;
    const supabase = getSupabase();
    if (!supabase) return;

    const fetchAll = async () => {
      const [hw, subs] = await Promise.all([
        supabase
          .from("room_homework")
          .select("*")
          .eq("room_id", roomId)
          .order("created_at", { ascending: false }),
        supabase
          .from("homework_submissions")
          .select("*")
          .eq("room_id", roomId)
          .order("submitted_at", { ascending: false }),
      ]);
      setItems((hw.data as Homework[]) ?? []);
      setSubmissions((subs.data as Submission[]) ?? []);
    };

    void fetchAll();

    const channel = supabase
      .channel(`homework-${roomId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "room_homework",
          filter: `room_id=eq.${roomId}`,
        },
        () => void fetchAll(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "homework_submissions",
          filter: `room_id=eq.${roomId}`,
        },
        () => void fetchAll(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [open, roomId]);

  const add = async () => {
    if (!title.trim()) return;
    const supabase = getSupabase();
    if (!supabase) return;
    setSaving(true);
    const { error } = await supabase.from("room_homework").insert({
      room_id: roomId,
      title: title.trim(),
      description: description.trim() || null,
      due_date: dueDate || null,
      created_by_user_id: userId,
      attachment_url: newAttachment?.url ?? null,
      attachment_name: newAttachment?.name ?? null,
    });
    setSaving(false);
    if (error) {
      toast.error(`Couldn't add homework: ${error.message}`);
      return;
    }
    setTitle("");
    setDescription("");
    setDueDate("");
    setNewAttachment(null);
  };

  const remove = async (id: string) => {
    // Two-tap confirmation now lives in <ConfirmButton/> so we don't
    // need to repeat the prompt here — by the time we get called the
    // user has already double-tapped.
    const supabase = getSupabase();
    if (!supabase) return;
    const { error } = await supabase.from("room_homework").delete().eq("id", id);
    if (error) {
      toast.error(`Couldn't delete homework: ${error.message}`);
    }
  };

  // For students. Inline picker UI is shown when this homework's id
  // is the active 'submitting' target — see submittingFor below.
  const persistSubmission = async (homeworkId: string, att: Attachment) => {
    const supabase = getSupabase();
    if (!supabase) return;
    const { error: dbErr } = await supabase
      .from("homework_submissions")
      .insert({
        homework_id: homeworkId,
        room_id: roomId,
        student_user_id: userId,
        student_name: userName,
        file_url: att.url,
        file_name: att.name,
      });
    if (dbErr) {
      toast.error(`Submission failed: ${dbErr.message}`);
      return;
    }
    toast.success("Work submitted");
    setSubmittingFor(null);
    setSubmissionDraft(null);
  };

  const setFeedback = async (submissionId: string, feedback: string | null) => {
    const supabase = getSupabase();
    if (!supabase) return;
    // Optimistic update so the host sees the chip immediately.
    setSubmissions((prev) =>
      prev.map((s) =>
        s.id === submissionId
          ? {
              ...s,
              feedback,
              feedback_at: feedback ? new Date().toISOString() : null,
            }
          : s,
      ),
    );
    const { error } = await supabase
      .from("homework_submissions")
      .update({
        feedback,
        feedback_at: feedback ? new Date().toISOString() : null,
      })
      .eq("id", submissionId);
    if (error) {
      toast.error(`Couldn't save feedback: ${error.message}`);
    }
  };

  const removeSubmission = async (id: string) => {
    const supabase = getSupabase();
    if (!supabase) return;
    await supabase.from("homework_submissions").delete().eq("id", id);
  };

  if (!open) return null;

  const submissionsByHomework = (homeworkId: string) =>
    submissions.filter((s) => s.homework_id === homeworkId);
  const mySubmissionFor = (homeworkId: string) =>
    submissions.find(
      (s) => s.homework_id === homeworkId && s.student_user_id === userId,
    );

  return (
    <div
      className="fixed inset-0 z-[10000] flex justify-end bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md h-full bg-[var(--bg-elev)] border-l border-[color:var(--border)] shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-[color:var(--border-subtle)]">
          <h2 className="text-lg font-semibold">Homework</h2>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text)] inline-flex"
            aria-label="Close"
          >
            <X size={22} aria-hidden />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {items === null && <DrawerSkeleton />}
          {items !== null && items.length === 0 && (
            <div className="p-8 text-center">
              <div className="text-4xl mb-2">📝</div>
              <p className="text-sm font-medium">No homework yet</p>
              <p className="text-xs text-[var(--text-dim)] mt-1">
                {isHost
                  ? "Add an assignment below — students see it as soon as you save."
                  : "Your teacher hasn't assigned anything for this lesson."}
              </p>
            </div>
          )}
          <ul className="divide-y divide-[color:var(--border-subtle)]">
            {(items ?? []).map((h) => {
              const subs = submissionsByHomework(h.id);
              const mine = mySubmissionFor(h.id);
              const open = expanded === h.id;
              return (
                <li key={h.id} className="px-4 py-3">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{h.title}</div>
                      {h.description && (
                        <div className="text-sm text-[var(--text-muted)] mt-1 whitespace-pre-wrap">
                          {h.description}
                        </div>
                      )}
                      {h.attachment_url && h.attachment_name && (
                        <a
                          href={h.attachment_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-xs text-brand-700 hover:underline"
                          title={`Worksheet: ${h.attachment_name}`}
                        >
                          <Paperclip aria-hidden size={12} />
                          <span className="truncate max-w-[16rem]">
                            {h.attachment_name}
                          </span>
                        </a>
                      )}
                      {h.due_date && (
                        <div className="text-xs text-amber-700 mt-1">
                          Due{" "}
                          {new Date(h.due_date).toLocaleDateString(undefined, {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          })}
                        </div>
                      )}
                    </div>
                    {isHost && (
                      <ConfirmButton
                        onConfirm={() => remove(h.id)}
                        label="Delete"
                        className="text-xs shrink-0"
                      />
                    )}
                  </div>

                  {/* Submissions area */}
                  <div className="mt-3 flex items-center justify-between gap-2 flex-wrap">
                    {!isHost ? (
                      submittingFor === h.id ? (
                        <button
                          onClick={() => {
                            setSubmittingFor(null);
                            setSubmissionDraft(null);
                          }}
                          className="text-xs text-[var(--text-dim)] hover:text-[var(--text)]"
                        >
                          Cancel
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            setSubmittingFor(h.id);
                            setSubmissionDraft(null);
                          }}
                          className="text-xs rounded-md bg-brand-600 text-white hover:bg-brand-500 px-2.5 py-1"
                        >
                          {mine ? "Replace my submission" : "Attach my work"}
                        </button>
                      )
                    ) : (
                      <button
                        onClick={() => setExpanded(open ? null : h.id)}
                        className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] inline-flex items-center gap-1"
                      >
                        {subs.length} submission{subs.length === 1 ? "" : "s"}
                        {open ? (
                          <CaretUp aria-hidden size={12} />
                        ) : (
                          <CaretDown aria-hidden size={12} />
                        )}
                      </button>
                    )}
                    {!isHost && mine && (
                      <a
                        href={mine.file_url ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-[var(--text-dim)] truncate max-w-[55%] inline-flex items-center gap-1"
                        title={mine.file_name ?? ""}
                      >
                        <Check aria-hidden size={12} weight="bold" />
                        {mine.file_name}
                      </a>
                    )}
                  </div>
                  {!isHost && mine?.feedback && (
                    <div className="mt-2 rounded-md bg-emerald-50 border border-emerald-200 px-2 py-1 text-xs">
                      <span className="text-[10px] uppercase tracking-wider text-emerald-700 mr-1.5">
                        Feedback
                      </span>
                      <span className="text-[var(--text)] whitespace-pre-wrap">
                        {mine.feedback}
                      </span>
                    </div>
                  )}

                  {!isHost && submittingFor === h.id && (
                    <div className="mt-2 space-y-2">
                      <AttachmentPicker
                        roomId={roomId}
                        value={submissionDraft}
                        onChange={setSubmissionDraft}
                        label="Pick or upload your work"
                      />
                      {submissionDraft && (
                        <button
                          onClick={() =>
                            void persistSubmission(h.id, submissionDraft)
                          }
                          className="w-full text-xs rounded-md bg-brand-600 text-white hover:bg-brand-500 px-2.5 py-1.5 font-medium"
                        >
                          Submit
                        </button>
                      )}
                    </div>
                  )}

                  {isHost && open && subs.length > 0 && (
                    <ul className="mt-2 space-y-2 rounded-md bg-[var(--bg)] border border-[color:var(--border-subtle)] p-2">
                      {subs.map((s) => (
                        <li key={s.id} className="text-xs space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="flex-1 min-w-0">
                              <span className="text-[var(--text)]">
                                {s.student_name}
                              </span>
                              <a
                                href={s.file_url ?? "#"}
                                target="_blank"
                                rel="noreferrer"
                                className="ml-2 text-brand-700 hover:underline truncate"
                              >
                                {s.file_name}
                              </a>
                            </span>
                            <span className="text-[var(--text-dim)]">
                              {new Date(s.submitted_at).toLocaleString()}
                            </span>
                            <button
                              onClick={() => removeSubmission(s.id)}
                              className="text-[var(--text-dim)] hover:text-red-600 inline-flex"
                              title="Remove submission"
                              aria-label="Remove submission"
                            >
                              <X aria-hidden size={14} />
                            </button>
                          </div>
                          {/* Feedback row — preset chips for one-tap
                              responses + a freeform textarea. The
                              student sees this on their submission
                              line below. */}
                          <SubmissionFeedback
                            submission={s}
                            onSet={(v) => void setFeedback(s.id, v)}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {isHost && (
          <div className="border-t border-[color:var(--border-subtle)] p-4 space-y-2">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Homework title"
              className="w-full rounded-md bg-[var(--bg)] border border-[color:var(--border)] px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              rows={3}
              className="w-full rounded-md bg-[var(--bg)] border border-[color:var(--border)] px-3 py-2 text-sm outline-none focus:border-brand-500 resize-none"
            />
            <AttachmentPicker
              roomId={roomId}
              value={newAttachment}
              onChange={setNewAttachment}
              label="Attach a worksheet (optional)"
            />
            <div className="flex gap-2">
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="flex-1 rounded-md bg-[var(--bg)] border border-[color:var(--border)] px-3 py-2 text-sm outline-none focus:border-brand-500"
              />
              <button
                onClick={add}
                disabled={!title.trim() || saving}
                className="rounded-md bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50 px-4 py-2 text-sm font-medium"
              >
                {saving ? "Adding…" : "Add"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SubmissionFeedback({
  submission,
  onSet,
}: {
  submission: Submission;
  onSet: (value: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(submission.feedback ?? "");
  if (!editing && submission.feedback) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-emerald-50 border border-emerald-200 px-2 py-1">
        <span className="text-[11px] uppercase tracking-wider text-emerald-700 shrink-0">
          Feedback
        </span>
        <span className="flex-1 text-[var(--text)] whitespace-pre-wrap">
          {submission.feedback}
        </span>
        <button
          onClick={() => {
            setDraft(submission.feedback ?? "");
            setEditing(true);
          }}
          className="text-[var(--text-dim)] hover:text-[var(--text)]"
          title="Edit feedback"
        >
          Edit
        </button>
        <button
          onClick={() => onSet(null)}
          className="text-[var(--text-dim)] hover:text-red-600"
          title="Clear feedback"
        >
          Clear
        </button>
      </div>
    );
  }
  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {FEEDBACK_PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => onSet(p.value)}
            className="text-[11px] px-2 py-0.5 rounded-full border border-[color:var(--border)] hover:bg-[var(--hover)]"
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => {
            setDraft("");
            setEditing(true);
          }}
          className="text-[11px] px-2 py-0.5 rounded-full border border-[color:var(--border)] hover:bg-[var(--hover)] text-[var(--text-muted)]"
        >
          Write…
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={2}
        placeholder="Type feedback for the student…"
        className="w-full text-xs rounded-md bg-[var(--bg)] border border-[color:var(--border)] px-2 py-1.5 outline-none focus:border-brand-500 resize-none"
      />
      <div className="flex gap-1.5">
        <button
          onClick={() => {
            const v = draft.trim();
            onSet(v || null);
            setEditing(false);
          }}
          className="text-[11px] rounded-md bg-brand-600 text-white hover:bg-brand-500 px-2 py-1"
        >
          Save
        </button>
        <button
          onClick={() => {
            setDraft(submission.feedback ?? "");
            setEditing(false);
          }}
          className="text-[11px] rounded-md border border-[color:var(--border)] hover:bg-[var(--hover)] px-2 py-1"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
