/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // The floating "N" badge (dev-tools: routes/bundler/preferences) is
  // Next.js's dev-only indicator; users kept clicking it by accident.
  devIndicators: false,
}

export default nextConfig
