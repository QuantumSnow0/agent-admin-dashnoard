# WAM Business MCP — deploy packaging notes

## Install

On the VPS (or packaging host), always install from the lockfile:

```bash
npm ci
```

Do **not** use `npm install` for production packaging (it may mutate the lockfile).

## Exclude from deployment artifact

Never copy these into the runtime package or image:

- `node_modules/` (recreate with `npm ci` on the target)
- `.env` / `.env.*` local secrets (inject via systemd EnvironmentFile or secret store)
- Build caches (`.turbo`, `.cache`, `coverage/`)
- Logs (`*.log`, `logs/`)
- Local test artifacts

Ship: `package.json`, `package-lock.json`, `src/` (or prebuilt `dist/`), `tsconfig.json`, and this note. Prefer building on the target with `npm ci && npm run build`.

## Identity (two-Gateway)

`WAM_AI_IDENTITY_MODE` is required (`production` or `development` exact). No silent default.

Each Gateway Linux user / systemd unit gets its own env (Bonface/root owns partner env files; partner has no shell):

- `WAM_AI_IDENTITY_MODE=production`
- `WAM_AI_INSTANCE_ID`, `WAM_AI_INSTANCE_ACTOR_ID`, `WAM_AI_INSTANCE_ACTOR_ROLE`
- Partner Gateway: `business_partner` only
- Owner Gateway: `technical_owner`

Development mode forbids remote DB hosts (localhost / 127.0.0.1 / ::1 only). Shared Gateway usage is prohibited.

## Rate limits

Default `WAM_AI_RATE_LIMIT_PER_MINUTE=30` per instance-actor. Scheduled `ai_service` jobs should use a dedicated instance and limit, not a human Gateway identity.

## Credentials

Use only `wam_ai_business_readonly` in `WAM_AI_DATABASE_URL`. Never ship application `service_role` keys with this MCP.
