# WattWise — Deployment Runbook

## ⚠️ Secret-handling rules (read first)

- **Never commit API keys.** No Perplexity, Resend, or service-role key may
  ever appear in `src/index.html`, any committed file, or git history.
- The browser only ever holds the **publishable** Supabase anon key
  (`WW_SUPABASE_ANON_KEY`). That key is safe to ship to the client.
- All Perplexity calls route through Supabase Edge Functions
  (`chat-proxy`, `validate-bill-proxy`, `script-proxy`), which read
  `PERPLEXITY_API_KEY` from Supabase secrets server-side.
- All Resend email sends happen in Edge Functions
  (`send-submission-email`, `send-verification-email`), which read
  `RESEND_API_KEY` from Supabase secrets server-side.
- Local `.env*` files are git-ignored — keep keys there for local work only.
- If a key is ever exposed, **revoke it immediately** at the provider, rotate
  the Supabase secret, and redeploy the affected functions.

---

## Frontend (Vercel)

The frontend is a single `src/index.html` file. Vercel project is
`wattwise-ai`, scoped to `tejaswarpadala-a11ys-projects`, aliased to
`https://trywattwise.com`.

```bash
# From repo root
cp src/index.html /tmp/deploy/index.html
cd /tmp/deploy
vercel deploy --prod --yes \
  --token "$VERCEL_TOKEN" \
  --scope tejaswarpadala-a11ys-projects
```

Then verify:

```bash
curl -sL https://trywattwise.com/ | grep -c "Ask WattWise AI"   # should be > 0
```

> Always verify against `https://trywattwise.com` — the raw
> `*.vercel.app` URLs are auth-protected and not user-facing.

---

## Edge functions (Supabase)

Project ref: `ilmjduriinjhayaayjpk`

Deploy any function with the Supabase CLI:

```bash
cd supabase/functions/<slug>
supabase functions deploy <slug> \
  --project-ref ilmjduriinjhayaayjpk \
  --no-verify-jwt
```

All functions are deployed with `verify_jwt: false` because the frontend
calls them directly with the Supabase anon key as a bearer token — there's
no per-user JWT context to validate.

### Setting secrets

Either via dashboard (Project Settings → Edge Functions → Secrets) or CLI:

```bash
# Use your real keys here — NEVER paste them into a committed file.
supabase secrets set PERPLEXITY_API_KEY="<your-perplexity-key>" \
  --project-ref ilmjduriinjhayaayjpk

supabase secrets set RESEND_API_KEY="<your-resend-key>" \
  --project-ref ilmjduriinjhayaayjpk
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-populated by
Supabase and don't need to be set manually.

**Functions that need `PERPLEXITY_API_KEY`**: `analyze-bill`,
`analyze-bill-v3`, `chat-proxy`, `validate-bill-proxy`, `script-proxy`.
**Functions that need `RESEND_API_KEY`**: `send-submission-email`,
`send-verification-email`.

No Perplexity or Resend key is ever set in Vercel — the frontend is static
and only carries the publishable Supabase anon key.

---

## Database migrations

Schema is captured in `supabase/schema/001_initial_schema.sql`. To
re-create the schema in a fresh project:

```bash
psql "$DATABASE_URL" -f supabase/schema/001_initial_schema.sql
```

Going forward, new schema changes should be added as numbered files
(`002_*.sql`, `003_*.sql`, etc.) so they replay deterministically.

---

## Keeping the repo in sync with production

After every production change:

```bash
git add -A
git commit -m "<what changed>"
git push origin main
```

If an edge function is hot-edited in the Supabase dashboard, pull it back
into the repo with the MCP `get_edge_function` tool and commit, otherwise
the repo will drift from production.
