import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

export const dynamic = "force-static";

/** Generates the PWA icon at any size (`/pwa-icon/192`, `/pwa-icon/512?maskable=1`). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ size: string }> }) {
  const requested = Number((await params).size);
  const size = Math.min(1024, Math.max(48, Number.isFinite(requested) ? requested : 192));
  const maskable = req.nextUrl.searchParams.get("maskable") === "1";
  const radius = maskable ? 0 : Math.round(size * 0.22);
  const fontSize = Math.round(size * (maskable ? 0.42 : 0.5));

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radius,
          background: "linear-gradient(135deg, #8b5cf6 0%, #d946ef 100%)",
          color: "white",
          fontSize,
          fontWeight: 800,
          letterSpacing: -2,
          fontFamily: "sans-serif",
        }}
      >
        G
      </div>
    ),
    { width: size, height: size, headers: { "cache-control": "public, max-age=86400" } },
  );
}
