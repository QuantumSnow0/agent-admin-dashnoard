import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Package root (`wam-apps-ai-mcp/`), whether in-repo or extracted from the clean archive. */
export function packageRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

/**
 * Bundled SQL migrations shipped inside the clean archive.
 * Packaging tests must use this path so verification works after extraction
 * without the monorepo `admin-dashboard/supabase/migrations` tree.
 */
export function bundledMigrationsDir(): string {
  return join(packageRoot(), "migrations");
}

/**
 * Optional monorepo supabase migrations path (present only when running inside
 * the full repository checkout). Never required for clean-archive verification.
 */
export function repoSupabaseMigrationsDir(): string | null {
  const candidate = join(packageRoot(), "..", "..", "supabase", "migrations");
  return existsSync(candidate) ? candidate : null;
}
