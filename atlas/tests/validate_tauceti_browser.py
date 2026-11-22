#!/usr/bin/env python3
"""Browser checks for the Tau Ceti build (tauceti/index.html): only the roadmaps
Tau Ceti's Progress page reports, its own layer counts as the headline (with the
layers read from READMEs it lists without layers), and each roadmap's live report."""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parents[1]
url = next((arg for arg in sys.argv[1:] if not arg.startswith('--')), (REPO / 'tauceti' / 'index.html').as_uri())
checks, errors = [], []


def record(name, ok):
    checks.append(name)
    if not ok:
        print(json.dumps({'failedCheck': name, 'checks': checks, 'pageErrors': errors}, indent=2))
        raise AssertionError(name)


with sync_playwright() as p:
    browser = p.chromium.launch()
    for scope, viewport in (('Desktop', {'width': 1440, 'height': 900}), ('Phone', {'width': 390, 'height': 844})):
        page = browser.new_page(viewport=viewport)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(url)
        page.wait_for_function('window.TauExplorer')
        page.wait_for_timeout(1200)
        record(scope + ' shows only the roadmaps Tau Ceti\'s Progress page reports', page.evaluate("""() => {
          const d=TauExplorer.data, board=Object.keys(d.taucetiProgress.roadmaps);
          return d.variant==='tauceti' && d.roadmaps.length===board.length && d.roadmaps.every(r=>r.origin==='tauceti' && board.includes(r.id))
            && TauExplorer.getUniverse().constellations.filter(c=>!c.unmapped).length===board.length && !d.papers.length; }"""))
        record(scope + ' the headline is the share of the board\'s layers done, with its counts beneath', page.evaluate("""() => {
          const c=TauExplorer.data.taucetiProgress.counts, percent=Math.round(c.done/c.total*100), count=document.getElementById('atlas-count').textContent;
          return document.getElementById('atlas-percent').textContent===percent+'%'
            && count.includes(`${c.done.toLocaleString()} of ${c.total.toLocaleString()} layers done`) && count.includes(`${c.partial.toLocaleString()} partial`)
            && getComputedStyle(document.querySelector('.scale-marker')).display!=='none' && document.getElementById('atlas-marker').style.left===percent+'%'; }"""))
        record(scope + ' the panel says where the data comes from, which layers come from READMEs, and names any roadmap not yet placed', page.evaluate("""() => {
          const e=document.getElementById('atlas-source'), t=e.textContent, u=TauExplorer.data.taucetiProgress.unplaced, r=TauExplorer.data.taucetiProgress.readmeLayers;
          return t.startsWith("From Tau Ceti's Progress page") && (u.length ? t.includes(`${u.length} newer roadmap`) : !/newer roadmap/.test(t))
            && (r.length ? t.includes(`of ${r.length} roadmap${r.length===1?'':'s'} it lists without layers`) : !/without layers/.test(t))
            && u.every(x=>e.title.includes(x.id.split('/').pop())) && r.every(id=>e.title.includes(id.split('/').pop())); }"""))
        # A family's index without layers (Operator theory) joins as a collection: its layers are its sub-roadmaps'.
        record(scope + ' a roadmap Tau Ceti accepted since the snapshot is on the map, counted in the layers', page.evaluate("""() => {
          const d=TauExplorer.data, added=d.roadmaps.filter(r=>(d.roadmapClassification.roadmaps[r.id]||{}).basis==='provisional'), u=TauExplorer.getUniverse();
          return added.every(r=>u.byId.has(r.id) && r.stages.every(s=>u.byId.has(s)) && (r.stages.length ? TauExplorer.progress.roadmapLeaves(r.id).length===r.stages.length
            : d.roadmaps.some(x=>x.parentRoadmapId===r.id))); }"""))
        # The board lists no layers for a roadmap whose headings it cannot read (`## A1. ...`); the
        # build reads them from the README, and none of them has a state.
        record(scope + ' a roadmap the board lists without layers has its README\'s layers on the map, unassessed', page.evaluate("""() => {
          const d=TauExplorer.data, u=TauExplorer.getUniverse(), ids=d.taucetiProgress.readmeLayers;
          return ids.every(id => { const r=d.roadmaps.find(x=>x.id===id);
            return r && r.layersFrom==='readme' && r.stages.length>0 && u.byId.has(id) && d.taucetiProgress.roadmaps[id].layers==='readme'
              && r.stages.every(s=>u.byId.has(s) && TauExplorer.progress.leafState(s).status==='unknown'); }); }"""))
        if scope == 'Desktop':
            roadmap = page.evaluate("() => Object.entries(TauExplorer.data.taucetiProgress.roadmaps).find(([id,b])=>b.status)[0]")
            page.evaluate("id => TauExplorer.openItem(id)", roadmap)
            page.wait_for_timeout(700)
            record('A roadmap shows its share of layers done, its counts and one segment per layer', page.evaluate("""id => {
              const segments=document.querySelectorAll('#inspector-content .layer-segments i'), leaves=TauExplorer.progress.roadmapLeaves(id);
              const done=leaves.filter(l=>TauExplorer.progress.leafState(l).status==='complete').length;
              return segments.length===leaves.length && document.querySelector('#inspector-content .progress-caption strong').textContent===Math.round(done/leaves.length*100)+'%'; }""", roadmap))
            record('A roadmap links to its live report and progress log', page.evaluate("""() => {
              const links=[...document.querySelectorAll('#inspector-content .report-links a')].map(a=>a.href);
              return [...document.querySelectorAll('#inspector-content .section-label')].some(h=>h.textContent==="Tau Ceti's latest report")
                && links.some(h=>h.endsWith('/STATUS.md')) && links.some(h=>h.endsWith('/PROGRESS.md')); }"""))
            layer = page.evaluate("() => Object.keys(TauExplorer.data.taucetiProgress.remaining)[0]")
            page.evaluate("id => TauExplorer.openStage(id)", layer)
            page.wait_for_timeout(700)
            record('A layer shows what its latest report says is still to do', page.evaluate("""id => [...document.querySelectorAll('#inspector-content .section-label')].some(h=>h.textContent==='Still to do')
              && document.getElementById('inspector-content').textContent.includes(TauExplorer.data.taucetiProgress.remaining[id].slice(0,40))""", layer))
            # A family on main (a collection: Representation theory, Operator theory): selected, it rings its sub-roadmaps and
            # draws the links into them from the roadmaps outside it that they rest on, and its panel lists those.
            family = page.evaluate("""() => { const d=TauExplorer.data,n=new Map(); for(const r of d.roadmaps)if(r.parentRoadmapId)n.set(r.parentRoadmapId,(n.get(r.parentRoadmapId)||0)+1);
              return d.roadmaps.filter(r=>!r.stages.length&&n.has(r.id)).sort((a,b)=>n.get(b.id)-n.get(a.id))[0].id; }""")
            page.evaluate("id => TauExplorer.openItem(id)", family)
            page.wait_for_timeout(1200)
            page.mouse.move(5, 5)
            page.wait_for_timeout(300)
            record('A family on main, selected, shows what its sub-roadmaps rest on, and lists it', page.evaluate("""id => {
              const d=TauExplorer.data,u=TauExplorer.getUniverse(),members=[],visit=x=>d.roadmaps.filter(r=>r.parentRoadmapId===x).forEach(r=>{members.push(r.id);visit(r.id);});visit(id);
              const inside=new Set([id,...members]),drawn=new Set(u.constellations.map(c=>c.id));
              const links=d.edges.filter(e=>drawn.has(e.source)&&drawn.has(e.target)&&(e.source===id||e.target===id||inside.has(e.target))&&!(inside.has(e.source)&&inside.has(e.target))).length;
              const uses=[...new Set(d.edges.filter(e=>inside.has(e.target)&&!inside.has(e.source)).map(e=>e.source))].sort();
              const shown=new Set([...document.querySelectorAll('.tau-constellation')].map(g=>g.dataset.nodeId));
              const ringed=[...document.querySelectorAll('.tau-constellation.is-family-member')].map(g=>g.dataset.nodeId).sort();
              const listed=[...document.querySelectorAll('#inspector-content .family-uses .item-link')].map(b=>b.dataset.itemId).sort();
              return TauExplorer.getState().view==='collection' && links>0 && document.querySelectorAll('.tau-link').length===links
                && ringed.length>0 && JSON.stringify(ringed)===JSON.stringify(members.filter(x=>shown.has(x)).sort()) && JSON.stringify(listed)===JSON.stringify(uses); }""", family))
            readme = page.evaluate("() => TauExplorer.data.taucetiProgress.readmeLayers[0] || null")
            if readme:
                page.evaluate("id => TauExplorer.openItem(id)", readme)
                page.wait_for_timeout(700)
                record('A roadmap whose layers come from its README says so in its report', page.evaluate("""() =>
                  [...document.querySelectorAll('#inspector-content .detail-note')].some(p=>p.textContent.includes('lists no layers for this roadmap'))"""))
        record(scope + ' has no application errors', not errors)
        page.close()
    browser.close()
print(json.dumps({'url': url, 'checks': checks, 'result': 'PASS'}, indent=2))
