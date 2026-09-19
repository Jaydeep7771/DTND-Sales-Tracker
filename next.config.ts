import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The PDF renderer must stay unbundled so its font and stream deps resolve.
  serverExternalPackages: ["@react-pdf/renderer"],
  /* config options here */
};

export default nextConfig;
