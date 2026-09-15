/**
 * One-shot generator: produce business_partner ops authorization remediation SQL
 * from current function definitions (local packaging only).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const toolsMig = join(
  process.cwd(),
  "tools/wam-apps-ai-mcp/migrations",
);
const supabaseMig = join(process.cwd(), "supabase/migrations");

function extractFunction(sql, name) {
  const marker = `CREATE OR REPLACE FUNCTION wam_ai.${name}(`;
  const start = sql.lastIndexOf(marker);
  if (start < 0) throw new Error(`function not found: ${name}`);
  const after = sql.slice(start);
  const endMatch = after.match(/\$fn\$\s*;/);
  if (!endMatch || endMatch.index == null) {
    throw new Error(`function end not found: ${name}`);
  }
  return after.slice(0, endMatch.index + endMatch[0].length);
}

function patchGatewayRole(fnSql, kind) {
  let out = fnSql;
  if (kind === "agent_config") {
    out = out.replace(
      /IF p_actor_role <> 'technical_owner' THEN\s+RETURN jsonb_build_object\('status', 'error', 'operation', v_operation,\s+'error_category', 'action_not_authorized',\s+'message', 'Infrastructure dispatch configuration requires technical_owner'\);/g,
      `IF p_actor_role NOT IN ('technical_owner', 'business_partner') THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'action_not_authorized',
      'message', 'Dispatch configuration requires technical_owner or business_partner');`,
    );
    out = out.replace(
      /— technical_owner only; fallback pool configuration\./g,
      "— technical_owner or business_partner; fallback pool configuration.",
    );
    out = out.replace(
      /— technical_owner only; service radius configuration\./g,
      "— technical_owner or business_partner; service radius configuration.",
    );
  }
  if (kind === "sms_prepare") {
    out = out.replace(
      /IF p_actor_role IS DISTINCT FROM 'technical_owner' THEN\s+RETURN jsonb_build_object\('status', 'error', 'operation', v_operation,\s+'error_category', 'action_not_authorized',\s+'message', 'SMS send is restricted to technical_owner'\);/g,
      `IF p_actor_role NOT IN ('technical_owner', 'business_partner') THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'action_not_authorized',
      'message', 'SMS send is restricted to technical_owner or business_partner');`,
    );
  }
  if (kind === "sms_finalize") {
    out = out.replace(
      /-- Fail closed before any reservation mutation: only technical_owner may finalize\.\s+IF NULLIF\(btrim\(p_actor_role\), ''\) IS NULL\s+OR p_actor_role IS DISTINCT FROM 'technical_owner' THEN\s+RETURN jsonb_build_object\('status', 'error', 'operation', v_operation,\s+'error_category', 'action_not_authorized',\s+'message', 'SMS finalize is restricted to technical_owner'\);/g,
      `-- Fail closed before any reservation mutation: gateway business roles only.
  IF NULLIF(btrim(p_actor_role), '') IS NULL
     OR p_actor_role NOT IN ('technical_owner', 'business_partner') THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'action_not_authorized',
      'message', 'SMS finalize is restricted to technical_owner or business_partner');`,
    );
    out = out.replace(
      /IF v_intent\.actor_role IS DISTINCT FROM 'technical_owner'\s+OR p_actor_role IS DISTINCT FROM 'technical_owner' THEN\s+RETURN jsonb_build_object\('status', 'error', 'operation', v_operation,\s+'error_category', 'action_not_authorized',\s+'message', 'SMS finalize reservation is restricted to technical_owner'\);/g,
      `IF v_intent.actor_role NOT IN ('technical_owner', 'business_partner')
     OR p_actor_role NOT IN ('technical_owner', 'business_partner') THEN
    RETURN jsonb_build_object('status', 'error', 'operation', v_operation,
      'error_category', 'action_not_authorized',
      'message', 'SMS finalize reservation is restricted to technical_owner or business_partner');`,
    );
    out = out.replace(
      /OR v_intent\.actor_role IS DISTINCT FROM 'technical_owner'\s+OR p_actor_role IS DISTINCT FROM 'technical_owner' THEN/g,
      `OR v_intent.actor_role NOT IN ('technical_owner', 'business_partner')
       OR p_actor_role NOT IN ('technical_owner', 'business_partner') THEN`,
    );
    out = out.replace(
      /'SMS finalize is restricted to technical_owner'/g,
      "'SMS finalize is restricted to technical_owner or business_partner'",
    );
  }
  return out;
}

const harden = readFileSync(
  join(toolsMig, "20260828215000_wam_ai_phase1a5_financial_hardening.sql"),
  "utf8",
);
const smsActions = readFileSync(
  join(toolsMig, "20260828231000_wam_ai_phase1a6_sms_actions.sql"),
  "utf8",
);
const smsFinalize = readFileSync(
  join(toolsMig, "20260828232000_wam_ai_phase1a6_finalize_reservation_binding.sql"),
  "utf8",
);

const fallback = patchGatewayRole(
  extractFunction(harden, "set_agent_fallback_dispatch"),
  "agent_config",
);
const radius = patchGatewayRole(
  extractFunction(harden, "set_agent_service_radius"),
  "agent_config",
);
const prepare = patchGatewayRole(
  extractFunction(smsActions, "prepare_send_agent_sms"),
  "sms_prepare",
);
const finalize = patchGatewayRole(
  extractFunction(smsFinalize, "finalize_send_agent_sms"),
  "sms_finalize",
);

for (const [label, body] of [
  ["fallback", fallback],
  ["radius", radius],
  ["prepare", prepare],
  ["finalize", finalize],
]) {
  if (body.includes("requires technical_owner'") && !body.includes("business_partner")) {
    console.error("patch failed for", label);
    process.exit(1);
  }
  if (
    label === "prepare" &&
    body.includes("SMS send is restricted to technical_owner'")
  ) {
    console.error("prepare still owner-only");
    process.exit(1);
  }
}

const header = `-- =============================================================================
-- WAM APPS AI — business_partner authorization remediation (v0.1.22)
-- Extends set_agent_fallback_dispatch, set_agent_service_radius,
-- prepare_send_agent_sms, and finalize_send_agent_sms to allow business_partner
-- alongside technical_owner. Preserves all safety controls, reservation binding,
-- actor/role audit identity, and denies unknown/ai_service/system_maintenance.
-- Forward-only. Do not apply to production without separate authorization.
-- =============================================================================

`;

const grants = `
COMMENT ON FUNCTION wam_ai.set_agent_fallback_dispatch(uuid, text, boolean, integer, uuid, uuid, text, text, text) IS
  'MCP: wam.business.agents.set_agent_fallback_dispatch — technical_owner or business_partner; fallback pool configuration.';
COMMENT ON FUNCTION wam_ai.set_agent_service_radius(uuid, text, double precision, boolean, uuid, uuid, text, text, text) IS
  'MCP: wam.business.agents.set_agent_service_radius — technical_owner or business_partner; service radius configuration.';
COMMENT ON FUNCTION wam_ai.prepare_send_agent_sms(uuid, text, text, text, uuid, uuid, text, text, text, text, text, text) IS
  'MCP: wam.business.messaging.send_agent_sms prepare — technical_owner or business_partner; verified Agent Hub recipient only.';
COMMENT ON FUNCTION wam_ai.finalize_send_agent_sms(uuid, uuid, text, text, text, text, text, text, boolean, text) IS
  'MCP: wam.business.messaging.send_agent_sms finalize — technical_owner or business_partner; reservation actor binding preserved.';
`;

const outName = "20260912180000_wam_ai_business_partner_ops_authorization.sql";
const body = `${header}${fallback}\n\n${radius}\n\n${prepare}\n\n${finalize}\n${grants}\n`;

writeFileSync(join(toolsMig, outName), body, "utf8");
writeFileSync(join(supabaseMig, outName), body, "utf8");
console.log("wrote", outName, "bytes", body.length);
console.log(
  "business_partner mentions",
  (body.match(/business_partner/g) || []).length,
);
