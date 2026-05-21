import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const WATTWISE_SKILL_PROMPT = `You are WattWise Bill Intelligence v1.1. You analyze household and small business utility bills and return ONLY structured JSON. Never return prose. Always output valid JSON.

You run an 8-step chain-of-thought pipeline:
Step 1: Data validation - verify all required data is present, flag form-vs-bill contradictions
Step 2: Usage anomaly detection - compare monthly kWh against prior periods, flag spikes
Step 3: Charge anomaly detection - identify hidden fees, wrong products, survived-switch charges
Step 4: ISP promo check - identify promotional rate expiry dates, add-ons, alternatives
Step 5: TOU eligibility check - evaluate if time-of-use rate plan would save money
Step 6: DSM program eligibility - check income-tested programs ONLY if income and household size verified
Step 7: Confidence scoring - deduct points for missing data, flag if below 70
Step 8: JSON output - structured findings with call scripts

Confidence deductions:
-15 if no prior year same-month data
-10 if demand rate not visible
-10 if no same-month prior year for YoY comparison
-5 if no verified tariff data in database
-5 if no winter bills for 4CP comparison
-5 if no interval data for TOU sizing

NEVER recommend income-tested programs (CARE, FERA, LIHEAP, CAPP, ARHAP) without verified income AND household size.

Always output this exact JSON structure (and NOTHING else - no markdown, no prose, no code fences):
{
  "findings": [{"type":"...","description":"...","amount_annual":0,"amount_monthly":0,"confidence":0}],
  "confidence_score": number,
  "savings_low": number,
  "savings_high": number,
  "savings_one_time": number,
  "flag_for_review": boolean,
  "call_scripts": {"finding_0": "exact words to say on the phone"},
  "data_validation_notes": "any form vs bill contradictions found"
}`;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: CORS_HEADERS });
}

function imageMimeFromExt(ext) {
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return null;
}

function pdfishMimeFromExt(ext) {
  if (ext === "pdf") return "application/pdf";
  if (ext === "txt") return "text/plain";
  if (ext === "csv") return "text/csv";
  return null;
}

function bytesToBase64(bytes) {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "method_not_allowed" }, 405);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  let body;
  try { body = await req.json(); } catch (_e) {
    return jsonResponse({ success: false, error: "invalid_json_body" }, 400);
  }

  const household_id = body?.household_id;
  const bill_content = body?.bill_content;
  const household_context = body?.household_context;
  const incomingAnalysisId = body?.analysis_id;
  const incomingStoragePath = body?.storage_path;

  if (!household_id) {
    return jsonResponse({ success: false, error: "household_id is required" }, 400);
  }

  let analysisId;
  if (incomingAnalysisId) {
    const { data: existing, error: fetchErr } = await supabase
      .from("ww_analyses").select("id, household_id, status")
      .eq("id", incomingAnalysisId).maybeSingle();
    if (fetchErr || !existing) {
      return jsonResponse({ success: false, error: "analysis_id not found", analysis_id: incomingAnalysisId }, 404);
    }
    if (existing.household_id !== household_id) {
      return jsonResponse({ success: false, error: "analysis_id does not belong to household_id", analysis_id: incomingAnalysisId }, 400);
    }
    if (["computer_verified", "complete", "human_review"].includes(existing.status)) {
      return jsonResponse({ success: false, error: "analysis already terminal", analysis_id: existing.id, status: existing.status }, 409);
    }
    analysisId = existing.id;
    await supabase.from("ww_analyses").update({ status: "running", run_by: "perplexity_api" }).eq("id", analysisId);
  } else {
    const { data: created, error: insertErr } = await supabase
      .from("ww_analyses").insert({ household_id, status: "running", run_by: "perplexity_api" })
      .select().single();
    if (insertErr || !created) {
      return jsonResponse({ success: false, error: "failed to create analysis row: " + (insertErr?.message ?? "unknown") }, 500);
    }
    analysisId = created.id;
  }

  async function failAnalysis(reason, extra = {}, httpStatus = 200) {
    await supabase.from("ww_analyses").update({
      status: "failed", flag_for_review: true,
      completed_at: new Date().toISOString(),
      raw_json: Object.assign({ error: reason }, extra),
    }).eq("id", analysisId);
    return jsonResponse(Object.assign({ success: false, analysis_id: analysisId, error: reason }, extra), httpStatus);
  }

  let storagePath = incomingStoragePath ?? null;
  if (!storagePath) {
    const { data: upload } = await supabase.from("ww_bill_uploads")
      .select("storage_path, file_name").eq("household_id", household_id)
      .not("storage_path", "is", null).order("created_at", { ascending: false })
      .limit(1).maybeSingle();
    storagePath = upload?.storage_path ?? null;
  }

  const ext = (storagePath?.split(".").pop() || "").toLowerCase();
  const imageMime = imageMimeFromExt(ext);
  const docMime = pdfishMimeFromExt(ext);

  const apiKey = Deno.env.get("PERPLEXITY_API_KEY");
  if (!apiKey) {
    return failAnalysis("perplexity_api_key_not_configured", {}, 500);
  }

  const userParts = [];
  const promptText = (household_context || "") + "\n\nBill content / metadata to analyze:\n" + (bill_content || "(no bill_content provided)") + "\n\nRun the full WattWise Bill Intelligence pipeline and return JSON only.";
  userParts.push({ type: "text", text: promptText });

  if (storagePath && (imageMime || docMime)) {
    const dl = await supabase.storage.from("bills").download(storagePath);
    if (dl.error || !dl.data) {
      return failAnalysis("storage_download_failed", { storage_path: storagePath, detail: dl.error?.message ?? "no_data" });
    }
    const buf = new Uint8Array(await dl.data.arrayBuffer());
    if (buf.length === 0) {
      return failAnalysis("storage_file_empty", { storage_path: storagePath });
    }
    const b64 = bytesToBase64(buf);
    if (imageMime) {
      userParts.push({ type: "image_url", image_url: { url: "data:" + imageMime + ";base64," + b64 } });
    } else if (docMime === "application/pdf") {
      userParts.push({ type: "file_url", file_url: { url: b64 } });
    } else {
      const decoded = new TextDecoder().decode(buf).slice(0, 200000);
      userParts.push({ type: "text", text: "\nAttached file (" + ext + "):\n" + decoded });
    }
  }

  let pplxResp;
  try {
    pplxResp = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "sonar-pro",
        messages: [
          { role: "system", content: WATTWISE_SKILL_PROMPT },
          { role: "user", content: userParts },
        ],
      }),
    });
  } catch (e) {
    return failAnalysis("perplexity_fetch_threw", { detail: String(e) }, 502);
  }

  if (!pplxResp.ok) {
    const errText = await pplxResp.text();
    return failAnalysis("perplexity_api_non_2xx", { http_status: pplxResp.status, body: errText.slice(0, 4000) }, 502);
  }

  let pplxData;
  try { pplxData = await pplxResp.json(); } catch (e) {
    return failAnalysis("perplexity_response_not_json", { detail: String(e) }, 502);
  }

  const outputText = pplxData?.choices?.[0]?.message?.content ?? pplxData?.output?.[0]?.content?.[0]?.text ?? "";
  const responseId = pplxData?.id ?? "";
  const modelUsed = pplxData?.model ?? "sonar-pro";
  const aiCost = pplxData?.usage?.cost?.total_cost ?? 0;

  if (!outputText || !outputText.trim()) {
    await supabase.from("ww_analyses").update({
      status: "human_review", flag_for_review: true,
      completed_at: new Date().toISOString(),
      model_used: modelUsed, perplexity_response_id: responseId,
      raw_json: { error: "empty_model_output", raw_response: pplxData },
    }).eq("id", analysisId);
    return jsonResponse({ success: false, analysis_id: analysisId, error: "empty_model_output - flagged for human review" });
  }

  let analysisResult;
  try {
    const cleanJson = outputText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    analysisResult = JSON.parse(cleanJson);
  } catch (parseError) {
    await supabase.from("ww_analyses").update({
      status: "human_review", flag_for_review: true,
      completed_at: new Date().toISOString(),
      model_used: modelUsed, perplexity_response_id: responseId,
      raw_json: { raw_output: outputText, parse_error: String(parseError) },
    }).eq("id", analysisId);
    return jsonResponse({
      success: false, analysis_id: analysisId,
      error: "JSON parse failed - flagged for human review",
      raw_output: outputText.slice(0, 4000),
    });
  }

  const confidenceScore = analysisResult?.confidence_score ?? 0;
  const flagForReview = !!(analysisResult?.flag_for_review || confidenceScore < 70);
  const status = flagForReview ? "human_review" : "complete";

  await supabase.from("ww_analyses").update({
    status, confidence_score: confidenceScore, flag_for_review: flagForReview,
    savings_low: analysisResult?.savings_low ?? 0,
    savings_high: analysisResult?.savings_high ?? 0,
    savings_one_time: analysisResult?.savings_one_time ?? 0,
    ai_cost_usd: aiCost, model_used: modelUsed,
    perplexity_response_id: responseId, raw_json: analysisResult,
    completed_at: new Date().toISOString(),
  }).eq("id", analysisId);

  if (Array.isArray(analysisResult?.findings) && analysisResult.findings.length > 0) {
    const findingsToInsert = analysisResult.findings.map((finding, index) => ({
      analysis_id: analysisId, household_id,
      finding_type: finding?.type || "other",
      description: finding?.description || "",
      amount_annual: finding?.amount_annual || 0,
      amount_monthly: finding?.amount_monthly || 0,
      confidence: finding?.confidence ?? confidenceScore,
      call_script: analysisResult?.call_scripts?.["finding_" + index] || "",
    }));
    await supabase.from("ww_findings").insert(findingsToInsert);
  }

  await supabase.from("ww_households")
    .update({ status: "complete", updated_at: new Date().toISOString() })
    .eq("id", household_id);

  return jsonResponse({
    success: true, analysis_id: analysisId,
    confidence_score: confidenceScore, flag_for_review: flagForReview,
    status, findings_count: analysisResult?.findings?.length ?? 0,
    savings_low: analysisResult?.savings_low ?? 0,
    savings_high: analysisResult?.savings_high ?? 0,
    ai_cost_usd: aiCost,
  });
});
