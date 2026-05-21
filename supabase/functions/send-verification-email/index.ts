// send-verification-email
// Fires a single Resend email when a WattWise analysis is verified.
// Idempotent: refuses to send twice for the same analysis_id by gating on
// ww_analyses.email_sent.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_KEY = "REMOVED_RESEND_KEY";
const FROM = "WattWise <hello@trywattwise.com>";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const JSON_HEADERS = {
  "Content-Type": "application/json",
  ...CORS_HEADERS,
};

function esc(input: unknown): string {
  return String(input ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function firstNameFromFull(full: string | null | undefined): string {
  if (!full) return "there";
  const f = String(full).trim().split(/\s+/)[0];
  if (!f) return "there";
  if (/^wattwise$/i.test(f) || /web user/i.test(full)) return "there";
  return f;
}

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { analysis_id, household_id } = body || {};

    if (!analysis_id || !household_id) {
      return new Response(
        JSON.stringify({ success: false, reason: "missing_ids" }),
        { status: 400, headers: JSON_HEADERS },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1) Load analysis + idempotency gate
    const { data: analysis, error: anErr } = await supabase
      .from("ww_analyses")
      .select("email_sent, savings_low, savings_high, raw_json")
      .eq("id", analysis_id)
      .single();

    if (anErr || !analysis) {
      return new Response(
        JSON.stringify({ success: false, reason: "analysis_not_found", error: anErr?.message }),
        { status: 404, headers: JSON_HEADERS },
      );
    }

    if (analysis.email_sent) {
      return new Response(
        JSON.stringify({ success: false, reason: "already_sent" }),
        { headers: JSON_HEADERS },
      );
    }

    // 2) Load household
    const { data: household, error: hhErr } = await supabase
      .from("ww_households")
      .select("*")
      .eq("id", household_id)
      .single();

    if (hhErr || !household) {
      return new Response(
        JSON.stringify({ success: false, reason: "household_not_found", error: hhErr?.message }),
        { status: 404, headers: JSON_HEADERS },
      );
    }

    if (!household.email) {
      return new Response(
        JSON.stringify({ success: false, reason: "no_email" }),
        { headers: JSON_HEADERS },
      );
    }

    // 3) Build template data
    const rawName = firstNameFromFull(household.full_name);
    const savingsLow = Number(analysis.savings_low || 0);
    const savingsHigh = Number(analysis.savings_high || 0);
    const raw: any = analysis.raw_json || {};

    // Count findings — prefer explicit array, else infer from flag fields.
    const explicitFindings = Array.isArray(raw.findings) ? raw.findings.length : 0;
    const inferred = [
      raw.anomaly_detected,
      Array.isArray(raw.add_ons_detected) && raw.add_ons_detected.length > 0,
      raw.demand_charge_detected,
      raw.negotiation_window_open,
      raw.promo_already_expired,
    ].filter(Boolean).length;
    const findingCount = explicitFindings || inferred || 1;
    const findingPlural = findingCount !== 1 ? "s" : "";

    const fmt = (n: number) =>
      Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.00$/, "");
    const rawSavingsText =
      savingsHigh > 0 && savingsHigh !== savingsLow
        ? `$${fmt(savingsLow)}–$${fmt(savingsHigh)}/year`
        : `$${fmt(savingsLow || savingsHigh)}/year`;

    // HTML-escaped values used inside the template
    const name = esc(rawName);
    const savingsText = esc(rawSavingsText);
    const subject = `⚡ Your WattWise analysis is ready — we found ${findingCount} issue${findingPlural}`;

    // 4) Build HTML email (light theme)
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport"
    content="width=device-width,
    initial-scale=1.0">
  <title>Your WattWise analysis is ready</title>
</head>
<body style="margin:0;padding:0;
  background:#f8fafc;
  font-family:-apple-system,
  BlinkMacSystemFont,'Segoe UI',
  'Helvetica Neue',Arial,sans-serif;">

  <table width="100%" cellpadding="0"
    cellspacing="0"
    style="background:#f8fafc;
    padding:48px 20px;">
    <tr>
      <td align="center">
        <table width="100%"
          style="max-width:540px;">

          <!-- Logo row -->
          <tr>
            <td style="padding-bottom:28px;">
              <table>
                <tr>
                  <td style="background:#0f1a24;
                    border-radius:10px;
                    padding:8px 14px;">
                    <span style="font-size:15px;
                      font-weight:700;
                      color:#ffffff;
                      letter-spacing:-0.2px;">
                      ⚡ WattWise
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main card -->
          <tr>
            <td style="background:#ffffff;
              border-radius:16px;
              border:1px solid #e2e8f0;
              overflow:hidden;
              box-shadow:0 1px 3px
                rgba(0,0,0,0.06);">

              <!-- Gold top bar -->
              <table width="100%">
                <tr>
                  <td style="background:#d4a843;
                    height:4px;
                    font-size:0;
                    line-height:0;">
                    &nbsp;
                  </td>
                </tr>
              </table>

              <!-- Card body -->
              <table width="100%"
                cellpadding="0"
                cellspacing="0"
                style="padding:36px 40px 0;">
                <tr>
                  <td>

                    <p style="margin:0 0 6px;
                      font-size:12px;
                      font-weight:700;
                      color:#d4a843;
                      text-transform:uppercase;
                      letter-spacing:0.1em;">
                      ANALYSIS COMPLETE
                    </p>

                    <h1 style="margin:0 0 16px;
                      font-size:26px;
                      font-weight:800;
                      color:#0f1a24;
                      line-height:1.2;
                      letter-spacing:-0.5px;">
                      Hi ${name}, we found
                      ${findingCount}
                      issue${findingCount !== 1
                        ? 's' : ''}
                      on your bill.
                    </h1>

                    <p style="margin:0 0 28px;
                      font-size:16px;
                      color:#475569;
                      line-height:1.65;">
                      Your WattWise analysis
                      is complete. We identified
                      <strong
                        style="color:#15803d;">
                        ${savingsText} in
                        potential savings
                      </strong> — with a
                      word-for-word call script
                      for each finding.
                    </p>

                    <!-- Savings badge -->
                    <table style="margin:0 0
                      28px;">
                      <tr>
                        <td style="background:
                          #f0fdf4;
                          border:1.5px solid
                          #86efac;
                          border-radius:99px;
                          padding:10px 20px;">
                          <span
                            style="font-size:15px;
                            font-weight:700;
                            color:#15803d;">
                            💰 ${savingsText}
                            identified
                          </span>
                        </td>
                      </tr>
                    </table>

                    <!-- CTA -->
                    <table style="margin:0 0
                      36px;">
                      <tr>
                        <td style="background:
                          #0f1a24;
                          border-radius:10px;">
                          <a
                            href="https://trywattwise.com/#results"
                            style="display:block;
                            padding:14px 32px;
                            font-size:15px;
                            font-weight:700;
                            color:#ffffff;
                            text-decoration:none;
                            letter-spacing:-0.1px;">
                            View your findings →
                          </a>
                        </td>
                      </tr>
                    </table>

                  </td>
                </tr>
              </table>

              <!-- What's waiting divider -->
              <table width="100%"
                cellpadding="0"
                cellspacing="0"
                style="padding:0 40px 32px;">
                <tr>
                  <td style="border-top:1px
                    solid #f1f5f9;
                    padding-top:24px;">

                    <p style="margin:0 0 14px;
                      font-size:11px;
                      font-weight:700;
                      color:#94a3b8;
                      text-transform:uppercase;
                      letter-spacing:0.1em;">
                      WHAT'S WAITING FOR YOU
                    </p>

                    <table width="100%"
                      cellpadding="0"
                      cellspacing="0">
                      <tr>
                        <td style="padding:
                          10px 0;
                          border-bottom:1px
                          solid #f8fafc;">
                          <span
                            style="font-size:14px;
                            color:#334155;">
                            🔍
                            <strong>
                              ${findingCount}
                              verified finding
                              ${findingCount !== 1
                                ? 's' : ''}
                            </strong>
                            on your bill
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:
                          10px 0;
                          border-bottom:1px
                          solid #f8fafc;">
                          <span
                            style="font-size:14px;
                            color:#334155;">
                            📞
                            <strong>
                              Word-for-word
                              call scripts
                            </strong>
                            for each finding
                          </span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:
                          10px 0;">
                          <span
                            style="font-size:14px;
                            color:#334155;">
                            💬
                            <strong>
                              AI chat
                            </strong>
                            that knows your
                            specific bill
                          </span>
                        </td>
                      </tr>
                    </table>

                  </td>
                </tr>
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 0 0;
              text-align:center;">
              <p style="margin:0 0 6px;
                font-size:12px;
                color:#94a3b8;
                line-height:1.6;">
                You received this because
                you uploaded a bill to
                WattWise.
              </p>
              <p style="margin:0;
                font-size:12px;">
                <a href="https://trywattwise.com"
                  style="color:#64748b;
                  text-decoration:none;">
                  trywattwise.com
                </a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`;

    // 5) Send via Resend
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: household.email,
        subject,
        html,
      }),
    });

    const resendData = await resendRes.json();

    if (resendData && resendData.id) {
      // Mark email sent — gate against future re-sends
      await supabase
        .from("ww_analyses")
        .update({
          email_sent: true,
          email_sent_at: new Date().toISOString(),
        })
        .eq("id", analysis_id);

      return new Response(
        JSON.stringify({ success: true, email_id: resendData.id }),
        { headers: JSON_HEADERS },
      );
    }

    return new Response(
      JSON.stringify({ success: false, error: resendData }),
      { status: 502, headers: JSON_HEADERS },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: String(err) }),
      { status: 500, headers: JSON_HEADERS },
    );
  }
});
