const fs = require('node:fs');
const { test, expect } = require('@playwright/test');

const MOCK_URL = 'http://127.0.0.1:3132';

async function generate(page, prompt = 'A test landing page for a mock site') {
  await page.goto('/');
  await expect(page.locator('#mode')).toContainText('openai');
  await page.fill('#prompt', prompt);
  await page.click('#gen-form button[type="submit"]');
  await page.waitForURL(/\/editor\?id=[a-f0-9]{24}$/);
  await expect(page.locator('#status')).toContainText('Ready', { timeout: 20000 });
  return page.frameLocator('iframe.gjs-frame');
}

async function editHeading(page, frame, text) {
  await frame.locator('h1').dblclick();
  await page.waitForTimeout(300);
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(text);
  await frame.locator('body').click({ position: { x: 4, y: 4 } });
  await expect(page.locator('#status')).toContainText('Unsaved changes');
}

test('generate, edit text, save, reload and download', async ({ page }) => {
  const frame = await generate(page);
  await expect(frame.locator('h1')).toHaveText('Mock generated site');
  expect(await frame.locator('body').evaluate(() => window.__pwned)).toBeUndefined();
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();

  await editHeading(page, frame, 'Edited by Playwright');
  await page.click('#save');
  await expect(page.locator('#status')).toHaveText(/Saved/, { timeout: 15000 });

  await page.reload();
  await expect(page.locator('#status')).toContainText('Ready', { timeout: 20000 });
  await expect(page.frameLocator('iframe.gjs-frame').locator('h1')).toHaveText('Edited by Playwright');

  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
  expect(download.suggestedFilename()).toBe('website.html');
  const html = fs.readFileSync(await download.path(), 'utf8');
  expect(html).toContain('<!doctype html>');
  expect(html).toContain('Edited by Playwright');
  expect(html).not.toContain('<script');
});

test('import an existing HTML document', async ({ page }) => {
  await page.goto('/');
  await page.click('details summary');
  await page.fill(
    '#html-input',
    '<!doctype html><html><head><title>Imported</title><style>h1{color:teal}</style>' +
      '<script>window.__pwned = "imported"</script></head>' +
      '<body><h1>Imported by test</h1><p>Existing content</p></body></html>',
  );
  await page.click('#import-form button[type="submit"]');
  await page.waitForURL(/\/editor\?id=[a-f0-9]{24}$/);
  await expect(page.locator('#status')).toContainText('Ready', { timeout: 20000 });
  const frame = page.frameLocator('iframe.gjs-frame');
  await expect(frame.locator('h1')).toHaveText('Imported by test');
  expect(await frame.locator('body').evaluate(() => window.__pwned)).toBeUndefined();
});

test('AI refinement receives unsaved canvas edits', async ({ page }) => {
  const frame = await generate(page);
  await editHeading(page, frame, 'Unsaved refine marker');

  await page.click('#refine');
  await page.fill('#instruction', 'Make the heading refined');
  await page.click('#apply');
  const refreshed = page.frameLocator('iframe.gjs-frame');
  await expect(refreshed.locator('h1')).toHaveText('Refined by mock', { timeout: 30000 });

  const last = await (await fetch(`${MOCK_URL}/__last`)).json();
  const userMessage = last.messages.at(-1).content;
  expect(userMessage).toContain('Unsaved refine marker');
  expect(userMessage).toContain('Make the heading refined');
});

test('rejects a project id that does not exist', async ({ page }) => {
  await page.goto('/editor?id=000000000000000000000000');
  await expect(page.locator('#boot')).toContainText('Project not found');
});
