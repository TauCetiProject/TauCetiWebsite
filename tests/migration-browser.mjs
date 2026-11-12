import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tauceti-migration-'));
const output = path.join(temp, 'site'), data = path.join(temp, 'data');
fs.mkdirSync(data);
const dates = Array.from({length: 60}, (_, i) => new Date(Date.UTC(2026, 9, i + 1)).toISOString().slice(0, 10));
fs.writeFileSync(path.join(data, 'library-loc.json'), JSON.stringify({dates, lines: dates.map((_, i) => 5000000 + i * 1000), generated_at: '2026-11-30T00:00:00Z'}));
fs.writeFileSync(path.join(data, 'mathlib-baseline.json'), JSON.stringify({ref: 'a'.repeat(40), lines: 1000000}));
const build = spawnSync('python3', ['scripts/build_site.py', '--out', output, '--data', data], {cwd: root, stdio: 'inherit'});
assert.equal(build.status, 0);
const server = createServer((request, response) => {
  let relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  let local = path.join(output, relative);
  if (!local.startsWith(output + path.sep)) { response.writeHead(403).end(); return; }
  try {
    if (fs.statSync(local).isDirectory()) local = path.join(local, 'index.html');
    response.setHeader('Content-Type', local.endsWith('.js') ? 'text/javascript' : local.endsWith('.css') ? 'text/css' : local.endsWith('.json') ? 'application/json' : 'text/html');
    fs.createReadStream(local).pipe(response);
  } catch { response.writeHead(404).end(fs.readFileSync(path.join(output, '404.html'))); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({headless: true});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.goto(url + '/blog/2026-10-28-simple-quality-indicators-for-lean-libraries/');
  const rows = page.getByRole('row').filter({has: page.getByRole('rowheader', {name: 'AxiomMath Stacks', exact: true})});
  assert.equal(await rows.count(), 3);
  assert.match(await rows.nth(0).innerText(), /103\/1,000.*10.3%/);
  assert.match(await rows.nth(1).innerText(), /64\/1,000.*6.4%/);
  assert.match(await rows.nth(2).innerText(), /118\/372.*31.7%/);

  await page.goto(url + '/growth.html');
  const hit = page.locator('#loc rect[tabindex="0"]');
  await hit.focus();
  const tooltip = page.locator('#loc .tooltip');
  assert.match(await tooltip.innerText(), /5,059,000/);
  assert.match(await tooltip.innerText(), /\+1,000.*change since yesterday/s);
  assert.match(await tooltip.innerText(), /\+1,000.*LOC\/day, trailing 7 days/s);
  assert.match(await tooltip.innerText(), /5.06.*× Mathlib/s);
  assert.match(await tooltip.innerText(), /1,000,000 LOC at pinned aaaaaaaaaaaa/);
  await hit.press('ArrowLeft');
  assert.match(await tooltip.innerText(), /5,058,000/);
  await page.locator('#loc').getByRole('button', {name: '30 days'}).click();
  await hit.focus();
  assert.match(await tooltip.innerText(), /\+1,000.*LOC\/day, trailing 7 days/s);
  await page.setViewportSize({width: 390, height: 844});
  await page.locator('#loc svg').waitFor();
  await hit.dispatchEvent('pointermove', {clientX: 210, clientY: 150, pointerType: 'touch'});
  assert.ok(await page.locator('#loc .tooltip').evaluate(n => n.getBoundingClientRect().right <= innerWidth));

  // A retained data build predating the baseline still has usable growth tooltips.
  fs.unlinkSync(path.join(output, 'data/mathlib-baseline.json'));
  await page.reload();
  await hit.focus();
  assert.match(await tooltip.innerText(), /Mathlib baseline unavailable/);
  assert.match(await tooltip.innerText(), /change since yesterday/);
  assert.deepEqual(errors, []);
  console.log('browser: migrated audit rows, keyboard/touch tooltips, range selection and unavailable baseline passed');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(temp, {recursive: true, force: true});
}
