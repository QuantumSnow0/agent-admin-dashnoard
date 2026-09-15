/// <reference types="vitest" />
import { defineConfig } from "vitest/config";

/** Disposable PostgreSQL integration suite — requires fixture DB. */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.integration.test.ts"],
    fileParallelism: false,
  },
});
