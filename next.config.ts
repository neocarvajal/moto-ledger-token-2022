import type { NextConfig } from "next";

const publicAppUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();

const allowedDevOrigins = publicAppUrl
  ? [new URL(publicAppUrl).hostname]
  : [];

const nextConfig: NextConfig = {
  allowedDevOrigins,

  async headers() {
    return [
      {
        source: "/vincular-wallet/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
      {
        source: "/api/wallet-link/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
        ],
      },
    ];
  },

  experimental: {
    agentUpgrade: "security",
  },

  serverExternalPackages: ["ws"],

  turbopack: {
    resolveAlias: {
      fs: { browser: "./empty-module.js" },
    },
  },

  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
      };
    }

    return config;
  },
};

export default nextConfig;
