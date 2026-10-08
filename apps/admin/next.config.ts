import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

// The pnpm workspace root, so Next resolves workspace packages from there.
const root = fileURLToPath(new URL("../..", import.meta.url));

const nextConfig: NextConfig = {
  turbopack: { root },
  outputFileTracingRoot: root,
  transpilePackages: ["@momos/shared", "@momos/backend"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
