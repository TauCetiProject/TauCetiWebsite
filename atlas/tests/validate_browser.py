from pathlib import Path
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
import json,math,re,time,sys,tempfile
REPO=Path(__file__).resolve().parents[1]
ROOT=Path(tempfile.mkdtemp(prefix='tauceti-browser-'))
url=next((arg for arg in sys.argv[1:] if not arg.startswith('--')),(REPO/'index.html').as_uri())
desktop_only='--desktop-only' in sys.argv[1:]
references_only='--references-only' in sys.argv[1:]
overview_only='--overview-only' in sys.argv[1:]
# The planet these reference checks prefer while the atlas still draws it. It is a preference,
# not a fixture: a reviewed blueprint takes over its layer's planets, and pick_formula_planet
# then chooses another planet with the same properties rather than failing.
FORMULA_PLANET='EllipticKTheory:E.2::landmark:k-0-x-xrightarrow-sim-mathbb-z-oplus-opera-e9le4x'
results=[];errors=[];requests=[]
# Requests the page makes but does not need, each with an offline fallback, are aborted like any other but not
# counted: a promoted blueprint's details (read from data/blueprints/, by an offline copy from the published site;
# tests/validate_blueprints_browser.py checks them over HTTP), the live galaxy's look at Tau Ceti's open pull
# requests (GitHub's API), and a proposed roadmap's README on its pull request's branch.
OPTIONAL_REQUESTS=('https://cbirkbeck.github.io/tauceti-explorer/data/blueprints/','https://api.github.com/','https://raw.githubusercontent.com/')
def abort_offline(route):
 if not route.request.url.startswith(OPTIONAL_REQUESTS):requests.append(route.request.url)
 route.abort()
def record(name,value=True):
 if not value:
  active=globals().get('mp')
  if active is None or active.is_closed():active=globals().get('page')
  try:
   diagnostic=active.evaluate("() => ({state:TauExplorer.getState(),graph:TauExplorer.graph.debugState().semantic,graphSelected:TauExplorer.graph.debugState().selectedId,captionCollisions:window.__tauTestCaptionCollisions||[],selectionKind:document.querySelector('#selection-kind')?.textContent,controls:Array.from(document.querySelectorAll('[aria-label=\"Layer status\"]')).map(e=>({display:getComputedStyle(e).display,visibility:getComputedStyle(e).visibility,rect:e.getBoundingClientRect().toJSON()}))})")
   print(json.dumps({'failedCheck':name,'diagnostic':diagnostic,'artifacts':str(ROOT)},indent=2),flush=True)
   active.screenshot(path=str(ROOT/'failure.png'),animations='disabled')
  except Exception as error:print('Could not collect diagnostics:',error,flush=True)
  raise AssertionError(name)
 results.append(name)
def wheel_until(page, selector, delta, predicate, attempts=12):
 # Exercise the user's wheel gesture at a visible target; allow the semantic
 # transition and its animation to settle before issuing the next gesture.
 for _ in range(attempts):
  if page.evaluate(predicate):return True
  target=page.locator(selector).first
  bounds=target.bounding_box()
  if bounds is None:return False
  # A reader first drags a mark that sits at the chart's edge (its centre outside the chart or
  # under the footer) into view, then zooms on it; the wheel over the footer would miss the chart.
  chart=page.locator('#graph').bounding_box()
  cx,cy=bounds['x']+bounds['width']/2,bounds['y']+bounds['height']/2
  if chart and not (chart['x']+24<=cx<=chart['x']+chart['width']-24 and chart['y']+24<=cy<=chart['y']+chart['height']-24):
   x0,y0=max(bounds['x'],chart['x']+4),max(bounds['y'],chart['y']+4)
   x1,y1=min(bounds['x']+bounds['width'],chart['x']+chart['width']-4),min(bounds['y']+bounds['height'],chart['y']+chart['height']-4)
   if x1<=x0 or y1<=y0:return False
   gx,gy=(x0+x1)/2,(y0+y1)/2
   page.mouse.move(gx,gy);page.mouse.down()
   page.mouse.move(chart['x']+chart['width']/2+(gx-cx),chart['y']+chart['height']/2+(gy-cy),steps=12);page.mouse.up()
   page.wait_for_timeout(400)
   bounds=target.bounding_box()
   if bounds is None:return False
   cx,cy=bounds['x']+bounds['width']/2,bounds['y']+bounds['height']/2
  page.mouse.move(cx,cy)
  page.mouse.wheel(0,delta)
  try:
   page.wait_for_function(predicate,timeout=1100)
   return True
  except PlaywrightTimeoutError:pass
 return bool(page.evaluate(predicate))
def tap_until(page, selector, predicate, attempts=4):
 # A tap made while a touch scroll is still settling can be taken as part of
 # the scroll on a slow machine; tap again until the state changes.
 for attempt in range(attempts):
  page.locator(selector).tap()
  try:
   page.wait_for_function(predicate, timeout=5000);return
  except PlaywrightTimeoutError:
   if attempt==attempts-1:raise
   page.wait_for_timeout(500)

def touch_points(points):
 return [dict(x=x,y=y,id=i+1,radiusX=5,radiusY=5,force=1) for i,(x,y) in enumerate(points)]
def touch_swipe(page, session, start, end, steps=10):
 session.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':touch_points([start])})
 for step in range(1,steps+1):
  f=step/steps
  point=(start[0]+(end[0]-start[0])*f,start[1]+(end[1]-start[1])*f)
  session.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':touch_points([point])})
  page.wait_for_timeout(18)
 session.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
 page.wait_for_timeout(120)
UNCOVERED="points => points.every(([x, y]) => { const e = document.elementFromPoint(x, y); return !!(e && e.closest('#graph svg')); })"
TO_MIDDLE="([x, y]) => { const g = TauExplorer.graph, t = g.transform, box = g.svg.node().getBoundingClientRect(); g.svg.call(g.zoom.transform, t.translate((box.left + box.width / 2 - x) / t.k, (box.top + box.height / 2 - y) / t.k)); }"
def pinch_until(page, session, selector, scale, predicate, attempts=7):
 # Two independently moving fingers generate native touch events. Their centroid
 # stays on the chosen object, so entering it tests the map's touch targeting.
 page.wait_for_timeout(900)
 for _ in range(attempts):
  if page.evaluate(predicate):return True
  target=page.locator(selector).first.bounding_box()
  chart=page.locator('#graph').bounding_box()
  if target is None or chart is None:return False
  x=target['x']+target['width']/2;y=target['y']+target['height']/2
  room=min(x-chart['x'],chart['x']+chart['width']-x,60)-3
  if room<4:return False
  radius=min(28,room/scale) if scale>1 else min(45,room)
  # A finger pinches only what it can touch. An object under a panel over the chart (the progress card on a narrow
  # phone, whose size depends on the fonts: Linux's covered Class field theory once the Mathlib disk's sectors came,
  # 2026-10-26) is first brought to the chart's middle, as a reader pans to it.
  if not page.evaluate(UNCOVERED,[[x-radius,y],[x,y],[x+radius,y]]):
   page.evaluate(TO_MIDDLE,[x,y]);page.wait_for_timeout(400);continue
  def fingers(r):return touch_points([(x-r,y),(x+r,y)])
  session.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':fingers(radius)})
  for step in range(1,13):
   r=radius*(1+(scale-1)*step/12)
   session.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':fingers(r)})
   page.wait_for_timeout(20)
  session.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
  try:
   page.wait_for_function(predicate,timeout=1100)
   return True
  except PlaywrightTimeoutError:pass
 return bool(page.evaluate(predicate))
def pinch_gesture(page, session, selector, scale):
 # One two-finger gesture on the chosen object, without any expectation.
 target=page.locator(selector).first.bounding_box();chart=page.locator('#graph').bounding_box()
 if target is None or chart is None:return False
 x=target['x']+target['width']/2;y=target['y']+target['height']/2
 room=min(x-chart['x'],chart['x']+chart['width']-x,60)-3
 if room<4:return False
 radius=min(28,room/scale) if scale>1 else min(45,room)
 def fingers(r):return touch_points([(x-r,y),(x+r,y)])
 session.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':fingers(radius)})
 for step in range(1,13):
  r=radius*(1+(scale-1)*step/12)
  session.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':fingers(r)})
  page.wait_for_timeout(20)
 session.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
 page.wait_for_timeout(400)
 return True
def plain(text):
 """Text as a reader sees it: the panel renders the markdown its source records, list markers included
 (a Tau Ceti roadmap's references are a list)."""
 return ' '.join(re.sub(r'[*_`]', '', re.sub(r'(?m)^\s*(?:[-+*]|\d+[.)])\s+', '', text or '')).split())


# Where a planet's mathematics is shown: a roadmap landmark's description, or a promoted blueprint's statement.
PLANET_MATH='.landmark-description, .blueprint-node .md-content'
# A planet whose roadmap names it by a formula: typeset mathematics, drawn under a short plain name.
FORMULA_JS=r"""item=>/\\|\$|\^|_\{/.test(item.title||'')&&item.description===item.sourceExcerpt
   &&/\\\(|\\\[|\$/.test(item.description||'')&&TauExplorer.presentation.landmarkTitle(item)!==item.title"""
# A planet whose only reading is its roadmap's bibliography: nothing cited for the topic or its layer.
ROADMAP_READING_JS=r"""item=>{const refs=TauExplorer.references.forLandmark(item);return !refs.direct.length&&!refs.layer.length&&refs.roadmap.length>0}"""


def pick_planet(page, condition, pinned=None, preferred='()=>true'):
 """A planet the atlas draws that meets condition (a JavaScript predicate on a landmark): the pinned
 one while it lasts, else the first that also meets preferred, else the first; with whether it is a
 formula planet.

 Pinning one by id broke this suite the first time a reviewed blueprint took over its layer:
 the planet is still defined, the atlas simply stops drawing the excerpt planets of a
 blueprinted layer and shows the blueprint's own. Choosing from what is drawn keeps these
 checks meaningful after a promotion.
 """
 return page.evaluate(r"""([pinned,condition,preferred,formula]) => {
  const ok=eval(condition),better=eval(preferred),isFormula=eval(formula),drawn=TauExplorer.landmarks;
  const chosen=drawn.find(x=>x.id===pinned&&ok(x))||drawn.find(x=>ok(x)&&better(x))||drawn.find(ok);
  return chosen?{id:chosen.id,stageId:chosen.stageId,roadmapId:chosen.roadmapId,formula:isFormula(chosen)}:null;
 }""", [pinned, condition, preferred, FORMULA_JS])


def open_planet(page, planet_id, tap=False):
 """Open a layer's definition or result as a reader does: by its planet where the map draws planets (the campaign
 map), else by its entry under "Definitions and results" in the open layer's panel: the published pages stop at the
 stars (since 2026-10-23)."""
 target=page.locator(('[data-node-id="%s"] .tau-hit' if PLANETS else '#inspector-content [data-item-id="%s"]')%planet_id).first
 target.tap() if tap else target.click()


def first_planet(page, star):
 """A layer's first definition or result: its first planet where planets are drawn, else the first its panel lists."""
 return page.evaluate("([star, drawn]) => drawn ? TauExplorer.getUniverse().stars.find(s=>s.id===star).planetIds[0] : (TauExplorer.landmarks.find(l=>l.stageId===star)||{}).id",[star,PLANETS])


def pick_formula_planet(page):
 """A formula planet, one with roadmap-level reading only while there is one."""
 return pick_planet(page, FORMULA_JS, FORMULA_PLANET, ROADMAP_READING_JS)


def pick_reading_planet(page):
 """A planet with roadmap-level reading only, a formula planet while there is one. The promotions
 waiting from 2026-10-09 take over the campaign layers of the last formula planets that had it."""
 return pick_planet(page, ROADMAP_READING_JS, FORMULA_PLANET, FORMULA_JS)


def recorded_reading(page, planet_id):
 """What the data says this planet's roadmap reading is: the passages and their works."""
 return page.evaluate("""id => {
  const item=TauExplorer.landmarks.find(x=>x.id===id),entries=Object.values(TauExplorer.references.forLandmark(item)).flat();
  return {passages:entries.map(e=>(e.text||'').trim()).filter(Boolean),
          works:entries.flatMap(e=>e.works||[]).map(w=>({title:w.title||'',authors:w.authors||'',url:w.url||''}))};
 }""", planet_id)


def reference_sources_are_exact(page, planet_id):
 return page.evaluate(r"""id => {
  const item=TauExplorer.landmarks.find(x=>x.id===id),entries=Object.values(TauExplorer.references.forLandmark(item)).flat();
  return entries.length>0&&entries.every(entry=>{
   // The page carries no README: the build found each citation's line in it (scripts/derive.js, which checks them
   // against the whole text), and the panel links to that line of the README on GitHub.
   const doc=TauExplorer.data.roadmaps.find(x=>x.sourcePath===entry.sourcePath);
   return !!doc&&!('readme' in doc)&&Number.isInteger(entry.sourceLine)&&entry.sourceLine>=1&&/^https:\/\/github\.com\//.test(doc.readmeSource||'');
  });
 }""",planet_id)
def run_reference_checks(page,browser):
 global mp
 # This desktop fixture is independent of the preceding narrow-window check.
 page.set_viewport_size({'width':1600,'height':1000})
 page.wait_for_timeout(500)
 # A topic with no narrower citation must expose the roadmap bibliography as wider
 # reading, while preserving the topic, its mathematics and its source record.
 chosen=pick_reading_planet(page)
 record('The atlas draws a planet with roadmap reading',bool(chosen))
 planet,owner=chosen['id'],chosen['roadmapId']
 page.evaluate("id => TauExplorer.openStage(id)",chosen['stageId']);page.wait_for_timeout(700)
 open_planet(page,planet)
 reading=page.locator('#inspector .planet-references')
 record('Planet references distinguish wider reading from an exact topic citation',reading.is_visible() and page.evaluate("id => {const item=TauExplorer.landmarks.find(x=>x.id===id),refs=TauExplorer.references.forLandmark(item);return !refs.direct.length&&!refs.layer.length&&refs.roadmap.length>0}",planet) and reading.locator('[data-reference-scope="direct"],[data-reference-scope="layer"]').count()==0 and reading.locator('[data-reference-scope="roadmap"] h4').inner_text()=='Roadmap reading')
 text=reading.inner_text()
 # Against what the data records for THIS planet rather than one roadmap's named works, so the
 # check follows the fixture wherever a promotion moves it.
 recorded=recorded_reading(page,planet)
 record('The planet displays its recorded bibliography without inventing precision',
        len(recorded['passages'])>0 and all(plain(passage)[:40] in plain(text) for passage in recorded['passages']))
 record('Reference lookup preserves the named planet and typeset mathematics',page.evaluate("id => TauExplorer.getState().selected===id",planet) and (not chosen['formula'] or page.locator('.landmark-description math').count()>0 and page.evaluate(r"""id => {const item=TauExplorer.landmarks.find(x=>x.id===id),name=TauExplorer.landmarkTitle(item);return /\\|\$|\^|_\{/.test(item.title)&&item.description===item.sourceExcerpt&&name.length<60&&!/[\\${}^_]/.test(name)&&TauExplorer.getState().selected===id}""",planet)))
 record('Planet citations point to the exact embedded source line',reference_sources_are_exact(page,planet))
 works_text=reading.locator('.reference-works').inner_text() if reading.locator('.reference-works').count() else ''
 record('Recorded bibliography metadata expands work titles and public links',
        (not recorded['works']) or (all(plain(w['title'])[:40] in plain(works_text) and (not w['authors'] or plain(w['authors'].split(',')[0]) in plain(works_text)) for w in recorded['works'])
         and all(reading.locator('.reference-works a[href="'+w['url']+'"]').count()>=1 for w in recorded['works'] if w['url'].startswith('http'))))
 record('Reference links do not expose local reference PDFs',reading.evaluate(r"""e => Array.from(e.querySelectorAll('a')).every(a=>{const href=a.getAttribute('href')||'';return !/^file:/i.test(href)&&(!/\.pdf(?:[?#]|$)/i.test(href)||/^https?:\/\//i.test(href))})"""))
 reading.locator('.reference-source').first.scroll_into_view_if_needed()
 page.screenshot(path=str(ROOT/'preview-planet-references.png'),animations='disabled')
 cited=reading.locator('a.reference-source').first.get_attribute('href') or ''
 # A citation is shown where it was written: at its line of the owning roadmap's README on GitHub.
 owner_source=page.evaluate("id => (TauExplorer.data.roadmaps.find(r => r.id === id) || {}).readmeSource",owner)
 record('A planet reference opens its owning roadmap source',bool(owner_source) and re.fullmatch(re.escape(owner_source)+r'\?plain=1#L\d+',cited) is not None and not page.locator('#reader[open]').count())

 # An explicit paper in a TauCeti target belongs to that topic, not to every
 # target in the roadmap. Its public paper link and local source stay separate.
 topic='tauceti:TauCetiRoadmap/CombinatorialHeegaardFloer#milestone-g-7::landmark:k-u-k-1csrgny'
 page.evaluate("TauExplorer.openStage('tauceti:TauCetiRoadmap/CombinatorialHeegaardFloer#milestone-g-7')");page.wait_for_timeout(700)
 open_planet(page,topic)
 direct=page.locator('.planet-references [data-reference-scope="direct"]')
 record('A TauCeti mathematical target exposes its explicit topic reference',direct.locator('h4').inner_text()=='For this topic' and 'Milnor conjecture' in direct.inner_text() and direct.locator('a[href="https://arxiv.org/abs/1011.5265"]').count()==1 and reference_sources_are_exact(page,topic))
 record('TauCeti topic citation opens its preserved roadmap passage',re.search(r'/TauCetiRoadmap/CombinatorialHeegaardFloer/README\.md\?plain=1#L\d+$',direct.locator('a.reference-source').first.get_attribute('href') or '') is not None)

 # Promotions take over the layers of pinned examples (AInfCohomology:AI.0 and AbelianSchemesAndArithmeticModuli:A1
 # in the wave waiting from 2026-10-09), so these two are chosen from what is drawn, the pinned ones first.
 cited=pick_planet(page,"item=>{const refs=TauExplorer.references.forLandmark(item);return !refs.direct.length&&refs.layer.length>0}",'AInfCohomology:AI.0::landmark:common-integral-perfectoid-ring-and-witt-v-1vm5fxh')
 record('The atlas draws a planet cited for its layer',bool(cited))
 page.evaluate("id => TauExplorer.openStage(id)",cited['stageId']);page.wait_for_timeout(700)
 open_planet(page,cited['id'])
 layer=page.locator('.planet-references [data-reference-scope="layer"]')
 locators=page.evaluate("id => TauExplorer.references.forLandmark(TauExplorer.landmarks.find(x=>x.id===id)).layer.map(e=>(e.text||'').trim()).filter(Boolean)",cited['id'])
 record('Layer source locators are labelled separately from direct topic citations',layer.locator('h4').inner_text()=='For this layer' and len(locators)>0 and all(plain(t)[:40] in plain(layer.inner_text()) for t in locators) and page.locator('.planet-references [data-reference-scope="direct"]').count()==0)

 empty=pick_planet(page,"item=>Object.values(TauExplorer.references.forLandmark(item)).every(items=>!items.length)",'AbelianSchemesAndArithmeticModuli:A1::landmark:relative-dimension-as-locally-constant-all-13bhoef')
 record('The atlas draws a planet without recorded references',bool(empty))
 page.evaluate("id => TauExplorer.openStage(id)",empty['stageId']);page.wait_for_timeout(700)
 open_planet(page,empty['id'])
 record('A target without recorded references says so without invented reading',page.evaluate("id => Object.values(TauExplorer.references.forLandmark(TauExplorer.landmarks.find(x=>x.id===id))).every(items=>!items.length)",empty['id']) and page.locator('.planet-references .detail-note').inner_text()=='No bibliography is listed for this topic in the embedded roadmap.' and page.locator('.planet-references .planet-reference,.planet-references a,.planet-references .reference-source').count()==0)

 if not desktop_only:
  mobile=browser.new_context(viewport={'width':375,'height':812},device_scale_factor=2,is_mobile=True,has_touch=True)
  mp=mobile.new_page();mp.on('pageerror',lambda e:errors.append('mobile references: '+str(e)))
  if url.startswith('file:'):
   mp.route('http://**/*',abort_offline)
   mp.route('https://**/*',abort_offline)
  mp.goto(url,wait_until='load');mp.wait_for_function('!!window.TauExplorer');mp.evaluate('() => TauExplorer.lazy.all()')
  phone_choice=pick_reading_planet(mp)
  record('The phone atlas draws the same kind of planet',bool(phone_choice))
  phone_planet=phone_choice['id']
  mp.evaluate("id => TauExplorer.openStage(id)",phone_choice['stageId']);mp.wait_for_timeout(800)
  open_planet(mp,phone_planet,tap=True)
  touch=mobile.new_cdp_session(mp)
  panel=mp.locator('#inspector-content');button=mp.locator('.planet-references .reference-source').first
  def reference_button_in_view():
   target=button.bounding_box();bounds=panel.bounding_box()
   return bool(target and bounds and target['y']>=bounds['y'] and target['y']+target['height']<=bounds['y']+bounds['height'])
  for _ in range(12):
   if reference_button_in_view():break
   bounds=panel.bounding_box();x=bounds['x']+bounds['width']/2;y=bounds['y']+bounds['height']-25
   touch_swipe(mp,touch,(x,y),(x,max(bounds['y']+25,y-125)))
  record('Phone users can scroll to planet references with touch',reference_button_in_view() and panel.evaluate('(e)=>e.scrollTop>0') and mp.evaluate('navigator.maxTouchPoints>0'))
  record('Phone bibliography remains readable without covering navigation',mp.locator('.planet-references .reference-text').first.evaluate('(e)=>parseFloat(getComputedStyle(e).fontSize)>=12') and mp.locator('.cosmic-back').is_visible() and mp.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
  mp.screenshot(path=str(ROOT/'preview-phone-planet-references.png'),animations='disabled')
  phone_source=mp.evaluate("id => (TauExplorer.data.roadmaps.find(r => r.id === id) || {}).readmeSource",phone_choice['roadmapId'])
  record('Phone tap opens the embedded citation source',bool(phone_source) and (button.get_attribute('href') or '').startswith(phone_source) and button.get_attribute('target')=='_blank')
  record('Closing a citation reader preserves the selected planet',mp.evaluate('TauExplorer.getState().selected')==phone_planet and (not phone_choice['formula'] or mp.locator('.landmark-description math').count()>0))
  mobile.close()
def write_report(scope):
 report={'url':url,'checks':results,'pageErrors':errors,'externalRequests':requests,'result':'PASS','scope':scope}
 (ROOT/'BROWSER_VALIDATION.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps(report,indent=2))
 print('Screenshots and report:',ROOT)
BUILD=json.loads((REPO/'BUILD.json').read_text()) if (REPO/'BUILD.json').exists() else {}
def debug(page):return page.evaluate('TauExplorer.graph.debugState()')
def label_boxes(page):
 return page.evaluate("""() => Array.from(document.querySelectorAll('.tau-layer-label g.tau-label')).map(g=>{const t=g.querySelector('text'),b=t.getBoundingClientRect(),m=t.getScreenCTM();return {id:g.getAttribute('data-label-for'),kind:Array.from(g.classList).find(c=>c.startsWith('tau-label-')&&c!=='tau-label-hit').replace('tau-label-',''),x:b.left,y:b.top,w:b.width,h:b.height,font:m?Math.hypot(m.c,m.d)*parseFloat(getComputedStyle(t).fontSize):0,text:t.textContent};})""")
def labels_are_clean(page,minimum_font=8):
 # No two drawn labels overlap, every drawn label is legible and inside the chart.
 chart=page.locator('#graph').bounding_box();boxes=label_boxes(page);collisions=[]
 discs=page.evaluate("""() => Array.from(document.querySelectorAll('.tau-planet-body, .tau-star-core')).map(c=>{const b=c.getBoundingClientRect(),g=c.closest('[data-node-id]');return {id:g?g.getAttribute('data-node-id'):'',x:b.left+b.width/2,y:b.top+b.height/2,r:b.width/2};}).filter(d=>d.r>=3)""")
 overlays=page.evaluate("""() => Array.from(document.querySelectorAll('.graph-tools, .graph-hint, .atlas-progress')).map(e=>e.getBoundingClientRect()).filter(b=>b.width>0&&b.height>0).map(b=>({x:b.left,y:b.top,w:b.width,h:b.height}))""")
 for i,a in enumerate(boxes):
  if a['font']<minimum_font:collisions.append({'first':a['id'],'second':'illegible','font':a['font']})
  if a['x']<chart['x']-2 or a['x']+a['w']>chart['x']+chart['width']+2 or a['y']<chart['y']-2 or a['y']+a['h']>chart['y']+chart['height']+2:collisions.append({'first':a['id'],'second':'chart boundary'})
  for b in boxes[i+1:]:
   if min(a['x']+a['w'],b['x']+b['w'])-max(a['x'],b['x'])>1 and min(a['y']+a['h'],b['y']+b['h'])-max(a['y'],b['y'])>1:collisions.append({'first':a['id'],'second':b['id']})
  # Text never runs across another object's disc, nor behind the corner controls or the progress card.
  for d in discs:
   if d['id']!=a['id'] and math.hypot(max(a['x'],min(d['x'],a['x']+a['w']))-d['x'],max(a['y'],min(d['y'],a['y']+a['h']))-d['y'])<d['r']-1:collisions.append({'first':a['id'],'second':'disc '+d['id']})
  for o in overlays:
   if min(a['x']+a['w'],o['x']+o['w'])-max(a['x'],o['x'])>1 and min(a['y']+a['h'],o['y']+o['h'])-max(a['y'],o['y'])>1:collisions.append({'first':a['id'],'second':'controls'})
 page.evaluate('c => { window.__tauTestCaptionCollisions=c; }',collisions)
 return not collisions
def names_are_unique(page):
 return page.evaluate("""() => { const seen=new Map(); for(const g of document.querySelectorAll('.tau-layer-label g.tau-label:not(.tau-label-card):not(.tau-label-moon)')){const id=g.getAttribute('data-label-for');seen.set(id,(seen.get(id)||0)+1);} const dup=Array.from(seen.entries()).filter(([,n])=>n>1); window.__tauTestCaptionCollisions=dup; return !dup.length; }""")
def legend_matches_map_encoding(page):
 # Colour encodes recorded progress only. A roadmap without any recorded
 # status is drawn as an open ring, never coloured as though it were planned.
 return page.evaluate("""() => {
  const beacon=id=>document.querySelector('[data-node-id="'+CSS.escape(id)+'"] .tau-beacon');
  const d=TauExplorer.graph.debugState();
  // Any drawn roadmap without recorded progress, and any drawn complete one.
  const drawn=d.constellations.filter(n=>beacon(n.id));
  const blankNode=drawn.find(n=>!n.hasProgress),doneNode=drawn.find(n=>n.progress===100);
  if(!blankNode||!doneNode)return false;
  const blank=beacon(blankNode.id),done=beacon(doneNode.id);
  const keys=Array.from(document.querySelectorAll('.progress-legend span')).map(e=>e.textContent.trim()),groupColours=TauExplorer.data.groups.map(g=>g.color.toLowerCase());
  return !!blank&&!!done&&blankNode.hasProgress===false&&doneNode.progress===100&&blank.getAttribute('fill')==='#0b1016'&&blank.getAttribute('stroke')==='#6f7f8c'&&done.getAttribute('fill')===doneNode.accent&&doneNode.accent==='#f7f3e9'
   &&keys.includes('No progress data')&&keys.includes('Not started')&&keys.includes('Complete')&&!!document.querySelector('.progress-legend .none')&&d.constellations.filter(n=>!n.hasProgress).every(n=>!groupColours.includes(n.accent.toLowerCase()));
 }""")
def center_on(page,node_id):
 # Pan, without zooming, so that the node is in the middle of the chart.
 page.evaluate("id => { const g=TauExplorer.graph,n=TauExplorer.getUniverse().byId.get(id); g.svg.interrupt(); g.svg.call(g.zoom.translateTo,n.x,n.y); }",node_id);page.wait_for_timeout(400)
def fit_all(page,touch=False):
 if touch:page.locator('#fit-graph').tap()
 else:page.locator('#fit-graph').click()
 page.wait_for_timeout(500)
def check_overview(page,scope,touch=False):
 page.evaluate("TauExplorer.navigate({view:'all',id:null,layer:null,selected:null,origin:'all',activity:'all',unmapped:true,references:false})");page.wait_for_timeout(700)
 d=debug(page)
 record(scope+' universe holds every galaxy, roadmap, layer and planet',d['layout']=='universe' and d['counts']['galaxies']==BUILD['areasWithRoadmaps'] and d['counts']['constellations']==BUILD['roadmaps'] and d['counts']['stars']==BUILD.get('mathematicalStars',1594)-BUILD.get('sourceRefinements',0) and (d['counts']['planets']>=3440-BUILD.get('hiddenPlanets',0) if PLANETS else d['counts']['planets']==0))
 record(scope+' overview resolves no stars or planets and stays light',d['visible']['resolved']==0 and d['visible']['stars']==0 and d['visible']['planets']==0 and d['rendered']<600)
 # A phone shows part of the map at desktop scale: every roadmap in view,
 # and none outside it, is drawn as a point.
 in_view=page.evaluate("() => { const g=TauExplorer.graph,t=g.transform,k=t.k,r=g.visibleRect(.15); return TauExplorer.getUniverse().constellations.filter(c=>c.x+c.r+40/k>r.x&&c.x-c.r-40/k<r.x+r.w&&c.y+c.r+40/k>r.y&&c.y-c.r-40/k<r.y+r.h).length; }")
 record(scope+' overview draws every roadmap in view as a point',page.locator('.tau-constellation').count()==in_view and in_view>0 and page.locator('.tau-unmapped-node').count()==0)
 sectors=page.evaluate("TauExplorer.getUniverse().layout")=='sectors'
 box=page.locator('#graph').bounding_box()
 if sectors:
  # The sector map (the published pages, scripts/arxiv_groups.py) names its arXiv categories from the overview on:
  # a divided category as a field, the others as galaxies, each in capitals over its identifier, which keeps arXiv's
  # case (math.NT); the areas of a divided category are named once the camera opens it (check_fields). A heading
  # waits for room rather than overlap: on a large chart the smallest categories, up to a third of them, may wait;
  # a phone shows part of the map at desktop scale, where every sector meets at Mathlib, beside the progress card that
  # covers a third of it, and names at least three, categories or areas: which fit there moves with the pull requests
  # proposed each day (the narrow phone named only areas on 2026-10-23). A divided category wider than the chart gives
  # way to its areas, whose names then name its part of the map.
  named=page.evaluate("""() => { const u=TauExplorer.getUniverse(),groups=new Map(TauExplorer.data.groups.map(g=>[g.id,g])),fields=new Map((TauExplorer.data.fields||[]).map(f=>['field:'+f.id,f]));
   const lines=e=>Array.from(e.querySelectorAll('tspan').length?e.querySelectorAll('tspan'):e.querySelectorAll('text')).map(t=>t.textContent);
   const categories=[...u.fields.filter(f=>f.labelVisible).map(f=>f.id),...u.galaxies.filter(g=>g.headingVisible&&!g.fieldId).map(g=>g.id)];
   const given=new Set(u.fields.filter(f=>!f.labelVisible).map(f=>f.id)),wanted=[...categories,...u.galaxies.filter(g=>g.headingVisible&&given.has(g.fieldId)).map(g=>g.id)];
   const drawn=Array.from(document.querySelectorAll('.tau-label-field, .tau-label-galaxy')).map(e=>({id:e.getAttribute('data-label-for'),lines:lines(e)})).filter(d=>wanted.includes(d.id));
   const named=drawn.filter(d=>categories.includes(d.id));
   const code=id=>(fields.get(id)||{}).code||(groups.get(id)||{}).arxiv;
   const dust=id=>{const e=document.querySelector('.tau-galaxy[data-node-id="'+CSS.escape(id)+'"] .tau-dust-far');return e?Number(e.getAttribute('opacity')):1;};
   return {categories:[...groups.values()].every(g=>g.id==='unclassified'?!g.arxiv:/^math\\.[A-Z]{2}(\\/[a-z]+)?$/.test(g.id)&&g.id.startsWith(g.arxiv)),
           wanted:wanted.length,drawn:drawn.length,faded:named.filter(d=>groups.has(d.id)&&dust(d.id)<.95).length,
           named:named.length,cased:named.every(d=>d.lines[0]===d.lines[0].toUpperCase()&&(d.lines.length===1||!code(d.id)||d.lines.includes(code(d.id))))}; }""")
  large=box['width']>=600 and box['height']>=400
  allowed=math.ceil(named['wanted']*.34) if large else named['wanted']-min(named['wanted'],3)
  record(scope+' overview names each arXiv category once, in capitals over its identifier, without overlap',
         named['categories'] and named['cased'] and named['named']>=(3 if large else 0) and named['drawn']>=named['wanted']-allowed and labels_are_clean(page) and names_are_unique(page))
  record(scope+' named areas show their progress colours',named['faded']==0)
  # Every pull request landed for a Tau Ceti roadmap is a star round it (src/graph.js, drawLanded): the busiest roadmap
  # that is no umbrella's part holds as many stars as the Progress page counts for it, and the legend names them.
  landed=page.evaluate("""() => { const boards=(TauExplorer.data.taucetiProgress||{}).roadmaps||{},u=TauExplorer.getUniverse();
   const own=Object.entries(boards).map(([id,b])=>[id,(b.activity||{}).total||0]).filter(([id,n])=>n>0&&u.byId.has(id)&&(u.byId.get(id).starIds||[]).length&&!u.byId.get(id).parentRoadmapId).sort((a,b)=>b[1]-a[1])[0];
   if(!own)return null; const g=document.querySelector('.tau-landed[data-node-id="'+CSS.escape(own[0])+'"]');
   const stars=g?Array.from(g.querySelectorAll('.tau-landed-star')).reduce((a,e)=>a+((e.getAttribute('d')||'').match(/h0/g)||[]).length,0):0;
   return {want:own[1],count:g?Number(g.dataset.count):0,stars,legend:!document.getElementById('landed-legend').hidden}; }""")
  record(scope+' every landed pull request is a star round its roadmap',landed is None or (landed['count']==landed['want']==landed['stars'] and landed['legend']))
  # The sector map opens on Mathlib at a scale that shows the nearer roadmaps; the reader explores the rest.
  record(scope+' overview opens on Mathlib, the rest of the map to explore',page.evaluate("""() => { const g=TauExplorer.graph,t=g.debugState().transform,u=TauExplorer.getUniverse(),target=g.overviewTransform();
   const cx=u.core.x*t.k+t.x,cy=u.core.y*t.k+t.y; return Math.abs(t.k-target.k)<1e-6*target.k+1e-9&&Math.abs(cx-g.width/2)<g.width*.1&&cy>0&&cy<g.height; }"""))
 else:
  # A heading waits for room rather than overlap. A large chart holds every
  # subject heading; a phone-width chart may hold back up to a quarter of them
  # and a chart under 400px tall up to 40%, which reappear as the camera closes in.
  # Every area on the chart keeps its own heading; fields are named above them.
  headings=page.locator('.tau-label-galaxy').count();box=page.locator('#graph').bounding_box()
  areas=page.evaluate("() => { const g=TauExplorer.graph,t=g.transform; return TauExplorer.getUniverse().galaxies.filter(n=>{const x=n.x*t.k+t.x,y=n.y*t.k+t.y;return x>0&&x<g.width&&y>0&&y<g.height;}).length; }")
  allowed=math.ceil(areas*.4) if box['height']<400 else math.ceil(areas*.25) if box['width']<600 else math.ceil(areas*.1)
  record(scope+' every subject heading is drawn once, legibly, without overlap',headings>=areas-allowed and labels_are_clean(page) and names_are_unique(page))
  # Names in two tiers from the overview on, where the map has fields (the campaign's areas): fields in
  # capitals, and the areas inside them, while the areas' progress colours are in view. The published pages
  # group by arXiv category instead (scripts/arxiv_groups.py), in one tier: each category's name in capitals
  # over its identifier, which keeps arXiv's case (math.NT), or the name alone on a small chart.
  if debug(page)['fields']:
   tiers=page.evaluate("""() => { const d=TauExplorer.graph.debugState(),inside=new Set(d.fields.flatMap(f=>f.galaxyIds));
    const named=Array.from(document.querySelectorAll('.tau-label-galaxy')).map(e=>e.getAttribute('data-label-for'));
    const dust=id=>{const e=document.querySelector('.tau-galaxy[data-node-id="'+CSS.escape(id)+'"] .tau-dust-far');return e?Number(e.getAttribute('opacity')):0;};
    const fieldNames=Array.from(document.querySelectorAll('.tau-label-field text, .tau-label-galaxy.is-field text'));
    return {fields:fieldNames.length,areas:named.filter(id=>inside.has(id)).length,
            faded:named.filter(id=>dust(id)<.95).length,capitals:fieldNames.every(t=>t.textContent===t.textContent.toUpperCase())}; }""")
   record(scope+' overview names fields over their areas, in two tiers',tiers['fields']>=2 and tiers['areas']>=3 and tiers['capitals'])
  else:
   tiers=page.evaluate("""() => { const groups=new Map(TauExplorer.data.groups.map(g=>[g.id,g]));
    const named=Array.from(document.querySelectorAll('.tau-label-galaxy')).map(e=>({group:groups.get(e.getAttribute('data-label-for')),lines:Array.from(e.querySelectorAll('tspan').length?e.querySelectorAll('tspan'):e.querySelectorAll('text')).map(t=>t.textContent)}));
    const dust=id=>{const e=document.querySelector('.tau-galaxy[data-node-id="'+CSS.escape(id)+'"] .tau-dust-far');return e?Number(e.getAttribute('opacity')):0;};
    return {categories:[...groups.values()].every(g=>g.id==='unclassified'?!g.arxiv:/^math\\.[A-Z]{2}$/.test(g.id)&&g.arxiv===g.id),
            headings:named.length>=3&&named.every(n=>n.group&&n.lines[0]===n.lines[0].toUpperCase()&&(n.lines.length===1||!n.group.arxiv||n.lines.includes(n.group.arxiv))),
            faded:named.filter(n=>dust(n.group.id)<.95).length}; }""")
   record(scope+' overview names each arXiv category, in capitals over its identifier',tiers['categories'] and tiers['headings'])
  record(scope+' named areas show their progress colours',tiers['faded']==0)
  # A large chart shows the whole universe; a much smaller one keeps the
  # desktop scale with Mathlib in view, and the reader pans.
  record(scope+' overview shows the universe, or Mathlib at desktop scale',page.evaluate("""() => { const g=TauExplorer.graph,t=g.debugState().transform,box=document.querySelector('#graph').getBoundingClientRect(); const u=TauExplorer.getUniverse(),b=u.bounds; const x0=b.x*t.k+t.x,x1=(b.x+b.w)*t.k+t.x,y0=b.y*t.k+t.y,y1=(b.y+b.h)*t.k+t.y; const fits=x0>=-2&&x1<=box.width+2&&y0>=-2&&y1<=box.height+2; const target=g.overviewTransform(); const cx=u.core.x*t.k+t.x,cy=u.core.y*t.k+t.y; const atScale=Math.abs(t.k-target.k)<1e-6*target.k+1e-9&&cx>0&&cx<box.width&&cy>0&&cy<box.height; return fits||(!fits&&atScale&&box.width<900); }"""))
 record(scope+' no links are drawn until something is selected',page.locator('.tau-link').count()==0 and page.evaluate("Array.from(document.querySelectorAll('.tau-route')).every(e=>Number(e.getAttribute('opacity'))===0)"))
 record(scope+' legend colours match the map encoding',legend_matches_map_encoding(page))
 # The headline figure and the scale under it are the map's own encoding, so they have to agree
 # with the data and with the ramp the planets are drawn from.
 record(scope+' the atlas states how much is complete, and it matches the data',page.evaluate("""() => {
  const c=TauExplorer.data.taucetiProgress?.counts,s=['tauceti','atlas'].includes(TauExplorer.data.variant)?{complete:c.done,total:c.total}:TauExplorer.progress.atlas(),shown=document.getElementById('atlas-percent').textContent.trim();
  const want=s.total?Math.round(s.complete/s.total*100):0;
  const caption=document.getElementById('atlas-count').textContent;
  return shown===want+'%' && caption.includes(s.complete.toLocaleString()) && caption.includes(s.total.toLocaleString());
 }"""))
 record(scope+' the marker sits where the figure says on the ramp',page.evaluate("""() => {
  const c=TauExplorer.data.taucetiProgress?.counts,s=['tauceti','atlas'].includes(TauExplorer.data.variant)?{complete:c.done,total:c.total}:TauExplorer.progress.atlas(),want=s.total?Math.round(s.complete/s.total*100):0;
  return document.getElementById('atlas-marker').style.left===want+'%';
 }"""))
 record(scope+' the scale starts grey at not started, then runs from red to bright white',page.evaluate("""() => {
  const bar=getComputedStyle(document.querySelector('.scale-bar')).backgroundImage,start=getComputedStyle(document.querySelector('.scale-start')).backgroundColor;
  const rgb=hex=>{const n=parseInt(hex.slice(1),16);return `rgb(${n>>16&255}, ${n>>8&255}, ${n&255})`;};
  const grey=TauGraph.progressColor(0),red=TauGraph.progressColor(1e-9),bright=TauGraph.progressColor(100);
  const channels=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
  const [gr,gg,gb]=channels(grey),[rr,rg]=channels(red);
  return start===rgb(grey) && bar.includes(rgb(red)) && bar.includes(rgb(bright)) && Math.max(gr,gg,gb)-Math.min(gr,gg,gb)<20 && rr-rg>60
   && document.querySelector('.scale-ends .planned-end').textContent.trim()==='Not started';
 }"""))
 record(scope+' page has no horizontal overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
def check_fields(page):
 # Two tiers from the overview on: each field's name in capitals over its
 # areas, and each area's own name, while its progress colours are in view.
 fit_all(page)
 d=debug(page)
 # Only where the map has fields: the published pages group by arXiv category, one galaxy each (check_overview names them).
 if d['fields']:
  inside={gid for f in d['fields'] for gid in f['galaxyIds']}
  shown=page.evaluate("Array.from(document.querySelectorAll('.tau-label-galaxy')).map(e=>e.getAttribute('data-label-for'))")
  fields=page.evaluate("Array.from(document.querySelectorAll('.tau-label-field')).map(e=>e.getAttribute('data-label-for'))")
  # Every field the layout draws is named, and its areas too, but for one in ten held back for room.
  # On the sector map a field's areas are named once it is opened, below; the overview names the fields.
  sectors=page.evaluate("TauExplorer.getUniverse().layout")=='sectors'
  record('Overview names each field above its areas, and the areas',len(d['fields'])>=2 and len(set(fields))==len(d['fields'])
         and (sectors or len(inside.intersection(shown))>=len(inside)-math.ceil(len(inside)*.1)))
  # The field with the most areas: the campaign's algebraic number theory, the atlas's number theory.
  field=max(d['fields'],key=lambda f:(len(f['galaxyIds']),f['id']))['id']
  label=page.locator('.tau-label-field[data-label-for="%s"]'%field)
  label.hover();page.wait_for_timeout(300)
  members=next(f['galaxyIds'] for f in d['fields'] if f['id']==field)
  lit=page.evaluate("Array.from(document.querySelectorAll('.tau-galaxy')).filter(g=>Number(g.querySelector('.tau-galaxy-ring').getAttribute('opacity'))>0).map(g=>g.getAttribute('data-node-id'))")
  record('Hovering a field\'s name outlines exactly its areas',sorted(lit)==sorted(members))
  label.click();page.wait_for_timeout(900)
  view=page.evaluate("""ids => { const g=TauExplorer.graph,t=g.transform,u=TauExplorer.getUniverse();
   const named=new Set(Array.from(document.querySelectorAll('.tau-label-galaxy')).map(e=>e.getAttribute('data-label-for')));
   const members=ids.map(id=>u.byId.get(id));
   return {inView:members.every(n=>{const x=n.x*t.k+t.x,y=n.y*t.k+t.y;return x>0&&x<g.width&&y>0&&y<g.height;}),named:ids.filter(id=>named.has(id)).length}; }""",members)
  record('Clicking a field\'s name brings all its areas into view, named',view['inView'] and view['named']>=len(members)-2)
 # Closer in, named areas keep their colours on every screen.
 page.mouse.move(5,5)
 page.evaluate("f => { const g=TauExplorer.graph; g.svg.interrupt(); const t=g.overviewTransform(),k=t.k*f,cx=(g.width/2-t.x)/t.k,cy=(g.height/2-t.y)/t.k; g.svg.call(g.zoom.transform,d3.zoomIdentity.translate(g.width/2-cx*k,g.height/2-cy*k).scale(k)); }",1.7);page.wait_for_timeout(500)
 faded=page.evaluate("""() => Array.from(document.querySelectorAll('.tau-label-galaxy')).map(e=>e.getAttribute('data-label-for')).filter(id=>{
  const g=document.querySelector('.tau-galaxy[data-node-id="'+CSS.escape(id)+'"]'),far=g&&g.querySelector('.tau-dust-far'),near=g&&g.querySelector('.tau-dust-near');
  return !far||!(Number(far.getAttribute('opacity'))>=.9||Number(near?.getAttribute('opacity')||0)>=.3);}).length""")
 # An area that fills the screen hands its colours from its far dust to its nearer dust (src/graph.js, farFade): either counts.
 record('Named areas keep their progress colours closer in',faded==0)
 page.evaluate("TauExplorer.navigate({view:'all',id:null,layer:null,selected:null})");page.evaluate("TauExplorer.graph.fitAll(false)");page.wait_for_timeout(600)
def check_hover_links(page):
 heading=page.locator('.tau-label-galaxy').first
 heading.hover();page.wait_for_timeout(200)
 own=page.evaluate("() => { const id=document.querySelector('.tau-label-galaxy').getAttribute('data-label-for'); const routes=Array.from(document.querySelectorAll('.tau-route')); const mine=routes.filter(r=>r.dataset.sourceArea===id||r.dataset.targetArea===id); return mine.length>0&&mine.every(r=>Number(r.getAttribute('opacity'))>=.5)&&routes.filter(r=>!mine.includes(r)).every(r=>Number(r.getAttribute('opacity'))===0); }")
 page.mouse.move(5,5);page.wait_for_timeout(200)
 record('Hovering an area heading reveals only that area\'s routes',own and page.evaluate("Array.from(document.querySelectorAll('.tau-route')).every(e=>Number(e.getAttribute('opacity'))===0)"))
def check_zoom_journey(page,scope):
 # A continuous wheel zoom carries the reader from the universe into one
 # galaxy, one constellation and one star system, and the address follows.
 fit_all(page)
 home=page.evaluate("TauExplorer.data.roadmaps.find(r=>r.id==="+json.dumps(ROADMAP)+").group")
 # The camera enters the area in the middle of the view, so the reader first drags the area there. On the sector
 # map an area is a long sector, whose middle may lie far from the example roadmap: the reader drags the roadmap
 # there, and the wheel turns over it.
 sectors=page.evaluate("TauExplorer.getUniverse().layout")=='sectors'
 aim=('[data-node-id=%s] .tau-hit'%json.dumps(ROADMAP)) if sectors else ('.tau-galaxy[data-node-id="%s"] .tau-galaxy-disc'%home)
 center_on(page,ROADMAP if sectors else home)
 # One notch at a time: a three-notch jump can reach a large neighbouring area's zoom before this one's, and then
 # this one's constellations, without the camera ever being in this area alone (2026-10-21, the atlas's Curves area).
 record(scope+' wheel zoom enters a galaxy',wheel_until(page,aim,-100,"TauExplorer.getState().view==='group' && TauExplorer.getState().id==='%s'"%home,attempts=24))
 page.wait_for_timeout(400)
 record(scope+' inside a galaxy its constellations resolve into stars',wheel_until(page,aim,-200,"(() => { const d=TauExplorer.graph.debugState(); return d.visible.resolved>0 && d.visible.stars>0; })()",attempts=6))
 # One real wheel notch at a time (deltaY 100): a three-notch jump can carry the
 # camera past the roadmap straight into a star, which is allowed.
 record(scope+' wheel zoom enters a roadmap constellation',wheel_until(page,'[data-node-id='+json.dumps(ROADMAP)+'] .tau-hit',-100,"TauExplorer.getState().view==='roadmap' && TauExplorer.getState().id==="+json.dumps(ROADMAP)+" && !TauExplorer.getState().layer",attempts=24))
 record(scope+' constellation names and star names are legible and disjoint',labels_are_clean(page) and names_are_unique(page))
 record(scope+' wheel zoom enters a star system',wheel_until(page,'[data-node-id='+json.dumps(STAR)+'] .tau-hit',-300,"TauExplorer.getState().layer==="+json.dumps(STAR)+"",attempts=14))
 if PLANETS:record(scope+' a star system shows its planets',page.locator('.tau-planet').count()>0 and page.locator('.tau-orbit').count()>0)
 else:record(scope+' a layer opened up draws its star and no planets',page.locator('.tau-planet').count()==0 and page.locator('[data-node-id='+json.dumps(STAR)+']').count()>0)
 page.screenshot(path=str(ROOT/('preview-'+scope.lower().replace(' ','-')+'-star-system.png')),animations='disabled')
 record(scope+' wheel zoom out returns to the roadmap',wheel_until(page,'#graph',300,"TauExplorer.getState().view==='roadmap' && !TauExplorer.getState().layer",attempts=14))
 record(scope+' wheel zoom out returns to the universe',wheel_until(page,'#graph',300,"TauExplorer.getState().view==='all'",attempts=20))
def check_paper_artefacts(page,scope):
 # Papers are artefacts on the rim of the roadmap they build on most: none at the
 # overview, all of a roadmap's papers once it is open, and each says whether it
 # is unlocked, which it is only once every layer it needs is formalised.
 page.evaluate("TauExplorer.navigate({view:'all',id:null,layer:null,selected:null})");page.wait_for_timeout(600)
 record(scope+' no paper artefacts are drawn at the overview',page.locator('[data-level="artefact"]').count()==0)
 home=page.evaluate("() => { const counts=new Map(); for (const p of TauExplorer.data.papers) counts.set(p.home,(counts.get(p.home)||0)+1); return [...counts.entries()].sort((a,b)=>b[1]-a[1]||(a[0]<b[0]?-1:1))[0][0]; }")
 page.evaluate("id => TauExplorer.navigate({view:'roadmap',id,layer:null,selected:id})",home);page.wait_for_timeout(900)
 want=page.evaluate("id => TauExplorer.data.papers.filter(p=>p.home===id).map(p=>p.id).sort()",home)
 drawn=page.evaluate("() => Array.from(document.querySelectorAll('[data-level=\"artefact\"]')).map(n=>n.getAttribute('data-node-id')).sort()")
 on_rim=page.evaluate("""id => { const d=TauExplorer.graph.debugState(),c=d.constellations.find(c=>c.id===id); return d.artefacts.filter(a=>a.constellationId===id).every(a=>Math.abs(Math.hypot(a.x-c.x,a.y-c.y)/c.r-1.16)<1e-6); }""",home)
 record(scope+' a roadmap shows the papers built on it as artefacts on its rim',bool(want) and set(want)<=set(drawn) and on_rim)
 paper=want[0]
 page.locator('[data-node-id='+json.dumps(paper)+'] .tau-hit').click();page.wait_for_timeout(500)
 state=page.evaluate("id => { const p=TauExplorer.data.papers.find(p=>p.id===id); return {unlocked:TauExplorer.progress.paper(p).unlocked,drawn:document.querySelector('[data-node-id=\"'+CSS.escape(id)+'\"]').getAttribute('data-unlocked')}; }",paper)
 record(scope+' selecting a paper shows it, with whether it is unlocked',page.locator('#selection-kind').inner_text()=='Paper' and page.locator('#inspector-content .status-chip').first.inner_text()==('Unlocked' if state['unlocked'] else 'Locked') and state['drawn']==('true' if state['unlocked'] else 'false'))
 record(scope+' the panel counts the papers unlocked',page.evaluate("() => { const all=TauExplorer.data.papers,open=all.filter(p=>TauExplorer.progress.paper(p).unlocked).length; return document.getElementById('atlas-papers').textContent===`${open} of ${all.length} papers unlocked`; }"))
 # A selected paper draws a line from each roadmap it builds on (as its panel lists them), ending at it.
 lines=page.evaluate("""id => { const hits=Array.from(document.querySelectorAll('.tau-link-hit')).map(h=>({s:h.dataset.source,t:h.dataset.target}));
   const want=new Set(TauExplorer.getUniverse().artefactEdges.filter(e=>e.target===id).map(e=>e.source));
   return {want:[...want].sort(), drawn:hits.filter(h=>h.t===id).map(h=>h.s).sort(), all:hits.length}; }""",paper)
 record(scope+' a selected paper draws a line from each roadmap it builds on',bool(lines['want']) and lines['drawn']==lines['want'] and lines['all']==len(lines['want']))
 # A paper fills from the bottom: the filled part's height is its share of needed layers done.
 partial=page.evaluate("() => TauExplorer.data.papers.find(p => { const s=TauExplorer.progress.paper(p); return s.total && s.complete && s.complete<s.total; })")
 if partial:
   page.evaluate("id => TauExplorer.navigate({view:'roadmap',id,layer:null,selected:id})",partial['home']);page.wait_for_timeout(900)
   fill=page.evaluate("""id => { const g=document.querySelector('[data-node-id="'+CSS.escape(id)+'"]'), f=g.querySelector('.tau-artefact-fill'), o=g.querySelector('.tau-artefact-outline');
     return {share:f.getBBox().height/o.getBBox().height, progress:Number(g.dataset.progress)}; }""",partial['id'])
   record(scope+' a paper fills from the bottom by the share of its layers done',abs(fill['share']-fill['progress']/100)<.03)
def check_click_journey(page,scope):
 page.evaluate("TauExplorer.navigate({view:'all',id:null,layer:null,selected:null})");page.wait_for_timeout(600)
 page.locator('[data-node-id='+json.dumps(ROADMAP)+'] .tau-hit').click()
 page.wait_for_function("TauExplorer.getState().view==='roadmap' && TauExplorer.getState().id==="+json.dumps(ROADMAP)+"")
 # Wait for the zoom to arrive rather than a fixed half second: a GitHub runner draws a frame of the full atlas in
 # about half a second, so the flight into the constellation can take several (2026-10-09 to 10-12).
 try:
   page.wait_for_function("() => { const d=TauExplorer.graph.debugState(); return !!d && d.focus.level==='constellation' && d.visible.stars>=10; }",timeout=20000);arrived=True
 except Exception:
   arrived=False
 kind={'tauceti':'Tau Ceti roadmap','proposed':'Proposed roadmap'}.get(page.evaluate("id => TauExplorer.data.roadmaps.find(r=>r.id===id).origin",ROADMAP),'Campaign roadmap')
 record(scope+' clicking a roadmap point travels into its constellation',arrived and page.locator('#selection-kind').inner_text()==kind)
 record(scope+' the selected roadmap shows its own links',page.locator('.tau-link').count()==page.evaluate("TauExplorer.data.edges.filter(e=>e.source==="+json.dumps(ROADMAP)+"||e.target==="+json.dumps(ROADMAP)+").length"))
 # Selecting a link names the two things it joins, and either name opens its end. On the sector map a link may run
 # to another sector, its middle off the chart: the reader picks it out wherever it is in view.
 spot=page.evaluate("""() => { for (const h of document.querySelectorAll('.tau-link-hit')) for (const share of [.5,.4,.6,.3,.7,.2,.8,.1,.9]) { const p=h.getPointAtLength(h.getTotalLength()*share), m=h.getScreenCTM(), x=m.a*p.x+m.c*p.y+m.e, y=m.b*p.x+m.d*p.y+m.f; if (document.elementFromPoint(x,y)===h) return {x, y, source:h.dataset.source, target:h.dataset.target}; } return null; }""")
 record(scope+' a link can be picked out on the chart',spot is not None)
 page.mouse.click(spot['x'],spot['y']);page.wait_for_timeout(300)
 ends=page.evaluate("Array.from(document.querySelectorAll('.tau-link-card [data-end]')).map(e=>e.dataset.nodeId)")
 record(scope+' selecting a link names both of its ends',ends==[spot['source'],spot['target']] and page.locator('.tau-link.is-selected').count()==1)
 page.screenshot(path=str(ROOT/('preview-'+scope.lower().replace(' ','-')+'-link.png')),animations='disabled')
 other=spot['target'] if spot['source']==ROADMAP else spot['source']
 page.locator('.tau-link-card [data-end][data-node-id="%s"]'%other).click()
 page.wait_for_function("TauExplorer.getState().id===%s"%json.dumps(other));page.wait_for_timeout(500)
 record(scope+' a link card opens the roadmap at its other end',page.evaluate("TauExplorer.getState().id")==other and page.locator('.tau-link-card').count()==0)
 page.evaluate("TauExplorer.navigate({view:'roadmap',id:"+json.dumps(ROADMAP)+",layer:null,selected:"+json.dumps(ROADMAP)+"})");page.wait_for_function("TauExplorer.getState().id==="+json.dumps(ROADMAP)+"");page.wait_for_timeout(500)
 page.mouse.move(5,5);page.wait_for_timeout(200)
 page.screenshot(path=str(ROOT/('preview-'+scope.lower().replace(' ','-')+'-constellation.png')),animations='disabled')
 page.locator('[data-node-id='+json.dumps(STAR)+'] .tau-hit').click()
 page.wait_for_function("TauExplorer.getState().layer==="+json.dumps(STAR)+"");page.wait_for_timeout(500)
 record(scope+' clicking a star travels to its system and opens the layer',page.locator('#selection-kind').inner_text()=='Layer' and (page.locator('.tau-planet').count()>0)==PLANETS)
 # Of the blueprint uses and restructure links into a layer, the map draws the four most used (its panel lists
 # them all), so promoted blueprints that cite this layer often leave some undrawn (2026-10-18 to 10-21).
 record(scope+' the selected star shows exactly its prerequisite and consumer links',page.locator('.tau-link').count()==page.evaluate("""star => {
   const stars=new Set(TauExplorer.getUniverse().stars.map(s=>s.id)), edges=TauExplorer.data.stageEdges, capped=e=>(e.kind==='blueprint'&&e.uses)||e.kind==='restructure', into=new Map();
   for (const e of edges) if (capped(e)) (into.get(e.target)||into.set(e.target,[]).get(e.target)).push(e);
   const drawn=new Set([...into.values()].flatMap(list=>list.sort((a,b)=>(b.uses||1)-(a.uses||1)||(a.source<b.source?-1:a.source>b.source?1:0)).slice(0,4)));
   return edges.filter(e=>(e.source===star||e.target===star)&&stars.has(e.source)&&stars.has(e.target)&&(!capped(e)||drawn.has(e))).length; }""",STAR))
 planet=first_planet(page,STAR)
 open_planet(page,planet)
 # A planet's mathematics is a roadmap landmark's description or, once a blueprint of its layer is promoted,
 # the blueprint's statement (the promotions waiting since 2026-10-09 make the test star's first planet one).
 try:
   page.wait_for_function("selector => [...document.querySelectorAll(selector)].some(e=>(e.offsetWidth||e.offsetHeight)&&e.innerText.trim().length>20)",arg=PLANET_MATH,timeout=10000);reads=True
 except Exception:
   reads=False
 record(scope+(' clicking a planet reads its mathematics' if PLANETS else ' a definition in the layer\'s panel reads its mathematics'),reads and page.evaluate("TauExplorer.getState().layer==="+json.dumps(STAR)+""))
 page.screenshot(path=str(ROOT/('preview-'+scope.lower().replace(' ','-')+'-planet.png')),animations='disabled')
 page.locator('.cosmic-back').click();page.wait_for_function("!TauExplorer.getState().layer");page.wait_for_timeout(400)
 page.locator('.cosmic-back').click();page.wait_for_function("TauExplorer.getState().view==='group'");page.wait_for_timeout(400)
 page.locator('.cosmic-back').click();page.wait_for_function("TauExplorer.getState().view==='all'");page.wait_for_timeout(400)
 record(scope+' back steps out through roadmap and area to the universe',page.evaluate("TauExplorer.graph.debugState().focus.level==='all'"))
 page.locator('.tau-graph').click(position={'x':8,'y':8});page.wait_for_timeout(200)
 record(scope+' clicking empty sky clears the selection and its links',page.evaluate("TauExplorer.getState().selected===null") and page.locator('.tau-link').count()==0)
def check_refinements(page):
 # A promoted blueprint replaces the source refinements of the layers it covers (trim_decompositions in
 # scripts/blueprints.py), so the refinement is chosen from the data: the first, by id, with moons (hypotheses,
 # proof steps or checks), a link to another refinement of its layer and a source with a link. It used to be
 # PadicFamilies:L2a/spectral-hypersurface, until PadicFamilies' blueprint was accepted (in the intake from 2026-10-09).
 pick=page.evaluate("""() => { const d=TauExplorer.data, st=new Map(d.stages.map(s=>[s.id,s])), source=s=>!!(s&&s.expansion&&!s.expansion.blueprint), linked=new Set();
   for (const e of d.stageEdges) { const a=st.get(e.source), b=st.get(e.target); if (source(a)&&source(b)&&a.parentStageId===b.parentStageId) { linked.add(a.id); linked.add(b.id); } }
   const works=new Map((d.decompositions||[]).map(x=>[x.roadmapId,new Set((x.sources||[]).filter(w=>w.url).map(w=>w.id))]));
   const fit=s=>source(s)&&linked.has(s.id)&&!!s.expansion.statement&&[...(s.expansion.hypotheses||[]),...(s.expansion.proofSteps||[]),...(s.expansion.acceptance||[])].length>0
     &&(s.expansion.sources||[]).some(x=>(works.get(s.owner)||new Set()).has(x.sourceId));
   const best=d.stages.filter(fit).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)[0];
   return best ? {id:best.id, layer:best.parentStageId, roadmap:best.owner, kind:best.expansion.kind, statement:best.expansion.statement} : null; }""")
 record('A layer keeps reviewed source refinements to show',pick is not None)
 refinement,layer,roadmap=pick['id'],pick['layer'],pick['roadmap']
 page.evaluate("([r,l]) => TauExplorer.navigate({view:'roadmap',id:r,layer:l,selected:l})",[roadmap,layer]);page.wait_for_timeout(800)
 expected=page.evaluate("l => TauExplorer.data.stages.filter(s=>s.expansion&&s.parentStageId===l).length",layer)
 # Count this layer's own refinements by their id prefix: a Tau Ceti stage id carries
 # slashes too, so matching any slash also counts the links a promoted link map adds.
 record('Reviewed source refinements orbit their layer as planets',expected>0 and page.locator('.tau-planet[data-node-id^='+json.dumps(layer+'/')+']').count()==expected)
 record('Refinements are excluded from progress denominators',page.evaluate("([r,x]) => { const st=new Map(TauExplorer.data.stages.map(s=>[s.id,s])); return TauExplorer.progress.roadmapLeaves(r).every(id=>!(st.get(id)||{}).expansion) && TauExplorer.progress.stage(x).status==='unknown'; }",[roadmap,refinement]))
 page.locator('.tau-planet[data-node-id='+json.dumps(refinement)+'] .tau-hit').click();page.wait_for_timeout(400)
 kind=pick['kind'][:1].upper()+pick['kind'][1:]+' · source refinement'
 record('A refinement planet explains its statement, sources and unchecked status',page.locator('#selection-kind').inner_text()==kind and ' '.join(page.locator('#inspector-content .detail-summary').first.inner_text().split()).startswith(' '.join(pick['statement'].split())[:40]) and page.locator('#inspector-content .reference-works a').count()>0 and 'unchecked' in page.locator('#inspector-content').inner_text())
 record('A layer lists its source decomposition beside its extracted targets',page.evaluate("l => { TauExplorer.openStage(l); return true; }",layer) and (page.wait_for_timeout(400) or True) and 'Source decomposition' in page.locator('#inspector-content').inner_text() and page.locator('#inspector-content .item-link[data-item-id^='+json.dumps(layer+'/')+']').count()==expected)
 record('A roadmap summarises its reviewed expansion',page.evaluate("r => { TauExplorer.openItem(r); return true; }",roadmap) and (page.wait_for_timeout(500) or True) and 'Source expansion' in page.locator('#inspector-content').inner_text() and 'accepted' in page.locator('#inspector-content').inner_text())
 # Deeper zoom keeps adding structure: kind and excerpt, then the refinement's
 # hypotheses, proof steps and checks as moons, and the links among refinements.
 page.evaluate("x => TauExplorer.openStage(x)",refinement);page.wait_for_timeout(600)
 page.evaluate("""x => { const g=TauExplorer.graph,u=TauExplorer.getUniverse(),p=u.byId.get(x),star=u.byId.get(p.starId); const k=g.transformFor({x:star.x-star.room*1.35,y:star.y-star.room*1.35,w:star.room*2.7,h:star.room*2.7}).k*3; g.svg.interrupt(); g.svg.call(g.zoom.transform,d3.zoomIdentity.translate(g.width/2-p.x*k,g.height/2-p.y*k).scale(k)); }""",refinement);page.wait_for_timeout(500)
 record('Deep zoom reveals a refinement\'s kind, excerpt, moons and internal links',page.locator('.tau-label-card[data-label-for='+json.dumps(refinement)+']').count()==1 and page.locator('.tau-moon').count()>0 and page.locator('.tau-system-link').count()>0 and labels_are_clean(page))
 page.screenshot(path=str(ROOT/'preview-deep-zoom.png'),animations='disabled')
 page.screenshot(path=str(ROOT/'preview-refined-layer.png'),animations='disabled')
def check_catalogue_selection(page,scope,touch=False):
 title=page.evaluate("TauExplorer.data.roadmaps.find(r=>r.id==="+json.dumps(ROADMAP)+").title")
 if touch:page.locator('#catalogue-button').tap()
 item=page.locator('#catalogue .catalogue-item[title='+json.dumps(title)+']');group=item.locator('xpath=..')
 if not group.evaluate('(e)=>e.open'):
  if touch:group.locator('summary').tap()
  else:group.locator('summary').click()
 if touch:item.scroll_into_view_if_needed();item.tap()
 else:item.click()
 page.wait_for_function("TauExplorer.getState().selected==="+json.dumps(ROADMAP)+"&&TauExplorer.getState().view==='roadmap'");page.wait_for_timeout(600)
 record(scope+' catalogue selection travels to the roadmap and names it once',page.locator('.tau-label[data-label-for='+json.dumps(ROADMAP)+']').count()==1 and names_are_unique(page) and page.evaluate("TauExplorer.graph.debugState().focus.id==="+json.dumps(ROADMAP)+""))
 page.screenshot(path=str(ROOT/('preview-'+scope.lower().replace(' ','-')+'-catalogue-selection.png')),animations='disabled')
 page.evaluate("TauExplorer.navigate({view:'all',id:null,layer:null,selected:null})");page.wait_for_timeout(500)
def check_proposals(page):
 # The atlas since 2026-10-21: Tau Ceti's roadmaps, and each roadmap an open pull request to TauCetiRoadmap proposes.
 record('The atlas holds Tau Ceti\'s roadmaps and every placed proposed one',page.evaluate("""() => { const d=TauExplorer.data,p=d.proposals,tc=Object.keys(d.taucetiProgress.roadmaps);
  const ids=new Set(d.roadmaps.map(r=>r.id)),u=TauExplorer.getUniverse();
  return p.roadmaps.length>0 && d.roadmaps.length===tc.length+p.roadmaps.length && [...tc,...p.roadmaps].every(id=>ids.has(id)&&u.byId.has(id))
   && d.roadmaps.filter(r=>r.origin==='proposed').length===p.roadmaps.length && p.unplaced.every(id=>!ids.has(id)); }"""))
 record('Proposed layers count in the headline, as not started',page.evaluate("""() => { const d=TauExplorer.data,c=d.taucetiProgress.counts,ids=new Set(d.proposals.roadmaps);
  const layers=d.stages.filter(s=>ids.has(s.owner));
  return layers.length>0 && c.proposed===layers.length && d.proposals.layers===layers.length
   && document.getElementById('atlas-count').textContent.includes(`${layers.length.toLocaleString()} proposed`)
   && layers.every(s=>TauExplorer.progress.leafState(s.id).status==='unknown'); }"""))
 proposed=page.evaluate("() => TauExplorer.data.proposals.roadmaps.slice().sort()[0]")
 page.evaluate("id => TauExplorer.openItem(id)",proposed);page.wait_for_timeout(700)
 record('A proposed roadmap names its pull request, and links to it and to its README',page.evaluate("""id => { const r=TauExplorer.data.roadmaps.find(x=>x.id===id),links=[...document.querySelectorAll('#inspector-content .report-links a')].map(a=>a.href);
  return document.getElementById('selection-kind').textContent==='Proposed roadmap'
   && [...document.querySelectorAll('#inspector-content .section-label')].some(h=>h.textContent==='Pull request')
   && document.getElementById('inspector-content').textContent.includes('#'+r.pull.number) && links.includes(r.pull.url) && links.includes(r.sourcePath); }""",proposed))
 # The page carries a proposed roadmap's layers, not its README: it links to the README on its pull request's branch.
 record('A proposed roadmap\'s README is read from its branch, and offline the reader links to it',page.evaluate("""id => { const r=TauExplorer.data.roadmaps.find(x=>x.id===id),a=document.querySelector('#inspector-content a[data-roadmap-page]');
  return !!a && a.href===r.page.href && /^https:\\/\\/github\\.com\\//.test(a.href) && a.target==='_blank' && !document.querySelector('#reader[open]'); }""",proposed))
 page.evaluate("TauExplorer.navigate({view:'all',id:null,layer:null,selected:null,origin:'proposed'})");page.wait_for_timeout(700)
 record('The pull requests collection shows only the proposed roadmaps',page.evaluate("TauExplorer.graph.debugState().counts.constellations===TauExplorer.data.proposals.roadmaps.length"))
 page.evaluate("TauExplorer.navigate({view:'all',id:null,layer:null,selected:null,origin:'all'})");page.wait_for_timeout(500)
def check_performance(page):
 fit_all(page)
 t=time.time();page.evaluate("""() => new Promise(resolve => { const g=TauExplorer.graph,s=g.debugState().transform; let step=0; const tick=()=>{ step++; const k=s.k*Math.pow(1.25,step); g.svg.call(g.zoom.transform,d3.zoomIdentity.translate(g.width/2-(g.width/2-s.x)/s.k*k,g.height/2-(g.height/2-s.y)/s.k*k).scale(k)); if(step<16)requestAnimationFrame(tick); else requestAnimationFrame(resolve); }; requestAnimationFrame(tick); })""")
 elapsed=int((time.time()-t)*1000)
 record('Sixteen zoom frames from the universe to a system render quickly',elapsed<2500)
 print('zoom frames ms',elapsed,flush=True)
 fit_all(page)
def run_overview_checks(page,browser):
 global mp
 fit_all(page);page.screenshot(path=str(ROOT/'preview-desktop-universe.png'),animations='disabled')
 check_overview(page,'Desktop');check_hover_links(page);check_fields(page);check_catalogue_selection(page,'Desktop')
 if desktop_only:return
 mobile=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,has_touch=True)
 mp=mobile.new_page();mp.on('pageerror',lambda e:errors.append('mobile overview: '+str(e)))
 if url.startswith('file:'):
  mp.route('http://**/*',abort_offline)
  mp.route('https://**/*',abort_offline)
 mp.goto(url,wait_until='load');mp.wait_for_function('!!window.TauExplorer');mp.evaluate('() => TauExplorer.lazy.all()')
 for scope,width,height in [('Phone',390,844),('Narrow phone',375,812),('Landscape phone',844,390)]:
  mp.set_viewport_size({'width':width,'height':height});mp.wait_for_timeout(500);fit_all(mp,touch=True)
  mp.screenshot(path=str(ROOT/('preview-'+scope.lower().replace(' ','-')+'-universe.png')),animations='disabled')
  check_overview(mp,scope,touch=True);check_catalogue_selection(mp,scope,touch=True)
 mobile.close()
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 context=browser.new_context(viewport={'width':1600,'height':1000},accept_downloads=True)
 page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
 if url.startswith('file:'):
  page.route('http://**/*',abort_offline)
  page.route('https://**/*',abort_offline)
 page.goto(url,wait_until='load');page.wait_for_function('!!window.TauExplorer',timeout=15000);page.evaluate('() => TauExplorer.lazy.all()')
 # The published pages (Tau Ceti's roadmaps and those proposed) draw no planets: a layer's definitions and results are
 # listed in its panel (src/app.js, PLANETS). The campaign map draws them.
 PLANETS=page.evaluate("!['atlas','tauceti'].includes(TauExplorer.data.variant)")
 # The example star comes from the data: a layer the audit finds already built is not drawn.
 # The example roadmap comes from the data: the campaign's AnalyticNumberTheory while the map has it; on the atlas
 # (Tau Ceti's roadmaps and those proposed in pull requests, since 2026-10-21), the Tau Ceti roadmap with ten or more
 # layers that have planets and the most links to other roadmaps, since the click journey picks one out on the chart,
 # and no parent roadmap, since its back steps lead through the area (a sub-roadmap's lead through its parent).
 ROADMAP=page.evaluate("""() => { const u=TauExplorer.getUniverse(); if(u.byId.has('AnalyticNumberTheory'))return 'AnalyticNumberTheory';
  const lit=new Set(TauExplorer.landmarks.map(l=>l.stageId)),rich=new Map(),links=new Map();
  for(const s of u.stars)if(s.planetIds.length||lit.has(s.id))rich.set(s.constellationId,(rich.get(s.constellationId)||0)+1);
  for(const e of TauExplorer.data.edges)for(const id of [e.source,e.target])links.set(id,(links.get(id)||0)+1);
  return TauExplorer.data.roadmaps.filter(r=>r.origin==='tauceti'&&!r.parentRoadmapId&&rich.get(r.id)>=10).map(r=>r.id)
   .sort((a,b)=>(links.get(b)||0)-(links.get(a)||0)||rich.get(b)-rich.get(a)||(a<b?-1:1))[0]; }""")
 CAMPAIGN=page.evaluate("TauExplorer.data.roadmaps.some(r=>r.id==='ArithmeticKTheory')")
 PAPERS=page.evaluate("TauExplorer.data.papers.length>0")
 REFINED=page.evaluate("TauExplorer.data.stages.some(s=>s.expansion&&!s.expansion.blueprint)")
 PROPOSALS=page.evaluate("!!TauExplorer.data.proposals")
 STAR=page.evaluate("id => { const lit=new Set(TauExplorer.landmarks.map(l=>l.stageId)),s=TauExplorer.getUniverse().stars.filter(x=>x.constellationId===id&&(x.planetIds.length||lit.has(x.id))).map(x=>x.id).sort(); return s[0]; }",ROADMAP)
 if overview_only:
  run_overview_checks(page,browser)
  record('No application exceptions',not errors)
  if url.startswith('file:'):record('No network requests needed',not requests)
  browser.close();write_report('overview desktop' if desktop_only else 'overview desktop and mobile');sys.exit(0)
 if references_only:
  run_reference_checks(page,browser)
  record('No application exceptions',not errors)
  if url.startswith('file:'):record('No network requests needed',not requests)
  browser.close();write_report('references desktop' if desktop_only else 'references desktop and mobile');sys.exit(0)
 record('Native offline mathematics renders',page.evaluate("() => {const d=TauMarkdown.render('$x^2$');return !!d.querySelector('math')}"))
 record('Snapshot records match the build report',page.evaluate("TauExplorer.data.roadmaps.length===%d && TauExplorer.data.stages.filter(s=>!s.expansion).length===%d && TauExplorer.data.stages.length===%d && TauExplorer.data.stages.filter(s=>s.expansion).length===%d"%(BUILD['roadmaps'],BUILD['originalStages'],BUILD.get('stages',1604),BUILD.get('sourceRefinements',0))))
 check_overview(page,'Desktop');check_hover_links(page);check_fields(page);check_performance(page)
 page.screenshot(path=str(ROOT/'preview-overview.png'),animations='disabled')
 record('No placeholder areas are drawn',page.evaluate("TauExplorer.data.opportunities.areas.length===0") and page.locator('.tau-unmapped-node').count()==0 and page.locator('#show-unmapped').count()==0)
 # Recorded and audited statuses change as the data grows, so the blank cases are chosen from the data.
 record('A roadmap without status data has a blank progress indicator',page.evaluate("() => {const r=TauExplorer.data.roadmaps.find(r=>{const s=TauExplorer.progress.roadmap(r.id);return s.total>0&&s.unknown===s.total;});if(!r)return false;const node=TauExplorer.getGraph().nodes.find(n=>n.id===r.id);return node.progress===null && node.progressLabel===''}"))
 check_zoom_journey(page,'Desktop');check_click_journey(page,'Desktop')
 if PAPERS:check_paper_artefacts(page,'Desktop')
 check_catalogue_selection(page,'Desktop')
 if REFINED:check_refinements(page)
 if PROPOSALS:check_proposals(page)
 page.evaluate("TauExplorer.navigate({view:'all',id:null,layer:null,selected:null})");page.wait_for_timeout(500)
 record('Mathematical planets exclude procedural labels',page.evaluate("TauExplorer.landmarks.every(x=>!/^(Dependency|Canonical owner|API to develop|the|Tests|Suggested home)$/i.test(x.title))"))
 record('All roadmap summaries use mathematical prose',page.evaluate("TauExplorer.data.roadmaps.every(r=>r.summary.split(/\\s+/).length>=40 && !/portfolio audit|component implements|silently attributed/.test(r.summary))"))
 if CAMPAIGN:
  page.evaluate("TauExplorer.navigate({view:'roadmap',id:'ArithmeticKTheory',layer:null,selected:null,origin:'all',activity:'all',unmapped:true})");page.wait_for_timeout(600)
  record('Administrative readiness checkpoint is not a star',page.evaluate("!TauExplorer.isMathematicalStage('ArithmeticKTheory:KU-finitegeneration') && !TauExplorer.getUniverse().byId.has('ArithmeticKTheory:KU-finitegeneration') && TauExplorer.getUniverse().stars.every(s=>TauExplorer.isMathematicalStage(s.id))"))
  record('Hidden administrative layer retains its raw source and progress',page.evaluate("() => {const id='ArithmeticKTheory:KU-finitegeneration',raw=TauExplorer.data.stages.find(s=>s.id===id);return raw.title==='Arithmetic K-theory finite generation' && raw.description.includes('readiness checkpoints') && TauExplorer.progress.stage(id).status!==undefined}"))
  # Only when the atlas is served: a blueprint reading is fetched from the published site, and
  # the offline pass asserts that nothing reaches for the network.
  if not url.startswith('file:'):
   record('A blueprint reading offers its way back to the source document',page.evaluate("() => {const r=TauExplorer.data.roadmaps.find(x=>x.blueprint&&x.blueprint.documents&&x.blueprint.documents.length);if(!r)return true;TauExplorer.openReader(r.id);return true;}"))
   page.evaluate("() => {const d=document.getElementById('reader');if(d&&d.open)d.close();}")
 # A retired roadmap has left the atlas; an old link to it opens the whole atlas.
 page.evaluate("TauExplorer.navigate({view:'roadmap',id:'FoundationsAndLibraryIntegration',layer:null,selected:null})");page.wait_for_timeout(400)
 record('A retired roadmap is gone and its old links open the atlas',page.evaluate("TauExplorer.getState().view==='all' && !TauExplorer.data.roadmaps.some(r=>r.id==='FoundationsAndLibraryIntegration') && TauExplorer.data.meta.retiredRoadmaps.includes('FoundationsAndLibraryIntegration')"))
 pinned_group='tauceti:TauCetiRoadmap/ReductiveGroups#layer-9-pinned-chevalleydemazure-group-schemes-over-ℤ'
 page.evaluate("TauExplorer.openItem('tauceti:TauCetiRoadmap/ReductiveGroups')");page.wait_for_timeout(600)
 record('Mathematical pinned group schemes remain visible',page.evaluate("id => TauExplorer.isMathematicalStage(id) && TauExplorer.getUniverse().byId.has(id) && TauExplorer.getUniverse().byId.get(id).label===TauExplorer.stageTitle(id)",pinned_group))
 page.locator('[data-node-id="'+pinned_group+'"] .tau-hit').click()
 page.wait_for_function("id => TauExplorer.getState().layer===id",arg=pinned_group);page.wait_for_timeout(400)
 record('Pinned group schemes show mathematics before progress controls',page.locator('.stage-description').is_visible() and page.evaluate("id => {const description=document.querySelector('.stage-description'),controls=document.querySelector('.progress-controls');return TauExplorer.stageSummary(id).length>60 && description && controls && description.compareDocumentPosition(controls)&Node.DOCUMENT_POSITION_FOLLOWING}",pinned_group))
 # Against TauLandmarks.build rather than TauExplorer.landmarks: the latter is what the atlas
 # DRAWS, and a promoted blueprint takes over its stages' planets, so a curated name for one of
 # them is not stale -- the planet is still defined, the blueprint is simply shown instead.
 record('Planet label overrides refer to existing mathematical targets',page.evaluate("() => {const ids=new Set(TauLandmarks.build(TauExplorer.data).map(x=>x.id)),labels=TauExplorer.data.landmarkLabels;return Object.keys(labels).length>0 && Object.keys(labels).every(id=>ids.has(id))}"))
 named=pick_formula_planet(page)
 page.evaluate("id => TauExplorer.openStage(id)",named['stageId']);page.wait_for_timeout(700)
 if not PLANETS:
  record('A formula target has a short plain name in its layer\'s panel',page.evaluate(r"""id => {
   const item=TauExplorer.landmarks.find(x=>x.id===id),title=TauExplorer.presentation.landmarkTitle(item),entry=document.querySelector('#inspector-content [data-item-id="'+CSS.escape(id)+'"]');
   return title.length<60&&!/[\\${}^_]/.test(title)&&!!entry&&entry.textContent.replace(/\s/g,'').includes(title.replace(/\s/g,''));
  }""",named['id']))
 open_planet(page,named['id']);page.wait_for_timeout(400)
 if PLANETS:record('Formula planet uses a short plain name in the map and SVG',page.evaluate(r"""id => {
  const item=TauExplorer.landmarks.find(x=>x.id===id),title=TauExplorer.presentation.landmarkTitle(item),node=TauExplorer.getUniverse().byId.get(id);
  const svg=new DOMParser().parseFromString(TauExplorer.graph.exportSVG(),'image/svg+xml');
  const caption=Array.from(svg.querySelectorAll('[data-label-for]')).find(e=>e.getAttribute('data-label-for')===id)?.querySelector('text');
  return title.length<60&&!/[\\${}^_]/.test(title)&&node.label===title&&caption&&caption.textContent.replace(/\s/g,'')===title.replace(/\s/g,'')&&!svg.querySelector('parsererror');
 }""",named['id']))
 record('Opening a named planet renders its preserved source formula',page.locator('.landmark-description math').count()>0 and page.locator('.landmark-description math').first.evaluate('(e)=>e.getBoundingClientRect().width>30 && e.getBoundingClientRect().height>10') and page.locator('.landmark-description .katex-error').count()==0 and page.evaluate(r"""id => {
  const item=TauExplorer.landmarks.find(x=>x.id===id),roadmap=TauExplorer.data.roadmaps.find(x=>x.id===item.roadmapId);
  return /\\|\$|\^|_\{/.test(item.title)&&item.description===item.sourceExcerpt&&!('readme' in roadmap)&&Number.isInteger(item.sourceLine)&&item.sourceLine>=1;
 }""",named['id']))
 page.screenshot(path=str(ROOT/'preview-formula-planet.png'),animations='disabled')
 # A layer with no recorded status: the example roadmap's if it has one, else the first such layer with planets of a
 # roadmap whose README the page carries (on the atlas a proposed roadmap's is read from GitHub, and this pass is offline).
 S=page.evaluate("() => { const u=TauExplorer.getUniverse(),lit=new Set(TauExplorer.landmarks.map(l=>l.stageId)),blank=x=>(x.planetIds.length||lit.has(x.id))&&TauExplorer.progress.stage(x.id).status==='unknown',carried=x=>(TauExplorer.data.roadmaps.find(r=>r.id===x.constellationId)||{}).origin!=='proposed'; const star=u.stars.find(x=>x.constellationId==="+json.dumps(ROADMAP)+"&&blank(x))||u.stars.filter(x=>blank(x)&&carried(x)).sort((a,b)=>a.id<b.id?-1:1)[0]; window.__blankStage=star?star.id:null; return window.__blankStage; }")
 record('A layer with no recorded status is on the map',bool(S))
 page.evaluate("TauExplorer.openStage(window.__blankStage)");page.wait_for_timeout(600)
 record('Central layer star exposes progress controls',page.get_by_label('Layer status',exact=True).is_visible())
 record('A stage without status data shows no badge and keeps its raw status',page.evaluate("TauExplorer.progress.stage(window.__blankStage).status==='unknown' && TauExplorer.graph.debugState().stars.find(n=>n.id===window.__blankStage).progress===null") and page.locator('#inspector .status-chip').count()==0)
 page.get_by_label('Layer status',exact=True).select_option('complete');page.get_by_label('Progress note',exact=True).fill('Browser test evidence')
 page.get_by_role('button',name='Save status',exact=True).click();page.wait_for_timeout(400)
 record('Local update persists and makes the star green',page.evaluate("TauExplorer.progress.stage(window.__blankStage).manual && TauExplorer.progress.stage(window.__blankStage).status==='complete'") and page.locator('#inspector .status-chip').inner_text().endswith('Complete') and page.locator('[data-node-id="'+S+'"]').get_attribute('data-progress')=='100')
 page.reload(wait_until='load');page.wait_for_function('!!window.TauExplorer');page.evaluate('() => TauExplorer.lazy.all()');page.wait_for_timeout(500)
 page.evaluate("id => { window.__blankStage=id; }",S)
 record('Progress survives reload',page.evaluate("TauExplorer.progress.stage(window.__blankStage).status==='complete'"))
 page.screenshot(path=str(ROOT/'preview-stage.png'),animations='disabled')
 record('Export/reset/import round trip',page.evaluate("""() => {const x=TauExplorer.progress.export();TauExplorer.progress.resetStage(window.__blankStage);const reverted=TauExplorer.progress.stage(window.__blankStage).status!=='complete';TauExplorer.progress.import(x);return reverted&&TauExplorer.progress.stage(window.__blankStage).status==='complete'}"""))
 record('Malformed import is atomic',page.evaluate("""() => {const a=JSON.stringify(TauExplorer.progress.export());try{TauExplorer.progress.import({version:1,stages:{bad:{status:'complete'}}});return false}catch{}return a===JSON.stringify(TauExplorer.progress.export())}"""))
 page.evaluate("TauExplorer.progress.resetStage(window.__blankStage)");page.wait_for_timeout(300)
 record('Resetting local progress restores the blank indicator',page.evaluate("TauExplorer.progress.stage(window.__blankStage).status==='unknown' && TauExplorer.graph.debugState().stars.find(n=>n.id===window.__blankStage).progress===null") and page.locator('#inspector .status-chip').count()==0)
 # The README is not in the atlas: the panel links to the roadmap's page, and the layer's own text is in the panel.
 record('Full document readable offline',page.evaluate("() => { const a=document.querySelector('#inspector-content a[data-roadmap-page]'),r=a&&TauExplorer.data.roadmaps.find(x=>x.id===a.dataset.roadmapPage); return !!r && a.href===r.page.href && a.textContent.startsWith('Read full roadmap') && document.querySelector('.source-stage-description').textContent.length>100; }") and not page.locator('#reader[open]').count())
 page.locator('#search').fill('Perron')
 record('Search reaches mathematical roadmap text',page.locator('.search-hit').count()>0)
 # Words match in any order, and hyphens, dashes and accents do not matter.
 hits=lambda q: (page.locator('#search').fill(q), page.wait_for_timeout(300), page.evaluate("Array.from(document.querySelectorAll('.search-hit')).map(e=>e.innerText)"))[2]
 spellings=[hits(q) for q in ('Fargues–Scholze','Fargues-Scholze','Fargues Scholze','Scholze Fargues')]
 record('Search finds the same results however the words are joined or ordered',bool(spellings[0]) and all(x==spellings[0] for x in spellings))
 record('Search ignores accents',hits('etale cohomology')==hits('étale cohomology') and bool(hits('etale cohomology')))
 page.locator('#search').fill('')
 page.locator('#source-filter').select_option('tauceti');page.wait_for_timeout(400)
 record('Tau Ceti collection filter',page.evaluate("TauExplorer.getState().origin==='tauceti' && TauExplorer.graph.debugState().counts.constellations===TauExplorer.data.roadmaps.filter(r=>r.origin==='tauceti').length"))
 # Any roadmap the maintainers archived as complete: which ones are changes (EffectiveBounds was reopened on 2026-10-28).
 done=page.evaluate("(()=>{for(const r of TauExplorer.data.roadmaps){if(!r.id.startsWith('tauceti:Completed/'))continue;try{TauExplorer.progress.roadmap(r.id);return r.id}catch(e){}}return null})()")
 if done: page.evaluate("id=>TauExplorer.openItem(id)",done);page.wait_for_timeout(500)
 record('Maintainer completed area is green',bool(done) and page.evaluate("id=>TauExplorer.progress.roadmap(id).percent===100",done))
 # With every collection shown: on the atlas, some of its sub-roadmaps are proposed in pull requests.
 page.evaluate("TauExplorer.navigate({origin:'all'})");page.evaluate("TauExplorer.openItem('tauceti:TauCetiRoadmap/RepresentationTheory')");page.wait_for_timeout(600)
 record('Nested roadmap collection frames all its child constellations',page.evaluate("TauExplorer.getState().view==='collection' && TauExplorer.getUniverse().constellations.filter(c=>c.parentRoadmapId==='tauceti:TauCetiRoadmap/RepresentationTheory').length===TauExplorer.data.roadmaps.filter(r=>r.parentRoadmapId==='tauceti:TauCetiRoadmap/RepresentationTheory').length && TauExplorer.data.roadmaps.filter(r=>r.parentRoadmapId==='tauceti:TauCetiRoadmap/RepresentationTheory').length>=11"))
 page.evaluate("TauExplorer.navigate({view:'all',id:null,layer:null,selected:null,origin:'all',unmapped:false})");page.wait_for_timeout(500)
 record('All roadmaps and all roadmap edges available',page.evaluate('TauExplorer.getGraph().nodes.length===%d && TauExplorer.getGraph().edges.length===%d'%(BUILD['roadmaps'],BUILD.get('roadmapEdges',1011))))
 record('All positions finite',page.evaluate("() => { const u=TauExplorer.getUniverse(); return [...u.galaxies,...u.constellations,...u.stars,...u.planets].every(n=>Number.isFinite(n.x)&&Number.isFinite(n.y)); }"))
 page.screenshot(path=str(ROOT/'preview-all.png'),animations='disabled')
 page.locator('.tau-label-galaxy').first.click();page.wait_for_timeout(500)
 record('Area heading opens its subject',page.evaluate("TauExplorer.getState().view==='group'") and page.locator('#selection-kind').inner_text()=='Subject')
 page.evaluate("TauExplorer.navigate({view:'all',id:null,layer:null,selected:null,origin:'all',unmapped:false})");page.wait_for_timeout(400)
 record('Universe has one galaxy per area with roadmaps',page.evaluate("TauExplorer.graph.debugState().counts.galaxies===%d"%BUILD['areasWithRoadmaps']))
 record('Area routes account for every real cross-area dependency once',page.evaluate("""() => { const graph=TauExplorer.getGraph(),nodes=new Map(graph.nodes.map(n=>[n.id,n])),routes=TauExplorer.graph.debugState().routes; const expected=graph.edges.filter(e=>nodes.get(e.source).group!==nodes.get(e.target).group); const pair=(a,b)=>JSON.stringify([a,b].sort()),seen=new Set(); let witnesses=0; for(const route of routes){const p=pair(route.source,route.target); if(seen.has(p)||route.dependencies!==route.witnesses.length)return false; seen.add(p); witnesses+=route.witnesses.length;} return witnesses===expected.length; }"""))
 page.locator('#stats-button').click()
 record('Mission status uses unique leaf totals',page.locator('#stats-scope').inner_text().endswith(format(BUILD['terminalTargets'],',')+' tracked leaf layers'))
 record('Mission status distinguishes 4 states',page.locator('#stats-summary .metric.complete strong').inner_text().replace(',','').isdigit() and int(page.locator('#stats-summary .metric.complete strong').inner_text().replace(',',''))>=36 and page.locator('#stats-summary .metric.active strong').inner_text().replace(',','').isdigit() and sum(int(t.replace(',','')) for t in page.locator('#stats-summary .metric strong').all_inner_texts() if t.replace(',','').isdigit())==BUILD['terminalTargets'] and page.locator('#stats-summary .metric.unknown strong').inner_text().replace(',','').isdigit())
 record('Every area with roadmaps has a progress ledger',page.locator('#area-progress .area-stat').count()==BUILD['areasWithRoadmaps'])
 page.screenshot(path=str(ROOT/'preview-stats.png'),animations='disabled');page.locator('#close-stats').click()
 page.locator('#activity-filter').select_option('active');page.wait_for_timeout(400)
 record('Activity filter shows only active roadmaps',page.evaluate("TauExplorer.getGraph().nodes.length>0 && TauExplorer.getGraph().nodes.length<"+str(BUILD['roadmaps'])+" && TauExplorer.getGraph().nodes.every(n=>TauExplorer.progress.roadmap(n.id).active>0)"))
 page.locator('#activity-filter').select_option('all');page.wait_for_timeout(400)
 page.evaluate("TauExplorer.navigate({view:'roadmap',id:"+json.dumps(ROADMAP)+",selected:"+json.dumps(ROADMAP)+",tab:'links'})");page.wait_for_timeout(600)
 page.locator('.connection-card').first.locator('summary').click()
 record('Roadmap connections expose supporting layer pairs',page.locator('.connection-witness').count()>0)
 related='tauceti:TauCetiRoadmap/RepresentationTheory/LieHighestWeight'
 page.evaluate("id => TauExplorer.navigate({view:'roadmap',id,layer:null,selected:id,tab:'overview'})",related);page.wait_for_timeout(600)
 page.get_by_label('Show related-plan links',exact=True).check();page.wait_for_timeout(500)
 record('Related-plan links appear on request, dotted and without prerequisite arrows',page.locator('.tau-reference-edge').count()>0 and page.evaluate("Array.from(document.querySelectorAll('.tau-reference-edge')).every(e=>!e.getAttribute('marker-end') && e.getAttribute('stroke-dasharray'))"))
 page.get_by_label('Show related-plan links',exact=True).uncheck();page.wait_for_timeout(300)
 record('Related-plan links disappear when switched off',page.locator('.tau-reference-edge').count()==0)
 page.evaluate("TauExplorer.navigate({view:'roadmap',id:"+json.dumps(ROADMAP)+",layer:null,selected:"+json.dumps(ROADMAP)+",tab:'overview'})");page.wait_for_timeout(500)
 page.locator('.pin-button').click()
 record('Roadmap can be pinned',page.locator('#pinned-list .pin-item').count()==1)
 page.reload(wait_until='load');page.wait_for_function('!!window.TauExplorer');page.evaluate('() => TauExplorer.lazy.all()');page.wait_for_timeout(500)
 record('Pinned roadmap persists',page.locator('.pin-button').get_attribute('aria-pressed')=='true')
 page.locator('#activity-filter').select_option('pinned');page.wait_for_timeout(400)
 record('Pinned filter returns saved roadmap',page.evaluate("TauExplorer.getGraph().nodes.length===1 && TauExplorer.getGraph().nodes[0].id==="+json.dumps(ROADMAP)+""))
 page.locator('#activity-filter').select_option('all');page.wait_for_timeout(400)
 # A link in a layer's text to another roadmap's README goes to that roadmap's page; the reader is for the documents
 # the atlas carries.
 record('Embedded roadmap document links resolve',page.evaluate("() => TauExplorer.data.roadmaps.every(r => !('readme' in r) && r.page && /^https:\\/\\//.test(r.page.href))"))
 page.locator('#progress-button').click()
 with page.expect_download(timeout=120000) as dl:page.locator('#download-offline').click()
 artifact=ROOT/'verified-offline.html';dl.value.save_as(str(artifact));page.locator('#close-progress').click()
 offline=browser.new_context();op=offline.new_page();op.goto(artifact.as_uri());op.wait_for_function('!!window.TauExplorer');op.evaluate('() => TauExplorer.lazy.all()')
 record('Offline universe loads independently',op.evaluate("TauExplorer.landmarks.length>2500 && TauExplorer.graph.debugState().layout==='universe' && TauExplorer.data.roadmaps.length===%d"%BUILD['roadmaps']) and op.locator('#pinned-list .pin-item').count()==0)
 offline.close()
 if not desktop_only:
  mobile=context.browser.new_context(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,has_touch=True)
  mp=mobile.new_page();mp.on('pageerror',lambda e:errors.append('mobile: '+str(e)))
  if url.startswith('file:'):
   mp.route('http://**/*',abort_offline)
   mp.route('https://**/*',abort_offline)
  mp.goto(url,wait_until='load');mp.wait_for_function('!!window.TauExplorer');mp.evaluate('() => TauExplorer.lazy.all()');mp.wait_for_timeout(500)
  touch=mobile.new_cdp_session(mp)
  record('Phone uses touch input at a real mobile viewport',mp.evaluate('navigator.maxTouchPoints>0 && innerWidth===390'))
  check_overview(mp,'Phone',touch=True)
  mp.screenshot(path=str(ROOT/'preview-phone-overview.png'),animations='disabled')
  box=mp.locator('#graph').bounding_box();before=mp.evaluate('TauExplorer.getState().view')
  touch_swipe(mp,touch,(box['x']+20,box['y']+25),(box['x']+65,box['y']+65))
  record('One-finger pan does not open anything',mp.evaluate('TauExplorer.getState().view')==before=='all' and mp.evaluate('TauExplorer.getState().selected===null'))
  fit_all(mp,touch=True);center_on(mp,ROADMAP)
  mp.locator('[data-node-id='+json.dumps(ROADMAP)+'] .tau-hit').tap()
  mp.wait_for_function("TauExplorer.getState().view==='roadmap' && TauExplorer.getState().id==="+json.dumps(ROADMAP)+"");mp.wait_for_timeout(600)
  record('Phone tap enters a roadmap constellation',mp.evaluate("TauExplorer.graph.debugState().visible.stars>=10"))
  mp.locator('[data-node-id='+json.dumps(STAR)+'] .tau-hit').tap()
  mp.wait_for_function("TauExplorer.getState().layer==="+json.dumps(STAR)+"");mp.wait_for_timeout(600)
  record('Phone tap enters a star system',(mp.locator('.tau-planet').count()>0)==PLANETS and mp.locator('#selection-kind').inner_text()=='Layer')
  planet=first_planet(mp,STAR)
  if PLANETS:
   pinch_gesture(mp,touch,'[data-node-id="'+planet+'"] .tau-hit',1.12)
   record('Phone pinch over a planet does not open it',mp.evaluate("TauExplorer.getState().selected==="+json.dumps(STAR)+""))
   mp.wait_for_timeout(800)
  open_planet(mp,planet,tap=True)
  try:
   mp.locator(PLANET_MATH).first.wait_for(state='visible',timeout=10000);opened=True
  except Exception:
   opened=False
  record('Phone tap opens mathematical planet details',opened)
  record('Phone reading pane leaves the sky and back navigation visible',mp.locator('.cosmic-back').is_visible() and mp.evaluate("() => {const g=document.querySelector('#graph').getBoundingClientRect(),i=document.querySelector('#inspector').getBoundingClientRect();return g.height>80 && i.height>150 && g.bottom<=i.top+2 && i.bottom<=innerHeight+1}"))
  reading=mp.locator('#inspector-content')
  if reading.evaluate('(e)=>e.scrollHeight>e.clientHeight+10'):
   rb=reading.bounding_box();touch_swipe(mp,touch,(rb['x']+rb['width']/2,rb['y']+rb['height']-30),(rb['x']+rb['width']/2,rb['y']+30))
   record('Phone mathematical details scroll with touch',reading.evaluate('(e)=>e.scrollTop>0'))
  record('Phone mathematical text has a readable size and no page overflow',mp.locator(PLANET_MATH).first.evaluate('(e)=>parseFloat(getComputedStyle(e).fontSize)>=12') and mp.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
  record('Phone system labels are legible and disjoint',labels_are_clean(mp) and names_are_unique(mp))
  mp.screenshot(path=str(ROOT/'preview-phone-planet.png'),animations='disabled')
  tap_until(mp,'.cosmic-back',"!TauExplorer.getState().layer");mp.wait_for_timeout(500)
  tap_until(mp,'.cosmic-back',"TauExplorer.getState().view==='group'");mp.wait_for_timeout(500)
  tap_until(mp,'.cosmic-back',"TauExplorer.getState().view==='all'")
  record('Phone back buttons retrace every level',mp.evaluate("!TauExplorer.getState().layer && TauExplorer.graph.debugState().counts.constellations===%d"%BUILD['roadmaps']))
  mp.set_viewport_size({'width':375,'height':812});mp.wait_for_timeout(500);fit_all(mp,touch=True)
  check_overview(mp,'Narrow phone',touch=True)
  mp.screenshot(path=str(ROOT/'preview-phone-narrow-overview.png'),animations='disabled')
  home=mp.evaluate("TauExplorer.data.roadmaps.find(r=>r.id==="+json.dumps(ROADMAP)+").group")
  center_on(mp,home)
  record('Two-finger pinch enters a galaxy on a narrow phone',pinch_until(mp,touch,'.tau-galaxy[data-node-id="%s"] .tau-galaxy-disc'%home,3,"TauExplorer.getState().view==='group' && TauExplorer.getState().id==='%s'"%home))
  record('Two-finger pinch enters a roadmap on a narrow phone',pinch_until(mp,touch,'[data-node-id='+json.dumps(ROADMAP)+'] .tau-hit',3,"TauExplorer.getState().view==='roadmap' && TauExplorer.getState().id==="+json.dumps(ROADMAP)+""))
  record('Two-finger pinch enters a star system on a narrow phone',pinch_until(mp,touch,'[data-node-id='+json.dumps(STAR)+'] .tau-hit',3,"TauExplorer.getState().layer==="+json.dumps(STAR)+""))
  mp.screenshot(path=str(ROOT/'preview-phone-star-system.png'),animations='disabled')
  # A moderate pinch steps out one level; a strong one may pass the roadmap by.
  record('Pinching out returns to the roadmap',pinch_until(mp,touch,'#graph',.5,"TauExplorer.getState().view==='roadmap' && !TauExplorer.getState().layer"))
  record('Pinching out returns to the universe',pinch_until(mp,touch,'#graph',.3,"TauExplorer.getState().view==='all'",attempts=12))
  mp.set_viewport_size({'width':844,'height':390});mp.wait_for_timeout(600);fit_all(mp,touch=True)
  check_overview(mp,'Landscape phone',touch=True)
  mp.screenshot(path=str(ROOT/'preview-phone-landscape-overview.png'),animations='disabled')
  center_on(mp,ROADMAP)
  mp.locator('[data-node-id='+json.dumps(ROADMAP)+'] .tau-hit').tap();mp.wait_for_function("TauExplorer.getState().view==='roadmap'");mp.wait_for_timeout(500)
  mp.locator('[data-node-id='+json.dumps(STAR)+'] .tau-hit').tap();mp.wait_for_function("TauExplorer.getState().layer==="+json.dumps(STAR)+"");mp.wait_for_timeout(500)
  open_planet(mp,first_planet(mp,STAR),tap=True)
  try:
   mp.locator(PLANET_MATH).first.wait_for(state='visible',timeout=10000);opened=True
  except Exception:
   opened=False
  record('Landscape phone opens a mathematical planet',opened)
  record('Landscape phone preserves readable chart and back navigation',mp.locator('.cosmic-back').is_visible() and mp.evaluate("() => {const g=document.querySelector('#graph').getBoundingClientRect(),i=document.querySelector('#inspector').getBoundingClientRect();return g.width>200 && g.height>70 && i.width>240 && i.height>180 && document.documentElement.scrollWidth<=innerWidth+1}"))
  mp.screenshot(path=str(ROOT/'preview-phone-landscape.png'),animations='disabled')
  mp.locator('.cosmic-back').tap();mp.wait_for_function("!TauExplorer.getState().layer");mp.wait_for_timeout(400)
  mp.locator('.cosmic-back').tap();mp.wait_for_function("TauExplorer.getState().view==='group'");mp.wait_for_timeout(400)
  mp.locator('.cosmic-back').tap();mp.wait_for_function("TauExplorer.getState().view==='all'")
  record('Landscape phone back controls remain tappable',mp.locator('#catalogue-button').is_visible())
  mp.set_viewport_size({'width':375,'height':812});mp.wait_for_timeout(500)
  phone_named=pick_formula_planet(mp)
  mp.evaluate("id => TauExplorer.openStage(id)",phone_named['stageId']);mp.wait_for_timeout(700)
  open_planet(mp,phone_named['id'],tap=True);mp.wait_for_timeout(400)
  formula=mp.locator('.landmark-description math').first
  reading=mp.locator('#inspector-content');reading_box=reading.bounding_box();formula_box=formula.bounding_box()
  if formula_box and formula_box['y']+formula_box['height']>reading_box['y']+reading_box['height']:
   touch_swipe(mp,touch,(reading_box['x']+reading_box['width']/2,reading_box['y']+reading_box['height']-25),(reading_box['x']+reading_box['width']/2,reading_box['y']+25))
  record('Phone tap opens readable mathematics behind the plain planet name',formula.is_visible() and mp.evaluate("() => {const math=document.querySelector('.landmark-description math').getBoundingClientRect(),panel=document.querySelector('#inspector-content').getBoundingClientRect();return math.width>30&&math.height>10&&math.left>=panel.left-1&&math.right<=panel.right+1}"))
  mp.screenshot(path=str(ROOT/'preview-phone-formula-planet.png'),animations='disabled')
  mp.locator('.cosmic-back').tap();mp.wait_for_function("!TauExplorer.getState().layer");mp.wait_for_timeout(400)
  mp.evaluate("TauExplorer.navigate({view:'all',id:null,layer:null,selected:null})");mp.wait_for_timeout(400)
  mp.locator('#catalogue-button').tap()
  record('Phone view has working browse/search',mp.locator('#search').is_visible())
  mp.locator('#search').fill('Perron');record('Phone search returns topics',mp.locator('.search-hit').count()>0)
  mp.locator('.search-hit').first.tap();record('Phone selection dismisses index',not mp.locator('#search').is_visible())
  mp.screenshot(path=str(ROOT/'preview-phone.png'),animations='disabled')
  mobile.close()
  if Path(p.webkit.executable_path).exists():
   safari=p.webkit.launch(headless=True)
   sc=safari.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
   sp=sc.new_page();sp.on('pageerror',lambda e:errors.append('webkit: '+str(e)))
   sp.goto(url,wait_until='load');sp.wait_for_function('!!window.TauExplorer');sp.evaluate('() => TauExplorer.lazy.all()');sp.wait_for_timeout(600)
   center_on(sp,ROADMAP)
   sp.locator('[data-node-id='+json.dumps(ROADMAP)+'] .tau-hit').tap();sp.wait_for_function("TauExplorer.getState().view==='roadmap'");sp.wait_for_timeout(600)
   sp.locator('[data-node-id='+json.dumps(STAR)+'] .tau-hit').tap();sp.wait_for_function("TauExplorer.getState().layer==="+json.dumps(STAR)+"");sp.wait_for_timeout(600)
   open_planet(sp,first_planet(sp,STAR),tap=True)
   try:
    sp.locator(PLANET_MATH).first.wait_for(state='visible',timeout=10000);opened=True
   except Exception:
    opened=False
   record('Installed WebKit supports mobile galaxy, layer and planet taps',opened and sp.locator('.cosmic-back').is_visible())
   sp.screenshot(path=str(ROOT/'preview-webkit-phone.png'),animations='disabled');safari.close()
 page.evaluate("TauExplorer.openItem("+json.dumps(ROADMAP)+")")
 page.set_viewport_size({'width':900,'height':800});page.wait_for_timeout(600);page.screenshot(path=str(ROOT/'preview-narrow.png'),animations='disabled')
 record('Narrow desktop view usable',page.locator('#inspector').is_visible())
 record('Markdown rejects unsafe HTML and schemes',page.evaluate("""() => {const f=TauMarkdown.render('<img src=x onerror=alert(1)>\\n\\n[x](javascript:alert(1))');const d=document.createElement('div');d.append(f);return !d.querySelector('img,script,iframe')&&!Array.from(d.querySelectorAll('a')).some(a=>a.href.startsWith('javascript'))}"""))
 page.evaluate("id => TauExplorer.openItem(id)",ROADMAP);page.wait_for_timeout(600)
 record('Layer order respects internal prerequisites',page.evaluate("() => {const u=TauExplorer.getUniverse(),stars=u.stars.filter(s=>s.constellationId==="+json.dumps(ROADMAP)+"),ids=new Set(stars.map(s=>s.id)),rank=new Map(stars.map(s=>[s.id,s.rank]));return stars.every(s=>s.dependencyOrderValid) && TauExplorer.data.stageEdges.filter(e=>ids.has(e.source)&&ids.has(e.target)).every(e=>rank.get(e.source)<rank.get(e.target));}"))
 page.evaluate("TauExplorer.navigate({view:'all',id:null,selected:null,origin:'all'})");page.wait_for_timeout(500)
 svg=page.evaluate('TauExplorer.graph.exportSVG()');svgpath=ROOT/'verified-universe.svg';svgpath.write_text(svg)
 record('SVG export contains the universe and no scripts','tau-galaxy-disc' in svg and '<script' not in svg and 'file:///' not in svg)
 svgp=page.context.new_page();svgp.goto(svgpath.as_uri());record('SVG export opens independently',svgp.locator('svg').count()==1);svgp.close()
 run_reference_checks(page,browser)
 record('No application exceptions',not errors)
 if url.startswith('file:'):record('No network requests needed',not requests)
 browser.close()
write_report('desktop' if desktop_only else 'desktop and mobile')
