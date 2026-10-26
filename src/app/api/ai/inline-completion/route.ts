import { NextResponse } from "next/server";
import { OllamaClient } from "@nemesis-oss/ollama-sdk";

const DEFAULT_COMPLETION_MODEL = "qwen2.5:0.5b";

const SYSTEM_PROMPT =
  "You are a code autocomplete assistant for TypeScript and @nemesis-oss/pine-ts. " +
  "Continue the code starting immediately after the provided code snippet. " +
  "Output ONLY the raw code tokens to complete the statement. Do NOT output markdown, backticks, or comments.";

export function sanitizeCompletion(raw: string): string {
  let cleaned = raw.replace(/^```[a-z]*\n?/i, "").replace(/```$/g, "");
  // Take only the first non-empty line or single expression
  const firstLine = cleaned.split("\n")[0] ?? "";
  return firstLine.trimEnd();
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { prefix: string; model?: string };
    if (!body.prefix || body.prefix.trim().length === 0) {
      return NextResponse.json({ ok: true, completion: "" });
    }

    const client = new OllamaClient({ baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434" });
    const model = body.model || DEFAULT_COMPLETION_MODEL;

    const res = await client.generate({
      model,
      system: SYSTEM_PROMPT,
      prompt: body.prefix.slice(-800),
      options: {
        stop: ["\n\n", "```", ";\n"],
        temperature: 0.1,
        num_predict: 20,
      },
    });

    const completion = sanitizeCompletion(res.response);
    return NextResponse.json({ ok: true, completion });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
