import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { PwaRegister } from "@/components/pwa-register";
import { TvRemote } from "@/components/tv-remote";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "GLYSTV-PRO · Reproductor IPTV",
    template: "%s · GLYSTV-PRO",
  },
  description: "GLYSTV-PRO: reproductor IPTV con listas M3U, Xtream Codes, guía EPG, grabaciones, perfiles y modo TV.",
  applicationName: "GLYSTV-PRO",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "GLYSTV-PRO" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0b0d14",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen text-slate-100 antialiased">
        {children}
        <PwaRegister />
        <TvRemote />
      </body>
    </html>
  );
}
