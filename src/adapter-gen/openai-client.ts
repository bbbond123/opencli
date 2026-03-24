/**
 * OpenAI client wrapper for adapter generation.
 * Uses $OPENAI_API_KEY from environment.
 */
import OpenAI from 'openai';

let _client: OpenAI | null = null;

export function getClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY not set. Export it in your shell:\n  export OPENAI_API_KEY=sk-...'
      );
    }
    _client = new OpenAI({ apiKey });
  }
  return _client;
}

export async function chatComplete(
  systemPrompt: string,
  userPrompt: string,
  options?: { json?: boolean; model?: string }
): Promise<string> {
  const client = getClient();
  const model = options?.model ?? 'gpt-4o';
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    ...(options?.json ? { response_format: { type: 'json_object' } } : {}),
    temperature: 0.2,
  });
  return response.choices[0]?.message?.content ?? '';
}
