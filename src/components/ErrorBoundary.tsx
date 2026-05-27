"use client";

import { Component, type ReactNode } from "react";

// Reusable React error boundary for wrapping volatile subtrees (the video
// panel, drawers) so one widget throwing during render doesn't take down
// the whole room via the route-level error.tsx — the live whiteboard
// stays up. `fallback` receives a `reset` to remount the children (e.g.
// "reload video"). Class component because only class components can be
// error boundaries.
type Props = {
  children: ReactNode;
  fallback: (reset: () => void, error: Error) => ReactNode;
  // Optional label for the console log so crashes are attributable.
  label?: string;
};

export default class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(`[error-boundary${this.props.label ? `: ${this.props.label}` : ""}]`, error);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) return this.props.fallback(this.reset, this.state.error);
    return this.props.children;
  }
}
