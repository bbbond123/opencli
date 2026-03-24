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
