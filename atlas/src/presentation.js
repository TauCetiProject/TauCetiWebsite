(function () {
  'use strict';

  // Presentation never changes source records, dependency IDs or progress totals.
  // Curated prose is kept separately; fallback passages are selected from the source.
  function create(data) {
    const stages = new Map(data.stages.map(stage => [stage.id, stage]));
    const overrides = data.stagePresentation || {};
    const children = new Map(), summaries = new Map();
    for (const stage of data.stages) {
      if (!stage.parentStageId) continue;
      if (!children.has(stage.parentStageId)) children.set(stage.parentStageId, []);
      children.get(stage.parentStageId).push(stage);
    }
    function stageTitle(id) {
      const stage = stages.get(id);
      return overrides[id]?.title || String(stage?.title || stage?.key || id)
        .replace(/^(?:layer|stage|lane|phase|step|milestone)\s+(?:(?:[A-Z]{1,3}(?:[ .-]?\d+)*|\d+(?:\.\d+)*[a-z]?)\s*)?[:,—–-]\s*/i, '')
        .replace(/^\p{Ll}/u, letter => letter.toUpperCase());
    }
    function isMathematicalStage(id) { return !overrides[id]?.hidden; }
    function stageSummary(id) {
      if (summaries.has(id)) return summaries.get(id);
      const stage = stages.get(id);
      const result = overrides[id]?.summary || (stage ? mathematicalPassages(TauLandmarks.passages(stage, children.get(id))).slice(0, 2).join('\n\n') : '');
      summaries.set(id, result);
      return result;
    }
    function landmarkTitle(item) {
      if (data.landmarkLabels?.[item.id]) return data.landmarkLabels[item.id];
      // A landmark restored from the build's rows carries the title worked out there (TauLandmarks.restore).
      if (item.shownTitle !== undefined) return item.shownTitle;
      return shortLandmarkTitle(item, stageTitle(item.stageId));
    }
    return Object.freeze({ stageTitle, stageSummary, isMathematicalStage, landmarkTitle });
  }

  // A chart annotation names a topic; its source excerpt carries the statement.
  // Never turn TeX into a label by deleting commands: that loses mathematical meaning.
  const symbolicLabel = /[\\$`{}_^]|[=≤≥≅≃↔→∈∑∫∀∃⊗]|\b\w+\.\w+\(/u;
  const titleActions = /^(?:(?:then |also |first )?(?:construct|develop|define|prove|establish|build|identify|compute|show|introduce|form|derive|recover|compare|extend|record|implement|integrate|use|reuse|import|supply|retain|give|obtain|fix|keep|follow|state|let|take|choose|pin)\s+)+/i;
  const topicPhrases = /(?:[\p{L}][\p{L}’'−–-]*\s+){0,2}(?:reciprocity laws?|class field theory|deformation rings?|modularity lifting|potential automorphy|compatible systems?|Euler systems?|Selmer (?:groups?|complexes?)|L-functions?|height pairings?|canonical heights?|trace formulas?|Hecke (?:operators?|algebras?|actions?)|period rings?|Hodge structures?|nearby cycles|vanishing cycles|cycle classes|Tate modules?|root data|root systems?|fundamental groups?|universal covers?|deck transformations?|moduli (?:spaces?|stacks?)|spectral sequences?|duality|descent|uniformization|compactness|orthogonality|semisimplicity|interpolation|localization|completion|cohomology|homology|regulators?|representations?|differentials?|determinants?|isocrystals|crystals|vector bundles?|line bundles?|tensor products?|symmetric powers?|exterior powers?|group schemes?|formal schemes?|elliptic curves?|modular curves?|Shimura varieties|abelian varieties|abelian schemes|Sobolev spaces|Hilbert spaces|Banach spaces|Dirichlet series|Fourier transforms?|Fourier multipliers?|Green functions?|Poisson kernels?|maximum principles?|Cauchy problems?|boundary conditions?|moment maps?|Hamiltonian flows?|Maslov index|Spinᶜ structures|Bott periodicity|mapping cones?|chain complexes?|derived categories|smooth categories|Galois groups?|Galois actions?|Frobenius actions?|Newton polygons?|ramification groups?|discriminants?|quadratic forms?|bilinear forms?|polynomial rings?|finite fields|local fields|number fields|unit groups?|ideal classes|class groups?|tame symbols?|Steinberg symbols?|motivic complexes|polylogarithms|Bloch groups?|Witt vectors?|divided powers|étale sites|crystalline sites|prismatic sites|perfectoid rings?|perfectoid spaces|Robba rings?|Schubert varieties|Schubert cells|affine Grassmannians|Harder–Narasimhan (?:filtrations?|polygons?)|Satake categories|Laplace transforms?|heat kernels?|heat semigroups?|transport plans?|Wasserstein distances?|convex functions?|Hermite polynomials?|Chebyshev polynomials?|orthogonal polynomials?|grid diagrams?|Heegaard diagrams?|knot invariants?|surgery triangles|cobordism maps?|Reidemeister moves|fundamental solutions?)/giu;
  function plainAnnotation(text) {
    return String(text || '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]*>/g, '').replace(/\*+/g, '').replace(/\s+/g, ' ').trim()
      .replace(/^(?:[-+]\s+|\d+[.)]\s+)/, '').replace(titleActions, '')
      .replace(/^(?:the |an? |actual |common |explicit |specified |relevant )+/i, '')
      .replace(/[.:;,\s]+$/, '');
  }
  function readableAnnotation(value) {
    return value.length >= 3 && value.length <= 58 && value.split(/\s+/).length <= 8
      && !symbolicLabel.test(value) && !/\b(?:API|Mathlib|roadmap|source|owner|prefix|supplier|theorem \d|stage \d)\b/i.test(value)
      && !/\b(?:acceptance|tests?|milestones?|deliverables?|exports?|noncomputable|implementation)\b/i.test(value)
      && !/^(?:for|when|if|with|without|using|this|these|those|such|it|do|not|no|only|every|all|both|there|once|after|before|since|whose|which|that|and|or|of|by|from|into|to|as|stronger|classifies|reduces|presented|identically|close out)\b/i.test(value)
      && (value.includes(' ') || /^(?:duality|descent|compactness|orthogonality|semisimplicity|interpolation|localization|completion|cohomology|homology|regulators?|representations?|isocrystals|crystals|polylogarithms|discriminants?|determinants?)$/i.test(value))
      && !/\b(?:and|or|with|of|to|from|the|a|an|on|over|under|by|in|into|as|its|their)$/i.test(value);
  }
  function nounAnnotation(text) {
    const value = plainAnnotation(text);
    if (readableAnnotation(value)) return value;
    if (!symbolicLabel.test(value)) {
      const phrase = value.split(/[,;:]|\s+(?:with|including|using|where|which|whose|such that|under|through|together with|needed|used|required|and prove|and compare|is |are |as the|as a)\b/i)[0].trim();
      if (readableAnnotation(phrase)) return phrase;
    }
    // Use an intact mathematical noun phrase, not pieces left behind by a formula.
    const phrases = [...value.matchAll(topicPhrases)]
      .filter(match => !/[\p{L}\p{N}_]/u.test(value[match.index - 1] || '') && !/[\p{L}\p{N}_]/u.test(value[match.index + match[0].length] || ''))
      .map(match => plainAnnotation(match[0]));
    return phrases.find(readableAnnotation) || '';
  }
  function shortLandmarkTitle(item, contextTitle) {
    // Readable source names stay unchanged. The special treatment is for formulas
    // and code, whose meaning belongs in the typeset reading pane.
    if (!symbolicLabel.test(item.title)) return item.title;
    const direct = nounAnnotation(item.title);
    if (direct) return direct.replace(/^\p{Ll}/u, letter => letter.toUpperCase());
    for (const match of String(item.description || '').matchAll(/\*\*([^*]+)\*\*/g)) {
      const phrase = nounAnnotation(match[1]);
      if (phrase) return phrase.replace(/^\p{Ll}/u, letter => letter.toUpperCase());
    }
    const contextual = nounAnnotation(contextTitle);
    if (contextual) return contextual.replace(/^\p{Ll}/u, letter => letter.toUpperCase());
    return item.kind === 'definition' ? 'Mathematical definition' : item.kind === 'theorem' ? 'Mathematical result' : 'Mathematical construction';
  }

  function mathematicalPassages(passages) {
    const metadata = /^(?:inputs?|dependenc(?:y|ies)|source(?: route|s| unit)?|execution state|implementation|acceptance|references?|prerequisites?|consumers?|status|original prerequisites|scope note)\b/i;
    const workflow = /\b(?:roadmaps?|audits?|readiness|checkpoints?|scratch checkout|source-to-Lean|Mathlib|sorry-free|proof tasks?|source[- ](?:route|decomposition|concordance)|owners?|ownership|suppliers?|reexports?|exports?|APIs?|interfaces?|registr(?:y|ies)|repository|source PR|named deliverable|pinned commit)\b/i;
    return passages.flatMap(passage => {
      let text = passage.trim();
      if (!text || /^#{1,6}\s|^<a\b|```|^\|/.test(text)) return [];
      const label = /^(?:[-*+]\s+|\d+[.)]\s+)?\*\*([^*]+)\*\*\s*[:.]?\s*/.exec(text);
      if (label && metadata.test(label[1])) return [];
      text = text.replace(/^(?:[-*+]\s+|\d+[.)]\s+)?\*\*(?:construct(?:ion)?(?: and export)?|target|goal|output)\s*[.:]?\*\*\s*[:.]?\s*/i, '');
      text = text.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(sentence => !workflow.test(sentence)).join(' ');
      if (text.length < 35) return [];
      return [text];
    });
  }

  // Planet excerpts retain hypotheses and equations while removing a workflow heading.
  function landmarkDescription(item) {
    return item.description.replace(/^(?:[-*+]\s+|\d+[.)]\s+)?\*\*(?:construct(?:ion)?(?: and export)?|acceptance(?: examples)?|target|goal|output)\s*[.:]?\*\*\s*[:.]?\s*/i, '')
      .replace(/\bMatch the existing Dirichlet-series carrier and normalization\.\s*/g, '');
  }
  // The opening of a passage as plain text, for a planet's caption on the map.
  function plainExcerpt(text){return String(text||'').replace(/\$\$?([^$]+)\$\$?/g,(m,tex)=>tex.replace(/\\[a-zA-Z]+\s*/g,w=>({'\\mathbb ':'','\\operatorname ':'','\\mathrm ':'','\\to ':'→ ','\\times ':'× ','\\cdot ':'· ','\\otimes ':'⊗ ','\\oplus ':'⊕ ','\\infty ':'∞ ','\\le ':'≤ ','\\ge ':'≥ ','\\ne ':'≠ '}[w]??w.replace(/^\\/,''))).replace(/[{}]/g,'')).replace(/[*_`>#]+/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/\s+/g,' ').trim().slice(0,220);}
  window.TauPresentation = Object.freeze({ create, landmarkDescription, plainExcerpt });
})();
