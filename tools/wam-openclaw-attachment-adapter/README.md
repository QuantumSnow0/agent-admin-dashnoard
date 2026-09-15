# wam-openclaw-attachment-adapter

**Version:** 0.2.2  
**OpenClaw:** stock **2026.7.1-2** (no core patch)  
**MCP:** `wam-apps-ai-mcp` **>=0.1.18** (enforced)

Plugin-only sequence binding. Pathless wrappers are **always catalogued** when
`tools.alsoAllow` permits; execute performs a ≤500 ms wait + late-claim when
instruction `message_received` races the prompt.

See `patches/PLUGIN-ONLY-SEQUENCE-BINDING.md` and the runbook.

## Commands

```bash
npm ci --ignore-scripts
npm run typecheck
npm run build
npm test
```

## VPS policy notes

- Keep `tools.profile=coding` and merge the three wrappers into `tools.alsoAllow`.
- Leave `plugins.allow` **absent** on this OpenClaw build (narrow allow lists
  suppress bundled plugins). Accept the non-bundled-plugin trust warning.
- Do not expose raw `wam.business.documents.*` via MCP toolFilter.
