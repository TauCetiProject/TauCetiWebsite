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
fs.mkdirSync(path.join(data, 'static'));
const progress = {
  cutoff: '2026-11-15T00:34:40Z', exported_at: '2026-11-15T00:34:40Z',
  weeks: ['2026-10-26', '2026-11-02', '2026-11-09'],
  global: {weekly: [4164, 5378, 7412]},
};
fs.writeFileSync(path.join(data, 'static/progress.json'), JSON.stringify(progress));
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
  // A Sunday snapshot includes the current week's queue merges, explicitly marked partial.
  const weeklyHit = page.locator('#weekly rect[tabindex="0"]');
  const weeklyTooltip = page.locator('#weekly .tooltip');
  await weeklyHit.focus();
  assert.match(await weeklyTooltip.innerText(), /9 Nov 2026.*7,412.*Partial/s);
  assert.match(await page.locator('#weekly-sub').innerText(), /week starting 9 Nov 2026 is partial.*Bors and AI queue/s);
  await weeklyHit.press('ArrowLeft');
  assert.match(await weeklyTooltip.innerText(), /2 Nov 2026.*5,378.*Complete/s);
  await weeklyHit.press('ArrowRight');
  assert.match(await weeklyTooltip.innerText(), /7,412.*Partial/s);
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

  // At the next Monday boundary that same bucket is complete, without losing its count.
  progress.cutoff = '2026-11-16T00:00:00Z';
  fs.writeFileSync(path.join(output, 'static/progress.json'), JSON.stringify(progress));
  await page.reload();
  await weeklyHit.focus();
  assert.match(await weeklyTooltip.innerText(), /9 Nov 2026.*7,412.*Complete/s);
  assert.doesNotMatch(await page.locator('#weekly-sub').innerText(), /partial/);
  assert.deepEqual(errors, []);
  console.log('browser: migrated audit rows, weekly merges including partial weeks, keyboard/touch tooltips, range selection and unavailable baseline passed');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(temp, {recursive: true, force: true});
}
