/**
 * Version guard for adapter v0.2.0 — stock OpenClaw only.
 * Core patch / OPENCLAW_WAM_CORE_PATCH are not required.
 */
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
