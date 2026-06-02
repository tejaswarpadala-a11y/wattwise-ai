-- WattWise production schema snapshot
-- Project: ilmjduriinjhayaayjpk
-- Captured: 2026-06-01
-- All tables have RLS enabled in production.

-- ============================================================================
-- ww_households
-- One row per onboarded household. Created at form submission, updated as the
-- analysis pipeline progresses.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ww_households (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name       text NOT NULL,
  email           text,
  state           text NOT NULL,
  zip_code        text,
  property_type   text CHECK (property_type IN (
                    'renter_apartment','renter_house','homeowner_sf',
                    'homeowner_townhouse','homeowner_multifamily')),
  household_size  integer,
  income_bracket  text CHECK (income_bracket IN (
                    'under_30k','30k_60k','60k_100k','100k_150k','over_150k')),
  has_ev          boolean DEFAULT false,
  has_solar       boolean DEFAULT false,
  electricity_utility text,
  isp_provider    text,
  gas_utility     text,
  specific_concerns text,
  status          text DEFAULT 'pending' CHECK (status IN (
                    'pending','bills_received','analysis_running','complete','error')),
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
ALTER TABLE public.ww_households ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- ww_bill_uploads
-- Raw uploaded bills (PDF / image / CSV) linked back to a household.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ww_bill_uploads (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    uuid NOT NULL REFERENCES public.ww_households(id),
  file_name       text NOT NULL,
  file_type       text CHECK (file_type IN ('pdf','jpg','png','csv')),
  storage_path    text,
  bill_month      date,
  utility_type    text CHECK (utility_type IN ('electricity','gas','isp','water','other')),
  utility_name    text,
  upload_source   text DEFAULT 'google_form' CHECK (upload_source IN (
                    'google_form','ui_upload','email','api')),
  processed       boolean DEFAULT false,
  created_at      timestamptz DEFAULT now()
);
ALTER TABLE public.ww_bill_uploads ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- ww_analyses
-- One row per bill-analysis run. Holds savings ranges, the raw Perplexity
-- response, and email-send idempotency flags.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ww_analyses (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id            uuid NOT NULL REFERENCES public.ww_households(id),
  analysis_type           text DEFAULT 'residential' CHECK (analysis_type IN (
                            'residential','commercial','isp_only','gas_only','full')),
  status                  text DEFAULT 'pending' CHECK (status IN (
                            'pending','running','complete','failed','human_review','computer_verified')),
  confidence_score        integer CHECK (confidence_score BETWEEN 0 AND 100),
  flag_for_review         boolean DEFAULT false,
  savings_low             numeric,
  savings_high            numeric,
  savings_one_time        numeric DEFAULT 0,
  ai_cost_usd             numeric,
  model_used              text,
  raw_json                jsonb,
  perplexity_response_id  text,
  run_by                  text DEFAULT 'perplexity_api',
  bill_type               text DEFAULT 'electricity',
  created_at              timestamptz DEFAULT now(),
  completed_at            timestamptz,
  email_sent              boolean DEFAULT false,
  email_sent_at           timestamptz
);
ALTER TABLE public.ww_analyses ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- ww_findings
-- Individual issues / savings opportunities surfaced by an analysis run.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ww_findings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  analysis_id         uuid NOT NULL REFERENCES public.ww_analyses(id),
  household_id        uuid NOT NULL REFERENCES public.ww_households(id),
  finding_type        text NOT NULL CHECK (finding_type IN (
                        'erroneous_fee','wrong_rate_plan','contract_expiry','promo_expiry',
                        'usage_anomaly','program_eligibility','demand_charge','ratchet_clause',
                        'tax_exemption','solar_outage','billing_error','isp_optimization','other')),
  description         text NOT NULL,
  amount_annual       numeric,
  amount_one_time     numeric,
  amount_monthly      numeric,
  confidence          integer CHECK (confidence BETWEEN 0 AND 100),
  call_script         text,
  action_taken        boolean DEFAULT false,
  action_confirmed_at timestamptz,
  action_outcome     text,
  created_at          timestamptz DEFAULT now()
);
ALTER TABLE public.ww_findings ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- ww_rates
-- Tariff cache (PUC filings, utility websites, manual entries).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ww_rates (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  utility_name         text NOT NULL,
  state                text NOT NULL,
  rate_plan_name       text,
  rate_type            text CHECK (rate_type IN ('fixed','variable','tiered','tou','indexed')),
  rate_per_kwh         numeric,
  tier_1_rate          numeric,
  tier_2_rate          numeric,
  demand_rate_per_kw   numeric,
  fixed_charge_monthly numeric,
  source_url           text,
  source_type          text DEFAULT 'puc_filing' CHECK (source_type IN (
                         'puc_filing','utility_website','bill_verified','manual')),
  confidence           text DEFAULT 'HIGH' CHECK (confidence IN (
                         'HIGH','MEDIUM','LOW','STALE')),
  verified_at          timestamptz DEFAULT now(),
  expires_at           timestamptz,
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now()
);
ALTER TABLE public.ww_rates ENABLE ROW LEVEL SECURITY;
