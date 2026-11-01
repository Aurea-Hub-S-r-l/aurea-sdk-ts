import { defineConfig } from "tsup";

// ESM + CJS + type declarations, one bundle each; no source maps (nothing with a local path is published).
export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: false,
  target: "es2022",
  platform: "neutral",
  treeshake: true,
  splitting: false,
});
