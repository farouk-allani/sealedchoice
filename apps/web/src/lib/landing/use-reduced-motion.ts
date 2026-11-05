"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onStoreChange: () => void): () => void {
  const query = window.matchMedia(QUERY);
  query.addEventListener("change", onStoreChange);
  return () => query.removeEventListener("change", onStoreChange);
}

const getSnapshot = (): boolean => window.matchMedia(QUERY).matches;

/** On the server nothing is known about the reader, so assume full motion and correct on hydrate. */
const getServerSnapshot = (): boolean => false;

/**
 * True when the reader has asked their system for less motion.
 *
 * Everything that reads this must have a sensible static form: it is also what a reader gets
 * before hydration.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
