import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

export const composerCommand = cli({
  site: 'cursor',
  name: 'composer',
  description: 'Send a prompt directly into Cursor Composer (Cmd+I shortcut)',
  domain: 'localhost',
  strategy: Strategy.UI,
  browser: true,
  args: [{ name: 'text', required: true, positional: true, help: 'Text to send into Composer' }],
  columns: ['Status', 'InjectedText'],
  func: async (page: IPage, kwargs: any) => {
    const textToInsert = kwargs.text as string;

    const injected = await page.evaluate(
      `(async function() {
        let isComposerVisible = document.querySelector('.composer-bar') !== null || document.querySelector('#composer-toolbar-section') !== null;
        return isComposerVisible;
      })()`
    );

    if (!injected) {
      await page.pressKey('Meta+I');
      await page.wait(1.0);
    } else {
      // Just focus it if it's open but unfocused (we can't easily know if it's focused without triggering something)
      await page.pressKey('Meta+I');
      await page.wait(0.2);
      const isStillVisible = await page.evaluate('document.querySelector(".composer-bar") !== null');
      if (!isStillVisible) {
        await page.pressKey('Meta+I'); // Re-open
        await page.wait(0.5);
      }
    }

    const typed = await page.evaluate(
      `(function(text) {
        let composer = document.querySelector('.composer-bar [data-lexical-editor="true"], [id*="composer"] [contenteditable="true"], .aislash-editor-input');
        
        if (!composer) {
            composer = document.activeElement;
            if (!composer || !composer.isContentEditable) {
                return false;
            }
        }

        composer.focus();
        document.execCommand('insertText', false, text);
        return true;
      })(${JSON.stringify(textToInsert)})`
    );

    if (!typed) {
      throw new Error('Could not find Cursor Composer input element after pressing Cmd+I.');
    }

    // Submit the command. In Cursor Composer, Enter usually submits if it's not a multi-line edit.
    // Sometimes Cmd+Enter is needed? We'll just submit standard Enter.
    await page.wait(0.5);
    await page.pressKey('Enter');
    await page.wait(1);

    return [
      {
        Status: 'Success (Composer)',
        InjectedText: textToInsert,
      },
    ];
  },
});
