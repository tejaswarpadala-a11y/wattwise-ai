# WattWise — AI Bill Intelligence

Live: **[trywattwise.com](https://trywattwise.com)**

Perplexity Billion Dollar Build 2026.

WattWise reads household utility, gas, and internet bills, runs them against
verified tariff data + an 8-step Perplexity Sonar pipeline, and returns
structured findings (hidden fees, wrong rate plans, expired promos, etc.)
with word-for-word call scripts for each one.

---

## Stack

| Layer | Tech |
|---|---|
| Frontend | Single-file `src/index.html` deployed to Vercel |
| AI pipeline | Perplexity `sonar` / `sonar-pro` (chat + agent endpoints) |
| Backend | Supabase Postgres + 6 Edge Functions (Deno) |
| Storage | Supabase Storage (raw bill files) |
| Email | Resend (`hello@trywattwise.com`) |
| Analytics | PostHog |

---

## Repo layout

```
.
├── src/
│   └── index.html                    # Production frontend (~5,650 lines)
├── supabase/
│   ├── functions/
│   │   ├── analyze-bill/             # Legacy v1 analyzer (sonar agent)
│   │   ├── analyze-bill-test/        # Health-check stub
│   │   ├── analyze-bill-v3/          # PRODUCTION analyzer (bill_type-aware)
│   │   ├── chat-proxy/               # Server-side Perplexity proxy for chat UI
│   │   ├── send-submission-email/    # "Bill received" confirmation
│   │   └── send-verification-email/  # "Analysis ready" with findings + savings
│   └── schema/
│       └── 001_initial_schema.sql    # Production DDL snapshot
├── docs/
│   └── DEPLOY.md                     # Deployment runbook
├── .gitignore
└── README.md
```

---

## Production endpoints

**Supabase project**: `ilmjduriinjhayaayjpk`
**Base URL**: `https://ilmjduriinjhayaayjpk.supabase.co`

| Function | Slug | Purpose |
|---|---|---|
| `/functions/v1/analyze-bill-v3` | analyze-bill-v3 | Main analyzer used by the frontend |
| `/functions/v1/chat-proxy` | chat-proxy | Proxies chat → Perplexity (keeps API key off browser) |
| `/functions/v1/send-submission-email` | send-submission-email | Fires when a bill is uploaded |
| `/functions/v1/send-verification-email` | send-verification-email | Fires once when analysis is verified |
| `/functions/v1/analyze-bill` | analyze-bill | Legacy analyzer (kept for backward compat) |

All edge functions are deployed with `verify_jwt: false` and use CORS `*`.

---

## Required secrets

Set these in Supabase → Project Settings → Edge Functions → Secrets:

| Secret | Used by |
|---|---|
| `PERPLEXITY_API_KEY` | `analyze-bill`, `analyze-bill-v3`, `chat-proxy` |
| `RESEND_API_KEY` | `send-submission-email`, `send-verification-email` |
| `SUPABASE_URL` | All functions (auto-populated) |
| `SUPABASE_SERVICE_ROLE_KEY` | All functions (auto-populated) |

The frontend reads `WW_SUPABASE_URL`, `WW_SUPABASE_ANON_KEY`, and (legacy)
`WW_PERPLEXITY_KEY` from inline `<script>` tags in `src/index.html`. The
Perplexity key in the HTML is no longer used at runtime — chat now routes
through `chat-proxy`.

---

## Deploy

See [`docs/DEPLOY.md`](docs/DEPLOY.md) for the full runbook.

Quick version:

```bash
# Frontend → Vercel
cd src && vercel deploy --prod --yes --scope tejaswarpadala-a11ys-projects

# Edge function → Supabase
supabase functions deploy <slug> \
  --project-ref ilmjduriinjhayaayjpk \
  --no-verify-jwt
```

---

## Database

5 tables in the `public` schema, all with RLS enabled. Full DDL in
[`supabase/schema/001_initial_schema.sql`](supabase/schema/001_initial_schema.sql).

- `ww_households` — onboarded households + utility selections
- `ww_bill_uploads` — raw uploaded files
- `ww_analyses` — analysis runs with savings ranges + raw Perplexity JSON
- `ww_findings` — individual issues surfaced per analysis
- `ww_rates` — tariff cache (PUC filings + verified utility rates)
