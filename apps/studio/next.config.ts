import path from 'node:path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  trailingSlash: false,
  productionBrowserSourceMaps: process.env.MCUT_SOURCE_MAPS === '1',
  // Monorepo root (silences multi-lockfile inference warning).
  turbopack: {
    root: path.join(import.meta.dirname, '../..'),
  },
}

export default nextConfig
