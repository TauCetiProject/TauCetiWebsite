(function () {
'use strict';
const offlineDocument='<!doctype html>\n'+document.documentElement.outerHTML;
const DATA=JSON.parse(document.getElementById('atlas-data').textContent);
const $=id=>document.getElementById(id);
const maps=new Map(DATA.roadmaps.map(r=>[r.id,r]));
const stages=new Map(DATA.stages.map(s=>[s.id,s]));
const presentation=TauPresentation.create(DATA);
const references=TauReferences.create(DATA);
const {stageTitle,stageSummary,isMathematicalStage,landmarkTitle}=presentation;
const mathStages=r=>r.stages.filter(id=>isMathematicalStage(id)&&!stages.get(id)?.expansion);
const allGroups=[...DATA.groups,...(DATA.opportunities?.groups||[])];
const groups=new Map(allGroups.map(g=>[g.id,g]));
const fieldOf=new Map((DATA.fields||[]).flatMap(f=>f.groupIds.map(id=>[id,f])));
// A field's name inside a sentence: an arXiv category keeps its identifier's case (number theory (math.NT)).
const fieldName=field=>field.code?`${field.short.toLowerCase()} (${field.code})`:field.label.toLowerCase();
const opportunities=new Map((DATA.opportunities?.areas||[]).map(a=>[a.id,a]));
const external=new Map((DATA.external||[]).map(x=>[x.id,x]));
const documents=new Map((DATA.documents||[]).map(d=>[d.id,d]));
// Promoted blueprints (PROTOCOL.md section 14): the nodes their workers marked are a layer's planets and
// replace the targets read from its text; every declaration is listed, and its details are read on demand.
const blueprintLayers=new Set(DATA.blueprintLayers||[]);
const declarations=new Map();
for(const r of DATA.roadmaps)for(const [layer,rows] of Object.entries(r.blueprint?.layers||{}))for(const [suffix,kind,title,file] of rows){const id=r.id+':'+suffix;declarations.set('decl:'+id,{id,roadmapId:r.id,layer,kind,title,file});}
const KIND_ORDER=['definition','construction','theorem','lemma','comparison','application'];
const SITE='https://cbirkbeck.github.io/tauceti-explorer/',REPO_BLOB='https://github.com/CBirkbeck/tauceti-explorer/blob/main/';
const landmarkList=TauLandmarks.build(DATA).filter(item=>isMathematicalStage(item.stageId)&&!stages.get(item.stageId)?.expansion&&!blueprintLayers.has(item.stageId)&&!DATA.landmarkHidden?.[item.id]);
const landmarks=new Map(landmarkList.map(item=>[item.id,item]));
// Papers are artefacts beside the roadmap they build on most, locked until every layer they need is formalised.
const papers=new Map((DATA.papers||[]).map(p=>[p.id,p]));
const stageLandmarks=new Map();
for(const item of landmarkList){if(!stageLandmarks.has(item.stageId))stageLandmarks.set(item.stageId,[]);stageLandmarks.get(item.stageId).push(item);}
const witnesses=new Map(),relatedByPair=new Map();
for(const edge of DATA.stageEdges){const a=stages.get(edge.source),b=stages.get(edge.target);if(a&&b&&a.owner!==b.owner){const key=a.owner+'\n'+b.owner;if(!witnesses.has(key))witnesses.set(key,[]);witnesses.get(key).push(edge);}}
for(const link of DATA.roadmapLinks||[]){if(!maps.has(link.source)||!maps.has(link.target)||link.source===link.target)continue;const key=link.source+'\n'+link.target;if(!relatedByPair.has(key))relatedByPair.set(key,{source:link.source,target:link.target,kind:'reference',citations:[]});relatedByPair.get(key).citations.push(link);}
const relatedEdges=[...relatedByPair.values()];
const contextEdges=[...opportunities.values()].flatMap(a=>a.relatedRoadmaps.map(id=>({source:a.id,target:id,kind:'reference'})));
const progress=new TauProgress(DATA,DATA.progress||{});
const routeDefaults={view:'all',id:null,layer:null,selected:null,tab:'overview',outside:false,origin:'all',activity:'all',references:false,unmapped:true};
const PIN_KEY='tauceti-atlas-pins-v1';
let pins=new Set();
try { const saved=JSON.parse(localStorage.getItem(PIN_KEY)||'[]');if(Array.isArray(saved))pins=new Set(saved.filter(id=>maps.has(id))); } catch {}
let state={...routeDefaults},currentDoc=null,toastTimer;
let inspectedId=null;
const stageChildren=new Map(),childRoadmaps=new Map(),stageRefinements=new Map();
for(const s of DATA.stages)if(s.parentStageId){const target=s.expansion?stageRefinements:stageChildren;if(!target.has(s.parentStageId))target.set(s.parentStageId,[]);target.get(s.parentStageId).push(s.id);}
for(const r of DATA.roadmaps)if(r.parentRoadmapId){if(!childRoadmaps.has(r.parentRoadmapId))childRoadmaps.set(r.parentRoadmapId,[]);childRoadmaps.get(r.parentRoadmapId).push(r.id);}
// Search compares folded text: lower case, accents dropped (etale finds Étale), and every hyphen or dash a
// space, so Fargues-Scholze, Fargues–Scholze and Fargues Scholze all find the same roadmaps.
function fold(text){return String(text||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[-\u2010-\u2015\u2212]/g,' ').replace(/\s+/g,' ').trim();}
const mapSearch=new Map(DATA.roadmaps.map(r=>[r.id,fold(shortTitle(r.title)+' '+r.title+' '+r.id+' '+r.summary+' '+r.readme+' '+Object.values(r.blueprint?.layers||{}).flat().map(x=>x[2]).join(' '))]));
const stageSearch=new Map(DATA.stages.map(s=>[s.id,fold(stageTitle(s.id)+' '+stageSummary(s.id)+' '+s.key+' '+s.id+' '+s.description)]));
const labels={planned:'Not started',in_progress:'In progress',complete:'Complete',unknown:''};
function plainExcerpt(text){return String(text||'').replace(/\$\$?([^$]+)\$\$?/g,(m,tex)=>tex.replace(/\\[a-zA-Z]+\s*/g,w=>({'\\mathbb ':'','\\operatorname ':'','\\mathrm ':'','\\to ':'→ ','\\times ':'× ','\\cdot ':'· ','\\otimes ':'⊗ ','\\oplus ':'⊕ ','\\infty ':'∞ ','\\le ':'≤ ','\\ge ':'≥ ','\\ne ':'≠ '}[w]??w.replace(/^\\/,''))).replace(/[{}]/g,'')).replace(/[*_`>#]+/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/\s+/g,' ').trim().slice(0,220);}
function el(tag,className,text){const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;}
function btn(text,action,className=''){const n=el('button',className,text);n.type='button';n.addEventListener('click',action);return n;}
function clear(n){n.replaceChildren();return n;}
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),3000);}
function shortTitle(s){const title=String(s||'').replace(/^Roadmap:\s*/i,'');return ({
 'Foundations, existing libraries, and proof integrity':'Mathematical foundations',
 'Reusable infrastructure for potential automorphy over CM fields':'Potential automorphy over CM fields',
 'Reusable infrastructure for torsion in arithmetic cohomology':'Torsion in arithmetic cohomology'
})[title]||title;}
function groupOf(r){return groups.get(r.group)||{label:r.group,color:'#8698a5'};}
function inCollection(r){return r&&(state.origin==='all'||(r.origin||'campaign')===state.origin);}
function permitted(r){if(!inCollection(r))return false;if(state.activity==='all')return true;if(state.activity==='pinned')return pins.has(r.id);const p=progress.roadmap(r.id);return (p[state.activity]||0)>0;}
function visibleOpportunities(){return state.unmapped&&state.origin==='all'&&['all','unmapped'].includes(state.activity)?[...opportunities.values()]:[];}
function summarize(rs){return progress.aggregate(rs.flatMap(r=>progress.roadmapLeaves(r.id)));}
function revealRoadmap(id){const r=maps.get(id);navigate({view:'roadmap',id,layer:null,selected:id,tab:'overview',activity:'all',origin:inCollection(r)?state.origin:'all'});}
function togglePin(id){if(pins.has(id))pins.delete(id);else pins.add(id);try{localStorage.setItem(PIN_KEY,JSON.stringify([...pins]));}catch{toast('Pins are kept for this session; browser storage is unavailable');}renderPins();renderInspector();if(state.activity==='pinned'){buildUniverse(true);graph.zoomToView(viewTarget(),false);}}
function renderPins(){const box=clear($('pinned-list'));if(!pins.size)return;box.append(el('div','pinned-heading','Pinned'));for(const id of pins){const r=maps.get(id);const b=btn('☆ '+shortTitle(r.title),()=>revealRoadmap(id),'pin-item');b.title=r.title;box.append(b);}}
const statusMetrics=[['complete','Complete','Recorded or locally marked'],['active','In progress','Work under way'],['planned','Planned','Explicitly not started'],['unknown','No status data','No recorded layer status']];
function collectionName(){return state.origin==='tauceti'?'Tau Ceti repository':state.origin==='proposed'?'Open pull requests':state.origin==='campaign'?'Number theory campaign':'Combined collections';}
function renderStats(){let rs=DATA.roadmaps.filter(inCollection),scope=collectionName();if(state.view==='group'){rs=rs.filter(r=>r.group===state.id);scope=groups.get(state.id).label;}else if(['roadmap','collection'].includes(state.view)){rs=state.view==='roadmap'?[maps.get(state.id)]:(childRoadmaps.get(state.id)||[]).map(id=>maps.get(id));scope=shortTitle(maps.get(state.id).title);}else if(state.view==='neighbors'){const r=maps.get(state.id),ids=new Set([r.id,...r.prerequisites,...r.consumers]);rs=DATA.roadmaps.filter(r=>ids.has(r.id));scope='Connections of '+shortTitle(r.title);}const p=summarize(rs);
 $('stats-scope').textContent=`${scope} · ${rs.length} roadmaps · ${p.total.toLocaleString()} tracked leaf layers`;
 clear($('stats-summary'));for(const [key,label,note]of statusMetrics){const cell=el('div','metric '+key);cell.dataset.status=key;cell.append(el('strong','',p[key].toLocaleString()),el('span','',label),el('small','',note));$('stats-summary').append(cell);}
 const tc=rs.filter(r=>r.origin==='tauceti').length,proposed=rs.filter(r=>r.origin==='proposed').length,campaign=rs.length-tc-proposed;$('stats-sources').textContent=`${tc} Tau Ceti roadmaps · ${proposed?`${proposed} proposed in pull requests · `:''}${campaign?`${campaign} campaign roadmaps · `:''}${Object.keys(progress.export().stages).length} local layer updates`;
 const areas=clear($('area-progress'));for(const g of allGroups){const members=rs.filter(r=>r.group===g.id);if(!members.length)continue;const a=summarize(members),button=btn('',()=>{$('stats-dialog').close();navigate({view:'group',id:g.id,selected:null,activity:'all'});},'area-stat');button.dataset.group=g.id;const label=el('div','area-stat-label');label.append(el('span','area-name',g.label),el('span','area-count',`${a.complete} / ${a.total} complete`));const bar=el('div','area-bar');for(const [key]of statusMetrics){const segment=el('span',key);segment.style.width=(a.total?a[key]/a.total*100:0)+'%';bar.append(segment);}button.append(label,bar,el('span','area-stat-detail',`${members.length} roadmaps · ${a.active} active · ${a.planned} planned · ${a.unknown} without status data`));areas.append(button);}
}
function color(value){return TauGraph.progressColor(value)||'#899ba4';}
function stageProgress(p){return p.status==='unknown'?null:p.percent||0;}
function hasProgressData(p){return (p.complete||0)+(p.active||0)+(p.planned||0)>0;}
// Work under way with nothing yet complete has started: it is red, never the grey of not started.
function aggregateProgress(p){return hasProgressData(p)?(p.percent||(p.active?1:0)):null;}
function aggregateProgressLabel(p,suffix='layers'){return hasProgressData(p)?Math.round(p.percent||0)+'% '+suffix:'';}
function statString(p){return `${p.complete||0} / ${p.total||0} layers complete`;}
// Mathlib sits at the centre by default; #layout=areas opens the older area map, and the choice is kept in every link.
const LAYOUT=/(^|[#&])layout=areas(&|$)/.test(location.hash)?'areas':'radial';
// Where a roadmap sits: its distance from Mathlib (0-10), measured from the theory it still needs and moved by pairwise judgements.
// Why a subject is in the atlas: who builds on it, directly and through chains of layers.
function whyHere(box,id){const use=DATA.roadmapDistances?.galaxies?.[id];if(!use)return;section(box,'Why it is here');
 const name=gid=>groups.get(gid)?.label||gid,list=items=>items.map(x=>`${name(x.galaxy)} (${x.links??x.roadmaps})`).join(', ');
 if(use.frontierRoadmaps)box.append(el('p','detail-note',`${use.frontierRoadmaps} frontier roadmap${use.frontierRoadmaps===1?' rests':'s rest'} on its layers through chains of prerequisites, most in ${list(use.frontier.slice(0,3))}. Frontier roadmaps are those at distance 7 or more.`));
 if(use.supplies.length){box.append(el('p','detail-note',`Used directly by roadmaps in ${list(use.supplies.slice(0,4))}, counting prerequisite links. For example:`));
  for(const x of use.supplies.slice(0,2))for(const pair of x.examples.slice(0,1))if(maps.has(pair.supplier)&&maps.has(pair.consumer))box.append(btn(`${shortTitle(maps.get(pair.supplier).title)}, used by ${shortTitle(maps.get(pair.consumer).title)}`,()=>openItem(pair.consumer),'item-link'));}
 if(!use.supplies.length&&!use.frontierRoadmaps)box.append(el('p','detail-note',use.upstreamOnly?'No other roadmap in the atlas builds on these yet. They are Tau Ceti project roadmaps, which the atlas tracks in full.':'No other roadmap in the atlas builds on these yet.'));}
function placeNote(box,id){const place=DATA.roadmapClassification?.roadmaps?.[id],measured=DATA.roadmapDistances?.roadmaps?.[id];if(!place&&!measured)return;
 const fmt=v=>Number(v).toFixed(1).replace(/\.0$/,''),lines=[];
 // On the published pages a distance counts the roadmaps a roadmap rests on (scripts/atlas_distances.py).
 if(measured&&measured.basis==='dependencies'){const st=measured.structure||{},n=st.restsOn||0;
  lines.push(`Distance from Mathlib ${fmt(measured.distance)} of 10, by the roadmaps it rests on: ${n?`${n} roadmap${n===1?'':'s'} through its prerequisites (${st.prerequisites} directly${st.proposed?`; ${st.proposed===n?'all':st.proposed} proposed in open pull requests`:''}), with ${fmt(st.unfinished)} roadmaps' worth of work still to do among them and in itself`:`none, with ${fmt(st.unfinished)} roadmaps' worth of its own work still to do`}. The farthest roadmap on this page is at 10.`);
  if(n)lines.push(`The longest chain of unfinished roadmaps ending here is ${st.chain} long.`);}
 else if(measured){const range=measured.basis==='judged'&&Number.isFinite(measured.low)?` (${fmt(measured.low)} to ${fmt(measured.high)})`:'',n=measured.judgements||0;
  const basis=measured.basis==='judged'?`measured at ${fmt(measured.measurement)} from the theory it still needs, then moved by ${n} pairwise judgement${n===1?'':'s'}`:measured.basis==='measured'?'measured from the theory it still needs; no pairwise judgements yet':measured.basis==='built'?'everything it needs is built':'the mean of its child roadmaps';
  lines.push(`Distance from Mathlib ${fmt(measured.distance)} of 10${range}, ${basis}. The farthest roadmap in the atlas is at 10.`);
  const st=measured.structure,plural=(n,w)=>`${fmt(n)} ${w}${Number(n)===1?'':'s'}`;
  if(st)lines.push(!st.missingLayers?'Every layer it needs is recorded as built.':`Still to build: ${plural(st.missingLayers,'layer')} with about ${plural(Math.round(st.missingTargets),'target')} missing from Mathlib and Tau Ceti, ${st.suppliers?`in this roadmap and ${plural(st.suppliers,'supplier roadmap')}`:'all in this roadmap'}; the longest chain of them is ${plural(st.depth,'layer')}.`);
  if(Array.isArray(measured.usedBy))lines.push(measured.usedBy.length?`Used by roadmaps in other subjects: ${measured.usedBy.map(x=>`${groups.get(x.galaxy)?.label||x.galaxy} (${x.roadmaps})`).join(', ')}.`:'No roadmap in another subject uses it yet.');
  // The reviewed library audit: what Mathlib and Tau Ceti already contain, and overlaps with other roadmaps.
  const audited=(r=>(DATA.stages||[]).filter(x=>x.owner===id&&!x.expansion&&DATA.libraryCoverage?.layers?.[x.id]))(),counts={};
  if(audited.length){const overlaps=new Map();audited.forEach(x=>{const layer=DATA.libraryCoverage.layers[x.id];counts[layer.verdict]=(counts[layer.verdict]||0)+1;(layer.duplicates||[]).forEach(dup=>{const owner=stages.get(dup.layer)?.owner;if(owner&&owner!==id)overlaps.set(owner,(overlaps.get(owner)||0)+1);});});
   const order=['built','partly built','not built','process'],parts=order.filter(v=>counts[v]).map(v=>`${counts[v]} ${v==='process'?'process':v}`);
   lines.push(`Library audit, reviewed: ${parts.join(', ')} of ${audited.length} layers, against the pinned Mathlib and Tau Ceti.`);
   if(overlaps.size)lines.push(`Overlaps found by the audit: ${[...overlaps.entries()].sort((a,b)=>b[1]-a[1]).slice(0,4).map(([o,n])=>`${maps.has(o)?shortTitle(maps.get(o).title):o} (${n})`).join(', ')}.`);}
  const dl=st?.declarationLevel;if(dl)lines.push(`Decomposed so far: ${dl.declarations} declarations on ${dl.layersCovered} of ${dl.layers} layers, citing ${dl.sourcePages} source pages${dl.reviewed?'':' (unreviewed)'}.`);}
 else if(Number.isFinite(place.distance))lines.push(`Distance from Mathlib ${place.distance} of 10.`);
 if(place){lines.push(place.arxiv?place.rationale:`Subject class ${place.primaryMsc||'unknown'}.${place.rationale?' '+place.rationale:''}`);}
 const box2=el('div','place-note');lines.forEach(t=>box2.append(el('p','detail-note',t)));box.append(box2);}
function routeHash(s){const q=new URLSearchParams();q.set('view',s.view);if(s.id)q.set('id',s.id);if(s.layer)q.set('layer',s.layer);if(s.selected)q.set('selected',s.selected);if(s.tab!=='overview')q.set('tab',s.tab);if(s.outside)q.set('outside','1');if(s.origin!=='all')q.set('origin',s.origin);if(s.activity!=='all')q.set('activity',s.activity);if(s.references)q.set('references','1');if(!s.unmapped)q.set('unmapped','0');if(LAYOUT==='areas')q.set('layout','areas');return '#'+q.toString();}
function readRoute(){const q=new URLSearchParams(location.hash.slice(1));const next={...routeDefaults,view:q.get('view')||'all',id:q.get('id'),layer:q.get('layer'),selected:q.get('selected'),tab:q.get('tab')||'overview',outside:q.get('outside')==='1',origin:q.get('origin')||'all',activity:q.get('activity')||'all',references:q.get('references')==='1',unmapped:q.get('unmapped')!=='0'};if(next.view==='neighbors')next.view='roadmap';if(!['subjects','all','group','roadmap','collection'].includes(next.view))next.view='all';if(!['all','tauceti','proposed','campaign'].includes(next.origin))next.origin='all';if(!['all','active','complete','planned','unknown','pinned','unmapped'].includes(next.activity))next.activity='all';if(next.id&&!maps.has(next.id)&&!groups.has(next.id))next.id=null;if(!next.id&&!['subjects','all'].includes(next.view))next.view='all';if(next.view==='group'&&!groups.has(next.id))next.view='all';if(['roadmap','collection'].includes(next.view)&&!maps.has(next.id))next.view='all';if(next.selected&&!maps.has(next.selected)&&!groups.has(next.selected)&&!stages.has(next.selected)&&!external.has(next.selected)&&!landmarks.has(next.selected)&&!declarations.has(next.selected)&&!opportunities.has(next.selected)&&!papers.has(next.selected))next.selected=null;if(next.layer&&(next.view!=='roadmap'||stages.get(next.layer)?.owner!==next.id||!isMathematicalStage(next.layer)||stages.get(next.layer)?.expansion))next.layer=null;if(next.view==='roadmap'&&landmarks.has(next.selected)&&landmarks.get(next.selected).roadmapId===next.id)next.layer=landmarks.get(next.selected).stageId;if(next.view==='roadmap'&&stages.get(next.selected)?.expansion&&stages.get(next.selected).owner===next.id)next.layer=stages.get(next.selected).parentStageId;if(next.view==='roadmap'&&declarations.get(next.selected)?.roadmapId===next.id)next.layer=declarations.get(next.selected).layer;return next;}
function navigate(change,replace=false){document.body.classList.remove('catalogue-open');$('catalogue-button').setAttribute('aria-expanded','false');state={...state,...change};if(state.view==='neighbors')state.view='roadmap';
 // A place that no longer exists (for example a retired roadmap) opens the whole atlas.
 if((['roadmap','collection'].includes(state.view)&&!maps.has(state.id))||(state.view==='group'&&!groups.has(state.id)))state={...state,view:'all',id:null,layer:null,selected:null};if(state.view!=='roadmap'||state.layer&&(stages.get(state.layer)?.owner!==state.id||!isMathematicalStage(state.layer)))state.layer=null;const hash=routeHash(state);if(location.hash!==hash){try{history[replace?'replaceState':'pushState'](null,'',hash);}catch{location.hash=hash;}}render();}
function select(id){state.selected=id;state.tab='overview';try{history.replaceState(null,'',routeHash(state));}catch{}renderInspector();graph.select(id);renderCatalogue();}
function openItem(id){
 if(groups.has(id)){navigate({view:'group',id,layer:null,selected:id,tab:'overview'});return;}
 if(maps.has(id)){const r=maps.get(id);navigate({view:r.stages.length?'roadmap':'collection',id,layer:null,selected:id,tab:'overview'});return;}
 if(declarations.has(id)){const d=declarations.get(id);if(stages.has(d.id)){openStage(d.id);return;}navigate({view:'roadmap',id:d.roadmapId,layer:d.layer,selected:id,tab:'overview'});return;}
 if(stages.has(id))openStage(id);else if(landmarks.has(id))openLandmark(id);else if(opportunities.has(id))navigate({view:'group',id:opportunities.get(id).group,layer:null,selected:id,tab:'overview'});
}
function openStage(id){
 const s=stages.get(id);if(!s){select(id);return;}
 // A source refinement is a planet of its parent layer.
 if(s.expansion){navigate({view:'roadmap',id:s.owner,layer:s.parentStageId,selected:id,tab:'overview'});return;}
 if(!isMathematicalStage(id)){navigate({view:'roadmap',id:s.owner,layer:null,selected:id,tab:'overview'});return;}
 navigate({view:'roadmap',id:s.owner,layer:id,selected:id,tab:'overview'});
}
function openLandmark(id){const item=landmarks.get(id);if(!item)return;navigate({view:'roadmap',id:item.roadmapId,layer:item.stageId,selected:id,tab:'overview'});}
function ascend(){
 if(state.layer){navigate({view:'roadmap',id:state.id,layer:null,selected:state.id,tab:'overview'});return;}
 if(['roadmap','collection'].includes(state.view)){const r=maps.get(state.id),parent=r?.parentRoadmapId;if(parent&&maps.has(parent)){navigate({view:'collection',id:parent,layer:null,selected:parent,tab:'overview'});return;}navigate({view:'group',id:r?r.group:null,layer:null,selected:null,tab:'overview'});return;}
 navigate({view:'all',id:null,layer:null,selected:null,tab:'overview'});
}
let universe=null,universeKey='',suppressFocus=false,lastCameraTarget='';
// The published pages (Tau Ceti's roadmaps, and those proposed) stop at the stars, a roadmap's layers: a layer's
// definitions and results are listed in its panel rather than drawn as planets round it. The campaign map keeps them.
const PLANETS=!['atlas','tauceti'].includes(DATA.variant);
function universeInput(){
 const roadmaps=DATA.roadmaps.filter(permitted),gaps=visibleOpportunities(),ids=new Set(roadmaps.map(r=>r.id));
 const constellations=[],starMap=new Map(),planetMap=new Map(),starEdges=[];
 for(const r of roadmaps){const p=progress.roadmap(r.id),starIds=mathStages(r);
  constellations.push({id:r.id,galaxyId:r.group,label:shortTitle(r.title),starIds,distance:DATA.roadmapDistances?.roadmaps?.[r.id]?.distance??DATA.roadmapClassification?.roadmaps?.[r.id]?.distance??null,origin:r.origin||'campaign',progress:aggregateProgress(p),progressLabel:aggregateProgressLabel(p),parentRoadmapId:r.parentRoadmapId||null});
  for(const id of starIds){const sp=progress.stage(id),parent=stages.get(id)?.parentStageId;starMap.set(id,{label:stageTitle(id),progress:stageProgress(sp),progressLabel:labels[sp.status]||'',top:!parent||!starIds.includes(parent)});
   if(!PLANETS){planetMap.set(id,[]);continue;}
   const planets=(stageLandmarks.get(id)||[]).map(item=>({id:item.id,label:landmarkTitle(item),kind:['definition','theorem'].includes(item.kind)?item.kind:'construction',refinement:false,summary:plainExcerpt(TauPresentation.landmarkDescription(item)),moons:[]}));
   for(const rid of (stageRefinements.get(id)||[]).filter(isMathematicalStage)){const x=stages.get(rid).expansion,kind=x.kind;planets.push({id:rid,label:stageTitle(rid),kind:['definition','construction','theorem','lemma','comparison','application'].includes(kind)?kind:'construction',refinement:true,summary:plainExcerpt(x.statement),
    moons:[...(x.hypotheses||[]).map(t=>({kind:'hypothesis',text:t})),...(x.proofSteps||[]).map((t,i)=>({kind:'step',text:t,index:i+1})),...(x.acceptance||[]).map(t=>({kind:'check',text:t}))]});}
   // Extracted targets that share one source passage keep their names but not a repeated excerpt.
   const seen=new Map();planets.forEach(x=>seen.set(x.summary,(seen.get(x.summary)||0)+1));planets.forEach(x=>{if(!x.refinement&&seen.get(x.summary)>1)x.summary='';});
   const kinds=new Set(planets.filter(x=>!x.refinement).map(x=>x.kind));planets.forEach(x=>{x.showKind=x.refinement||kinds.size>1;});
   planetMap.set(id,planets);}
 }
 for(const area of gaps)constellations.push({id:area.id,galaxyId:area.group,label:area.title,starIds:[],unmapped:true,progress:null,progressLabel:'No dedicated roadmap'});
 // A blueprint links a layer to every layer its declarations use, and an accepted restructuring to every
 // new supplier. The map draws a layer's four most used such links, so that a selected layer keeps a few
 // lines, and its panel lists them all.
 const capped=e=>(e.kind==='blueprint'&&e.uses)||e.kind==='restructure';
 const drawnBlueprint=new Set(),usesByLayer=new Map();for(const e of DATA.stageEdges)if(capped(e)){if(!usesByLayer.has(e.target))usesByLayer.set(e.target,[]);usesByLayer.get(e.target).push(e);}
 for(const list of usesByLayer.values())list.sort((a,b)=>(b.uses||1)-(a.uses||1)||(a.source<b.source?-1:a.source>b.source?1:0)).slice(0,4).forEach(e=>drawnBlueprint.add(e));
 for(const e of DATA.stageEdges)if(starMap.has(e.source)&&starMap.has(e.target)&&!(capped(e)&&!drawnBlueprint.has(e)))starEdges.push({source:e.source,target:e.target});
 const planetEdges=!PLANETS?[]:DATA.stageEdges.filter(e=>stages.get(e.source)?.expansion&&stages.get(e.target)?.expansion&&stages.get(e.source).parentStageId===stages.get(e.target).parentStageId).map(e=>({source:e.source,target:e.target}));
 const constellationEdges=DATA.edges.filter(e=>ids.has(e.source)&&ids.has(e.target)).map(e=>({source:e.source,target:e.target,count:e.stageCount||1}));
 const present=id=>ids.has(id)||gaps.some(a=>a.id===id);
 const groupsWithProgress=allGroups.map(g=>{const p=summarize(roadmaps.filter(r=>r.group===g.id));return {...g,progress:aggregateProgress(p),progressLabel:aggregateProgressLabel(p,'layers complete')};});
 const artefacts=(DATA.papers||[]).filter(p=>ids.has(p.home)).map(p=>({id:p.id,label:p.label,home:p.home,...paperProgress(p)}));
 // A paper's lines come from the roadmaps its panel lists under "Builds on": the one it sits beside, any it needs
 // whole, and the owners of the layers it needs, each with the number of its layers the paper needs.
 const artefactEdges=[];for(const a of artefacts){const p=papers.get(a.id),count=new Map();for(const sid of p.needs||[]){const o=stages.get(sid)?.owner;if(o)count.set(o,(count.get(o)||0)+1);}for(const r of new Set([p.home,...(p.roadmaps||[]),...count.keys()]))if(ids.has(r))artefactEdges.push({source:r,target:a.id,count:count.get(r)||0,whole:(p.roadmaps||[]).includes(r)});}
 return {layout:LAYOUT,groups:groupsWithProgress,fields:DATA.fields||[],disk:DATA.mathlibDisk||null,artefacts,artefactEdges,constellations,stars:starMap,planets:planetMap,starEdges,planetEdges,constellationEdges,relatedEdges:[...relatedEdges,...contextEdges].filter(e=>present(e.source)&&present(e.target))};
}
function buildUniverse(force){
 const key=[state.origin,state.activity,state.unmapped,[...pins].join(',')].join('|');
 if(!force&&universe&&universeKey===key)return false;
 const box=$('graph').getBoundingClientRect();
 universe=TauUniverse.build(universeInput(),{width:box.width||800,height:box.height||600});universeKey=key;
 graph.setUniverse(universe,{selectedId:state.selected,showReferences:state.references,keepCamera:!!force});
 $('graph-empty').hidden=universe.constellations.length>0;
 return true;
}
const graph=new TauGraph($('graph'),{
 onSelect:node=>{if(!node)return;const id=node.id;
  if(node.level==='mathlib'){select(id);return;}
  if(node.level==='galaxy'){navigate({view:'group',id,layer:null,selected:id,tab:'overview'});return;}
  if(node.level==='constellation'){if(node.unmapped)navigate({view:'group',id:opportunities.get(id)?.group||state.id,layer:null,selected:id,tab:'overview'});else openItem(id);return;}
  if(node.level==='star'){openStage(id);return;}
  if(node.level==='artefact'){select(id);return;}
  if(landmarks.has(id))openLandmark(id);else openStage(id);
 },
 onClear:()=>{if(state.selected){state.selected=null;try{history.replaceState(null,'',routeHash(state));}catch{}renderInspector();renderCatalogue();}},
 onFocus:focus=>{
  // The camera moved by hand: keep the address bar, breadcrumbs and context
  // in step with what is in front of the reader, without travelling.
  if(suppressFocus)return;
  const next={...state};
  if(focus.level==='all'){next.view=state.view==='subjects'?'subjects':'all';next.id=null;next.layer=null;}
  else if(focus.level==='galaxy'){next.view='group';next.id=focus.id;next.layer=null;}
  else if(focus.level==='constellation'){if(!maps.has(focus.id)){next.view='group';next.id=focus.galaxyId;next.layer=null;}else{next.view=maps.get(focus.id).stages.length?'roadmap':'collection';next.id=focus.id;next.layer=null;}}
  else if(focus.level==='star'){next.view='roadmap';next.id=focus.constellationId;next.layer=focus.id;}
  if(next.view===state.view&&next.id===state.id&&next.layer===state.layer)return;
  // A hand-moved camera that is not at the full view has no target yet, so
  // returning to the whole atlas still travels there.
  state=next;lastCameraTarget=focus.level==='all'&&!graph.atOverview()?'free':JSON.stringify(viewTarget());try{history.replaceState(null,'',routeHash(state));}catch{}
  document.body.classList.toggle('is-system-view',!!state.layer);renderBreadcrumbs();renderContext();renderCatalogue();renderStats();
 },
 // Inside the open Mathlib disk the reader keeps their place when a panel opens beside the chart.
 onAspectChange:before=>{if(universe){buildUniverse(true);if(graph.diskState==='open'&&before)graph.keepCentreFrom(before);else graph.zoomToView(viewTarget(),false);}}
});
function viewTarget(){
 if(state.view==='roadmap'&&state.layer)return {layer:state.layer};
 if(['roadmap','group'].includes(state.view)&&state.id)return {id:state.id};
 if(state.view==='collection'&&state.id)return {ids:childRoadmaps.get(state.id)||[]};
 return {};
}
function syncGraph(animate){
 const rebuilt=buildUniverse(false),target=viewTarget(),key=JSON.stringify(target);
 if(rebuilt||key!==lastCameraTarget){lastCameraTarget=key;suppressFocus=true;graph.zoomToView(target,animate&&!rebuilt);clearTimeout(syncGraph.timer);syncGraph.timer=setTimeout(()=>{suppressFocus=false;graph.lastFocus=graph.focus();},animate&&!rebuilt?340:80);}
 graph.select(state.selected);graph.setReferences(state.references);
 renderContext();
}
function renderContext(){
 const actions=clear($('view-actions')),title=$('view-title');
 const name=state.layer?stageTitle(state.layer):state.view==='group'?groups.get(state.id)?.label:['roadmap','collection'].includes(state.view)&&maps.has(state.id)?shortTitle(maps.get(state.id).title):state.view==='subjects'?'Subjects':'All roadmaps';
 title.textContent=name||'Tau Ceti Atlas';document.title=(name&&name!=='All roadmaps'?name+' · ':'')+'Tau Ceti Atlas';
 if(!['all','subjects'].includes(state.view)){const nav=el('nav','cosmic-navigation');nav.setAttribute('aria-label','Zoom navigation');nav.append(btn(state.layer?'← Roadmap':state.view==='group'?'← Atlas':'← Area',ascend,'cosmic-back'));actions.append(nav);}
 if(['roadmap','collection'].includes(state.view)&&maps.has(state.id)&&!state.layer)actions.append(btn('Full roadmap',()=>openReader(state.id),'secondary'));
 const label=el('label','toggle links-toggle'),input=document.createElement('input');input.type='checkbox';input.checked=state.references;input.addEventListener('change',()=>navigate({references:input.checked},true));label.append(input,document.createTextNode('Show related-plan links'));actions.append(label);
 if(state.layer&&PLANETS){$('edge-legend').innerHTML='<span class="kind-legend"><span><svg class="kind-icon" viewBox="-7 -7 14 14" aria-hidden="true"><circle r="5" fill="#6f9fcf"/><path d="M-2.75,-1.75Q-1.5,-3.75 .25,-2.75Q1.5,-2 .5,-.75Q-.5,.25 -1.75,-.25Q-3.5,0 -2.75,-1.75ZM1,1.25Q2.75,.5 3.25,1.75Q3,3.25 1.5,3.5Q.25,3 1,1.25Z" fill="#9cc59a"/></svg>Definition or construction</span><span><svg class="kind-icon" viewBox="-9 -7 18 14" aria-hidden="true"><g transform="rotate(-18)"><path d="M-8.2,0A8.2,2 0 0,1 8.2,0" fill="none" stroke="#ece0bf" stroke-width="1.1"/></g><circle r="4.7" fill="#d9c391"/><g transform="rotate(-18)"><path d="M-8.2,0A8.2,2 0 0,0 8.2,0" fill="none" stroke="#ece0bf" stroke-width="1.1"/></g></svg>Theorem or result</span></span>';}else $('edge-legend').textContent=state.layer?(PLANETS?'':'The layer\'s definitions and results are listed in its panel'):state.view==='roadmap'?'Select a star to see its prerequisites and consumers, and a link to see what it joins':'Select an object to see its links, and a link to see what it joins';
 $('graph-hint').textContent=state.layer?(PLANETS?'Click a planet to read it · zoom out to return':'Zoom out to return'):'Scroll or pinch to zoom · drag to pan · click to open';
}

function renderBreadcrumbs(){
 const box=clear($('breadcrumbs'));box.append(btn('Atlas',()=>navigate({view:'all',id:null,layer:null,selected:null})));
 if(state.id){box.append(el('span','','›'));
  if(maps.has(state.id)){const r=maps.get(state.id),g=groupOf(r);box.append(btn(g.label,()=>navigate({view:'group',id:r.group,layer:null,selected:null})),el('span','','›'),btn(shortTitle(r.title),()=>openItem(r.id),state.layer?'':'current'));
   if(state.layer)box.append(el('span','','›'),el('span','current',stageTitle(state.layer)));
  }else if(groups.has(state.id))box.append(btn(groups.get(state.id).label,()=>{},'current'));
 }else if(state.view==='all')box.append(el('span','','›'),el('span','current','All roadmaps'));
}
function renderCatalogue(){const box=clear($('catalogue'));const query=fold($('search').value);const words=query.split(' ').filter(Boolean),matches=text=>words.every(w=>text.includes(w));const rs=DATA.roadmaps.filter(permitted);if(query){const pattern=new RegExp('(^|[^\\p{L}\\p{N}])'+query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'u'),rank=title=>{const t=fold(title);return t.startsWith(query)?0:pattern.test(t)?1:matches(t)?2:words.some(w=>t.includes(w))?3:4;},weight=(index,id)=>{const text=index.get(id);return words.reduce((n,w)=>n+text.split(w).length-1,0);};const mapHits=rs.filter(r=>matches(mapSearch.get(r.id))).sort((a,b)=>rank(a.title)-rank(b.title)||weight(mapSearch,b.id)-weight(mapSearch,a.id)||a.title.length-b.title.length);const stageHits=DATA.stages.filter(s=>isMathematicalStage(s.id)&&permitted(maps.get(s.owner))&&matches(stageSearch.get(s.id))).sort((a,b)=>rank(stageTitle(a.id))-rank(stageTitle(b.id))||weight(stageSearch,b.id)-weight(stageSearch,a.id));box.append(el('div','catalogue-heading',`${mapHits.length} roadmaps · ${stageHits.length} stages`));for(const r of mapHits.slice(0,35)){const b=btn('',()=>openItem(r.id),'search-hit');b.append(el('strong','',shortTitle(r.title)),el('small','',groupOf(r).label));box.append(b);}for(const s of stageHits.slice(0,60)){const b=btn('',()=>openStage(s.id),'search-hit');b.append(el('strong','',stageTitle(s.id)),el('small','',s.key+' · '+shortTitle(maps.get(s.owner).title)));box.append(b);}const gapHits=visibleOpportunities().filter(a=>matches(fold(a.title+' '+a.summary)));for(const area of gapHits){const b=btn('',()=>navigate({view:'group',id:area.group,selected:area.id}),'search-hit');b.append(el('strong','',area.title),el('small','','No dedicated roadmap'));box.append(b);}if(!mapHits.length&&!stageHits.length&&!gapHits.length)box.append(el('p','search-empty','No matching roadmap or stage. Try a broader mathematical term.'));return;}
 const gaps=visibleOpportunities();if(gaps.length){const d=el('details','unmapped-index'),head=el('summary','','Unmapped areas · '+gaps.length);d.append(head);for(const area of gaps)d.append(btn(area.title,()=>navigate({view:'group',id:area.group,selected:area.id}),'catalogue-item'));box.append(d);}box.append(el('div','catalogue-heading','Browse the collection'));const listed=[...(DATA.fields||[]).flatMap(f=>f.groupIds.map(id=>groups.get(id)).filter(Boolean)),...allGroups.filter(g=>!fieldOf.has(g.id))];let lastField=null;for(const g of listed){const members=rs.filter(r=>r.group===g.id);if(!members.length)continue;const field=fieldOf.get(g.id);if(field&&field!==lastField&&field.groupIds.filter(gid=>rs.some(r=>r.group===gid)).length>1){const head=el('div','catalogue-field',field.code?field.short:field.label);if(field.code)head.append(' ',el('span','catalogue-code',field.code));box.append(head);}lastField=field;const d=document.createElement('details');d.open=state.view==='group'&&state.id===g.id||!!state.selected&&maps.has(state.selected)&&maps.get(state.selected).group===g.id;const summary=document.createElement('summary'),dot=el('span','dot');dot.style.background=g.color;summary.append(dot,el('span','label',g.label),el('small','',members.length));d.append(summary);for(const r of members){const b=btn(shortTitle(r.title),()=>openItem(r.id),'catalogue-item'+(state.selected===r.id?' active':''));b.title=r.title;d.append(b);}box.append(d);}}
function detailHeader(box,title,subtitle,accent){const strip=el('div','detail-color');strip.style.background=accent;box.append(strip,el('h2','detail-title',shortTitle(title)));if(subtitle)box.append(el('p','detail-subtitle',subtitle));}
function stats(box,items){const row=el('div','detail-stats');for(const [value,label]of items){const cell=el('div');cell.append(el('strong','',String(value)),el('span','',label));row.append(cell);}box.append(row);}
function section(box,title){box.append(el('h3','section-label',title));}
function item(box,id,action){const s=stages.get(id),r=maps.get(id),x=external.get(id);const title=s?stageTitle(s.id):r?shortTitle(r.title):x?.title||id;const b=btn('',action||(()=>s?openStage(id):r?openItem(id):select(id)),'item-link');b.dataset.itemId=id;const label=el('span');label.append(document.createTextNode(title));b.append(label,el('span','arrow','↗'));box.append(b);return b;}
function tabs(box){const nav=el('div','detail-tabs');for(const [id,title]of [['overview','Overview'],['stages','Layers'],['links','Links']])nav.append(btn(title,()=>{state.tab=id;renderInspector();},state.tab===id?'active':''));box.append(nav);}
function progressSummary(box,r){const p=progress.roadmap(r.id);
 // The Tau Ceti build: the share of layers done, the counts, and one segment per layer in its reported state, as on Tau Ceti's own board.
 if(['tauceti','atlas'].includes(DATA.variant)&&hasProgressData(p)){const states=progress.roadmapLeaves(r.id).map(id=>progress.leafState(id).status),n=k=>states.filter(s=>s===k).length,wrap=el('div','progress-summary'),top=el('div','progress-caption'),segments=el('div','layer-segments');
  top.append(el('strong','',`${states.length?Math.round(n('complete')/states.length*100):0}%`),el('span','',`${n('complete')} of ${states.length} layers done · ${n('in_progress')} partial · ${n('planned')} untouched${n('unknown')?` · ${n('unknown')} unassessed`:''}`));states.forEach(s=>segments.append(el('i','segment-'+s)));wrap.append(top,segments);box.append(wrap);return;}
 if(hasProgressData(p)){const wrap=el('div','progress-summary'),top=el('div','progress-caption');top.append(el('strong','',`${Math.round(p.percent||0)}%`),el('span','',statString(p)));const bar=el('div','progress-track'),fill=el('div');fill.style.width=(p.percent||0)+'%';fill.style.background=color(p.percent||0);bar.append(fill);wrap.append(top,bar,el('p','detail-note',`${p.active||0} in progress. Progress counts all tracked leaf layers${p.unknown?', including '+p.unknown+' without status data':''}.`));box.append(wrap);}if(r.lifecycle==='completed')box.append(el('span','status-chip','Archived as complete by Tau Ceti maintainers'));}
function stageTree(box,r){
 const visible=mathStages(r),ids=new Set(visible),roots=visible.filter(id=>!ids.has(stages.get(id)?.parentStageId));
 function walk(id,parent,depth){
  const s=stages.get(id);if(!s||depth>12)return;
  const p=progress.stage(id),b=item(parent,id);if(labels[p.status]){const mark=el('span','stage-state-dot');mark.style.background=color(stageProgress(p));mark.title=labels[p.status];b.prepend(mark);}
  const children=(stageChildren.get(id)||[]).filter(isMathematicalStage);
  if(children.length){const d=el('details'),summary=el('summary','',`${children.length} further topics`),content=el('div','substage');d.append(summary,content);children.forEach(c=>walk(c,content,depth+1));parent.append(d);}
 }
 const tree=el('div','stage-tree');roots.forEach(id=>walk(id,tree,0));box.append(tree);
 const tasks=r.stages.filter(id=>!isMathematicalStage(id));
 if(tasks.length){const details=el('details','source-layer');details.append(el('summary','',`Project tasks (${tasks.length})`),el('p','detail-note','These tasks are included in tracked progress. The star map shows the mathematical topics.'));tasks.forEach(id=>item(details,id));box.append(details);}
 if(!r.stages.length)for(const id of childRoadmaps.get(r.id)||[])item(box,id,()=>openItem(id));
}
function connectionCard(box,source,target){
 const pairs=witnesses.get(source+'\n'+target)||[],other=source===state.selected?target:source;
 // A prerequisite read from a README (scripts/roadmap_dependencies.py) points to the line that states it; one a pull
 // request's description lists, to the pull request.
 const edge=DATA.edges.find(e=>e.source===source&&e.target===target),stated=!pairs.length&&edge?.kind==='pull'?edge:null,readme=!pairs.length&&['readme','pull'].includes(edge?.kind)?edge.evidence?.[0]:null;
 const card=el('details','connection-card'),summary=el('summary');
 summary.append(el('span','',shortTitle(maps.get(other).title)),el('small','',pairs.length?`${pairs.length} layer connections`:stated?`Listed by pull request #${stated.pull}`:readme?'Named in a README':'Declared prerequisite'));
 card.append(summary);
 if(pairs.length){card.append(el('p','detail-note','These recorded layer requirements establish the direction of the link.'));
  for(const edge of pairs){const row=el('div','connection-witness');row.append(btn(stageTitle(edge.source),()=>openStage(edge.source)),el('span','', '→'),btn(stageTitle(edge.target),()=>openStage(edge.target)));card.append(row);}
 }else if(stated||readme){
  if(stated){card.append(el('p','detail-note',`The description of pull request #${stated.pull}, which proposes ${shortTitle(maps.get(target).title)}, lists ${shortTitle(maps.get(source).title)} among the roadmaps it builds on.`));
   if(/^https:\/\/github\.com\//.test(stated.url||'')){const a=el('a','topic-link','Read the pull request ↗');a.href=stated.url;a.target='_blank';a.rel='noopener noreferrer';card.append(a);}}
  if(readme){card.append(el('p','detail-note',`Stated in the README of ${shortTitle(maps.get(readme.roadmap)?.title||readme.roadmap)}${readme.section?`, under “${readme.section}”`:''}, line ${readme.line}. No individual layer pair is recorded.`));
  if(/^https:\/\/github\.com\//.test(readme.readme)){const a=el('a','topic-link','Read that line ↗');a.href=`${readme.readme}?plain=1#L${readme.line}`;a.target='_blank';a.rel='noopener noreferrer';card.append(a);}}
 }else card.append(el('p','detail-note','The roadmap declares this dependency, but no individual layer pair is recorded.'));
 card.append(btn('Open roadmap galaxy',()=>openItem(other),'secondary'));box.append(card);
}
function renderConnections(box,r){
 box.append(btn('Show links on the map',()=>navigate({view:'roadmap',id:r.id,layer:null,selected:r.id,tab:'links'}),'secondary'));
 section(box,'Prerequisite roadmaps');const incoming=DATA.edges.filter(e=>e.target===r.id);
 if(!incoming.length)box.append(el('p','detail-note','No roadmap prerequisites are recorded in this snapshot.'));
 incoming.forEach(e=>connectionCard(box,e.source,e.target));
 section(box,'Roadmaps using this');DATA.edges.filter(e=>e.source===r.id).forEach(e=>connectionCard(box,e.source,e.target));
 const refs=relatedEdges.filter(e=>e.source===r.id||e.target===r.id),seen=new Set();
 if(refs.length){section(box,'Related reading');box.append(el('p','detail-note','Links in the source documents provide context; they do not establish prerequisites.'));
  for(const ref of refs){const other=ref.source===r.id?ref.target:ref.source;if(seen.has(other))continue;seen.add(other);const card=el('details','connection-card'),summary=el('summary','',shortTitle(maps.get(other).title));card.append(summary);
   for(const citation of ref.citations.slice(0,4))card.append(el('p','detail-note',`${citation.label} · source line ${citation.sourceLine}`));
   card.append(btn('Read linked roadmap',()=>openReader(other),'secondary'));box.append(card);}}
}
function landmarkLink(box,landmark){const button=btn('',()=>openLandmark(landmark.id),'item-link');button.dataset.itemId=landmark.id;button.append(el('span','landmark-kind',landmark.kind),el('span','',landmarkTitle(landmark)));box.append(button);}
function openReference(entry,roadmap){
 const owner=DATA.roadmaps.find(r=>r.sourcePath===entry.sourcePath)||DATA.documents?.find(d=>d.sourcePath===entry.sourcePath)||roadmap;
 openReader(owner.id);
 const searchable=text=>text.normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu,'').toLowerCase();
 const needle=searchable(TauMarkdown.render(entry.text,{basePath:entry.sourcePath}).textContent).slice(0,160);
 const candidates=[...$('reader-body').querySelectorAll('p,li,tr,blockquote')].filter(node=>needle&&searchable(node.textContent).includes(needle));
 candidates.sort((a,b)=>a.textContent.length-b.textContent.length)[0]?.scrollIntoView({block:'center'});
}
function renderPlanetReferences(box,landmark,roadmap){
 const entries=references.forLandmark(landmark),panel=el('section','planet-references');
 section(panel,'References');
 const scopes=[['direct','For this topic'],['layer','For this layer'],['roadmap','Roadmap reading']];
 let count=0;
 for(const [key,title]of scopes){
  if(!entries[key].length)continue;
  const group=el('div','reference-group');group.dataset.referenceScope=key;group.append(el('h4','reference-scope',title));
  for(const entry of entries[key]){
   const citation=el('article','planet-reference'),body=el('div','md-content reference-text');
   body.append(TauMarkdown.render(entry.text,{basePath:entry.sourcePath}));
   citation.append(body);
   if(entry.works?.length){const works=el('ul','reference-works');for(const work of entry.works){const row=el('li'),link=el(work.url?'a':'span','',work.title);if(work.url){link.href=work.url;link.target='_blank';link.rel='noopener noreferrer';}if(work.authors)row.append(document.createTextNode((Array.isArray(work.authors)?work.authors.join(', '):work.authors)+' — '));row.append(link);works.append(row);}citation.append(works);}
   citation.append(btn('View citation in roadmap',()=>openReference(entry,roadmap),'reference-source'));group.append(citation);count++;
  }
  panel.append(group);
 }
 if(!count)panel.append(el('p','detail-note','No bibliography is listed for this topic in the embedded roadmap.'));
 box.append(panel);
}
function renderInspector(){const id=state.selected,changed=inspectedId!==id,box=clear($('inspector-content'));inspectedId=id;if(changed)box.scrollTop=0;$('inspector').hidden=!id;document.body.classList.toggle('has-selection',!!id);if(!id)return;
 if(diskItems.has(id)){renderDiskItem(box,diskItems.get(id));return;}
 if(papers.has(id)){const p=papers.get(id),ps=paperProgress(p);$('selection-kind').textContent='Paper';detailHeader(box,p.label,`Beside ${shortTitle(maps.get(p.home)?.title||p.home)}`,ps.unlocked?'#ffffff':color(ps.progress));box.append(el('span','status-chip',ps.unlocked?'Unlocked':'Locked'),el('p','detail-summary',p.citation),el('p','detail-note',ps.progressLabel+'.'));if(p.link){const a=el('a','topic-link','Read the paper ↗');a.href=p.link;a.target='_blank';a.rel='noopener noreferrer';box.append(a);}section(box,'Builds on');[...new Set([p.home,...p.roadmaps,...p.needs.map(sid=>stages.get(sid)?.owner)])].filter(r=>maps.has(r)).forEach(r=>item(box,r,()=>openItem(r)));if(p.pending.length){section(box,'Calls for roadmaps not yet in the atlas');const list=el('ul','region-topics');p.pending.forEach(r=>list.append(el('li','',r.replace(/([a-z])([A-Z])/g,'$1 $2'))));box.append(list);}box.append(el('p','detail-note','A paper unlocks once every layer it needs is formalised: the layers its reviewed routes name, and all of any roadmap it extends as a Part II.'));return;}
 if(opportunities.has(id)){const area=opportunities.get(id);$('selection-kind').textContent='Unmapped area';detailHeader(box,area.title,groups.get(area.group).label,'#91aabd');box.append(el('span','status-chip','No dedicated roadmap'),el('p','detail-summary',area.summary),el('p','detail-note',area.reason));section(box,'Nearby mathematical developments');area.relatedRoadmaps.forEach(r=>item(box,r,()=>openItem(r)));box.append(el('p','detail-note','These links provide mathematical context. This proposed area has no layers or completion percentage.'));return;}
 if(groups.has(id)){const g=groups.get(id),members=DATA.roadmaps.filter(r=>r.group===id&&permitted(r));$('selection-kind').textContent='Subject';const field=fieldOf.get(id),siblings=field?field.groupIds.filter(gid=>gid!==id&&groups.has(gid)):[];detailHeader(box,g.label,siblings.length?`${members.length} roadmaps · an area of ${fieldName(field)}`:`${members.length} roadmaps`,g.color);const region=DATA.regions?.groups?.[id]||g;box.append(el('p','detail-summary',region.description||`Explore the mathematics of ${g.label.toLowerCase()}.`));if(Number.isFinite(g.distance))box.append(el('p','detail-note',`Mean distance from Mathlib ${g.distance.toFixed(1)} of 10, over its roadmaps. Its direction on the map follows the subjects it is most related to.`));whyHere(box,id);if(region.topics?.length){const topics=el('ul','region-topics');region.topics.forEach(topic=>topics.append(el('li','',topic)));box.append(topics);}if(siblings.length){section(box,'Other areas of '+fieldName(field));for(const gid of siblings)box.append(btn(groups.get(gid).label,()=>openItem(gid),'topic-link'));}const bridges=(region.bridgeGroups||[]).filter(gid=>groups.has(gid)&&!siblings.includes(gid));if(bridges.length){section(box,'Connected areas');for(const gid of bridges)box.append(btn(groups.get(gid).label,()=>openItem(gid),'topic-link'));}box.append(btn('Open roadmaps →',()=>openItem(id),'primary'));section(box,'In this subject');members.forEach(r=>item(box,r.id,()=>openItem(r.id)));const gaps=visibleOpportunities().filter(a=>a.group===id);if(gaps.length){section(box,'Areas needing a roadmap');gaps.forEach(a=>box.append(btn(a.title,()=>select(a.id),'item-link')));}return;}
 if(maps.has(id)){const r=maps.get(id),p=progress.roadmap(id);$('selection-kind').textContent={tauceti:'Tau Ceti roadmap',proposed:'Proposed roadmap'}[r.origin]||'Campaign roadmap';detailHeader(box,r.title,groupOf(r).label,color(aggregateProgress(p)));const pin=btn(pins.has(id)?'★ Pinned':'☆ Pin roadmap',()=>togglePin(id),'pin-button');pin.setAttribute('aria-pressed',String(pins.has(id)));box.append(pin);progressSummary(box,r);const row=el('div','button-row');row.append(btn(r.stages.length?'Open stage layers →':'Open sub-roadmaps →',()=>openItem(id),'primary'),btn('Read full roadmap',()=>openReader(id),'secondary'));box.append(row);tabs(box);
 if(state.tab==='overview'){box.append(el('p','detail-summary',r.summary));placeNote(box,id);const expansion=(DATA.decompositions||[]).find(x=>x.roadmapId===id);if(expansion){section(box,'Source expansion');const covered=expansion.coverage.filter(c=>c.status!=='not_read').length;box.append(el('p','detail-note',`${expansion.nodes} reviewed refinements from ${expansion.sources.length} primary source${expansion.sources.length===1?'':'s'}; ${covered} of ${expansion.coverage.length} layers read (${expansion.status.replace('_',' ')}). Review: ${expansion.review.status}${expansion.review.reviewer?' by '+expansion.review.reviewer:''}. ${expansion.gaps.length} recorded gap${expansion.gaps.length===1?'':'s'}.`));}renderRoadmapBlueprint(box,r);if(DATA.packages?.[id])packageSection(box,DATA.packages[id]);if(r.extends&&maps.has(r.extends)){section(box,'Builds on');box.append(el('p','detail-note',`A Part II of ${maps.get(r.extends).title}: it starts where that roadmap stops${r.restructuredBy?' (restructuring '+r.restructuredBy+')':''}.`));item(box,r.extends,()=>openItem(r.extends));}const tags=DATA.regions?.roadmapTags?.[id];if(tags?.length){const row=el('div','related-subjects');for(const tag of tags){const gid=typeof tag==='string'?tag:tag.group;if(groups.has(gid))row.append(btn(groups.get(gid).label,()=>openItem(gid),'topic-link'));}box.append(row);}stats(box,[[mathStages(r).length,'topics'],[DATA.edges.filter(e=>e.target===id).length,'prerequisites'],[DATA.edges.filter(e=>e.source===id).length,'consumers']]);if(r.parentRoadmapId)item(box,r.parentRoadmapId,()=>openItem(r.parentRoadmapId));if(DATA.taucetiProgress?.roadmaps?.[id])reportSection(box,DATA.taucetiProgress.roadmaps[id]);if(r.pull)pullSection(box,r);if(r.statusMarkdown){section(box,'Recorded project status');box.append(el('p','detail-note','Imported from the local Tau Ceti roadmap checkout. Reports are snapshots; local changes are kept separately.'+(p.snapshotDate?' Reported '+p.snapshotDate+'.':'')),btn('Read status report',()=>openReader(id,'status'),'secondary'));}if(r.progressMarkdown)box.append(btn('Read progress log',()=>openReader(id,'progress'),'quiet'));section(box,'Starting points');mathStages(r).slice(0,4).forEach(s=>item(box,s));if((childRoadmaps.get(id)||[]).length){section(box,'Sub-roadmaps');childRoadmaps.get(id).forEach(child=>item(box,child,()=>openItem(child)));}}
 if(state.tab==='stages'){box.append(el('p','detail-note','Open a layer to read its target and update its local progress. Sub-layers can be expanded independently.'));stageTree(box,r);}
 if(state.tab==='links')renderConnections(box,r);

 return;}
 if(landmarks.has(id)){const landmark=landmarks.get(id),stage=stages.get(landmark.stageId),r=maps.get(landmark.roadmapId);$('selection-kind').textContent=landmark.kind.charAt(0).toUpperCase()+landmark.kind.slice(1)+(PLANETS?' · planet':'');detailHeader(box,landmarkTitle(landmark),shortTitle(r.title),'#a8c8df');box.append(el('span','landmark-kind',landmark.kind));const text=el('div','md-content landmark-description');text.append(TauMarkdown.render(TauPresentation.landmarkDescription(landmark),{basePath:landmark.sourcePath}));box.append(text);renderPlanetReferences(box,landmark,r);section(box,'In this layer');box.append(btn(stageTitle(stage.id),()=>openStage(stage.id),'item-link'),el('p','detail-note','This is a target named in the roadmap. Progress is recorded for its parent layer.'),btn('Read full roadmap',()=>openReader(r.id),'secondary'));return;}
 if(declarations.has(id)){renderDeclaration(box,declarations.get(id));return;}
 if(stages.has(id)&&stages.get(id).expansion){renderRefinement(box,stages.get(id));return;}
 if(stages.has(id)){
  const s=stages.get(id),r=maps.get(s.owner),p=progress.stage(id),mathematical=isMathematicalStage(id);
  $('selection-kind').textContent=mathematical?'Layer':'Project task';
  detailHeader(box,stageTitle(id),'',color(stageProgress(p)));box.append(btn(shortTitle(r.title),()=>openItem(r.id),'inline-owner'));
  const summary=stageSummary(id);if(summary){const md=el('div','md-content stage-description');md.append(TauMarkdown.render(summary,{basePath:s.sourcePath}));box.append(md);}
  const still=DATA.taucetiProgress?.remaining?.[id];if(still){section(box,'Still to do');box.append(el('p','detail-note',still+' (Tau Ceti\'s latest report)'));}
  const targets=stageLandmarks.get(id)||[];
  if(targets.length){section(box,'Definitions and results');targets.forEach(target=>landmarkLink(box,target));}
  const change=s.restructured;if(change?.action==='narrow'){section(box,'Restructured');box.append(el('p','detail-note',`Narrowed by the restructuring ${change.proposal}, so that each piece of mathematics has one owner. This layer now plans only: ${change.keeps}`));(change.suppliedBy||[]).filter(x=>stages.has(x)).forEach(x=>item(box,x));}
  renderLayerBlueprint(box,r,id);
  const refinements=(stageRefinements.get(id)||[]).filter(x=>!stages.get(x).expansion.blueprint);
  if(refinements.length){section(box,'Source decomposition');box.append(el('p','detail-note','Constructions and results read from the primary sources by the expansion programme. They refine this layer and orbit it as planets; progress stays recorded on the layer.'));refinements.forEach(x=>{const b=item(box,x);b.prepend(el('span','landmark-kind',stages.get(x).expansion.kind+(stages.get(x).expansion.reviewed?'':' · added during review')));});}
  const children=(stageChildren.get(id)||[]).filter(isMathematicalStage);
  if(children.length){section(box,'Further topics');children.forEach(x=>item(box,x));}
  const requirements=s.requires.filter(isMathematicalStage),consumers=s.consumers.filter(isMathematicalStage);
  if(requirements.length){section(box,'Builds on');requirements.forEach(x=>item(box,x));}
  if(consumers.length){section(box,'Used in');consumers.forEach(x=>item(box,x));}
  if(labels[p.status])box.append(el('p','status-chip',`${p.manual?'Your local status':'Recorded status'}: ${labels[p.status]}`));renderProgressControls(box,s,p);
  const source=el('details','source-layer');source.append(el('summary','','Source layer and work plan'));
  const md=el('div','md-content source-stage-description');md.append(TauMarkdown.render(s.description,{basePath:s.sourcePath}));source.append(md);box.append(source,btn('Read full roadmap',()=>openReader(r.id),'secondary'));return;
 }
 const x=external.get(id);$('selection-kind').textContent='External prerequisite';detailHeader(box,x?.title||id,'Integration contract','#89959d');box.append(el('p','detail-summary',x?.action||'This prerequisite is outside the currently embedded roadmaps. Its exact statement and implementation must be checked in the supplying library.'));if(x?.integration_owner&&stages.has(x.integration_owner))item(box,x.integration_owner);if(x?.consumers?.length){section(box,'Consumers');x.consumers.forEach(c=>item(box,c));}}
// Promoted blueprints are read from the published site on demand, so that the page stays small. The site
// serves them to this page and to offline copies alike; without a connection they are linked on GitHub.
const fetched=new Map();
function fetchSiteFile(path,json=false){
 if(!fetched.has(path))fetched.set(path,(async()=>{for(const url of [path,SITE+path]){try{const res=await fetch(url,{cache:'no-cache'});if(res.ok)return json?await res.json():await res.text();}catch{}}fetched.delete(path);throw new Error('unavailable');})());
 return fetched.get(path);}
// A file from outside the atlas, such as a proposed roadmap's README on its pull request's branch.
function fetchText(url){if(!fetched.has(url))fetched.set(url,fetch(url).then(res=>{if(!res.ok)throw new Error('unavailable');return res.text();}).catch(error=>{fetched.delete(url);throw error;}));return fetched.get(url);}
const capital=text=>String(text||'').charAt(0).toUpperCase()+String(text||'').slice(1);
function githubLink(box,path,text){const a=el('a','blueprint-link',text);a.href=REPO_BLOB+path;a.target='_blank';a.rel='noopener noreferrer';box.append(a);return a;}
function declarationLink(box,r,row){const id=r.id+':'+row[0],planet=stages.has(id);const b=btn('',()=>openItem(planet?id:'decl:'+id),'item-link');b.dataset.itemId=planet?id:'decl:'+id;b.append(el('span','landmark-kind',row[1]+(planet?' · planet':'')),el('span','',planet?stageTitle(id):row[2]),el('span','arrow','↗'));box.append(b);}
function renderRoadmapBlueprint(box,r){const b=r.blueprint;if(!b)return;section(box,'Blueprint');
 const kinds=KIND_ORDER.filter(k=>b.kinds[k]).map(k=>`${b.kinds[k]} ${k}${b.kinds[k]===1?'':'s'}`).join(', ');
 const reviews=b.parts.map(p=>(p.part?p.part+': ':'')+String(p.status||'').replace('_',' ')+(p.reviewer?`, accepted by ${String(p.reviewer).replace(/^independent-review-/,'')}`:'')+(p.reviewDate?' on '+p.reviewDate:'')).join('; ');
 box.append(el('p','detail-note',`${b.declarations} declarations planned (${kinds}), independently reviewed; ${b.planets} are drawn as planets of their layers. ${capital(reviews)}.`));
 const row=el('div','button-row');if(b.documents.length)row.append(btn('Read the blueprint',()=>openBlueprintDocument(r),'secondary'));box.append(row);
 const links=el('p','detail-note');githubLink(links,'data/blueprints/'+b.files[0]+'.json','Blueprint packet on GitHub');box.append(links);}
function renderLayerBlueprint(box,r,layer){const rows=r.blueprint?.layers?.[layer];if(!rows?.length)return;
 const planet=row=>stages.has(r.id+':'+row[0]),rank=row=>(planet(row)?0:10)+Math.max(0,KIND_ORDER.indexOf(row[1]));
 const sorted=rows.map((row,i)=>[row,i]).sort((a,b)=>rank(a[0])-rank(b[0])||a[1]-b[1]).map(x=>x[0]);
 const main=sorted.filter(row=>planet(row)||['definition','construction','theorem'].includes(row[1])),steps=sorted.filter(row=>!main.includes(row));
 section(box,'Blueprint');box.append(el('p','detail-note',`${rows.length} declaration${rows.length===1?'':'s'} planned for this layer by its reviewed blueprint. Open one for its statement, proof outline, API and unit tests.`));
 main.forEach(row=>declarationLink(box,r,row));
 if(steps.length){const more=el('details','blueprint-steps');more.append(el('summary','',`${steps.length} lemma${steps.length===1?'':'s'} and other steps`));steps.forEach(row=>declarationLink(more,r,row));box.append(more);}}
// A Mathlib item of the disk round the sun (src/universe.js): what it says, how much of Mathlib it needs, and where
// Mathlib keeps it.
const diskItems=new Map((DATA.mathlibDisk?.items||[]).map(row=>[row.id,row]));
const CATALOGUES={overview:"Mathlib's overview",undergrad:"Mathlib's undergraduate list",'100':"Freek Wiedijk's 100 theorems",'1000':'The 1000+ theorems list'};
function renderDiskItem(box,r){const disk=DATA.mathlibDisk,sector=disk.sectors.find(s=>s.id===r.s),theorem=['theorem','lemma'].includes(r.k);
 $('selection-kind').textContent=theorem?'Mathlib theorem':r.k==='instance'?'Mathlib instance':'Mathlib definition';
 detailHeader(box,r.t,sector?sector.label:'Mathlib',theorem?'#f0c46e':'#7aa3ff');
 if(r.t!==r.n)box.append(el('code','disk-name',r.n));
 if(r.sig)box.append(el('pre','disk-signature',r.k+' '+r.sig));
 if(r.doc){const text=el('div','md-content landmark-description');text.append(TauMarkdown.render(r.doc,{}));box.append(text);}
 section(box,'What it needs');stats(box,[[r.p.toLocaleString(),'definitions to state and prove it'],[r.q.toLocaleString(),'to state it'],[r.d,'deep']]);
 box.append(el('p','detail-note',"It lies as far from the centre as the first number: the Mathlib definitions, structures, classes and inductive types in everything its statement and proof refer to, the proofs of the lemmas it uses included. Lean's own and the tactics' lemmas do not count. Deep is the longest chain of definitions beneath it."
  +(r.w?` As a type, it is measured with the structure its own file gives it: the ${r.w} instance${r.w===1?'':'s'} there that give it data, such as its operations. Instances that are theorems about it do not count.`:'')));
 if(r.c&&r.c.length){section(box,"In Mathlib's catalogues");const list=el('ul','region-topics');r.c.forEach(([c,w])=>list.append(el('li','',(CATALOGUES[c]||c)+(w?': '+w:''))));box.append(list);}
 section(box,'In Mathlib');box.append(el('p','detail-note',r.m));
 const row=el('div','button-row'),link=(text,href)=>{const a=el('a','topic-link',text);a.href=href;a.target='_blank';a.rel='noopener noreferrer';return a;};
 row.append(link('Documentation ↗',`https://leanprover-community.github.io/mathlib4_docs/${r.m.split('.').join('/')}.html#${encodeURIComponent(r.n)}`));
 if(r.f)row.append(link('Source ↗',`https://github.com/leanprover-community/mathlib4/blob/${disk.commit}/${r.f}${r.ln?'#L'+r.ln:''}`));
 box.append(row);}
function renderDeclaration(box,d){const r=maps.get(d.roadmapId);$('selection-kind').textContent=capital(d.kind)+' · blueprint';detailHeader(box,d.title,shortTitle(r.title),'#8fa8d0');box.append(el('span','landmark-kind',d.kind));section(box,'In the layer');item(box,d.layer);blueprintNodeDetails(box,r,d.id,d.file,null);}
function renderBlueprintPlanet(box,s){const r=maps.get(s.owner),x=s.expansion;$('selection-kind').textContent=capital(x.kind)+' · planet';detailHeader(box,stageTitle(s.id),shortTitle(r.title),'#8fa8d0');box.append(el('span','landmark-kind',x.kind));if(x.title&&x.title!==x.planet)box.append(el('p','detail-subtitle',x.title));if(!x.reviewed)box.append(el('span','status-chip','Added during review; not yet independently checked'));
 section(box,'In the layer');if(stages.has(s.parentStageId))item(box,s.parentStageId);
 const requirements=s.requires.filter(id=>stages.has(id)),consumers=s.consumers.filter(id=>stages.has(id));
 if(requirements.length){section(box,'Builds on');requirements.forEach(id=>item(box,id));}
 if(consumers.length){section(box,'Used in');consumers.forEach(id=>item(box,id));}
 blueprintNodeDetails(box,r,s.id,x.file,x);}
function blueprintNodeDetails(box,r,nodeId,index,embedded){
 const holder=el('div','blueprint-node'),path='data/blueprints/'+r.blueprint.files[index||0]+'.json';box.append(holder);
 const md=text=>{const n=el('div','md-content');n.append(TauMarkdown.render(String(text||''),{basePath:path}));return n;};
 const show=(node,packet)=>{clear(holder);
  const list=(title,items,render,ordered)=>{if(!Array.isArray(items)||!items.length)return;section(holder,title);const ul=el(ordered?'ol':'ul','reference-works blueprint-list');items.forEach(x=>{const li=el('li');render(li,x);ul.append(li);});holder.append(ul);};
  if(node.statement){section(holder,'Statement');holder.append(md(node.statement));}
  list('Hypotheses',node.hypotheses,(li,x)=>li.append(md(x)));
  list('Proof outline',node.proofSteps,(li,x)=>li.append(md(x)),true);
  list('Where it is used',node.uses,(li,x)=>li.append(md(`**${x.where||''}**: ${x.how||''}`)));
  list('API',node.api,(li,x)=>li.append(md(`\`${x.name||''}\` (${x.role||''}): ${x.statement||''}`)));
  list('Unit tests',node.tests,(li,x)=>li.append(md(`\`${x.name||''}\` (${x.kind||''}): ${x.statement||''}`)));
  list('Acceptance',node.acceptance,(li,x)=>li.append(md(x)));
  list('Prerequisites',node.prerequisites,(li,x)=>{const d=declarations.get('decl:'+x);if(stages.has(x)||d)li.append(btn(stages.has(x)?stageTitle(x):d.title,()=>openItem(stages.has(x)?x:'decl:'+x),'blueprint-link'));else li.append(el('code','',x));});
  const works=new Map(((packet&&packet.sources)||[]).map(w=>[w.id,w]));
  list('Sources',node.sources,(li,x)=>{const w=works.get(x.sourceId);const a=el(w?.url?'a':'span','',w?w.title:x.sourceId);if(w?.url){a.href=w.url;a.target='_blank';a.rel='noopener noreferrer';}li.append(a,document.createTextNode(' · '+(x.locator||'')));});
  if(node.library?.module)holder.append(el('p','detail-note',`Proposed home: ${node.library.module}${node.library.namespace?' ('+node.library.namespace+')':''}.`));
  holder.append(el('p','detail-note','Implementation status: unchecked. This is planning detail from an independently reviewed blueprint; progress is recorded on its layer.'));
  const links=el('p','detail-note');githubLink(links,path,'Blueprint packet on GitHub');holder.append(links);};
 if(embedded&&embedded.statement)show({statement:embedded.statement,hypotheses:embedded.hypotheses},null);else holder.append(el('p','detail-note','Loading the reviewed blueprint…'));
 fetchSiteFile(path,true).then(packet=>{const node=(packet.nodes||[]).find(n=>n.id===nodeId);if(node&&holder.isConnected)show(node,packet);}).catch(()=>{if(!holder.isConnected)return;if(!(embedded&&embedded.statement))clear(holder);const note=el('p','detail-note','The full statement, proof outline, API and unit tests are in the reviewed blueprint: ');githubLink(note,path,'packet on GitHub');holder.append(note);});}
function openBlueprintDocument(r){const docs=r.blueprint.documents,base={id:r.id,kind:'blueprint',title:r.title,summary:r.summary},backLink=`[Source document](${r.sourcePath})\n\n`;
 const offline=location.protocol==='file:';
 if(offline){showDocument({...base,text:`> The reviewed blueprint document lives with the published atlas, which this offline copy cannot reach. It is on GitHub: [${docs[0]}](${REPO_BLOB+docs[0]}).\n\n`+backLink+r.readme,path:r.sourcePath});return;}
 showDocument({...base,text:'*Loading the reviewed blueprint document…*',path:docs[0]});
 Promise.all(docs.map(path=>fetchSiteFile(path))).then(texts=>{if(currentDoc?.id===r.id)showDocument({...base,text:backLink+texts.join('\n\n---\n\n'),path:docs[0]});})
  .catch(()=>{if(currentDoc?.id===r.id)showDocument({...base,text:`> The reviewed blueprint document is read from the published atlas, which this copy cannot reach now. It is on GitHub: [${docs[0]}](${REPO_BLOB+docs[0]}).\n\n`+r.readme,path:r.sourcePath});});}
function renderRefinement(box,s){
 if(s.expansion.blueprint){renderBlueprintPlanet(box,s);return;}
 const r=maps.get(s.owner),x=s.expansion,parent=stages.get(s.parentStageId),expansion=(DATA.decompositions||[]).find(d=>d.roadmapId===s.owner);
 $('selection-kind').textContent=x.kind.charAt(0).toUpperCase()+x.kind.slice(1)+' · source refinement';
 detailHeader(box,stageTitle(s.id),shortTitle(r.title),'#8fa8d0');
 if(!x.reviewed)box.append(el('span','status-chip','Added during review; not yet independently checked'));
 box.append(el('p','detail-summary',x.statement));
 const md=el('div','md-content stage-description');md.append(TauMarkdown.render(s.description.replace(/^### .*\n\n[^\n]*\n\n/,''),{basePath:s.sourcePath}));box.append(md);
 section(box,'Refines');if(parent)item(box,parent.id);
 const requirements=s.requires.filter(id=>stages.has(id)),consumers=s.consumers.filter(id=>stages.has(id));
 if(requirements.length){section(box,'Builds on');requirements.forEach(id=>item(box,id));}
 if(consumers.length){section(box,'Used in');consumers.forEach(id=>item(box,id));}
 if(expansion){section(box,'Sources read');const list=el('ul','reference-works');for(const source of x.sources){const work=expansion.sources.find(w=>w.id===source.sourceId);const row=el('li');const link=el(work?.url?'a':'span','',work?work.title:source.sourceId);if(work?.url){link.href=work.url;link.target='_blank';link.rel='noopener noreferrer';}row.append(document.createTextNode((work?.authors?work.authors+' — ':'')));row.append(link,document.createTextNode(' · '+source.locator));list.append(row);}box.append(list);}
 box.append(el('p','detail-note','Implementation status: unchecked. This refinement is planning detail from the cited proof; it does not change the recorded progress of its layer and does not claim a formalised result.'),btn('Read full roadmap',()=>openReader(r.id),'secondary'));
}
function renderProgressControls(box,s,p){const card=el('div','progress-controls');card.append(el('h3','section-label','Track this layer'));const selectEl=el('select');selectEl.setAttribute('aria-label','Layer status');for(const [value,title]of Object.entries(labels)){const o=el('option','',title);o.value=value;if(value==='unknown')o.setAttribute('aria-label','No recorded status');selectEl.append(o);}selectEl.value=p.status||'unknown';const note=el('textarea');note.rows=2;note.maxLength=4000;note.placeholder='Evidence, PR link or a note (optional)';note.setAttribute('aria-label','Progress note');note.value=p.note||'';const count=descendants(s.id).length;if(count)card.append(el('p','detail-note',`Updating this layer also updates its ${count} sub-layers.`));card.append(selectEl,note);const row=el('div','button-row');row.append(btn('Save status',()=>{progress.setStage(s.id,selectEl.value,note.value);toast('Progress saved locally');},'primary'));if(p.manual)row.append(btn('Use recorded status',()=>{progress.resetStage(s.id);toast('Restored recorded status');},'quiet'));card.append(row);if(p.basis&&!['unknown','unreported'].includes(p.basis))card.append(el('p','detail-note','Source: '+String(p.basis).replace(/_/g,' ')+(p.snapshotDate?' · '+p.snapshotDate:'')));if(p.evidence?.length){const d=el('details','progress-evidence');d.append(el('summary','','Recorded evidence'));for(const evidence of p.evidence){d.append(el('p','detail-note',typeof evidence==='string'?evidence:evidence.quote||evidence.path||JSON.stringify(evidence)));}card.append(d);}box.append(card);}
function descendants(id){const result=[];const visit=n=>{for(const c of stageChildren.get(n)||[]){if(result.includes(c))continue;result.push(c);visit(c);}};visit(id);return result;}
function outLink(text,href){const a=el('a','topic-link',text);a.href=href;a.target='_blank';a.rel='noopener noreferrer';return a;}
// A complete roadmap, written up in Tau Ceti's own form: its README and Suggested.lean (research/blueprint/PROTOCOL.md section 20).
function packageSection(box,pkg){section(box,'Roadmap');box.append(el('p','detail-note','Complete, and written up as a Tau Ceti roadmap: a README and a Suggested.lean of its declarations.'));const links=el('div','report-links');links.append(outLink('README ↗',pkg.readme),outLink('Suggested.lean ↗',pkg.lean));box.append(links);}
// A Tau Ceti roadmap's latest report, as the Tau Ceti site's Progress page reads it.
function reportSection(box,board){const t=DATA.taucetiProgress,a=board.activity||{},how=board.assessment==='marker'?'read from the report\'s machine-readable header':board.assessment==='hand-read'?'transcribed by hand from the report':'not yet assessed by a report';
 // The Progress page lists no layers for a roadmap whose headings it cannot read (`## A1. ...`); the build reads them from the README.
 section(box,'Tau Ceti\'s latest report');box.append(el('p','detail-note',board.layers==='readme'?`Tau Ceti's Progress page (data of ${(t.exportedAt||'').slice(0,10)}) lists no layers for this roadmap, so the layers here are read from its README; none is assessed yet.`:`Layer states come from Tau Ceti's Progress page (data of ${(t.exportedAt||'').slice(0,10)}), ${how}.`));
 if(Number.isFinite(a.total))box.append(el('p','detail-note',`${a.total.toLocaleString()} pull requests merged under this roadmap, ${(a.recent||0).toLocaleString()} in the last ${t.recentDays||30} days${a.last?`, most recently on ${a.last.slice(0,10)}`:''}${a.open?`; ${a.open} open`:''}.`));
 if(board.frontier?.length){box.append(el('p','detail-note','Next, according to the report:'));const next=el('ul','region-topics');board.frontier.forEach(x=>next.append(el('li','',x)));box.append(next);}
 const links=el('div','report-links');if(board.status)links.append(outLink('Latest report ↗',board.status),outLink('Progress log ↗',board.status.replace(/STATUS\.md$/,'PROGRESS.md')));links.append(outLink('Progress page ↗',t.page));box.append(links);}
// A roadmap proposed in an open pull request to TauCetiRoadmap: who opened it, where it stands, and where to read it.
function pullSection(box,r){const p=r.pull,states=[p.draft?'draft':null,...(p.labels||[]).filter(l=>l.startsWith('awaiting-')).map(l=>l.replace('-',' '))].filter(Boolean);
 section(box,'Pull request');box.append(el('p','detail-note',`Proposed to Tau Ceti in pull request #${p.number}${p.author?` by ${p.author}`:''}${states.length?` (${states.join('; ')})`:''}. Its layers are read from the README on its branch, and none is formalised yet.`));
 const links=el('div','report-links');links.append(outLink(`Pull request #${p.number} ↗`,p.url),outLink('README on its branch ↗',r.sourcePath));box.append(links);}
function paperProgress(p){const s=progress.paper(p),percent=s.total?Math.round(s.complete/s.total*100):0,waiting=s.pending?`; ${s.pending} roadmap${s.pending===1?'':'s'} it calls for ${s.pending===1?'is':'are'} not in the atlas yet`:'';
 return {progress:percent,unlocked:s.unlocked,progressLabel:s.unlocked?'Unlocked: every layer it needs is formalised':`Locked: ${s.complete.toLocaleString()} of ${s.total.toLocaleString()} layers it needs are formalised${waiting}`};}
// What the atlas adds to Tau Ceti's own roadmaps: those proposed in open pull requests to TauCetiRoadmap.
function proposalNote(){const p=DATA.proposals,t=DATA.taucetiProgress,n=p.roadmaps.length,missing=(t.unplaced||[]).length+(p.unplaced||[]).length;
 return `Tau Ceti's ${Object.keys(t.roadmaps).length} roadmaps, from its Progress page (data of ${(t.exportedAt||'').slice(0,10)}), and ${n} proposed in ${p.pulls} open pull request${p.pulls===1?'':'s'}${p.updatedAt?` (as of ${p.updatedAt.slice(0,10)})`:''}.`+(missing?` ${missing} more ${missing===1?'is':'are'} not on this map yet.`:'');}
function renderAtlasProgress(){
 // Complete layers over all layers: the plainest reading of "how far along is this", and the
 // one the marker puts on the same ramp the map is drawn with.
 const summary=progress.atlas(),total=summary.total||0;
 const percent=total?Math.round(summary.complete/total*100):0;
 $('atlas-percent').textContent=percent+'%';
 $('atlas-count').textContent=total?`${summary.complete.toLocaleString()} of ${total.toLocaleString()} layers · ${summary.active.toLocaleString()} under way`:'no layers recorded';
 $('atlas-marker').style.left=percent+'%';
 // The Tau Ceti atlas: the share of the Progress page's layers that are done, with the page's own counts beneath.
 if(['tauceti','atlas'].includes(DATA.variant)){const c=DATA.taucetiProgress?.counts||{},unplaced=DATA.taucetiProgress?.unplaced||[],share=c.total?Math.round(c.done/c.total*100):0;$('atlas-percent').textContent=share+'%';$('atlas-figure-label').textContent='complete';$('atlas-marker').style.left=share+'%';
  $('atlas-count').textContent=`${(c.done||0).toLocaleString()} of ${(c.total||0).toLocaleString()} layers done · ${(c.partial||0).toLocaleString()} partial · ${(c.untouched||0).toLocaleString()} untouched · ${(c.unassessed||0).toLocaleString()} unassessed`+(c.proposed?` · ${c.proposed.toLocaleString()} proposed`:'');
  const readme=DATA.taucetiProgress?.readmeLayers||[],n=readme.length;
  $('atlas-source').textContent=DATA.proposals?proposalNote():`From Tau Ceti's Progress page, data of ${(DATA.taucetiProgress?.exportedAt||'').slice(0,10)}`+(n?`, and from the README${n===1?'':'s'} of ${n} roadmap${n===1?'':'s'} it lists without layers.`:'.')+(unplaced.length?` ${unplaced.length} newer roadmap${unplaced.length===1?' is':'s are'} not on this map yet.`:'');
  $('atlas-source').title=[n?'Layers read from READMEs, unassessed, as the Progress page lists none: '+readme.map(id=>id.split('/').pop()).join(', '):'',unplaced.length?'Not on this map yet: '+unplaced.map(u=>u.id.split('/').pop()).join(', '):'',(DATA.proposals?.unplaced||[]).length?'Proposed, not on this map yet (no area or no layers): '+DATA.proposals.unplaced.map(id=>id.split('/').pop()).join(', '):''].filter(Boolean).join('\n');return;}
 const all=[...papers.values()],open=all.filter(p=>progress.paper(p).unlocked).length;$('atlas-papers').textContent=all.length?`${open} of ${all.length} papers unlocked`:'No papers placed yet';
}
function render(){renderAtlasProgress();document.body.classList.toggle('is-system-view',!!state.layer);document.querySelector('[data-view="subjects"] small').textContent=allGroups.filter(g=>DATA.roadmaps.some(r=>r.group===g.id&&permitted(r))||visibleOpportunities().some(a=>a.group===g.id)).length;document.querySelectorAll('[data-view]').forEach(n=>n.classList.toggle('active',n.dataset.view===state.view||(state.view!=='subjects'&&n.dataset.view==='all')));$('source-filter').value=state.origin;$('activity-filter').value=state.activity;renderBreadcrumbs();renderInspector();renderCatalogue();renderPins();renderStats();syncGraph(true);}
function showDocument(doc){currentDoc=doc;$('reader-title').textContent=shortTitle(doc.title);const body=clear($('reader-body'));if(doc.summary){const synopsis=el('aside','reader-summary');synopsis.append(el('p','',doc.summary));body.append(synopsis);}body.append(TauMarkdown.render(doc.text,{basePath:doc.path}));$('open-source').href=fileURL(doc.path);clear($('reader-toc'));body.querySelectorAll('h2,h3').forEach(h=>{$('reader-toc').append(btn(h.dataset.tocLabel||h.textContent,()=>h.scrollIntoView({behavior:'smooth',block:'start'})));});if(!$('reader').open)$('reader').showModal();body.scrollTop=0;}
function openReader(id,kind='auto'){const r=maps.get(id);if(!r){const doc=documents.get(id);if(doc)showDocument({...doc,path:doc.sourcePath});return;}if(kind==='auto'&&r.blueprint?.documents?.length){openBlueprintDocument(r);return;}let text=r.readme,title=r.title,path=r.sourcePath;if(kind==='status'){text=r.statusMarkdown;title=r.title+' — status';path=r.sourcePath.replace(/README\.md$/,'STATUS.md');}if(kind==='progress'){text=r.progressMarkdown;title=r.title+' — progress log';path=r.sourcePath.replace(/README\.md$/,'PROGRESS.md');}if(!text&&r.readmeUrl&&!['status','progress'].includes(kind)){const doc={id,kind,title,path,summary:kind==='readme'?r.summary:null};showDocument({...doc,text:'*Reading the README on its pull request\'s branch…*'});
 fetchText(r.readmeUrl).then(t=>{if(currentDoc?.id===id)showDocument({...doc,text:t});}).catch(()=>{if(currentDoc?.id===id)showDocument({...doc,text:`> The README is on its pull request's branch, which this copy cannot reach now: [open it on GitHub](${path}).`});});return;}
 if(text)showDocument({id,kind,text,title,path,summary:kind==='readme'?r.summary:null});}

function fileURL(path){if(!path)return'#';try{if(/^(https?:|file:)/.test(path))return new URL(path).href;if(path.startsWith('/'))return new URL(path,'file:///').href;return new URL(path,location.href).href;}catch{return'#';}}
function download(name,text,type='application/json'){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function handleDocLink(event){const a=event.target.closest('[data-doc-link]');if(!a)return;event.preventDefault();const raw=a.dataset.docLink,base=a.dataset.basePath||currentDoc?.path||'';if(raw.startsWith('#')){const id=decodeURIComponent(raw.slice(1));const target=$('reader-body').querySelector('#'+CSS.escape(id))||$('inspector-content').querySelector('#'+CSS.escape(id));if(target)target.scrollIntoView({behavior:'smooth'});return;}let url;try{url=new URL(raw,fileURL(base));}catch{return;}const path=decodeURIComponent(url.pathname),r=DATA.roadmaps.find(x=>fileURL(x.sourcePath)===url.href.split('#')[0]||fileURL(x.sourcePath.replace(/README\.md$/,'STATUS.md'))===url.href.split('#')[0]||fileURL(x.sourcePath.replace(/README\.md$/,'PROGRESS.md'))===url.href.split('#')[0]);const doc=[...documents.values()].find(d=>fileURL(d.sourcePath)===url.href.split('#')[0]);if(r||doc){if(r)openReader(r.id,path.endsWith('STATUS.md')?'status':path.endsWith('PROGRESS.md')?'progress':'readme');else openReader(doc.id);if(url.hash)setTimeout(()=>{const target=$('reader-body').querySelector('#'+CSS.escape(decodeURIComponent(url.hash.slice(1))));target?.scrollIntoView();},50);return;}if(['file:','http:','https:'].includes(url.protocol))window.open(url.href,'_blank','noopener');}
document.addEventListener('click',handleDocLink);
$('search').addEventListener('input',renderCatalogue);
document.querySelectorAll('[data-view]').forEach(n=>n.addEventListener('click',()=>navigate({view:n.dataset.view,id:null,selected:null,tab:'overview'})));
$('source-filter').addEventListener('change',e=>navigate({origin:e.target.value,view:'all',id:null,selected:null,activity:'all'}));

$('activity-filter').addEventListener('change',e=>navigate({activity:e.target.value,view:'all',id:null,selected:null,...(e.target.value==='unmapped'?{unmapped:true,origin:'all'}:{})}));
$('catalogue-button').addEventListener('click',()=>{const open=document.body.classList.toggle('catalogue-open');$('catalogue-button').setAttribute('aria-expanded',String(open));if(open)$('search').focus();});
$('stats-button').addEventListener('click',()=>{renderStats();$('stats-dialog').showModal();});$('close-stats').addEventListener('click',()=>$('stats-dialog').close());
$('download-offline').addEventListener('click',()=>download('TauCeti_Atlas.html',offlineDocument,'text/html'));
$('close-inspector').addEventListener('click',()=>{state.selected=null;try{history.replaceState(null,'',routeHash(state));}catch{}renderInspector();renderCatalogue();graph.select(null);});
$('zoom-in').addEventListener('click',()=>graph.zoomIn());$('zoom-out').addEventListener('click',()=>graph.zoomOut());$('fit-graph').addEventListener('click',()=>graph.zoomToView(viewTarget(),true));
$('export-graph').addEventListener('click',()=>download('TauCeti-'+state.view+'.svg',graph.exportSVG(),'image/svg+xml'));
$('copy-link').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(location.href);toast('View link copied');}catch{toast('Bookmark this page to save the current view');}});
$('help-button').addEventListener('click',()=>$('help').showModal());$('close-help').addEventListener('click',()=>$('help').close());$('start-exploring').addEventListener('click',()=>$('help').close());$('close-reader').addEventListener('click',()=>$('reader').close());
$('download-readme').addEventListener('click',()=>{if(currentDoc)download(currentDoc.id.replace(/[^a-z0-9_-]/gi,'_')+'.md',currentDoc.text,'text/markdown');});
$('progress-button').addEventListener('click',()=>{$('storage-status').textContent=progress.persistent?'Changes save in this browser. Export a backup before moving or replacing the HTML file.':'Browser storage is unavailable. Export your progress before closing this page.';$('progress-dialog').showModal();});
$('close-progress').addEventListener('click',()=>$('progress-dialog').close());
$('export-progress').addEventListener('click',()=>download('TauCeti-progress-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(progress.export(),null,2)));
$('import-progress').addEventListener('click',()=>$('progress-file').click());
$('progress-file').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>5000000)throw new Error('Progress file is too large.');const count=progress.import(JSON.parse(await file.text()));toast('Imported progress'+(typeof count==='number'?` for ${count} layers`:''));$('progress-dialog').close();}catch(error){toast('Could not import: '+error.message);}e.target.value='';});
window.addEventListener('popstate',()=>{state=readRoute();render();});window.addEventListener('hashchange',()=>{state=readRoute();render();});
document.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();if(matchMedia('(max-width:600px)').matches){document.body.classList.add('catalogue-open');$('catalogue-button').setAttribute('aria-expanded','true');}$('search').focus();}if(event.key==='Escape'&&!document.querySelector('dialog[open]')&&state.selected){state.selected=null;renderInspector();graph.select(null);}});
progress.subscribe(()=>{renderInspector();renderCatalogue();renderStats();if(state.activity!=='all'){buildUniverse(true);graph.zoomToView(viewTarget(),false);return;}const update={};for(const g of universe.galaxies){const p=summarize(DATA.roadmaps.filter(r=>r.group===g.id&&permitted(r)));update[g.id]={progress:aggregateProgress(p),progressLabel:aggregateProgressLabel(p,'layers complete')};}for(const c of universe.constellations)if(maps.has(c.id)){const p=progress.roadmap(c.id);update[c.id]={progress:aggregateProgress(p),progressLabel:aggregateProgressLabel(p)};}for(const s of universe.stars){const p=progress.stage(s.id);update[s.id]={progress:stageProgress(p),progressLabel:labels[p.status]||''};}for(const a of universe.artefacts||[])update[a.id]=paperProgress(papers.get(a.id));graph.setProgress(update);});
$('roadmap-total').textContent=DATA.roadmaps.length.toLocaleString();$('stage-total').textContent=DATA.stages.length.toLocaleString();document.querySelector('[data-view="subjects"] small').textContent=allGroups.length;document.querySelector('[data-view="all"] small').textContent=DATA.roadmaps.length;
if(DATA.variant==='tauceti'){document.body.classList.add('variant-tauceti');document.title='Tau Ceti roadmaps — Tau Ceti Atlas';}if(DATA.variant==='atlas')document.body.classList.add('variant-atlas');
[...$('source-filter').options].filter(o=>o.value!=='all'&&!DATA.roadmaps.some(r=>(r.origin||'campaign')===o.value)).forEach(o=>o.remove());if(!(DATA.papers||[]).length)$('papers-guide').remove();
// The pull requests that have landed for each Tau Ceti roadmap, by the Progress page's count, are stars round it.
const landed=new Map(Object.entries(DATA.taucetiProgress?.roadmaps||{}).map(([id,board])=>[id,board.activity?.total||0]).filter(([,count])=>count>0));
if(landed.size){graph.setLanded(landed);const total=[...landed.values()].reduce((a,b)=>a+b,0);
 if($('landed-legend')){$('landed-legend').hidden=false;$('landed-legend').title=`${total.toLocaleString()} pull requests landed on ${landed.size} roadmaps`;}
 if($('landed-guide'))$('landed-guide').hidden=false;}
// The live galaxy (the Tau Ceti build): open pull requests twinkle beside their roadmaps until they merge (src/live.js).
const startLive=()=>{if(!DATA.live||!window.TauLive)return;const button=$('live-status'),count=button&&button.querySelector('b'),legend=$('live-legend'),guide=$('live-guide');
 if(guide)guide.hidden=false;
 const live=TauLive.create({...DATA.live,roadmapIds:new Set(DATA.roadmaps.map(r=>r.id)),onChange:(items,s)=>{graph.setLive(items);
  // The legend's key shows while the stars do.
  if(legend){legend.hidden=!!s.paused;legend.title=`${s.shown.toLocaleString()} open pull requests on ${s.roadmaps} roadmaps`;}
  if(!button)return;
  // Nothing to count yet (a first look refused, nothing remembered): no button, rather than "0 open PRs".
  button.hidden=!!s.error&&!s.shown&&!s.paused;if(button.hidden)return;button.setAttribute('aria-pressed',String(!s.paused));button.classList.toggle('paused',!!s.paused);button.classList.toggle('stale',!!s.error);
  count.textContent=s.paused?'Paused':s.shown.toLocaleString();
  button.title=s.paused?'Pull requests are not shown. Click to show them again.':`${s.error?s.error+'. ':''}${s.shown.toLocaleString()} open pull requests on ${s.roadmaps} roadmaps twinkle beside them until they merge${s.updated?' (updated '+s.updated.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+')':''}. Click to hide them.`;}});
 if(button)button.addEventListener('click',()=>live.setPaused(!live.status().paused));live.start();};
state=readRoute();render();startLive();window.TauExplorer={data:DATA,graph,progress,navigate,openItem,openStage,openReader,openLandmark,ascend,getState:()=>({...state}),getUniverse:()=>universe,getGraph:()=>({nodes:universe.constellations.map(c=>({id:c.id,type:c.unmapped?'unmapped':'roadmap',unmapped:!!c.unmapped,group:groups.get(c.galaxyId)?.label,progress:c.progress,progressLabel:c.progressLabel})),edges:universe.constellationEdges.map(e=>({source:e.source,target:e.target,kind:'stage_supported',stageCount:e.count}))}),landmarks:landmarkList,presentation,references,stageTitle,stageSummary,isMathematicalStage,landmarkTitle,version:'2026-09-15-universe'};
})();
