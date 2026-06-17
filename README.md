# WattWise — AI Bill Intelligence

Live: **[trywattwise.com](https://trywattwise.com)**

**Status: live pilot product; pilot metrics updated as of June 2026**

Built for the Perplexity Billion Dollar Build 2026.

---

## What WattWise is

WattWise is a consumer web app that reads a household's utility, gas, or
internet bill and tells the user exactly where they're overpaying — hidden
fees, wrong rate plans, expired promotional rates, charges that survived a
provider switch, and missed income-tested assistance programs. For every
finding it produces a structured result and a word-for-word phone script the
user can read to their provider to get the charge removed or refunded.

The product is free to the end user. A bill goes in; a prioritized list of
findings, dollar estimates, and ready-to-use call scripts comes out.

---

## Pilot status (June 2026)

These are the canonical pilot figures. They appear once here and are kept
consistent across the product UI.

| Metric | Value |
|---|---|
| Households analyzed | 21 |
| States covered | 14 |
| Households in pipeline | 29 |
| Confirmed outcomes | 7 |
| Total refunded | $375 |
| Identified annual savings | $1,657/year |

These reflect an early pilot, not a productionized or scaled deployment.

---

## How it works

1. The user answers a short onboarding flow and uploads a recent bill.
2. The bill is stored in Supabase Storage and a row is created in Postgres.
3. An edge function (`analyze-bill-v3`) sends the bill data to Perplexity
   `sonar-pro` with a structured **8-step chain-of-thought system prompt**
   (data validation → usage anomalies → charge anomalies → ISP promo check →
   time-of-use eligibility → assistance-program eligibility → confidence
   scoring → structured JSON output).
4. The model returns structured findings, savings estimates, and call-script
   content, which are persisted and rendered back to the user.
5. Confirmation and "analysis ready" emails are sent server-side via Resend.

> **Claim-safety note:** The "8-step pipeline" is a single, carefully
> structured Perplexity `sonar-pro` chat completion guided by a multi-step
> system prompt — it is **prompt-engineered chain-of-thought, not a RAG or
> vector/embedding system.** There is no vector store, no embedding index, and
> no retrieval-augmented generation in this codebase. The `ww_rates` table is a
> plain SQL tariff cache, not a vector database. Please do not describe this
> project as a shipped/productionized RAG system — that work is not present in
> the code.

---

## Architecture

| Layer | Tech |
|---|---|
| Frontend | Single-file static `src/index.html` deployed to Vercel |
| AI | Perplexity `sonar` / `sonar-pro` via `chat/completions` |
| Backend | Supabase Postgres + 8 Deno edge functions |
| Storage | Supabase Storage (raw bill files) |
| Email | Resend (`hello@trywattwise.com`) |
| Analytics | PostHog |

```
.
├── src/
│   └── index.html                    # Production frontend (single file)
├── supabase/
│   ├── functions/
│   │   ├── analyze-bill/             # Legacy v1 analyzer (kept for compat)
│   │   ├── analyze-bill-test/        # Health-check stub
│   │   ├── analyze-bill-v3/          # Production analyzer (bill_type-aware)
│   │   ├── chat-proxy/               # Server-side Perplexity proxy (chat UI)
│   │   ├── validate-bill-proxy/      # Server-side Perplexity proxy (upload validation)
│   │   ├── script-proxy/             # Server-side Perplexity proxy (call scripts)
│   │   ├── send-submission-email/    # "Bill received" confirmation
│   │   └── send-verification-email/  # "Analysis ready" with findings + savings
│   └── schema/
│       └── 001_initial_schema.sql    # Production DDL snapshot
├── docs/
│   └── DEPLOY.md                     # Deployment runbook
├── vercel.json
├── .gitignore
└── README.md
```

### Database

5 tables in the `public` schema, all with RLS enabled. Full DDL in
[`supabase/schema/001_initial_schema.sql`](supabase/schema/001_initial_schema.sql).

- `ww_households` — onboarded households + utility selections
- `ww_bill_uploads` — raw uploaded files
- `ww_analyses` — analysis runs with savings ranges + raw Perplexity JSON
- `ww_findings` — individual issues surfaced per analysis
- `ww_rates` — tariff cache (PUC filings + verified utility rates)

---

## Privacy & safety

- Uploaded bills are stored in Supabase Storage and processed server-side; they
  are not exposed to the client beyond the uploading user's own session.
- **No Perplexity, Resend, or service-role key is ever placed in client code.**
  The browser holds only the **publishable** Supabase anon key
  (`WW_SUPABASE_ANON_KEY`) and the PostHog project key — both designed to be
  client-side. Every Perplexity call routes through an edge function
  (`chat-proxy`, `validate-bill-proxy`, `script-proxy`) and every Resend send
  happens server-side, with secrets read from Supabase via `Deno.env.get(...)`.
- Local `.env*` files are git-ignored. If a key is ever exposed, revoke it at
  the provider, rotate the Supabase secret, and redeploy.

---

## Deploy

See [`docs/DEPLOY.md`](docs/DEPLOY.md) for the full runbook.

Quick version:

```bash
# Frontend → Vercel
cd src && vercel deploy --prod --yes

# Edge function → Supabase
supabase functions deploy <slug> \
  --project-ref <your-project-ref> \
  --no-verify-jwt
```

Required Supabase edge-function secrets:

| Secret | Used by |
|---|---|
| `PERPLEXITY_API_KEY` | `analyze-bill`, `analyze-bill-v3`, `chat-proxy`, `validate-bill-proxy`, `script-proxy` |
| `RESEND_API_KEY` | `send-submission-email`, `send-verification-email` |
| `SUPABASE_URL` | All functions (auto-populated) |
| `SUPABASE_SERVICE_ROLE_KEY` | All functions (auto-populated) |

---

## License

**Proprietary — all rights reserved.**

This repository is published for portfolio and demonstration purposes only. It
is **not** open source. No license is granted to use, copy, modify, or
distribute this code or its contents, in whole or in part, without the express
written permission of the author. All rights are reserved unless the author
chooses otherwise in the future.
