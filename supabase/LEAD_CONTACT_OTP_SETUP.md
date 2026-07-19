# Lead contact OTP setup

The agent app sends customer verification codes through Onfon only from Supabase
Edge Functions. Do not place any Onfon credential in Expo environment variables,
application code, Git, or admin UI.

## Required Supabase Edge Function secrets

Set these in Supabase Dashboard → Project Settings → Edge Functions → Secrets:

- `ONFON_API_KEY` — rotated Onfon API key
- `ONFON_CLIENT_ID` — Onfon client ID
- `ONFON_ACCESS_KEY` — value sent in the `AccessKey` request header
- `ONFON_SENDER_ID` — approved sender, for example `Wam-Apps`
- `LEAD_OTP_PEPPER` — a new random secret of at least 32 bytes

The standard Supabase secrets (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
`SUPABASE_SERVICE_ROLE_KEY`) are supplied by the platform.

## Deployment order

1. Rotate the Onfon API key that was shared during development.
2. Add the five secrets above.
3. Apply migration `20260719190000_inbound_lead_contact_otp.sql`.
4. Deploy:
   - `send-lead-contact-otp`
   - `verify-lead-contact-otp`
   - `complete-lead-registration`
   - `lead-outcome`
5. Test one Airtel lead with a real Kenyan phone before releasing the app.

## Security behavior

- OTP lifetime: 5 minutes
- Resend cooldown: 60 seconds
- Maximum sends: 3 per lead and agent per hour
- Maximum verification attempts per code: 3
- OTPs are stored as SHA-256 hashes salted with the server-only pepper
- Only the currently assigned agent can send or verify a code
- Lead MS Forms submission remains locked until contact is verified
