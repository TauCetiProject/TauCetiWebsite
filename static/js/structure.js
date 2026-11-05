document.addEventListener("DOMContentLoaded", function () {
  "use strict";
  var TC = window.TC;
  var data, areaOf = {}, areaLabels = {};

  // The page's state lives in its address, so a filtered view or an area's page can be linked to.
  var params = new URLSearchParams(location.search);
  var AREA = params.get("area") || "";
  var state = {
    q: params.get("q") || "",
    show: params.get("show") || "all",
    sort: params.get("sort") || "activity",
    group: params.get("group") || "topic",
  };

  function count(r, s) { return r.states.filter(function (x) { return x === s; }).length; }
  function code(r) { return r.arxiv || "none"; }

  /* ---------- what each filter means (as TauCetiTools' roadmap_progress.py defines them) ---------- */
  function hasReport(r) { return !!r.status; }
  function readmeChanged(r) { return !!r.assessment && r.assessment.reason === "ok" && r.assessment.readme_changed === true; }
  function prsDue(r) {
    return !r.completed && !!r.status && !!r.activity && r.activity.since_report !== null && r.activity.since_report >= data.update_due_prs;
  }
  function due(r) { return (!!r.status && !r.status.inherited && prsDue(r)) || readmeChanged(r); }
  var SHOW = {
    all: function () { return true; },
    active: function (r) { return !r.completed; },
    completed: function (r) { return r.completed; },
    reported: hasReport,
    unreported: function (r) { return !hasReport(r); },
    unassessed: function (r) { return r.states.indexOf("unassessed") >= 0; },
    due: due,
    readme: readmeChanged,
  };
  function act(r, k) { return r.activity ? r.activity[k] || 0 : 0; }
  var SORT = {
    activity: function (a, b) { return (act(b, "recent") - act(a, "recent")) || (act(b, "total") - act(a, "total")) || a.name.localeCompare(b.name); },
    done: function (a, b) { return ((b.completed ? 1e6 : 0) + count(b, "done")) - ((a.completed ? 1e6 : 0) + count(a, "done")) || a.name.localeCompare(b.name); },
    due: function (a, b) {
      function since(r) { return r.activity && r.status && r.activity.since_report !== null ? r.activity.since_report : -1; }
      return (due(b) - due(a)) || (since(b) - since(a)) || a.name.localeCompare(b.name);
    },
    name: function (a, b) { return a.name.localeCompare(b.name); },
  };
  function matches(r, q) {
    if (!q) return true;
    var hay = [r.name, r.title, r.topic, r.arxiv, r.parent || "", (r.layers || []).join(" "),
               r.status ? r.status.glance : "", r.status ? (r.status.frontier || []).map(function (f) { return f.name + " " + f.text; }).join(" ") : ""];
    return hay.join(" ").toLowerCase().indexOf(q) >= 0;
  }

  /* ---------- one roadmap ---------- */
  function pageHref(id) { return "roadmap.html?id=" + encodeURIComponent(id); }

  function segments(r) {
    var segs = TC.el("div", { class: "segs", "aria-hidden": "true" });
    if (r.completed && !r.states.length) {
      segs.append(TC.el("div", { class: "seg complete", title: "declared complete" }));
      return segs;
    }
    r.states.forEach(function (s, i) {
      segs.append(TC.el("div", { class: "seg " + (r.completed ? "complete" : s), title: (r.layer_ids[i] || "") + ": " + (r.completed ? "declared complete" : s) }));
    });
    return segs;
  }

  // Report prose carries Markdown code spans; render those as <code> and keep the rest as text.
  function richText(str) {
    var p = TC.el("span");
    String(str || "").split(/(`[^`]+`)/).forEach(function (part) {
      if (/^`[^`]+`$/.test(part)) p.append(TC.el("code", { text: part.slice(1, -1) }));
      else p.append(document.createTextNode(part.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")));
    });
    return p;
  }

  function row(r, child) {
    var done = count(r, "done"), n = r.states.length;
    // A link inside <summary> navigates without toggling; the rest of the summary still toggles.
    var name = TC.el("div", { class: "rm-name" }, [TC.el("a", { href: pageHref(r.id), text: r.name })]);
    if (r.completed) name.append(TC.el("span", { class: "badge", text: "complete" }));
    if (readmeChanged(r)) name.append(TC.el("span", { class: "badge readme", text: "README changed" }));
    name.append(TC.el("small", { text: r.title || "" }));
    var meta = TC.el("div", { class: "rm-meta" }, [
      document.createTextNode(n ? done + "/" + n + " layers" : r.completed ? "archived" : "no layers"),
      TC.el("br"),
      // Sub-roadmaps carry their umbrella's label, so their merges are counted on the umbrella.
      document.createTextNode(r.activity ? TC.fmt(r.activity.total || 0) + " PRs" + (due(r) ? " · update due" : "") : r.parent ? "PRs under " + r.parent : ""),
    ]);
    var body = TC.el("div", { class: "rm-body" });
    var st = r.status || {};
    if (st.glance) body.append(TC.el("p", null, [richText(st.glance)]));
    if (st.frontier && st.frontier.length) {
      body.append(TC.el("p", { class: "small muted", text: "Next milestones" }));
      body.append(TC.el("ul", null, st.frontier.slice(0, 4).map(function (f) {
        return TC.el("li", null, [TC.el("b", null, [richText(f.name)]), document.createTextNode(" "), richText((f.text || "").replace(/^—\s*/, "— "))]);
      })));
    }
    if (n) {
      var rem = (r.assessment || {}).remaining || {};
      body.append(TC.el("ul", { class: "layers" }, r.layers.map(function (l, i) {
        var s = r.completed ? "done" : r.states[i];
        var li = TC.el("li", null, [TC.el("span", { class: "state " + s, text: s }), document.createTextNode(l)]);
        var note = rem[r.layer_ids[i]];
        if (note && s !== "done") li.append(TC.el("div", { class: "small muted", style: "margin-left:4.6rem" }, [document.createTextNode("Remaining: "), richText(note)]));
        return li;
      })));
    }
    var dir = r.readme.replace(/\/README\.md$/, "");
    var links = TC.el("p", { class: "small" }, [
      TC.el("a", { href: pageHref(r.id), text: "Roadmap page" }), document.createTextNode(" · "),
      TC.el("a", { href: blob() + r.readme, text: "README" }), document.createTextNode(" · "),
      TC.el("a", { href: blob() + dir + "/STATUS.md", text: "latest report" }), document.createTextNode(" · "),
      TC.el("a", { href: "https://github.com/TauCetiProject/TauCeti/pulls?q=" + encodeURIComponent("label:roadmap/" + (r.parent || r.name)), text: "pull requests" }),
    ]);
    if (st.ts) links.append(TC.el("span", { class: "muted", text: " · report " + TC.ago(st.ts) }));
    (r.links || []).forEach(function (l) {
      if (l && l.url) { links.append(document.createTextNode(" · ")); links.append(TC.el("a", { href: l.url, text: l.label || "more" })); }
    });
    body.append(links);
    return TC.el("details", { class: "rm" + (child ? " child" : ""), id: "rm-" + r.name }, [
      TC.el("summary", null, [name, segments(r), meta]), body,
    ]);
  }

  // At the roadmap repository's commit the data describes: a roadmap archived since has moved on main.
  function blob() { return "https://github.com/TauCetiProject/TauCetiRoadmap/blob/" + (data.roadmap_head || "main") + "/"; }

  /* ---------- the board ---------- */
  function areaHref(c) { return "structure.html?area=" + encodeURIComponent(c); }

  // The roadmaps (with their sub-roadmaps) a filter keeps, in the chosen order: [[roadmap, [kept children]]].
  function selection(rows, kids) {
    var q = state.q.trim().toLowerCase(), show = SHOW[state.show] || SHOW.all, sort = SORT[state.sort] || SORT.activity;
    var out = [];
    rows.slice().sort(sort).forEach(function (r) {
      var ch = (kids[r.id] || []).slice().sort(sort);
      var mine = show(r) && matches(r, q);
      var keptKids = ch.filter(function (k) { return show(k) && (mine || matches(k, q)); });
      if (mine || keptKids.length) out.push([r, mine ? ch.filter(function (k) { return show(k); }) : keptKids]);
    });
    return out;
  }

  function rowsOf(sel) {
    var els = [];
    sel.forEach(function (pair) { els.push(row(pair[0], false)); pair[1].forEach(function (k) { els.push(row(k, true)); }); });
    return els;
  }

  function stats(sel) {
    var layers = 0, done = 0, n = 0;
    sel.forEach(function (pair) {
      n++;
      [pair[0]].concat(pair[1]).forEach(function (r) { layers += r.states.length; done += r.completed ? r.states.length : count(r, "done"); });
    });
    return n + (n === 1 ? " roadmap" : " roadmaps") + (layers ? " · " + done + "/" + layers + " layers done" : "");
  }

  function panel(title, c, sel, linked) {
    var head = TC.el("div", { class: "topic-head" }, [
      TC.el("h3", null, [linked ? TC.el("a", { href: areaHref(c), text: title }) : document.createTextNode(title)]),
      TC.el("span", { class: "muted", text: (c !== "none" ? c + " · " : "") + stats(sel) }),
    ]);
    var section = TC.el("section", { class: "topic-group", id: "topic-" + c }, [head]);
    // On its own page, an area the Atlas divides is shown in its subareas, in the Atlas's order.
    var subs = AREA ? subareas(c, sel) : null;
    if (subs) {
      subs.forEach(function (sub) {
        section.append(TC.el("h4", { class: "subarea-head" }, [document.createTextNode(sub.label + " "), TC.el("span", { class: "muted", text: "· " + stats(sub.sel) })]));
        section.append(TC.el("div", { class: "rms" }, rowsOf(sub.sel)));
      });
    } else {
      section.append(TC.el("div", { class: "rms" }, rowsOf(sel)));
    }
    return section;
  }

  function subareas(c, sel) {
    var order = (areaLabels.fields || {})[c];
    if (!order) return null;
    var by = {};
    sel.forEach(function (pair) {
      var a = areaOf[pair[0].id] || order[order.length - 1];
      (by[a] = by[a] || []).push(pair);
    });
    var out = order.filter(function (a) { return by[a]; }).map(function (a) { return { label: areaLabels.names[a] || a, sel: by[a] }; });
    return out.length > 1 ? out : null;
  }

  function areaNav(top) {
    var nav = TC.$("#area-nav");
    nav.replaceChildren(TC.el("a", { href: "structure.html", text: "All", "aria-current": AREA ? null : "page" }));
    data.topics.forEach(function (t) {
      var c = (top.find(function (r) { return r.topic === t; }) || {}).arxiv;
      if (!c) return;
      var n = top.filter(function (r) { return r.topic === t; }).length;
      nav.append(TC.el("a", { href: areaHref(c), text: t + " " + n, "aria-current": AREA === c ? "page" : null }));
    });
  }

  function render() {
    var rows = data.rows.filter(function (r) { return !r.retired; });
    var kids = {};
    rows.forEach(function (r) { if (r.parent_id) (kids[r.parent_id] = kids[r.parent_id] || []).push(r); });
    var top = rows.filter(function (r) { return !r.parent_id; });
    var board = TC.$("#board");
    board.replaceChildren();
    if (AREA) {
      var mine = top.filter(function (r) { return code(r) === AREA; });
      if (!mine.length) { board.append(TC.el("p", { class: "error", text: "No roadmaps are in " + AREA + "." })); return; }
      var sel = selection(mine, kids);
      if (sel.length) board.append(panel(mine[0].topic, AREA, sel, false));
    } else if (state.group === "none") {
      var all = selection(top, kids);
      if (all.length) board.append(panel("All roadmaps", "none", all, false));
    } else {
      data.topics.forEach(function (t) {
        var inT = top.filter(function (r) { return r.topic === t; });
        if (!inT.length) return;
        var sel = selection(inT, kids);
        if (sel.length) board.append(panel(t, code(inT[0]), sel, true));
      });
    }
    if (!board.children.length) board.append(TC.el("p", { class: "muted", text: "No roadmap matches this filter." }));
  }

  function save() {
    var p = new URLSearchParams();
    if (AREA) p.set("area", AREA);
    if (state.q) p.set("q", state.q);
    if (state.show !== "all") p.set("show", state.show);
    if (state.sort !== "activity") p.set("sort", state.sort);
    if (state.group !== "topic" && !AREA) p.set("group", state.group);
    history.replaceState(null, "", location.pathname + (p.toString() ? "?" + p : "") + location.hash);
  }

  function goToHash() {
    var t = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (!t) return;
    if (t.tagName === "DETAILS") t.open = true;
    var go = function () { t.scrollIntoView({ block: "start" }); };
    requestAnimationFrame(go);
    if (document.fonts) document.fonts.ready.then(go);  // the display face shifts layout when it arrives
  }

  // The Atlas's areas (atlas/tauceti/areas.json, written by its build). Without them the board still
  // groups by arXiv category; the areas only divide the largest categories further.
  var areas = fetch("atlas/tauceti/areas.json").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });

  Promise.all([TC.live("progress.json"), areas]).then(function (res) {
    data = res[0];
    var a = res[1];
    areaLabels = { fields: {}, names: {} };
    if (a) {
      a.areas.forEach(function (g) {
        areaLabels.names[g.id] = g.label;
        g.roadmaps.forEach(function (id) { areaOf[id] = g.id; });
      });
      a.fields.forEach(function (f) { areaLabels.fields[f.id] = f.areas; });
    }
    var top = data.rows.filter(function (r) { return !r.retired && !r.parent_id; });
    if (AREA) {
      var first = top.find(function (r) { return code(r) === AREA; });
      var name = first ? first.topic : AREA;
      document.title = name + " — Roadmaps — Tau Ceti";
      TC.$$("[data-overview], [data-overview-control]").forEach(function (e) { e.hidden = true; });
      TC.$("[data-area-head]").hidden = false;
      TC.$("#area-title").textContent = name;
      var subs = (areaLabels.fields[AREA] || []).length;
      TC.$("#area-lede").textContent = AREA + " on arXiv. " + top.filter(function (r) { return code(r) === AREA; }).length +
        " roadmaps" + (subs > 1 ? ", in the areas the Atlas divides it into." : ".");
    }
    TC.$("#q").value = state.q;
    TC.$("#show").value = state.show;
    TC.$("#sort").value = state.sort;
    TC.$("#group").value = state.group;
    TC.$("#board-meta").textContent = "Roadmaps as of TauCetiRoadmap " + data.roadmap_head.slice(0, 7) + "; activity through " + TC.dayYear(data.cutoff) + ".";
    areaNav(top);
    render();
    [["#q", "q"], ["#show", "show"], ["#sort", "sort"], ["#group", "group"]].forEach(function (c) {
      TC.$(c[0]).addEventListener("input", function (e) { state[c[1]] = e.target.value; save(); render(); });
    });
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    goToHash();
    window.addEventListener("hashchange", goToHash);
  }).catch(function (e) { TC.fail("#board", e); });
});
