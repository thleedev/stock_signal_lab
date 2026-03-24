import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ['recharts', 'lucide-react', 'date-fns'],
    staleTimes: {
      dynamic: 300,
      static: 600,
    },
  },
};

export default nextConfig;
