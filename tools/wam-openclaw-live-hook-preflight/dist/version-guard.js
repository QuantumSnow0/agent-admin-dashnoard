/** OpenClaw version guard — fail closed outside documented tags. */
export const ALLOWED_OPENCLAW_VERSIONS = [
    "2026.7.1-2",
    "2026.7.1-1",
    "2026.7.1",
    "2026.7.2",
];
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
    if (ALLOWED_OPENCLAW_VERSIONS.includes(v)) {
        return { ok: true, version: v };
    }
    if (v.startsWith("2026.7.1") && v < "2026.7.3") {
        return { ok: true, version: v };
    }
    return {
        ok: false,
        version: v,
        reason: `openclaw_version_unsupported:${v}; require ${ALLOWED_OPENCLAW_VERSIONS.join("|")}`,
    };
}
