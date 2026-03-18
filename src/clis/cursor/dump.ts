import { cli, Strategy } from '../../registry.js';
import * as fs from 'fs';

export const dumpCommand = cli({
  site: 'cursor',
  name: 'dump',
  description: 'Dump the DOM and Accessibility tree of Cursor for reverse-engineering',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  columns: ['action', 'files'],
  func: async (page) => {
    // Extract full HTML
    const dom = await page.evaluate('document.body.innerHTML');
    fs.writeFileSync('/tmp/cursor-dom.html', dom);

    // Get accessibility snapshot
    const snap = await page.snapshot({ interactive: false });
    fs.writeFileSync('/tmp/cursor-snapshot.json', JSON.stringify(snap, null, 2));

    return [
      {
        action: 'Dom extraction finished',
        files: '/tmp/cursor-dom.html, /tmp/cursor-snapshot.json',
      },
    ];
  },
});
