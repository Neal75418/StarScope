import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    include: ["src/**/*.{test,spec}.{js,ts,jsx,tsx}"],
    exclude: ["node_modules", "dist", "e2e", "src-tauri"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      // Vitest 5 起這裡是完整路徑比對（不再是「包含」）：目錄要寫成 dir/**，只寫 "src/test/" 會什麼都排除不到
      exclude: [
        "**/node_modules/**",
        "src/test/**",
        "**/*.d.ts",
        "**/*.config.*",
        "**/dist/**",
        "src-tauri/**",
        "e2e/**",
        "**/index.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
