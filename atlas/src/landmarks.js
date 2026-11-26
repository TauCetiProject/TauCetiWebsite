(function () {
  'use strict';

  // These are reading landmarks extracted from a specification, never proof-status records.
  // Keep the quoted source with every label so the UI can show its actual hypotheses and scope.
  const metadata = /^(?:inputs?|dependenc(?:y|ies)|source(?: route|s)?|execution state|milestone|status|implementation|references?|prerequisites?|consumer|source unit|original prerequisites)\b/i;
  const explicitTheorem = /\b(?:theorem|lemma|proposition|corollary)\b/i;
  const explicitDefinition = /\bdefinition\b/i;
  const action = /^(?:construct(?: and export)?|develop|define|prove|establish|build|export|identify|compute|show|introduce|form|derive|recover|compare|extend|record|implement|integrate|own|use|reuse|import)\s+/i;

  function plain(text) {
    return String(text || '').replace(/<\/?(?:a|span|div|p|br|sup|sub|code|em|strong)(?:\s[^>]*)?\/?>/gi, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[`*]/g, '').replace(/\\([()[\]*_])/g, '$1')
      .replace(/\s+/g, ' ').trim();
  }

  function title(text) {
    let value = plain(text).replace(/^(?:[-+]\s+|\d+[.)]\s+)/, '')
      .replace(/^\([a-z][′']?\)\s*/i, '').replace(/[.:;\s]+$/, '');
    if (value.length > 94) {
      const cut = value.slice(0, 94).lastIndexOf(' ');
      value = value.slice(0, cut > 45 ? cut : 94).replace(/[,;:\s]+$/, '');
    }
    return value;
  }

  // Labels describe mathematical objects and results. Workflow instructions remain
  // available in the quoted source, but do not become stars in the mathematics map.
  const procedural = /\b(?:owners?|ownership|audits?|audited|auditing|roadmaps?|APIs?|execution|implementations?|repositories|repository|tickets?|dependenc(?:y|ies)|milestones?|checkpoints?|readiness|upstream|suppliers?|producer|reexport(?:s|ed|ing)?|import(?:s|ed|ing)?|export(?:s|ed|ing)?|Mathlib|Lean|TauCeti|software|placeholder|hand-off|handoff)\b|checked against|source[- ](?:decomposition|concordance|index|corpus|route|proof|theorem number)|private repo|proof tasks?|proof-source|source-decomposed|suggested home|what to build|arithmetic verification|representability source|source\s+(?:index|corpus|concordance)/i;
  const genericLabel = /^(?:the |a |an )?(?:structural|canonical|early|late|general|mathematical|element-level|headline|concrete|target|construction|acceptance|input|output|status|warning|hypotheses|compatibility|to develop|develop|first|second|third|here|there|reusable|interface|interfaces|the|a|an|for|then|then prove|add|provide|produce exact|package separate|this completed|tests?|consumers?|objects|stretch|acceptance examples|applications|consequences|proposition|definition|theorem|a\.e|weight-role note|then, staged|\(early\))$/i;

  function mathematicalLabel(candidate) {
    const raw = plain(candidate.label);
    const source = plain(candidate.text);
    function usable(value) {
      value = title(value).replace(/^(?:the |an? )/i, '').replace(/\s+(?:and|or|with|of|to|from|the|a|an)$/i, '').trim();
      if (value.length < 3 || genericLabel.test(value) || procedural.test(value) || metadata.test(value) || /^[A-Z][A-Z0-9-]{1,8}\s*(?:§|[0-9])[\d§.\s:–—-]*$/.test(value) || /^[A-Z]{1,6}\.\d+(?::[a-z][a-z-]*)?$/.test(value)) return null;
      // Cleaning is only removal of a wrapper: never splice or invent a phrase.
      return source.includes(value) ? value : null;
    }
    let label = raw.replace(/^(?:Acceptance(?: examples)?(?: include)?(?:\s*[:.]\s*|\s+)|(?:Audit|Check|Test|Verify|Add|Provide|Package|Produce)\s+)/i, '')
      .replace(/\s*\((?:consumed, one owner|a separate milestone)\)\s*$/i, '')
      .replace(/\s+(?:API|interface)(?:\s+explicitly)?$/i, '')
      .replace(/^(?:source-(?:scoped|qualified|selected|admitted|specific|complete)\s+)/i, '');
    // Preserve named mathematics before a trailing implementation or source qualifier.
    const cut = label.search(/\s+(?:API|interface)\b|\s+(?:and\s+)?source-(?:scoped|qualified|selected|admitted|specific|complete)\b|\s+(?:with|through|from|using|following|under)\s+(?:(?:the|a|an)\s+)?(?:existing owners?|audited|source(?:'s)?\b)/i);
    if (cut > 0) label = label.slice(0, cut);
    const direct = usable(label);
    if (direct) return direct;
    // A generic heading such as “Definition” can introduce an explicit mathematical
    // sentence. Use that sentence rather than keeping the heading as the star name.
    const body = candidate.text.replace(/^(?:[-*+]\s+|\d+[.)]\s+)?\*\*[^*]+\*\*\s*[:.]?\s*/, '');
    if (body !== candidate.text) {
      const first = plain(body).replace(action, '').split(/\.\s+(?=[A-Z])/)[0];
      const phrase = usable(first);
      if (phrase) return phrase;
    }
    // An informative bold mathematical phrase can sit under a procedural heading.
    // Reuse only that verbatim phrase; a paragraph with no such phrase is omitted.
    for (const match of candidate.text.matchAll(/\*\*([^*]+)\*\*/g)) {
      const phrase = usable(plain(match[1]));
      if (phrase && phrase !== raw && !/^(?:not|already|only|all|no|same|important|crucial)\b/i.test(phrase)) return phrase;
    }
    return null;
  }

  function kind(label) {
    if (/\b(?:uses?|consumes?|imports?|existing|already)\b/i.test(label)) return 'construction';
    if (explicitTheorem.test(label) && !/\bnot (?:a |the )?(?:theorem|lemma|proposition|corollary)\b/i.test(label)) return 'theorem';
    if (explicitDefinition.test(label) && !/\bnot (?:a |the )?definition\b/i.test(label)) return 'definition';
    return 'construction';
  }

  function hash(value) {
    let result = 2166136261;
    for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
    return (result >>> 0).toString(36);
  }

  function scope(stage, children) {
    const original = String(stage.description || '');
    let start = 0, end = original.length;
    // Some legacy source units share a whole section. Its matching anchor identifies this unit.
    const escaped = String(stage.key || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (escaped) {
      const anchor = new RegExp('<a\\s+[^>]*id=["\'](?:stage-)?' + escaped + '["\'][^>]*>\\s*</a>', 'i').exec(original);
      if (anchor) {
        start = anchor.index + anchor[0].length;
        const next = /<a\s+[^>]*id=["'][^"']+["'][^>]*>\s*<\/a>/i.exec(original.slice(start));
        if (next) end = start + next.index;
      }
    }
    const omissions = [];
    for (const child of children || []) {
      const text = String(child.description || '').trim();
      if (!text || text === original.trim()) continue;
      let at = original.indexOf(text, start);
      while (at >= start && at < end) {
        omissions.push([at, Math.min(end, at + text.length)]);
        at = original.indexOf(text, at + text.length);
      }
    }
    omissions.sort((a, b) => a[0] - b[0]);
    const ranges = [];
    let cursor = start;
    for (const [a, b] of omissions) {
      if (a > cursor) ranges.push([cursor, a]);
      cursor = Math.max(cursor, b);
    }
    if (cursor < end) ranges.push([cursor, end]);
    return { original, ranges };
  }

  function blocks(source, ranges) {
    const result = [];
    for (const [from, to] of ranges) {
      const lines = source.slice(from, to).match(/[^\n]*(?:\n|$)/g) || [];
      let cursor = from, start = null, fence = false, bullet = false;
      function flush(end) {
        if (start !== null) {
          const raw = source.slice(start, end), trimmed = raw.trim();
          if (trimmed) result.push({ text: trimmed, start: start + raw.indexOf(trimmed), end: start + raw.indexOf(trimmed) + trimmed.length });
        }
        start = null; bullet = false;
      }
      for (const line of lines) {
        const isFence = /^\s*(```|~~~)/.test(line);
        const isHeading = /^#{1,6}\s/.test(line);
        const isBullet = /^(?:[-*+]\s+|\d+[.)]\s+)/.test(line);
        const isAnchor = /^\s*<a\s[^>]*>\s*<\/a>\s*$/.test(line);
        if (!fence && (isHeading || isBullet || isAnchor)) flush(cursor);
        if (isAnchor) { cursor += line.length; continue; }
        if (!fence && !line.trim()) {
          if (!bullet) flush(cursor);
          cursor += line.length; continue;
        }
        if (start === null) { start = cursor; bullet = isBullet; }
        if (isFence) fence = !fence;
        cursor += line.length;
        if (isHeading && !fence) flush(cursor);
      }
      flush(to);
    }
    return result;
  }

  function candidates(stage, source, ranges) {
    const result = [];
    for (const block of blocks(source, ranges)) {
      const text = block.text;
      const heading = /^#{1,6}\s+(.+)/.exec(text);
      // A stage's own heading repeats the object the reader has just opened.
      if (heading) {
        if (plain(heading[1]) === plain(stage.title) || block.start === 0 || !/\b(?:definition|theorem|lemma|proposition|corollary)\b/i.test(heading[1])) continue;
        result.push({ ...block, label: title(heading[1]), kind: kind(heading[1]), score: 95 });
        continue;
      }
      const prefix = /^(?:[-*+]\s+|\d+[.)]\s+)?\*\*([\s\S]*?)\*\*\s*[:.]?\s*/.exec(text);
      let label = prefix ? plain(prefix[1]).replace(/[.:]$/, '') : '';
      if (stage.key && label.startsWith(stage.key)) label = label.slice(stage.key.length).replace(/^\s*[—–:.-]+\s*/, '');
      if (metadata.test(label || plain(text))) continue;
      if (/^(?:these checkpoints|the full .* bundle consists|the existing machine-stage names|original prerequisites)\b/i.test(plain(text))) continue;
      const structural = prefix && !/^(?:construct(?: and export)?|construction|acceptance|target|goal|output|scope)\b/i.test(label);
      const declarations = [];
      for (const fence of text.matchAll(/```(?:lean4?|)\s*\n([\s\S]*?)```/g)) {
        declarations.push(...fence[1].matchAll(/^\s*(?:(?:noncomputable|private|protected)\s+)*(def|abbrev|structure|class|theorem|lemma)\s+([\p{L}\p{N}_'.]+)/gmu));
      }
      for (const declaration of declarations) {
        result.push({ ...block, label: declaration[2], kind: /theorem|lemma/.test(declaration[1]) ? 'theorem' : 'definition', score: 110 });
      }
      if (structural) {
        result.push({ ...block, label: title(label), kind: kind(label), score: 90 });
        continue;
      }
      const body = prefix ? text.slice(prefix[0].length) : text.replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, '');
      const readable = plain(body);
      if (readable.length < 15 || /^\s*(?:```|~~~|\|)/.test(body)) continue;
      // Dense export lists name genuine separate topics. Keep each exact phrase and the
      // complete source paragraph rather than manufacturing a statement for the topic.
      if (prefix && /^construct(?: and export)?(?:ion)?$/i.test(label)) {
        const sentence = readable.replace(action, '').split(/\.\s+(?=[A-Z])/)[0];
        const parts = []; let depth = 0, at = 0;
        for (let i = 0; i < sentence.length; i++) {
          if ('([{'.includes(sentence[i])) depth++;
          else if (')]}'.includes(sentence[i])) depth = Math.max(0, depth - 1);
          else if (sentence[i] === ',' && depth === 0) { parts.push(sentence.slice(at, i).trim()); at = i + 1; }
        }
        parts.push(sentence.slice(at).trim());
        if (parts.length >= 3) {
          const last = parts.pop().replace(/^and\s+/, '');
          parts.push(...last.split(/\s+and\s+/));
          for (let i = 0; i < parts.length; i++) {
            const phrase = title(parts[i]);
            if (phrase.length < 7 || phrase.split(' ').length > 13) continue;
            result.push({ ...block, label: phrase, kind: 'construction', score: 72 + (/[A-Z]/.test(phrase) ? 10 : 0) + (i === 0 ? 5 : 0), shared: true, order: i });
          }
        }
      }
      // A named statement or an explicit "Define ..." target carries its source's kind.
      const statement = /^(?:Prove|Establish|State(?: and prove)?)\s+((?:Theorem|Lemma|Proposition|Corollary)\s+(?:[IVX]+\.)?\d+(?:\.\d+)*(?:\([^)]*\))?)/i.exec(readable);
      const defined = /^Define\s+([^.;]+)/i.exec(readable);
      let selected = statement ? statement[1] : defined ? defined[1] : readable.replace(action, '');
      selected = selected.split(/\.\s+(?=[A-Z])|;\s+/)[0];
      const sourceKind = statement ? 'theorem' : defined ? 'definition' : 'construction';
      result.push({ ...block, label: title(selected), kind: sourceKind, score: prefix ? (/^acceptance$/i.test(label) ? 40 : 70) : 55 });
    }
    return result;
  }

  function build(data) {
    const stages = Array.isArray(data && data.stages) ? data.stages : [];
    const roadmapSources = new Map((data && data.roadmaps || []).map(roadmap => [roadmap.id, String(roadmap.readme || '')]));
    const sourceLocators = new Map();
    function sourceLine(owner, excerpt) {
      if (!sourceLocators.has(owner)) {
        const text = roadmapSources.get(owner) || '', starts = [0];
        for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) starts.push(at + 1);
        sourceLocators.set(owner, { text, starts, excerpts: new Map() });
      }
      const source = sourceLocators.get(owner);
      if (source.excerpts.has(excerpt)) return source.excerpts.get(excerpt);
      const at = source.text.indexOf(excerpt);
      let line;
      if (at >= 0) {
        let low = 0, high = source.starts.length;
        while (low < high) {
          const middle = (low + high) >>> 1;
          if (source.starts[middle] <= at) low = middle + 1;
          else high = middle;
        }
        line = low;
      }
      source.excerpts.set(excerpt, line);
      return line;
    }
    const children = new Map();
    for (const stage of stages) {
      if (!stage.parentStageId) continue;
      if (!children.has(stage.parentStageId)) children.set(stage.parentStageId, []);
      children.get(stage.parentStageId).push(stage);
    }
    const output = [];
    for (const stage of stages) {
      const { original, ranges } = scope(stage, children.get(stage.id));
      const ranked = candidates(stage, original, ranges).map(candidate => {
        const label = mathematicalLabel(candidate);
        return label ? { ...candidate, label } : null;
      }).filter(Boolean).sort((a, b) => b.score - a.score || a.start - b.start || a.label.localeCompare(b.label));
      const chosen = [], labels = new Set();
      for (const candidate of ranked) {
        const key = candidate.label.toLowerCase();
        if (labels.has(key)) continue;
        // Multiple labels for the same paragraph would duplicate a target rather than expose a new one.
        if (chosen.some(other => candidate.start < other.end && other.start < candidate.end && !(candidate.shared && other.shared))) continue;
        labels.add(key); chosen.push(candidate);
        if (chosen.length === 4) break;
      }
      chosen.sort((a, b) => a.start - b.start || (a.order || 0) - (b.order || 0));
      for (const candidate of chosen) {
        const record = {
          id: identifier(stage, candidate.label),
          stageId: stage.id,
          roadmapId: stage.owner,
          title: candidate.label,
          kind: candidate.kind,
          description: candidate.text,
          sourcePath: stage.sourcePath || '',
          sourceExcerpt: candidate.text
        };
        // Legacy stage descriptions can quote a larger source context than sourceLine
        // identifies. Locate the literal excerpt in the owning README instead.
        const line = sourceLine(stage.owner, candidate.text);
        if (line !== undefined) record.sourceLine = line;
        // Where the passage lies in the layer's description, for scripts/derive.js; not part of the record.
        Object.defineProperty(record, 'start', { value: candidate.start });
        Object.defineProperty(record, 'end', { value: candidate.end });
        output.push(record);
      }
    }
    return output;
  }

  function identifier(stage, label) {
    const slug = label.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 42) || 'target';
    return stage.id + '::landmark:' + slug + '-' + hash(label);
  }

  // The landmarks `build` finds, from the rows scripts/derive.js made of them at build time: the page draws
  // them before it has the layers' descriptions, and without the READMEs. A row is [stage index, title, kind,
  // start, end, README line, shown title, excerpt, README lines of its citations]; the passage itself is read
  // from the layer's description once the page has it.
  function restore(data, rows) {
    return rows.map(([at, title, kind, start, end, line, shown, excerpt, cited]) => {
      const stage = data.stages[at];
      const passage = () => String(stage.description || '').slice(start, end);
      const record = {
        id: identifier(stage, title),
        stageId: stage.id,
        roadmapId: stage.owner,
        title,
        kind,
        get description() { return passage(); },
        sourcePath: stage.sourcePath || '',
        get sourceExcerpt() { return passage(); }
      };
      if (line !== null && line !== undefined) record.sourceLine = line;
      // The title and the excerpt the map shows (src/presentation.js, src/app.js), which were read from the passage.
      Object.defineProperty(record, 'shownTitle', { value: shown === null || shown === undefined ? title : shown });
      Object.defineProperty(record, 'excerpt', { value: excerpt });
      // For src/references.js.
      Object.defineProperty(record, 'referenceLines', { value: cited || [] });
      return record;
    });
  }

  function passages(stage, children) {
    const { original, ranges } = scope(stage, children);
    return blocks(original, ranges).map(block => block.text);
  }
  window.TauLandmarks = Object.freeze({ build, restore, passages });
})();
