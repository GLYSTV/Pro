import Link from "next/link";
import { TvMinimal } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sin señal" };

export default function NotFound() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-brand/15">
          <TvMinimal className="h-8 w-8 text-brand-2" />
        </div>
        <h1 className="mt-5 text-2xl font-bold text-white">Sin señal</h1>
        <p className="mt-2 text-sm text-slate-400">La página o el canal que buscas no existe.</p>
        <Link href="/" className="mt-6 inline-block rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand/90">
          Volver al inicio
        </Link>
      </div>
    </div>
  );
}
