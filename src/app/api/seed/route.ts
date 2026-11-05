import { NextResponse } from "next/server";
import { importDemoCatalog } from "@/db/bootstrap";
import { apiProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Adds (or refreshes) the built-in demo channels in the account's catalogue. */
export async function POST() {
  const auth = await apiProfile();
  if (!auth.ok) return auth.response;
  const result = await importDemoCatalog(auth.user.id);
  return NextResponse.json({ channelsAdded: result.imported, updated: result.updated, playlistId: result.playlistId });
}
