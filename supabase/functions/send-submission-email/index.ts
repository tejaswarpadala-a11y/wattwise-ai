import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "REMOVED_RESEND_KEY";
const FROM = "WattWise <hello@trywattwise.com>";

const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { analysis_id, household_id } = await req.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: household } = await supabase
      .from("ww_households")
      .select("full_name, email")
      .eq("id", household_id)
      .single();

    if (!household?.email) {
      return new Response(
        JSON.stringify({ success: false, reason: "no_email" }),
        { headers: corsHeaders }
      );
    }

    const rawFirst = (household.full_name || "").split(" ")[0] || "";
    const isGenericName =
      !rawFirst ||
      rawFirst.toLowerCase() === "wattwise" ||
      household.full_name === "WattWise Web User" ||
      household.full_name === "WattWise User";
    const greetingName = isGenericName ? "there" : rawFirst;

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:48px 20px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:540px;">
          <tr>
            <td style="padding-bottom:28px;">
              <table>
                <tr>
                  <td style="background:#0f1a24;border-radius:10px;padding:8px 14px;">
                    <span style="font-size:15px;font-weight:700;color:#ffffff;">⚡ WattWise</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="background:#ffffff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;">
              <table width="100%">
                <tr>
                  <td style="background:#d4a843;height:4px;font-size:0;">&nbsp;</td>
                </tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0" style="padding:36px 40px 32px;">
                <tr>
                  <td>
                    <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#d4a843;text-transform:uppercase;letter-spacing:0.1em;">BILL RECEIVED</p>
                    <h1 style="margin:0 0 16px;font-size:24px;font-weight:800;color:#0f1a24;line-height:1.2;">Hi ${greetingName}, we're analyzing your bill now.</h1>
                    <p style="margin:0 0 24px;font-size:16px;color:#475569;line-height:1.65;">
                      Your bill has been received and is being analyzed.
                      <strong style="color:#0f1a24;">You'll get another email when your findings are ready</strong>
                      — usually within 1 hour.
                    </p>
                    <table style="margin:0 0 28px;width:100%;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0;">
                      <tr>
                        <td style="padding:16px 20px;">
                          <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em;">WHAT HAPPENS NEXT</p>
                          <p style="margin:0 0 6px;font-size:14px;color:#334155;">🔍 We read every line against the actual tariff schedule</p>
                          <p style="margin:0 0 6px;font-size:14px;color:#334155;">🚨 We flag hidden charges, expired promotions, and wrong rate plans</p>
                          <p style="margin:0;font-size:14px;color:#334155;">📞 We build a word-for-word call script for anything we find</p>
                        </td>
                      </tr>
                    </table>
                    <table>
                      <tr>
                        <td style="background:#0f1a24;border-radius:10px;">
                          <a href="https://trywattwise.com/#results" style="display:block;padding:12px 28px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;">Check analysis status →</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:20px 0 0;text-align:center;">
              <p style="margin:0;font-size:12px;color:#94a3b8;">trywattwise.com</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: household.email,
        subject: "⚡ WattWise is analyzing your bill — results within 1 hour",
        html: html,
      }),
    });

    const resendData = await resendRes.json();

    return new Response(
      JSON.stringify({
        success: !!resendData.id,
        email_id: resendData.id || null,
        analysis_id: analysis_id || null,
      }),
      { headers: corsHeaders }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: String(err) }),
      { status: 500, headers: corsHeaders }
    );
  }
});
