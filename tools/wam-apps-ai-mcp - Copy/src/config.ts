export type IdentityMode = "production" | "development";

export type ActorRole =
  | "technical_owner"
  | "business_partner"
  | "ai_service"
  | "system_maintenance"
  | "unknown";

/** Production gateways may only bind these roles (two-Gateway architecture). */
export const PRODUCTION_GATEWAY_ROLES: ReadonlyArray<ActorRole> = [
  "technical_owner",
  "business_partner",
];

/** Only these hosts are allowed when WAM_AI_IDENTITY_MODE=development. */
export const LOCAL_DB_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export type ActorContext = {
  actorId: string;
  actorRole: ActorRole;
  sessionOrChannelId: string | null;
  /** True only for production instance-bound identity. Never from tool args. */
  identityVerified: boolean;
  instanceId: string | null;
};

export type AppConfig = {
  /** null when WAM_AI_IDENTITY_MODE is missing/invalid (fail-closed). */
  identityMode: IdentityMode | null;
  /** Set when identity mode fails closed; never silent default. */
  identityModeError: string | null;
  instanceId: string | null;
  killSwitch: boolean;
  queryTimeoutMs: number;
  maxResponseChars: number;
  rateLimitPerMinute: number;
  databaseUrl: string | null;
  requiredDbUser: string;
  /** Instance-bound actor — never read from conversation or tool arguments. */
  instanceActor: ActorContext;
};

function truthy(v: string | undefined): boolean {
  return v === "1" || v?.toLowerCase() === "true" || v?.toLowerCase() === "yes";
}

export const ALLOWED_ACTOR_ROLES: ActorRole[] = [
  "technical_owner",
  "business_partner",
  "ai_service",
  "system_maintenance",
  "unknown",
];

/**
 * Fail-closed identity mode parse.
 * Accepts only the exact strings "production" and "development".
 * Missing, empty, or unrecognized values are errors — never defaulted.
 */
export function parseIdentityMode(raw: string | undefined): {
  mode: IdentityMode | null;
  error: string | null;
} {
  if (raw === undefined) {
    return {
      mode: null,
      error:
        'WAM_AI_IDENTITY_MODE is required and must be exactly "production" or "development"',
    };
  }
  // Do not trim-away meaning of whitespace-only: empty after trim is invalid
  if (raw.trim() === "") {
    return {
      mode: null,
      error:
        'WAM_AI_IDENTITY_MODE is required and must be exactly "production" or "development"',
    };
  }
  const v = raw.trim();
  if (v === "production" || v === "development") {
    return { mode: v, error: null };
  }
  return {
    mode: null,
    error: `WAM_AI_IDENTITY_MODE unrecognized value "${v}"; must be exactly "production" or "development"`,
  };
}

export function parseDbUser(databaseUrl: string): string | null {
  try {
    const u = new URL(databaseUrl.replace(/^postgresql:/i, "http:"));
    return u.username ? decodeURIComponent(u.username) : null;
  } catch {
    return null;
  }
}

/** Hostname from a postgres URL; never logs credentials. */
export function parseDbHost(databaseUrl: string): string | null {
  try {
    const u = new URL(databaseUrl.replace(/^postgresql:/i, "http:"));
    const host = u.hostname?.trim();
    if (!host) return null;
    // Strip IPv6 brackets if present
    return host.replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
}

export function isAllowedDevelopmentDbHost(host: string | null): boolean {
  if (!host) return false;
  return LOCAL_DB_HOSTS.has(host.toLowerCase());
}

function unverifiedStubActor(sessionOrChannelId: string | null): ActorContext {
  return {
    actorId: "unverified:config_error",
    actorRole: "unknown",
    sessionOrChannelId,
    identityVerified: false,
    instanceId: null,
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const { mode: identityMode, error: identityModeError } = parseIdentityMode(
    env.WAM_AI_IDENTITY_MODE,
  );
  const instanceIdRaw = env.WAM_AI_INSTANCE_ID?.trim() || null;
  const actorIdRaw = env.WAM_AI_INSTANCE_ACTOR_ID?.trim() || "";
  const roleRaw = env.WAM_AI_INSTANCE_ACTOR_ROLE?.trim() || "unknown";
  const role = (ALLOWED_ACTOR_ROLES.includes(roleRaw as ActorRole)
    ? roleRaw
    : "unknown") as ActorRole;

  const sessionOrChannelId = env.WAM_AI_SESSION_ID?.trim() || null;

  let instanceActor: ActorContext;
  if (identityMode === null) {
    instanceActor = unverifiedStubActor(sessionOrChannelId);
  } else if (identityMode === "production") {
    instanceActor = {
      actorId: actorIdRaw || "missing",
      actorRole: role,
      sessionOrChannelId,
      identityVerified: true,
      instanceId: instanceIdRaw,
    };
  } else {
    // Development: explicitly unverified. Never elevate via conversation.
    const safeRole: ActorRole =
      role === "technical_owner" || role === "business_partner" ? role : "unknown";
    const baseId = actorIdRaw || "unverified_local";
    instanceActor = {
      actorId: `unverified:${baseId}`,
      actorRole: safeRole,
      sessionOrChannelId,
      identityVerified: false,
      instanceId: instanceIdRaw ? `unverified:${instanceIdRaw}` : null,
    };
  }

  return {
    identityMode,
    identityModeError,
    instanceId: instanceActor.instanceId,
    killSwitch: truthy(env.WAM_AI_KILL_SWITCH),
    queryTimeoutMs: Math.min(
      Math.max(Number(env.WAM_AI_QUERY_TIMEOUT_MS) || 15000, 1000),
      60000,
    ),
    maxResponseChars: Math.min(
      Math.max(Number(env.WAM_AI_MAX_RESPONSE_CHARS) || 120000, 1000),
      500000,
    ),
    rateLimitPerMinute: Math.min(
      Math.max(Number(env.WAM_AI_RATE_LIMIT_PER_MINUTE) || 30, 1),
      600,
    ),
    databaseUrl: env.WAM_AI_DATABASE_URL?.trim() || null,
    requiredDbUser: env.WAM_AI_REQUIRED_DB_USER?.trim() || "wam_ai_business_readonly",
    instanceActor,
  };
}

/** Startup validation — never prints secret values. */
export function validateConfigForStart(cfg: AppConfig): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (cfg.identityModeError || cfg.identityMode === null) {
    errors.push(
      cfg.identityModeError ||
        'WAM_AI_IDENTITY_MODE is required and must be exactly "production" or "development"',
    );
  }

  if (!cfg.databaseUrl) {
    errors.push("WAM_AI_DATABASE_URL is required");
  } else if (/service_role|SERVICE_ROLE/i.test(cfg.databaseUrl)) {
    errors.push("WAM_AI_DATABASE_URL must not use application service-role credentials");
  } else {
    const user = parseDbUser(cfg.databaseUrl);
    if (!user) {
      errors.push("WAM_AI_DATABASE_URL must include a database username");
    } else if (user !== cfg.requiredDbUser) {
      errors.push(
        `WAM_AI_DATABASE_URL username must be exactly ${cfg.requiredDbUser}`,
      );
    }
    if (/postgres|supabase_admin|authenticator/i.test(user || "")) {
      errors.push("WAM_AI_DATABASE_URL must not use a privileged database user");
    }

    const host = parseDbHost(cfg.databaseUrl);
    if (cfg.identityMode === "development") {
      if (!isAllowedDevelopmentDbHost(host)) {
        errors.push(
          "development identity mode only allows database hosts localhost, 127.0.0.1, or ::1 (live/remote databases are forbidden)",
        );
      }
    }
  }

  if (cfg.identityMode === "production") {
    if (!cfg.instanceId || !cfg.instanceId.trim()) {
      errors.push("WAM_AI_INSTANCE_ID is required in production identity mode");
    }
    const actorId = cfg.instanceActor.actorId;
    if (!actorId || actorId === "missing" || actorId.startsWith("unverified:")) {
      errors.push("WAM_AI_INSTANCE_ACTOR_ID is required in production identity mode");
    }
    if (!PRODUCTION_GATEWAY_ROLES.includes(cfg.instanceActor.actorRole)) {
      errors.push(
        "WAM_AI_INSTANCE_ACTOR_ROLE must be technical_owner or business_partner in production",
      );
    }
    if (!cfg.instanceActor.identityVerified) {
      errors.push("production identity must be identityVerified=true");
    }
  } else if (cfg.identityMode === "development" && cfg.instanceActor.identityVerified) {
    errors.push("development identity must remain identityVerified=false");
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Resolve the instance-bound actor from config only.
 * Never accept actor/role/identity from tool args, conversation, or model meta.
 */
export function resolveActorFromConfig(cfg: AppConfig): ActorContext {
  return { ...cfg.instanceActor };
}
