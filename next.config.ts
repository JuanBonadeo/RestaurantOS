import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Barrels pesados: sin esto se importa el paquete entero para usar tres
    // símbolos (spec 108). `lucide-react` ya viene en la lista default de Next.
    optimizePackageImports: ["recharts", "date-fns", "date-fns-tz"],
  },
  eslint: {
    // El lint se corre aparte (npm run lint). No bloquea el build/deploy.
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "picsum.photos" },
      { protocol: "https", hostname: "fastly.picsum.photos" },
      // Pexels CDN — fotos generadas automáticamente vía generateProductImages
      { protocol: "https", hostname: "images.pexels.com" },
      { protocol: "http", hostname: "127.0.0.1", port: "54321" },
      { protocol: "http", hostname: "localhost", port: "54321" },
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
};

export default nextConfig;
