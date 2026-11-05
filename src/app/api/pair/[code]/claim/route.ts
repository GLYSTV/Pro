import { NextRequest, NextResponse } from "next/server";
import { bootstrap } from "@/db/bootstrap";
import { claimPairing } from "@/lib/account";
import { startSessionFor } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Polled by the TV. Once the phone has sent valid credentials, the TV gets its session here. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  await bootstrap();
  const { code } = await params;
  let secret = "";
  try {
    const body = (await req.json()) as { secret?: unknown };
    secret = typeof body.secret === "string" ? body.secret : "";
  } catch {
    // no body
  }
  if (!secret) return NextResponse.json({ status: "invalid" }, { status: 400 });

  const result = await claimPairing(code, secret);
  if (result.status !== "ok") return NextResponse.json({ status: result.status });

  const redirect = await startSessionFor(result.userId);
  return NextResponse.json({ status: "ok", redirect });
}
