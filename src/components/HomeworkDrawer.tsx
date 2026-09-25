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
import Sticker from "@/components/Sticker";

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
          .select(
            "id,room_id,title,description,due_date,created_at,attachment_url,attachment_name",
          )
          .eq("room_id", roomId)
          .order("created_at", { ascending: false }),
        supabase
          .from("homework_submissions")
          .select(
            "id,homework_id,student_user_id,student_name,file_url,file_name,note,submitted_at,feedback,feedback_at",
          )
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
      // Same orphan-cleanup pattern as homework_submissions — only
      // remove if the host uploaded fresh on this form. A picked
      // existing document is referenced by its room_documents row.
      if (newAttachment?.freshUploadPath) {
        void supabase.storage
          .from("whiteboard-assets")
          .remove([newAttachment.freshUploadPath]);
      }
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
    // If this student already submitted for this homework, REPLACE that
    // row rather than inserting a second one — there's no unique
    // constraint on (homework_id, student_user_id), so a plain insert
    // would leave the host looking at two submissions for one student.
    // Resubmitting also clears any prior feedback since it no longer
    // applies to the new file.
    const existing = submissions.find(
      (s) => s.homework_id === homeworkId && s.student_user_id === userId,
    );
    const { error: dbErr } = existing
      ? await supabase
          .from("homework_submissions")
          .update({
            file_url: att.url,
            file_name: att.name,
            submitted_at: new Date().toISOString(),
            feedback: null,
            feedback_at: null,
          })
          .eq("id", existing.id)
      : await supabase.from("homework_submissions").insert({
          homework_id: homeworkId,
          room_id: roomId,
          student_user_id: userId,
          student_name: userName,
          file_url: att.url,
          file_name: att.name,
        });
    if (dbErr) {
      // The file is in Storage but no submissions row references it.
      // Delete the orphan if it was a fresh upload — picked existing
      // documents stay in the bucket because other rows still link to them.
      if (att.freshUploadPath) {
        void supabase.storage
          .from("whiteboard-assets")
          .remove([att.freshUploadPath]);
      }
      toast.error(`Submission failed: ${dbErr.message}`);
      return;
    }
    toast.success(existing ? "Submission replaced" : "Work submitted");
    setSubmittingFor(null);
    setSubmissionDraft(null);
  };

  const setFeedback = async (submissionId: string, feedback: string | null) => {
    const supabase = getSupabase();
    if (!supabase) return;
    // Snapshot the prior row so we can roll back if the PATCH fails —
    // otherwise the UI would lie about persisted state.
    const prior = submissions.find((s) => s.id === submissionId);
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
      if (prior) {
        setSubmissions((prev) =>
          prev.map((s) => (s.id === submissionId ? prior : s)),
        );
      }
      toast.error(`Couldn't save feedback: ${error.message}`);
    }
  };

  const removeSubmission = async (id: string) => {
    const supabase = getSupabase();
    if (!supabase) return;
    const target = submissions.find((s) => s.id === id);
    const { error } = await supabase
      .from("homework_submissions")
      .delete()
      .eq("id", id);
    if (error) {
      toast.error(`Couldn't remove submission: ${error.message}`);
      return;
    }
    // Best-effort: remove the uploaded file too so it doesn't leak in
    // Storage. Skip if another loaded submission still references the same
    // URL (a re-picked / shared file), so we never delete something still
    // in use. Only touches the public whiteboard-assets bucket path.
    if (target?.file_url) {
      const marker = "/storage/v1/object/public/whiteboard-assets/";
      const idx = target.file_url.indexOf(marker);
      const stillUsed = submissions.some(
        (s) => s.id !== id && s.file_url === target.file_url,
      );
      if (idx !== -1 && !stillUsed) {
        void supabase.storage
          .from("whiteboard-assets")
          .remove([target.file_url.slice(idx + marker.length)]);
      }
    }
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
      className="fixed inset-0 z-[10000] flex justify-end bg-[rgba(28,27,25,0.4)]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md h-full bg-[var(--bg-sidebar)] border-l-2 border-ink md:border-y-2 md:rounded-l-3xl shadow-soft-3 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="glass-header flex items-center justify-between px-5 py-4 border-b-2 border-dashed border-[color:var(--border)]">
          <h2 className="text-lg font-extrabold tracking-display">Homework</h2>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-sm sticker-press inline-flex items-center justify-center text-[var(--text)]"
            aria-label="Close"
          >
            <X size={20} aria-hidden />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {items === null && <DrawerSkeleton />}
          {items !== null && items.length === 0 && (
            <div className="p-8 text-center">
              {/* A mascot rather than a grey icon chip: this is the one
                  empty state a STUDENT is most likely to land on, and a
                  friendlier frame beats "nothing here". */}
              <Sticker name="reading" size={120} className="mx-auto mb-2" />
              <p className="text-sm font-bold">No homework yet</p>
              <p className="text-xs font-semibold text-[var(--text-dim)] mt-1">
                {isHost
                  ? "Add an assignment below — students see it as soon as you save."
                  : "Your teacher hasn't assigned anything for this lesson."}
              </p>
            </div>
          )}
          <ul className="px-4 py-3 space-y-2">
            {(items ?? []).map((h) => {
              const subs = submissionsByHomework(h.id);
              const mine = mySubmissionFor(h.id);
              const open = expanded === h.id;
              return (
                <li key={h.id} className="p-3 bg-[var(--bg-elev)] border-2 border-ink rounded-xl shadow-sticker-sm">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold">{h.title}</div>
                      {h.description && (
                        <div className="text-sm font-semibold text-[var(--text-muted)] mt-1 whitespace-pre-wrap">
                          {h.description}
                        </div>
                      )}
                      {h.attachment_url && h.attachment_name && (
                        <a
                          href={h.attachment_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-brand-600 hover:underline"
                          title={`Worksheet: ${h.attachment_name}`}
                        >
                          <Paperclip aria-hidden size={12} />
                          <span className="truncate max-w-[16rem]">
                            {h.attachment_name}
                          </span>
                        </a>
                      )}
                      {h.due_date &&
                        (() => {
                          // due_date is a date-only string; treat end of
                          // that day (local) as the deadline for "overdue".
                          const overdue =
                            new Date(`${h.due_date}T23:59:59`).getTime() <
                            Date.now();
                          const formatted = new Date(
                            h.due_date,
                          ).toLocaleDateString(undefined, {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          });
                          return (
                            <div
                              className={`inline-flex mt-1.5 rounded-full text-[11.5px] font-extrabold tracking-[.2px] px-3 py-1 border-[1.5px] border-ink-faint ${
                                overdue
                                  ? "bg-danger-50 text-danger-700"
                                  : "bg-sun-bg text-sun-deep"
                              }`}
                            >
                              {overdue ? `Overdue · ${formatted}` : `Due ${formatted}`}
                            </div>
                          );
                        })()}
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
                          className="text-xs font-bold text-[var(--text-muted)] hover:text-[var(--text)] px-2 py-1"
                        >
                          Cancel
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            setSubmittingFor(h.id);
                            setSubmissionDraft(null);
                          }}
                          className="text-xs rounded-full bg-brand-600 text-white border-2 border-ink font-extrabold shadow-sticker-primary sticker-press hover:bg-brand-500 px-3 py-1"
                        >
                          {mine ? "Replace my submission" : "Attach my work"}
                        </button>
                      )
                    ) : (
                      <button
                        onClick={() => setExpanded(open ? null : h.id)}
                        className="text-xs rounded-full bg-[var(--bg-elev)] border-2 border-ink font-extrabold shadow-sticker-sm sticker-press hover:bg-[var(--bg-elev-2)] px-3 py-1 inline-flex items-center gap-1"
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
                        className="text-xs font-semibold text-[var(--text-muted)] hover:text-[var(--text)] truncate max-w-[55%] inline-flex items-center gap-1"
                        title={mine.file_name ?? ""}
                      >
                        <Check aria-hidden size={12} weight="bold" />
                        {mine.file_name}
                      </a>
                    )}
                  </div>
                  {!isHost && mine?.feedback && (
                    <div className="mt-2 rounded-lg bg-grass-bg border-2 border-ink px-2.5 py-1.5 text-xs">
                      <span className="font-label text-grass-deep mr-1.5">
                        Feedback
                      </span>
                      <span className="font-semibold text-[var(--text)] whitespace-pre-wrap">
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
                        allowCapture
                        shrinkPhotos
                      />
                      {submissionDraft && (
                        <button
                          onClick={() =>
                            void persistSubmission(h.id, submissionDraft)
                          }
                          className="w-full text-xs rounded-full bg-brand-600 text-white border-2 border-ink font-extrabold shadow-sticker-primary sticker-press hover:bg-brand-500 px-3 py-2"
                        >
                          Submit
                        </button>
                      )}
                    </div>
                  )}

                  {isHost && open && subs.length > 0 && (
                    <ul className="mt-2 space-y-2 rounded-lg bg-[var(--bg-elev-2)] border-2 border-dashed border-[color:var(--border-strong)] p-2.5">
                      {subs.map((s) => (
                        <li key={s.id} className="text-xs space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="flex-1 min-w-0">
                              <span className="font-bold text-[var(--text)]">
                                {s.student_name}
                              </span>
                              <a
                                href={s.file_url ?? "#"}
                                target="_blank"
                                rel="noreferrer"
                                className="ml-2 font-bold text-brand-600 hover:underline truncate"
                              >
                                {s.file_name}
                              </a>
                            </span>
                            <span className="font-semibold text-[var(--text-dim)]">
                              {new Date(s.submitted_at).toLocaleString()}
                            </span>
                            <button
                              onClick={() => removeSubmission(s.id)}
                              className="text-[var(--text-dim)] hover:text-danger-700 inline-flex"
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
          <div className="border-t-2 border-dashed border-[color:var(--border)] p-4 space-y-2.5">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Homework title"
              className="w-full rounded-lg bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-sm font-semibold outline-none focus:border-brand-600 focus:shadow-[0_0_0_3px_var(--accent-soft)] px-3.5 py-2.5 text-sm"
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              rows={3}
              className="w-full rounded-lg bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-sm font-semibold outline-none focus:border-brand-600 focus:shadow-[0_0_0_3px_var(--accent-soft)] px-3.5 py-2.5 text-sm resize-none"
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
                className="flex-1 min-w-0 rounded-lg bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-sm font-semibold outline-none focus:border-brand-600 focus:shadow-[0_0_0_3px_var(--accent-soft)] px-3.5 py-2.5 text-sm"
              />
              <button
                onClick={add}
                disabled={!title.trim() || saving}
                className="rounded-full bg-brand-600 text-white border-2 border-ink font-extrabold shadow-sticker-primary sticker-press hover:bg-brand-500 disabled:opacity-40 px-4 py-2 text-sm shrink-0"
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
      <div className="flex items-center gap-2 rounded-lg bg-grass-bg border-2 border-ink px-2.5 py-1.5">
        <span className="font-label text-grass-deep shrink-0">
          Feedback
        </span>
        <span className="flex-1 font-semibold text-[var(--text)] whitespace-pre-wrap">
          {submission.feedback}
        </span>
        <button
          onClick={() => {
            setDraft(submission.feedback ?? "");
            setEditing(true);
          }}
          className="font-bold text-[var(--text-muted)] hover:text-[var(--text)]"
          title="Edit feedback"
        >
          Edit
        </button>
        <button
          onClick={() => onSet(null)}
          className="font-bold text-[var(--text-muted)] hover:text-danger-700"
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
            className="text-[11px] px-2.5 py-1 rounded-full bg-[var(--bg-elev)] border-2 border-ink font-extrabold shadow-sticker-sm sticker-press hover:bg-[var(--bg-elev-2)]"
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => {
            setDraft("");
            setEditing(true);
          }}
          className="text-[11px] px-2.5 py-1 rounded-full bg-[var(--bg-elev)] border-2 border-ink font-extrabold shadow-sticker-sm sticker-press hover:bg-[var(--bg-elev-2)] text-[var(--text-muted)]"
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
        className="w-full text-xs rounded-lg bg-[var(--bg-elev)] border-2 border-ink shadow-sticker-sm font-semibold outline-none focus:border-brand-600 focus:shadow-[0_0_0_3px_var(--accent-soft)] px-3 py-2 resize-none"
      />
      <div className="flex gap-1.5">
        <button
          onClick={() => {
            const v = draft.trim();
            onSet(v || null);
            setEditing(false);
          }}
          className="text-[11px] rounded-full bg-brand-600 text-white border-2 border-ink font-extrabold shadow-sticker-primary sticker-press hover:bg-brand-500 px-3 py-1"
        >
          Save
        </button>
        <button
          onClick={() => {
            setDraft(submission.feedback ?? "");
            setEditing(false);
          }}
          className="text-[11px] rounded-full bg-[var(--bg-elev)] border-2 border-ink font-extrabold shadow-sticker-sm sticker-press hover:bg-[var(--bg-elev-2)] px-3 py-1"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
