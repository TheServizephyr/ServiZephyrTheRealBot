"use client";

/**
 * Deprecated:
 * Login completion is now intentionally owned by `/login`.
 * This component remains as a no-op so any accidental import will not
 * re-introduce the old global redirect side effects.
 */
export default function RedirectHandler() {
  return null;
}
