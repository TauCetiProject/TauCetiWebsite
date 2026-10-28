#!/usr/bin/env python3
"""Browser checks for the Mathlib disk (docs/2026-10-26-mathlib-disk-design.md): at rest the map is the live one, a
hover over the sun opens the disk a little, a click opens it round the sun and frames it, a second click closes it
and returns to the opening view; the keyboard and a phone's tap do the same, and reduced motion opens it at once.
An item opens its panel. Runs on the atlas (index.html) unless given another page."""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parents[1]
url = next((arg for arg in sys.argv[1:] if not arg.startswith('--')), (REPO / 'index.html').as_uri())
checks, errors = [], []


def record(name, ok):
    checks.append(name)
    if not ok:
        print(json.dumps({'failedCheck': name, 'checks': checks, 'pageErrors': errors}, indent=2))
        raise AssertionError(name)


SUN = """() => { const g = TauExplorer.graph, box = g.svg.node().getBoundingClientRect(), t = g.transform, c = g.universe.core;
  return [box.left + t.x + c.x * t.k, box.top + t.y + c.y * t.k]; }"""
STATE = """() => { const g = TauExplorer.graph, d = document.querySelector('.tau-disk');
  return { state: g.diskState, transform: d.getAttribute('transform'), display: d.getAttribute('display'), items: document.querySelectorAll('.tau-disk-item').length,
           sectors: document.querySelectorAll('.tau-label-disksector').length, names: document.querySelectorAll('.tau-label-mathlib').length,
           label: document.querySelector('.tau-core-hit').getAttribute('aria-label'), k: g.transform.k, atOverview: g.atOverview() }; }"""
# Closer in round the landmark with the most header items about it, the names of the landmarks there, as placed: how many,
# how many over another landmark's dot, how many over a header item's.
CROWD = """() => { const g = TauExplorer.graph, items = g.universe.disk.items, k = g.diskTransform().k * 4;
  const marks = items.filter(i => i.tier === 1), around = new Map(marks.map(l => [l.id, 0]));
  items.forEach(i => { if (i.tier !== 1) marks.forEach(l => { if (Math.abs(i.x - l.x) < 40 && Math.abs(i.y - l.y) < 40) around.set(l.id, around.get(l.id) + 1); }); });
  const { x, y } = marks.reduce((a, b) => around.get(b.id) > around.get(a.id) ? b : a);
  g.travel(d3.zoomIdentity.translate(g.width / 2 - x * k, g.height / 2 - y * k).scale(k), false); }"""
NAMES = """() => { const g = TauExplorer.graph, t = g.transform, k = t.k;
  const dots = (g.visible.disk || []).map(i => ({ id: i.id, tier: i.tier, x: i.x * k + t.x, y: i.y * k + t.y, r: i.tier === 1 ? 4 : 3 }));
  const names = [...document.querySelectorAll('g.tau-label')].map(e => e.__data__).filter(l => l && l.kind === 'mathlib' && l.landmark && !l.chosen);
  const on = (b, s) => Math.hypot(Math.max(b.x, Math.min(s.x, b.x + b.w)) - s.x, Math.max(b.y, Math.min(s.y, b.y + b.h)) - s.y) < s.r - 1;
  return { named: names.length, overLandmark: names.filter(l => dots.some(s => s.tier === 1 && s.id !== l.nodeId && on(l.box, s))).length,
           overHeader: names.filter(l => dots.some(s => s.tier !== 1 && on(l.box, s))).length }; }"""
FRAMED = """() => { const g = TauExplorer.graph, d = g.universe.disk, reserve = g.width < 600 ? 56 : g.height < 400 ? 24 : 0;
  return 2 * d.outer * g.transform.k >= .7 * Math.min(g.width, g.height - reserve); }"""


def settle(page, ms=700):
    page.wait_for_timeout(ms)


with sync_playwright() as p:
    browser = p.chromium.launch()
    for scope, options in (('Desktop', {'viewport': {'width': 1440, 'height': 900}}),
                           ('Phone', {'viewport': {'width': 390, 'height': 844}, 'has_touch': True, 'is_mobile': True})):
        context = browser.new_context(**options)
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(url)
        page.wait_for_function('window.TauExplorer')
        settle(page, 1200)
        rest = page.evaluate(STATE)
        record(scope + ': at rest the disk is closed and the sun offers to open it', rest['state'] == 'closed' and rest['display'] == 'none'
               and rest['items'] == 0 and rest['label'] == 'Open the Mathlib disk' and rest['atOverview'])
        if scope == 'Desktop':
            record('At rest, a sector with no roadmaps yet is named faintly with its identifier', page.evaluate("""() => {
              const names = [...document.querySelectorAll('.tau-label-emptysector')].map(l => l.textContent);
              return TauExplorer.getUniverse().emptySectors.length > 0 && names.some(n => n.includes('RINGS AND ALGEBRAS') && n.includes('math.RA')); }"""))
        record(scope + ': each sector\'s tint reaches the lines either side of it, with no empty strip along them', page.evaluate("""() => {
          const u = TauExplorer.getUniverse(), rules = u.guides.rules.map(r => r.angle), near = a => rules.some(r => Math.abs(Math.atan2(Math.sin(a - r), Math.cos(a - r))) < 1e-6);
          return u.galaxies.every(g => near(g.b0) && near(g.b1)); }"""))
        # The tint only: the camera frames a sector by its roadmaps. Moving the sector itself to the rim made a phone's
        # pinch into a roadmap fail on GitHub's runners (2026-10-26).
        record(scope + ': every sector\'s tint starts where the disk ends, and the camera still frames it by its roadmaps', page.evaluate("""() => {
          const u = TauExplorer.getUniverse(); return u.galaxies.every(g => g.t0 === u.disk.outer) && u.galaxies.some(g => g.r0 > g.t0 + 100); }"""))
        record(scope + ': the map\'s sector rules start where the live map\'s do', page.evaluate("""() => {
          const g = TauExplorer.graph, inner = g.universe.guides.inner;
          return [...document.querySelectorAll('line.tau-sector-rule')].every(l => Math.abs(Math.hypot(+l.getAttribute('x1'), +l.getAttribute('y1')) - inner) < 1); }"""))
        record(scope + ': every item lies on the disk, in its sector', page.evaluate("""() => {
          const d = TauExplorer.getUniverse().disk, sectors = new Map(d.sectors.map(s => [s.sectorId, s]));
          return d.items.length === TauExplorer.data.mathlibDisk.items.length && d.items.every(i => {
            const r = Math.hypot(i.x, i.y), s = sectors.get(i.sector); let a = Math.atan2(i.y, i.x);
            while (a < s.a0 - 1e-6) a += 2 * Math.PI;
            return r >= d.inner - 36 && r <= d.outer + 36 && a <= s.a1 + 1e-6; }); }"""))
        sun = page.evaluate(SUN)
        if scope == 'Desktop':
            page.mouse.move(sun[0], sun[1])
            settle(page)
            peek = page.evaluate(STATE)
            record('Hovering over the sun opens the disk a little', peek['state'] == 'peek' and peek['transform'] == 'scale(0.42)' and peek['display'] is None)
            page.mouse.move(sun[0] + 300, sun[1] + 200)
            settle(page)
            gone = page.evaluate(STATE)
            record('Leaving the sun closes it again', gone['state'] == 'closed' and gone['display'] == 'none' and gone['transform'] == 'scale(0)')
            page.mouse.move(sun[0], sun[1])
            page.wait_for_timeout(80)
            page.mouse.click(sun[0], sun[1])
        else:
            page.touchscreen.tap(sun[0], sun[1])
        settle(page, 1000)
        opened = page.evaluate(STATE)
        # A phone has room for fewer names at the disk's frame; more come as the reader zooms in.
        least = (3, 5) if scope == 'Desktop' else (3, 0)
        record(scope + ': a click on the sun opens the disk round it, with its landmarks and areas named', opened['state'] == 'open'
               and opened['transform'] == 'scale(1)' and opened['items'] >= 100 and opened['sectors'] >= least[0] and opened['names'] >= least[1]
               and opened['label'] == 'Close the Mathlib disk')
        record(scope + ': the sun keeps its name over the open disk', page.evaluate("() => !!document.querySelector('.tau-label-core')"))
        record(scope + ': the disk names its categories with their identifiers', page.evaluate("""() =>
          [...document.querySelectorAll('.tau-label-disksector')].some(l => / math\\.[A-Z]{2}$/.test(l.textContent.replace(/([A-Z])math/, '$1 math'))) """))
        if scope == 'Phone':
            # Closer in round the most important landmark, wherever the page's turn of the disk has put it.
            page.evaluate("""() => { const g = TauExplorer.graph, k = g.transform.k * 3,
              { x, y } = g.universe.disk.items.filter(i => i.tier === 1).sort((a, b) => b.importance - a.importance)[0];
              g.travel(d3.zoomIdentity.translate(g.width / 2 - x * k, g.height / 2 - y * k).scale(k), false); }""")
            settle(page)
            record('Phone: closer in, the landmarks are named', page.evaluate("() => document.querySelectorAll('.tau-label-mathlib').length") >= 3)
            page.evaluate("() => TauExplorer.graph.zoomToDisk(false)")
            settle(page)
        record(scope + ': the camera frames the disk, with the sun at its centre', page.evaluate(FRAMED) and not opened['atOverview'])
        # One division for the disk and the map (the user, 2026-10-26): the disk's slices are the map's sectors.
        record(scope + ': the disk\'s dividing lines run on from the map\'s, one for one', page.evaluate("""() => {
          const angle = l => Math.atan2(+l.getAttribute('y2'), +l.getAttribute('x2'));
          const disk = [...document.querySelectorAll('line.tau-disk-rule')].map(angle).sort((a, b) => a - b);
          const map = [...document.querySelectorAll('line.tau-sector-rule')].map(angle).sort((a, b) => a - b);
          return disk.length > 10 && disk.length === map.length && disk.every((a, i) => Math.abs(a - map[i]) < 1e-3); }"""))
        record(scope + ': the map\'s sector rules start at the disk\'s rim while it is open', page.evaluate("""() => {
          const g = TauExplorer.graph, outer = g.universe.disk.outer;
          return [...document.querySelectorAll('line.tau-sector-rule')].every(l => Math.hypot(+l.getAttribute('x1'), +l.getAttribute('y1')) >= outer - 1); }"""))
        if scope == 'Desktop':
            before = page.evaluate("() => { const g = TauExplorer.graph, t = g.transform; return [(g.width / 2 - t.x) / t.k, (g.height / 2 - t.y) / t.k]; }")
            page.evaluate("() => { const l = document.querySelector('.tau-label-mathlib.is-landmark rect'); l.dispatchEvent(new MouseEvent('click', {bubbles: true})); }")
            settle(page, 900)
            panel = page.evaluate("""() => { const s = TauExplorer.getState(), item = TauExplorer.data.mathlibDisk.items.find(i => i.id === s.selected),
              box = document.getElementById('inspector-content'), links = [...box.querySelectorAll('a.topic-link')].map(a => a.href);
              return { item: !!item, kind: document.getElementById('selection-kind').textContent, title: box.querySelector('.detail-title').textContent,
                       expected: item && item.t, signature: !!box.querySelector('pre.disk-signature'), stats: box.querySelectorAll('.detail-stats > div').length,
                       docs: links.some(h => h.startsWith('https://leanprover-community.github.io/mathlib4_docs/Mathlib/') && h.includes('.html#')),
                       source: links.some(h => h.startsWith('https://github.com/leanprover-community/mathlib4/blob/' + TauExplorer.data.mathlibDisk.commit + '/Mathlib/')),
                       state: TauExplorer.graph.diskState }; }""")
            record('A landmark\'s name opens its panel: statement, measures, docs and source', panel['item'] and panel['kind'].startswith('Mathlib ')
                   and panel['title'] and panel['signature'] and panel['stats'] == 3 and panel['docs'] and panel['source'] and panel['state'] == 'open')
            after = page.evaluate("() => { const g = TauExplorer.graph, t = g.transform; return [(g.width / 2 - t.x) / t.k, (g.height / 2 - t.y) / t.k]; }")
            # The selected item keeps its name, among area names and crowded neighbours: the level-one dimension formula
            # lost its name to the area names round it on 2026-10-26.
            named = page.evaluate("""() => { const g = TauExplorer.graph, item = g.universe.byId.get('mathlib:ModularForm.dimension_level_one');
              if (!item) return true;
              g.options.onSelect(item); const k = g.diskTransform().k * 4.5;
              g.travel(d3.zoomIdentity.translate(g.width * .45 - item.x * k, g.height / 2 - item.y * k).scale(k), false); return null; }""")
            settle(page, 900)
            record('A selected item is named, whatever is round it', named or page.evaluate(
                "() => !!document.querySelector('.tau-label-mathlib[data-label-for=\\'mathlib:ModularForm.dimension_level_one\\']')"))
            page.evaluate("() => TauExplorer.graph.zoomToDisk(false)")
            settle(page)
            record('The panel opening beside the chart keeps the reader\'s place in the disk', abs(after[0] - before[0]) < 2 and abs(after[1] - before[1]) < 2)
            sun = page.evaluate(SUN)
            page.mouse.click(sun[0], sun[1])
        else:
            sun = page.evaluate(SUN)
            page.touchscreen.tap(sun[0], sun[1])
        settle(page, 1000)
        closed = page.evaluate(STATE)
        record(scope + ': a second click closes the disk and returns to the opening view', closed['state'] == 'closed' and closed['display'] == 'none'
               and closed['items'] == 0 and closed['atOverview'])
        record(scope + ': a Mathlib item\'s panel closes with the disk', page.evaluate("() => TauExplorer.getState().selected === null && document.getElementById('inspector').hidden"))
        if scope == 'Desktop':
            page.focus('.tau-core-hit')
            page.keyboard.press('Enter')
            settle(page, 1000)
            keyed = page.evaluate(STATE)
            page.keyboard.press('Enter')
            settle(page, 1000)
            record('Enter on the sun opens the disk and Enter again closes it', keyed['state'] == 'open' and page.evaluate(STATE)['state'] == 'closed')
            sun = page.evaluate(SUN)
            page.mouse.move(sun[0], sun[1])
            page.wait_for_timeout(60)
            page.mouse.click(sun[0], sun[1])
            settle(page, 1000)
            quick = page.evaluate(STATE)
            record('A click while the disk is still opening a little ends with it open', quick['state'] == 'open' and quick['transform'] == 'scale(1)')
            # The user, 2026-10-28: near the rim, where the files' headers' items crowd, landmarks such as the class number
            # formula went unnamed. A landmark's name lies over their faint dots, never over another landmark's.
            page.evaluate(CROWD)
            settle(page, 900)
            crowd = page.evaluate(NAMES)
            record('Where header items crowd, the landmarks are named over their dots, never over another landmark\'s',
                   crowd['named'] >= 3 and crowd['overLandmark'] == 0 and crowd['overHeader'] >= 1)
        context.close()
    context = browser.new_context(viewport={'width': 1440, 'height': 900}, reduced_motion='reduce')
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(url)
    page.wait_for_function('window.TauExplorer')
    settle(page, 1200)
    page.evaluate("() => TauExplorer.graph.toggleDisk()")
    still = page.evaluate(STATE)
    record('Under reduced motion the disk opens at once', still['state'] == 'open' and still['transform'] == 'scale(1)' and still['display'] is None)
    context.close()
    browser.close()
record('No page errors', not errors)
print(json.dumps({'checks': len(checks), 'passed': True}, indent=2))
