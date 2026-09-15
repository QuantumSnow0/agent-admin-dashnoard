/** OpenClaw version guard — fail closed outside documented tags. */
export declare const ALLOWED_OPENCLAW_VERSIONS: readonly ["2026.7.1-2", "2026.7.1-1", "2026.7.1", "2026.7.2"];
export type VersionGuardResult = {
    ok: true;
    version: string;
} | {
    ok: false;
    version: string | null;
    reason: string;
};
export declare function resolveOpenClawVersion(opts?: {
    env?: NodeJS.ProcessEnv;
    apiConfig?: Record<string, unknown> | null;
}): string | null;
export declare function assertOpenClawVersion(version: string | null | undefined): VersionGuardResult;
