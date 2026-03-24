/**
 * Twitter post command — UI automation with optional image attachment.
 *
 * Usage:
 *   opencli twitter post "Hello world"
 *   opencli twitter post "Check this out" --image /path/to/photo.jpg
 *   opencli twitter post "From the web" --image https://example.com/photo.jpg
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as https from 'node:https';
import * as http from 'node:http';

import { cli, Strategy } from '../../registry.js';
import type { IPage } from '../../types.js';

type ImagePayload = { name: string; mimeType: string; base64: string };

const MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/**
 * Read a local image file and return base64 payload.
 */
function readLocalImage(filePath: string): ImagePayload {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) throw new Error(`Image file not found: ${absPath}`);
  const ext = path.extname(absPath).toLowerCase();
  const mimeType = MIME_MAP[ext];
  if (!mimeType) throw new Error(`Unsupported image format "${ext}". Supported: jpg, png, gif, webp`);
  const base64 = fs.readFileSync(absPath).toString('base64');
  return { name: path.basename(absPath), mimeType, base64 };
}

/**
 * Download an image from URL and return base64 payload.
 */
function downloadImage(url: string): Promise<ImagePayload> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;

    const request = (currentUrl: string, redirectCount = 0) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'));
        return;
      }

      client.get(currentUrl, (res) => {
        // Handle redirects
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          request(res.headers.location, redirectCount + 1);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`Failed to download image: HTTP ${res.statusCode}`));
          return;
        }

        const contentType = res.headers['content-type'] || 'image/jpeg';
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const base64 = buffer.toString('base64');

          // Derive filename and mime from URL or content-type
          let ext = '.jpg';
          if (contentType.includes('png')) ext = '.png';
          else if (contentType.includes('gif')) ext = '.gif';
          else if (contentType.includes('webp')) ext = '.webp';

          const mimeType = MIME_MAP[ext] || 'image/jpeg';
          const name = `image${ext}`;

          resolve({ name, mimeType, base64 });
        });
        res.on('error', reject);
      }).on('error', reject);
    };

    request(url);
  });
}

/**
 * Resolve an image source (local path or URL) to a base64 payload.
 */
async function resolveImage(source: string): Promise<ImagePayload> {
  const src = String(source).trim();
  if (src.startsWith('http://') || src.startsWith('https://')) {
    return downloadImage(src);
  }
  return readLocalImage(src);
}

/**
 * Inject image into Twitter's compose file input via DataTransfer.
 */
async function injectImageToComposer(page: IPage, image: ImagePayload): Promise<{ ok: boolean; error?: string }> {
  const payload = JSON.stringify(image);
  return page.evaluate(`(async () => {
    try {
      const img = ${payload};

      // Find the file input for media upload
      const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
      const input = inputs.find(el => {
        const accept = el.getAttribute('accept') || '';
        return accept.includes('image') || accept.includes('video');
      }) || inputs[0];

      if (!input) return { ok: false, error: 'No file input found in tweet composer' };

      const binary = atob(img.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const blob = new Blob([bytes], { type: img.mimeType });
      const file = new File([blob], img.name, { type: img.mimeType });

      const dt = new DataTransfer();
      dt.items.add(file);

      Object.defineProperty(input, 'files', { value: dt.files, writable: false });
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('input', { bubbles: true }));

      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.toString() };
    }
  })()`);
}

/**
 * Wait for the image thumbnail to appear in the composer.
 */
async function waitForImageAttached(page: IPage, maxWaitMs = 15_000): Promise<boolean> {
  const pollMs = 1_500;
  const maxAttempts = Math.ceil(maxWaitMs / pollMs);
  for (let i = 0; i < maxAttempts; i++) {
    const attached: boolean = await page.evaluate(`
      () => {
        // Twitter shows attached media in a container with specific testids
        const media = document.querySelector(
          '[data-testid="attachments"] img, ' +
          '[data-testid="mediaPreview"], ' +
          '[data-testid*="image"], ' +
          '[aria-label*="media" i] img, ' +
          '.r-1niwhzg img'
        );
        return !!media;
      }
    `);
    if (attached) return true;
    await page.wait({ time: pollMs / 1_000 });
  }
  return false;
}

cli({
  site: 'twitter',
  name: 'post',
  description: 'Post a new tweet/thread',
  domain: 'x.com',
  strategy: Strategy.UI,
  browser: true,
  args: [
    { name: 'text', type: 'string', required: true, positional: true, help: 'The text content of the tweet' },
    { name: 'image', type: 'string', required: false, help: 'Image to attach: local file path or URL' },
  ],
  columns: ['status', 'message', 'text'],
  func: async (page: IPage | null, kwargs: any) => {
    if (!page) throw new Error('Requires browser');

    // Resolve image before navigating (fast-fail on bad path/URL)
    let imageData: ImagePayload | null = null;
    if (kwargs.image) {
      imageData = await resolveImage(kwargs.image);
    }

    // 1. Navigate directly to the compose tweet modal
    await page.goto('https://x.com/compose/tweet');
    await page.wait(3); // Wait for the modal and React app to hydrate

    // 2. Inject image if provided
    if (imageData) {
      const inject = await injectImageToComposer(page, imageData);
      if (!inject.ok) {
        return [{
          status: 'failed',
          message: `Image injection failed: ${inject.error}`,
          text: kwargs.text
        }];
      }

      // Wait for the image to be processed and show as thumbnail
      const attached = await waitForImageAttached(page);
      if (!attached) {
        return [{
          status: 'failed',
          message: 'Image was injected but thumbnail did not appear. Upload may have failed.',
          text: kwargs.text
        }];
      }

      // Extra settle time for upload to complete
      await page.wait(2);
    }

    // 3. Type the tweet text
    const result = await page.evaluate(`(async () => {
        try {
            // Find the active text area
            const box = document.querySelector('[data-testid="tweetTextarea_0"]');
            if (box) {
                box.focus();
                // Simulate a paste event to properly handle newlines in Draft.js/React
                const textToInsert = ${JSON.stringify(kwargs.text)};
                const dataTransfer = new DataTransfer();
                dataTransfer.setData('text/plain', textToInsert);
                box.dispatchEvent(new ClipboardEvent('paste', {
                    clipboardData: dataTransfer,
                    bubbles: true,
                    cancelable: true
                }));
            } else {
                return { ok: false, message: 'Could not find the tweet composer text area.' };
            }

            // Wait a brief moment for the button state to update
            await new Promise(r => setTimeout(r, 1000));

            // Click the post button
            const btn = document.querySelector('[data-testid="tweetButton"]');
            if (btn && !btn.disabled) {
                btn.click();
                return { ok: true, message: 'Tweet posted successfully.' };
            } else {
                // Sometimes it's rendered inline depending on the viewport
                const inlineBtn = document.querySelector('[data-testid="tweetButtonInline"]');
                if (inlineBtn && !inlineBtn.disabled) {
                    inlineBtn.click();
                    return { ok: true, message: 'Tweet posted successfully.' };
                }
                return { ok: false, message: 'Tweet button is disabled or not found.' };
            }
        } catch (e) {
            return { ok: false, message: e.toString() };
        }
    })()`);

    // 4. Wait for the network request to finish sending
    if (result.ok) {
        await page.wait(3);
    }

    return [{
        status: result.ok ? 'success' : 'failed',
        message: result.message + (imageData ? ' (with image)' : ''),
        text: kwargs.text
    }];
  }
});
