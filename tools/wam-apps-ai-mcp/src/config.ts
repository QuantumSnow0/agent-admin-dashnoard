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

/** Phase 1A.1 open-book reporting — instance-bound roles only. */
export const OPENBOOK_ALLOWED_ROLES: ReadonlyArray<ActorRole> = [
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
  /** Separate action credential — never falls back to read-only URL. */
  actionDatabaseUrl: string | null;
  requiredActionDbUser: string;
  /** Fail-closed: action tools unavailable unless explicitly enabled. */
  actionsEnabled: boolean;
  /** Category kill switches — default enabled when global actions are on. */
  agentActionsEnabled: boolean;
  registrationActionsEnabled: boolean;
  leadActionsEnabled: boolean;
  financialActionsEnabled: boolean;
  /** Fail-closed: notification write actions disabled unless explicitly enabled. */
  notificationActionsEnabled: boolean;
  /** Phase 1A.5 category kill switches — default off. */
  leadPipelineActionsEnabled: boolean;
  dispatchOpsActionsEnabled: boolean;
  agentConfigActionsEnabled: boolean;
  registrationReopenActionsEnabled: boolean;
  /** Broadcast/multi-recipient messaging — not implemented in Phase 1A.4; remains off. */
  broadcastActionsEnabled: boolean;
  /** Phase 1A.6 SMS — default off. */
  smsActionsEnabled: boolean;
  smsBroadcastActionsEnabled: boolean;
  /** Prefer dry-run unless explicitly disabled (still requires credentials present for non-mock). */
  smsDryRun: boolean;
  smsRateLimitPerActorPerMinute: number;
  smsRateLimitPerRecipientPerMinute: number;
  /** Colon/semicolon-separated absolute inbound media roots (Phase 1A.8). */
  attachmentRoots: string | null;
  instanceActor: ActorContext;
};

function truthy(v: string | undefined): boolean {
  return v === "1" || v?.toLowerCase() === "true" || v?.toLowerCase() === "yes";
}

function optionalTruthy(v: string | undefined, defaultWhenUnset: boolean): boolean {
  if (v === undefined) return defaultWhenUnset;
  return truthy(v);
}

export function isActionCategoryEnabled(
  cfg: AppConfig,
  category:
    | "dispatch"
    | "agents"
    | "registrations"
    | "leads"
    | "financial"
    | "notifications"
    | "lead_pipeline"
    | "dispatch_ops"
    | "agent_config"
    | "registration_reopen",
): boolean {
  if (!cfg.actionsEnabled) return false;
  const defaultOn = true;
  switch (category) {
    case "dispatch":
      return optionalTruthy(undefined, defaultOn);
    case "agents":
      return cfg.agentActionsEnabled;
    case "registrations":
      return cfg.registrationActionsEnabled;
    case "leads":
      return cfg.leadActionsEnabled;
    case "financial":
      return cfg.financialActionsEnabled;
    case "notifications":
      return cfg.notificationActionsEnabled;
    case "lead_pipeline":
      return cfg.leadPipelineActionsEnabled;
    case "dispatch_ops":
      return cfg.dispatchOpsActionsEnabled;
    case "agent_config":
      return cfg.agentConfigActionsEnabled;
    case "registration_reopen":
      return cfg.registrationReopenActionsEnabled;
    default:
      return false;
  }
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

/** True if URL attempts non-verified / disabled TLS (forbidden in production). */
export function urlDisablesTls(databaseUrl: string): boolean {
  try {
    const u = new URL(databaseUrl.replace(/^postgresql:/i, "http:"));
    const sslmode = (u.searchParams.get("sslmode") || "").toLowerCase();
    const ssl = (u.searchParams.get("ssl") || "").toLowerCase();
    if (ssl === "false" || ssl === "0") return true;
    if (sslmode === "disable" || sslmode === "allow" || sslmode === "prefer") return true;
    return false;
  } catch {
    return /sslmode=(disable|allow|prefer)|[?&]ssl=(false|0)/i.test(databaseUrl);
  }
}

/** Env vars that attempt to disable TLS verification (never allowed in production). */
export function envDisablesTls(env: NodeJS.ProcessEnv): boolean {
  const ssl = (env.WAM_AI_DB_SSL || "").trim().toLowerCase();
  const insecure = (env.WAM_AI_ALLOW_INSECURE_TLS || "").trim().toLowerCase();
  if (ssl === "0" || ssl === "false" || ssl === "disable" || ssl === "off") return true;
  if (insecure === "1" || insecure === "true" || insecure === "yes") return true;
  return false;
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
  /** Separate action credential — never falls back to read-only URL. */
  actionDatabaseUrl: env.WAM_AI_ACTION_DATABASE_URL?.trim() || null,
  requiredActionDbUser:
    env.WAM_AI_REQUIRED_ACTION_DB_USER?.trim() || "wam_ai_business_actions",
  /** Fail-closed: action tools unavailable unless explicitly enabled. */
  actionsEnabled: truthy(env.WAM_AI_ACTIONS_ENABLED),
  agentActionsEnabled: optionalTruthy(env.WAM_AI_AGENT_ACTIONS_ENABLED, true),
  registrationActionsEnabled: optionalTruthy(env.WAM_AI_REGISTRATION_ACTIONS_ENABLED, true),
  leadActionsEnabled: optionalTruthy(env.WAM_AI_LEAD_ACTIONS_ENABLED, true),
  financialActionsEnabled: optionalTruthy(env.WAM_AI_FINANCIAL_ACTIONS_ENABLED, false),
  notificationActionsEnabled: optionalTruthy(env.WAM_AI_NOTIFICATION_ACTIONS_ENABLED, false),
  leadPipelineActionsEnabled: optionalTruthy(env.WAM_AI_LEAD_PIPELINE_ACTIONS_ENABLED, false),
  dispatchOpsActionsEnabled: optionalTruthy(env.WAM_AI_DISPATCH_OPS_ACTIONS_ENABLED, false),
  agentConfigActionsEnabled: optionalTruthy(env.WAM_AI_AGENT_CONFIG_ACTIONS_ENABLED, false),
  registrationReopenActionsEnabled: optionalTruthy(env.WAM_AI_REGISTRATION_REOPEN_ACTIONS_ENABLED, false),
  broadcastActionsEnabled: optionalTruthy(env.WAM_AI_BROADCAST_ACTIONS_ENABLED, false),
  smsActionsEnabled: optionalTruthy(env.WAM_AI_SMS_ACTIONS_ENABLED, false),
  smsBroadcastActionsEnabled: optionalTruthy(env.WAM_AI_SMS_BROADCAST_ACTIONS_ENABLED, false),
  smsDryRun: optionalTruthy(env.WAM_AI_SMS_DRY_RUN, true),
  smsRateLimitPerActorPerMinute: Math.min(
    Math.max(Number(env.WAM_AI_SMS_RATE_LIMIT_PER_ACTOR_PER_MINUTE) || 5, 1),
    60,
  ),
  smsRateLimitPerRecipientPerMinute: Math.min(
    Math.max(Number(env.WAM_AI_SMS_RATE_LIMIT_PER_RECIPIENT_PER_MINUTE) || 3, 1),
    30,
  ),
  attachmentRoots: env.WAM_AI_ATTACHMENT_ROOTS?.trim() || null,
  instanceActor,
  };
}

/** Startup validation — never prints secret values. */
export function validateConfigForStart(
  cfg: AppConfig,
  env: NodeJS.ProcessEnv = process.env,
): {
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
    if (/^(postgres|supabase_admin|authenticator)$/i.test(user || "")) {
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

    if (cfg.identityMode === "production") {
      if (urlDisablesTls(cfg.databaseUrl)) {
        errors.push(
          "production identity mode requires TLS; sslmode=disable / ssl=false in WAM_AI_DATABASE_URL is forbidden",
        );
      }
    }
  }

  // Env overrides that would weaken TLS — forbidden in all modes for production; for development unused
  if (envDisablesTls(env)) {
    if (cfg.identityMode === "production") {
      errors.push(
        "production identity mode forbids insecure TLS overrides (WAM_AI_DB_SSL / WAM_AI_ALLOW_INSECURE_TLS)",
      );
    } else if (cfg.identityMode === "development") {
      // Development uses non-TLS to localhost by design; ignore override flags but do not honor remote TLS bypass.
      // Still reject if someone tries to use override to imply remote insecure access — host check already covers remote.
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

/** Action tools — optional at startup; read-only MCP still starts when invalid. */
export function validateActionConfig(
  cfg: AppConfig,
  env: NodeJS.ProcessEnv = process.env,
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!cfg.actionsEnabled) {
    return { ok: false, errors: ["WAM_AI_ACTIONS_ENABLED is not enabled"] };
  }
  if (!cfg.actionDatabaseUrl) {
    errors.push("WAM_AI_ACTION_DATABASE_URL is required when actions are enabled");
    return { ok: false, errors };
  }
  if (/service_role|SERVICE_ROLE/i.test(cfg.actionDatabaseUrl)) {
    errors.push("WAM_AI_ACTION_DATABASE_URL must not use application service-role credentials");
  }
  const user = parseDbUser(cfg.actionDatabaseUrl);
  if (!user) {
    errors.push("WAM_AI_ACTION_DATABASE_URL must include a database username");
  } else if (user !== cfg.requiredActionDbUser) {
    errors.push(
      `WAM_AI_ACTION_DATABASE_URL username must be exactly ${cfg.requiredActionDbUser}`,
    );
  }
  if (/^(postgres|supabase_admin|authenticator)$/i.test(user || "")) {
    errors.push("WAM_AI_ACTION_DATABASE_URL must not use a privileged database user");
  }
  if (cfg.actionDatabaseUrl === cfg.databaseUrl) {
    errors.push("WAM_AI_ACTION_DATABASE_URL must differ from WAM_AI_DATABASE_URL");
  }
  const host = parseDbHost(cfg.actionDatabaseUrl);
  if (cfg.identityMode === "development") {
    if (!isAllowedDevelopmentDbHost(host)) {
      errors.push(
        "development identity mode only allows action database hosts localhost, 127.0.0.1, or ::1",
      );
    }
  }
  if (cfg.identityMode === "production") {
    if (urlDisablesTls(cfg.actionDatabaseUrl)) {
      errors.push(
        "production identity mode requires TLS on WAM_AI_ACTION_DATABASE_URL",
      );
    }
    if (envDisablesTls(env)) {
      errors.push(
        "production identity mode forbids insecure TLS overrides for action connection",
      );
    }
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
