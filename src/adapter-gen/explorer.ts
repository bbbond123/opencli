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

  const meta = (await page.evaluate(`
    (() => ({
      title: document.title || '',
      description: document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
    }))()
  `)) as { title: string; description: string };

  const snap = await page.snapshot({ interactive: true, compact: true, maxDepth: 5 });

  const snapStr = typeof snap === 'string' ? snap : JSON.stringify(snap, null, 2);
  const truncated = snapStr.length > 12000 ? snapStr.slice(0, 12000) + '\n... (truncated)' : snapStr;

  return {
    url,
    title: meta.title,
    description: meta.description,
    snapshot: truncated,
  };
}
