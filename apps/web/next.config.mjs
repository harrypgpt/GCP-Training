/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Compile the workspace package from source for a smooth dev experience.
  transpilePackages: ['@gcp/shared'],
  // Linting is a dedicated pipeline step (`pnpm lint`, flat config with the
  // Next plugin). Don't run it again during `next build`.
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
