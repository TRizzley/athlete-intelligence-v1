/** @type {import('next').NextConfig} */
const nextConfig = {
  // The validation app is internal/beta; don't fail builds on lint.
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    // Server Actions handle screenshot uploads; allow a generous body size.
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
