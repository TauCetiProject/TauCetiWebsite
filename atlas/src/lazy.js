(function () {
  'use strict';

  // The page carries the core of the atlas: what the map draws. The long text (every layer's description, each
  // roadmap's bibliography, the evidence of each link, the statements of Mathlib's items, the READMEs' words for
  // the search) is in parts
  // beside the page, which scripts/lazy_data.py writes. A part is a script that hands its JSON to TauAtlasPart;
  // a script, not a fetch, so that a copy opened from a folder on disk reads its parts too. An offline copy
  // carries the parts inside itself instead, as inert JSON elements that are read when first needed.
  const CALLBACK = 'TauAtlasPart', ATTRIBUTE = 'data-atlas-part';
  const arrived = new Map();
  window[CALLBACK] = function (name, text) { const take = arrived.get(name); if (take) take(text); };

  function create(data) {
    const manifest = data && data.lazy;
    const files = manifest && manifest.parts || {}, textParts = manifest && manifest.text || {};
    const names = Object.keys(files).sort();
    const known = new Set(names), loaded = new Set(), pending = new Map(), listeners = [];
    const embedded = new Map();
    if (manifest) document.querySelectorAll('script[' + ATTRIBUTE + ']').forEach(node => embedded.set(node.getAttribute(ATTRIBUTE), node));
    const inline = names.length > 0 && names.every(name => embedded.has(name));
    let stages = null;

    function apply(name, part) {
      if (loaded.has(name)) return;
      if (part.t) {
        if (!stages) stages = new Map(data.stages.map(stage => [stage.id, stage]));
        for (const id of Object.keys(part.t)) {
          for (const [stageId, value] of part.t[id]) {
            const stage = stages.get(stageId);
            if (stage) stage.description = value;
          }
        }
      }
      if (part.b) data.roadmapBibliographies = Object.assign(data.roadmapBibliographies || {}, part.b);
      if (part.k) data.readmeWords = part.k;
      for (const [index, evidence] of part.e || []) if (data.edges[index]) data.edges[index].evidence = evidence;
      for (const [index, evidence] of part.se || []) if (data.stageEdges[index]) data.stageEdges[index].evidence = evidence;
      for (const [index, held] of part.d || []) if (data.mathlibDisk && data.mathlibDisk.items[index]) Object.assign(data.mathlibDisk.items[index], held);
      loaded.add(name);
      for (const listener of listeners.slice()) listener(name);
    }

    function readEmbedded(name) {
      const node = embedded.get(name);
      if (!node || loaded.has(name)) return loaded.has(name);
      embedded.delete(name);
      apply(name, JSON.parse(node.textContent));
      node.remove();
      return true;
    }

    // Whether these parts are in the data now. An offline copy's parts are read here, when first asked for.
    function has(list) {
      for (const name of list || []) {
        if (!known.has(name) || loaded.has(name)) continue;
        if (!readEmbedded(name)) return false;
      }
      return true;
    }

    function loadOne(name) {
      if (!known.has(name) || loaded.has(name)) return Promise.resolve();
      if (embedded.has(name)) { readEmbedded(name); return Promise.resolve(); }
      if (!pending.has(name)) pending.set(name, new Promise((resolve, reject) => {
        const script = document.createElement('script');
        const done = error => { arrived.delete(name); pending.delete(name); script.remove(); if (error) reject(error); else resolve(); };
        arrived.set(name, text => { try { apply(name, JSON.parse(text)); done(); } catch (error) { done(error); } });
        script.async = true;
        script.src = manifest.folder + '/' + files[name][0];
        script.onerror = () => done(new Error('The atlas could not read ' + name));
        // A file that loads without handing over its part is not the part.
        script.onload = () => { if (arrived.has(name)) done(new Error('The atlas could not read ' + name)); };
        document.head.append(script);
      }));
      return pending.get(name);
    }

    function load(list) { return Promise.all((list || []).map(loadOne)).then(() => undefined); }

    // Everything, a few parts at a time, giving the page a turn between them.
    let everything = null;
    function all() {
      if (!everything) {
        const queue = names.filter(name => !loaded.has(name));
        const pause = () => new Promise(resolve => setTimeout(resolve, 0));
        const worker = async () => { while (queue.length) { await loadOne(queue.shift()); await pause(); } };
        everything = Promise.all(Array.from({ length: inline ? 1 : 4 }, worker)).then(() => undefined);
        everything.catch(() => { everything = null; });
      }
      return everything;
    }

    function roadmapsOf(name) { return Object.keys(textParts).filter(id => textParts[id] === name); }

    // The parts as an offline copy carries them, written from the data: one element's text each. Call after all().
    function serialize() {
      const output = [];
      const escape = text => text.replace(/</g, '\\u003c').replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028').replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');
      const owned = new Map();
      for (const stage of data.stages) {
        if (!owned.has(stage.owner)) owned.set(stage.owner, []);
        owned.get(stage.owner).push(stage);
      }
      for (const name of names) {
        const part = {};
        const members = roadmapsOf(name);
        if (members.length) {
          part.t = {};
          for (const id of members) part.t[id] = (owned.get(id) || []).filter(stage => typeof stage.description === 'string' && stage.description).map(stage => [stage.id, stage.description]);
          const kept = data.roadmapBibliographies || {};
          for (const id of members) if (kept[id]) (part.b = part.b || {})[id] = kept[id];
        }
        if (name === 'words') part.k = data.readmeWords || {};
        if (name === 'links') {
          for (const [key, short] of [['edges', 'e'], ['stageEdges', 'se']]) {
            const rows = [];
            (data[key] || []).forEach((edge, index) => { if (edge.evidence) rows.push([index, edge.evidence]); });
            if (rows.length) part[short] = rows;
          }
        }
        if (name === 'disk') {
          part.d = [];
          ((data.mathlibDisk || {}).items || []).forEach((item, index) => {
            const held = {};
            for (const key of ['sig', 'doc']) if (item[key]) held[key] = item[key];
            if (Object.keys(held).length) part.d.push([index, held]);
          });
        }
        output.push('<script type="application/json" ' + ATTRIBUTE + '="' + name + '">' + escape(JSON.stringify(part)) + '</' + 'script>');
      }
      return output;
    }

    return Object.freeze({
      enabled: names.length > 0,
      inline,
      names,
      has,
      load,
      all,
      serialize,
      roadmapsOf,
      isLoaded: name => !known.has(name) || loaded.has(name),
      complete: () => names.every(name => loaded.has(name)),
      textPart: roadmapId => (known.has(textParts[roadmapId]) ? textParts[roadmapId] : null),
      onPart: listener => { listeners.push(listener); }
    });
  }

  window.TauLazy = Object.freeze({ create });
})();
