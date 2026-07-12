import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["*.trycloudflare.com", "localhost:3000", "portway.kuldeeplakhera.me"]
};

export default nextConfig;
