import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const target = process.env.NVM_UI_URL || 'http://127.0.0.1:8765/tests/ui/';
const output = path.join(root, 'qa/live');
const browserCandidates = [
  process.env.NVM_UI_BROWSER,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome-stable'
].filter(Boolean);
const executablePath = browserCandidates.find((candidate) => fs.existsSync(candidate));

function parsePo(source) {
  const translations = {};
  let id = '';
  let value = '';
  let field = '';

  function flush() {
    if (id && value)
      translations[id] = value;
    id = '';
    value = '';
    field = '';
  }

  for (const line of source.split(/\r?\n/)) {
    if (line.startsWith('msgid ')) {
      flush();
      field = 'id';
      id = JSON.parse(line.slice(6));
    } else if (line.startsWith('msgstr ')) {
      field = 'value';
      value = JSON.parse(line.slice(7));
    } else if (line.startsWith('"')) {
      const part = JSON.parse(line);
      if (field == 'id') id += part;
      if (field == 'value') value += part;
    } else if (!line.trim()) {
      flush();
    }
  }
  flush();
  return translations;
}

async function layoutReport(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const viewportWidth = root.clientWidth;
    const overflow = Array.from(document.querySelectorAll('.nvm-dashboard *'))
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          tag: node.tagName,
          className: String(node.className || ''),
          left: rect.left,
          right: rect.right
        };
      })
      .filter((item) => item.left < -1 || item.right > viewportWidth + 1);
    const internalScroll = Array.from(document.querySelectorAll('.nvm-dashboard *'))
      .filter((node) => {
        const style = getComputedStyle(node);
        return /(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
      })
      .map((node) => ({ tag: node.tagName, className: String(node.className || '') }));
    return {
      viewportWidth,
      scrollWidth: root.scrollWidth,
      horizontalOverflow: root.scrollWidth > viewportWidth + 1,
      overflow,
      internalScroll
    };
  });
}

async function exercise(page, language) {
  await page.goto(target, { waitUntil: 'networkidle' });
  await page.locator('.nvm-dashboard').waitFor();
  await page.locator('#nvm-state-title').waitFor();
  await page.locator('.nvm-server-row').first().waitFor();

  const expectedState = language == 'es' ? 'Conectado' : 'Connected';
  assert.equal((await page.locator('#nvm-state-title').textContent()).trim(), expectedState);
  assert.equal(await page.locator('.nvm-switch input[role="switch"]').count(), 2);
  assert.equal(await page.locator('#nvm-connect, #nvm-disconnect').count(), 0);
  assert.equal(await page.locator('.nvm-server-row').count() > 0, true);

  const pageTitle = page.locator('.nvm-dashboard > h2.nvm-page-title');
  assert.equal(await pageTitle.count(), 1);
  const titleStyle = await pageTitle.evaluate((node) => {
    const style = getComputedStyle(node);
    return { borderLeftWidth: style.borderLeftWidth, fontSize: style.fontSize, lineHeight: style.lineHeight };
  });
  assert.deepEqual(titleStyle, { borderLeftWidth: '3px', fontSize: '22px', lineHeight: '26px' });

  await page.locator('#nvm-kill-toggle').click();
  await page.locator('#modal.open').waitFor();
  const disableLabel = language == 'es' ? 'Desactivar' : 'Disable';
  await page.getByRole('button', { name: disableLabel, exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#nvm-kill-toggle').checked);
  await page.locator('#nvm-kill-toggle').click();
  await page.waitForFunction(() => document.querySelector('#nvm-kill-toggle').checked);

  const rows = page.locator('.nvm-server-row');
  await rows.nth(1).click();
  await page.waitForFunction(() => document.querySelectorAll('.nvm-server-row')[1].classList.contains('is-selected'));
  await page.waitForFunction(() => document.querySelector('#nvm-connection-toggle').checked);

  const disconnectLabel = language == 'es' ? 'Desconectar' : 'Disconnect';
  const cancelLabel = language == 'es' ? 'Cancelar' : 'Cancel';
  await page.locator('#nvm-connection-toggle').click();
  await page.locator('#modal.open').waitFor();
  assert.equal(await page.locator('#nvm-connection-toggle').isChecked(), true);
  await page.locator('#modal-panel').getByRole('button', { name: cancelLabel, exact: true }).click();
  await page.locator('#modal.open').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#nvm-connection-toggle').isChecked(), true);

  await page.locator('#nvm-connection-toggle').click();
  await page.locator('#modal.open').waitFor();
  await page.locator('#modal-panel').getByRole('button', { name: disconnectLabel, exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('#nvm-connection-toggle').checked && !document.querySelector('#nvm-settings').disabled);

  const editLabel = language == 'es' ? 'Editar' : 'Edit';
  await page.getByRole('button', { name: editLabel, exact: true }).click();
  await page.locator('.nvm-settings-form').waitFor();

  await page.locator('#nvm-connection-toggle').click();
  await page.waitForFunction(() => document.querySelector('#nvm-connection-toggle').checked &&
    document.querySelector('#nvm-settings').disabled &&
    document.querySelector('.nvm-dashboard').getAttribute('aria-busy') == 'false');
  await page.locator('.notice').last().waitFor({ state: 'detached' });

  const report = await layoutReport(page);
  assert.equal(report.horizontalOverflow, false, JSON.stringify(report));
  assert.deepEqual(report.overflow, [], JSON.stringify(report));
  assert.deepEqual(report.internalScroll, [], JSON.stringify(report));
  return report;
}

fs.mkdirSync(output, { recursive: true });
const spanish = parsePo(fs.readFileSync(path.join(root, 'po/es/nordvpn-manager.po'), 'utf8'));
const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {})
});
const runs = [
  { name: 'desktop-light-en', width: 1440, height: 1000, scheme: 'light', language: 'en' },
  { name: 'desktop-dark-es', width: 1440, height: 1000, scheme: 'dark', language: 'es' },
  { name: 'mobile-light-es', width: 390, height: 844, scheme: 'light', language: 'es', mobile: true },
  { name: 'mobile-dark-en', width: 390, height: 844, scheme: 'dark', language: 'en', mobile: true }
];

try {
  for (const run of runs) {
    const context = await browser.newContext({
      viewport: { width: run.width, height: run.height },
      colorScheme: run.scheme,
      isMobile: !!run.mobile,
      hasTouch: !!run.mobile
    });
    if (run.language == 'es')
      await context.addInitScript((values) => { window.__NVM_TRANSLATIONS = values; }, spanish);
    const page = await context.newPage();
    const report = await exercise(page, run.language);
    await page.screenshot({ path: path.join(output, `${run.name}.png`), fullPage: true });
    console.log(`${run.name}: ${JSON.stringify(report)}`);
    await context.close();
  }
} finally {
  await browser.close();
}

console.log('NordVPN Manager UI QA passed.');
