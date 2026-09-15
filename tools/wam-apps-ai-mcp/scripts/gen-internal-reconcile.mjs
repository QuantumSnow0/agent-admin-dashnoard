import fs from "node:fs";

const path =
  "c:/Users/Boniface/Desktop/airtel-agent/admin-dashboard/supabase/migrations/20260829121000_wam_ai_phase1a8_reconcile_cap_guc.sql";
let sql = fs.readFileSync(path, "utf8");
const createIdx = sql.indexOf("CREATE OR REPLACE FUNCTION wam_ai.reconcile_customer_batch");
sql = sql.slice(createIdx);

let internal = sql.replace(
  `CREATE OR REPLACE FUNCTION wam_ai.reconcile_customer_batch(
  p_rows jsonb DEFAULT '[]'::jsonb
)`,
  `CREATE OR REPLACE FUNCTION wam_ai._reconcile_customer_batch_internal(
  p_rows jsonb,
  p_max_rows integer
)`,
);

internal = internal.replace(
  `DECLARE
  v_input_count integer;
  v_max_rows integer := 250;
  v_guc text;`,
  `DECLARE
  v_input_count integer;
  v_max_rows integer;`,
);

internal = internal.replace(
  `v_guc := nullif(current_setting('wam_ai.reconcile_max_rows', true), '');
  v_max_rows := 250;
  IF v_guc IS NOT NULL THEN
    BEGIN
      v_max_rows := least(5000, greatest(1, v_guc::integer));
    EXCEPTION WHEN others THEN
      v_max_rows := 250;
    END;
  END IF;

  v_input_count`,
  `v_max_rows := least(5000, greatest(1, coalesce(p_max_rows, 250)));

  v_input_count`,
);

if (internal.includes("reconcile_max_rows") || internal.includes("v_guc")) {
  console.error("transform failed");
  process.exit(1);
}

const out =
  "c:/Users/Boniface/Desktop/airtel-agent/admin-dashboard/tools/wam-apps-ai-mcp/_internal_body.sql";
fs.writeFileSync(out, internal);
console.log("wrote", out, internal.length);
