"use client";

import { useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

/**
 * Returns false during SSR / the first client render, then true once hydrated.
 * Uses useSyncExternalStore (not setState-in-effect) so it is tear-free and
 * lint-clean, and avoids hydration mismatches with localStorage-backed state.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(emptySubscribe, clientSnapshot, serverSnapshot);
}
