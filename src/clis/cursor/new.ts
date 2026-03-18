import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

export const newCommand = cli({
  site: 'cursor',
  name: 'new',
  description: 'Start a new Cursor chat or Composer session',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  columns: ['Status'],
  func: async (page: IPage) => {
    const success = await page.evaluate(`
      (function() {
        const newChatButton = document.querySelector('[aria-label="New Chat"], [aria-label="New Chat (⌘N)"], .agent-sidebar-new-agent-button');
        if (newChatButton) {
            newChatButton.click();
            return true;
        }
        return false;
      })()
    `);

    if (!success) {
      throw new Error('Could not find New Chat button in Cursor DOM.');
    }

    await page.wait(1);

    return [{ Status: 'Success' }];
  },
});
