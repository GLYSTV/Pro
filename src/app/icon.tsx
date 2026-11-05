import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 16,
          background: "linear-gradient(135deg, #8b5cf6 0%, #d946ef 100%)",
          color: "white",
          fontSize: 26,
          fontWeight: 800,
          letterSpacing: -1,
          fontFamily: "sans-serif",
        }}
      >
        G
      </div>
    ),
    size,
  );
}
