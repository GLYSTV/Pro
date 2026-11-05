"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, KeyRound, Loader2, PlayCircle, Send, Server, Tv2, UserRound } from "lucide-react";
import { pairSubmitAction, type PairFormState } from "@/app/(auth)/actions";

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
      Usar la cuenta demo
    </button>
  );
}

export function PairForm({ code, initialDone = false }: { code: string; initialDone?: boolean }) {
  const [state, formAction, pending] = useActionState<PairFormState, FormData>(pairSubmitAction, {});
  const prettyCode = `${code.slice(0, 3)}-${code.slice(3)}`;

  if (!state.ok && initialDone) {
    return (
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-surface-2/90 p-8 text-center shadow-2xl backdrop-blur">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-white/5">
          <CheckCircle2 className="h-8 w-8 text-emerald-400" />
        </div>
        <h1 className="mt-5 text-2xl font-bold text-white">Este código ya se ha usado</h1>
        <p className="mt-2 text-sm text-slate-400">
          Los datos ya fueron enviados y tu TV debería haber iniciado sesión. Si no es así, genera un nuevo código en
          la TV y vuelve a escanearlo.
        </p>
        <Link href="/login" className="mt-6 inline-block rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand/90">
          Ir a iniciar sesión
        </Link>
      </div>
    );
  }

  if (state.ok) {
    return (
      <div className="w-full max-w-md rounded-3xl border border-emerald-500/30 bg-surface-2/90 p-6 text-center shadow-2xl backdrop-blur sm:p-8">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-emerald-500/15">
          <CheckCircle2 className="h-9 w-9 text-emerald-400" />
        </div>
        <h1 className="mt-5 text-2xl font-bold text-white">¡Listo{state.name ? `, ${state.name}` : ""}!</h1>
        <p className="mt-2 text-sm text-slate-300">
          Los datos se han enviado. Tu TV iniciará sesión automáticamente en unos segundos.
        </p>
        {state.syncError && (
          <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            La cuenta se creó, pero el catálogo no se pudo descargar todavía: {state.syncError}. Podrás
            resincronizarlo en «Fuentes».
          </p>
        )}
        <div className="mt-6 flex flex-col items-center gap-3">
          <p className="inline-flex items-center gap-2 text-xs text-slate-500">
            <Tv2 className="h-4 w-4" /> Código {prettyCode}
          </p>
          <Link
            href="/profiles"
            className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-surface hover:bg-slate-200"
          >
            Continuar también en este teléfono →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md rounded-3xl border border-white/10 bg-surface-2/90 p-6 shadow-2xl backdrop-blur sm:p-8">
      <p className="inline-flex items-center gap-2 rounded-full bg-brand/15 px-3 py-1 text-xs font-semibold tracking-wider text-brand-2 uppercase">
        <Tv2 className="h-3.5 w-3.5" /> Conectar TV · {prettyCode}
      </p>
      <h1 className="mt-4 text-2xl font-bold text-white">Datos de tu proveedor</h1>
      <p className="mt-1 text-sm text-slate-400">
        Escríbelos aquí con comodidad; la TV que muestra el código QR iniciará sesión por sí sola.
      </p>

      <form action={formAction} className="mt-6 space-y-4">
        <input type="hidden" name="code" value={code} />
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
            <input name="password" type="password" autoComplete="current-password" required placeholder="••••••••" className={inputCls} />
          </span>
        </label>

        {state.error && <p className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{state.error}</p>}

        <button
          type="submit"
          disabled={pending}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3 text-base font-semibold text-white transition hover:bg-brand/90 disabled:opacity-60"
        >
          {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          {pending ? "Validando con el proveedor…" : "Enviar a la TV"}
        </button>
      </form>

      <form action={formAction} className="mt-5 flex flex-col gap-3 border-t border-white/5 pt-5 sm:flex-row sm:items-center sm:justify-between">
        <input type="hidden" name="code" value={code} />
        <input type="hidden" name="serverUrl" value="demo" />
        <input type="hidden" name="username" value="demo" />
        <input type="hidden" name="password" value="demo" />
        <p className="text-xs text-slate-500">¿Sin proveedor? Conecta la TV con los canales de ejemplo.</p>
        <DemoButton />
      </form>
    </div>
  );
}
