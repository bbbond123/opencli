/**
 * opencli adapter check — Health check auto-generated adapters.
 */
import { execSync } from 'node:child_process';
import chalk from 'chalk';

import { cli, Strategy } from '../../registry.js';
import { listAutoPlugins, updateCheckResult } from '../../adapter-gen/meta.js';

cli({
  site: 'adapter',
  name: 'check',
  description: 'Health check auto-generated adapters',
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

        if (checkInfo?.status === 'skipped') {
          results.push({
            site: plugin.name,
            command: cmdName,
            status: '⏭️ skipped',
            detail: checkInfo.reason || 'write command',
          });
          continue;
        }

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
