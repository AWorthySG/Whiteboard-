"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Two-tap confirmation for destructive buttons. window.confirm() is
// the easy choice on desktop, but iOS WebViews and some Android
// embedded browsers silently bypass it — the action runs without the
// user getting a chance to back out. This hook works everywhere.
//
// Usage:
//   const { armed, trigger, cancel } = useConfirmAction(actuallyDelete);
//   <button onClick={trigger}>
//     {armed ? "Confirm?" : "Delete"}
//   </button>
//
// armed === true between the first click and the second click (or the
// 4s timeout, whichever comes first). The second call within the
// armed window actually runs the action.
export function useConfirmAction(
  action: () => void | Promise<void>,
  timeoutMs = 4000,
) {
  const [armed, setArmed] = useState(false);
  const armedRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const actionRef = useRef(action);
  actionRef.current = action;

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const cancel = useCallback(() => {
    armedRef.current = false;
    setArmed(false);
    clearTimer();
  }, []);

  const trigger = useCallback(() => {
    if (armedRef.current) {
      cancel();
      void actionRef.current();
      return;
    }
    armedRef.current = true;
    setArmed(true);
    timerRef.current = window.setTimeout(cancel, timeoutMs);
  }, [cancel, timeoutMs]);

  useEffect(() => clearTimer, []);

  return { armed, trigger, cancel };
}
