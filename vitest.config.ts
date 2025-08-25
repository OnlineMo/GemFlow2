import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage",
      exclude: ["src/types/**", "src/index.ts", "src/cli.ts", "scripts/**"],
      thresholds: {
        lines: 80,
        functions: 90,
        branches: 65,
        statements: 80
      }
    },
    globals: true,
  },
  esbuild: {
    target: "node18",
  },
});