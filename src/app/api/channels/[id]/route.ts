import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { channels } from "@/db/schema";
import { apiProfile } from "@/lib/auth";
import { getChannel } from "@/lib/channels";
import { isValidHttpUrl } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await apiProfile();
  if (!auth.ok) return auth.response;
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  const channel = await getChannel(id, auth.user.id, auth.profile.id);
  if (!channel) return NextResponse.json({ error: "Canal no encontrado" }, { status: 404 });
  return NextResponse.json(channel);
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await apiProfile();
  if (!auth.ok) return auth.response;
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: "ID inválido" }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const patch: Partial<typeof channels.$inferInsert> = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return NextResponse.json({ error: "El nombre no puede estar vacío" }, { status: 400 });
    patch.name = name;
  }
  if (body.streamUrl !== undefined) {
    const url = String(body.streamUrl).trim();
    if (!isValidHttpUrl(url)) return NextResponse.json({ error: "URL de stream inválida" }, { status: 400 });
    patch.streamUrl = url;
  }
  if (body.logoUrl !== undefined) {
    const logo = String(body.logoUrl ?? "").trim();
    patch.logoUrl = logo && isValidHttpUrl(logo) ? logo : null;
  }
  if (body.categoryId !== undefined) {
    patch.categoryId = body.categoryId === null || body.categoryId === "" ? null : Number(body.categoryId);
  }
  if (body.country !== undefined) {
    patch.country = body.country ? String(body.country).trim().toUpperCase().slice(0, 8) : null;
  }
  if (body.language !== undefined) {
    patch.language = body.language ? String(body.language).trim().toLowerCase().slice(0, 16) : null;
  }
  if (body.description !== undefined) {
    patch.description = body.description ? String(body.description).trim() : null;
  }
  if (body.tvgId !== undefined) patch.tvgId = body.tvgId ? String(body.tvgId).trim() : null;
  if (body.isActive !== undefined) patch.isActive = Boolean(body.isActive);
  if (body.channelNumber !== undefined) {
    patch.channelNumber = body.channelNumber === null || body.channelNumber === "" ? null : Number(body.channelNumber);
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nada que actualizar" }, { status: 400 });
  }

  const [updated] = await db
    .update(channels)
    .set(patch)
    .where(and(eq(channels.id, id), eq(channels.userId, auth.user.id)))
    .returning();
  if (!updated) return NextResponse.json({ error: "Canal no encontrado" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const auth = await apiProfile();
  if (!auth.ok) return auth.response;
  const id = parseId((await params).id);
  if (!id) return NextResponse.json({ error: "ID inválido" }, { status: 400 });
  const [deleted] = await db
    .delete(channels)
    .where(and(eq(channels.id, id), eq(channels.userId, auth.user.id)))
    .returning({ id: channels.id });
  if (!deleted) return NextResponse.json({ error: "Canal no encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
