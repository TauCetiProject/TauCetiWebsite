#!/usr/bin/env node
// What the page used to work out from every roadmap's README and every layer's description when it started,
// worked out at build time by the page's own code (src/landmarks.js, src/presentation.js, src/references.js).
// The page no longer carries the READMEs, and reads the descriptions only when a panel needs them
// (scripts/lazy_data.py), so it draws and cites from this instead. scripts/build.py runs it; it needs Node.
//
// Before it writes anything it reads its own output back the way the page will, with the READMEs taken away,
// and compares every planet and every list of citations with what the page's code makes of the whole text.
//
// Usage: node scripts/derive.js ATLAS.json OUT_FOLDER
//   writes OUT_FOLDER/derived.json (for the page's data), OUT_FOLDER/bibliographies.json (each roadmap's own
//   bibliography, by roadmap id) and OUT_FOLDER/words.json (the READMEs' words, by roadmap id)
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = name => fs.readFileSync(path.join(__dirname, '..', 'src', name), 'utf8');
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const sandbox = { console };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const name of ['landmarks.js', 'presentation.js', 'references.js']) vm.runInContext(source(name), sandbox, { filename: name });
const { TauLandmarks, TauPresentation, TauReferences } = sandbox;

const lines = records => records.map(entry => (entry.sourceLine === undefined ? null : entry.sourceLine));
const stageIndex = new Map(data.stages.map((stage, at) => [stage.id, at]));
const roadmaps = new Map(data.roadmaps.map(roadmap => [roadmap.id, roadmap]));

// The planets, with the titles as the page shortens them before the curated names (data.landmarkLabels), which
// the page still applies itself.
const full = TauLandmarks.build(data);
const references = TauReferences.create(data);
const untitled = TauPresentation.create({ ...data, landmarkLabels: {} });
const rows = full.map(item => {
  const stage = data.stages[stageIndex.get(item.stageId)];
  if (String(stage.description || '').slice(item.start, item.end) !== item.description || item.sourceExcerpt !== item.description) {
    throw new Error('A landmark is not the passage of its layer that its offsets give: ' + item.id);
  }
  const shown = untitled.landmarkTitle(item), roadmap = roadmaps.get(item.roadmapId);
  const row = [stageIndex.get(item.stageId), item.title, item.kind, item.start, item.end, item.sourceLine === undefined ? null : item.sourceLine,
    shown === item.title ? null : shown, TauPresentation.plainExcerpt(TauPresentation.landmarkDescription(item))];
  const cited = roadmap ? lines(references.found.direct(item, roadmap)) : [];
  if (cited.length) row.push(cited);
  return row;
});

// The citations: a layer's keep their README lines, a roadmap's own bibliography is kept whole.
const layers = {}, bibliographies = {};
for (const stage of data.stages) {
  const roadmap = roadmaps.get(stage.owner);
  if (!roadmap) continue;
  const found = lines(references.found.layer(stage, roadmap));
  if (found.length) layers[stageIndex.get(stage.id)] = found;
}
for (const roadmap of data.roadmaps) {
  const found = references.found.roadmap(roadmap);
  if (found.length) bibliographies[roadmap.id] = found.map(entry => [entry.text, entry.sourceLine === undefined ? null : entry.sourceLine]);
}
const derived = { version: 1, landmarks: rows, references: { layers } };

// The words of each README, for the search: its runs of letters and digits, as the search folds them
// (src/app.js, fold), grouped by how often each occurs: {count: 'word word ...'}. The search looks for each word
// of a query anywhere in a roadmap's text and ranks by how often it occurs. A query word of letters and digits
// can only occur inside such a run, so the runs with their counts find and rank the same roadmaps as the whole
// text did, at a fraction of its size. A query word with punctuation in it no longer matches inside a README.
const fold = text => String(text || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[-\u2010-\u2015\u2212]/g, ' ').replace(/\s+/g, ' ').trim();
const words = {};
for (const roadmap of data.roadmaps) {
  if (!roadmap.readme) continue;
  const counts = new Map();
  for (const word of fold(roadmap.readme).match(/[\p{L}\p{N}]+/gu) || []) counts.set(word, (counts.get(word) || 0) + 1);
  const groups = {};
  for (const word of [...counts.keys()].sort()) (groups[counts.get(word)] = groups[counts.get(word)] || []).push(word);
  for (const count of Object.keys(groups)) groups[count] = groups[count].join(' ');
  if (counts.size) words[roadmap.id] = groups;
}

// Read it back as the page will: the same data without the READMEs, with what was derived.
const page = { ...data, roadmaps: data.roadmaps.map(roadmap => { const copy = { ...roadmap }; delete copy.readme; return copy; }), derived: JSON.parse(JSON.stringify(derived)),
  roadmapBibliographies: JSON.parse(JSON.stringify(bibliographies)) };
const restored = TauLandmarks.restore(page, page.derived.landmarks);
const pageReferences = TauReferences.create(page), titles = TauPresentation.create(data), pageTitles = TauPresentation.create(page);
if (restored.length !== full.length) throw new Error('The landmarks do not survive the round trip.');
const differs = (a, b) => JSON.stringify(a) !== JSON.stringify(b);
for (let i = 0; i < full.length; i++) {
  const a = full[i], b = restored[i];
  for (const key of ['id', 'stageId', 'roadmapId', 'title', 'kind', 'description', 'sourcePath', 'sourceExcerpt', 'sourceLine']) {
    if (a[key] !== b[key]) throw new Error('A landmark does not survive the round trip: ' + a.id + ' (' + key + ')');
  }
  if (('sourceLine' in a) !== ('sourceLine' in b)) throw new Error('A landmark does not survive the round trip: ' + a.id + ' (sourceLine)');
  if (titles.landmarkTitle(a) !== pageTitles.landmarkTitle(b)) throw new Error('A landmark is not shown under the same name: ' + a.id);
  if (TauPresentation.plainExcerpt(TauPresentation.landmarkDescription(a)) !== b.excerpt) throw new Error('A landmark does not keep its excerpt: ' + a.id);
  if (differs(references.forLandmark(a), pageReferences.forLandmark(b))) throw new Error('A landmark does not keep its citations: ' + a.id);
}

fs.mkdirSync(process.argv[3], { recursive: true });
fs.writeFileSync(path.join(process.argv[3], 'derived.json'), JSON.stringify(derived));
fs.writeFileSync(path.join(process.argv[3], 'words.json'), JSON.stringify(words));
fs.writeFileSync(path.join(process.argv[3], 'bibliographies.json'), JSON.stringify(bibliographies));
process.stdout.write(JSON.stringify({ landmarks: rows.length, layersWithCitations: Object.keys(layers).length, roadmapsWithBibliography: Object.keys(bibliographies).length, roadmapsWithWords: Object.keys(words).length }) + '\n');
