/// <reference types="vitest" />
import { defineConfig } from "vitest/config";

/** Non-database unit suite — must exit zero without PostgreSQL. */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/integration/**", "**/node_modules/**"],
  },
});
