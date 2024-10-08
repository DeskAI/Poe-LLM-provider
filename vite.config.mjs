import { defineConfig } from "vite";
import { builtinModules } from "module";

export default defineConfig({
  build: {
    lib: {
      entry: "src/index.ts",
      formats: ["cjs"],
      fileName: 'index'
    },
    rollupOptions: {
      external: ["@deskai/api",  ...builtinModules, ...builtinModules.map((m) => `node:${m}`)],
    },
  },
});
