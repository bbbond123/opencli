/**
 * opencli adapter generate <url> — Auto-generate adapters for a website using OpenAI.
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
          const newCmd: SuggestedCommand = {
            name: name.toLowerCase().replace(/\s+/g, '-'),
            description: desc || name,
            strategy: 'cookie',
            columns: [],
            is_write: false,
          } as unknown as SuggestedCommand;
          newCmd.args = [];
          commands.push(newCmd);
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
  strategy: Strategy.PUBLIC,
  browser: true,
  args: [
    { name: 'url', required: true, positional: true, help: 'Website URL to generate adapters for' },
    { name: 'goal', required: false, help: 'Hint: what you want to do on this site' },
  ],
  columns: ['status', 'detail'],
  func: async (_page: IPage | null, kwargs: any) => {
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
