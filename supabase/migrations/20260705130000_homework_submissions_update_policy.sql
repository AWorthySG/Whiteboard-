-- Fix: host homework feedback silently never persists.
--
-- homework_submissions has RLS enabled with SELECT / INSERT / DELETE
-- policies but NO UPDATE policy — the 20260525120000 security migration
-- added UPDATE policies for join_requests / room_metadata / room_homework
-- but missed this table. So HomeworkDrawer.setFeedback's UPDATE was
-- RLS-filtered to zero rows and returned no error: the host saw the
-- feedback chip appear optimistically, nothing was written, and
-- useHomeworkReviewCount (which counts feedback IS NULL) never
-- decremented — the "needs review" badge stuck forever.
--
-- This table holds student-submission data, which follows the app's
-- documented permissive model (host-only actions enforced client-side),
-- matching room_homework / room_messages / room_documents. Add a
-- permissive UPDATE policy so feedback writes — and a student replacing
-- their own submission — persist.
drop policy if exists "Public update homework_submissions" on public.homework_submissions;
create policy "Public update homework_submissions"
  on public.homework_submissions for update using (true);
