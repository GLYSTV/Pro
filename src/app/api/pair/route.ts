import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { bootstrap } from "@/db/bootstrap";
import { createPairing } from "@/lib/account";

export const dynamic = "force-dynamic";

/** Creates a pairing code for this device and returns the QR the phone must scan. */
export async function POST(req: NextRequest) {
  await bootstrap();
  let origin = "";
  try {
    const body = (await req.json()) as { origin?: unknown };
    if (typeof body.origin === "string") origin = body.origin.trim();
  } catch {
    // no body
  }
  if (!/^https?:\/\/[^/\s]+$/i.test(origin)) {
    const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000").split(",")[0].trim();
    const proto = (req.headers.get("x-forwarded-proto") ?? "http").split(",")[0].trim();
    origin = `${proto}://${host}`;
  }

  const pairing = await createPairing();
  const url = `${origin}/pair/${pairing.code}`;
  const qrSvg = await QRCode.toString(url, {
    type: "svg",
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#ffffff", light: "#00000000" },
  });

  return NextResponse.json({
    code: pairing.code,
    secret: pairing.secret,
    expiresAt: pairing.expiresAt.toISOString(),
    url,
    qrSvg,
  });
}
