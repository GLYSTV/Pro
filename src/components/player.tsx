"use client";

import Hls, { type Level } from "hls.js";
import {
  AlertTriangle,
  Loader2,
  Maximize2,
  Minimize2,
  PictureInPicture2,
  Play,
  RefreshCw,
  Shield,
  Volume2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChannelLogo } from "@/components/channel-logo";
import { useHydrated } from "@/components/time-text";
import { cn } from "@/lib/utils";

type Status = "loading" | "playing" | "paused" | "blocked" | "error";

const NATIVE_MEDIA = /\.(mp4|webm|ogg|ogv|mp3|aac|m4a|mov)(\?|#|$)/i;
const proxiedUrl = (url: string) => `/api/proxy?url=${encodeURIComponent(url)}`;

function levelLabel(level: Level) {
  if (level.height) return `${level.height}p`;
  if (level.bitrate) return `${Math.round(level.bitrate / 1000)} kbps`;
  return "Auto";
}

export function Player({
  streamUrl,
  name,
  logoUrl,
  className,
  allowProxy = true,
  live = true,
}: {
  streamUrl: string;
  name: string;
  logoUrl: string | null;
  className?: string;
  /** Retry through the server-side proxy when direct playback fails (CORS). */
  allowProxy?: boolean;
  /** Shows the LIVE badge; set to false for recordings. */
  live?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const triedProxy = useRef(false);

  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [useProxy, setUseProxy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [levels, setLevels] = useState<Level[]>([]);
  const [selectedLevel, setSelectedLevel] = useState(-1);
  const [activeLevel, setActiveLevel] = useState<number | null>(null);
  const [mutedAutoplay, setMutedAutoplay] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [pip, setPip] = useState(false);
  const hydrated = useHydrated();
  const pipSupported = hydrated && typeof document !== "undefined" && Boolean(document.pictureInPictureEnabled);

  // New channel → reset proxy state
  useEffect(() => {
    triedProxy.current = false;
    setUseProxy(false);
    setAttempt(0);
    setMutedAutoplay(false);
  }, [streamUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let destroyed = false;
    let hls: Hls | null = null;
    let mediaRecoveries = 0;
    let networkRetries = 0;

    setStatus("loading");
    setError(null);
    setLevels([]);
    setSelectedLevel(-1);
    setActiveLevel(null);

    const src = useProxy ? proxiedUrl(streamUrl) : streamUrl;
    const isNative = NATIVE_MEDIA.test(streamUrl);

    const fail = (message: string) => {
      if (destroyed) return;
      if (allowProxy && !useProxy && !triedProxy.current) {
        triedProxy.current = true;
        setUseProxy(true);
        return;
      }
      setError(message);
      setStatus("error");
    };

    const tryPlay = async () => {
      if (destroyed) return;
      try {
        await video.play();
        if (!destroyed) setStatus("playing");
      } catch {
        if (destroyed) return;
        // Autoplay with sound blocked → retry muted
        try {
          video.muted = true;
          await video.play();
          if (!destroyed) {
            setMutedAutoplay(true);
            setStatus("playing");
          }
        } catch {
          if (!destroyed) setStatus("blocked");
        }
      }
    };

    const onPlaying = () => setStatus("playing");
    const onPause = () => setStatus((s) => (s === "error" ? s : "paused"));
    const onWaiting = () => setStatus((s) => (s === "error" ? s : "loading"));
    const onNativeError = () => {
      if (!hls) fail("No se pudo reproducir el stream. Puede estar caído o no ser compatible.");
    };
    video.addEventListener("playing", onPlaying);
    video.addEventListener("pause", onPause);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("error", onNativeError);

    if (!isNative && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 30,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        manifestLoadingTimeOut: 15000,
        manifestLoadingMaxRetry: 1,
        levelLoadingTimeOut: 15000,
        fragLoadingTimeOut: 20000,
        capLevelToPlayerSize: false,
        startLevel: -1,
      });
      hlsRef.current = hls;

      hls.on(Hls.Events.MEDIA_ATTACHED, () => hls?.loadSource(src));
      hls.on(Hls.Events.MANIFEST_PARSED, (_evt, data) => {
        setLevels(data.levels);
        void tryPlay();
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_evt, data) => setActiveLevel(data.level));
      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (!data.fatal || !hls) return;
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR: {
            const isManifest =
              data.details === Hls.ErrorDetails.MANIFEST_LOAD_ERROR ||
              data.details === Hls.ErrorDetails.MANIFEST_LOAD_TIMEOUT ||
              data.details === Hls.ErrorDetails.MANIFEST_PARSING_ERROR;
            if (isManifest || networkRetries >= 2) {
              fail(
                "No se pudo cargar la señal. Puede tratarse de un bloqueo CORS, una restricción geográfica o un stream caído.",
              );
            } else {
              networkRetries++;
              hls.startLoad();
            }
            break;
          }
          case Hls.ErrorTypes.MEDIA_ERROR:
            if (mediaRecoveries < 2) {
              mediaRecoveries++;
              hls.recoverMediaError();
            } else {
              fail("Error de decodificación: el formato de vídeo o audio no es compatible con este navegador.");
            }
            break;
          default:
            fail("Error irrecuperable durante la reproducción.");
        }
      });
      hls.attachMedia(video);
    } else if (isNative || video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src;
      video.load();
      void tryPlay();
    } else {
      setError("Este navegador no soporta la reproducción de streams HLS.");
      setStatus("error");
    }

    return () => {
      destroyed = true;
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("error", onNativeError);
      if (hls) {
        hls.destroy();
        hlsRef.current = null;
      } else {
        video.removeAttribute("src");
        video.load();
      }
    };
  }, [streamUrl, useProxy, attempt, allowProxy]);

  const togglePip = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !document.pictureInPictureEnabled) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch {
      // PiP can be refused (e.g. no video track yet); ignore
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onEnter = () => setPip(true);
    const onLeave = () => setPip(false);
    video.addEventListener("enterpictureinpicture", onEnter);
    video.addEventListener("leavepictureinpicture", onLeave);
    return () => {
      video.removeEventListener("enterpictureinpicture", onEnter);
      video.removeEventListener("leavepictureinpicture", onLeave);
    };
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void el.requestFullscreen?.();
    }
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const video = videoRef.current;
      if (!video) return;
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        video.muted = !video.muted;
        if (!video.muted) setMutedAutoplay(false);
      } else if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        void togglePip();
      } else if (e.key === " " || e.key === "k") {
        e.preventDefault();
        if (video.paused) void video.play();
        else video.pause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleFullscreen, togglePip]);

  const changeLevel = (value: number) => {
    setSelectedLevel(value);
    if (hlsRef.current) hlsRef.current.currentLevel = value;
  };

  const unmute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    video.volume = 1;
    setMutedAutoplay(false);
  };

  const retry = () => {
    setAttempt((a) => a + 1);
  };

  const toggleProxy = () => {
    triedProxy.current = true;
    setUseProxy((p) => !p);
    setAttempt((a) => a + 1);
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "group relative aspect-video w-full overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl shadow-black/50",
        className,
      )}
    >
      <video
        ref={videoRef}
        className="h-full w-full bg-black"
        controls
        playsInline
        autoPlay
        preload="auto"
      />

      {/* Top overlay */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 bg-gradient-to-b from-black/80 to-transparent p-3 opacity-100 transition group-hover:opacity-100 sm:p-4 lg:opacity-0">
        <div className="flex min-w-0 items-center gap-3">
          <ChannelLogo name={name} logoUrl={logoUrl} className="h-10 w-14 shrink-0 bg-black/40" textClassName="text-xs" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white drop-shadow sm:text-base">{name}</p>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-300">
              {live ? (
                <span className="inline-flex items-center gap-1 rounded bg-red-600 px-1.5 py-0.5 font-bold tracking-wider text-white uppercase">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" /> Live
                </span>
              ) : (
                <span className="rounded bg-white/15 px-1.5 py-0.5 font-bold tracking-wider text-white uppercase">Grabación</span>
              )}
              {useProxy && (
                <span className="inline-flex items-center gap-1 rounded bg-white/15 px-1.5 py-0.5">
                  <Shield className="h-3 w-3" /> vía proxy
                </span>
              )}
              {activeLevel != null && levels[activeLevel] && (
                <span className="rounded bg-white/15 px-1.5 py-0.5 tabular-nums">{levelLabel(levels[activeLevel])}</span>
              )}
            </div>
          </div>
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          {levels.length > 1 && (
            <select
              value={selectedLevel}
              onChange={(e) => changeLevel(Number(e.target.value))}
              className="rounded-lg border border-white/15 bg-black/60 px-2 py-1 text-xs text-white backdrop-blur focus:outline-none"
              aria-label="Calidad"
            >
              <option value={-1}>Auto</option>
              {levels.map((lvl, i) => (
                <option key={i} value={i}>
                  {levelLabel(lvl)}
                </option>
              ))}
            </select>
          )}
          {pipSupported && (
            <button
              type="button"
              onClick={() => void togglePip()}
              className={cn(
                "rounded-lg border border-white/15 bg-black/60 p-1.5 text-white backdrop-blur hover:bg-black/80",
                pip && "border-brand bg-brand/40",
              )}
              aria-label={pip ? "Salir de Picture-in-Picture" : "Picture-in-Picture"}
              title="Picture-in-Picture (P)"
            >
              <PictureInPicture2 className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="rounded-lg border border-white/15 bg-black/60 p-1.5 text-white backdrop-blur hover:bg-black/80"
            aria-label={fullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
          >
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Center states */}
      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/30">
          <div className="flex flex-col items-center gap-3 text-slate-200">
            <Loader2 className="h-10 w-10 animate-spin text-brand-2" />
            <p className="text-sm">{useProxy ? "Conectando a través del proxy…" : "Sintonizando canal…"}</p>
          </div>
        </div>
      )}

      {status === "blocked" && (
        <button
          type="button"
          onClick={() => void videoRef.current?.play()}
          className="absolute inset-0 grid place-items-center bg-black/50"
        >
          <span className="grid h-20 w-20 place-items-center rounded-full bg-white text-surface shadow-2xl transition hover:scale-105">
            <Play className="ml-1 h-8 w-8 fill-current" />
          </span>
        </button>
      )}

      {mutedAutoplay && status === "playing" && (
        <button
          type="button"
          onClick={unmute}
          className="absolute bottom-16 left-4 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-surface shadow-lg transition hover:bg-slate-200"
        >
          <Volume2 className="h-4 w-4" /> Activar sonido
        </button>
      )}

      {status === "error" && (
        <div className="absolute inset-0 grid place-items-center bg-black/80 p-6">
          <div className="max-w-md text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-red-500/15">
              <AlertTriangle className="h-7 w-7 text-red-400" />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-white">No se pudo reproducir «{name}»</h3>
            <p className="mt-2 text-sm text-slate-400">{error}</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={retry}
                className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-surface hover:bg-slate-200"
              >
                <RefreshCw className="h-4 w-4" /> Reintentar
              </button>
              {allowProxy && (
                <button
                  type="button"
                  onClick={toggleProxy}
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10"
                >
                  <Shield className="h-4 w-4" /> {useProxy ? "Probar conexión directa" : "Probar con proxy"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
