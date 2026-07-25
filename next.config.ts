import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "@prisma/adapter-pg"],
  turbopack: {
    root: process.cwd(),
  },
  experimental: {
    // PDF ~3–4 Mo + multipart dépassent la limite par défaut (1 Mo) des Server Actions
    serverActions: {
      bodySizeLimit: "15mb",
    },
    proxyClientMaxBodySize: "15mb",
  },
};

export default nextConfig;
