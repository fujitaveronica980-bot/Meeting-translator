import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfmake (via pdfkit) reads its own data files from disk at runtime, so
  // it has to be loaded from node_modules rather than bundled.
  serverExternalPackages: ["pdfmake"],
};

export default nextConfig;
