import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GLYSTV-PRO · Reproductor IPTV",
    short_name: "GLYSTV-PRO",
    description: "Reproductor IPTV con listas M3U, Xtream Codes, guía EPG, grabaciones y perfiles.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0b0d14",
    theme_color: "#0b0d14",
    lang: "es",
    categories: ["entertainment", "video"],
    icons: [
      { src: "/pwa-icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/pwa-icon/512?maskable=1", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Guía TV", url: "/guide", icons: [{ src: "/pwa-icon/192", sizes: "192x192" }] },
      { name: "Favoritos", url: "/favorites", icons: [{ src: "/pwa-icon/192", sizes: "192x192" }] },
      { name: "Grabaciones", url: "/recordings", icons: [{ src: "/pwa-icon/192", sizes: "192x192" }] },
    ],
  };
}
