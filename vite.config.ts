import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    react(),
    // Bundle 分析器（僅在 build 時生成）
    process.env.ANALYZE && visualizer({
      filename: "dist/stats.html",
      open: true,
      gzipSize: true,
      brotliSize: true,
      template: "treemap", // sunburst, treemap, network
    }),
  ].filter(Boolean),

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,

  // Build optimizations
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Separate large charting library for better caching
          recharts: ["recharts"],
          // Separate React runtime
          "react-vendor": ["react", "react-dom"],
          // Separate animation library (~45KB gzipped)
          "framer-motion": ["framer-motion"],
        },
      },
    },
  },
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
