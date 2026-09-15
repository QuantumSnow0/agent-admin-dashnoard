# WAM OpenClaw Attachment Adapter — Install & Rollback Runbook

**Adapter:** `wam-openclaw-attachment-adapter` **v0.2.2**
**OpenClaw:** stock **2026.7.1-2** (no core patch)
**MCP:** Phase 1A.8 **wam-apps-ai-mcp v0.1.18+** (required; enforced at registration)

Plugin-only **sequence binding** is **ACCEPTED** for the private bonface-owner
Telegram session. See `patches/PLUGIN-ONLY-SEQUENCE-BINDING.md`.

---

## Trust model (explicitly weaker)

1. File `message_received` (CSV/XLSX under verified roots) → pending.
2. Immediately following text `message_received` (same agent/session/account/peer/sender) → `instruction_observed`.
3. `before_prompt_build` may claim with **sessionKey + peerId + runId** when
   `instruction_observed` is already set.
4. **v0.2.2:** pathless wrappers are **always catalogued** (when `tools.alsoAllow`
   permits). If the instruction prompt/tool catalogue races ahead of async
   `message_received`, wrapper **execute** waits ≤ **500 ms**, then late-claims.
5. Stock OpenClaw does **not** expose `messageId` on `before_prompt_build`.
6. This is **sequence binding**, not cryptographic message-to-prompt binding.
7. Content SHA-256 is pinned on first wrapper revalidation and reserved
   process-locally so identical bytes cannot be parsed/reconciled twice.

### Residual risk

A delayed/out-of-order `before_prompt_build` after `instruction_observed` cannot
be proven to match the instruction message without `messageId`. Accept only for
this private single-user Telegram session with fail-closed invalidation.

---

## Prerequisites (must be done before adapter install)

1. **Phase 1A.8 MCP `wam-apps-ai-mcp` v0.1.18+** deployed.
2. Its SQL migrations / verifiers for reconcile completed and verified.
3. Adapter registration **fail-closes** unless `WAM_ATTACHMENT_MCP_ENTRY` resolves
   (via realpath containment) to a local `package.json` with
   `"name": "wam-apps-ai-mcp"` and version `>=0.1.18`. Env version strings are
   **not** trusted.

Do **not** install adapter v0.2.2 until MCP 0.1.18 + SQL verifiers are green.
Do **not** modify MCP, SQL, SMS, OpenClaw core, or Phase 1A.8 migrations in this
adapter pass.

---

## Migration

| Component | This pass |
|---|---|
| MCP v0.1.18 + Phase 1A.8 SQL | **REQUIRED prerequisite** (unchanged) |
| OpenClaw core | **UNCHANGED stock 2026.7.1-2** |
| Attachment adapter | **0.2.1 → 0.2.2** (always-catalogued wrappers + bounded late-claim) |

Do **not** set `OPENCLAW_WAM_CORE_PATCH`.

---

## Environment

```bash
OPENCLAW_VERSION=2026.7.1-2
WAM_ATTACHMENT_MCP_ENTRY=/absolute/path/to/wam-apps-ai-mcp/dist/index.js
WAM_ATTACHMENT_ROOTS="/home/bonface/.openclaw/media/inbound:/home/bonface/.openclaw/workspaces/bonface-owner/media/inbound"
# Do NOT set OPENCLAW_WAM_CORE_PATCH
```

Verified roots only:

- `/home/bonface/.openclaw/media/inbound`
- `/home/bonface/.openclaw/workspaces/bonface-owner/media/inbound`

---

## openclaw.json — VPS policy (required)

Config path: `/home/bonface/.openclaw/openclaw.json`

### Keep

- `tools.profile`: **`"coding"`** (do not replace with `full`)
- `tools.alsoAllow`: must include the three pathless wrappers (merge; do not
  remove existing entries)

### plugins.allow — leave absent on this VPS

On stock OpenClaw **2026.7.1-2**, setting `plugins.allow` to only
`codex` + `wam-attachment-adapter` **suppresses bundled plugins**.

**Accepted for this installation:** leave `plugins.allow` **unset/absent**.
Documented residual: OpenClaw may warn about non-allowlisted / non-bundled
plugin trust. That warning is **accepted**. Do **not** set a narrow
`plugins.allow` array solely for this adapter.

Do **not** change MCP `toolFilter` to expose raw `wam.business.documents.*`
tools.

### Idempotent Node edit (alsoAllow only — do not set plugins.allow)

```bash
node <<'EOF'
const fs = require("fs");
const path = "/home/bonface/.openclaw/openclaw.json";
const cfg = JSON.parse(fs.readFileSync(path, "utf8"));

const WRAPPERS = [
  "inspect_current_business_document",
  "parse_current_document_customers",
  "reconcile_current_document_customers",
];

cfg.tools = cfg.tools && typeof cfg.tools === "object" ? cfg.tools : {};
if (typeof cfg.tools.profile !== "string" || !cfg.tools.profile.trim()) {
  cfg.tools.profile = "coding";
}
const also = Array.isArray(cfg.tools.alsoAllow) ? cfg.tools.alsoAllow.slice() : [];
for (const t of WRAPPERS) {
  if (!also.includes(t)) also.push(t);
}
cfg.tools.alsoAllow = also;

// Do NOT set cfg.plugins.allow on this VPS (suppresses bundled plugins).
if (cfg.plugins && Object.prototype.hasOwnProperty.call(cfg.plugins, "allow")) {
  console.warn("WARNING: plugins.allow is set; leaving as-is. Prefer absent on this build.");
}

fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
console.log("tools.profile=", cfg.tools.profile);
console.log("tools.alsoAllow=", cfg.tools.alsoAllow);
console.log("plugins.allow=", cfg.plugins && cfg.plugins.allow);
EOF
```

### Expected shape (illustrative)

```json
{
  "tools": {
    "profile": "coding",
    "alsoAllow": [
      "inspect_current_business_document",
      "parse_current_document_customers",
      "reconcile_current_document_customers"
    ]
  }
}
```

### Raw MCP document tools stay hidden

- Path-taking `wam.business.documents.*` remain blocked by adapter `before_tool_call`.
- Do **not** add them to `tools.alsoAllow`.

---

## Artifacts (review only — not deployed by this pass)

| Artifact | Role |
|---|---|
| `docs/wam-openclaw-attachment-adapter-0.2.2.tgz` | Adapter npm pack |
| `docs/wam-openclaw-attachment-adapter-0.2.2.tgz.sha256` | Sidecar |
| `docs/wam-openclaw-attachment-adapter-0.2.2-review-source.tar.gz` | Review source |
| `docs/wam-openclaw-attachment-adapter-0.2.2-review-source.tar.gz.sha256` | Sidecar |

---

## VPS facts

- OpenClaw: `/home/bonface/.npm-global`
- Gateway: systemd **user** service
  `/home/bonface/.config/systemd/user/openclaw-gateway.service`
- Use `systemctl --user`, `journalctl --user -u openclaw-gateway.service`
- `npm install -g` **without** sudo

---

## Install (when authorized)

```bash
ts=$(date +%Y%m%d-%H%M%S)
backup_dir=/home/bonface/wam-ai-validation/backups/$ts
mkdir -p "$backup_dir"

systemctl --user stop openclaw-gateway.service

cp -a /home/bonface/.openclaw/openclaw.json "$backup_dir/openclaw.json.bak" || true
openclaw plugins list > "$backup_dir/plugins-before.txt" || true
printf '%s\n' "$backup_dir" > "$backup_dir/BACKUP_DIR.txt"

npm install -g openclaw@2026.7.1-2

# Apply tools.alsoAllow merge only (script above). Leave plugins.allow absent.
openclaw plugins install npm-pack:./wam-openclaw-attachment-adapter-0.2.2.tgz --force

systemctl --user start openclaw-gateway.service
systemctl --user status openclaw-gateway.service
journalctl --user -u openclaw-gateway.service -n 50
```

Live proof: file → (optional file prompt ack) → instruction prompt with
wrappers present even if instruction MR is still racing → inspect late-claims →
parse → reconcile → consumed.

---

## Rollback

```bash
backup_dir=$(cat /home/bonface/wam-ai-validation/backups/<ts>/BACKUP_DIR.txt)

systemctl --user stop openclaw-gateway.service
openclaw plugins uninstall wam-attachment-adapter || true
# cp -a "$backup_dir/openclaw.json.bak" /home/bonface/.openclaw/openclaw.json
systemctl --user start openclaw-gateway.service
journalctl --user -u openclaw-gateway.service -n 30
```

---

## Restart behavior

Process-local capability store (including content-digest reservations); restart
clears pending/claimed/fingerprint state (fail closed). TTL maximum 120 seconds.
Instruction-observe wait at execute: maximum **500 ms**.
