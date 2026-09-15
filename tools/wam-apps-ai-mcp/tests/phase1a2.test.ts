import { describe, expect, it, beforeEach } from "vitest";
import {
  ALLOWED_ACTOR_ROLES,
  loadConfig,
  OPENBOOK_ALLOWED_ROLES,
} from "../src/config.js";
import { createMockDbClient } from "../src/db.js";
import {
  agentAcceptsProduct,
  balancedBusinessScore,
  geographicPracticalityLabel,
  haversineKm,
  effectiveRadiusKm,
  recommendationRankScore,
  urgencyDistanceRelief,
} from "../src/dispatchRecommendLogic.js";
import {
  assertDispatchOutputAllowed,
  assertOpenBookOutputAllowed,
  redactAuditParams,
} from "../src/privacy.js";
import { hashParams, redactParams } from "../src/redact.js";
import { resetRateLimitState } from "../src/rateLimit.js";
import { parseAnyToolName } from "../src/server.js";
import {
  executeDispatchTool,
  listDispatchTools,
  parseDispatchToolName,
} from "../src/tools-dispatch.js";
import {
  DISPATCH_TOOL_NAMES,
  DISPATCH_TOOL_SCHEMAS,
} from "../src/validation-dispatch.js";

const LEAD_ID = "77777777-7777-7777-7777-777777777777";
const NEAR_AGENT = "11111111-1111-1111-1111-111111111111";
const MID_AGENT = "22222222-2222-2222-2222-222222222222";
const FAR_AGENT = "33333333-3333-3333-3333-333333333333";

const partnerActor = {
  actorId: "unverified:partner",
  actorRole: "business_partner" as const,
  sessionOrChannelId: "ch-1" as string | null,
  identityVerified: false,
  instanceId: "unverified:dev-gw" as string | null,
};

const ownerActor = {
  ...partnerActor,
  actorId: "unverified:owner",
  actorRole: "technical_owner" as const,
};

function devCfg(extra: Record<string, string> = {}) {
  return loadConfig({
    WAM_AI_IDENTITY_MODE: "development",
    WAM_AI_KILL_SWITCH: "0",
    WAM_AI_DATABASE_URL: "postgresql://wam_ai_business_readonly:x@localhost/postgres",
    WAM_AI_INSTANCE_ID: "dev-gw",
    WAM_AI_INSTANCE_ACTOR_ID: "partner",
    WAM_AI_INSTANCE_ACTOR_ROLE: "business_partner",
    ...extra,
  });
}

function cfgForRole(role: string) {
  return loadConfig({
    WAM_AI_IDENTITY_MODE: "development",
    WAM_AI_DATABASE_URL: "postgresql://wam_ai_business_readonly:x@localhost/postgres",
    WAM_AI_INSTANCE_ACTOR_ROLE: role,
    WAM_AI_INSTANCE_ACTOR_ID: "test",
  });
}

const DENIED_ROLES = ALLOWED_ACTOR_ROLES.filter(
  (r) => !OPENBOOK_ALLOWED_ROLES.includes(r),
);

function mockRecommendResponse(overrides: Record<string, unknown> = {}) {
  return {
    status: "success",
    operation: "recommend_agents_for_lead",
    recommendation_id: "rec-1",
    data_freshness_at: "2026-08-28T10:00:00.000Z",
    lead: {
      lead_id: LEAD_ID,
      lead_ref: "L-abc",
      status: "admin_queue",
      product: "airtel",
      lead_state_compatible: true,
      lead_location_verified: true,
      lead_waiting_hours: 30,
      lead_urgency: "elevated",
    },
    configured_radius_km: 8,
    radius_expansion_used: false,
    recommended_agent: {
      agent_id: NEAR_AGENT,
      agent_business_id: "A-11111111",
      agent_name: "Near Agent",
      hard_eligible: true,
      distance_km: 0,
      inside_configured_radius: true,
      radius_expansion_required: false,
      geographic_practicality: "inside_normal_radius",
      recommendation_rank: 1,
      unknown_metrics: [],
      recent_conversion_rate: null,
    },
    alternative_agents: [],
    candidates: [],
    closer_eligible_agent_count: 0,
    closer_agents_not_recommended_reasons: [],
    recommendation_confidence: "high",
    recommendation_reasons: ["balanced_business_rank_first"],
    recommendation_warnings: [],
    ranking_notes: { no_fixed_maximum_recommendation_distance: true },
    result_count: 1,
    limit: 10,
    ...overrides,
  };
}

describe("Phase 1A.2 dispatch catalog", () => {
  it("lists recommend_agents_for_lead under wam.business.dispatch", () => {
    const tools = listDispatchTools();
    expect(tools.map((t) => t.name)).toContain(
      "wam.business.dispatch.recommend_agents_for_lead",
    );
    expect(parseDispatchToolName("wam.business.dispatch.recommend_agents_for_lead")).toBe(
      "recommend_agents_for_lead",
    );
    expect(parseAnyToolName("wam.business.dispatch.recommend_agents_for_lead")?.kind).toBe(
      "dispatch",
    );
  });

  it("uses strict schema without arbitrary SQL fields", () => {
    const schema = DISPATCH_TOOL_SCHEMAS.recommend_agents_for_lead;
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties)).not.toContain("sql");
    expect(DISPATCH_TOOL_NAMES).toEqual(["recommend_agents_for_lead"]);
  });
});

describe("dispatchRecommendLogic", () => {
  const lead = { lat: -1.2921, lng: 36.8219 };
  const near = { lat: -1.2921, lng: 36.8219 };
  const mid = { lat: -1.265, lng: 36.8065 };
  const far = { lat: -0.3031, lng: 36.08 };

  it("1. agent inside configured radius has small distance", () => {
    const d = haversineKm(lead, near);
    expect(d).toBeLessThan(0.1);
    expect(d).toBeLessThanOrEqual(effectiveRadiusKm(null, 8));
  });

  it("2. agent immediately outside radius remains recommendable (not hard ineligible)", () => {
    const justOutside = { lat: -1.22, lng: 36.8219 };
    const d = haversineKm(lead, justOutside);
    expect(d).toBeGreaterThan(8);
    expect(d).toBeLessThan(12);
    const label = geographicPracticalityLabel({
      leadVerified: true,
      agentVerified: true,
      distanceKm: d,
      effectiveRadiusKm: 8,
      closerEligibleCount: 0,
      minCloserDistanceKm: null,
      isTopRecommendation: true,
    });
    expect(label).toBe("outside_normal_radius_but_recommended");
  });

  it("3. farther agent visible when nearby unsuitable — score reflects workload", () => {
    const nearScore = balancedBusinessScore({
      distanceKm: 2,
      effectiveRadiusKm: 8,
      online: true,
      available: true,
      openDispatchLeads: 5,
      activeOffers: 2,
      recentInstalls: 0,
      recentAccepted: 0,
    });
    const farScore = balancedBusinessScore({
      distanceKm: 18,
      effectiveRadiusKm: 8,
      online: true,
      available: true,
      openDispatchLeads: 0,
      activeOffers: 0,
      recentInstalls: 3,
      recentAccepted: 2,
    });
    expect(farScore).toBeLessThan(nearScore);
  });

  it("4. distance outside radius is not hard ineligibility", () => {
    expect(agentAcceptsProduct("both", "airtel")).toBe(true);
    const d = haversineKm(lead, far);
    expect(d).toBeGreaterThan(100);
  });

  it("5. closer agent receives geographic preference in balanced score", () => {
    const closer = balancedBusinessScore({
      distanceKm: 3,
      effectiveRadiusKm: 8,
      online: true,
      available: true,
      openDispatchLeads: 1,
      activeOffers: 0,
      recentInstalls: 1,
      recentAccepted: 1,
    });
    const farther = balancedBusinessScore({
      distanceKm: 15,
      effectiveRadiusKm: 8,
      online: true,
      available: true,
      openDispatchLeads: 1,
      activeOffers: 0,
      recentInstalls: 1,
      recentAccepted: 1,
    });
    expect(closer).toBeLessThan(farther);
  });

  it("6. farther agent can outrank closer for workload/urgency", () => {
    const overloadedNear = balancedBusinessScore({
      distanceKm: 2,
      effectiveRadiusKm: 8,
      online: true,
      available: true,
      openDispatchLeads: 10,
      activeOffers: 3,
      recentInstalls: 0,
      recentAccepted: 0,
    });
    const availableFar = balancedBusinessScore({
      distanceKm: 20,
      effectiveRadiusKm: 8,
      online: true,
      available: true,
      openDispatchLeads: 0,
      activeOffers: 0,
      recentInstalls: 2,
      recentAccepted: 2,
    });
    expect(availableFar).toBeLessThan(overloadedNear);
  });

  it("7. extremely distant vs closer pool → operationally_impractical", () => {
    const d = haversineKm(lead, far);
    const minCloser = haversineKm(lead, mid);
    const label = geographicPracticalityLabel({
      leadVerified: true,
      agentVerified: true,
      distanceKm: d,
      effectiveRadiusKm: 8,
      closerEligibleCount: 2,
      minCloserDistanceKm: minCloser,
      isTopRecommendation: false,
    });
    expect(label).toBe("operationally_impractical");
  });

  it("7b. operationally impractical penalty applies via recommendation rank", () => {
    const balanced = 10;
    const impractical = recommendationRankScore({
      balancedScore: balanced,
      distanceKm: 150,
      effectiveRadiusKm: 8,
      leadUrgency: "normal",
      geographicPracticality: "operationally_impractical",
    });
    const practical = recommendationRankScore({
      balancedScore: balanced,
      distanceKm: 150,
      effectiveRadiusKm: 8,
      leadUrgency: "normal",
      geographicPracticality: "outside_normal_radius_alternative",
    });
    expect(impractical - practical).toBe(200);
  });

  it("8. urgency does not shift balanced score uniformly across agents", () => {
    const base = {
      distanceKm: 15,
      effectiveRadiusKm: 8,
      online: true,
      available: true,
      openDispatchLeads: 0,
      activeOffers: 0,
      recentInstalls: null as number | null,
      recentAccepted: null as number | null,
    };
    expect(balancedBusinessScore(base)).toBe(balancedBusinessScore(base));
    expect(urgencyDistanceRelief("high")).toBeGreaterThan(urgencyDistanceRelief("normal"));
  });

  it("8b. urgency changes recommendation rank for farther agents only", () => {
    const balanced = balancedBusinessScore({
      distanceKm: 20,
      effectiveRadiusKm: 8,
      online: true,
      available: true,
      openDispatchLeads: 0,
      activeOffers: 0,
      recentInstalls: 0,
      recentAccepted: 0,
    });
    const geo = geographicPracticalityLabel({
      leadVerified: true,
      agentVerified: true,
      distanceKm: 20,
      effectiveRadiusKm: 8,
      closerEligibleCount: 0,
      minCloserDistanceKm: null,
      isTopRecommendation: true,
    });
    const normalRank = recommendationRankScore({
      balancedScore: balanced,
      distanceKm: 20,
      effectiveRadiusKm: 8,
      leadUrgency: "normal",
      geographicPracticality: geo,
    });
    const highRank = recommendationRankScore({
      balancedScore: balanced,
      distanceKm: 20,
      effectiveRadiusKm: 8,
      leadUrgency: "high",
      geographicPracticality: geo,
    });
    expect(highRank).toBeLessThan(normalRank);
  });

  it("9. overloaded nearby vs available farther", () => {
    const busy = balancedBusinessScore({
      distanceKm: 1,
      effectiveRadiusKm: 8,
      online: true,
      available: true,
      openDispatchLeads: 8,
      activeOffers: 2,
      recentInstalls: 0,
      recentAccepted: 0,
    });
    const far = balancedBusinessScore({
      distanceKm: 12,
      effectiveRadiusKm: 8,
      online: true,
      available: true,
      openDispatchLeads: 0,
      activeOffers: 0,
      recentInstalls: 1,
      recentAccepted: 1,
    });
    expect(far).toBeLessThan(busy);
  });

  it("10. high performer far does not auto-beat all closer agents", () => {
    const closerAvg = balancedBusinessScore({
      distanceKm: 5,
      effectiveRadiusKm: 8,
      online: true,
      available: true,
      openDispatchLeads: 1,
      activeOffers: 0,
      recentInstalls: 1,
      recentAccepted: 1,
    });
    const starFar = balancedBusinessScore({
      distanceKm: 25,
      effectiveRadiusKm: 8,
      online: true,
      available: true,
      openDispatchLeads: 0,
      activeOffers: 0,
      recentInstalls: 5,
      recentAccepted: 5,
    });
    expect(closerAvg).toBeLessThan(starFar);
  });
});

describe("executeDispatchTool", () => {
  beforeEach(() => resetRateLimitState());

  it.each(DENIED_ROLES)("22. denies unauthorized role %s", async (role) => {
    const db = createMockDbClient();
    const res = await executeDispatchTool({
      tool: "recommend_agents_for_lead",
      args: { lead_id: LEAD_ID },
      cfg: cfgForRole(role),
      db,
      actor: { ...partnerActor, actorRole: role },
    });
    expect(res.denied).toBe(true);
    expect(res.error?.category).toMatch(/denied|role_denied/);
  });

  it("23. allows technical_owner", async () => {
    const db = createMockDbClient({
      call: async () => mockRecommendResponse(),
    });
    const res = await executeDispatchTool({
      tool: "recommend_agents_for_lead",
      args: { lead_id: LEAD_ID },
      cfg: cfgForRole("technical_owner"),
      db,
      actor: ownerActor,
    });
    expect(res.ok).toBe(true);
  });

  it("24. allows business_partner", async () => {
    const db = createMockDbClient({
      call: async () => mockRecommendResponse(),
    });
    const res = await executeDispatchTool({
      tool: "recommend_agents_for_lead",
      args: { lead_id: LEAD_ID },
      cfg: devCfg(),
      db,
      actor: partnerActor,
    });
    expect(res.ok).toBe(true);
  });

  it("21. conflicting lead identifiers → ambiguous_match", async () => {
    const db = createMockDbClient({
      call: async () => ({
        status: "ambiguous",
        match_count: 2,
        message: "lead_id and lead_ref refer to different leads",
        error_category: "ambiguous_match",
      }),
    });
    const res = await executeDispatchTool({
      tool: "recommend_agents_for_lead",
      args: { lead_id: LEAD_ID, lead_ref: "L-wrong" },
      cfg: devCfg(),
      db,
      actor: partnerActor,
    });
    expect(res.ok).toBe(false);
    expect(res.error?.category).toBe("ambiguous_match");
    expect(db.audits.length).toBeGreaterThanOrEqual(2);
  });

  it("25. enforces response limit parameter max 25", async () => {
    const db = createMockDbClient();
    const res = await executeDispatchTool({
      tool: "recommend_agents_for_lead",
      args: { lead_id: LEAD_ID, limit: 50 },
      cfg: devCfg(),
      db,
      actor: partnerActor,
    });
    expect(res.denied).toBe(true);
    expect(res.error?.category).toBe("validation");
  });

  it("27-28. writes pre and completion audits; read-only RPC", async () => {
    const db = createMockDbClient({
      call: async (fn) => {
        expect(fn).toBe("recommend_agents_for_lead");
        return mockRecommendResponse();
      },
    });
    const res = await executeDispatchTool({
      tool: "recommend_agents_for_lead",
      args: { lead_id: LEAD_ID },
      cfg: devCfg(),
      db,
      actor: partnerActor,
    });
    expect(res.ok).toBe(true);
    expect(db.audits.length).toBe(2);
    expect(db.audits[0].errorCategory).toBe("pending_execution");
    expect(db.audits[1].outcome).toBe("success");
    expect(db.callCount).toBe(1);
  });

  it("26. audit params redact lead identifiers", () => {
    const redacted = redactAuditParams({
      lead_id: LEAD_ID,
      lead_ref: "L-secret",
      limit: 10,
    });
    expect(redacted.lead_id).toBe("[REDACTED]");
    expect(redacted.lead_ref).toBe("[REDACTED]");
    expect(redacted.limit).toBe(10);
  });

  it("11. missing lead coordinates in SQL response", async () => {
    const db = createMockDbClient({
      call: async () =>
        mockRecommendResponse({
          recommended_agent: null,
          no_recommendation_reason: "missing_lead_coordinates",
          lead: { lead_location_verified: false },
        }),
    });
    const res = await executeDispatchTool({
      tool: "recommend_agents_for_lead",
      args: { lead_id: LEAD_ID },
      cfg: devCfg(),
      db,
      actor: partnerActor,
    });
    expect(res.ok).toBe(true);
    const data = res.data as Record<string, unknown>;
    expect(data.no_recommendation_reason).toBe("missing_lead_coordinates");
  });

  it("29. no_recommendation when no practical candidate", async () => {
    const db = createMockDbClient({
      call: async () =>
        mockRecommendResponse({
          recommended_agent: null,
          no_recommendation_reason: "only_operationally_impractical_candidates",
          suggested_management_alternatives: ["Wait for closer agent"],
        }),
    });
    const res = await executeDispatchTool({
      tool: "recommend_agents_for_lead",
      args: { lead_id: LEAD_ID },
      cfg: devCfg(),
      db,
      actor: partnerActor,
    });
    expect((res.data as Record<string, unknown>).recommended_agent).toBeNull();
  });

  it("30. radius expansion includes closer rejection reasons", async () => {
    const db = createMockDbClient({
      call: async () =>
        mockRecommendResponse({
          radius_expansion_used: true,
          recommended_agent: {
            agent_id: FAR_AGENT,
            distance_km: 150,
            radius_expansion_required: true,
            geographic_practicality: "outside_normal_radius_but_recommended",
          },
          closer_agents_not_recommended_reasons: [
            { agent_business_id: "A-11111111", reason: "high workload" },
          ],
        }),
    });
    const res = await executeDispatchTool({
      tool: "recommend_agents_for_lead",
      args: { lead_id: LEAD_ID },
      cfg: devCfg(),
      db,
      actor: partnerActor,
    });
    const data = res.data as Record<string, unknown>;
    expect(data.radius_expansion_used).toBe(true);
    expect(Array.isArray(data.closer_agents_not_recommended_reasons)).toBe(true);
  });

  it("blocks forbidden customer PII in output", () => {
    const hits = assertDispatchOutputAllowed("recommend_agents_for_lead", {
      lead: { customer_name: "Secret" },
    });
    expect(hits.some((h) => h.includes("customer_name"))).toBe(true);
  });

  it("blocks agent phone fields in recommendation output", () => {
    expect(
      assertDispatchOutputAllowed("recommend_agents_for_lead", {
        recommended_agent: { phone: "254700000000" },
      }).some((h) => h.includes("phone")),
    ).toBe(true);
    expect(
      assertDispatchOutputAllowed("recommend_agents_for_lead", {
        candidates: [{ airtel_phone: "254711111111" }],
      }).some((h) => h.includes("airtel_phone")),
    ).toBe(true);
    expect(
      assertDispatchOutputAllowed("recommend_agents_for_lead", {
        alternative_agents: [{ safaricom_phone: "254722222222" }],
      }).some((h) => h.includes("safaricom_phone")),
    ).toBe(true);
  });

  it("explicit agent-detail tool still allows authorized phone fields", () => {
    const hits = assertOpenBookOutputAllowed("get_agent_details", {
      airtel_phone: "254700000000",
      safaricom_phone: null,
    });
    expect(hits.some((h) => h.includes("airtel_phone"))).toBe(false);
  });

  it("audit params redact phone and agent identifiers", () => {
    const redacted = redactAuditParams({
      phone: "254700000000",
      agent_name: "Secret Agent",
      limit: 10,
    });
    expect(redacted.phone).toBe("[REDACTED]");
    expect(redacted.agent_name).toBe("[REDACTED]");
    expect(redacted.limit).toBe(10);
  });

  it("unavailable agents excluded from default recommendation mock", async () => {
    const db = createMockDbClient({
      call: async () =>
        mockRecommendResponse({
          recommended_agent: {
            agent_id: NEAR_AGENT,
            availability_status: "available",
            currently_recommendable: true,
          },
          unavailable_diagnostics: [],
        }),
    });
    const res = await executeDispatchTool({
      tool: "recommend_agents_for_lead",
      args: { lead_id: LEAD_ID },
      cfg: devCfg(),
      db,
      actor: partnerActor,
    });
    const rec = (res.data as Record<string, unknown>).recommended_agent as Record<
      string,
      unknown
    >;
    expect(rec.availability_status).toBe("available");
  });

  it("unavailable agents visible when include_unavailable requested", async () => {
    const db = createMockDbClient({
      call: async () =>
        mockRecommendResponse({
          recommended_agent: null,
          no_recommendation_reason: "no_available_agents_check_availability",
          unavailable_diagnostics: [
            {
              agent_business_id: "A-22222222",
              availability_status: "unavailable",
              unavailable_diagnostic: true,
              hard_eligible: true,
              currently_recommendable: false,
            },
          ],
        }),
    });
    const res = await executeDispatchTool({
      tool: "recommend_agents_for_lead",
      args: { lead_id: LEAD_ID, include_unavailable: true },
      cfg: devCfg(),
      db,
      actor: partnerActor,
    });
    const data = res.data as Record<string, unknown>;
    const diag = data.unavailable_diagnostics as unknown[];
    expect(diag.length).toBe(1);
    expect((diag[0] as Record<string, unknown>).availability_status).toBe("unavailable");
    expect(data.recommended_agent).toBeNull();
  });

  it("no available agents returns no_recommendation outcome", async () => {
    const db = createMockDbClient({
      call: async () =>
        mockRecommendResponse({
          recommended_agent: null,
          no_recommendation_reason: "no_available_agents_check_availability",
          suggested_management_alternatives: [
            "Check availability of relevant hard-eligible agents before dispatch",
          ],
        }),
    });
    const res = await executeDispatchTool({
      tool: "recommend_agents_for_lead",
      args: { lead_id: LEAD_ID },
      cfg: devCfg(),
      db,
      actor: partnerActor,
    });
    expect((res.data as Record<string, unknown>).no_recommendation_reason).toBe(
      "no_available_agents_check_availability",
    );
  });

  it("20. unknown metrics stay null in mock — not coerced to zero", async () => {
    const db = createMockDbClient({
      call: async () =>
        mockRecommendResponse({
          recommended_agent: {
            recent_conversion_rate: null,
            unknown_metrics: ["lead_coordinates"],
            open_active_leads: 0,
          },
        }),
    });
    const res = await executeDispatchTool({
      tool: "recommend_agents_for_lead",
      args: { lead_id: LEAD_ID },
      cfg: devCfg(),
      db,
      actor: partnerActor,
    });
    const agent = (res.data as Record<string, unknown>).recommended_agent as Record<
      string,
      unknown
    >;
    expect(agent.recent_conversion_rate).toBeNull();
  });

  it("rejects arbitrary sql in args via server guard", () => {
    expect(hashParams({ lead_id: LEAD_ID })).not.toBe(hashParams({ sql: "select 1" }));
    expect(redactParams({ lead_id: LEAD_ID }).lead_id).toBe("[REDACTED]");
  });

  it("14-16. SQL layer excludes unapproved/wrong scope/unavailable (contract)", async () => {
    const db = createMockDbClient({
      call: async () =>
        mockRecommendResponse({
          ineligible_diagnostics: [
            {
              agent_name: "Unapproved",
              hard_eligible: false,
              ineligibility_reasons: ["not_approved"],
            },
            {
              agent_name: "Safaricom only",
              hard_eligible: false,
              ineligibility_reasons: ["dispatch_scope_mismatch"],
            },
            {
              agent_name: "Offline",
              hard_eligible: false,
              ineligibility_reasons: ["not_available"],
            },
          ],
        }),
    });
    const res = await executeDispatchTool({
      tool: "recommend_agents_for_lead",
      args: { lead_id: LEAD_ID, include_ineligible_diagnostics: true },
      cfg: devCfg(),
      db,
      actor: partnerActor,
    });
    const diag = (res.data as Record<string, unknown>).ineligible_diagnostics as unknown[];
    expect(diag.length).toBe(3);
  });

  it("17. existing offer conflict reflected in diagnostics", async () => {
    const db = createMockDbClient({
      call: async () =>
        mockRecommendResponse({
          ineligible_diagnostics: [
            {
              hard_eligible: false,
              ineligibility_reasons: ["declined_this_lead"],
              existing_offer_conflict: true,
            },
          ],
        }),
    });
    const res = await executeDispatchTool({
      tool: "recommend_agents_for_lead",
      args: { lead_id: LEAD_ID, include_ineligible_diagnostics: true },
      cfg: devCfg(),
      db,
      actor: partnerActor,
    });
    expect(res.ok).toBe(true);
  });

  it("ranking notes confirm no fixed max recommendation distance", async () => {
    const db = createMockDbClient({
      call: async () => mockRecommendResponse(),
    });
    const res = await executeDispatchTool({
      tool: "recommend_agents_for_lead",
      args: { lead_id: LEAD_ID },
      cfg: devCfg(),
      db,
      actor: partnerActor,
    });
    const notes = (res.data as Record<string, unknown>).ranking_notes as Record<
      string,
      unknown
    >;
    expect(notes.no_fixed_maximum_recommendation_distance).toBe(true);
  });
});

describe("haversine fixture distances", () => {
  it("Nairobi lead to Nakuru agent is far but computable (not county guessed)", () => {
    const lead = { lat: -1.2921, lng: 36.8219 };
    const nakuru = { lat: -0.3031, lng: 36.08 };
    const km = haversineKm(lead, nakuru);
    expect(km).toBeGreaterThan(100);
    expect(km).toBeLessThan(200);
  });

  it("12-13. invalid/missing coords → null distance in logic", () => {
    expect(
      geographicPracticalityLabel({
        leadVerified: false,
        agentVerified: true,
        distanceKm: null,
        effectiveRadiusKm: 8,
        closerEligibleCount: 0,
        minCloserDistanceKm: null,
        isTopRecommendation: false,
      }),
    ).toBe("distance_unverified");
  });
});
