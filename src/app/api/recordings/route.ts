import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, gt, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { channels, programs, recordings } from "@/db/schema";
import { apiProfile } from "@/lib/auth";
import { MAX_RECORDING_MINUTES, tick } from "@/lib/recorder";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await apiProfile();
  if (!auth.ok) return auth.response;
  const items = await db
    .select()
    .from(recordings)
    .where(eq(recordings.profileId, auth.profile.id))
    .orderBy(desc(recordings.startTime))
    .limit(200);
  return NextResponse.json({ items });
}

/**
 * Schedules a recording. Body: `{ channelId, programId? , startNow?, durationMinutes?, title? }`.
 * With `programId` the programme's times/title are used; with `startNow` the
 * recording starts immediately for `durationMinutes`.
 */
export async function POST(req: NextRequest) {
  const auth = await apiProfile();
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const now = new Date();
  let channelId = Number(body.channelId);
  let title = typeof body.title === "string" ? body.title.trim() : "";
  let description: string | null = null;
  let start: Date;
  let end: Date;

  if (body.programId != null) {
    const programId = Number(body.programId);
    const [program] = await db.select().from(programs).where(eq(programs.id, programId)).limit(1);
    if (!program) return NextResponse.json({ error: "Programa no encontrado" }, { status: 404 });
    channelId = program.channelId;
    title = title || program.title;
    description = program.description;
    start = program.startTime;
    end = new Date(program.endTime.getTime() + 60_000); // 1 min padding
  } else {
    const minutes = Math.min(MAX_RECORDING_MINUTES, Math.max(1, Number(body.durationMinutes) || 60));
    if (body.startNow || !body.startTime) {
      start = now;
      end = new Date(now.getTime() + minutes * 60_000);
    } else {
      start = new Date(String(body.startTime));
      end = body.endTime ? new Date(String(body.endTime)) : new Date(start.getTime() + minutes * 60_000);
    }
  }

  if (!Number.isInteger(channelId) || channelId <= 0) {
    return NextResponse.json({ error: "channelId inválido" }, { status: 400 });
  }
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return NextResponse.json({ error: "Horario inválido" }, { status: 400 });
  }
  if (end <= now) return NextResponse.json({ error: "El programa ya ha terminado" }, { status: 400 });
  if (end.getTime() - start.getTime() > MAX_RECORDING_MINUTES * 60_000) {
    return NextResponse.json({ error: `La duración máxima es de ${MAX_RECORDING_MINUTES} minutos` }, { status: 400 });
  }
  if (start < now) start = now;

  const [channel] = await db
    .select()
    .from(channels)
    .where(and(eq(channels.id, channelId), eq(channels.userId, auth.user.id)))
    .limit(1);
  if (!channel) return NextResponse.json({ error: "Canal no encontrado" }, { status: 404 });

  const [overlap] = await db
    .select({ id: recordings.id })
    .from(recordings)
    .where(
      and(
        eq(recordings.profileId, auth.profile.id),
        eq(recordings.channelId, channelId),
        inArray(recordings.status, ["scheduled", "recording"]),
        lt(recordings.startTime, end),
        gt(recordings.endTime, start),
      ),
    )
    .limit(1);
  if (overlap) {
    return NextResponse.json({ error: "Ya tienes una grabación de este canal en ese horario" }, { status: 409 });
  }

  const [created] = await db
    .insert(recordings)
    .values({
      profileId: auth.profile.id,
      channelId,
      channelName: channel.name,
      title: title || channel.name,
      description,
      streamUrl: channel.streamUrl,
      startTime: start,
      endTime: end,
      status: "scheduled",
    })
    .returning();

  if (start.getTime() <= now.getTime() + 1000) {
    void tick(); // start right away instead of waiting for the scheduler
  }

  return NextResponse.json(created, { status: 201 });
}
