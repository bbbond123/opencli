/**
 * Generate TypeScript adapter code for a single command using OpenAI.
 */
import { chatComplete } from './openai-client.js';
import { CODEGEN_SYSTEM, CODEGEN_USER } from './prompts.js';
import type { SuggestedCommand } from './analyzer.js';

export async function generateAdapter(
  siteName: string,
  domain: string,
  command: SuggestedCommand,
  snapshot: string
): Promise<string> {
  const userPrompt = CODEGEN_USER(siteName, domain, command, snapshot);
  const code = await chatComplete(CODEGEN_SYSTEM, userPrompt);

  const cleaned = code
    .replace(/^```(?:typescript|ts)?\n?/m, '')
    .replace(/\n?```$/m, '')
    .trim();

  if (!cleaned.includes('cli(')) {
    throw new Error(`Generated code for ${siteName}/${command.name} is missing cli() call`);
  }

  return cleaned;
}
