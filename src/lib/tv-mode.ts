"use client";

import { useSyncExternalStore } from "react";

const KEY = "glystv:tvmode";
const listeners = new Set<() => void>();

const TV_UA = /smart-?tv|smarttv|tizen|web0s|webos|bravia|aft[a-z]?\b|android tv|googletv|hbbtv|netcast|viera|roku|philipstv/i;

export function isTvUserAgent(): boolean {
  return typeof navigator !== "undefined" && TV_UA.test(navigator.userAgent);
}

export function getTvMode(): boolean {
  if (typeof window === "undefined") return false;
  const stored = window.localStorage.getItem(KEY);
  if (stored === null) return isTvUserAgent();
  return stored === "1";
}

export function setTvMode(on: boolean) {
  window.localStorage.setItem(KEY, on ? "1" : "0");
  document.documentElement.classList.toggle("tv-mode", on);
  listeners.forEach((l) => l());
}

export function applyTvModeClass() {
  document.documentElement.classList.toggle("tv-mode", getTvMode());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useTvMode(): boolean {
  return useSyncExternalStore(subscribe, getTvMode, () => false);
}
