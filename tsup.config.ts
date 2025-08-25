import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    cli: "src/cli.ts",
  },
  format: ["cjs", "esm"],
  dts: {
    entry: "src/index.ts",
  },
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  target: "node18",
  shims: true,
  treeshake: true,
  outExtension({ format }) {
    return {
      js: format === "cjs" ? ".cjs" : ".js",
    };
  },
  env: {
    BUILD_TIME: new Date().toISOString(),
  },
});