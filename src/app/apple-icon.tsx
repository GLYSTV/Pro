import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #8b5cf6 0%, #d946ef 100%)",
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ fontSize: 64, fontWeight: 800, letterSpacing: -2, lineHeight: 1 }}>GLYS</div>
        <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: 6, marginTop: 6 }}>TV·PRO</div>
      </div>
    ),
    size,
  );
}
