"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  LogIn,
  PlayCircle,
  QrCode,
  RefreshCw,
  Server,
  Smartphone,
  UserRound,
} from "lucide-react";
import { demoLoginAction, loginAction, type AuthFormState } from "@/app/(auth)/actions";
import { cn } from "@/lib/utils";

interface PairInfo {
  code: string;
  secret: string;
  expiresAt: string;
  url: string;
  qrSvg: string;
}

type PairStatus = "loading" | "waiting" | "ok" | "expired" | "error";

const inputCls =
  "w-full rounded-xl border border-white/10 bg-surface-3 py-3 pr-3.5 pl-11 text-base text-white placeholder:text-slate-500 focus:border-brand/60 focus:ring-2 focus:ring-brand/30 focus:outline-none";

function DemoButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10 disabled:opacity-60"
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
      {pending ? "Preparando la demo…" : "Probar con la cuenta demo"}
    </button>
  );
}

function formatCode(code: string) {
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

export function LoginForm({ initialError }: { initialError?: string }) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(loginAction, {});
  const [pair, setPair] = useState<PairInfo | null>(null);
  const [pairStatus, setPairStatus] = useState<PairStatus>("loading");

  const requestPairing = useCallback(async () => {
    try {
      const res = await fetch("/api/pair", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ origin: window.location.origin }),
      });
      if (!res.ok) throw new Error("pair failed");
      const data = (await res.json()) as PairInfo;
      setPair(data);
      setPairStatus("waiting");
    } catch {
      setPairStatus("error");
    }
  }, []);

  useEffect(() => {
    void requestPairing();
  }, [requestPairing]);

  // Poll until the phone has sent the credentials, then enter with the new session.
  useEffect(() => {
    if (!pair || pairStatus !== "waiting") return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/pair/${pair.code}/claim`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ secret: pair.secret }),
        });
        const data = (await res.json()) as { status: string; redirect?: string };
        if (cancelled) return;
        if (data.status === "ok") {
          setPairStatus("ok");
          window.location.assign(data.redirect ?? "/profiles");
        } else if (data.status === "expired" || data.status === "invalid") {
          setPairStatus("expired");
        }
      } catch {
        // network hiccup: keep polling
      }
    };
    const interval = setInterval(() => void poll(), 3000);
    const expiry = setTimeout(
      () => setPairStatus("expired"),
      Math.max(1000, new Date(pair.expiresAt).getTime() - Date.now()),
    );
    return () => {
      cancelled = true;
      clearInterval(interval);
      clearTimeout(expiry);
    };
  }, [pair, pairStatus]);

  const regenerate = () => {
    setPair(null);
    setPairStatus("loading");
    void requestPairing();
  };

  const error = state.error ?? (initialError === "demo" ? "No se pudo preparar la cuenta de demostración." : undefined);

  return (
    <div className="grid w-full max-w-5xl gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      {/* ───── Credentials ───── */}
      <section className="rounded-3xl border border-white/10 bg-surface-2/90 p-6 shadow-2xl backdrop-blur sm:p-8">
        <h1 className="text-2xl font-bold text-white">Iniciar sesión</h1>
        <p className="mt-1 text-sm text-slate-400">
          Introduce los datos de tu proveedor IPTV (API Xtream Codes). Compatible con Xtream / XUI.
        </p>

        <form action={formAction} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-400">URL del servidor</span>
            <span className="relative block">
              <Server className="pointer-events-none absolute top-1/2 left-3.5 h-4.5 w-4.5 -translate-y-1/2 text-slate-500" />
              <input
                name="serverUrl"
                type="text"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                placeholder="http://servidor.com:8080"
                className={inputCls}
              />
            </span>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-400">Usuario</span>
            <span className="relative block">
              <UserRound className="pointer-events-none absolute top-1/2 left-3.5 h-4.5 w-4.5 -translate-y-1/2 text-slate-500" />
              <input
                name="username"
                type="text"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="username"
                spellCheck={false}
                required
                placeholder="usuario"
                className={inputCls}
              />
            </span>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-slate-400">Contraseña</span>
            <span className="relative block">
              <KeyRound className="pointer-events-none absolute top-1/2 left-3.5 h-4.5 w-4.5 -translate-y-1/2 text-slate-500" />
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
                placeholder="••••••••"
                className={inputCls}
              />
            </span>
          </label>

          {error && <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}

          <button
            type="submit"
            disabled={pending}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3 text-base font-semibold text-white transition hover:bg-brand/90 disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <LogIn className="h-5 w-5" />}
            {pending ? "Conectando con el proveedor…" : "Entrar"}
          </button>
        </form>

        <div className="mt-6 flex flex-col gap-3 border-t border-white/5 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">¿Todavía no tienes proveedor? Explora la app con canales públicos de ejemplo.</p>
          <form action={demoLoginAction}>
            <DemoButton />
          </form>
        </div>
      </section>

      {/* ───── QR pairing ───── */}
      <aside className="flex flex-col rounded-3xl border border-white/10 bg-surface-2/90 p-6 shadow-2xl backdrop-blur">
        <div className="flex items-center gap-2">
          <Smartphone className="h-5 w-5 text-brand-2" />
          <h2 className="font-semibold text-white">Entrar desde el móvil</h2>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          Escanea el código con tu teléfono, escribe allí la URL, el usuario y la contraseña, y esta pantalla iniciará
          sesión sola. Ideal para la TV.
        </p>

        <div className="mt-5 flex flex-1 flex-col items-center justify-center">
          <div
            className={cn(
              "relative grid aspect-square w-full max-w-[220px] place-items-center rounded-2xl border border-white/10 bg-black/40 p-3",
              pairStatus === "expired" && "opacity-40",
            )}
          >
            {pair && pairStatus !== "loading" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`data:image/svg+xml;utf8,${encodeURIComponent(pair.qrSvg)}`}
                alt={`Código QR de emparejamiento ${formatCode(pair.code)}`}
                className="h-full w-full"
              />
            ) : pairStatus === "error" ? (
              <QrCode className="h-12 w-12 text-slate-600" />
            ) : (
              <Loader2 className="h-8 w-8 animate-spin text-brand-2" />
            )}
            {pairStatus === "ok" && (
              <div className="absolute inset-0 grid place-items-center rounded-2xl bg-surface-2/90">
                <CheckCircle2 className="h-12 w-12 text-emerald-400" />
              </div>
            )}
          </div>

          {pair && (
            <>
              <p className="mt-4 text-[11px] tracking-[0.2em] text-slate-500 uppercase">Código</p>
              <p className="mt-1 text-3xl font-bold tracking-[0.3em] text-white tabular-nums">{formatCode(pair.code)}</p>
              <p className="mt-2 max-w-full truncate text-center text-xs text-slate-500" title={pair.url}>
                {pair.url.replace(/^https?:\/\//, "")}
              </p>
            </>
          )}
        </div>

        <div className="mt-5 min-h-10 text-center text-sm">
          {pairStatus === "waiting" && (
            <p className="inline-flex items-center gap-2 text-slate-300">
              <span className="h-2 w-2 animate-pulse rounded-full bg-brand-2" /> Esperando los datos del móvil…
            </p>
          )}
          {pairStatus === "ok" && <p className="font-medium text-emerald-300">¡Datos recibidos! Entrando…</p>}
          {pairStatus === "loading" && <p className="text-slate-500">Generando código…</p>}
          {(pairStatus === "expired" || pairStatus === "error") && (
            <button
              type="button"
              onClick={regenerate}
              className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10"
            >
              <RefreshCw className="h-4 w-4" />
              {pairStatus === "expired" ? "Código caducado · generar otro" : "No se pudo generar · reintentar"}
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
