import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Slim self-contained server (used by the Dockerfile). Regular `next start` otherwise.
  output: process.env.DOCKER_BUILD === "1" ? "standalone" : undefined,
};

export default nextConfig;
