/* One roadmap's page, roadmap.html?id=<progress.json row id>: its report, layers, merged pull requests
   and the opening of its README. */
document.addEventListener("DOMContentLoaded", function () {
  "use strict";
  var TC = window.TC;
  var ID = new URLSearchParams(location.search).get("id") || "";
  var PULLS = "https://github.com/TauCetiProject/TauCeti/pulls?q=";
  var PULL = "https://github.com/TauCetiProject/TauCeti/pull/";
  var RAW = "https://raw.githubusercontent.com/TauCetiProject/TauCetiRoadmap/";
  var README_CAP = 6000;

  function pageHref(id) { return "roadmap.html?id=" + encodeURIComponent(id); }
  function areaHref(c) { return "structure.html?area=" + encodeURIComponent(c); }
  function count(r, s) { return r.states.filter(function (x) { return x === s; }).length; }
  function dot() { return document.createTextNode(" · "); }

  /* ---------- as structure.js defines them ---------- */
  function readmeChanged(r) { return !!r.assessment && r.assessment.reason === "ok" && r.assessment.readme_changed === true; }
  function prsDue(r, data) {
    return !r.completed && !!r.status && !!r.activity && r.activity.since_report !== null && r.activity.since_report >= data.update_due_prs;
  }
  function due(r, data) { return (!!r.status && !r.status.inherited && prsDue(r, data)) || readmeChanged(r); }

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

  function missing(msg) {
    TC.$("#rm-title").textContent = "Roadmap not found";
    TC.$("#rm-missing").replaceChildren(TC.el("p", null, [
      document.createTextNode(msg + " "), TC.el("a", { href: "structure.html", text: "See every roadmap" }), document.createTextNode("."),
    ]));
  }

  function tile(value, key, detail) {
    var v = TC.el("div", { class: "v" });
    if (typeof value === "string") v.textContent = value; else { v.classList.add("word"); v.append(value); }
    return TC.el("div", { class: "tile" }, [v, TC.el("div", { class: "k", text: key }), detail != null ? TC.el("div", { class: "d" }, [detail]) : null]);
  }
  function under(umbrella) {
    return TC.el("span", null, [document.createTextNode("under "), TC.el("a", { href: pageHref(umbrella.id), text: umbrella.name })]);
  }

  /* ---------- the README's opening ---------- */
  var LAYER_HEADING = /^#+\s+(Layer|Lane|Part|Stage)\b/i;

  var REF_DEF = /^ {0,3}\[([^\]]+)\]:\s*<?([^\s>]+)>?.*$/;

  // Text before the first layer heading, cut at a blank line outside a code fence once past the cap.
  // TauMarkdown reads only inline links, so reference links ([text][ref], defined anywhere in the
  // README) are inlined here and their definitions dropped.
  function opening(md) {
    var lines = md.replace(/\r\n?/g, "\n").split("\n"), out = [], fence = null, size = 0, cut = false, refs = {};
    lines.forEach(function (l) { var m = l.match(REF_DEF); if (m) refs[m[1].toLowerCase()] = m[2]; });
    if (lines.length && /^#\s/.test(lines[0])) lines.shift();  // the title, which the page's h1 already gives
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i], f = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (!fence && LAYER_HEADING.test(line)) break;
      if (f) { if (!fence) fence = f[1]; else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = null; }
      if (!fence && !line.trim() && size > README_CAP) { cut = true; break; }
      if (!fence && !f) {
        if (REF_DEF.test(line)) continue;
        line = line.replace(/\[([^\]]+)\]\[([^\]]*)\]/g, function (all, text, ref) {
          var url = refs[(ref || text).toLowerCase()];
          return url ? "[" + text + "](<" + url + ">)" : all;
        });
      }
      out.push(line);
      size += line.length + 1;
    }
    if (fence) out.push(fence);  // the cap never falls inside a fence, but the layer heading search can end in one
    return { text: out.join("\n").trim(), cut: cut };
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = TC.el("script", { src: src });
      s.onload = resolve;
      s.onerror = function () { reject(new Error(src)); };
      document.head.append(s);
    });
  }

  // progress.json names README paths as of the roadmap commit it read, and a roadmap moved to Completed/
  // since then is gone from that path on main; that commit still has it.
  function readme(r, head) {
    var dir = r.readme.replace(/\/README\.md$/, "");
    var path = r.readme.split("/").map(encodeURIComponent).join("/");
    var box = TC.$("#rm-readme");
    function get(ref) {
      return fetch(RAW + ref + "/" + path).then(function (res) {
        if (!res.ok) throw new Error("README at " + ref + ": HTTP " + res.status);
        return res.text().then(function (t) { return { ref: ref, text: t }; });
      });
    }
    function links(ref) {
      var blob = "https://github.com/TauCetiProject/TauCetiRoadmap/blob/" + ref + "/";
      TC.$("#rm-readme-links").replaceChildren(
        TC.el("a", { href: blob + r.readme, text: "Full README" }), dot(),
        TC.el("a", { href: blob + dir + "/STATUS.md", text: "latest report" }), dot(),
        TC.el("a", { href: "https://github.com/TauCetiProject/TauCetiRoadmap/tree/" + ref + "/" + dir, text: "the roadmap on GitHub" }));
      return blob + r.readme;
    }
    links("main");
    var text = get("main").catch(function (e) { if (!head) throw e; return get(head); });
    var vendor = Promise.all([loadScript("static/vendor/katex.v0.16.28.min.js"), loadScript("static/vendor/markdown.js")]);
    Promise.all([text, vendor]).then(function (res) {
      var blob = links(res[0].ref);
      var o = opening(res[0].text);
      if (!o.text) { box.remove(); return; }
      // TauMarkdown builds DOM nodes: source HTML stays text, links are limited to http(s) and relative
      // paths, and mathematics becomes MathML copied element by element from KaTeX's output.
      var frag = window.TauMarkdown.render(o.text);
      // Relative links are the README's own, so they resolve against it on GitHub, not against this site.
      Array.prototype.forEach.call(frag.querySelectorAll("a[data-doc-link]"), function (a) {
        a.href = new URL(a.dataset.docLink, blob).href;
        delete a.dataset.docLink; delete a.dataset.basePath;
      });
      // Heading ids from the README would collide with this page's.
      Array.prototype.forEach.call(frag.querySelectorAll("[id]"), function (e) { e.removeAttribute("id"); });
      box.replaceChildren(frag);
      TC.$$("pre", box).forEach(TC.copyable);
      if (o.cut) box.append(TC.el("p", { class: "small muted" }, [document.createTextNode("… continued in the "), TC.el("a", { href: blob, text: "full README" }), document.createTextNode(".")]));
    }).catch(function (e) {
      console.warn(e);
      box.remove();
    });
  }

  /* ---------- pull requests ---------- */
  function weekly(data, act, sub) {
    var box = TC.$("#rm-weekly");
    if (!act || !act.weekly) { box.replaceChildren(TC.el("p", { class: "muted", text: "No pull-request activity is recorded for this roadmap." })); return; }
    // Drop the week still in progress: a partial count reads as a collapse.
    var cutoff = new Date(data.cutoff).getTime(), weeks = data.weeks.slice(), counts = act.weekly.slice(0, weeks.length);
    while (weeks.length && new Date(weeks[weeks.length - 1] + "T00:00:00Z").getTime() + 7 * 864e5 > cutoff) { weeks.pop(); counts.pop(); }
    TC.$("#weekly-sub").textContent = "Complete weeks, Monday to Sunday, over the last " + weeks.length + " weeks" + (sub ? ", for all of " + sub + "." : ".");
    TC.timeChart(box, { dates: weeks, label: "Merged pull requests per week", series: [{ name: "Merged in the week starting", values: counts, color: TC.SERIES[0] }] });
  }

  function recent(label, prs, umbrella) {
    var box = TC.$("#rm-recent");
    var mine = prs && prs.roadmaps[label];
    TC.$("#recent-sub").textContent = umbrella
      ? "Pull requests labelled " + label + ", shared by " + umbrella + " and its sub-roadmaps."
      : "Pull requests labelled " + label + ".";
    if (!prs) box.replaceChildren(TC.el("p", { class: "muted small", text: "The list of merged pull requests is not available." }));
    else if (!mine || !mine.recent.length) box.replaceChildren(TC.el("p", { class: "muted small", text: "None merged as of " + TC.dayYear(prs.generated_at) + ", when this list was last built." }));
    else box.replaceChildren(TC.el("ul", { class: "pr-list" }, mine.recent.map(function (p) {
      return TC.el("li", null, [
        TC.el("a", { href: PULL + p.number, text: "#" + p.number }), document.createTextNode(" "),
        TC.el("span", { class: "t", text: p.title }),
        TC.el("span", { class: "muted m", text: TC.day(p.merged) + " · " + (p.net >= 0 ? "+" : "−") + TC.fmt(Math.abs(p.net)) + " lines" }),
      ]);
    })));
    var q = "is:pr label:" + label;
    // Bors closes what it merges and retitles it, so `is:merged` alone misses most recent merges.
    TC.$("#rm-pr-links").replaceChildren(
      TC.el("a", { href: PULLS + encodeURIComponent(q + ' (is:merged OR "Merged by Bors" in:title)'), text: "All merged pull requests" }), dot(),
      TC.el("a", { href: PULLS + encodeURIComponent(q + " is:open"), text: "open pull requests" }));
  }

  /* ---------- the page ---------- */
  function render(data, areas, prs) {
    var rows = data.rows.filter(function (r) { return !r.retired; });
    var r = rows.find(function (x) { return x.id === ID; });
    if (!ID) { missing("No roadmap was named."); return; }
    if (!r) { missing("There is no roadmap “" + ID + "”."); return; }
    var umbrella = r.parent_id ? rows.find(function (x) { return x.id === r.parent_id; }) : null;
    var kids = rows.filter(function (x) { return x.parent_id === r.id; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    var label = "roadmap/" + (umbrella ? umbrella.name : r.parent || r.name);
    var st = r.status || {}, n = r.states.length, isDue = due(r, data);

    document.title = r.name + " — Roadmap — Tau Ceti";
    TC.$("#rm-missing").remove();
    TC.$("#rm-page").hidden = false;

    // Breadcrumb: Roadmaps › arXiv area › Atlas subarea (where the Atlas divides the area) › umbrella.
    var crumbs = TC.$("#crumbs");
    if (r.arxiv) crumbs.append(document.createTextNode(" › "), TC.el("a", { href: areaHref(r.arxiv), text: r.topic || r.arxiv }));
    if (areas) {
      var sub = areas.areas.find(function (a) { return a.roadmaps.indexOf(r.id) >= 0; }) ||
                (umbrella && areas.areas.find(function (a) { return a.roadmaps.indexOf(umbrella.id) >= 0; }));
      var field = sub && areas.fields.find(function (f) { return f.id === sub.arxiv; });
      if (sub && field && field.areas.length > 1) crumbs.append(document.createTextNode(" › "), TC.el("span", { text: sub.label }));
    }
    if (umbrella) crumbs.append(document.createTextNode(" › "), TC.el("a", { href: pageHref(umbrella.id), text: umbrella.name }));

    var h1 = TC.$("#rm-title");
    h1.textContent = r.name;
    if (r.completed) h1.append(TC.el("span", { class: "badge", text: "complete" }));
    TC.$("#rm-lede").textContent = r.title || "";

    var glance = TC.$("#rm-glance");
    if (st.glance) {
      glance.append(TC.el("p", null, [richText(st.glance)]));
      if (st.inherited && umbrella) glance.append(TC.el("p", { class: "small muted" }, [document.createTextNode("From the report on "), TC.el("a", { href: pageHref(umbrella.id), text: umbrella.name }), document.createTextNode(".")]));
    } else glance.append(TC.el("p", { class: "muted", text: r.completed ? "Archived as complete." : "No progress report has been written for this roadmap yet." }));

    // Stat tiles.
    var done = r.completed ? n : count(r, "done");
    var act = r.activity, mine = prs && prs.roadmaps[label];
    var tiles = [
      tile(n ? done + "/" + n : r.completed ? "complete" : "—", "layers reported done", r.completed ? "archived as complete" : n ? null : kids.length ? "layers are in its sub-roadmaps" : "the README names no layers"),
      tile(n && !r.completed ? String(count(r, "partial")) : "—", "layers partial"),
      tile(act ? TC.fmt(act.total || 0) : umbrella ? under(umbrella) : "—", "merged pull requests", act && act.recent != null ? TC.fmt(act.recent) + " in the last " + (data.recent_days || 30) + " days" : null),
      tile(act ? TC.fmt(act.open || 0) : umbrella ? under(umbrella) : "—", "open pull requests"),
      tile(umbrella ? under(umbrella) : mine ? TC.compact(mine.net_lines) : "—", "net lines landed", mine && !umbrella ? TC.fmt(mine.net_lines) + " added minus deleted" : null),
      tile(st.ts ? TC.ago(st.ts) : "none", "latest report",
           st.ts ? (isDue ? TC.el("span", { class: "due", text: "update due" }) : document.createTextNode(TC.dayYear(st.ts) + (st.inherited ? ", the umbrella’s" : ""))) : null),
    ];
    TC.$("#rm-tiles").replaceChildren.apply(TC.$("#rm-tiles"), tiles);

    // Layers.
    TC.$("#rm-strip").replaceChildren(segments(r));
    var rem = (r.assessment || {}).remaining || {};
    var layersSub = n ? ""
      : r.completed ? "Archived as complete." : kids.length ? "An umbrella roadmap: its layers are in the sub-roadmaps below." : "The README names no layers.";
    TC.$("#layers-sub").textContent = layersSub;
    TC.$("#layers-sub").hidden = !layersSub;
    if (!n && !r.completed) TC.$("#rm-strip").hidden = TC.$(".rm-legend").hidden = true;
    TC.$("#rm-layers").replaceChildren.apply(TC.$("#rm-layers"), r.layers.map(function (l, i) {
      var s = r.completed ? "done" : r.states[i];
      var li = TC.el("li", null, [TC.el("span", { class: "state " + s, text: s }), document.createTextNode(l)]);
      var note = rem[r.layer_ids[i]];
      if (note && s !== "done") li.append(TC.el("div", { class: "small muted rem" }, [document.createTextNode("Remaining: "), richText(note)]));
      return li;
    }));

    if (st.frontier && st.frontier.length) {
      TC.$("#frontier-panel").hidden = false;
      TC.$("#rm-frontier").replaceChildren.apply(TC.$("#rm-frontier"), st.frontier.map(function (f) {
        return TC.el("li", null, [TC.el("b", null, [richText(f.name), document.createTextNode(" ")]), richText((f.text || "").replace(/^—\s*/, "— "))]);
      }));
    }

    weekly(data, act || (umbrella && umbrella.activity), act ? null : umbrella && umbrella.name);
    recent(label, prs, umbrella && umbrella.name);
    readme(r, data.roadmap_head);

    if (kids.length) {
      TC.$("#subs-panel").hidden = false;
      TC.$("#rm-subs").replaceChildren.apply(TC.$("#rm-subs"), kids.map(function (k) {
        var kn = k.states.length, kd = k.completed ? kn : count(k, "done");
        var name = TC.el("div", { class: "rm-sub-name" }, [TC.el("a", { href: pageHref(k.id), text: k.name })]);
        if (k.completed) name.append(TC.el("span", { class: "badge", text: "complete" }));
        name.append(TC.el("small", { text: k.title || "" }));
        return TC.el("div", { class: "rm-sub" }, [name, segments(k), TC.el("div", { class: "rm-sub-meta", text: kn ? kd + "/" + kn + " layers" : k.completed ? "archived" : "no layers" })]);
      }));
    }

    TC.$("#rm-meta") || TC.$("#rm-page").append(TC.el("p", { class: "freshness", id: "rm-meta",
      text: "Roadmaps as of TauCetiRoadmap " + data.roadmap_head.slice(0, 7) + "; activity through " + TC.dayYear(data.cutoff) +
            (prs && prs.generated_at ? "; merged pull requests as of " + TC.dayYear(prs.generated_at) : "") + "." }));
  }

  // The Atlas's areas and this site's pull-request list are optional: without them the page loses a
  // breadcrumb step and the recent merges, not the rest.
  var areas = fetch("atlas/tauceti/areas.json").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  var prs = TC.local("roadmap-prs.json").catch(function () { return null; });
  Promise.all([TC.live("progress.json"), areas, prs]).then(function (res) {
    render(res[0], res[1], res[2]);
    var row = res[0].rows.filter(function (x) { return x.id === ID; })[0];
    // A completed roadmap's headline declaration (examples.html has them all).
    if (row) TC.local("roadmap-examples.json").then(function (ex) {
      var e = ex.examples.filter(function (x) { return "Completed/" + x.roadmap === row.id || x.roadmap === row.id; })[0];
      if (!e) return;
      var card = TC.exampleCard(e, null);
      card.querySelector("p.small.muted").remove();
      card.querySelector("h3").before(TC.el("p", { class: "eyebrow", text: "Example" }));
      card.append(TC.el("p", { class: "small" }, [TC.el("a", { href: "examples.html", text: "A result from every completed roadmap →" })]));
      TC.$("#rm-example").replaceChildren(card);
    }).catch(function (e) { console.error(e); });
  }).catch(function (e) { TC.fail("#rm-missing", e); });
});
