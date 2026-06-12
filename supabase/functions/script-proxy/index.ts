// script-proxy — server-side proxy for the negotiation call-script generator.
// Keeps the Perplexity API key off the browser. The client sends the target
// finding id plus the raw analysis JSON; this function calls Perplexity sonar
// (chat/completions) and returns { content } for the client to parse.
//
// Accepts: { finding_id: string, raw_json: object }
// Returns: { content: string } on success, or { error } on failure.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const PERPLEXITY_KEY = Deno.env.get("PERPLEXITY_API_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { finding_id, raw_json } = await req.json();

    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${PERPLEXITY_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          {
            role: "system",
            content:
              "You are the WattWise Negotiation Script Generator. " +
              "Load and apply the skill at: skills/user/wattwise-negotiation-script/SKILL.md. " +
              "Generate scripts for the finding with id: " + finding_id + ". " +
              "Return ONLY the JSON object exactly per the skill schema — no markdown, no prose.",
          },
          { role: "user", content: JSON.stringify(raw_json || {}) },
        ],
        temperature: 0,
        max_tokens: 2000,
      }),
    });

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content || "";

    return new Response(JSON.stringify({ content: text }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
