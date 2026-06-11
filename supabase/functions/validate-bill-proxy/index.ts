// validate-bill-proxy — server-side proxy for the upload validation step.
// Keeps the Perplexity API key off the browser. The client sends the
// classifier message content (text, or text + image_url for images) and
// this function calls Perplexity sonar and returns { content }.
//
// Accepts: { content } where `content` is either a string (text-only prompt)
// or an array of message parts ([{type:"text",...},{type:"image_url",...}]).
// Returns: { content: string } on success, or { content, error } on failure.

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
    const { content } = await req.json();

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
              "You are a strict JSON classifier. Return ONLY the JSON object requested — no markdown, no prose.",
          },
          { role: "user", content },
        ],
        temperature: 0,
        max_tokens: 200,
      }),
    });

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content || "";

    return new Response(JSON.stringify({ content: text }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ content: "", error: (err as Error).message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
