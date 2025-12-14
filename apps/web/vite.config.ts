import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  plugins: [wasm(), topLevelAwait()],
  optimizeDeps: {
    // Exclude Rapier from pre-bundling since it uses WASM
    exclude: ["@dimforge/rapier3d"]
  },
  build: {
    target: "esnext"
  }
});
