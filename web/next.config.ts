import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ['recharts', 'lucide-react', 'date-fns'],
    staleTimes: {
      dynamic: 30,
      static: 300,
    },
  },
};

export default nextConfig;
