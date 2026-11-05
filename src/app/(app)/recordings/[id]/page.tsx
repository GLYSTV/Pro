import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ArrowLeft, Download } from "lucide-react";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { Player } from "@/components/player";
import { TimeText } from "@/components/time-text";
import { requireProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Grabación" };

export default async function RecordingPage({ params }: { params: Promise<{ id: string }> }) {
  const { profile } = await requireProfile();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [rec] = await db
    .select()
    .from(recordings)
    .where(and(eq(recordings.id, id), eq(recordings.profileId, profile.id)))
    .limit(1);
  if (!rec) notFound();

  return (
    <div className="space-y-5">
      <Link href="/recordings" className="inline-flex items-center gap-2 text-sm text-slate-400 transition hover:text-white">
        <ArrowLeft className="h-4 w-4" /> Volver a grabaciones
      </Link>
      {rec.segmentCount > 0 ? (
        <Player streamUrl={`/api/recordings/${rec.id}/playlist.m3u8`} name={rec.title} logoUrl={null} allowProxy={false} live={false} />
      ) : (
        <div className="grid aspect-video place-items-center rounded-2xl border border-white/10 bg-black text-sm text-slate-400">
          {rec.status === "scheduled" ? "La grabación aún no ha comenzado." : "Esta grabación no tiene datos."}
        </div>
      )}
      <div className="flex flex-col gap-3 rounded-2xl border border-white/5 bg-surface-2/80 p-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-white sm:text-2xl">{rec.title}</h1>
          <p className="mt-1 text-sm text-slate-400">
            {rec.channelName} · <TimeText date={rec.startTime} mode="datetime" /> – <TimeText date={rec.endTime} />
            {rec.status === "recording" ? " · grabando en directo" : ""}
          </p>
          {rec.description && <p className="mt-3 text-sm leading-relaxed text-slate-300">{rec.description}</p>}
        </div>
        {rec.segmentCount > 0 && rec.status !== "recording" && (
          <a
            href={`/api/recordings/${rec.id}/download`}
            className="inline-flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"
          >
            <Download className="h-4 w-4" /> Descargar ({rec.container === "mp4" ? "MP4" : "TS"})
          </a>
        )}
      </div>
    </div>
  );
}
