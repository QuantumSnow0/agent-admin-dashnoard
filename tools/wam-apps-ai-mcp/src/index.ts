import { loadConfig, validateActionConfig, validateConfigForStart } from "./config.js";
import { createDbClient } from "./db.js";
import { createActionDbClient } from "./actionDb.js";
import { startStdioServer } from "./server.js";

async function main() {
  const cfg = loadConfig();
  const check = validateConfigForStart(cfg);
  if (!check.ok) {
    console.error(
      JSON.stringify({
        ok: false,
        error: { category: "config", message: "Invalid configuration", details: check.errors },
      }),
    );
    process.exit(1);
  }

  const actionCheck = validateActionConfig(cfg);
  let actionDb = null;
  if (cfg.actionsEnabled) {
    if (actionCheck.ok) {
      actionDb = createActionDbClient(cfg);
    } else {
      console.error(
        JSON.stringify({
          ok: true,
          warning: "Action tools unavailable — invalid action configuration",
          details: actionCheck.errors,
        }),
      );
    }
  }

  if (cfg.killSwitch) {
    console.error(
      JSON.stringify({
        ok: true,
        warning: "WAM_AI_KILL_SWITCH enabled — tools will deny requests",
      }),
    );
  }

  const db = createDbClient(cfg);
  const shutdown = async () => {
    await db.close();
    if (actionDb) await actionDb.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

  await startStdioServer(cfg, db, actionDb);
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: { category: "startup", message: "Failed to start WAM Business MCP" },
    }),
  );
  void err;
  process.exit(1);
});
