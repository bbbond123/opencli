/**
 * Analyze a site snapshot with OpenAI and suggest commands.
 */
import { chatComplete } from './openai-client.js';
import { ANALYZE_SYSTEM, ANALYZE_USER } from './prompts.js';
import type { SiteSnapshot } from './explorer.js';

export interface SuggestedCommand {
  name: string;
  description: string;
  strategy: string;
  args: Array<{ name: string; type?: string; required?: boolean; positional?: boolean; help?: string }>;
  columns: string[];
  is_write: boolean;
}

export interface SiteAnalysis {
  site_name: string;
  site_description: string;
  domain: string;
  commands: SuggestedCommand[];
}

export async function analyzeSite(snapshot: SiteSnapshot, goal?: string): Promise<SiteAnalysis> {
  const userPrompt = ANALYZE_USER(snapshot.url, snapshot.snapshot, goal);
  const response = await chatComplete(ANALYZE_SYSTEM, userPrompt, { json: true });

  const parsed = JSON.parse(response) as SiteAnalysis;

  if (!parsed.site_name || !Array.isArray(parsed.commands) || parsed.commands.length === 0) {
    throw new Error('LLM returned invalid analysis structure. Try again or use --goal to provide hints.');
  }

  return parsed;
}
