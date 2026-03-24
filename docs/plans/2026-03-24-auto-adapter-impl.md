# Auto Adapter Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `opencli generate <url>` command that uses OpenAI to explore a website and auto-generate TypeScript adapters that appear in `opencli list`.

**Architecture:** Chrome extension opens target site → page snapshot sent to OpenAI for analysis → user confirms suggested commands → OpenAI generates TS code per command → esbuild compiles → saved as plugin in `~/.opencli/plugins/auto-<site>/`.

**Tech Stack:** OpenAI API (gpt-4o), existing OpenCLI browser bridge, esbuild, Node.js readline for interactive prompts.

**Design Doc:** `docs/plans/2026-03-24-auto-adapter-design.md`

---

### Task 1: Add OpenAI dependency

**Files:**
- Modify: `package.json`

**Step 1: Install openai SDK**

Run:
```bash
cd /Users/yibu/dev_workspace/github.com/opencli
npm install openai
```

**Step 2: Verify import works**

Run:
```bash
node -e "import('openai').then(m => console.log('OK:', typeof m.default))"
```
Expected: `OK: function`

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add openai SDK dependency"
```

---

### Task 2: Create OpenAI client module

**Files:**
- Create: `src/adapter-gen/openai-client.ts`

**Step 1: Write the module**

```typescript
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
```

**Step 2: Verify build**

Run: `cd /Users/yibu/dev_workspace/github.com/opencli && npm run build`
Expected: Build succeeds with 332+ entries

**Step 3: Commit**

```bash
git add src/adapter-gen/openai-client.ts
git commit -m "feat: add OpenAI client wrapper for adapter generation"
```

---

### Task 3: Create prompt templates

**Files:**
- Create: `src/adapter-gen/prompts.ts`

**Step 1: Write the prompts module**

```typescript
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
\`\`\`typescript
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
});
\`\`\``;

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
```

**Step 2: Verify build**

Run: `cd /Users/yibu/dev_workspace/github.com/opencli && npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/adapter-gen/prompts.ts
git commit -m "feat: add LLM prompt templates for site analysis and code generation"
```

---

### Task 4: Create site explorer module

**Files:**
- Create: `src/adapter-gen/explorer.ts`

**Step 1: Write the explorer**

```typescript
/**
 * Site explorer — opens URL in Chrome via OpenCLI browser bridge,
 * captures a DOM snapshot for LLM analysis.
 */
import { Page } from '../browser/page.js';

export interface SiteSnapshot {
  url: string;
  title: string;
  description: string;
  snapshot: string;
}

export async function exploreSite(url: string): Promise<SiteSnapshot> {
  const page = new Page('auto-adapter');

  await page.goto(url, { settleMs: 3000 });
  await page.wait(3);

  // Get page metadata
  const meta: { title: string; description: string } = await page.evaluate(`
    (() => ({
      title: document.title || '',
      description: document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
    }))()
  `);

  // Get interactive elements snapshot (compact mode, limited depth)
  const snap = await page.snapshot({ interactive: true, compact: true, maxDepth: 5 });

  // Truncate snapshot to ~4000 tokens worth of text
  const snapStr = typeof snap === 'string' ? snap : JSON.stringify(snap, null, 2);
  const truncated = snapStr.length > 12000 ? snapStr.slice(0, 12000) + '\n... (truncated)' : snapStr;

  return {
    url,
    title: meta.title,
    description: meta.description,
    snapshot: truncated,
  };
}
```

**Step 2: Verify build**

Run: `cd /Users/yibu/dev_workspace/github.com/opencli && npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/adapter-gen/explorer.ts
git commit -m "feat: add site explorer for DOM snapshot capture"
```

---

### Task 5: Create LLM analyzer module

**Files:**
- Create: `src/adapter-gen/analyzer.ts`

**Step 1: Write the analyzer**

```typescript
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

  // Validate structure
  if (!parsed.site_name || !Array.isArray(parsed.commands) || parsed.commands.length === 0) {
    throw new Error('LLM returned invalid analysis structure. Try again or use --goal to provide hints.');
  }

  return parsed;
}
```

**Step 2: Verify build**

Run: `cd /Users/yibu/dev_workspace/github.com/opencli && npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/adapter-gen/analyzer.ts
git commit -m "feat: add LLM site analyzer for command suggestion"
```

---

### Task 6: Create code generator module

**Files:**
- Create: `src/adapter-gen/codegen.ts`

**Step 1: Write the code generator**

```typescript
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

  // Strip markdown fences if LLM wraps in ```typescript ... ```
  const cleaned = code
    .replace(/^```(?:typescript|ts)?\n?/m, '')
    .replace(/\n?```$/m, '')
    .trim();

  // Basic validation: must contain cli() call
  if (!cleaned.includes('cli(')) {
    throw new Error(`Generated code for ${siteName}/${command.name} is missing cli() call`);
  }

  return cleaned;
}
```

**Step 2: Verify build**

Run: `cd /Users/yibu/dev_workspace/github.com/opencli && npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/adapter-gen/codegen.ts
git commit -m "feat: add TypeScript adapter code generator via OpenAI"
```

---

### Task 7: Create plugin builder module

**Files:**
- Create: `src/adapter-gen/builder.ts`

**Step 1: Write the builder**

```typescript
/**
 * Build generated adapters into an OpenCLI plugin.
 * Creates plugin dir, writes TS files, compiles with esbuild, writes metadata.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';

const PLUGINS_DIR = path.join(os.homedir(), '.opencli', 'plugins');

export interface AdapterFile {
  commandName: string;
  code: string;
  isWrite: boolean;
}

export interface AdapterMeta {
  generated_at: string;
  generated_by: string;
  url: string;
  commands: string[];
  checks: Record<string, { last_check: string | null; status: string; reason?: string }>;
}

/**
 * Build and install a set of generated adapters as an OpenCLI plugin.
 * Returns the plugin directory path.
 */
export function buildPlugin(
  siteName: string,
  url: string,
  adapters: AdapterFile[]
): string {
  const pluginName = `auto-${siteName}`;
  const pluginDir = path.join(PLUGINS_DIR, pluginName);

  // Create directory structure
  fs.mkdirSync(path.join(pluginDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(pluginDir, 'dist'), { recursive: true });

  // Write package.json
  const pkg = {
    name: `opencli-plugin-${pluginName}`,
    version: '0.1.0',
    description: `Auto-generated OpenCLI adapter for ${siteName}`,
    type: 'module',
    main: 'dist/index.js',
  };
  fs.writeFileSync(
    path.join(pluginDir, 'package.json'),
    JSON.stringify(pkg, null, 2)
  );

  // Write each adapter TS file
  for (const adapter of adapters) {
    const tsPath = path.join(pluginDir, 'src', `${adapter.commandName}.ts`);
    fs.writeFileSync(tsPath, adapter.code);
  }

  // Symlink host opencli into plugin node_modules
  const nmDir = path.join(pluginDir, 'node_modules', '@jackwener');
  fs.mkdirSync(nmDir, { recursive: true });
  const symlinkTarget = path.join(nmDir, 'opencli');
  if (!fs.existsSync(symlinkTarget)) {
    // Find the host opencli root (this project)
    const hostRoot = path.resolve(import.meta.dirname, '..', '..');
    fs.symlinkSync(hostRoot, symlinkTarget, 'dir');
  }

  // Compile TS → JS with esbuild
  for (const adapter of adapters) {
    const tsFile = path.join(pluginDir, 'src', `${adapter.commandName}.ts`);
    const jsFile = path.join(pluginDir, 'dist', `${adapter.commandName}.js`);
    execSync(
      `npx esbuild "${tsFile}" --outfile="${jsFile}" --format=esm --platform=node --external:@jackwener/opencli`,
      { cwd: pluginDir, stdio: 'pipe' }
    );
  }

  // Write metadata
  const meta: AdapterMeta = {
    generated_at: new Date().toISOString(),
    generated_by: 'gpt-4o',
    url,
    commands: adapters.map(a => a.commandName),
    checks: Object.fromEntries(
      adapters.map(a => [
        a.commandName,
        a.isWrite
          ? { last_check: null, status: 'skipped', reason: 'write command' }
          : { last_check: null, status: 'pending' },
      ])
    ),
  };
  fs.writeFileSync(
    path.join(pluginDir, 'adapter-meta.json'),
    JSON.stringify(meta, null, 2)
  );

  return pluginDir;
}
```

**Step 2: Verify build**

Run: `cd /Users/yibu/dev_workspace/github.com/opencli && npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/adapter-gen/builder.ts
git commit -m "feat: add plugin builder for compiling generated adapters"
```

---

### Task 8: Create the `opencli generate` command

**Files:**
- Create: `src/clis/adapter/generate.ts`

**Step 1: Write the generate command**

```typescript
/**
 * opencli generate <url> — Auto-generate adapters for a website using OpenAI.
 *
 * Flow: explore site → LLM analyze → user confirm → generate code → build plugin
 */
import * as readline from 'node:readline';
import chalk from 'chalk';

import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';
import { exploreSite } from '../../adapter-gen/explorer.js';
import { analyzeSite, type SuggestedCommand } from '../../adapter-gen/analyzer.js';
import { generateAdapter } from '../../adapter-gen/codegen.js';
import { buildPlugin, type AdapterFile } from '../../adapter-gen/builder.js';

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, resolve));
}

async function interactiveConfirm(
  commands: SuggestedCommand[]
): Promise<SuggestedCommand[] | null> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log(chalk.cyan('\n📋 Suggested commands:\n'));
    commands.forEach((cmd, i) => {
      const tag = cmd.is_write ? chalk.yellow('[write]') : chalk.green('[read]');
      console.log(`  ${i + 1}. ${chalk.bold(cmd.name)} ${tag} — ${cmd.description}`);
    });

    console.log(chalk.dim('\n  [Enter] Accept all  [e] Edit  [q] Quit\n'));
    const choice = await ask(rl, '> ');

    if (choice.toLowerCase() === 'q') return null;

    if (choice.toLowerCase() === 'e') {
      const removeStr = await ask(rl, 'Remove command numbers (comma-separated, or Enter to skip): ');
      if (removeStr.trim()) {
        const removeNums = removeStr.split(',').map(s => parseInt(s.trim()) - 1);
        commands = commands.filter((_, i) => !removeNums.includes(i));
      }

      const addStr = await ask(rl, 'Add command (name — description, or Enter to skip): ');
      if (addStr.trim()) {
        const [name, desc] = addStr.split('—').map(s => s.trim());
        if (name) {
          commands.push({
            name: name.toLowerCase().replace(/\s+/g, '-'),
            description: desc || name,
            strategy: 'cookie',
            args: [],
            columns: [],
            is_write: false,
          });
        }
      }

      console.log(chalk.cyan('\n📋 Updated commands:\n'));
      commands.forEach((cmd, i) => {
        const tag = cmd.is_write ? chalk.yellow('[write]') : chalk.green('[read]');
        console.log(`  ${i + 1}. ${chalk.bold(cmd.name)} ${tag} — ${cmd.description}`);
      });

      console.log('');
      const confirm = await ask(rl, 'Confirm? [Enter=yes, q=quit] ');
      if (confirm.toLowerCase() === 'q') return null;
    }

    return commands;
  } finally {
    rl.close();
  }
}

cli({
  site: 'adapter',
  name: 'generate',
  description: 'Auto-generate adapters for a website using OpenAI',
  domain: '',
  strategy: Strategy.PUBLIC,
  browser: true,
  args: [
    { name: 'url', required: true, positional: true, help: 'Website URL to generate adapters for' },
    { name: 'goal', required: false, help: 'Hint: what you want to do on this site' },
  ],
  columns: ['status', 'detail'],
  func: async (page: IPage | null, kwargs: any) => {
    const url: string = kwargs.url;
    const goal: string | undefined = kwargs.goal;

    // Step 1: Explore
    console.log(chalk.cyan('\n🔍 Exploring site...'));
    console.log(chalk.dim(`   Opening ${url} in Chrome...`));
    const snapshot = await exploreSite(url);
    console.log(chalk.dim(`   Title: ${snapshot.title}`));

    // Step 2: Analyze
    console.log(chalk.cyan('\n🤖 Analyzing with OpenAI...'));
    const analysis = await analyzeSite(snapshot, goal);
    console.log(chalk.dim(`   Detected: ${analysis.site_description}`));

    // Step 3: User confirm
    const confirmed = await interactiveConfirm(analysis.commands);
    if (!confirmed || confirmed.length === 0) {
      return [{ status: 'cancelled', detail: 'User cancelled generation' }];
    }

    // Step 4: Generate code
    console.log(chalk.cyan('\n⚙️  Generating TypeScript adapters...'));
    const adapterFiles: AdapterFile[] = [];

    for (const cmd of confirmed) {
      try {
        const code = await generateAdapter(
          analysis.site_name,
          analysis.domain,
          cmd,
          snapshot.snapshot
        );
        adapterFiles.push({
          commandName: cmd.name,
          code,
          isWrite: cmd.is_write,
        });
        console.log(chalk.green(`   ✅ ${cmd.name}.ts`));
      } catch (err: any) {
        console.log(chalk.red(`   ❌ ${cmd.name}.ts — ${err.message}`));
      }
    }

    if (adapterFiles.length === 0) {
      return [{ status: 'failed', detail: 'No adapters generated successfully' }];
    }

    // Step 5: Build & install
    console.log(chalk.cyan('\n📦 Compiling...'));
    const pluginDir = buildPlugin(analysis.site_name, url, adapterFiles);
    console.log(chalk.green(`   ✅ Plugin installed: auto-${analysis.site_name} (${adapterFiles.length} commands)`));
    console.log(chalk.dim(`   Location: ${pluginDir}`));
    console.log(chalk.cyan(`\nDone! Try: opencli ${analysis.site_name} ${confirmed[0].name}\n`));

    return [{
      status: 'success',
      detail: `Generated ${adapterFiles.length} commands for ${analysis.site_name}`,
    }];
  },
});
```

**Step 2: Verify build**

Run: `cd /Users/yibu/dev_workspace/github.com/opencli && npm run build`
Expected: Build succeeds with 333+ entries (332 + 1 new generate command)

**Step 3: Verify command shows in help**

Run: `opencli adapter generate --help`
Expected: Shows usage with url argument and --goal option

**Step 4: Commit**

```bash
git add src/clis/adapter/generate.ts
git commit -m "feat: add opencli generate command for LLM-driven adapter generation"
```

---

### Task 9: Create adapter check command

**Files:**
- Create: `src/adapter-gen/meta.ts`
- Create: `src/clis/adapter/check.ts`

**Step 1: Write metadata helper**

```typescript
/**
 * Read and write adapter-meta.json for auto-generated plugins.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { AdapterMeta } from './builder.js';

const PLUGINS_DIR = path.join(os.homedir(), '.opencli', 'plugins');

export function listAutoPlugins(): Array<{ name: string; dir: string; meta: AdapterMeta }> {
  const results: Array<{ name: string; dir: string; meta: AdapterMeta }> = [];
  if (!fs.existsSync(PLUGINS_DIR)) return results;

  for (const entry of fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('auto-')) continue;
    const metaPath = path.join(PLUGINS_DIR, entry.name, 'adapter-meta.json');
    if (!fs.existsSync(metaPath)) continue;
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as AdapterMeta;
    results.push({
      name: entry.name.replace(/^auto-/, ''),
      dir: path.join(PLUGINS_DIR, entry.name),
      meta,
    });
  }

  return results;
}

export function updateCheckResult(
  pluginDir: string,
  commandName: string,
  status: 'ok' | 'broken',
  error?: string
): void {
  const metaPath = path.join(pluginDir, 'adapter-meta.json');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as AdapterMeta;
  if (meta.checks[commandName]) {
    meta.checks[commandName] = {
      last_check: new Date().toISOString(),
      status,
      ...(error ? { reason: error } : {}),
    };
  }
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
}
```

**Step 2: Write the check command**

```typescript
/**
 * opencli adapter check — Health check auto-generated adapters.
 * Runs read-only commands and validates results.
 */
import { execSync } from 'node:child_process';
import chalk from 'chalk';

import { cli, Strategy } from '../../registry.js';
import { listAutoPlugins, updateCheckResult } from '../../adapter-gen/meta.js';

cli({
  site: 'adapter',
  name: 'check',
  description: 'Health check auto-generated adapters',
  domain: '',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'site', required: false, positional: true, help: 'Check specific site (or all)' },
  ],
  columns: ['site', 'command', 'status', 'detail'],
  func: async (_page, kwargs) => {
    const plugins = listAutoPlugins();
    if (plugins.length === 0) {
      console.log(chalk.dim('No auto-generated adapters found.'));
      return [];
    }

    const targetSite = kwargs.site as string | undefined;
    const results: Array<{ site: string; command: string; status: string; detail: string }> = [];

    for (const plugin of plugins) {
      if (targetSite && plugin.name !== targetSite) continue;

      for (const cmdName of plugin.meta.commands) {
        const checkInfo = plugin.meta.checks[cmdName];

        // Skip write commands
        if (checkInfo?.status === 'skipped') {
          results.push({
            site: plugin.name,
            command: cmdName,
            status: '⏭️ skipped',
            detail: checkInfo.reason || 'write command',
          });
          continue;
        }

        // Run the command with json output and a limit
        try {
          const output = execSync(
            `opencli ${plugin.name} ${cmdName} --limit 1 -f json 2>&1`,
            { timeout: 30_000, encoding: 'utf-8' }
          );
          const data = JSON.parse(output);
          if (Array.isArray(data) && data.length > 0) {
            updateCheckResult(plugin.dir, cmdName, 'ok');
            results.push({
              site: plugin.name,
              command: cmdName,
              status: '✅ ok',
              detail: `${data.length} result(s)`,
            });
          } else {
            updateCheckResult(plugin.dir, cmdName, 'broken', 'empty result');
            results.push({
              site: plugin.name,
              command: cmdName,
              status: '❌ broken',
              detail: 'Empty result',
            });
          }
        } catch (err: any) {
          updateCheckResult(plugin.dir, cmdName, 'broken', err.message?.slice(0, 100));
          results.push({
            site: plugin.name,
            command: cmdName,
            status: '❌ broken',
            detail: err.message?.slice(0, 80) || 'Unknown error',
          });
        }
      }
    }

    return results;
  },
});
```

**Step 3: Verify build**

Run: `cd /Users/yibu/dev_workspace/github.com/opencli && npm run build`
Expected: Build succeeds with 334+ entries

**Step 4: Commit**

```bash
git add src/adapter-gen/meta.ts src/clis/adapter/check.ts
git commit -m "feat: add adapter check command for health monitoring"
```

---

### Task 10: Create adapter status command

**Files:**
- Create: `src/clis/adapter/status.ts`

**Step 1: Write the status command**

```typescript
/**
 * opencli adapter status — Show status of all auto-generated adapters.
 */
import chalk from 'chalk';

import { cli, Strategy } from '../../registry.js';
import { listAutoPlugins } from '../../adapter-gen/meta.js';

cli({
  site: 'adapter',
  name: 'status',
  description: 'Show status of auto-generated adapters',
  domain: '',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [],
  columns: ['site', 'url', 'commands', 'generated_at', 'last_check', 'health'],
  func: async () => {
    const plugins = listAutoPlugins();
    if (plugins.length === 0) {
      console.log(chalk.dim('No auto-generated adapters found. Use: opencli adapter generate <url>'));
      return [];
    }

    return plugins.map(p => {
      const checkStatuses = Object.values(p.meta.checks);
      const broken = checkStatuses.filter(c => c.status === 'broken').length;
      const ok = checkStatuses.filter(c => c.status === 'ok').length;
      const lastCheck = checkStatuses
        .map(c => c.last_check)
        .filter(Boolean)
        .sort()
        .pop() || 'never';

      let health = '⚪ unchecked';
      if (broken > 0) health = `🔴 ${broken} broken`;
      else if (ok > 0) health = '🟢 healthy';

      return {
        site: p.name,
        url: p.meta.url,
        commands: p.meta.commands.length,
        generated_at: p.meta.generated_at.split('T')[0],
        last_check: lastCheck === 'never' ? lastCheck : lastCheck.split('T')[0],
        health,
      };
    });
  },
});
```

**Step 2: Verify build**

Run: `cd /Users/yibu/dev_workspace/github.com/opencli && npm run build`
Expected: Build succeeds with 335+ entries

**Step 3: Commit**

```bash
git add src/clis/adapter/status.ts
git commit -m "feat: add adapter status command to display generated adapter health"
```

---

### Task 11: End-to-end test

**Step 1: Rebuild and link**

```bash
cd /Users/yibu/dev_workspace/github.com/opencli
npm run build
chmod +x dist/main.js
```

**Step 2: Verify all new commands appear**

Run: `opencli adapter --help`
Expected: Shows generate, check, status subcommands

**Step 3: Run generate on a real site**

```bash
opencli adapter generate https://news.ycombinator.com --goal "top stories, search"
```

- Confirm the interactive flow works
- Confirm adapters are written to `~/.opencli/plugins/auto-hackernews/`
- Run `opencli list` and confirm new commands appear
- Run the generated command (e.g. `opencli hackernews-auto top`)

**Step 4: Run health check**

```bash
opencli adapter check
opencli adapter status
```

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete auto-adapter system — generate, check, status"
```
