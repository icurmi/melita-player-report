// Drafts a short report comment from a player's scores using Claude.
// Deploy: supabase functions deploy draft-comment
// Secret: supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   (optional DRAFT_MODEL, default claude-haiku-5-5)
import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return json({ error: "not configured" }, 501);

  // Only registered Melita coaches may use this.
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: ok } = await sb.rpc("is_staff");
  if (!ok) return json({ error: "forbidden" }, 403);

  const { first_name, section, age_group, scores } = await req.json();
  const lines = (scores as { attribute: string; score: number | null }[])
    .map((s) => `- ${s.attribute}: ${s.score ?? "not observed"}`).join("\n");

  const prompt = `You are helping a youth football coach at Melita FC (Malta) write a player report for parents.
Write the "${section}" comment for ${first_name} (${age_group}).

Scores are 1-9, comparing the child with the best players in Malta of the same age:
1-3 weak, 4 below average, 5 average for Malta, 6 above average, 7-9 among the best in Malta. 10 is never given.

${section} scores:
${lines}

Write 2-3 short sentences in plain British English: one honest overall line, what ${first_name} does well (name 1-2 specific skills), and one clear thing to work on.
Warm, specific and encouraging, never harsh. No numbers or scores, no headings, no emojis, no gendered pronouns (use the name). Output only the comment.`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: Deno.env.get("DRAFT_MODEL") ?? "claude-haiku-5-5",
      max_tokens: 220,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!r.ok) return json({ error: "draft failed" }, 502);
  const out = await r.json();
  const text = (out.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("").trim();
  return json({ text });
});
