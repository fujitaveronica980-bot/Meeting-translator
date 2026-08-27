import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // proxy.ts deliberately matches /api/sessions (so the password gate also
    // covers uploads), which means Next.js buffers the whole request body in
    // memory to let both proxy and the route handler read it — capped at a
    // default 10MB. A real meeting recording (tens of minutes of webm/opus)
    // blows past that easily, silently truncating the multipart body and
    // making req.formData() in api/sessions/route.ts throw "Failed to parse
    // body as FormData." Raise the cap well past any realistic recording.
    proxyClientMaxBodySize: "200mb",
  },
};

export default nextConfig;
