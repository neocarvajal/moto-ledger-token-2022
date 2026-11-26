import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["alliance-truth-baker-wallpaper.trycloudflare.com"],

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
