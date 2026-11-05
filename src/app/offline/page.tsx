import type { Metadata } from "next";
import Link from "next/link";
import { WifiOff } from "lucide-react";

export const metadata: Metadata = { title: "Sin conexión" };

export default function OfflinePage() {
  return (
    <div className="grid min-h-screen place-items-center px-6">
      <div className="text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-brand/15">
          <WifiOff className="h-8 w-8 text-brand-2" />
        </div>
        <h1 className="mt-5 text-2xl font-bold text-white">Sin conexión</h1>
        <p className="mt-2 max-w-sm text-sm text-slate-400">
          GLYSTV-PRO necesita conexión a internet para reproducir canales en directo. Comprueba tu red e inténtalo de nuevo.
        </p>
        <Link href="/" className="mt-6 inline-block rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand/90">
          Reintentar
        </Link>
      </div>
    </div>
  );
}
