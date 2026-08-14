import { NextResponse } from "next/server";

/**
 * TEMPORARY diagnostic route — lists Gemini models available to whatever
 * GEMINI_API_KEY is configured on this deployment, so the current default
 * model name (src/lib/llm/gemini.ts) can be picked without anyone ever
 * having to paste the key into chat. Returns model names/support only,
 * never the key. Delete this route once the model list has been checked.
 */
export async function GET() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GEMINI_API_KEY is not set" }, { status: 400 });
  }

  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
    headers: { "x-goog-api-key": apiKey },
  });
  const body = await res.json();

  if (!res.ok) {
    return NextResponse.json({ error: body }, { status: res.status });
  }

  const models = (body.models || []).map(
    (m: { name: string; supportedGenerationMethods?: string[] }) => ({
      name: m.name,
      supportedGenerationMethods: m.supportedGenerationMethods,
    })
  );
  return NextResponse.json({ models });
}
