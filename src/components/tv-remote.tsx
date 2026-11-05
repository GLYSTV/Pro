"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { applyTvModeClass, getTvMode } from "@/lib/tv-mode";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type Direction = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

function isVisible(el: HTMLElement) {
  if (el.closest("[aria-hidden='true']")) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = window.getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none";
}

function candidates(scope: ParentNode): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isVisible);
}

/** Finds the best focus target in a direction using edge distance + cross-axis alignment. */
function findInDirection(current: HTMLElement, items: HTMLElement[], dir: Direction): HTMLElement | null {
  const r = current.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const el of items) {
    if (el === current || current.contains(el) || el.contains(current)) continue;
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2;
    const by = b.top + b.height / 2;

    let primary: number;
    let secondary: number;
    let overlap: number;
    switch (dir) {
      case "ArrowRight":
        primary = b.left - r.right;
        secondary = Math.abs(by - cy);
        overlap = Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top);
        break;
      case "ArrowLeft":
        primary = r.left - b.right;
        secondary = Math.abs(by - cy);
        overlap = Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top);
        break;
      case "ArrowDown":
        primary = b.top - r.bottom;
        secondary = Math.abs(bx - cx);
        overlap = Math.min(r.right, b.right) - Math.max(r.left, b.left);
        break;
      default:
        primary = r.top - b.bottom;
        secondary = Math.abs(bx - cx);
        overlap = Math.min(r.right, b.right) - Math.max(r.left, b.left);
    }
    if (primary < -4) continue;
    const score = Math.max(primary, 0) + secondary * (overlap > 0 ? 0.6 : 3);
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

function isBackKey(e: KeyboardEvent) {
  return (
    e.key === "GoBack" ||
    e.key === "BrowserBack" ||
    e.key === "XF86Back" ||
    e.keyCode === 10009 || // Samsung Tizen
    e.keyCode === 461 || // LG webOS
    e.keyCode === 166 // Browser back
  );
}

function isField(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return Boolean(el && (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || el.isContentEditable));
}

/**
 * Global keyboard controller for TV remotes:
 *  - D-pad spatial navigation (only in TV mode),
 *  - Back key → history back / exit fullscreen,
 *  - Media keys → play/pause and channel up/down (dispatched as `glystv:zap`).
 */
export function TvRemote() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    applyTvModeClass();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const dialogOpen = Boolean(document.querySelector("[data-tv-dialog]"));
      const tvMode = getTvMode();

      // Back
      if (isBackKey(e) || (tvMode && e.key === "Escape")) {
        if (isField(e.target) || dialogOpen) return;
        e.preventDefault();
        if (document.fullscreenElement) {
          void document.exitFullscreen();
        } else if (window.history.length > 1 && pathname !== "/") {
          router.back();
        } else {
          router.push("/");
        }
        return;
      }

      // Media keys
      if (e.key === "MediaPlayPause" || e.key === "MediaPlay" || e.key === "MediaPause" || e.keyCode === 415 || e.keyCode === 19) {
        const video = document.querySelector("video");
        if (video) {
          e.preventDefault();
          if (e.key === "MediaPlay" || e.keyCode === 415) void video.play();
          else if (e.key === "MediaPause" || e.keyCode === 19) video.pause();
          else if (video.paused) void video.play();
          else video.pause();
        }
        return;
      }
      if (e.key === "MediaStop" || e.keyCode === 413) {
        const video = document.querySelector("video");
        if (video) {
          e.preventDefault();
          video.pause();
        }
        return;
      }
      if (e.key === "ChannelUp" || e.key === "MediaTrackNext" || e.keyCode === 427) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("glystv:zap", { detail: 1 }));
        return;
      }
      if (e.key === "ChannelDown" || e.key === "MediaTrackPrevious" || e.keyCode === 428) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("glystv:zap", { detail: -1 }));
        return;
      }

      // Spatial navigation (TV mode only)
      if (!tvMode) return;
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
      const dir = e.key as Direction;
      const target = e.target as HTMLElement | null;
      if (isField(e.target)) {
        if (target?.tagName === "SELECT") return;
        if (target?.tagName === "TEXTAREA") return;
        if (dir === "ArrowLeft" || dir === "ArrowRight") return; // let the caret move
      }
      // The watch page owns Up/Down for zapping.
      if ((dir === "ArrowUp" || dir === "ArrowDown") && document.querySelector("[data-tv-zap]") && !dialogOpen) return;

      const scope: ParentNode = dialogOpen ? (document.querySelector("[data-tv-dialog]") as HTMLElement) : document;
      const items = candidates(scope);
      if (items.length === 0) return;
      const current = document.activeElement as HTMLElement | null;
      if (!current || current === document.body || !items.includes(current)) {
        const first = items.find((el) => el.closest("main")) ?? items[0];
        e.preventDefault();
        first.focus();
        return;
      }
      const next = findInDirection(current, items, dir);
      if (next) {
        e.preventDefault();
        next.focus({ preventScroll: true });
        next.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, pathname]);

  return null;
}
