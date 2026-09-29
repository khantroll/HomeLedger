import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export const CARGO_TARGET_WATCH_IGNORE = "**/src-tauri/target/**";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: [CARGO_TARGET_WATCH_IGNORE]
    }
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: { target: "es2021", minify: process.env.TAURI_ENV_DEBUG ? false : "esbuild" }
});
