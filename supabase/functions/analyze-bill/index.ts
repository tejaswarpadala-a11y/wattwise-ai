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

Always output this exact JSON structure:
{
  "findings": [
    {
      "type": "erroneous_fee|wrong_rate_plan|contract_expiry|promo_expiry|usage_anomaly|program_eligibility|demand_charge|ratchet_clause|tax_exemption|solar_outage|billing_error|isp_optimization|other",
      "description": "detailed explanation",
      "amount_annual": number,
      "amount_monthly": number,
      "confidence": number
    }
  ],
  "confidence_score": number,
  "savings_low": number,
  "savings_high": number,
  "savings_one_time": number,
  "flag_for_review": boolean,
  "call_scripts": {
    "finding_0": "exact words to say on the phone"
  },
  "data_validation_notes": "any form vs bill contradictions found"
}`;

Deno.serve(async (req: Request) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }
    });
  }

  try {
    const body = await req.json();
    const { household_id, bill_content, household_context } = body;

    if (!household_id || !bill_content) {
      return new Response(
        JSON.stringify({ error: 'household_id and bill_content are required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Create analysis record with 'running' status
    const { data: analysis, error: insertError } = await supabase
      .from('ww_analyses')
      .insert({
        household_id,
        status: 'running',
        run_by: 'perplexity_api'
      })
      .select()
      .single();

    if (insertError) throw insertError;

    // Build the input for Perplexity
    const analysisInput = `${household_context || ''}

Bill content to analyze:
${bill_content}

Run the full WattWise Bill Intelligence pipeline and return JSON only.`;

    // Call Perplexity Agent API
    const pplxResponse = await fetch('https://api.perplexity.ai/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('PERPLEXITY_API_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        preset: 'pro-search',
        instructions: WATTWISE_SKILL_PROMPT,
        input: analysisInput
      })
    });

    if (!pplxResponse.ok) {
      const errText = await pplxResponse.text();
      throw new Error(`Perplexity API error: ${errText}`);
    }

    const pplxData = await pplxResponse.json();
    
    // Extract the text output
    const outputText = pplxData.output?.[0]?.content?.[0]?.text || '';
    const responseId = pplxData.id || '';
    const modelUsed = pplxData.model || '';
    const aiCost = pplxData.usage?.cost?.total_cost || 0;

    // Parse JSON from output
    let analysisResult;
    try {
      // Strip any markdown code blocks if present
      const cleanJson = outputText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      analysisResult = JSON.parse(cleanJson);
    } catch (parseError) {
      // If JSON parse fails, mark for human review
      await supabase
        .from('ww_analyses')
        .update({ 
          status: 'human_review',
          flag_for_review: true,
          raw_json: { raw_output: outputText, parse_error: String(parseError) }
        })
        .eq('id', analysis.id);

      return new Response(
        JSON.stringify({ 
          success: false, 
          analysis_id: analysis.id,
          error: 'JSON parse failed - flagged for human review',
          raw_output: outputText
        }),
        { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    const confidenceScore = analysisResult.confidence_score || 0;
    const flagForReview = analysisResult.flag_for_review || confidenceScore < 70;
    const status = flagForReview ? 'human_review' : 'complete';

    // Update analysis with results
    await supabase
      .from('ww_analyses')
      .update({
        status,
        confidence_score: confidenceScore,
        flag_for_review: flagForReview,
        savings_low: analysisResult.savings_low || 0,
        savings_high: analysisResult.savings_high || 0,
        savings_one_time: analysisResult.savings_one_time || 0,
        ai_cost_usd: aiCost,
        model_used: modelUsed,
        perplexity_response_id: responseId,
        raw_json: analysisResult,
        completed_at: new Date().toISOString()
      })
      .eq('id', analysis.id);

    // Insert individual findings
    if (analysisResult.findings && analysisResult.findings.length > 0) {
      const findingsToInsert = analysisResult.findings.map((finding: any, index: number) => ({
        analysis_id: analysis.id,
        household_id,
        finding_type: finding.type || 'other',
        description: finding.description || '',
        amount_annual: finding.amount_annual || 0,
        amount_monthly: finding.amount_monthly || 0,
        confidence: finding.confidence || confidenceScore,
        call_script: analysisResult.call_scripts?.[`finding_${index}`] || ''
      }));

      await supabase.from('ww_findings').insert(findingsToInsert);
    }

    // Update household status
    await supabase
      .from('ww_households')
      .update({ status: 'complete', updated_at: new Date().toISOString() })
      .eq('id', household_id);

    return new Response(
      JSON.stringify({
        success: true,
        analysis_id: analysis.id,
        confidence_score: confidenceScore,
        flag_for_review: flagForReview,
        status,
        findings_count: analysisResult.findings?.length || 0,
        savings_low: analysisResult.savings_low || 0,
        savings_high: analysisResult.savings_high || 0,
        ai_cost_usd: aiCost,
        result: analysisResult
      }),
      { 
        status: 200, 
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        } 
      }
    );

  } catch (error) {
    console.error('Edge function error:', error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }
});
