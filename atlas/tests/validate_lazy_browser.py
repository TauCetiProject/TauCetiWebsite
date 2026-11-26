#!/usr/bin/env python3
"""Browser checks for the page's lazily read data (src/lazy.js, scripts/lazy_data.py) and for the links that stand
in for the roadmaps' READMEs: the map is drawn before any part is read; a layer's, a planet's, a Mathlib item's and
a roadmap's links panel each read the part they need and then show what the whole data gives; the search reads the
rest; the offline copy carries every part inside itself and reads nothing beside it. Runs on the atlas (index.html
beside its atlas-data/ folder) unless given another page of the same build."""
import hashlib
import json
import re
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / 'scripts'))
from lazy_data import CALLBACK, FOLDER, join  # noqa: E402

url = next((arg for arg in sys.argv[1:] if not arg.startswith('--')), (REPO / 'index.html').as_uri())
checks, errors = [], []


def record(name, ok, detail=None):
    checks.append(name)
    if not ok:
        print(json.dumps({'failedCheck': name, 'detail': detail, 'checks': checks, 'pageErrors': errors}, indent=2, default=str))
        raise AssertionError(name)


def whole_data():
    """The data as the build split it, put back together here from the page and its folder."""
    page = (REPO / 'index.html').read_text(encoding='utf-8')
    core = json.loads(re.search(r'<script id="atlas-data" type="application/json">(.*?)</script>', page, re.S)[1])
    parts = {}
    for name, (file, _size) in core['lazy']['parts'].items():
        script = (REPO / FOLDER / file).read_text(encoding='utf-8')
        parts[name] = json.loads(json.loads(script[len(f'{CALLBACK}({json.dumps(name)},'):-3]))
    return core, join(core, parts)


def digest(texts):
    return hashlib.sha256('\x00'.join(texts).encode('utf-8', 'replace')).hexdigest()


# The same digest in the page: the texts joined by a NUL, as UTF-8.
DIGEST = """async texts => { const bytes = new TextEncoder().encode(texts.join(String.fromCharCode(0)));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join(''); }"""
LOADED = "() => TauExplorer.lazy.names.filter(name => TauExplorer.lazy.isLoaded(name))"
# No background reading: a part is read only when something asks for it.
QUIET = "window.requestIdleCallback = () => 0;"


def open_page(context, address, quiet=True):
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    if quiet:
        page.add_init_script(QUIET)
    page.goto(address, wait_until='load')
    page.wait_for_function('!!window.TauExplorer', timeout=30000)
    return page


def main():
    core, whole = whole_data()
    stages = {stage['id']: stage for stage in whole['stages']}
    deferred = [stage for stage in core['stages'] if 'description' not in stage]
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
        page = open_page(context, url)

        # --- the first frame ---
        first = page.evaluate("""() => ({ loaded: TauExplorer.lazy.names.filter(name => TauExplorer.lazy.isLoaded(name)), names: TauExplorer.lazy.names.length,
          scripts: document.querySelectorAll('script[src]').length, readmes: TauExplorer.data.roadmaps.filter(r => 'readme' in r).length,
          constellations: TauExplorer.getUniverse().constellations.length, drawn: document.querySelectorAll('#graph svg *').length,
          planets: TauExplorer.landmarks.length, titled: TauExplorer.landmarks.every(item => typeof TauExplorer.landmarkTitle(item) === 'string' && item.id.startsWith(item.stageId + '::landmark:')) })""")
        record('The map is drawn before any part is read', first['loaded'] == [] and first['scripts'] == 0 and first['constellations'] == len(core['roadmaps']) and first['drawn'] > 100, first)
        record('The page carries no README', first['readmes'] == 0, first)
        record('The planets come with the page', first['planets'] > 0 and first['titled'] and first['names'] == len(core['lazy']['parts']), first)

        # --- a layer ---
        layer = next(stage for stage in deferred if page.evaluate("id => TauExplorer.isMathematicalStage(id) && !TauExplorer.data.stages.find(s => s.id === id).expansion", stage['id'])
                     and len(stages[stage['id']]['description']) > 400)
        page.evaluate("id => TauExplorer.openStage(id)", layer['id'])
        page.wait_for_selector('#inspector-content .source-layer', state='attached', timeout=15000)
        loaded = page.evaluate(LOADED)
        record('Opening a layer reads its roadmap\'s part and no other', loaded == [core['lazy']['text'][layer['owner']]], loaded)
        record('The layer has its description', page.evaluate("id => TauExplorer.data.stages.find(s => s.id === id).description", layer['id']) == stages[layer['id']]['description'])
        shown = page.evaluate("() => document.querySelector('.source-stage-description').textContent.length")
        record('The layer\'s panel shows its source', shown > 100 and page.locator('#inspector-content .detail-title').inner_text() == page.evaluate("id => TauExplorer.stageTitle(id)", layer['id']), shown)

        # --- the roadmap's link, in place of its README ---
        roadmap = next(r for r in core['roadmaps'] if r['id'] == layer['owner'])
        link = page.locator('#inspector-content a[data-roadmap-page]')
        record('A layer links to its roadmap\'s page', link.count() == 1 and link.get_attribute('href') == roadmap['page']['href'] and link.get_attribute('target') == '_blank'
               and link.inner_text().startswith('Read full roadmap') and page.get_by_role('button', name='Read full roadmap', exact=True).count() == 0, roadmap.get('page'))
        page.evaluate("id => TauExplorer.openItem(id)", roadmap['id'])
        page.wait_for_function("id => TauExplorer.getState().selected === id && !!document.querySelector('#inspector-content .detail-title')", arg=roadmap['id'])
        link = page.locator('#inspector-content .button-row a.secondary[data-roadmap-page]')
        style = link.evaluate("a => { const s = getComputedStyle(a), b = getComputedStyle(a.parentElement.querySelector('button')); return [s.textDecorationLine, s.fontSize, s.borderTopWidth, b.fontSize]; }") if link.count() else None
        record('A roadmap\'s panel links to its page, in the button\'s style', link.count() == 1 and link.get_attribute('href') == roadmap['page']['href'] and style[0] == 'none' and style[1] == '12px' and style[2] == '1px', style)
        record('The reader is not opened for a README', not page.locator('#reader[open]').count())
        forms = page.evaluate("""() => TauExplorer.data.roadmaps.filter(r => !r.page || !/^https:\\/\\/(taucetiproject\\.org\\/roadmap\\.html\\?id=[^&#\\s]+|github\\.com\\/\\S+)$/.test(r.page.href)).map(r => r.id)""")
        record('Every roadmap has a link of a known form', forms == [], forms[:5])

        # --- a roadmap's links ---
        linked = next((edge for edge in whole['edges'] if edge.get('kind') == 'readme' and edge.get('evidence')), None)
        if linked:
            before = page.evaluate(LOADED)
            page.evaluate("id => TauExplorer.navigate({view:'roadmap',id,layer:null,selected:id,tab:'links'})", linked['target'])
            page.wait_for_selector('#inspector-content .connection-card', state='attached', timeout=15000)
            after = page.evaluate(LOADED)
            record('The links tab reads the links\' evidence', 'links' not in before and 'links' in after, after)
            lines = page.locator('#inspector-content .connection-card a.topic-link', has_text='Read that line').count()
            record('A prerequisite read from a README points at its line', lines > 0, lines)

        # --- a planet and its citations ---
        cited = page.evaluate("""() => { const item = TauExplorer.landmarks.find(item => item.referenceLines.length && item.sourceLine); return item ? { id: item.id, stage: item.stageId, roadmap: item.roadmapId, line: item.referenceLines[0] } : null; }""")
        if cited:
            page.evaluate("id => TauExplorer.openLandmark(id)", cited['id'])
            page.wait_for_selector('#inspector-content .landmark-description', state='attached', timeout=15000)
            passage = page.evaluate("id => { const item = TauExplorer.landmarks.find(x => x.id === id); return [item.description, item.sourceExcerpt, item.excerpt]; }", cited['id'])
            record('A planet\'s passage is read from its layer\'s description', passage[0] and passage[0] == passage[1] and passage[0] in stages[cited['stage']]['description'], passage[2])
            source = page.locator('#inspector-content [data-reference-scope="direct"] a.reference-source').first
            owner = next(r for r in core['roadmaps'] if r['id'] == cited['roadmap'])
            href = source.get_attribute('href') if source.count() else None
            wanted = owner.get('readmeSource') and (owner['readmeSource'] if owner.get('readmeLines') is False else f"{owner['readmeSource']}?plain=1#L{cited['line']}")
            record('A citation points at its line of the README on GitHub', bool(href) and (not wanted or href == wanted), href)

        # --- a Mathlib item ---
        item = next((row for row in whole.get('mathlibDisk', {}).get('items', []) if row.get('sig') and row.get('doc')), None)
        if item:
            page.evaluate("id => TauExplorer.navigate({ selected: id })", item['id'])
            page.wait_for_selector('#inspector-content .disk-signature', state='attached', timeout=15000)
            record('A Mathlib item\'s panel reads its statement', page.locator('.disk-signature').inner_text() == item['k'] + ' ' + item['sig'] and 'disk' in page.evaluate(LOADED))

        # --- the search ---
        partial = len(page.evaluate(LOADED)) < len(core['lazy']['parts'])
        texts = {rid: ' '.join(groups.values()) for rid, groups in whole.get('readmeWords', {}).items()}
        word, target = next(((w, rid) for rid, text in texts.items() for w in text.split(' ')
                             if len(w) > 9 and w.isascii() and w.isalpha() and sum(w in other for other in texts.values()) == 1
                             and w not in json.dumps(next(r for r in core['roadmaps'] if r['id'] == rid), ensure_ascii=False).lower()), (None, None))
        record('A word of one README alone is there to search for', bool(word))
        page.evaluate("() => { document.body.classList.add('catalogue-open'); }")
        page.locator('#search').fill(word)
        heading = page.locator('#catalogue .catalogue-heading').first.inner_text()
        record('Before the text is read the search says so', (not partial) or 'reading the full text' in heading.lower(), heading)
        page.locator('#search').focus()
        page.wait_for_function("() => TauExplorer.lazy.complete()", timeout=120000)
        page.wait_for_function("() => /^\\d+ roadmaps · \\d+ stages$/i.test(document.querySelector('#catalogue .catalogue-heading').textContent.trim())", timeout=15000)
        hits = page.evaluate("() => [...document.querySelectorAll('#catalogue .search-hit strong')].map(n => n.textContent)")
        title = page.evaluate("id => { const r = TauExplorer.data.roadmaps.find(r => r.id === id); return r.title.replace(/^Roadmap:\\s*/i, ''); }", target)
        record('A roadmap is found by a word of its README', title in hits, [word, title, hits[:5]])
        page.locator('#search').fill('')

        # --- everything read: the same data as the build split ---
        got = page.evaluate("async () => { const digest = %s; const d = TauExplorer.data; return { stages: await digest(d.stages.map(s => s.description || '')), n: d.stages.filter(s => typeof s.description === 'string').length,"
                            " evidence: await digest(d.edges.concat(d.stageEdges).map(e => JSON.stringify(e.evidence === undefined ? null : e.evidence))),"
                            " disk: await digest(((d.mathlibDisk || {}).items || []).map(r => (r.sig || '') + '|' + (r.doc || ''))) }; }" % DIGEST)
        want = {'stages': digest([stage.get('description') or '' for stage in whole['stages']]), 'n': sum(isinstance(stage.get('description'), str) for stage in whole['stages']),
                'evidence': digest([json.dumps(edge.get('evidence'), ensure_ascii=False, separators=(',', ':')) for edge in whole['edges'] + whole['stageEdges']]),
                'disk': digest([(row.get('sig') or '') + '|' + (row.get('doc') or '') for row in whole.get('mathlibDisk', {}).get('items', [])])}
        record('Every layer has its description once the parts are read', got['stages'] == want['stages'] and got['n'] == want['n'], [got['n'], want['n']])
        record('Mathlib\'s statements are whole once the parts are read', got['disk'] == want['disk'])
        record('The links\' evidence is whole once the parts are read', got['evidence'] == want['evidence'])

        # --- the offline copy ---
        folder = Path(tempfile.mkdtemp(prefix='tauceti-offline-'))
        page.locator('#progress-button').click()
        with page.expect_download(timeout=120000) as download:
            page.locator('#download-offline').click()
        copy = folder / 'TauCeti_Atlas.html'
        download.value.save_as(str(copy))
        page.locator('#close-progress').click()
        text = copy.read_text(encoding='utf-8')
        record('The offline copy carries every part inside itself', len(re.findall(r'<script type="application/json" data-atlas-part="', text)) == len(core['lazy']['parts']))
        offline = browser.new_context(viewport={'width': 1440, 'height': 900})
        asked = []
        op = offline.new_page()
        op.on('pageerror', lambda error: errors.append('offline: ' + str(error)))
        op.on('request', lambda request: asked.append(request.url))
        op.add_init_script(QUIET)
        op.goto(copy.as_uri(), wait_until='load')
        op.wait_for_function('!!window.TauExplorer', timeout=60000)
        state = op.evaluate("() => ({ inline: TauExplorer.lazy.inline, loaded: TauExplorer.lazy.names.filter(name => TauExplorer.lazy.isLoaded(name)).length, readmes: TauExplorer.data.roadmaps.filter(r => 'readme' in r).length,"
                            " constellations: TauExplorer.getUniverse().constellations.length })")
        record('The offline copy opens on its own, with nothing read yet', state['inline'] and state['loaded'] == 0 and state['readmes'] == 0 and state['constellations'] == len(core['roadmaps']), state)
        op.evaluate("id => TauExplorer.openStage(id)", layer['id'])
        record('The offline copy shows a layer at once', op.locator('#inspector-content .source-layer').count() == 1
               and op.evaluate("id => TauExplorer.data.stages.find(s => s.id === id).description", layer['id']) == stages[layer['id']]['description'])
        record('The offline copy keeps the roadmap\'s link', op.locator('#inspector-content a[data-roadmap-page]').get_attribute('href') == roadmap['page']['href'])
        op.evaluate("() => TauExplorer.lazy.all()")
        again = op.evaluate("async () => { const digest = %s; const d = TauExplorer.data; return [TauExplorer.lazy.complete(), await digest(d.stages.map(s => s.description || '')),"
                            " await digest(d.edges.concat(d.stageEdges).map(e => JSON.stringify(e.evidence === undefined ? null : e.evidence))), await digest(((d.mathlibDisk || {}).items || []).map(r => (r.sig || '') + '|' + (r.doc || ''))),"
                            " Object.keys(d.readmeWords || {}).length]; }" % DIGEST)
        record('The offline copy holds all the data the page read', again == [True, want['stages'], want['evidence'], want['disk'], len(whole.get('readmeWords', {}))], again[4])
        beside = [address for address in asked if address != copy.as_uri() and not address.startswith(('data:', 'blob:', 'https://api.github.com/'))]
        record('The offline copy reads nothing beside it', not [address for address in beside if FOLDER in address or address.startswith('file:')], beside[:5])
        with op.expect_download(timeout=120000) as second:
            op.evaluate("() => document.querySelector('#download-offline').click()")
        record('An offline copy can be downloaded again from itself', Path(second.value.path()).stat().st_size > 0.9 * copy.stat().st_size)
        offline.close()
        record('No script error on any page', not errors, errors[:5])
        browser.close()
    print(json.dumps({'passed': len(checks), 'checks': checks}, indent=2))


if __name__ == '__main__':
    main()
