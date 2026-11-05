import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { bootstrap } from "@/db/bootstrap";
import { PairForm } from "@/components/pair-form";
import { getPairing, normalizePairingCode } from "@/lib/account";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Conectar TV" };

function Notice({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="w-full max-w-md rounded-3xl border border-white/10 bg-surface-2/90 p-8 text-center shadow-2xl backdrop-blur">
      <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-white/5">{icon}</div>
      <h1 className="mt-5 text-2xl font-bold text-white">{title}</h1>
      <p className="mt-2 text-sm text-slate-400">{text}</p>
      <Link href="/login" className="mt-6 inline-block rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand/90">
        Ir a iniciar sesión
      </Link>
    </div>
  );
}

export default async function PairPage({ params }: { params: Promise<{ code: string }> }) {
  await bootstrap();
  const raw = (await params).code;
  const pairing = await getPairing(raw);

  if (!pairing) {
    return (
      <Notice
        icon={<AlertTriangle className="h-8 w-8 text-amber-300" />}
        title="Código no válido o caducado"
        text={`El código ${normalizePairingCode(raw) || raw} ya no está activo. Pulsa «generar otro» en la pantalla de la TV y vuelve a escanear el QR.`}
      />
    );
  }
  return <PairForm code={pairing.code} initialDone={pairing.status !== "pending"} />;
}
