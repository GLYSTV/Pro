"use client";

import { useSyncExternalStore } from "react";

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type InstallWindow = Window & { __glystvInstall?: BeforeInstallPromptEvent | null };

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function captureInstallPrompt(e: Event) {
  e.preventDefault();
  (window as InstallWindow).__glystvInstall = e as BeforeInstallPromptEvent;
  notify();
}

export function clearInstallPrompt() {
  (window as InstallWindow).__glystvInstall = null;
  notify();
}

export function isInstallable(): boolean {
  return typeof window !== "undefined" && Boolean((window as InstallWindow).__glystvInstall);
}

export async function promptInstall(): Promise<boolean> {
  const evt = (window as InstallWindow).__glystvInstall;
  if (!evt) return false;
  await evt.prompt();
  const choice = await evt.userChoice;
  clearInstallPrompt();
  return choice.outcome === "accepted";
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useInstallable(): boolean {
  return useSyncExternalStore(subscribe, isInstallable, () => false);
}
