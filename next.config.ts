import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["publicity-globe-periodic-rentals.trycloudflare.com"],

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
