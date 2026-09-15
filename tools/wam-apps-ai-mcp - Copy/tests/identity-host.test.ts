import { describe, expect, it } from "vitest";
import {
  isAllowedDevelopmentDbHost,
  loadConfig,
  parseDbHost,
  parseIdentityMode,
  validateConfigForStart,
} from "../src/config.js";

describe("identity mode fail-closed", () => {
  it("rejects missing WAM_AI_IDENTITY_MODE", () => {
    const parsed = parseIdentityMode(undefined);
    expect(parsed.mode).toBeNull();
    expect(parsed.error).toMatch(/required/i);

    const cfg = loadConfig({
      WAM_AI_DATABASE_URL: "postgresql://wam_ai_business_readonly:x@localhost/postgres",
    });
    expect(cfg.identityMode).toBeNull();
    const v = validateConfigForStart(cfg);
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => /WAM_AI_IDENTITY_MODE/.test(e))).toBe(true);
  });

  it("rejects empty WAM_AI_IDENTITY_MODE", () => {
    expect(parseIdentityMode("").mode).toBeNull();
    expect(parseIdentityMode("   ").mode).toBeNull();
    const cfg = loadConfig({
      WAM_AI_IDENTITY_MODE: "   ",
      WAM_AI_DATABASE_URL: "postgresql://wam_ai_business_readonly:x@localhost/postgres",
    });
    expect(validateConfigForStart(cfg).ok).toBe(false);
  });

  it("rejects misspelled production", () => {
    const parsed = parseIdentityMode("Production");
    expect(parsed.mode).toBeNull();
    expect(parsed.error).toMatch(/unrecognized/i);
    expect(parseIdentityMode("prod").mode).toBeNull();
    expect(parseIdentityMode("PRODUCTION").mode).toBeNull();
  });

  it("rejects unsupported values", () => {
    expect(parseIdentityMode("staging").mode).toBeNull();
    expect(parseIdentityMode("dev").mode).toBeNull();
    expect(parseIdentityMode("local").mode).toBeNull();
  });

  it("accepts exact production", () => {
    expect(parseIdentityMode("production")).toEqual({ mode: "production", error: null });
  });

  it("accepts exact development", () => {
    expect(parseIdentityMode("development")).toEqual({ mode: "development", error: null });
  });
});

describe("development mode local database hosts only", () => {
  it("allows localhost and 127.0.0.1", () => {
    expect(isAllowedDevelopmentDbHost("localhost")).toBe(true);
    expect(isAllowedDevelopmentDbHost("127.0.0.1")).toBe(true);
    expect(isAllowedDevelopmentDbHost("::1")).toBe(true);
    expect(parseDbHost("postgresql://wam_ai_business_readonly:x@localhost:5432/postgres")).toBe(
      "localhost",
    );
    expect(parseDbHost("postgresql://wam_ai_business_readonly:x@127.0.0.1/postgres")).toBe(
      "127.0.0.1",
    );

    expect(
      validateConfigForStart(
        loadConfig({
          WAM_AI_IDENTITY_MODE: "development",
          WAM_AI_DATABASE_URL: "postgresql://wam_ai_business_readonly:x@localhost/postgres",
        }),
      ).ok,
    ).toBe(true);

    expect(
      validateConfigForStart(
        loadConfig({
          WAM_AI_IDENTITY_MODE: "development",
          WAM_AI_DATABASE_URL: "postgresql://wam_ai_business_readonly:x@127.0.0.1/postgres",
        }),
      ).ok,
    ).toBe(true);
  });

  it("rejects remote hostname in development", () => {
    const v = validateConfigForStart(
      loadConfig({
        WAM_AI_IDENTITY_MODE: "development",
        WAM_AI_DATABASE_URL: "postgresql://wam_ai_business_readonly:x@db.example.com/postgres",
      }),
    );
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => /localhost|127\.0\.0\.1|forbidden/i.test(e))).toBe(true);
  });

  it("rejects Supabase hostname in development", () => {
    const v = validateConfigForStart(
      loadConfig({
        WAM_AI_IDENTITY_MODE: "development",
        WAM_AI_DATABASE_URL:
          "postgresql://wam_ai_business_readonly:x@db.olaounggwgxpbenmuvnl.supabase.co:5432/postgres",
      }),
    );
    expect(v.ok).toBe(false);
    expect(v.errors.some((e) => /live\/remote|localhost/i.test(e))).toBe(true);
  });

  it("production + restricted identity on remote host succeeds", () => {
    const v = validateConfigForStart(
      loadConfig({
        WAM_AI_IDENTITY_MODE: "production",
        WAM_AI_DATABASE_URL:
          "postgresql://wam_ai_business_readonly:x@db.olaounggwgxpbenmuvnl.supabase.co:5432/postgres",
        WAM_AI_INSTANCE_ID: "gw-owner",
        WAM_AI_INSTANCE_ACTOR_ID: "bonface",
        WAM_AI_INSTANCE_ACTOR_ROLE: "technical_owner",
      }),
    );
    expect(v.ok).toBe(true);
  });
});
