"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** True only after hydration; identical on server and during hydration (false). */
export function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

type Mode = "time" | "datetime" | "date";

function format(iso: string, mode: Mode, timeZone?: string) {
  const d = new Date(iso);
  if (mode === "time") {
    return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone });
  }
  if (mode === "date") {
    return d.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", timeZone });
  }
  return d.toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone });
}

/**
 * Renders a date in the visitor's local timezone without hydration mismatches:
 * the server snapshot (UTC) is used during hydration, then the local value
 * replaces it.
 */
export function TimeText({ date, mode = "time" }: { date: string | Date; mode?: Mode }) {
  const iso = typeof date === "string" ? date : date.toISOString();
  const value = useSyncExternalStore(
    subscribe,
    () => format(iso, mode),
    () => format(iso, mode, "UTC"),
  );
  return <>{value}</>;
}
