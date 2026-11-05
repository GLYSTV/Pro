import { NextResponse } from "next/server";
import { apiUser } from "@/lib/auth";
import { listCategoriesWithCounts } from "@/lib/channels";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await apiUser();
  if (!auth.ok) return auth.response;
  const items = await listCategoriesWithCounts(auth.user.id);
  return NextResponse.json({ items });
}
