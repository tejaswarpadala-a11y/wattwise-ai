// chat-proxy — server-side proxy for the WattWise chat screen.
// Keeps the Perplexity API key off the browser and handles CORS for the
// trywattwise.com origin. Accepts { messages, max_tokens, temperature }
// and returns { content } on success or { content, error } on failure.

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
    const { messages, max_tokens, temperature } = await req.json();

    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${PERPLEXITY_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages,
        max_tokens: max_tokens || 500,
        temperature: temperature || 0.2,
      }),
    });

    const data = await response.json();
    const content =
      data?.choices?.[0]?.message?.content || "I could not process that.";

    return new Response(JSON.stringify({ content }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        content: "Something went wrong. Please try again.",
        error: (err as Error).message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
