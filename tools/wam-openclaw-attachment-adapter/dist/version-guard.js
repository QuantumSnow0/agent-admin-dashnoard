/**
 * Version guard for adapter v0.2.0 — stock OpenClaw only.
 * Core patch / OPENCLAW_WAM_CORE_PATCH are not required.
 */
import { OPENCLAW_VERSION_GUARD } from "./types.js";
export function resolveOpenClawVersion(opts) {
    const env = opts?.env ?? process.env;
    const fromEnv = env.OPENCLAW_VERSION?.trim();
    if (fromEnv)
        return fromEnv;
    const cfg = opts?.apiConfig;
    if (cfg) {
        const v = (typeof cfg.version === "string" && cfg.version.trim()) ||
            (typeof cfg.openclawVersion === "string" && cfg.openclawVersion.trim()) ||
            null;
        if (v)
            return v;
    }
    return null;
}
export function assertOpenClawVersion(version) {
    if (!version?.trim()) {
        return { ok: false, version: null, reason: "openclaw_version_missing" };
    }
    const v = version.trim();
    if (OPENCLAW_VERSION_GUARD.allowedExact.includes(v)) {
        return { ok: true, version: v };
    }
    if (v.startsWith(OPENCLAW_VERSION_GUARD.minPrefix)) {
        if (v < OPENCLAW_VERSION_GUARD.maxExclusivePrefix) {
            return { ok: true, version: v };
        }
    }
    return {
        ok: false,
        version: v,
        reason: `openclaw_version_unsupported:${v}; require ${OPENCLAW_VERSION_GUARD.allowedExact.join("|")}`,
    };
}
