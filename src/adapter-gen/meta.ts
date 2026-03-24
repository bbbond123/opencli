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
