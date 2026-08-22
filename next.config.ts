import type { NextConfig } from "next";

// The dev server is reached through an HTTPS tunnel because Meta requires a public
// URL. Next blocks cross-origin /_next/* requests from any host other than localhost,
// which stops the client chunks from loading and leaves every page stuck on its
// loading skeleton. Derived from NEXTAUTH_URL so it follows the tunnel domain instead
// of hardcoding one, and it is ignored in production builds.
const devOrigin = (() => {
  try {
    return process.env.NEXTAUTH_URL
      ? new URL(process.env.NEXTAUTH_URL).host
      : undefined;
  } catch {
    return undefined;
  }
})();

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  turbopack: {
    root: process.cwd(),
  },
  ...(devOrigin ? { allowedDevOrigins: [devOrigin] } : {}),
};

export default nextConfig;
