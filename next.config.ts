import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["node:sqlite"],
  allowedDevOrigins: ["dill-hummus-pusher.ngrok-free.dev", "*.ngrok-free.dev", "*.ngrok-free.app"]
};

export default nextConfig;
