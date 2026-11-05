import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { CircleDot } from "lucide-react";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { RecordingsList } from "@/components/recordings-list";
import { requireProfile } from "@/lib/auth";
import { MAX_CONCURRENT_RECORDINGS, MAX_RECORDING_MINUTES } from "@/lib/recorder";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Grabaciones" };

export default async function RecordingsPage() {
  const { profile } = await requireProfile();
  const rows = await db
    .select()
    .from(recordings)
    .where(eq(recordings.profileId, profile.id))
    .orderBy(desc(recordings.startTime))
    .limit(200);

  return (
    <div className="space-y-6">
      <div>
        <p className="inline-flex items-center gap-2 text-xs font-semibold tracking-[0.2em] text-brand-2 uppercase">
          <CircleDot className="h-3.5 w-3.5" /> DVR
        </p>
        <h1 className="mt-2 text-2xl font-bold text-white sm:text-3xl">Grabaciones</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          Las grabaciones se realizan en el servidor: puedes cerrar la app y verlas más tarde o descargarlas. Máximo{" "}
          {MAX_RECORDING_MINUTES / 60} horas por grabación y {MAX_CONCURRENT_RECORDINGS} simultáneas.
        </p>
      </div>
      <RecordingsList
        recordings={rows.map((r) => ({
          id: r.id,
          title: r.title,
          channelName: r.channelName,
          channelId: r.channelId,
          startTime: r.startTime.toISOString(),
          endTime: r.endTime.toISOString(),
          status: r.status,
          segmentCount: r.segmentCount,
          sizeBytes: r.sizeBytes,
          durationSeconds: r.durationSeconds,
          error: r.error,
        }))}
      />
    </div>
  );
}
