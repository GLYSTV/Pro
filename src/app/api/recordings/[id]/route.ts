import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { recordings } from "@/db/schema";
import { apiProfile } from "@/lib/auth";
import { deleteRecordingFiles, stopRecording } from "@/lib/recorder";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function loadOwned(raw: string, profileId: number) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return null;
  const [rec] = await db
    .select()
    .from(recordings)
    .where(and(eq(recordings.id, id), eq(recordings.profileId, profileId)))
    .limit(1);
  return rec ?? null;
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await apiProfile();
  if (!auth.ok) return auth.response;
  const rec = await loadOwned((await params).id, auth.profile.id);
  if (!rec) return NextResponse.json({ error: "Grabación no encontrada" }, { status: 404 });
  return NextResponse.json(rec);
}

/** Cancels a scheduled recording or stops one in progress (keeping the captured part). */
export async function PATCH(_req: NextRequest, { params }: Ctx) {
  const auth = await apiProfile();
  if (!auth.ok) return auth.response;
  const rec = await loadOwned((await params).id, auth.profile.id);
  if (!rec) return NextResponse.json({ error: "Grabación no encontrada" }, { status: 404 });

  if (rec.status === "scheduled") {
    await db.update(recordings).set({ status: "cancelled" }).where(eq(recordings.id, rec.id));
  } else if (rec.status === "recording") {
    const stopped = await stopRecording(rec.id);
    if (!stopped) {
      await db
        .update(recordings)
        .set({ status: rec.segmentCount > 0 ? "completed" : "cancelled" })
        .where(eq(recordings.id, rec.id));
    }
  } else {
    return NextResponse.json({ error: "La grabación ya ha finalizado" }, { status: 400 });
  }
  const [updated] = await db.select().from(recordings).where(eq(recordings.id, rec.id)).limit(1);
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const auth = await apiProfile();
  if (!auth.ok) return auth.response;
  const rec = await loadOwned((await params).id, auth.profile.id);
  if (!rec) return NextResponse.json({ error: "Grabación no encontrada" }, { status: 404 });
  if (rec.status === "recording") await stopRecording(rec.id);
  await db.delete(recordings).where(eq(recordings.id, rec.id));
  await deleteRecordingFiles(rec.id);
  return NextResponse.json({ ok: true });
}
