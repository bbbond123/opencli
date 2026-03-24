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

export function buildPlugin(
  siteName: string,
  url: string,
  adapters: AdapterFile[]
): string {
  const pluginName = `auto-${siteName}`;
  const pluginDir = path.join(PLUGINS_DIR, pluginName);

  fs.mkdirSync(path.join(pluginDir, 'src'), { recursive: true });

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

  for (const adapter of adapters) {
    const tsPath = path.join(pluginDir, 'src', `${adapter.commandName}.ts`);
    fs.writeFileSync(tsPath, adapter.code);
  }

  // Symlink host opencli into plugin node_modules
  const nmDir = path.join(pluginDir, 'node_modules', '@jackwener');
  fs.mkdirSync(nmDir, { recursive: true });
  const symlinkTarget = path.join(nmDir, 'opencli');
  if (!fs.existsSync(symlinkTarget)) {
    const hostRoot = path.resolve(import.meta.dirname, '..', '..');
    fs.symlinkSync(hostRoot, symlinkTarget, 'dir');
  }

  // Compile TS → JS with esbuild (use host project's esbuild)
  const hostRoot = path.resolve(import.meta.dirname, '..', '..');
  const esbuildBin = path.join(hostRoot, 'node_modules', '.bin', 'esbuild');
  for (const adapter of adapters) {
    const tsFile = path.join(pluginDir, 'src', `${adapter.commandName}.ts`);
    const jsFile = path.join(pluginDir, `${adapter.commandName}.js`);
    execSync(
      `"${esbuildBin}" "${tsFile}" --bundle --outfile="${jsFile}" --format=esm --platform=node --external:@jackwener/opencli`,
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
