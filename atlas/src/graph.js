/* Tau Ceti universe renderer. One continuous scene drawn with level of detail:
   galaxies (areas) → constellations (roadmaps) → stars (layers) → planets
   (definitions, theorems, constructions). Only what the camera can see and
   resolve is in the DOM, so panning and zooming stay quick. Every mark is
   flat: solid fills, thin strokes, no gradients. Requires the bundled D3 v5. */
(function () {
  'use strict';
  let instanceCount = 0;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const BACKGROUND = '#0b1016', ACCENT = '#dfc186', NO_PROGRESS = '#6f7f8c', NOT_STARTED = '#6e747b', CREAM = '#e8e4da', DUST = '#8ea1b6';
  // Planets carry no progress. They are all round and flat, and what they
  // look like says what they are: a definition or construction is an Earth
  // (a blue disc with green land), and a result is a Saturn (a sand disc with
  // a tilted ring), drawn a little larger, most of all for a named theorem.
  // Their colours lie outside the red-to-white progress ramp.
  const OCEAN = '#6f9fcf', LAND = '#9cc59a', SAND = '#d9c391', RING = '#ece0bf';
  const DEFINITION_FILL = OCEAN, RESULT_FILL = SAND;
  const REFERENCE_CHART = { width: 1204, height: 782 };
  // The Mathlib disk (src/universe.js) is hidden at rest, so the map is the live one: the sun and the empty circle
  // round it. Hovering over the sun opens it to DISK_PEEK of its size; a click opens it fully, and a second closes it.
  const DISK_PEEK = .42, DISK_FILL = '#9fb3c8', DISK_TIMES = { peek: 250, open: 450, closed: 350 };
  // The disk's items are stars, as the landed pull requests are: a near-white core in a faint halo of its colour. A
  // definition burns blue-white and a theorem pale gold; a landmark is brighter than a header's item. None twinkles:
  // on the atlas a twinkling star is an open pull request.
  const DISK_STAR = { definition: { core: '#eef4ff', glow: '#7aa3ff' }, theorem: { core: '#fff4dc', glow: '#f0c46e' } };
  const isDefinitionKind = kind => kind === 'definition' || kind === 'construction' || !kind;
  const planetFill = d => isDefinitionKind(d.kind) ? OCEAN : SAND;
  const nameHash = text => Array.from(String(text)).reduce((seed, character) => ((seed * 31 + character.charCodeAt(0)) >>> 0), 7);
  // The area, in map units, each landed pull request's star takes in the cloud round its roadmap (cloudShape): the
  // 641 of Elliptic curves reach about four times its radius.
  const LANDED_AREA = 120;
  // A small seeded generator (mulberry32), so that a drawing comes out the same every time.
  const seededRandom = seed => () => {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // About normally distributed, from four uniform draws.
  const gaussian = random => (random() + random() + random() + random() - 2) * Math.sqrt(3);
  // The cloud a roadmap's landed pull requests make round it: a few soft lumps of stars spread round the roadmap, each
  // stretched and turned its own way, so that no cloud is a circle and no two share a shape. Its size shows their
  // number: outside the roadmap's disc it covers about LANDED_AREA map units a star.
  function cloudShape(node, count) {
    const random = seededRandom(nameHash(node.id + '#cloud'));
    const reach = Math.sqrt(node.r * node.r + LANDED_AREA * Math.max(count, 4) / Math.PI) - node.r * .92;
    const number = 3 + Math.floor(random() * 3), first = random() * Math.PI * 2;
    const lumps = Array.from({ length: number }, (_, index) => {
      const angle = first + (index + (random() - .5) * .8) * 2 * Math.PI / number, distance = node.r + reach * (.15 + random() * .5);
      return { x: Math.cos(angle) * distance, y: Math.sin(angle) * distance, weight: .4 + random(),
               spread: reach * (.28 + random() * .22), stretch: 1 + random() * 1.4, turn: random() * Math.PI };
    });
    return { lumps, total: lumps.reduce((sum, lump) => sum + lump.weight, 0) };
  }
  // One star of such a cloud, drawn with `random`; an open pull request is a star on its outskirts (`rim`). The
  // roadmap's disc hides what is behind it, so a star that would fall there is drawn again.
  function cloudStar(node, shape, random, rim) {
    for (let attempt = 0; ; attempt++) {
      let pick = random() * shape.total, lump = shape.lumps[shape.lumps.length - 1];
      for (const each of shape.lumps) if ((pick -= each.weight) <= 0) { lump = each; break; }
      let u = gaussian(random), v = gaussian(random);
      if (rim) { const length = Math.hypot(u, v) || 1, out = 1.5 + random() * .8; u = u / length * out; v = v / length * out; }
      const along = u * lump.spread * Math.sqrt(lump.stretch), across = v * lump.spread / Math.sqrt(lump.stretch);
      const x = node.x + lump.x + along * Math.cos(lump.turn) - across * Math.sin(lump.turn);
      const y = node.y + lump.y + along * Math.sin(lump.turn) + across * Math.cos(lump.turn);
      if (attempt >= 8 || Math.hypot(x - node.x, y - node.y) > node.r * 1.08) return [x, y];
    }
  }
  // Two continents on a unit disc, kept well inside its rim.
  const LAND_PATH = 'M-.55,-.35Q-.3,-.75 .05,-.55Q.3,-.4 .1,-.15Q-.1,.05 -.35,-.05Q-.7,0 -.55,-.35Z' +
    'M.2,.25Q.55,.1 .65,.35Q.6,.65 .3,.7Q.05,.6 .2,.25Z';
  const RING_TILT = -18;
  // The far half of a ring passes behind the planet and the near half in front.
  const ringArc = (r, near) => `M${-1.75 * r},0A${1.75 * r},${.42 * r} 0 0,${near ? 0 : 1} ${1.75 * r},0`;
  // A Lean name as a map label: verbatim, its last components, as many as say what it is (the panel has the whole).
  const leanLabel = name => {
    const parts = String(name).split('.');
    let label = parts.pop();
    while (parts.length && label.length < 14) label = parts.pop() + '.' + label;
    return label.length > 34 ? '…' + label.slice(-33) : label;
  };
  const normalizeText = value => String(value == null ? '' : value).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');

  function progressValue(value) {
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
  }
  // Colour means recorded progress and nothing else. Not started is grey;
  // once work is recorded an object is red, and it brightens through salmon
  // to white as its roadmap fills in. An object without recorded status has
  // no colour at all.
  function progressColor(value) {
    const progress = progressValue(value);
    if (progress === null) return null;
    if (progress === 0) return NOT_STARTED;
    // Once started, dark to bright is the whole encoding.
    const stops = [[143, 46, 38], [232, 150, 120], [247, 243, 233]];
    const index = progress <= 50 ? 0 : 1, fraction = progress <= 50 ? progress / 50 : (progress - 50) / 50;
    return '#' + stops[index].map((channel, i) => Math.round(channel + (stops[index + 1][i] - channel) * fraction).toString(16).padStart(2, '0')).join('');
  }
  const hasProgress = node => progressValue(node.progress) !== null;
  const accentOf = node => progressColor(node.progress) || NO_PROGRESS;
  function progressDescription(node) {
    if (typeof node.progressLabel === 'string' && node.progressLabel.trim()) return node.progressLabel.trim();
    const value = progressValue(node.progress);
    return value === null ? '' : Math.round(value) + '% of layers complete';
  }

  function wrapText(text, maxChars, maxLines) {
    const words = normalizeText(text).split(/\s+/).filter(Boolean), lines = [];
    let line = '';
    for (let word of words) {
      while (word.length > maxChars) { if (line) { lines.push(line); line = ''; } lines.push(word.slice(0, maxChars - 1) + '–'); word = word.slice(maxChars - 1); }
      if (line && line.length + word.length + 1 > maxChars) { lines.push(line); line = ''; }
      line += (line ? ' ' : '') + word;
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/[ .,;:–-]+$/, '') + '…'; }
    return lines.length ? lines : ['Untitled'];
  }

  class TauGraph {
    constructor(container, options) {
      if (!window.d3) throw new Error('The local graph library did not load. Keep the vendor folder beside the explorer.');
      if (typeof container === 'string') container = document.querySelector(container);
      if (!container) throw new Error('Graph container is missing.');
      this.container = container; this.options = options || {}; this.id = 'tau-graph-' + (++instanceCount);
      this.universe = null; this.selectedId = null; this.hoveredId = null; this.transform = d3.zoomIdentity; this.destroyed = false;
      this.isCoarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
      this.showReferences = false; this.lastFocus = null; this.renderScheduled = false; this.busy = false; this.widthCache = new Map();
      this.svg = d3.select(container).append('svg').attr('class', 'tau-graph').attr('xmlns', SVG_NS)
        .attr('width', '100%').attr('height', '100%').attr('role', 'group')
        .attr('aria-label', 'Interactive mathematics universe. Tab to an object and press Enter to open it.')
        .style('display', 'block').style('width', '100%').style('height', '100%').style('background', BACKGROUND).style('touch-action', 'none');
      this.svg.append('style').text(`
        .tau-graph text { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif; pointer-events: none; paint-order: stroke fill; stroke: ${BACKGROUND}; stroke-linejoin: round; }
        .tau-graph .tau-node { cursor: pointer; outline: none; }
        .tau-graph .tau-hit { fill: transparent; pointer-events: all; }
        .tau-graph .tau-core, .tau-graph .tau-galaxy-disc, .tau-graph .tau-dust, .tau-graph .tau-constellation-disc, .tau-graph .tau-figure, .tau-graph .tau-orbit, .tau-graph .tau-field, .tau-graph .tau-link, .tau-graph .tau-route, .tau-graph .tau-ring { pointer-events: none; }
        .tau-graph .tau-disk-base, .tau-graph .tau-disk-rule, .tau-graph .tau-disk-dust { pointer-events: none; }
        .tau-graph .tau-disk-dust path, .tau-graph .tau-disk-item path { fill: none; stroke-linecap: round; }
        .tau-graph .tau-disk-item .tau-disk-ring { fill: none; pointer-events: none; }
        .tau-graph .tau-core .tau-core-hit { fill: transparent; pointer-events: all; cursor: pointer; outline: none; }
        .tau-graph .tau-core .tau-core-hit:focus-visible { stroke: rgba(240, 228, 200, .5); }
        .tau-graph .tau-disk-item { cursor: pointer; outline: none; }
        .tau-graph .tau-disk-item .tau-disk-hit { stroke: transparent; pointer-events: stroke; }
        .tau-graph .tau-label-mathlib text { fill: #b9c5d0; font-weight: 500; stroke-width: 2.5px; }
        .tau-graph .tau-label-mathlib.is-landmark text { fill: #e1e7ec; }
        .tau-graph .tau-label-disksector text { fill: #93a4b5; font-weight: 600; letter-spacing: 1.1px; stroke-width: 3px; }
        .tau-graph .tau-label-emptysector text { fill: #6f7c8a; font-weight: 600; letter-spacing: 1.2px; stroke-width: 3px; }
        .tau-graph .tau-label-core text { fill: #efe3c8; font-weight: 600; letter-spacing: 2.5px; text-transform: uppercase; stroke-width: 3px; }
        .tau-label-galaxy text { fill: #b3bec9; font-weight: 500; letter-spacing: .2px; stroke-width: 2.5px; }
        .tau-label-field text, .tau-graph .tau-label-galaxy.is-field text { fill: #d3dae1; font-weight: 600; letter-spacing: 1.3px; stroke-width: 3px; }
        .tau-graph .tau-label-field.is-active text, .tau-graph .tau-label-galaxy.is-field.is-active text { fill: #f1f3f5; }
        .tau-graph .tau-label-galaxy.is-active text { fill: #e2e6eb; }
        .tau-graph .tau-label-constellation text { fill: #c9d2da; font-weight: 400; stroke-width: 2.5px; }
        .tau-graph .tau-label-star text { fill: #dbe1e7; font-weight: 500; stroke-width: 3px; }
        .tau-graph .tau-label-planet text { fill: #c9d2da; font-weight: 500; stroke-width: 2.5px; }
        .tau-graph .tau-label-artefact text { fill: #aeb8c2; font-weight: 500; font-style: italic; stroke-width: 2.5px; }
        .tau-graph .tau-label-card text { fill: #8fa0b0; font-weight: 400; stroke-width: 2.5px; }
        .tau-graph .tau-label-card text tspan:first-child { fill: #dfc186; font-size: 8px; letter-spacing: .3px; text-transform: uppercase; }
        .tau-graph .tau-label-moon text { fill: #9fabb8; font-weight: 400; stroke-width: 2px; }
        .tau-graph .tau-system-link { fill: none; stroke: #7d8a99; }
        .tau-graph .tau-moon { pointer-events: none; }
        .tau-graph .tau-label.is-active text { fill: #f0e4c8; }
        .tau-graph .tau-label-hit { fill: transparent; pointer-events: all; cursor: pointer; }
        .tau-graph .tau-figure { fill: none; stroke: #4f5f6d; }
        .tau-graph .tau-orbit { fill: none; stroke: #3a4652; }
        .tau-graph .tau-link { fill: none; stroke: ${ACCENT}; }
        .tau-graph .tau-link.is-reference { stroke: #8fa0b0; }
        .tau-graph .tau-link.is-selected { stroke: #f0e4c8; }
        .tau-graph .tau-link-hit { fill: none; stroke: transparent; pointer-events: stroke; cursor: pointer; outline: none; }
        .tau-graph .tau-link-hit:focus-visible { stroke: rgba(240, 228, 200, .18); }
        .tau-graph .tau-link-card-box { fill: #0f151c; stroke: #3a4652; }
        .tau-graph .tau-link-card text { fill: #dbe1e7; stroke: none; }
        .tau-graph .tau-link-card .tau-link-card-caption { fill: #dfc186; letter-spacing: .4px; text-transform: uppercase; }
        .tau-graph .tau-link-card [data-end] { cursor: pointer; }
        .tau-graph .tau-link-card [data-end] rect { fill: transparent; pointer-events: all; }
        .tau-graph .tau-link-card [data-end]:hover text { fill: #f0e4c8; text-decoration: underline; }
        .tau-graph .tau-route { fill: none; stroke: #6f8496; }
        .tau-graph .tau-live { cursor: pointer; }
        .tau-graph .tau-live circle { transform-box: fill-box; transform-origin: center; }
        .tau-graph .tau-live .tau-live-core { fill: #fff3c4; }
        .tau-graph .tau-landed path, .tau-graph .tau-dust-speck { fill: none; stroke-linecap: round; pointer-events: none; }
        .tau-graph .tau-landed-glow { stroke: #7aa3ff; stroke-opacity: .22; }
        .tau-graph .tau-landed-bright { stroke: #f6f9ff; stroke-opacity: .95; }
        .tau-graph .tau-landed-medium { stroke: #d6e2ff; stroke-opacity: .78; }
        .tau-graph .tau-landed-faint { stroke: #9fb8ec; stroke-opacity: .6; }
        .tau-graph .tau-live .tau-live-halo, .tau-graph .tau-live .tau-live-core { animation: tau-live-twinkle var(--twinkle, 7s) ease-in-out infinite; }
        .tau-graph .tau-live-new { animation: tau-live-appear 3s ease-out 1 both; }
        .tau-graph .tau-live.tau-live-merged circle { animation: tau-live-nova 8s ease-out 1 forwards; }
        .tau-graph .tau-live-closed { animation: tau-live-fade 4s ease-in 1 forwards; }
        @keyframes tau-live-twinkle {
          0% { opacity: .55; transform: scale(.86); } 9% { opacity: 1; transform: scale(1.08); } 14% { opacity: .64; transform: scale(.9); }
          23% { opacity: .92; transform: scale(1); } 35% { opacity: .46; transform: scale(.82); } 48% { opacity: .86; transform: scale(1.02); }
          57% { opacity: .6; transform: scale(.9); } 66% { opacity: 1; transform: scale(1.1); } 78% { opacity: .5; transform: scale(.85); }
          89% { opacity: .82; transform: scale(.97); } 100% { opacity: .55; transform: scale(.86); } }
        @keyframes tau-live-appear { from { opacity: 0; } to { opacity: 1; } }
        @keyframes tau-live-nova { 0% { opacity: .9; transform: scale(1); } 12% { opacity: 1; transform: scale(2.3); } 100% { opacity: 0; transform: scale(1.5); } }
        @keyframes tau-live-fade { to { opacity: 0; } }
        @media (prefers-reduced-motion: reduce) { .tau-graph .tau-live .tau-live-halo, .tau-graph .tau-live .tau-live-core { animation: none; opacity: .85; } }
      `);
      const defs = this.svg.append('defs');
      defs.append('marker').attr('id', this.id + '-arrow').attr('viewBox', '0 -4 9 8').attr('refX', 8).attr('refY', 0)
        .attr('markerWidth', 6).attr('markerHeight', 6).attr('orient', 'auto').attr('markerUnits', 'strokeWidth')
        .append('path').attr('d', 'M0,-3.5L8,0L0,3.5Z').attr('fill', ACCENT);
      defs.append('marker').attr('id', this.id + '-arrow-quiet').attr('viewBox', '0 -4 9 8').attr('refX', 8).attr('refY', 0)
        .attr('markerWidth', 7).attr('markerHeight', 7).attr('orient', 'auto').attr('markerUnits', 'strokeWidth')
        .append('path').attr('d', 'M0,-3.5L8,0L0,3.5Z').attr('fill', '#7d8a99');
      // The sun at the centre: limb darkening from a white-gold centre to an
      // orange rim, and a corona that fades into the dark.
      const sun = defs.append('radialGradient').attr('id', this.id + '-sun');
      [[0, '#fffbea'], [.45, '#ffe89c'], [.78, '#ffc34a'], [.93, '#f69b2d'], [1, '#e0701d']]
        .forEach(([offset, colour]) => sun.append('stop').attr('offset', offset).attr('stop-color', colour));
      const corona = defs.append('radialGradient').attr('id', this.id + '-corona');
      [[.46, '#ffd06e', .55], [.52, '#ffb54a', .3], [.7, '#ff9b3d', .09], [1, '#ff9b3d', 0]]
        .forEach(([offset, colour, opacity]) => corona.append('stop').attr('offset', offset).attr('stop-color', colour).attr('stop-opacity', opacity));
      // A star of the live galaxy, an open pull request: yellow-white light that reddens into its halo. Those that
      // have landed are blue-white (drawLanded).
      const liveStar = defs.append('radialGradient').attr('id', this.id + '-live-star');
      [[0, '#fffbe8', 1], [.14, '#ffe27a', .95], [.36, '#ffa13b', .62], [.66, '#ff5a2b', .24], [1, '#ff3a1e', 0]]
        .forEach(([offset, colour, opacity]) => liveStar.append('stop').attr('offset', offset).attr('stop-color', colour).attr('stop-opacity', opacity));
      this.viewport = this.svg.append('g').attr('class', 'tau-viewport');
      this.layers = {};
      ['field', 'disk', 'core', 'galaxy', 'landed', 'route', 'constellation', 'figure', 'link', 'star', 'planet', 'artefact', 'live', 'label'].forEach(name => { this.layers[name] = this.viewport.append('g').attr('class', 'tau-layer-' + name); });
      this.liveItems = []; this.landedCounts = new Map();
      // Drawn in screen space, above everything: the card of a selected link.
      this.overlay = this.svg.append('g').attr('class', 'tau-overlay');
      this.selectedLinkId = null; this.hoveredLinkId = null;
      // The universe spans thousands of times in scale, so a wheel or trackpad
      // step must move the camera a long way; a pinch keeps a gentler gain.
      this.zoom = d3.zoom().scaleExtent([.015, 900]).clickDistance(6)
        .wheelDelta(() => -d3.event.deltaY * (d3.event.deltaMode === 1 ? .05 : d3.event.deltaMode ? 1 : .002) * (d3.event.ctrlKey ? 1.6 : 3.2))
        .filter(() => !this.busy && !d3.event.button && (!d3.event.ctrlKey || d3.event.type === 'wheel'))
        .on('zoom', () => { this.transform = d3.event.transform; this.viewport.attr('transform', this.transform); this.scheduleRender(); this.scheduleFocus(); });
      this.svg.call(this.zoom).on('dblclick.zoom', null);
      this.svg.on('click.background', () => { if (d3.event.target === this.svg.node()) this.select(null, true); });
      // A pinch is a camera gesture: while two fingers are down, and briefly
      // after they lift, the click a browser may still synthesise is ignored.
      this.gestureTouches = 0; this.suppressClicksUntil = 0;
      const node = this.svg.node();
      const gestureEnded = event => { if (event.touches && event.touches.length) return; if (this.gestureTouches >= 2) this.suppressClicksUntil = Date.now() + 700; this.gestureTouches = 0; };
      node.addEventListener('touchstart', event => { this.gestureTouches = Math.max(this.gestureTouches, event.touches.length); if (event.touches.length >= 2) this.suppressClicksUntil = Infinity; }, { passive: true, capture: true });
      node.addEventListener('touchend', gestureEnded, { passive: true, capture: true });
      node.addEventListener('touchcancel', gestureEnded, { passive: true, capture: true });
      // Something the camera carries under a resting pointer is not being
      // pointed at: after a travel, hovering waits until the pointer moves.
      // Pointer events report fractional pixels and mouse events whole ones.
      this.pointer = null; this.pointerAtTravel = null;
      node.addEventListener('pointermove', event => {
        this.pointer = [event.clientX, event.clientY];
        if (!this.pointerResting(event)) this.pointerAtTravel = null;
      }, { passive: true });
      this.width = 800; this.height = 600;
      this.resize = () => {
        if (this.destroyed) return;
        const box = this.container.getBoundingClientRect();
        const previousWidth = this.width, previousHeight = this.height;
        this.width = Math.max(160, box.width || 800); this.height = Math.max(160, box.height || 600);
        this.svg.attr('viewBox', '0 0 ' + this.width + ' ' + this.height);
        this.zoom.extent([[0, 0], [this.width, this.height]]);
        if (this.awaitingFit && box.width > 0 && box.height > 0) { this.awaitingFit = false; this.fitAll(false); return; }
        const aspectBefore = previousWidth / previousHeight, aspectAfter = this.width / this.height;
        if (this.universe && Math.abs(aspectAfter / aspectBefore - 1) > .25 && this.options.onAspectChange) this.options.onAspectChange({ width: previousWidth, height: previousHeight });
        else this.scheduleRender();
      };
      this.resize();
      if (window.ResizeObserver) { this.observer = new ResizeObserver(this.resize); this.observer.observe(container); }
      else window.addEventListener('resize', this.resize);
    }

    // ----- data -----------------------------------------------------------
    setUniverse(universe, settings) {
      settings = settings || {};
      this.universe = universe; this.busy = false;
      this.selectedId = universe.byId.has(settings.selectedId) ? settings.selectedId : null;
      this.showReferences = !!settings.showReferences;
      this.layers.field.selectAll('*').remove(); this.layers.core.selectAll('*').remove(); this.layers.galaxy.selectAll('*').remove(); this.layers.route.selectAll('*').remove();
      this.layers.constellation.selectAll('*').remove(); this.layers.figure.selectAll('*').remove(); this.layers.link.selectAll('*').remove();
      this.layers.star.selectAll('*').remove(); this.layers.planet.selectAll('*').remove(); this.layers.artefact.selectAll('*').remove(); this.layers.label.selectAll('*').remove();
      this.drawField(); this.drawDisk(); this.drawCore(); this.drawGalaxies(); this.drawLanded();
      if (settings.camera) this.restoreCamera(settings.camera);
      else if (settings.keepCamera && this.transform !== d3.zoomIdentity) this.scheduleRender();
      else { this.awaitingFit = true; this.resize(); }
      this.drawLive();
      this.scheduleRender();
      return this;
    }

    // ----- the live galaxy ----------------------------------------------------
    // Open pull requests (src/live.js) twinkle slowly beside their roadmaps, each at a spot of its
    // own; a merged one flares and fades, a closed one fades. They keep their size on screen.
    setLive(items) { this.liveItems = items || []; this.drawLive(); return this; }

    // An umbrella roadmap with no layers of its own (Tau Ceti's Representation theory) has its label on pull
    // requests for any of its sub-roadmaps, and the label does not say which: its pull requests are shown beside
    // its sub-roadmaps, rather than round an empty disc. Umbrella id -> its sub-roadmaps that have layers.
    umbrellaChildren() {
      const children = new Map();
      (this.universe.constellations || []).forEach(c => {
        if (c.parentRoadmapId && (c.starIds || []).length) (children.get(c.parentRoadmapId) || children.set(c.parentRoadmapId, []).get(c.parentRoadmapId)).push(c);
      });
      return children;
    }

    drawLive() {
      if (!this.universe || this.destroyed) return;
      const byId = this.universe.byId, placed = [], children = this.umbrellaChildren();
      // An umbrella's pull request twinkles beside one of its sub-roadmaps, picked by its number.
      this.liveItems.forEach(item => {
        let node = byId.get(item.roadmapId), umbrella = null;
        if (node && !(node.starIds || []).length && children.has(node.id)) {
          const kids = children.get(node.id);
          umbrella = node; node = kids[nameHash(String(item.number)) % kids.length];
        }
        if (!node || !Number.isFinite(node.x)) return;
        // On the outskirts of the roadmap's cloud of landed pull requests (drawLanded).
        const h = nameHash(item.key), [x, y] = cloudStar(node, cloudShape(node, (this.landedOwners || new Map()).get(node.id) || 0), seededRandom(h), true);
        const period = 5 + ((h >>> 8) % 4000) / 1000;
        placed.push(Object.assign({}, item, { x, y,
                                               period, phase: -((h >>> 4) % 9000) / 1000,
                                               umbrella: umbrella ? normalizeText(umbrella.label) : null }));
      });
      const join = this.layers.live.selectAll('g.tau-live').data(placed, d => d.key);
      join.exit().remove();
      const enter = join.enter().append('g');
      enter.append('circle').attr('class', 'tau-live-halo').attr('r', 5.5).attr('fill', `url(#${this.id}-live-star)`);
      enter.append('circle').attr('class', 'tau-live-core').attr('r', 1.15);
      enter.append('title');
      enter.on('click', d => { d3.event.stopPropagation(); window.open(d.url, '_blank', 'noopener'); });
      const all = enter.merge(join)
        .attr('class', d => 'tau-live' + (d.state === 'merged' ? ' tau-live-merged' : d.state === 'closed' ? ' tau-live-closed' : d.fresh ? ' tau-live-new' : ''));
      // Each star flickers at its own slow rhythm and phase, like starlight; a merged one brightens at once and fades.
      all.selectAll('circle').style('--twinkle', function () { return this.parentNode.__data__.period + 's'; })
        .style('animation-delay', function () {
          const d = this.parentNode.__data__;
          return d.state === 'open' ? d.phase + 's' : null;
        });
      all.select('title').text(d => `#${d.number} ${d.title}\n${d.state === 'merged' ? 'Merged just now' : d.state === 'closed' ? 'Closed' : 'Open pull request'}` +
        `${d.user ? ' by ' + d.user : ''}` + (d.umbrella ? `\nLabelled for ${d.umbrella} as a whole, so shown beside one of its sub-roadmaps` : '') +
        '\nClick to open it on GitHub');
      this.positionLive();
    }

    positionLive() {
      // An open pull request grows a little closer in, as the landed ones round it do (render).
      const k = this.transform.k, grow = Math.max(1, Math.min(3, Math.sqrt(k / .5)));
      this.layers.live.selectAll('g.tau-live').attr('transform', d => `translate(${d.x},${d.y}) scale(${grow / k})`);
    }

    // ----- landed pull requests ------------------------------------------------
    // Every pull request that has landed for a Tau Ceti roadmap (the Progress page's count) is a small blue-white
    // star in a cloud round it (cloudShape), as an open one twinkles on its outskirts in red and yellow, so the cloud
    // grows with the work merged for it. The stars keep their size on screen from afar and grow closer in (render),
    // and a roadmap's are four paths, a glow and three brightnesses, however many there are. An umbrella's stars are
    // shared among its sub-roadmaps.
    setLanded(counts) { this.landedCounts = counts instanceof Map ? counts : new Map(Object.entries(counts || {})); this.drawLanded(); return this; }

    drawLanded() {
      const layer = this.layers.landed;
      layer.selectAll('*').remove();
      if (!this.universe || this.destroyed || !this.landedCounts.size) return;
      const byId = this.universe.byId, children = this.umbrellaChildren(), owners = new Map();
      this.landedCounts.forEach((count, id) => {
        const node = byId.get(id), kids = node && !(node.starIds || []).length ? children.get(node.id) : null;
        if (!node || !(count > 0)) return;
        if (kids && kids.length) kids.forEach((kid, index) => owners.set(kid, (owners.get(kid) || 0) + Math.floor(count / kids.length) + (index < count % kids.length ? 1 : 0)));
        else if (Number.isFinite(node.x)) owners.set(node, (owners.get(node) || 0) + count);
      });
      this.landedOwners = new Map([...owners].map(([node, count]) => [node.id, count]));
      const data = [];
      owners.forEach((count, node) => {
        // A few bright stars, more of middling brightness and many faint ones.
        const shape = cloudShape(node, count), random = seededRandom(nameHash(node.id + '#stars')), paths = { bright: '', medium: '', faint: '' };
        for (let index = 0; index < count; index++) {
          const [x, y] = cloudStar(node, shape, random, false), shine = random();
          paths[shine < .1 ? 'bright' : shine < .55 ? 'medium' : 'faint'] += `M${x.toFixed(1)},${y.toFixed(1)}h0`;
        }
        data.push({ id: node.id, count, paths });
      });
      const groups = layer.selectAll('g.tau-landed').data(data, d => d.id).enter().append('g').attr('class', 'tau-landed')
        .attr('data-node-id', d => d.id).attr('data-count', d => d.count);
      const grow = this.landedGrow || 1;
      groups.append('path').attr('class', 'tau-landed-glow').attr('d', d => d.paths.bright).attr('vector-effect', 'non-scaling-stroke')
        .attr('data-width', 4.2).attr('stroke-width', 4.2 * grow);
      [['bright', 1.8], ['medium', 1.2], ['faint', .8]].forEach(([shine, width]) => groups.append('path').attr('class', 'tau-landed-star tau-landed-' + shine)
        .attr('d', d => d.paths[shine]).attr('vector-effect', 'non-scaling-stroke').attr('data-width', width).attr('stroke-width', width * grow));
    }

    setProgress(values) {
      if (!this.universe) return this;
      const progress = values instanceof Map ? values : new Map(Object.entries(values || {}));
      progress.forEach((value, id) => {
        const node = this.universe.byId.get(id);
        if (!node) return;
        if (value && typeof value === 'object') { node.progress = value.progress; node.progressLabel = value.progressLabel; if ('unlocked' in value) node.unlocked = value.unlocked; } else node.progress = value;
      });
      this.layers.constellation.selectAll('*').remove(); this.layers.star.selectAll('*').remove(); this.layers.artefact.selectAll('*').remove();
      this.paintDust();
      this.scheduleRender();
      return this;
    }

    setReferences(show) { this.showReferences = !!show; this.scheduleRender(); return this; }

    // ----- static scenery ---------------------------------------------------
    drawField() {
      const bounds = this.universe.bounds, field = this.layers.field;
      const stars = Array.from({ length: 64 }, (_, index) => ({
        x: bounds.x + (((index * 619 + 89) % 2017) / 2017) * bounds.w, y: bounds.y + (((index * 383 + 53) % 1877) / 1877) * bounds.h,
        r: index % 23 === 0 ? 1.4 : index % 7 === 0 ? .9 : .5, opacity: index % 11 === 0 ? .4 : index % 3 === 0 ? .22 : .12 }));
      field.selectAll('circle').data(stars).enter().append('circle').attr('class', 'tau-field').attr('cx', d => d.x).attr('cy', d => d.y).attr('r', d => d.r).attr('fill', '#c7d3df').attr('opacity', d => d.opacity);
      // The sector map's guides: rings at whole distances from Mathlib, named at the top, and rules between sectors.
      const guides = this.universe.guides;
      if (!guides) return;
      field.selectAll('circle.tau-distance-ring').data(guides.rings).enter().append('circle').attr('class', 'tau-distance-ring').attr('cx', 0).attr('cy', 0)
        .attr('r', d => d.radius).attr('fill', 'none').attr('stroke', ACCENT).attr('vector-effect', 'non-scaling-stroke').attr('stroke-width', 1)
        .attr('stroke-opacity', d => d.distance % 2 ? .05 : .1);
      field.selectAll('line.tau-sector-rule').data(guides.rules).enter().append('line').attr('class', 'tau-sector-rule')
        .attr('x1', d => Math.cos(d.angle) * guides.inner).attr('y1', d => Math.sin(d.angle) * guides.inner)
        .attr('x2', d => Math.cos(d.angle) * guides.outer).attr('y2', d => Math.sin(d.angle) * guides.outer)
        .attr('stroke', ACCENT).attr('vector-effect', 'non-scaling-stroke').attr('stroke-width', 1).attr('stroke-opacity', d => d.major ? .16 : .06);
      // The rings are named along the rule between categories nearest the top, where no roadmap lies.
      const offTop = angle => Math.abs(Math.atan2(Math.sin(angle + Math.PI / 2), Math.cos(angle + Math.PI / 2)));
      const along = guides.rules.filter(rule => rule.major).reduce((best, rule) => offTop(rule.angle) < offTop(best.angle) ? rule : best, { angle: -Math.PI / 2 }).angle;
      field.selectAll('text.tau-ring-label').data(guides.rings.filter(ring => ring.distance % 2 === 0)).enter().append('text').attr('class', 'tau-ring-label')
        .attr('x', d => Math.cos(along) * d.radius).attr('y', d => Math.sin(along) * d.radius).attr('dx', '.4em').attr('dy', '-.35em')
        .attr('fill', '#8a97a5').attr('opacity', .75).text(d => 'zone ' + d.distance);
    }

    // Mathlib at the centre as the sun: a disc that darkens towards its rim,
    // a faint corona, light granulation and two small spots. It is the one
    // object in the atlas drawn with gradients.
    drawCore() {
      const core = this.universe.core, layer = this.layers.core;
      if (!core) return;
      const r = core.r, g = layer.append('g').attr('class', 'tau-core').attr('data-node-id', core.id).attr('transform', `translate(${core.x},${core.y})`);
      g.append('circle').attr('class', 'tau-core-corona').attr('r', r * 2.1).attr('fill', `url(#${this.id}-corona)`);
      g.append('circle').attr('class', 'tau-core-disc').attr('r', r).attr('fill', `url(#${this.id}-sun)`);
      // Granulation: faint bright cells, placed the same way every time.
      let seed = 20260921;
      const next = () => (seed = seed * 16807 % 2147483647) / 2147483647;
      for (let i = 0; i < 90; i++) {
        const angle = next() * 2 * Math.PI, reach = Math.sqrt(next()) * r * .9;
        g.append('circle').attr('class', 'tau-core-granule').attr('cx', (Math.cos(angle) * reach).toFixed(2)).attr('cy', (Math.sin(angle) * reach).toFixed(2))
          .attr('r', (r * (.025 + .035 * next())).toFixed(2)).attr('fill', '#fff4cc').attr('opacity', (.08 + .1 * next()).toFixed(3));
      }
      [[-.36, .22, .075], [.3, -.32, .05]].forEach(([x, y, size]) => {
        g.append('circle').attr('class', 'tau-core-spot').attr('cx', x * r).attr('cy', y * r).attr('r', size * r * 1.8).attr('fill', '#b8621f').attr('opacity', .35);
        g.append('circle').attr('class', 'tau-core-spot').attr('cx', x * r).attr('cy', y * r).attr('r', size * r).attr('fill', '#7a3510').attr('opacity', .6);
      });
      g.append('title').text('Mathlib: the formalised baseline. Subjects and roadmaps lie farther out the more theory must be built before their targets can be stated and proved.');
      if (!this.universe.disk) return;
      // The sun opens the Mathlib disk: a hover a little, a click fully, a second click closes it (setDisk).
      const graph = this;
      g.append('circle').attr('class', 'tau-core-hit').attr('r', r * 2.1).attr('tabindex', 0).attr('role', 'button')
        .on('mouseenter', () => { if (!graph.isCoarse && graph.diskState === 'closed') graph.setDisk('peek'); })
        .on('mouseleave', () => { if (graph.diskState === 'peek') graph.setDisk('closed'); })
        .on('click', () => { d3.event.stopPropagation(); if (Date.now() < graph.suppressClicksUntil) return; graph.toggleDisk(); })
        .on('keydown', () => { if (d3.event.key !== 'Enter' && d3.event.key !== ' ') return; d3.event.preventDefault(); d3.event.stopPropagation(); graph.toggleDisk(); })
        .append('title').text('Mathlib: click to open its key definitions and theorems, each as far from the centre as the Mathlib needed to state and prove it. Click again to close.');
      this.labelCore();
    }

    labelCore() {
      const open = this.diskState === 'open';
      this.layers.core.select('.tau-core-hit').attr('aria-expanded', String(open)).attr('aria-label', open ? 'Close the Mathlib disk' : 'Open the Mathlib disk');
    }

    // ----- the Mathlib disk -------------------------------------------------------
    // Hidden at rest, so the map is the live one. Flat like every mark but the sun: a faint fill, faint rules between
    // its areas, and the rest of Mathlib as dust. Its items are drawn by render, as the camera reaches them.
    drawDisk() {
      const layer = this.layers.disk, disk = this.universe.disk;
      layer.selectAll('*').remove();
      this.diskGroup = null;
      if (!disk) return;
      this.diskState = this.diskState || 'closed';
      const scale = this.diskState === 'open' ? 1 : this.diskState === 'peek' ? DISK_PEEK : 0;
      const g = layer.append('g').attr('class', 'tau-disk').attr('data-state', this.diskState).attr('transform', `scale(${scale})`)
        .attr('opacity', this.diskState === 'peek' ? .75 : 1).attr('display', scale ? null : 'none');
      g.append('circle').attr('class', 'tau-disk-base').attr('r', disk.outer).attr('fill', DISK_FILL).attr('fill-opacity', .045);
      // A rule between neighbouring areas, stronger between categories than between the areas of one.
      const order = disk.sectors.slice().sort((a, b) => a.a0 - b.a0);
      const rules = order.map((s, index) => {
        const before = order[(index + order.length - 1) % order.length], end = index ? before.a1 : before.a1 - Math.PI * 2;
        return { angle: (end + s.a0) / 2, major: !s.code || s.code !== before.code };
      });
      g.selectAll('line.tau-disk-rule').data(rules).enter().append('line').attr('class', 'tau-disk-rule')
        .attr('x1', d => Math.cos(d.angle) * disk.inner).attr('y1', d => Math.sin(d.angle) * disk.inner)
        .attr('x2', d => Math.cos(d.angle) * disk.outer).attr('y2', d => Math.sin(d.angle) * disk.outer)
        .attr('stroke', ACCENT).attr('vector-effect', 'non-scaling-stroke').attr('stroke-width', 1).attr('stroke-opacity', d => d.major ? .14 : .06);
      const dust = g.append('g').attr('class', 'tau-disk-dust');
      [[0, 1, .32], [1, 1.4, .45], [2, 1.9, .62]].forEach(([cls, width, opacity]) => dust.append('path')
        .attr('d', this.speckPath(disk.dust.filter(p => p.cls === cls))).attr('stroke', DUST).attr('stroke-opacity', opacity)
        .attr('vector-effect', 'non-scaling-stroke').attr('stroke-width', width));
      g.append('g').attr('class', 'tau-disk-items');
      this.diskGroup = g;
    }

    // Open ('open'), open a little ('peek') or close ('closed') the disk, growing it out of the sun and back.
    setDisk(state, animate = true) {
      const disk = this.universe && this.universe.disk, g = this.diskGroup;
      if (!disk || !g || !['closed', 'peek', 'open'].includes(state)) return this;
      this.diskState = state;
      const scale = state === 'open' ? 1 : state === 'peek' ? DISK_PEEK : 0;
      const still = !animate || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      // An animation ends exactly at its scale (d3 leaves its interpolation's rounding behind).
      const finish = () => { this.diskAnimating = false; g.attr('transform', `scale(${scale})`); if (this.diskState === 'closed') g.attr('display', 'none'); this.scheduleRender(); };
      g.interrupt().attr('data-state', state);
      if (scale) g.attr('display', null);
      this.diskAnimating = !still;
      if (still) { g.attr('transform', `scale(${scale})`).attr('opacity', state === 'peek' ? .75 : 1); finish(); }
      else g.transition().duration(DISK_TIMES[state]).ease(d3.easeCubicOut).attr('transform', `scale(${scale})`).attr('opacity', state === 'peek' ? .75 : 1)
        .on('end', finish).on('interrupt', () => { this.diskAnimating = false; });
      // The rules between the map's sectors start at the disk's rim while it is open.
      const guides = this.universe.guides;
      if (guides) {
        const inner = state === 'open' ? Math.max(guides.inner, disk.outer) : guides.inner;
        const rules = this.layers.field.selectAll('line.tau-sector-rule');
        (still ? rules : rules.transition().duration(DISK_TIMES[state])).attr('x1', d => Math.cos(d.angle) * inner).attr('y1', d => Math.sin(d.angle) * inner);
      }
      this.labelCore();
      this.svg.classed('tau-disk-open', state === 'open');
      this.scheduleRender();
      return this;
    }

    // A click on the sun: open the disk and frame it, or close it and return to the opening view.
    toggleDisk() {
      if (this.diskState === 'open') {
        // A Mathlib item's panel closes with the disk: the item is no longer on the map.
        const selected = this.selectedId && this.universe.byId.get(this.selectedId);
        if (selected && selected.level === 'mathlib') this.select(null, true);
        this.setDisk('closed'); this.fitAll(true);
      }
      else { this.setDisk('open'); this.zoomToDisk(true); }
      return this;
    }

    diskTransform() {
      const disk = this.universe.disk, core = this.universe.core, reserve = this.width < 600 ? 56 : this.height < 400 ? 24 : 0;
      const k = Math.max(.015, Math.min(this.width, this.height - reserve) / (2 * disk.outer * 1.06));
      return d3.zoomIdentity.translate(this.width / 2 - core.x * k, (this.height - reserve) / 2 - core.y * k).scale(k);
    }

    // After the chart changes shape (a panel opening beside it), the point at its centre stays there, at the same scale.
    keepCentreFrom(before) {
      const t = this.transform, cx = (before.width / 2 - t.x) / t.k, cy = (before.height / 2 - t.y) / t.k;
      this.svg.call(this.zoom.transform, d3.zoomIdentity.translate(this.width / 2 - cx * t.k, this.height / 2 - cy * t.k).scale(t.k));
      return this;
    }

    zoomToDisk(animate) { return this.universe && this.universe.disk ? this.travel(this.diskTransform(), animate !== false) : this; }

    // The disk's items the camera can see, and their names: the landmarks once the disk is open, the header items
    // once it overfills the chart; the most important named first, as the label system finds them room.
    collectDisk(k, rect, labels, active, T) {
      const disk = this.universe.disk;
      if (!disk || !this.diskGroup || !this.diskState || this.diskState === 'closed') return [];
      const open = this.diskState === 'open', scale = open ? 1 : DISK_PEEK;
      const fine = open && disk.outer * k >= Math.min(this.width, this.height) * 1.05;
      const inView = d => d.x * scale + 12 / k > rect.x && d.x * scale - 12 / k < rect.x + rect.w && d.y * scale + 12 / k > rect.y && d.y * scale - 12 / k < rect.y + rect.h;
      const items = disk.items.filter(d => (d.tier === 1 || fine || d.id === active) && inView(d));
      if (!open || this.diskAnimating) return items;
      const chart = this.visibleRect(0), centred = (x, y) => x >= chart.x && x <= chart.x + chart.w && y >= chart.y && y <= chart.y + chart.h;
      disk.sectors.forEach(s => {
        // A slice Mathlib has nothing in is not named on the disk.
        if (!s.items) return;
        const middle = (s.a0 + s.a1) / 2;
        if ((s.a1 - s.a0) * disk.outer * .9 * k < (T.small ? 30 : 48)) return;
        const spots = [.95, .88, .8, .7, .6].map(f => ({ x: Math.cos(middle) * disk.outer * f, y: Math.sin(middle) * disk.outer * f + 3.5 / k, above: false, anchor: 'middle' }))
          .filter(spot => centred(spot.x, spot.y));
        if (!spots.length) return;
        // A category is named with its arXiv identifier (math.RA), as on the map; a finer area of one by its name.
        const named = [(s.short || s.label).toUpperCase(), ...(s.sectorId === s.code ? [s.code] : [])];
        labels.push({ id: 'disksector:' + s.id, nodeId: s.id, kind: 'disksector', x: spots[0].x, y: spots[0].y, lines: named,
          font: T.small ? 9 : 10, anchor: 'middle', above: false, priority: 95 + Math.min(20, s.items / 50), active: false, alternatives: spots.slice(1) });
      });
      const chosen = d => d.id === this.selectedId ? 2 : d.id === active ? 1 : 0;
      items.filter(d => centred(d.x, d.y)).sort((a, b) => chosen(b) - chosen(a) || a.tier - b.tier || b.importance - a.importance).slice(0, 180).forEach(d => {
        const font = d.tier === 1 ? 10.5 : 9.5, gap = 5 / k;
        labels.push({ id: 'mathlib:' + d.id, nodeId: d.id, kind: 'mathlib', landmark: d.tier === 1, x: d.x + gap, y: d.y + 3.5 / k, lines: d.tier === 1 ? wrapText(d.title, 28, 2) : [leanLabel(d.name)], font,
          anchor: 'start', above: false, priority: (d.tier === 1 ? 30 : 10) + Math.min(9, d.importance) + 150 * chosen(d), active: active === d.id, chosen: chosen(d) > 0,
          alternatives: [{ x: d.x - gap, y: d.y + 3.5 / k, above: false, anchor: 'end' }, { x: d.x, y: d.y + 14 / k, above: false, anchor: 'middle' },
            { x: d.x, y: d.y - 6 / k, above: true, anchor: 'middle' }] });
      });
      return items;
    }

    // Each item a star that keeps its size on screen, growing a little as the camera closes in (DISK_STAR): a landmark
    // brighter the more important it is, a header's item faint. A wide clear stroke round it takes a finger's tap.
    renderDiskItems(items, k, active) {
      const layer = this.diskGroup ? this.diskGroup.select('g.tau-disk-items') : null;
      if (!layer) return;
      const join = layer.selectAll('g.tau-disk-item').data(items, d => d.id);
      join.exit().remove();
      const enter = join.enter().append('g').attr('class', 'tau-disk-item tau-node').attr('data-node-id', d => d.id).attr('data-level', 'mathlib')
        .attr('tabindex', 0).attr('role', 'button').attr('aria-label', d => normalizeText(d.title) + (d.theorem ? '. Mathlib theorem' : '. Mathlib definition'));
      ['tau-disk-hit', 'tau-disk-halo', 'tau-disk-glow', 'tau-disk-core'].forEach(name => enter.append('path').attr('class', name).attr('vector-effect', 'non-scaling-stroke')
        .attr('d', d => `M${d.x.toFixed(2)},${d.y.toFixed(2)}h0`));
      enter.append('circle').attr('class', 'tau-disk-ring').attr('cx', d => d.x).attr('cy', d => d.y).attr('stroke', ACCENT).attr('vector-effect', 'non-scaling-stroke').attr('stroke-width', 1.5);
      enter.select('.tau-disk-hit').attr('stroke-width', 14);
      enter.selectAll('.tau-disk-halo, .tau-disk-glow').attr('stroke', d => DISK_STAR[d.theorem ? 'theorem' : 'definition'].glow);
      enter.select('.tau-disk-core').attr('stroke', d => DISK_STAR[d.theorem ? 'theorem' : 'definition'].core);
      this.bindInteractions(enter);
      const grow = this.universe.disk ? Math.max(1, Math.min(2.2, Math.sqrt(k / this.diskTransform().k))) : 1;
      // A glow that fades: a brighter ring close round the core and a very faint one beyond, as flat strokes.
      const core = d => (d.tier === 1 ? 2 + .1 * Math.max(0, Math.min(7, d.importance)) : 1.3) * grow * (d.id === active ? 1.25 : 1);
      const all = enter.merge(join);
      all.select('.tau-disk-core').attr('stroke-width', core).attr('stroke-opacity', d => d.tier === 1 ? 1 : .8);
      all.select('.tau-disk-glow').attr('stroke-width', d => core(d) * 2).attr('stroke-opacity', d => d.tier === 1 ? .3 : .18);
      all.select('.tau-disk-halo').attr('stroke-width', d => core(d) * 3.4).attr('stroke-opacity', d => d.tier === 1 ? .09 : 0);
      all.select('.tau-disk-ring').attr('r', d => (core(d) * 1.6 + 3) / k).attr('opacity', d => d.id === active || d.id === this.selectedId ? 1 : 0);
    }

    dustPath(points, radius) {
      return points.map(p => `M${(p.x + radius).toFixed(1)},${p.y.toFixed(1)}a${radius},${radius} 0 1,0 ${-2 * radius},0a${radius},${radius} 0 1,0 ${2 * radius},0`).join('');
    }

    // Specks that keep their size on screen: each a round cap on a stroke of no length.
    speckPath(points) {
      return points.map(p => `M${p.x.toFixed(1)},${p.y.toFixed(1)}h0`).join('');
    }

    drawGalaxies() {
      const galaxies = this.layers.galaxy.selectAll('g.tau-galaxy').data(this.universe.galaxies, d => d.id).enter().append('g')
        .attr('class', 'tau-galaxy').attr('data-node-id', d => d.id);
      galaxies.filter(d => !d.outline).append('ellipse').attr('class', 'tau-galaxy-disc').attr('cx', d => d.x).attr('cy', d => d.y).attr('rx', d => d.rx).attr('ry', d => d.ry)
        .attr('fill', '#9db3c9').attr('opacity', .014);
      // A sector is tinted faintly over its wedge, so that the sectors read as contiguous regions round Mathlib.
      galaxies.filter(d => d.outline).append('path').attr('class', 'tau-galaxy-disc').attr('d', d => d.outline).attr('fill', '#9db3c9').attr('opacity', .022);
      // Two dust fields per area: a coarse one that reads as a galaxy from far
      // away and a fine one that stays as a faint background inside it. Each
      // brightness class is one path, so an area costs six elements, not
      // hundreds. The dust takes the area's progress colour.
      const graph = this;
      galaxies.each(function (galaxy) {
        const g = d3.select(this), far = g.append('g').attr('class', 'tau-dust tau-dust-far'), near = g.append('g').attr('class', 'tau-dust tau-dust-near');
        // A sector's dust is specks of a fixed size on screen (speckPath): as the camera closes in they draw apart
        // round the roadmaps, keeping the sector's progress colours, rather than swell into blots that hide them.
        const farRadius = Math.max(3, Math.max(galaxy.rx, galaxy.ry) * .019), nearRadius = Math.max(.4, Math.max(galaxy.rx, galaxy.ry) * .0018);
        [0, 1, 2].forEach(cls => {
          const points = galaxy.dust.filter(p => p.cls === cls), sparse = points.filter((_, index) => index % 3 === 0);
          if (galaxy.sector) {
            far.append('path').attr('class', 'tau-dust-path tau-dust-speck').attr('data-class', cls).attr('d', graph.speckPath(points)).attr('vector-effect', 'non-scaling-stroke');
            near.append('path').attr('class', 'tau-dust-path tau-dust-speck').attr('data-class', cls).attr('d', graph.speckPath(sparse)).attr('vector-effect', 'non-scaling-stroke');
            return;
          }
          far.append('path').attr('class', 'tau-dust-path').attr('data-class', cls).attr('d', graph.dustPath(points, farRadius * (cls === 2 ? 1.2 : cls === 1 ? .95 : .7)));
          near.append('path').attr('class', 'tau-dust-path').attr('data-class', cls).attr('d', graph.dustPath(sparse, nearRadius * (cls === 2 ? 1.3 : 1)));
        });
      });
      this.paintDust();
      galaxies.filter(d => !d.outline).append('ellipse').attr('class', 'tau-ring tau-galaxy-ring').attr('cx', d => d.x).attr('cy', d => d.y).attr('rx', d => d.rx).attr('ry', d => d.ry)
        .attr('fill', 'none').attr('stroke', ACCENT).attr('vector-effect', 'non-scaling-stroke').attr('stroke-width', 1).attr('opacity', 0);
      galaxies.filter(d => d.outline).append('path').attr('class', 'tau-ring tau-galaxy-ring').attr('d', d => d.outline)
        .attr('fill', 'none').attr('stroke', ACCENT).attr('vector-effect', 'non-scaling-stroke').attr('stroke-width', 1).attr('opacity', 0);
      const routes = this.layers.route.selectAll('path').data(this.universe.routes).enter().append('path').attr('class', 'tau-route tau-sector-route')
        .attr('data-source-area', d => d.source).attr('data-target-area', d => d.target).attr('data-strong', d => String(!!d.strong))
        .attr('d', d => d.path).attr('vector-effect', 'non-scaling-stroke').attr('stroke-width', d => .7 + Math.min(1, Math.log1p(d.dependencies) * .18)).attr('opacity', 0);
      routes.append('title').text(d => `${d.source} ↔ ${d.target}: ${d.dependencies} roadmap prerequisite links`);
    }

    paintDust() {
      this.layers.galaxy.selectAll('g.tau-galaxy').each(function (galaxy) {
        const lit = hasProgress(galaxy), colour = lit ? accentOf(galaxy) : DUST;
        const base = lit ? .4 + .45 * (progressValue(galaxy.progress) / 100) : .34;
        // A speck is a stroke, coloured as the other dust is filled.
        d3.select(this).selectAll('.tau-dust-path').attr('fill', function () { return this.classList.contains('tau-dust-speck') ? 'none' : colour; })
          .attr('stroke', function () { return this.classList.contains('tau-dust-speck') ? colour : null; }).attr('opacity', function () {
          const cls = Number(this.getAttribute('data-class')); return Math.min(.95, base * (cls === 2 ? 1.5 : cls === 1 ? 1 : .5));
        });
      });
    }

    // ----- level of detail ---------------------------------------------------
    scheduleRender() {
      if (this.renderScheduled || this.destroyed) return;
      this.renderScheduled = true;
      requestAnimationFrame(() => { this.renderScheduled = false; this.render(); });
    }

    visibleRect(margin) {
      const k = this.transform.k, t = this.transform;
      const x0 = -t.x / k, y0 = -t.y / k, w = this.width / k, h = this.height / k;
      return { x: x0 - w * margin, y: y0 - h * margin, w: w * (1 + 2 * margin), h: h * (1 + 2 * margin) };
    }

    thresholds() {
      // Screen-space sizes at which each level becomes legible. A galaxy's
      // heading is only useful while the galaxy is smaller than the view.
      const small = this.width < 600 || this.height < 300;
      // Fields with several areas open (their areas are named instead of them)
      // once the camera is this many times closer than the overview.
      return { resolve: 18, constellationName: small ? 40 : 44, starName: small ? 46 : 54, system: 26, planetName: small ? 96 : 120, artefactName: small ? 150 : 180, small };
    }

    render() {
      if (!this.universe || this.destroyed) return;
      const k = this.transform.k, rect = this.visibleRect(.15), T = this.thresholds(), universe = this.universe;
      // The distance rings' names keep one size on screen.
      this.layers.field.selectAll('text.tau-ring-label').attr('font-size', 10 / k);
      const active = this.isCoarse ? (this.selectedId || this.hoveredId) : (this.hoveredId || this.selectedId);
      const activeNode = universe.byId.get(active) || null;
      const intersects = (x, y, r) => x + r > rect.x && x - r < rect.x + rect.w && y + r > rect.y && y - r < rect.y + rect.h;
      // On the sector map, where a sector's middle line leaves the chart, when the sector reaches that far: a name
      // waits there, at the edge, pointing the way along its sector.
      const edgeSpots = (angle, outer, inner) => {
        const core = universe.core;
        if (!core || universe.layout !== 'sectors') return [];
        const font = T.small ? 10 : 11, margin = 6, cx = core.x * k + this.transform.x, cy = core.y * k + this.transform.y, dx = Math.cos(angle), dy = Math.sin(angle);
        const exits = [];
        if (Math.abs(dx) > 1e-9) exits.push([((dx > 0 ? this.width - margin : margin) - cx) / dx, dx > 0 ? 'right' : 'left']);
        if (Math.abs(dy) > 1e-9) exits.push([((dy > 0 ? this.height - margin : margin) - cy) / dy, dy > 0 ? 'bottom' : 'top']);
        const [reach, side] = exits.filter(([s]) => s > 0).sort((a, b) => a[0] - b[0])[0] || [];
        if (!(reach > 0) || reach / k > outer) return [];
        // At the edge, then stepping in along the sector a row at a time, so that neighbouring names can stagger.
        return [0, 1, 2, 3, 4].map(row => reach - row * 2.6 * (font + 3)).filter(at => at > 0 && at / k > inner).map(at => {
          const sx = cx + dx * at + (side === 'left' ? 4 : side === 'right' ? -4 : 0), sy = cy + dy * at + (side === 'top' ? font + 4 : side === 'bottom' ? -4 : 0);
          return { x: (sx - this.transform.x) / k, y: (sy - this.transform.y) / k, above: side !== 'top', anchor: side === 'left' ? 'start' : side === 'right' ? 'end' : 'middle' };
        });
      };
      // A name is drawn only for an object whose centre is on the chart: a name
      // beside a disc hidden under the chart's edge would float unexplained.
      const chart = this.visibleRect(0);
      const centred = (x, y) => x >= chart.x && x <= chart.x + chart.w && y >= chart.y && y <= chart.y + chart.h;
      // A galaxy is considered whenever any of its roadmaps could be: the
      // roadmap test below allows its own radius plus a screen margin.
      const galaxies = universe.galaxies.filter(g => intersects(g.x, g.y, Math.max(g.rx, g.ry) * 1.2 + 64 + 40 / k));
      const constellations = [], stars = [], planets = [], artefacts = [], labels = [];
      // A very short chart leaves the centre unnamed so the nearest subjects keep theirs.
      if (universe.core && this.height >= 330 && intersects(universe.core.x, universe.core.y, universe.core.r * 3)) {
        const core = universe.core;
        labels.push({ id: 'core:' + core.id, nodeId: core.id, kind: 'core', x: core.x, y: core.y + core.r * 1.75 + 12 / k, lines: ['Mathlib'], font: T.small ? 11 : 12,
          anchor: 'middle', above: false, priority: 200, active: false, alternatives: [{ x: core.x, y: core.y - core.r * 1.75 - 6 / k, above: true }] });
      }
      // Names come in two tiers, as on a map. A field is named in spaced
      // capitals above its areas, and each area keeps its own name from the
      // overview on, while its colours are in view. A field with one area is
      // named once, as a field. A field's name gives way once the camera is
      // inside the field.
      (universe.fields || []).forEach(field => {
        field.labelVisible = false;
        // A sector is as wide as its arc where most of its roadmaps lie; its name gives way once that fills the chart.
        const wide = field.labelSpots ? (field.a1 - field.a0) * field.hubRadius * k > this.width * 1.2 : field.w * k > this.width * 1.2;
        if (wide || (!field.labelSpots && !intersects(field.x, field.y, Math.max(field.w, field.h) / 2))) return;
        field.labelVisible = true;
        const lines = T.small ? [(field.short || field.label).toUpperCase()]
          : field.caption ? field.caption.map(line => line === field.code ? line : line.toUpperCase()) : wrapText(field.label.toUpperCase(), 28, 2);
        // Above the field, clear of its top area's name; else above one of its
        // areas, largest first; else below the field, or below one of its
        // areas; else beside the field. In the crowded middle of the map every
        // place above can be taken: the analysis field lost its name on
        // 2026-10-12, once Tau Ceti's operator-theory roadmaps joined it.
        const middle = (field.left + field.right) / 2, centre = (field.top + field.bottom) / 2;
        const areas = field.galaxyIds.map(id => universe.byId.get(id)).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
        const spots = [{ x: middle, y: field.top - 42 / k, above: true }]
          .concat(areas.map(g => ({ x: g.x, y: g.top - 42 / k, above: true })),
            [{ x: middle, y: field.bottom + 16 / k, above: false }],
            areas.map(g => ({ x: g.x, y: g.bottom + 16 / k, above: false })),
            [{ x: field.right + 10 / k, y: centre, above: false, anchor: 'start' }, { x: field.left - 10 / k, y: centre, above: false, anchor: 'end' }]);
        const along = field.labelSpots ? [...edgeSpots((field.a0 + field.a1) / 2, field.r1, field.r0), ...field.labelSpots] : null;
        labels.push({ id: 'field:' + field.id, nodeId: field.id, kind: 'field', x: (along || spots)[0].x, y: (along || spots)[0].y, lines, font: T.small ? 10 : 11,
          anchor: along ? along[0].anchor : 'middle', above: along ? along[0].above : true,
          priority: 150 + field.count, active: active === field.id, members: new Set(field.galaxyIds), alternatives: (along || spots).slice(1) });
      });
      // A sector with no roadmaps yet is named faintly along its middle, with its identifier: Mathlib's disk has
      // material there (the Mathlib-only areas), and roadmaps will come.
      (universe.emptySectors || []).forEach(s => {
        const along = [...edgeSpots((s.a0 + s.a1) / 2, s.spots[0] ? Math.hypot(s.spots[0].x, s.spots[0].y) : 0, 0), ...s.spots].filter(spot => intersects(spot.x, spot.y, 60 / k));
        if (!along.length || (s.a1 - s.a0) * Math.hypot(along[0].x, along[0].y) * k < 18) return;
        const lines = T.small ? [(s.short || s.label).toUpperCase()] : [(s.short || s.label).toUpperCase(), ...(s.code ? [s.code] : [])];
        labels.push({ id: 'empty:' + s.id, nodeId: s.id, kind: 'emptysector', x: along[0].x, y: along[0].y, lines, font: T.small ? 9.5 : 10,
          anchor: along[0].anchor, above: along[0].above, priority: 70, active: false, alternatives: along.slice(1) });
      });
      const framed = new Map();
      galaxies.forEach(galaxy => {
        const screenW = galaxy.labelSpots ? (galaxy.a1 - galaxy.a0) * galaxy.hubRadius * k : galaxy.w * k;
        // On the sector map an area of a divided category is named once the camera has opened its category,
        // so that the overview names the categories; the area hovered or selected is named anyway.
        const parent = galaxy.labelSpots && galaxy.fieldId ? universe.byId.get(galaxy.fieldId) : null;
        if (parent && !framed.has(parent.id)) framed.set(parent.id, k >= this.transformFor(this.footprint(parent.id)).k * .85 && intersects(parent.x, parent.y, 0));
        const opened = !parent || (parent.a1 - parent.a0) * parent.hubRadius * k > this.width * .5 || active === galaxy.id || active === parent.id || framed.get(parent.id);
        galaxy.headingVisible = opened && screenW < this.width * 1.6 && (galaxy.labelSpots ? galaxy.labelSpots.some(spot => intersects(spot.x, spot.y, 60 / k)) : intersects(galaxy.x, galaxy.y - galaxy.ry, galaxy.rx));
        if (galaxy.headingVisible) {
          const compact = galaxy.w * k < 150 || T.small, field = !galaxy.fieldId;
          const named = compact ? [galaxy.short || wrapText(galaxy.label, 16, 1)[0]] : (galaxy.caption || wrapText(galaxy.label, 21, 2));
          // An arXiv identifier keeps its own case (math.NT) under a heading in capitals.
          const lines = field ? named.map(line => line === galaxy.code ? line : line.toUpperCase()) : named;
          const edge = (value, fallback) => Number.isFinite(value) ? value : fallback;
          const top = edge(galaxy.top, galaxy.y - galaxy.ry) - 8 / k, bottom = edge(galaxy.bottom, galaxy.y + galaxy.ry) + 12 / k;
          const left = edge(galaxy.left, galaxy.x - galaxy.rx) - 6 / k, right = edge(galaxy.right, galaxy.x + galaxy.rx) + 6 / k, middle = galaxy.y + 3.5 / k;
          // Above the galaxy, then below it, then flush with either side of
          // it, then beside it: a heading steps aside rather than vanish.
          const around = [{ x: galaxy.x, y: bottom, above: false }, { x: left + 6 / k, y: top, above: true, anchor: 'start' }, { x: right - 6 / k, y: top, above: true, anchor: 'end' },
            { x: right, y: middle, above: false, anchor: 'start' }, { x: left, y: middle, above: false, anchor: 'end' },
            { x: left + 6 / k, y: bottom, above: false, anchor: 'start' }, { x: right - 6 / k, y: bottom, above: false, anchor: 'end' }];
          // A sector is named along its middle, from its outer end inwards, wherever there is room in view.
          const along = galaxy.labelSpots ? [...edgeSpots((galaxy.a0 + galaxy.a1) / 2, galaxy.r1, galaxy.r0), ...galaxy.labelSpots] : null;
          const first = along ? along[0] : { x: galaxy.x, y: top, above: true, anchor: 'middle' };
          labels.push({ id: 'galaxy:' + galaxy.id, nodeId: galaxy.id, kind: 'galaxy', field, x: first.x, y: first.y, lines, font: T.small ? 10 : 11, anchor: first.anchor, above: first.above,
            priority: (field ? 150 : 100) + galaxy.count, active: active === galaxy.id, alternatives: along ? along.slice(1) : around });
        }
        galaxy.constellationIds.forEach(id => {
          const c = universe.byId.get(id);
          const screenR = c.r * k;
          if (!intersects(c.x, c.y, c.r + 40 / k)) return;
          c.resolved = screenR >= T.resolve && !c.unmapped;
          c.nameVisible = (screenR >= 9 && c.spacing * k >= T.constellationName && screenR < Math.min(this.width, this.height) * 1.1) || active === c.id;
          constellations.push(c);
          if (c.nameVisible) { const top = c.y - (c.resolved ? c.r * 1.05 : Math.max(c.r, 4 / k)) - 5 / k, bottom = c.y + (c.resolved ? c.r * 1.05 : Math.max(c.r, 4 / k)) + 6 / k;
            labels.push({ id: 'constellation:' + c.id, nodeId: c.id, kind: 'constellation', x: c.x, y: top, lines: wrapText(c.label, 20, 2), font: 11, anchor: 'middle', above: true, priority: 60 + (active === c.id ? 40 : 0), active: active === c.id, alternatives: [{ x: c.x, y: bottom, above: false }] }); }
          if (!c.resolved) return;
          // The papers built on this roadmap, named once it is large on screen.
          (c.artefactIds || []).forEach(artefactId => {
            const a = universe.byId.get(artefactId);
            if (!intersects(a.x, a.y, 20 / k)) return;
            artefacts.push(a);
            if ((c.r * k >= T.artefactName || active === a.id) && centred(a.x, a.y)) labels.push({ id: 'artefact:' + a.id, nodeId: a.id, kind: 'artefact', x: a.x, y: a.y + 16 / k, lines: [a.label], font: 10, anchor: 'middle', above: false,
              priority: 15 + (active === a.id ? 60 : 0), active: active === a.id, alternatives: [{ x: a.x, y: a.y - 10 / k, above: true }, { x: a.x + 10 / k, y: a.y + 3.5 / k, above: false, anchor: 'start' }, { x: a.x - 10 / k, y: a.y + 3.5 / k, above: false, anchor: 'end' }] });
          });
          c.starIds.forEach(starId => {
            const s = universe.byId.get(starId);
            if (!intersects(s.x, s.y, s.room + 30 / k)) return;
            s.systemVisible = s.room * k >= T.system && s.planetIds.length > 0;
            // Whole layers are named before their milestones.
            s.nameVisible = (s.nearest * k >= T.starName * (s.top === false ? 1 : .7) || active === s.id) && centred(s.x, s.y);
            stars.push(s);
            const side = (s.systemVisible ? s.room : s.r * 1.6) + 5 / k;
            if (s.nameVisible) labels.push({ id: 'star:' + s.id, nodeId: s.id, kind: 'star', x: s.x, y: s.systemVisible ? s.y - s.room * 1.02 - 4 / k : s.y + s.r * 1.9 + 11 / k, lines: wrapText(s.label, T.small ? 18 : 24, 2), font: 11, anchor: 'middle', above: s.systemVisible, priority: 40 + (s.top === false ? 0 : 8) + (active === s.id ? 50 : 0), active: active === s.id,
              alternatives: [{ x: s.x, y: s.systemVisible ? s.y + s.room * 1.02 + 11 / k : s.y - s.r * 1.9 - 4 / k, above: !s.systemVisible },
                { x: s.x + side, y: s.y + 3.5 / k, above: false, anchor: 'start' }, { x: s.x - side, y: s.y + 3.5 / k, above: false, anchor: 'end' }] });
            if (!s.systemVisible) return;
            s.planetIds.forEach(planetId => {
              const p = universe.byId.get(planetId), detail = p.r * k;
              // Each planet reveals more as it grows on screen: its name, then
              // its kind and a statement excerpt, then its own structure.
              p.nameVisible = (detail >= 8 || s.room * k >= T.planetName || active === p.id) && centred(p.x, p.y);
              p.kindVisible = detail >= 14 && (p.refinement || p.showKind !== false);
              p.cardVisible = detail >= 34 && !!p.summary;
              p.moonsVisible = detail >= 60 && p.moons.length > 0;
              p.moonNamesVisible = detail >= 120;
              planets.push(p);
              if (p.nameVisible) { const left = p.x < s.x - s.r * .2, right = p.x + p.r * 1.4 + 4 / k, leftX = p.x - p.r * 1.4 - 4 / k, font = detail >= 22 ? 11 : 10, diag = p.r * 1.15 + 3 / k;
                const nameLines = wrapText(p.label, 26, 2);
                // Eight places, tried in order: beside the planet on the side
                // away from its star, the other side, below, above, then the
                // four diagonals. A name that fits nowhere waits for more zoom.
                labels.push({ id: 'planet:' + p.id, nodeId: p.id, kind: 'planet', x: left ? leftX : right, y: p.y + 3.5 / k, lines: nameLines, font, anchor: left ? 'end' : 'start', above: false, priority: 20 + (active === p.id ? 60 : 0), active: active === p.id,
                  alternatives: [{ x: left ? right : leftX, y: p.y + 3.5 / k, above: false, anchor: left ? 'start' : 'end' }, { x: p.x, y: p.y + p.r * 1.6 + 11 / k, above: false, anchor: 'middle' }, { x: p.x, y: p.y - p.r * 1.6 - 4 / k, above: true, anchor: 'middle' },
                    { x: p.x + diag, y: p.y + diag + font / k, above: false, anchor: 'start' }, { x: p.x - diag, y: p.y + diag + font / k, above: false, anchor: 'end' }, { x: p.x + diag, y: p.y - diag, above: true, anchor: 'start' }, { x: p.x - diag, y: p.y - diag, above: true, anchor: 'end' }] });
                // The card hangs directly under the name, wherever the name found room.
                if (p.kindVisible) labels.push({ id: 'card:' + p.id, nodeId: p.id, kind: 'card', follows: 'planet:' + p.id, x: p.x, y: p.y, lines: [(p.refinement ? 'reviewed ' : '') + (p.kind || 'target'), ...(p.cardVisible ? wrapText(p.summary, 40, 3) : [])], font: 9, anchor: 'start', above: false, priority: 15 + (active === p.id ? 60 : 0), active: false });
              }
              if (p.moonsVisible) p.moons.forEach((moon, index) => {
                const angle = index / p.moons.length * Math.PI * 2 - Math.PI / 2, ring = p.r * 1.55;
                moon.x = p.x + Math.cos(angle) * ring; moon.y = p.y + Math.sin(angle) * ring; moon.r = p.r * .12; moon.planetId = p.id; moon.id = p.id + '#moon' + index;
                if (p.moonNamesVisible) { const outward = Math.cos(angle) >= 0; labels.push({ id: 'moon:' + moon.id, nodeId: p.id, ownerId: moon.id, kind: 'moon', x: moon.x + (outward ? 1 : -1) * (moon.r + 3 / k), y: moon.y + 3 / k, lines: [wrapText((moon.kind === 'step' ? moon.index + '. ' : moon.kind === 'check' ? 'check: ' : 'if ') + moon.text, 48, 1)[0]], font: 8.5, anchor: outward ? 'start' : 'end', above: false, priority: 10, active: false }); }
              });
            });
          });
        });
      });
      const diskItems = this.collectDisk(k, rect, labels, active, T);
      this.visible = { galaxies, constellations, stars, planets, artefacts, labels, disk: diskItems };
      this.renderDiskItems(diskItems, k, active);
      this.renderConstellations(constellations, k, active);
      this.renderStars(stars, k, active);
      this.renderPlanets(planets, k, active);
      this.renderArtefacts(artefacts, k, active);
      this.renderLabels(labels, k);
      this.renderLinks(activeNode, k);
      const galaxySelection = this.layers.galaxy.selectAll('g.tau-galaxy');
      const activeField = activeNode && activeNode.level === 'field' ? new Set(activeNode.galaxyIds) : null;
      galaxySelection.select('.tau-galaxy-ring').attr('opacity', d => active === d.id ? .55 : activeField && activeField.has(d.id) ? .4 : 0);
      galaxySelection.select('.tau-galaxy-disc').attr('opacity', d => active === d.id ? .04 : .014);
      // Coarse dust is for the far view only; it is gone before a galaxy fills
      // the chart, while the fine dust takes over as a faint background.
      // Each galaxy keeps its coarse dust, which carries its progress colours,
      // until it grows to fill most of the chart, on every screen alike. A
      // short chart (a phone held sideways) counts as 600 pixels, so the map at
      // desktop scale keeps its colours there too.
      const shorter = Math.max(600, Math.min(this.width, this.height)), size = g => g.w * k / shorter;
      // On the sector map the dust follows instead the size on screen of a typical roadmap, 30 units in radius. Its
      // specks never grow, so its colours can stay while the roadmaps are told apart: the coarse dust shrinks from the
      // overview's grain to a fine one as they grow to twelve pixels, and goes as they open into stars; the fine dust
      // stays faintly behind them.
      const radius = 30 * k, grain = 1 + .6 * Math.max(0, Math.min(1, (12 - radius) / 8));
      const farFade = g => g.sector ? Math.max(0, Math.min(1, (22 - radius) / 8)) : Math.max(0, Math.min(1, (1.1 - size(g)) / .6));
      // The fine dust rises before the coarse has faded, so a galaxy never dims in the hand-over.
      const nearFade = g => g.sector ? .34 * Math.max(0, Math.min(1, (radius - 2.5) / 2)) * Math.max(0, Math.min(1, (60 - radius) / 20))
        : .6 * Math.max(0, Math.min(1, (size(g) - .3) / .5)) * Math.max(0, Math.min(1, (9 - k) / 4));
      galaxySelection.select('.tau-dust-far').attr('opacity', farFade).attr('display', g => farFade(g) > 0 ? null : 'none')
        .selectAll('.tau-dust-speck').attr('stroke-width', function () { return [1.2, 1.6, 2][Number(this.getAttribute('data-class'))] * grain; });
      galaxySelection.select('.tau-dust-near').attr('opacity', nearFade).attr('display', g => nearFade(g) > 0 ? null : 'none')
        .selectAll('.tau-dust-speck').attr('stroke-width', .9);
      // The landed pull requests' clouds are dense from far away: half as bright there, so the progress colours
      // still show through, and at full strength once the roadmaps can be told apart. Closer in their stars grow, up
      // to four and a half times, so that a roadmap's cloud stays in view round it as its stars draw apart.
      this.layers.landed.attr('opacity', .5 + .5 * Math.max(0, Math.min(1, (radius - 4) / 8)));
      const grow = Math.max(1, Math.min(4.5, Math.sqrt(k / .5)));
      if (grow !== this.landedGrow) {
        this.landedGrow = grow;
        this.layers.landed.selectAll('path').attr('stroke-width', function () { return Number(this.getAttribute('data-width')) * grow; });
      }
      this.positionLive();
    }

    renderConstellations(items, k, active) {
      const graph = this;
      const join = this.layers.constellation.selectAll('g.tau-constellation').data(items, d => d.id);
      join.exit().remove();
      const enter = join.enter().append('g').attr('class', d => 'tau-node tau-constellation' + (d.unmapped ? ' tau-unmapped-node' : '')).attr('data-node-id', d => d.id).attr('data-level', 'constellation')
        .attr('transform', d => `translate(${d.x},${d.y})`).attr('tabindex', 0).attr('role', 'button').attr('aria-label', d => normalizeText(d.label) + (d.unmapped ? '. Area without a roadmap' : '. Roadmap' + (progressDescription(d) ? ', ' + progressDescription(d) : '')));
      enter.append('circle').attr('class', 'tau-hit');
      enter.append('circle').attr('class', 'tau-constellation-disc').attr('fill', '#b9cad9');
      enter.append('circle').attr('class', 'tau-beacon tau-survey-beacon');
      enter.append('circle').attr('class', 'tau-ring tau-select-ring').attr('fill', 'none').attr('stroke', ACCENT).attr('vector-effect', 'non-scaling-stroke').attr('stroke-width', 1.4);
      enter.append('title').text(d => normalizeText(d.label) + (progressDescription(d) ? '\n' + progressDescription(d) : '') + '\nClick to open');
      this.bindInteractions(enter);
      const all = enter.merge(join);
      all.classed('is-selected', d => d.id === this.selectedId).classed('is-hovered', d => d.id === this.hoveredId).attr('data-progress', d => progressValue(d.progress)).attr('data-resolved', d => String(!!d.resolved));
      // A target never reaches past the midpoint to its nearest neighbour, so
      // a tap lands on the object under the finger and nothing else.
      all.select('.tau-hit').attr('r', d => Math.min(d.resolved ? d.r * 1.08 : Math.max(d.r, (graph.isCoarse ? 14 : 11) / k), Math.max(d.r * .6, (d.spacing || d.r * 4) * .48)));
      all.select('.tau-constellation-disc').attr('r', d => d.r * 1.12).attr('opacity', d => d.resolved ? (active === d.id ? .12 : .07) : 0);
      all.select('.tau-beacon').attr('r', d => d.resolved ? 0 : d.unmapped ? Math.max(2.4 / k, Math.min(d.r, 3 / k)) : Math.max(2.4 / k, Math.min(d.r * .9, (2.4 + Math.min(2.4, d.r * k * .1)) / k)))
        .attr('fill', d => !d.unmapped && hasProgress(d) ? accentOf(d) : BACKGROUND).attr('stroke', d => d.unmapped ? '#8a99a8' : hasProgress(d) ? accentOf(d) : NO_PROGRESS)
        .attr('stroke-width', d => (d.unmapped ? 1 : 1.1) / k).attr('stroke-dasharray', d => d.unmapped ? `${2 / k} ${2 / k}` : null).attr('opacity', d => d.resolved ? 0 : 1);
      all.select('.tau-select-ring').attr('r', d => d.resolved ? d.r * 1.16 : Math.max(d.r * .9, 7 / k)).attr('opacity', d => active === d.id ? .9 : 0);
      // Constellation figures: the faint shape that makes a roadmap a constellation.
      const figures = [];
      items.filter(d => d.resolved).forEach(d => d.figure.forEach((segment, index) => figures.push({ id: d.id + '#' + index, ...segment, constellation: d })));
      const figureJoin = this.layers.figure.selectAll('path.tau-figure').data(figures, d => d.id);
      figureJoin.exit().remove();
      figureJoin.enter().append('path').attr('class', 'tau-figure').attr('vector-effect', 'non-scaling-stroke').merge(figureJoin)
        .attr('d', d => { const a = this.universe.byId.get(d.source), b = this.universe.byId.get(d.target); return `M${a.x},${a.y}L${b.x},${b.y}`; })
        .attr('stroke-width', d => d.real ? .8 : .6).attr('opacity', d => d.real ? .32 : .14);
    }

    renderStars(items, k, active) {
      const graph = this;
      const join = this.layers.star.selectAll('g.tau-star').data(items, d => d.id);
      join.exit().remove();
      const enter = join.enter().append('g').attr('class', 'tau-node tau-star').attr('data-node-id', d => d.id).attr('data-level', 'star')
        .attr('transform', d => `translate(${d.x},${d.y})`).attr('tabindex', 0).attr('role', 'button').attr('aria-label', d => normalizeText(d.label) + '. Layer' + (progressDescription(d) ? ', ' + progressDescription(d) : ''));
      enter.append('circle').attr('class', 'tau-hit');
      enter.append('circle').attr('class', 'tau-star-core').attr('vector-effect', 'non-scaling-stroke');
      enter.append('circle').attr('class', 'tau-ring tau-select-ring').attr('fill', 'none').attr('stroke', ACCENT).attr('vector-effect', 'non-scaling-stroke').attr('stroke-width', 1.6);
      enter.append('title').text(d => normalizeText(d.label) + (progressDescription(d) ? '\n' + progressDescription(d) : '') + '\nClick to open its planets');
      this.bindInteractions(enter);
      const all = enter.merge(join);
      all.classed('is-selected', d => d.id === this.selectedId).classed('is-hovered', d => d.id === this.hoveredId).attr('data-progress', d => progressValue(d.progress));
      all.select('.tau-hit').attr('r', d => Math.min(Math.max(d.r * 1.8, (graph.isCoarse ? 14 : 10) / k), Math.max(d.r * 1.2, (d.nearest || d.r * 6) * .48)));
      all.select('.tau-star-core').attr('r', d => d.r).attr('fill', d => hasProgress(d) ? accentOf(d) : '#1a222c')
        .attr('stroke', d => hasProgress(d) ? accentOf(d) : NO_PROGRESS).attr('stroke-width', d => hasProgress(d) ? 1 : 1.3).attr('stroke-dasharray', d => hasProgress(d) ? null : '2 2');
      all.select('.tau-select-ring').attr('r', d => d.r * 2.2).attr('opacity', d => active === d.id ? 1 : 0);
    }

    renderPlanets(items, k, active) {
      const graph = this;
      const orbits = [];
      const seen = new Set();
      items.forEach(p => { const key = p.starId + '#' + p.orbit.ring; if (seen.has(key)) return; seen.add(key); const star = this.universe.byId.get(p.starId); orbits.push({ id: key, x: star.x, y: star.y, rx: p.orbit.rx, ry: p.orbit.ry }); });
      const orbitJoin = this.layers.planet.selectAll('ellipse.tau-orbit').data(orbits, d => d.id);
      orbitJoin.exit().remove();
      orbitJoin.enter().append('ellipse').attr('class', 'tau-orbit tau-orbit-path').attr('vector-effect', 'non-scaling-stroke').attr('stroke-width', .7).attr('opacity', .7).merge(orbitJoin)
        .attr('cx', d => d.x).attr('cy', d => d.y).attr('rx', d => d.rx).attr('ry', d => d.ry);
      const join = this.layers.planet.selectAll('g.tau-planet').data(items, d => d.id);
      join.exit().remove();
      const enter = join.enter().append('g').attr('class', 'tau-node tau-planet').attr('data-node-id', d => d.id).attr('data-level', 'planet').attr('data-kind', d => d.kind)
        .attr('transform', d => `translate(${d.x},${d.y})`).attr('tabindex', 0).attr('role', 'button').attr('aria-label', d => normalizeText(d.label) + '. ' + (d.kind || 'target') + (d.refinement ? ', source refinement' : ''));
      enter.append('circle').attr('class', 'tau-hit');
      enter.append('path').attr('class', 'tau-planet-ring tau-ring-far').attr('fill', 'none').attr('stroke', RING).attr('vector-effect', 'non-scaling-stroke').attr('stroke-width', 1.1).attr('transform', `rotate(${RING_TILT})`);
      enter.append('circle').attr('class', 'tau-planet-body').attr('stroke', BACKGROUND).attr('vector-effect', 'non-scaling-stroke').attr('stroke-width', 1);
      enter.append('path').attr('class', 'tau-planet-land').attr('d', LAND_PATH).attr('fill', LAND);
      enter.append('path').attr('class', 'tau-planet-ring tau-ring-near').attr('fill', 'none').attr('stroke', RING).attr('vector-effect', 'non-scaling-stroke').attr('stroke-width', 1.1).attr('transform', `rotate(${RING_TILT})`);
      enter.append('circle').attr('class', 'tau-ring tau-select-ring').attr('fill', 'none').attr('stroke', ACCENT).attr('vector-effect', 'non-scaling-stroke').attr('stroke-width', 1.5);
      enter.append('title').text(d => normalizeText(d.label) + '\n' + (d.kind || 'target') + (d.refinement ? ' · source refinement' : '') + '\nClick to read');
      this.bindInteractions(enter);
      const all = enter.merge(join);
      all.classed('is-selected', d => d.id === this.selectedId).classed('is-hovered', d => d.id === this.hoveredId);
      all.select('.tau-hit').attr('r', d => { const star = graph.universe.byId.get(d.starId); return Math.min(Math.max(d.r * 1.5, (graph.isCoarse ? 12 : 8) / k), (star && star.planetGap ? star.planetGap : d.r * 4) * .48); });
      all.select('.tau-planet-body').attr('r', d => d.r).attr('fill', planetFill).attr('stroke-dasharray', d => d.refinement ? `${1.5 / k} ${1.5 / k}` : null);
      // Land is drawn only once it is large enough to see.
      all.select('.tau-planet-land').attr('transform', d => `rotate(${nameHash(d.id) % 360}) scale(${d.r})`)
        .attr('display', d => isDefinitionKind(d.kind) && d.r * k >= 3 ? null : 'none');
      all.select('.tau-ring-far').attr('d', d => ringArc(d.r, false)).attr('display', d => isDefinitionKind(d.kind) ? 'none' : null);
      all.select('.tau-ring-near').attr('d', d => ringArc(d.r, true)).attr('display', d => isDefinitionKind(d.kind) ? 'none' : null);
      all.select('.tau-select-ring').attr('r', d => d.r * 1.9).attr('opacity', d => active === d.id ? 1 : 0);
      // Deep zoom: a reviewed refinement shows its hypotheses (open), proof
      // steps (filled) and acceptance checks (accent) as moons, and the
      // prerequisite links among the refinements of the same layer appear.
      const moons = [];
      items.filter(p => p.moonsVisible).forEach(p => p.moons.forEach(moon => moons.push(moon)));
      const moonJoin = this.layers.planet.selectAll('circle.tau-moon').data(moons, d => d.id);
      moonJoin.exit().remove();
      moonJoin.enter().append('circle').attr('class', 'tau-moon').attr('vector-effect', 'non-scaling-stroke').attr('stroke-width', 1).merge(moonJoin)
        .attr('cx', d => d.x).attr('cy', d => d.y).attr('r', d => d.r).attr('data-kind', d => d.kind)
        .attr('fill', d => d.kind === 'hypothesis' ? '#1a222c' : d.kind === 'check' ? ACCENT : '#b9c2cc').attr('stroke', d => d.kind === 'hypothesis' ? '#9aa6b2' : d.kind === 'check' ? ACCENT : '#b9c2cc');
      const stars = new Map(); items.forEach(p => { if (p.kindVisible) stars.set(p.starId, this.universe.byId.get(p.starId)); });
      const internal = [];
      stars.forEach(star => (star.planetEdges || []).forEach((edge, index) => { const a = this.universe.byId.get(edge.source), b = this.universe.byId.get(edge.target); if (a && b) internal.push({ id: star.id + '#' + index, a, b }); }));
      const linkJoin = this.layers.figure.selectAll('path.tau-system-link').data(internal, d => d.id);
      linkJoin.exit().remove();
      linkJoin.enter().append('path').attr('class', 'tau-system-link').attr('vector-effect', 'non-scaling-stroke').attr('stroke-width', .9).attr('opacity', .5).attr('marker-end', 'url(#' + this.id + '-arrow-quiet)').merge(linkJoin)
        .attr('d', d => { const dx = d.b.x - d.a.x, dy = d.b.y - d.a.y, len = Math.max(.001, Math.hypot(dx, dy)), ax = d.a.x + dx / len * d.a.r * 1.3, ay = d.a.y + dy / len * d.a.r * 1.3, bx = d.b.x - dx / len * d.b.r * 1.5, by = d.b.y - dy / len * d.b.r * 1.5; return `M${ax},${ay}L${bx},${by}`; });
    }

    renderArtefacts(items, k, active) {
      // A paper is a small diamond, the same size on screen at any zoom. It
      // fills from the bottom, in the progress colour, as the layers it needs
      // are formalised, and is full once they all are; once it is unlocked it
      // is solid white with a halo.
      const diamond = s => `M0,${-s}L${s * .72},0L0,${s}L${-s * .72},0Z`, filled = d => Math.max(0, Math.min(100, progressValue(d.progress) || 0));
      // The part of the diamond below a level that rises from its bottom corner (fraction 0) to its top (1).
      const level = (s, f) => {
        if (f <= 0) return null;
        if (f >= 1) return diamond(s);
        const w = s * .72, y = s - 2 * s * f, half = w * (1 - Math.abs(y) / s);
        return y >= 0 ? `M0,${s}L${half},${y}L${-half},${y}Z` : `M0,${s}L${w},0L${half},${y}L${-half},${y}L${-w},0Z`;
      };
      const join = this.layers.artefact.selectAll('g.tau-artefact').data(items, d => d.id);
      join.exit().remove();
      const enter = join.enter().append('g').attr('class', 'tau-node tau-artefact').attr('data-node-id', d => d.id).attr('data-level', 'artefact')
        .attr('tabindex', 0).attr('role', 'button').attr('aria-label', d => normalizeText(d.label) + '. Paper' + (d.progressLabel ? ', ' + d.progressLabel : ''));
      enter.append('circle').attr('class', 'tau-hit').attr('r', this.isCoarse ? 14 : 10);
      enter.append('path').attr('class', 'tau-artefact-halo').attr('d', diamond(9.5)).attr('fill', 'none').attr('stroke', '#ffffff').attr('stroke-width', 1).attr('opacity', .45);
      enter.append('path').attr('class', 'tau-artefact-body').attr('d', diamond(6)).attr('stroke', 'none');
      enter.append('path').attr('class', 'tau-artefact-fill');
      enter.append('path').attr('class', 'tau-artefact-outline').attr('d', diamond(6)).attr('fill', 'none').attr('stroke-width', 1.3);
      enter.append('circle').attr('class', 'tau-ring tau-select-ring').attr('r', 11).attr('fill', 'none').attr('stroke', ACCENT).attr('stroke-width', 1.5);
      enter.append('title');
      this.bindInteractions(enter);
      const all = enter.merge(join);
      all.attr('transform', d => `translate(${d.x},${d.y}) scale(${1 / k})`).classed('is-selected', d => d.id === this.selectedId).classed('is-hovered', d => d.id === this.hoveredId)
        .attr('data-progress', d => progressValue(d.progress)).attr('data-unlocked', d => d.unlocked ? 'true' : 'false');
      all.select('title').text(d => normalizeText(d.label) + (d.progressLabel ? '\n' + d.progressLabel : '') + '\nClick to read about the paper');
      all.select('.tau-artefact-halo').attr('display', d => d.unlocked ? null : 'none');
      all.select('.tau-artefact-body').attr('fill', d => d.unlocked ? '#ffffff' : BACKGROUND);
      all.select('.tau-artefact-fill').attr('d', d => level(6, filled(d) / 100)).attr('fill', d => progressColor(filled(d)))
        .attr('display', d => d.unlocked || !filled(d) ? 'none' : null);
      all.select('.tau-artefact-outline').attr('stroke', d => d.unlocked ? '#ffffff' : progressColor(filled(d)));
      all.select('.tau-select-ring').attr('opacity', d => active === d.id ? 1 : 0);
    }

    renderLabels(labels, k) {
      // Greedy placement in screen space: higher priority wins, and no text is
      // drawn over another text. A hidden name reappears once there is room.
      const t = this.transform, placed = [];
      labels.sort((a, b) => b.priority - a.priority);
      // Other galaxies' discs are obstacles for an area heading: a heading
      // that would sit on a neighbouring galaxy is as misleading as an overlap.
      // On the sector map a galaxy is its wedge, not the ellipse round it.
      const discs = (this.visible ? this.visible.galaxies : []).map(g => ({ id: g.id, x: g.x * k + t.x, y: g.y * k + t.y, rx: g.rx * k, ry: g.ry * k, wedge: g.sector ? g : null }));
      const inWedge = (g, sx, sy) => { const x = (sx - t.x) / k, y = (sy - t.y) / k, radius = Math.hypot(x, y); let angle = Math.atan2(y, x);
        while (angle < g.a0) angle += Math.PI * 2; return radius >= g.r0 && radius <= g.r1 && angle <= g.a1; };
      const onDisc = (box, own) => discs.some(g => (own instanceof Set ? !own.has(g.id) : g.id !== own)
        && (g.wedge ? inWedge(g.wedge, box.x + box.w / 2, box.y + box.h / 2) : (((box.x + box.w / 2 - g.x) / g.rx) ** 2 + ((box.y + box.h / 2 - g.y) / g.ry) ** 2) < 1));
      // Planet discs and star cores are solid: text never runs across another
      // object. The zoom buttons and the hint in the chart's corners are
      // solid too, so nothing is drawn behind them.
      const solids = [];
      (this.visible ? this.visible.stars : []).forEach(s => { const r = s.r * k; if (r >= 2.5) solids.push({ owner: s.id, x: s.x * k + t.x, y: s.y * k + t.y, r }); });
      (this.visible ? this.visible.planets : []).forEach(p => { const r = p.r * k; if (r >= 2.5) solids.push({ owner: p.id, x: p.x * k + t.x, y: p.y * k + t.y, r }); });
      // A roadmap drawn as a point, and Mathlib at the centre, are solid too.
      (this.visible ? this.visible.constellations : []).forEach(c => { if (c.resolved) return; const r = Math.max(2.4, Math.min(c.r * k * .9, 2.4 + Math.min(2.4, c.r * k * .1))); solids.push({ owner: c.id, x: c.x * k + t.x, y: c.y * k + t.y, r: r + 1.5 }); });
      if (this.universe && this.universe.core) { const c = this.universe.core; solids.push({ owner: c.id, x: c.x * k + t.x, y: c.y * k + t.y, r: c.r * k * 1.2 + 1 }); }
      // The disk's dots are solid to the names of its items; the disk's own names (Mathlib, its areas) lie over them, as a
      // galaxy's name lies over its dust, and so does the name of the item selected or pointed at, among its neighbours.
      // A landmark's name lies over the faint dots of the files' headers' items, never over another landmark's: where
      // they crowd, near the rim, the landmarks were left unnamed (the user, 2026-10-28: the class number formula).
      if (this.diskState === 'open') (this.visible && this.visible.disk || []).forEach(d => solids.push({ owner: d.id, disk: true, tier: d.tier, x: d.x * k + t.x, y: d.y * k + t.y, r: d.tier === 1 ? 4 : 3 }));
      const overlays = this.overlayBoxes();
      const onSolid = (box, own, label) => solids.some(s => s.owner !== own && !(s.disk && (label.kind === 'core' || label.kind === 'disksector' || label.chosen || (label.landmark && s.tier !== 1))) && Math.hypot(Math.max(box.x, Math.min(s.x, box.x + box.w)) - s.x, Math.max(box.y, Math.min(s.y, box.y + box.h)) - s.y) < s.r - 1)
        || overlays.some(o => Math.min(box.x + box.w, o.x + o.w) - Math.max(box.x, o.x) > 0 && Math.min(box.y + box.h, o.y + o.h) - Math.max(box.y, o.y) > 0);
      const collides = (box, label) => placed.some(other => Math.min(box.x + box.w, other.x + other.w) - Math.max(box.x, other.x) > -2 && Math.min(box.y + box.h, other.y + other.h) - Math.max(box.y, other.y) > -1)
        || (label.kind === 'galaxy' && onDisc(box, label.nodeId)) || (label.kind === 'field' && onDisc(box, label.members)) || onSolid(box, label.ownerId || label.nodeId, label);
      const byId = new Map(labels.map(label => [label.id, label]));
      // A name is drawn only when the whole of it fits the chart; a clipped
      // name reads as a different name.
      const onScreen = box => box.x >= 2 && box.x + box.w <= this.width - 2 && box.y >= 2 && box.y + box.h <= this.height - 2;
      labels.forEach(label => {
        // Widths come from measured text where a line has been drawn before;
        // otherwise from an estimate that errs wide. A margin keeps neighbours
        // apart even when the measurement is a frame old.
        const measure = (line, index) => this.widthCache.get(label.font + (label.kind === 'card' && index === 0 ? 'u' : 'n') + '|' + line) ?? line.length * label.font * (label.kind === 'card' && index === 0 ? .84 : .62);
        const w = Math.max(...label.lines.map(measure)) + 8, h = label.lines.length * (label.font + 3) + 3;
        // An area heading or a constellation name may step aside rather than
        // vanish: below its object, or to either side, when the place above
        // is taken. Star and planet names keep their single place.
        const spots = [{ x: label.x, y: label.y, above: label.above }];
        if (label.alternatives) label.alternatives.forEach(spot => spots.push(spot));
        label.shown = false;
        if (label.follows) {
          // A follower hangs under the label it follows, flush with its left
          // or right edge, and disappears with it.
          const lead = byId.get(label.follows);
          if (!lead || !lead.shown) { label.box = { x: 0, y: 0, w: 0, h: 0 }; return; }
          const b = lead.box;
          // Under the name (left- or right-aligned), beside it, or above it.
          spots.length = 0; spots.push({ screen: { x: b.x, y: b.y + b.h + 2 } }, { screen: { x: b.x + b.w - w, y: b.y + b.h + 2 } },
            { screen: { x: b.x + b.w + 6, y: b.y } }, { screen: { x: b.x - w - 6, y: b.y } }, { screen: { x: b.x, y: b.y - h - 2 } }, { screen: { x: b.x + b.w - w, y: b.y - h - 2 } });
        }
        for (const spot of spots) {
          const anchor = spot.screen ? 'start' : spot.anchor || label.anchor, sy = spot.screen ? spot.screen.y + label.font : spot.y * k + t.y;
          let sx = spot.screen ? spot.screen.x : spot.x * k + t.x;
          const box = { x: anchor === 'middle' ? sx - w / 2 : anchor === 'end' ? sx - w : sx, y: spot.above ? sy - h + 3 : sy - label.font, w, h };
          // An area heading at the edge of the chart slides inward rather
          // than vanish, by at most half its width, so it stays by its galaxy.
          const shift = label.kind === 'galaxy' || label.kind === 'field' ? Math.max(0, 2 - box.x) - Math.max(0, box.x + box.w - (this.width - 2)) : 0;
          if (shift && Math.abs(shift) <= w / 2) { box.x += shift; sx += shift; }
          if (!onScreen(box) || collides(box, label)) { label.box = label.box || box; continue; }
          label.shown = true; label.box = box; label.x = spot.screen || shift ? (sx - t.x) / k : spot.x; label.y = spot.screen ? (sy - t.y) / k : spot.y; label.above = !!spot.above; label.anchor = anchor; placed.push(box);
          break;
        }
        if (!label.box) { const sx = label.x * k + t.x, sy = label.y * k + t.y; label.box = { x: sx - w / 2, y: sy - h + 3, w, h }; }
      });
      const shown = labels.filter(label => label.shown);
      const join = this.layers.label.selectAll('g.tau-label').data(shown, d => d.id);
      join.exit().remove();
      const enter = join.enter().append('g').attr('class', d => 'tau-label tau-label-' + d.kind).attr('data-label-for', d => d.nodeId);
      enter.append('rect').attr('class', 'tau-label-hit');
      enter.append('text');
      const graph = this;
      enter.filter(d => d.kind === 'field').on('click', d => { d3.event.stopPropagation(); if (Date.now() < graph.suppressClicksUntil) return; graph.zoomTo(d.nodeId); })
        .on('mouseenter', d => { if (!graph.isCoarse && !graph.pointerResting(d3.event)) { graph.hoveredId = d.nodeId; graph.scheduleRender(); } }).on('mouseleave', () => { if (!graph.isCoarse) { graph.hoveredId = null; graph.scheduleRender(); } });
      enter.filter(d => d.kind === 'mathlib').on('click', d => { d3.event.stopPropagation(); if (Date.now() < graph.suppressClicksUntil) return; graph.options.onSelect?.(graph.universe.byId.get(d.nodeId)); })
        .on('mouseenter', d => { if (!graph.isCoarse && !graph.pointerResting(d3.event)) { graph.hoveredId = d.nodeId; graph.scheduleRender(); } }).on('mouseleave', () => { if (!graph.isCoarse) { graph.hoveredId = null; graph.scheduleRender(); } });
      enter.filter(d => d.kind === 'galaxy').on('click', d => { d3.event.stopPropagation(); if (Date.now() < graph.suppressClicksUntil) return; graph.options.onSelect?.(graph.universe.byId.get(d.nodeId)); })
        .on('mouseenter', d => { if (!graph.isCoarse && !graph.pointerResting(d3.event)) { graph.hoveredId = d.nodeId; graph.scheduleRender(); } }).on('mouseleave', () => { if (!graph.isCoarse) { graph.hoveredId = null; graph.scheduleRender(); } });
      const all = enter.merge(join);
      all.classed('is-active', d => d.active).classed('is-field', d => !!d.field).classed('is-landmark', d => !!d.landmark).attr('transform', d => `translate(${d.x},${d.y}) scale(${1 / k})`);
      const cache = this.widthCache; let measured = false;
      all.select('text').attr('text-anchor', d => d.anchor).attr('font-size', d => d.font).each(function (d) {
        const text = d3.select(this); text.selectAll('tspan').remove();
        d.lines.forEach((line, index) => {
          const span = text.append('tspan').attr('x', 0).attr('y', d.above ? -(d.lines.length - 1 - index) * (d.font + 3) : index * (d.font + 3)).text(line);
          const key = d.font + (d.kind === 'card' && index === 0 ? 'u' : 'n') + '|' + line;
          if (!cache.has(key)) { try { cache.set(key, span.node().getComputedTextLength()); measured = true; } catch (_) { /* detached */ } }
        });
      });
      all.select('rect').attr('x', d => d.anchor === 'middle' ? -d.box.w / 2 : d.anchor === 'end' ? -d.box.w : 0).attr('y', d => d.above ? -d.box.h + 3 : -d.font).attr('width', d => d.box.w).attr('height', d => d.box.h)
        .style('pointer-events', d => d.kind === 'galaxy' || d.kind === 'field' ? 'all' : 'none');
      if (measured) this.scheduleRender();
    }

    overlayBoxes() {
      // The corner controls and the progress card, in chart coordinates, padded by a few pixels.
      const host = this.container && this.container.parentNode;
      if (!host) return [];
      // The card grows and shrinks with what it reports (src/app.js): a change of its size clears the boxes kept.
      if (!this.overlayWatch && typeof ResizeObserver === 'function') {
        this.overlayWatch = new ResizeObserver(() => { this.overlayCache = null; this.scheduleRender(); });
        host.querySelectorAll('.atlas-progress').forEach(el => this.overlayWatch.observe(el));
      }
      const hint = host.querySelector('.graph-hint'), key = this.width + 'x' + this.height + '|' + (hint ? hint.textContent : '');
      if (this.overlayCache && this.overlayCache.key === key) return this.overlayCache.boxes;
      const base = this.container.getBoundingClientRect();
      const boxes = Array.from(host.querySelectorAll('.graph-tools, .graph-hint, .atlas-progress')).map(el => el.getBoundingClientRect()).filter(b => b.width > 0 && b.height > 0)
        .map(b => ({ x: b.left - base.left - 4, y: b.top - base.top - 4, w: b.width + 8, h: b.height + 8 }));
      this.overlayCache = { key, boxes };
      return boxes;
    }

    renderLinks(activeNode, k) {
      const links = [];
      if (activeNode) {
        const universe = this.universe;
        // A gentle quadratic curve from a to b, and the point halfway along it.
        const curve = (a, b, bend) => {
          const dx = b.x - a.x, dy = b.y - a.y, length = Math.max(1, Math.hypot(dx, dy));
          const mx = (a.x + b.x) / 2 - dy / length * bend, my = (a.y + b.y) / 2 + dx / length * bend;
          return { path: `M${a.x},${a.y}Q${mx},${my} ${b.x},${b.y}`, mid: { x: (a.x + 2 * mx + b.x) / 4, y: (a.y + 2 * my + b.y) / 4 }, ends: [a.x, a.y, mx, my, b.x, b.y] };
        };
        if (activeNode.level === 'star') universe.starEdges.forEach((edge, index) => {
          if (edge.source !== activeNode.id && edge.target !== activeNode.id) return;
          const a = universe.byId.get(edge.source), b = universe.byId.get(edge.target);
          links.push({ id: 'star:' + index, ...curve(a, b, Math.min(12, Math.hypot(b.x - a.x, b.y - a.y) * .12)), arrow: true, reference: false,
            level: 'star', source: edge.source, target: edge.target });
        });
        if (activeNode.level === 'constellation') {
          universe.constellationEdges.forEach((edge, index) => {
            if (edge.source !== activeNode.id && edge.target !== activeNode.id) return;
            const a = universe.byId.get(edge.source), b = universe.byId.get(edge.target);
            links.push({ id: 'roadmap:' + index, ...curve(a, b, Math.min(60, Math.hypot(b.x - a.x, b.y - a.y) * .1)), arrow: true, reference: false,
              level: 'constellation', source: edge.source, target: edge.target, count: edge.count });
          });
          if (this.showReferences) universe.relatedEdges.forEach((edge, index) => {
            if (edge.source !== activeNode.id && edge.target !== activeNode.id) return;
            const a = universe.byId.get(edge.source), b = universe.byId.get(edge.target);
            links.push({ id: 'related:' + index, ...curve(a, b, 0), arrow: false, reference: true, level: 'constellation', source: edge.source, target: edge.target });
          });
        }
        // A paper draws a line from each roadmap it builds on, like the lines between roadmaps,
        // ending at the rim of its diamond (which keeps its size on screen) rather than under it.
        if (activeNode.level === 'artefact') (universe.artefactEdges || []).forEach((edge, index) => {
          if (edge.target !== activeNode.id) return;
          const a = universe.byId.get(edge.source), b = universe.byId.get(edge.target);
          if (!a || !b) return;
          const dx = b.x - a.x, dy = b.y - a.y, length = Math.max(1e-6, Math.hypot(dx, dy)), gap = Math.min(length / 2, 11 / k);
          links.push({ id: 'paper:' + index, ...curve(a, { x: b.x - dx / length * gap, y: b.y - dy / length * gap }, Math.min(40, length * .1)), arrow: true,
            reference: false, level: 'artefact', source: edge.source, target: edge.target, count: edge.count, whole: edge.whole });
        });
        if (activeNode.level === 'galaxy') this.layers.route.selectAll('path.tau-route').attr('opacity', d => d.source === activeNode.id || d.target === activeNode.id ? .6 : 0);
      }
      if (!activeNode || activeNode.level !== 'galaxy') this.layers.route.selectAll('path.tau-route').attr('opacity', 0);
      // The wide invisible edge that picks a link out keeps clear of the two things it joins, by twelve pixels or by an
      // opened roadmap's disc: it is drawn above the roadmaps, and from far out, where a roadmap is a point, it would
      // cover the point, so that hovering it would flicker and clicking it would pick the link. It runs along the same
      // curve, cut at both ends (the curve's blossom gives the piece between).
      const clearance = id => { const node = this.universe && this.universe.byId.get(id);
        return Math.max(node && node.level === 'constellation' && node.resolved ? node.r * 1.08 : (node && node.r) || 0, 12 / k); };
      const blossom = (u, v, a, b, c) => (1 - u) * (1 - v) * a + ((1 - u) * v + u * (1 - v)) * b + u * v * c;
      links.forEach(link => {
        const [x0, y0, x1, y1, x2, y2] = link.ends, length = Math.max(1e-6, Math.hypot(x2 - x0, y2 - y0));
        const s = Math.min(.45, clearance(link.source) / length), t = Math.max(.55, 1 - clearance(link.target) / length);
        link.hit = `M${blossom(s, s, x0, x1, x2)},${blossom(s, s, y0, y1, y2)}Q${blossom(s, t, x0, x1, x2)},${blossom(s, t, y0, y1, y2)} `
          + `${blossom(t, t, x0, x1, x2)},${blossom(t, t, y0, y1, y2)}`;
      });
      if (this.selectedLinkId && !links.some(link => link.id === this.selectedLinkId)) this.selectedLinkId = null;
      const chosen = this.selectedLinkId, near = this.hoveredLinkId;
      const join = this.layers.link.selectAll('path.tau-link').data(links, d => d.id);
      join.exit().remove();
      join.enter().append('path').attr('class', d => 'tau-link' + (d.reference ? ' is-reference tau-reference-edge' : '')).attr('vector-effect', 'non-scaling-stroke').merge(join)
        .classed('is-selected', d => d.id === chosen)
        .attr('d', d => d.path).attr('stroke-width', d => d.id === chosen ? 2.4 : d.id === near ? 1.8 : 1.1)
        .attr('opacity', d => d.id === chosen || d.id === near ? 1 : chosen ? .22 : .6).attr('stroke-dasharray', d => d.reference ? '2 6' : null)
        .attr('marker-end', d => d.arrow ? 'url(#' + this.id + '-arrow)' : null);
      // Each link has a wide invisible stroke on top, so that a pointer or a
      // finger can pick it out; selecting it names the two things it joins.
      const graph = this, name = id => { const node = this.universe.byId.get(id); return (node && (node.label || node.title)) || id; };
      const hits = this.layers.link.selectAll('path.tau-link-hit').data(links, d => d.id);
      hits.exit().remove();
      hits.enter().append('path').attr('class', 'tau-link-hit').attr('vector-effect', 'non-scaling-stroke').attr('stroke-width', 14).attr('tabindex', 0).attr('role', 'button')
        .on('click', d => { d3.event.stopPropagation(); if (Date.now() < graph.suppressClicksUntil) return; graph.selectedLinkId = graph.selectedLinkId === d.id ? null : d.id; graph.scheduleRender(); })
        .on('keydown', d => { if (d3.event.key !== 'Enter' && d3.event.key !== ' ') return; d3.event.preventDefault(); graph.selectedLinkId = d.id; graph.scheduleRender(); })
        // A link is picked out only away from the roadmap it was shown for: its wide edge starts under the pointer.
        .on('mousemove', d => {
          if (graph.isCoarse || graph.pointerResting(d3.event)) return;
          const next = graph.overHovered(d3.event) ? null : d.id;
          if (next !== graph.hoveredLinkId) { graph.hoveredLinkId = next; graph.scheduleRender(); }
        })
        .on('mouseleave', () => { if (!graph.isCoarse) { graph.hoveredLinkId = null; if (!graph.keepsHover(d3.event)) graph.hoveredId = null; graph.scheduleRender(); } })
        .merge(hits).attr('d', d => d.hit).attr('data-source', d => d.source).attr('data-target', d => d.target)
        .attr('aria-label', d => `${d.reference ? 'Related plans' : d.level === 'artefact' ? 'Needed by the paper' : 'Prerequisite'}: ${name(d.source)} to ${name(d.target)}`);
      this.renderLinkCard(links.find(link => link.id === chosen), name, k);
    }

    // The card of a selected link: what kind of link it is, and its two ends,
    // prerequisite first; either name travels to its end.
    renderLinkCard(link, name, k) {
      const card = this.overlay.selectAll('g.tau-link-card').data(link ? [link] : [], d => d.id);
      card.exit().remove();
      if (!link) return;
      const g = card.enter().append('g').attr('class', 'tau-link-card').merge(card);
      g.selectAll('*').remove();
      const font = this.isCoarse ? 13 : 12, pad = 8, line = font + 7;
      const caption = link.reference ? 'Related plans' : link.level === 'artefact'
        ? 'Needed by the paper · ' + (link.whole ? 'the whole roadmap' : link.count ? `${link.count} layer${link.count === 1 ? '' : 's'}` : 'the roadmap it builds on most')
        : `${link.level === 'star' ? 'Layer' : 'Roadmap'} prerequisite` + (link.count ? ` · ${link.count} layer link${link.count === 1 ? '' : 's'}` : '');
      const ends = [[link.source, link.reference ? '' : ''], [link.target, link.reference ? '↔ ' : '→ ']];
      const box = g.append('rect').attr('class', 'tau-link-card-box').attr('rx', 4);
      g.append('text').attr('class', 'tau-link-card-caption').attr('x', pad).attr('y', pad + 9).attr('font-size', 9).text(caption);
      const graph = this;
      let width = caption.length * 6.2;
      ends.forEach(([id, prefix], index) => {
        const label = prefix + name(id), y = pad + 14 + (index + 1) * line - 6;
        const end = g.append('g').attr('data-end', index ? 'target' : 'source').attr('data-node-id', id)
          .on('click', () => { d3.event.stopPropagation(); graph.selectedLinkId = null; const node = graph.universe.byId.get(id); if (node) graph.options.onSelect?.(node); });
        const hit = end.append('rect').attr('x', pad - 3).attr('y', y - font).attr('height', line);
        const text = end.append('text').attr('x', pad).attr('y', y).attr('font-size', font).text(label);
        let measured = label.length * font * .6;
        try { measured = text.node().getComputedTextLength(); } catch (_) { /* detached */ }
        hit.attr('width', measured + 6);
        width = Math.max(width, measured);
      });
      const w = Math.ceil(width + pad * 2), h = pad * 2 + 14 + 2 * line - 4;
      box.attr('width', w).attr('height', h);
      // Beside the middle of the link, kept wholly on the chart.
      const t = this.transform, sx = link.mid.x * t.k + t.x, sy = link.mid.y * t.k + t.y;
      const x = Math.max(4, Math.min(this.width - w - 4, sx + 12)), y = Math.max(4, Math.min(this.height - h - 4, sy + 12));
      g.attr('transform', `translate(${x},${y})`);
    }

    // Whether the pointer, leaving for event.relatedTarget, is still on the hovered object or on one of its links. A
    // hovered roadmap's links are drawn above it, and their wide edges start at its centre: far out, where the roadmap is
    // a point, they cover it at once, and without this the hover would end, the links go, and the hover begin again.
    keepsHover(event) {
      const to = event && event.relatedTarget, id = this.hoveredId;
      if (!id || !to || !to.closest) return false;
      if (to.classList && to.classList.contains('tau-link-hit')) return to.getAttribute('data-source') === id || to.getAttribute('data-target') === id;
      const owner = to.closest('[data-node-id]');
      return !!owner && owner.getAttribute('data-node-id') === id;
    }

    // Whether the pointer is over the hovered object, at least ten pixels round its centre.
    overHovered(event) {
      const node = this.hoveredId && this.universe ? this.universe.byId.get(this.hoveredId) : null;
      if (!node || !event || !Number.isFinite(node.x)) return false;
      const box = this.svg.node().getBoundingClientRect(), t = this.transform;
      return Math.hypot(event.clientX - (box.left + node.x * t.k + t.x), event.clientY - (box.top + node.y * t.k + t.y)) <= Math.max((node.r || 0) * t.k, 10) + 2;
    }

    // True while the pointer has not moved since the camera last travelled.
    pointerResting(event) {
      const at = this.pointerAtTravel;
      return !!(at && event && Math.abs(event.clientX - at[0]) < 1.5 && Math.abs(event.clientY - at[1]) < 1.5);
    }

    bindInteractions(selection) {
      const graph = this;
      selection.on('click', d => { d3.event.stopPropagation(); if (Date.now() < graph.suppressClicksUntil) return; graph.options.onSelect?.(d); })
        .on('mouseenter', d => { if (!graph.isCoarse && !graph.pointerResting(d3.event)) { graph.hoveredId = d.id; graph.scheduleRender(); } })
        .on('mouseleave', () => { if (!graph.isCoarse && !graph.keepsHover(d3.event)) { graph.hoveredId = null; graph.scheduleRender(); } })
        .on('focus', d => { graph.hoveredId = d.id; graph.scheduleRender(); }).on('blur', () => { graph.hoveredId = null; graph.scheduleRender(); })
        .on('keydown', d => { if (d3.event.key !== 'Enter' && d3.event.key !== ' ') return; d3.event.preventDefault(); d3.event.stopPropagation(); graph.options.onSelect?.(d); });
    }

    // ----- selection ----------------------------------------------------------
    select(id, fromBackground) {
      this.selectedId = this.universe && this.universe.byId.has(id) ? id : null;
      // A Mathlib item is on the disk: selecting one (from the address, say) opens it.
      if (this.selectedId && this.universe.byId.get(this.selectedId).level === 'mathlib' && this.diskState !== 'open') this.setDisk('open', false);
      this.selectedLinkId = null;
      this.scheduleRender();
      if (fromBackground && this.options.onClear) this.options.onClear();
      return this;
    }

    // ----- camera ---------------------------------------------------------------
    footprint(id) {
      const node = this.universe && this.universe.byId.get(id);
      if (!node) return null;
      if (node.level === 'field') return { x: node.left, y: node.top, w: node.w, h: node.h };
      if (node.level === 'galaxy') return { x: node.x - node.rx, y: node.y - node.ry, w: node.rx * 2, h: node.ry * 2 };
      if (node.level === 'constellation') { const r = Math.max(node.r * 1.45, 26); return { x: node.x - r, y: node.y - r * 1.15, w: r * 2, h: r * 2.15 }; }
      if (node.level === 'star') { const r = Math.max(node.room * 1.35, node.r * 9); return { x: node.x - r, y: node.y - r, w: r * 2, h: r * 2 }; }
      if (node.level === 'planet') return this.footprint(node.starId);
      if (node.level === 'artefact') return this.footprint(node.constellationId);
      return null;
    }

    transformFor(rect) {
      // Portrait phones keep the zoom controls clear; a short landscape chart
      // needs its height more than that margin and gets a smaller reserve.
      const reserve = this.width < 600 ? 56 : this.height < 400 ? 24 : 0, usable = this.height - reserve;
      const scale = Math.max(.015, Math.min(900, (this.width - 36) / rect.w, (usable - 36) / rect.h));
      return d3.zoomIdentity.translate(this.width / 2 - (rect.x + rect.w / 2) * scale, usable / 2 - (rect.y + rect.h / 2) * scale).scale(scale);
    }

    travel(transform, animate) {
      this.svg.interrupt();
      this.pointerAtTravel = this.pointer ? this.pointer.slice() : null;
      if (!this.isCoarse) this.hoveredId = null;
      if (!animate || (matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) { this.svg.call(this.zoom.transform, transform); return this; }
      this.busy = true;
      this.svg.transition().duration(240).ease(d3.easeCubicOut).call(this.zoom.transform, transform)
        .on('end.travel', () => { this.busy = false; this.scheduleFocus(); }).on('interrupt.travel', () => { this.busy = false; });
      return this;
    }

    // Headings and names live in screen pixels, so the room kept for them
    // above a frame is converted from pixels at the scale the frame will get.
    transformWithHeadroom(rect, topPx, bottomPx) {
      const first = this.transformFor(rect).k;
      return this.transformFor({ x: rect.x, y: rect.y - topPx / first, w: rect.w, h: rect.h + (topPx + bottomPx) / first });
    }
    zoomTo(id, animate) {
      const rect = this.footprint(id), node = this.universe && this.universe.byId.get(id);
      if (!rect) return this;
      const headroom = node && (node.level === 'galaxy' || node.level === 'field') ? 44 : node && node.level === 'constellation' ? 36 : 24;
      return this.travel(this.transformWithHeadroom(rect, headroom, 8), animate !== false);
    }
    // The whole universe at the scale a desktop chart gives it. A chart much
    // smaller than that (a phone) keeps the scale instead of shrinking the map,
    // with Mathlib a third of the way across, and the reader pans to see the rest.
    overviewTransform() {
      if (this.universe.layout === 'sectors' && this.universe.core) {
        // At least the scale a desktop window gives it, so a phone shows part of the map as a desktop does, to pan.
        const core = this.universe.core, reserve = this.width < 600 ? 56 : this.height < 400 ? 24 : 0, across = radius => (radius - 48) / (2 * this.universe.overviewRadius);
        const k = Math.max(.02, across(Math.min(this.width, this.height - reserve)), across(Math.min(REFERENCE_CHART.width, REFERENCE_CHART.height)));
        return d3.zoomIdentity.translate(this.width / 2 - core.x * k, (this.height - reserve) / 2 - core.y * k).scale(k);
      }
      const b = this.universe.bounds, rect = { x: b.x - 40, y: b.y, w: b.w + 80, h: b.h };
      const fit = this.transformWithHeadroom(rect, 48, 12);
      const core = this.universe.core;
      if (!core) return fit;
      const reference = (width, height) => {
        const first = Math.min((width - 36) / rect.w, (height - 36) / rect.h);
        return Math.min((width - 36) / rect.w, (height - 36) / (rect.h + 60 / first));
      };
      const k = reference(REFERENCE_CHART.width, REFERENCE_CHART.height);
      // A chart that shows everything at two thirds of that scale or more
      // (a laptop) still shows everything.
      if (fit.k >= k * .65) return fit;
      const reserve = this.width < 600 ? 56 : this.height < 400 ? 24 : 0;
      return d3.zoomIdentity.translate(this.width * .35 - core.x * k, (this.height - reserve) / 2 - core.y * k).scale(k);
    }
    fitAll(animate) { if (!this.universe) return this; return this.travel(this.overviewTransform(), animate !== false); }
    fit(animate) { return this.lastFocus && this.lastFocus.id ? this.zoomTo(this.lastFocus.id, animate) : this.fitAll(animate); }
    // Whether the camera shows (about) the whole universe: its scale is at most
    // the given multiple of the scale that fits everything.
    atOverview(factor) { if (!this.universe) return true; return this.transform.k <= this.overviewTransform().k * (factor || 1.25); }
    zoomIn() { this.svg.transition().duration(140).call(this.zoom.scaleBy, 2.4); return this; }
    zoomOut() { this.svg.transition().duration(140).call(this.zoom.scaleBy, 1 / 2.4); return this; }
    captureCamera() { return { x: this.transform.x, y: this.transform.y, k: this.transform.k, width: this.width, height: this.height }; }
    restoreCamera(camera) {
      if (!camera || ![camera.x, camera.y, camera.k].every(Number.isFinite) || camera.k <= 0) return this;
      const x = camera.x + (this.width - (camera.width || this.width)) / 2, y = camera.y + (this.height - (camera.height || this.height)) / 2;
      this.svg.interrupt(); this.svg.call(this.zoom.transform, d3.zoomIdentity.translate(x, y).scale(camera.k));
      return this;
    }

    // The camera decides what the reader is looking at: the galaxy that fills
    // the view, the constellation under its centre, the star whose system is
    // in front of them. This drives the address bar and breadcrumbs without
    // ever relaying out the scene.
    // How far a point is from a galaxy, in units of its size: within 1 inside it. A sector is measured across its
    // wedge and along it; any other galaxy by its ellipse.
    reachOf(g, x, y) {
      if (!g.sector) return Math.hypot((x - g.x) / g.rx, (y - g.y) / g.ry);
      const off = Math.atan2(y, x) - (g.a0 + g.a1) / 2, across = Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) / Math.max(1e-6, (g.a1 - g.a0) / 2);
      return Math.max(across, Math.abs(Math.hypot(x, y) - (g.r0 + g.r1) / 2) / Math.max(1, (g.r1 - g.r0) / 2));
    }

    focus() {
      if (!this.universe) return { level: 'all', id: null };
      const k = this.transform.k, cx = (this.width / 2 - this.transform.x) / k, cy = (this.height / 2 - this.transform.y) / k;
      if (this.diskState === 'open' && this.universe.disk && Math.hypot(cx, cy) <= this.universe.disk.outer) return { level: 'all', id: null };
      // An object is "in focus" when the camera is at least a good fraction of
      // the scale that fits it and its centre is near the middle of the view.
      const fitScale = id => this.transformFor(this.footprint(id)).k;
      let galaxy = null;
      if (this.universe.layout === 'sectors') {
        let nearest = Infinity;
        this.universe.galaxies.forEach(g => { const reach = this.reachOf(g, cx, cy); if (reach <= 1.2 && reach < nearest && k >= fitScale(g.id) * .6) { nearest = reach; galaxy = g; } });
      } else this.universe.galaxies.forEach(g => { if (((cx - g.x) / (g.rx * 1.2)) ** 2 + ((cy - g.y) / (g.ry * 1.2)) ** 2 <= 1 && k >= fitScale(g.id) * .6) galaxy = g; });
      // Between galaxies, a camera that is still well inside the universe
      // belongs to the nearest galaxy; only a wide view, or empty space far
      // from every galaxy, is the whole universe.
      if (!galaxy && !this.atOverview(2.2)) {
        let nearest = Infinity;
        this.universe.galaxies.forEach(g => { const e = this.reachOf(g, cx, cy); if (e < nearest && e <= 2.5 && k >= fitScale(g.id) * .6) { nearest = e; galaxy = g; } });
      }
      if (!galaxy) return { level: 'all', id: null };
      let constellation = null, best = Infinity;
      galaxy.constellationIds.forEach(id => { const c = this.universe.byId.get(id); const d = Math.hypot(cx - c.x, cy - c.y); if (d < c.r * 1.8 + 30 / k && d < best && k >= fitScale(id) * .5) { best = d; constellation = c; } });
      if (!constellation) return { level: 'galaxy', id: galaxy.id };
      let star = null; best = Infinity;
      constellation.starIds.forEach(id => { const s = this.universe.byId.get(id); const d = Math.hypot(cx - s.x, cy - s.y); if (d < s.room * 1.6 + 12 / k && d < best && k >= fitScale(id) * .5) { best = d; star = s; } });
      if (star) return { level: 'star', id: star.id, constellationId: constellation.id, galaxyId: galaxy.id };
      return { level: 'constellation', id: constellation.id, galaxyId: galaxy.id };
    }

    scheduleFocus() {
      clearTimeout(this.focusTimer);
      this.focusTimer = setTimeout(() => {
        if (this.destroyed || this.busy) return;
        const focus = this.focus();
        if (this.lastFocus && this.lastFocus.level === focus.level && this.lastFocus.id === focus.id) return;
        this.lastFocus = focus;
        this.options.onFocus?.(focus);
      }, 90);
    }

    // ----- export and diagnostics ------------------------------------------------
    exportSVG() {
      const source = this.svg.node(), clone = source.cloneNode(true);
      const box = { x: -this.transform.x / this.transform.k, y: -this.transform.y / this.transform.k, w: this.width / this.transform.k, h: this.height / this.transform.k };
      const presentation = ['color', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
        'opacity', 'font-family', 'font-size', 'font-style', 'font-weight', 'font-variant', 'letter-spacing', 'word-spacing', 'text-anchor', 'dominant-baseline', 'text-decoration', 'paint-order', 'vector-effect', 'visibility', 'display', 'rx', 'ry'];
      const originals = [source, ...source.querySelectorAll('*')], copies = [clone, ...clone.querySelectorAll('*')];
      originals.forEach((element, index) => {
        const copy = copies[index], tag = element.tagName.toLowerCase();
        if (['style', 'title', 'desc', 'defs'].includes(tag)) return;
        const computed = window.getComputedStyle(element);
        copy.removeAttribute('style');
        presentation.forEach(property => {
          let value = computed.getPropertyValue(property);
          if (!value || value === 'auto' || value === 'normal' && ['letter-spacing', 'word-spacing'].includes(property)) return;
          if (/url\(/.test(value)) { const fragment = value.match(/#([^"')]+)["']?\)/); if (!fragment || !source.querySelector('[id="' + fragment[1].replace(/"/g, '') + '"]')) return; value = 'url(#' + fragment[1] + ')'; }
          copy.style.setProperty(property, value, 'important');
        });
        copy.removeAttribute('tabindex'); if (copy.getAttribute('role') === 'button') copy.removeAttribute('role'); copy.removeAttribute('aria-pressed');
      });
      clone.querySelectorAll('style').forEach(style => style.remove());
      clone.querySelectorAll('title').forEach(title => { title.textContent = title.textContent.replace(/\nClick to .*$/, ''); });
      const backdrop = document.createElementNS(SVG_NS, 'rect');
      backdrop.setAttribute('class', 'tau-export-background'); backdrop.setAttribute('x', box.x); backdrop.setAttribute('y', box.y); backdrop.setAttribute('width', box.w); backdrop.setAttribute('height', box.h); backdrop.setAttribute('fill', BACKGROUND);
      clone.insertBefore(backdrop, clone.querySelector('.tau-viewport'));
      clone.setAttribute('xmlns', SVG_NS); clone.setAttribute('width', Math.ceil(this.width)); clone.setAttribute('height', Math.ceil(this.height));
      clone.setAttribute('viewBox', [box.x, box.y, box.w, box.h].join(' ')); clone.setAttribute('role', 'img'); clone.setAttribute('aria-label', 'Tau Ceti mathematics universe');
      clone.style.setProperty('background-color', BACKGROUND);
      clone.querySelector('.tau-viewport').removeAttribute('transform');
      return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
    }

    debugState() {
      const universe = this.universe || { galaxies: [], constellations: [], stars: [], planets: [], routes: [] }, visible = this.visible || { galaxies: [], constellations: [], stars: [], planets: [], labels: [] };
      return {
        layout: 'universe', width: this.width, height: this.height, transform: { x: this.transform.x, y: this.transform.y, k: this.transform.k },
        selectedId: this.selectedId, hoveredId: this.hoveredId, focus: this.focus(), lastFocus: this.lastFocus, busy: this.busy, clicksSuppressed: Date.now() < this.suppressClicksUntil,
        counts: { galaxies: universe.galaxies.length, constellations: universe.constellations.length, stars: universe.stars.length, planets: universe.planets.length, routes: universe.routes.length, strongRoutes: universe.routes.filter(r => r.strong).length },
        visible: { galaxies: visible.galaxies.length, constellations: visible.constellations.length, resolved: visible.constellations.filter(c => c.resolved).length, stars: visible.stars.length, planets: visible.planets.length, artefacts: (visible.artefacts || []).length, labels: visible.labels.filter(l => l.shown).length },
        artefacts: (universe.artefacts || []).map(a => ({ id: a.id, constellationId: a.constellationId, x: a.x, y: a.y, progress: progressValue(a.progress), unlocked: !!a.unlocked })),
        rendered: this.container.querySelectorAll('.tau-layer-constellation g, .tau-layer-star g, .tau-layer-planet g, .tau-layer-label g').length,
        fields: (universe.fields || []).map(f => ({ id: f.id, label: f.label, galaxyIds: f.galaxyIds, labelVisible: !!f.labelVisible })),
        galaxies: universe.galaxies.map(g => ({ id: g.id, label: g.label, fieldId: g.fieldId || null, x: g.x, y: g.y, rx: g.rx, ry: g.ry, count: g.count, headingVisible: !!g.headingVisible })),
        constellations: universe.constellations.map(c => ({ id: c.id, galaxyId: c.galaxyId, x: c.x, y: c.y, r: c.r, stars: c.starIds.length, resolved: !!c.resolved, nameVisible: !!c.nameVisible, progress: progressValue(c.progress), hasProgress: hasProgress(c), accent: accentOf(c), unmapped: !!c.unmapped })),
        stars: universe.stars.map(s => ({ id: s.id, constellationId: s.constellationId, x: s.x, y: s.y, r: s.r, room: s.room, planets: s.planetIds.length, rank: s.rank, dependencyOrderValid: s.dependencyOrderValid, progress: progressValue(s.progress), accent: accentOf(s) })),
        routes: universe.routes.map(({ source, target, dependencies, witnesses, strong }) => ({ source, target, dependencies, witnesses, strong: !!strong }))
      };
    }

    destroy() {
      this.destroyed = true; clearTimeout(this.focusTimer);
      if (this.observer) this.observer.disconnect(); else window.removeEventListener('resize', this.resize);
      if (this.overlayWatch) this.overlayWatch.disconnect();
      this.svg.interrupt().on('.zoom', null).remove();
    }

    static progressColor(value) { return progressColor(value); }
  }
  window.TauGraph = TauGraph;
})();
