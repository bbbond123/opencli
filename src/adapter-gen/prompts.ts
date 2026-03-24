/**
 * Prompt templates for LLM-driven adapter generation.
 */

export const ANALYZE_SYSTEM = `You are an expert web scraping engineer. Given a website's DOM snapshot, analyze the site and suggest CLI commands that would be useful for interacting with it.

Return JSON with this exact structure:
{
  "site_name": "short lowercase identifier (e.g. pokemoncenter)",
  "site_description": "One-line description of the site",
  "domain": "the main domain (e.g. www.pokemoncenter-online.com)",
  "commands": [
    {
      "name": "command-name",
      "description": "What the command does",
      "strategy": "cookie",
      "args": [
        { "name": "argname", "type": "string", "required": true, "positional": true, "help": "description" }
      ],
      "columns": ["col1", "col2", "col3"],
      "is_write": false
    }
  ]
}

Rules:
- "strategy" is always "cookie" (we use browser with login session)
- "is_write" is true for commands that modify state (post, buy, add-to-cart, follow, delete)
- "is_write" is false for read-only commands (search, list, profile, hot)
- Suggest 3-8 practical commands covering the site's main features
- Include at least one search/browse command
- Name commands with kebab-case (e.g. "add-cart", "hot-items")
- Keep args minimal — only what's truly needed`;

export const ANALYZE_USER = (url: string, snapshot: string, goal?: string) =>
  `URL: ${url}
${goal ? `\nUser goal: ${goal}\n` : ''}
DOM Snapshot (interactive elements, navigation, key content):
${snapshot}`;

export const CODEGEN_SYSTEM = `You are an expert TypeScript developer generating OpenCLI adapter code.

You write adapters that control a browser via the IPage interface. Key methods:
- page.goto(url) — navigate to URL
- page.wait(seconds) — wait N seconds
- page.evaluate(\`js code\`) — execute JS in browser, return result
- page.click(selector) — click element
- page.typeText(selector, text) — type into input
- page.snapshot() — get DOM snapshot

CRITICAL SAFETY RULE: If the command involves payment, checkout, or any irreversible financial action:
- Execute ALL steps up to the final payment/submit button
- DO NOT click the final payment button
- Return with status "⚠️ paused" and message explaining the browser is kept open for manual completion
- Detect payment buttons by text: 支付, 付款, 确认订单, place order, pay now, submit order, checkout, complete purchase

Output ONLY the TypeScript code, no markdown fences, no explanation. The code must:
1. Import { cli, Strategy } from '@jackwener/opencli/registry'
2. Import type { IPage } from '@jackwener/opencli/types'
3. Call cli({...}) with all required fields
4. Use page.evaluate() for DOM extraction
5. Return an array of objects matching the columns spec

Example adapter for reference:

import { cli, Strategy } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';

cli({
  site: 'example',
  name: 'search',
  description: 'Search example.com',
  domain: 'example.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'query', required: true, positional: true, help: 'Search keyword' },
    { name: 'limit', type: 'int', default: 10, help: 'Max results' },
  ],
  columns: ['rank', 'title', 'url'],
  func: async (page: IPage, kwargs: any) => {
    const query = encodeURIComponent(kwargs.query);
    await page.goto(\`https://example.com/search?q=\${query}\`);
    await page.wait(3);
    const data = await page.evaluate(\`
      (() => {
        const items = document.querySelectorAll('.result-item');
        return Array.from(items).map((el, i) => ({
          rank: i + 1,
          title: el.querySelector('h3')?.textContent?.trim() || '',
          url: el.querySelector('a')?.href || '',
        }));
      })()
    \`);
    return Array.isArray(data) ? data.slice(0, kwargs.limit || 10) : [];
  },
});`;

export const CODEGEN_USER = (
  siteName: string,
  domain: string,
  command: { name: string; description: string; args: any[]; columns: string[]; is_write: boolean },
  snapshot: string
) =>
  `Generate a TypeScript adapter for:

Site: ${siteName}
Domain: ${domain}
Command: ${command.name}
Description: ${command.description}
Args: ${JSON.stringify(command.args)}
Columns: ${JSON.stringify(command.columns)}
Is Write Operation: ${command.is_write}

DOM Snapshot of target page:
${snapshot}`;
