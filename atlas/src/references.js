(function () {
  'use strict';

  // This indexes citations already present in the embedded sources. The scopes
  // describe where a citation was written, not which theorem it proves.
  //
  // The page no longer carries the READMEs. What this read from them is made at build time by this same code
  // (scripts/derive.js) and comes with the page as data.derived.references: the README line of each citation
  // of a planet or a layer, whose text the page still reads from the layer's description; and each roadmap's
  // own bibliography whole, as data.roadmapBibliographies.
  const bibliographyHeading = /^(?:references?|sources|bibliography|further reading|reading list|primary (?:references?|sources?))\b/i;
  const boilerplate = /source register and machine-readable references|campaign primary source registry|source versions and download checks|bibliographic citation does not claim|source-to-Lean|source[- ](?:decomposition|concordance)|preserved source-unit readiness|source theorem numbers refer to those versions|needs_source_decomposition|catalogue or abstract check|before marking this area implemented|every exported object needs|generated work queue/i;
  const emptyRoute = /^(?:stage contracts?\b|source-specific downstream estimates\b|source register\b|select(?:ion of)? (?:the )?(?:exact |appropriate |original |primary )?sources?\b|sources? (?:pending|to be selected|not yet selected)|existing (?:owner|interface|contract|inventory)s?\b|local (?:source )?inventor(?:y|ies)\b)/i;
  const sourceMarker = /\*\*(?:References?|Sources?|Source route|Primary references?|Primary sources?|Further reading)\s*[.:]?\*\*\s*[.:]?\s*|\b(?:References?|Sources?|Source route|Primary references?|Primary sources?|Further reading)\s*:\s*|(?:^|\n)\s*(?:References?|Sources?|Source route|Primary references?|Primary sources?|Further reading)\.\s+/gi;
  const externalLink = /\[[^\]]+\]\(https?:\/\/[^\s)]+\)|<https?:\/\/[^\s>]+>|https?:\/\/[^\s<>]+/i;
  const bibliographicDetail = /§{1,2}\s*[\dIVX]|\b(?:Chapters?|Chs?\.|Appendix|Appendices|Lectures?|GTM|ISBN|arXiv|doi)\s*[\dIVXA-Z]|\b(?:Springer|Birkh[aä]user|Cambridge|Princeton|Universitext|Colloquium Publications)\b/i;
  const titledWork = /(?:\p{Lu}[\p{L}’'–-]+[,.]?\s+){1,5}\*[^*\n]{6,}\*/u;
  const chapterLocator = /\b\p{Lu}[\p{L}’'–-]+(?:[–-]\p{Lu}[\p{L}’'–-]+)?(?:['’]s)?\s+(?:Theorem|Lemma|Proposition|Corollary|Chapter|Lecture|§)\s*[\dIVX]/u;
  const sourceIdList = /^\s*`?[A-Z][A-Z0-9_:-]{2,}`?\s*[,;]\s*`?[A-Z][A-Z0-9_:-]{2,}`?\b/;

  function clean(text) {
    // External papers remain links. A local PDF is never made a public asset.
    return String(text || '')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (all, label, href) => !/^https?:\/\//i.test(href.trim()) && /\.pdf(?:[?#\s]|$)/i.test(href) ? label : all)
      .replace(/`[^`\n]*\.pdf`/gi, '')
      .replace(/<(?!(?:https?):\/\/)[^>\n]*\.pdf>/gi, '')
      .replace(/(?<![\w:/])(?:\.\.?\/|\/(?:Users|home|private|tmp)\/|references\/|downloads\/)[^\s<>]*\.pdf\b/gi, '')
      .replace(/^[ \t]*<a\b[^>]*>\s*<\/a>[ \t]*$/gim, '')
      .trim();
  }

  function blocks(text) {
    const result = [];
    let start = 0, buffer = [], fenced = false;
    const lines = String(text || '').split('\n');
    function flush() {
      const value = buffer.join('\n').trim();
      if (value) result.push({ text: value, line: start + 1 });
      buffer = [];
    }
    lines.forEach((line, index) => {
      if (/^\s*(?:```|~~~)/.test(line)) { flush(); fenced = !fenced; return; }
      if (fenced) return;
      const boundary = /^#{1,6}\s|^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(line);
      if (!line.trim()) { flush(); return; }
      if (boundary) flush();
      if (!buffer.length) start = index;
      buffer.push(line);
      if (/^#{1,6}\s/.test(line)) flush();
    });
    flush();
    return result;
  }

  function citationParts(text, bibliography) {
    if (/^#{1,6}\s|^\s*\|/.test(text) || boilerplate.test(text)) return [];
    const markers = [...text.matchAll(sourceMarker)];
    if (markers.length) {
      return markers.map((match, index) => {
        const end = index + 1 < markers.length ? markers[index + 1].index : text.length;
        const part = text.slice(match.index, end).trim();
        const payload = text.slice(match.index + match[0].length, end).replace(/^[*\s]+/, '');
        return !payload || emptyRoute.test(payload) ? '' : part;
      }).filter(part => part && !boilerplate.test(part));
    }
    if (bibliography && (/^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(text) || sourceIdList.test(text)) || externalLink.test(text) || bibliographicDetail.test(text) || titledWork.test(text) || chapterLocator.test(text)) return [text];
    return [];
  }

  function create(data) {
    const roadmaps = new Map((data.roadmaps || []).map(roadmap => [roadmap.id, roadmap]));
    const stages = new Map((data.stages || []).map(stage => [stage.id, stage]));
    const children = new Map(), stagesByRoadmap = new Map();
    const layerCache = new Map(), roadmapCache = new Map(), sourceOffsets = new Map();
    const derived = data.derived && data.derived.references || null;
    const stageIndex = new Map();
    if (derived) (data.stages || []).forEach((stage, at) => stageIndex.set(stage.id, at));
    // The README lines found at build time, in place of those a search of the README would give here.
    function located(records, lines) {
      if (lines) records.forEach((entry, at) => { entry.sourceLine = lines[at] === null || lines[at] === undefined ? undefined : lines[at]; });
      return records;
    }
    for (const stage of stages.values()) {
      if (!stagesByRoadmap.has(stage.owner)) stagesByRoadmap.set(stage.owner, []);
      stagesByRoadmap.get(stage.owner).push(stage);
      if (stage.parentStageId) {
        if (!children.has(stage.parentStageId)) children.set(stage.parentStageId, []);
        children.get(stage.parentStageId).push(stage);
      }
    }

    function record(text, roadmap, original, fallbackLine) {
      const value = clean(text);
      if (!value) return null;
      const source = String(roadmap?.readme || '');
      if (!sourceOffsets.has(roadmap.id)) {
        const offsets = [0];
        for (let at = source.indexOf('\n'); at >= 0; at = source.indexOf('\n', at + 1)) offsets.push(at + 1);
        sourceOffsets.set(roadmap.id, offsets);
      }
      const preferredStart = sourceOffsets.get(roadmap.id)[Math.max(0, (fallbackLine || 1) - 1)] || 0;
      let at = source.indexOf(text, preferredStart);
      if (at < 0 && original) at = source.indexOf(original, preferredStart);
      if (at < 0) at = source.indexOf(text);
      if (at < 0 && original) at = source.indexOf(original);
      return {
        text: value,
        sourcePath: roadmap?.sourcePath || '',
        sourceLine: at < 0 ? fallbackLine : source.slice(0, at).split('\n').length
      };
    }

    function extract(text, roadmap, fallbackLine, bibliography = false) {
      return blocks(text).flatMap(block => citationParts(block.text, bibliography)
        .map(part => record(part, roadmap, block.text, fallbackLine ? fallbackLine + block.line - 1 : undefined))
        .filter(Boolean));
    }

    function layerReferences(stage, roadmap) {
      if (layerCache.has(stage.id)) return layerCache.get(stage.id);
      // The shared scope routine removes nested child passages and clips legacy
      // sections to their own named anchor rather than inheriting sibling citations.
      const passages = window.TauLandmarks.passages(stage, children.get(stage.id));
      const result = located(passages.flatMap(text => extract(text, roadmap, stage.sourceLine)), derived && (derived.layers[stageIndex.get(stage.id)] || []));
      layerCache.set(stage.id, result);
      return result;
    }

    function roadmapReferences(roadmap) {
      if (roadmapCache.has(roadmap.id)) return roadmapCache.get(roadmap.id);
      // Its bibliography as the build found it in the README, which comes with the roadmap's part (src/lazy.js).
      if (derived) return ((data.roadmapBibliographies || {})[roadmap.id] || []).map(([text, line]) => ({ text, sourcePath: roadmap.sourcePath || '', sourceLine: line === null ? undefined : line }));
      const owned = stagesByRoadmap.get(roadmap.id) || [];
      const occupied = owned.map(stage => [stage.contextStartLine || stage.sourceLine, stage.contextEndLine || stage.sourceLine]);
      let bibliography = false, depth = 0;
      const result = [];
      for (const block of blocks(roadmap.readme)) {
        const heading = /^(#{1,6})\s+(.+)/.exec(block.text);
        if (heading) {
          if (heading[1].length <= depth) bibliography = false;
          // References inside a stage belong to that stage. Roadmap bibliographies
          // are top-level sections, including the common "Reference spine" heading.
          if (heading[1].length <= 2 && bibliographyHeading.test(heading[2]) && !/sources and evidence/i.test(heading[2])) {
            bibliography = true; depth = heading[1].length;
          }
          continue;
        }
        const insideStage = occupied.some(([start, end]) => start && block.line >= start && block.line <= end);
        const explicitHeader = [...block.text.matchAll(sourceMarker)].length > 0;
        if (!bibliography && (insideStage || !explicitHeader)) continue;
        result.push(...citationParts(block.text, bibliography)
          .map(part => record(part, roadmap, block.text, block.line)).filter(Boolean));
      }
      roadmapCache.set(roadmap.id, result);
      return result;
    }

    // This small dictionary is already part of the public source snapshot. Keep
    // its original title/link; do not invent expanded titles for unknown aliases.
    const dictionary = [];
    for (const document of data.documents || []) {
      if (document.id !== 'guide:EXTENSION_SOURCES') continue;
      String(document.text || '').split('\n').forEach((line, index) => {
        const match = /^\|\s*([A-Z][A-Z0-9-]+)\s*\|\s*(.*?)\s*\|/.exec(line);
        if (!match || ['ID', 'LOCAL', 'EXISTING'].includes(match[1])) return;
        dictionary.push({ key: match[1], reference: { text: match[1] + ': ' + clean(match[2]), sourcePath: document.sourcePath, sourceLine: index + 1 } });
      });
    }

    const works = (data.bibliography?.works || []).map(work => ({
      ...work,
      patterns: (work.aliases || []).map(alias => new RegExp('(^|[^\\p{L}\\p{N}_])' + alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^\\p{L}\\p{N}_]|$)', work.caseSensitive ? 'u' : 'iu'))
    }));
    function enrich(entry, roadmap) {
      const matches = works.filter(work => (!work.roadmapIds || work.roadmapIds.includes(roadmap.id)) && work.patterns.some(pattern => pattern.test(entry.text)));
      if (!matches.length) return { ...entry };
      return {
        ...entry,
        works: matches.map(work => ({ title: work.title, authors: work.authors, ...(work.url ? { url: work.url } : {}) }))
      };
    }

    function forLandmark(item) {
      const stage = stages.get(item?.stageId), roadmap = roadmaps.get(item?.roadmapId || stage?.owner);
      if (!item || !stage || !roadmap) return { direct: [], layer: [], roadmap: [] };
      const seen = new Set();
      function unique(records) {
        const output = [];
        for (const entry of records) {
          const key = entry.text.replace(/\s+/g, ' ').trim();
          if (!key || seen.has(key)) continue;
          seen.add(key); output.push(enrich(entry, roadmap));
          for (const { key: alias, reference } of dictionary) {
            const expression = new RegExp('(^|[^A-Z0-9-])' + alias + '([^A-Z0-9-]|$)');
            const dictionaryKey = reference.text.replace(/\s+/g, ' ').trim();
            if (expression.test(entry.text) && !seen.has(dictionaryKey)) {
              seen.add(dictionaryKey); output.push(enrich(reference, roadmap));
            }
          }
        }
        return output;
      }
      return {
        direct: unique(directReferences(item, roadmap)),
        layer: unique(layerReferences(stage, roadmap)),
        roadmap: unique(roadmapReferences(roadmap))
      };
    }
    function directReferences(item, roadmap) {
      return located(extract(item.sourceExcerpt || item.description, roadmap, item.sourceLine), derived && (item.referenceLines || []));
    }
    // The three lists before they are merged, for scripts/derive.js.
    const found = Object.freeze({ direct: directReferences, layer: layerReferences, roadmap: roadmapReferences });
    return Object.freeze({ forLandmark, found });
  }

  window.TauReferences = Object.freeze({ create });
})();
