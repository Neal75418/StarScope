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
      // 另外排除測試產物：npm run test:coverage 會在 coverage/ 寫出約 400 個
      // HTML 檔，vite 預設會監看它們，於是跑完覆蓋率之後 npm run dev 會被
      // 幾百次 page reload 洗版，每次都重掛整個 app 並重抓所有 API。
      // 這些目錄都在 .gitignore 裡，但 vite 的 watcher 不看 .gitignore。
      ignored: ["**/src-tauri/**", "**/coverage/**", "**/.venv/**", "**/htmlcov/**"],
    },
  },
}));
