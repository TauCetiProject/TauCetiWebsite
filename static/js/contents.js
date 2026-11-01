document.addEventListener("DOMContentLoaded", function () {
  "use strict";
  var TC = window.TC;

  TC.live("roadmap-completion.json").then(function (rc) {
    var h = rc.history[rc.history.length - 1];
    TC.set("loc", TC.fmt(rc.forecast.library_lines), "as of " + TC.dayYear(rc.forecast.last_full_day));
    TC.set("roadmaps", TC.fmt(h.roadmaps), h.completed_roadmaps + " archived as complete, as of " + TC.dayYear(h.date));
    TC.set("layers", TC.fmt(h.completed_layers), "of " + TC.fmt(h.layers) + " named (" + TC.pct(h.completed_layers / h.layers) + "), as of " + TC.dayYear(h.date));
  }).catch(console.error);
  TC.local("library-loc.json").then(function (l) { TC.set("files", TC.fmt(l.files_now)); })
    .catch(function () { TC.set("files", "—"); });

  // Areas get a stable colour by rank in the all-time total, so the two charts agree.
  var colorOf = {};
  // The roadmap pages are addressed by progress.json id; a label names a top-level roadmap.
  var pageOf = TC.live("progress.json").then(function (p) {
    var ids = {};
    p.rows.forEach(function (r) { if (!r.parent && !r.retired) ids[r.name] = r.id; });
    return ids;
  }).catch(function () { return {}; });
  Promise.all([TC.local("loc-by-topic.json"), pageOf]).then(function (res) {
    var d = res[0], ids = res[1];
    d.topics.forEach(function (t, i) { colorOf[t.arxiv] = i < 7 ? TC.SERIES[i] : TC.OTHER; });
    TC.set("areas", String(d.topics.filter(function (t) { return t.arxiv !== "Unsorted"; }).length));
    TC.$("[data-topic-note]").textContent = "Through " + TC.dayYear(d.last_full_day) + "; " + TC.fmt(d.unattributed.prs) + " pull requests without a single roadmap label are not shown.";
    TC.bars("#by-topic", d.topics.map(function (t) {
      return {
        label: t.name, value: t.net_lines, color: colorOf[t.arxiv], href: "structure.html?area=" + encodeURIComponent(t.arxiv),
        valueText: TC.compact(t.net_lines) + " · " + t.roadmaps + (t.roadmaps === 1 ? " roadmap" : " roadmaps"),
        title: t.name + " (" + t.arxiv + "): " + TC.fmt(t.net_lines) + " net lines across " + t.roadmaps + " roadmaps",
      };
    }));
    TC.bars("#by-roadmap", d.roadmaps.slice(0, 20).map(function (r) {
      return {
        label: r.roadmap, value: r.net_lines, color: colorOf[r.arxiv] || TC.OTHER,
        href: ids[r.roadmap] ? "roadmap.html?id=" + encodeURIComponent(ids[r.roadmap]) : "structure.html#rm-" + r.roadmap,
        valueText: TC.compact(r.net_lines) + " · " + TC.fmt(r.merged_prs) + " PRs",
        title: r.roadmap + " (" + r.arxiv + "): " + TC.fmt(r.net_lines) + " net lines from " + TC.fmt(r.merged_prs) + " merged PRs",
      };
    }));
  }).catch(function (e) { TC.fail("#by-topic", e); TC.fail("#by-roadmap", e); TC.set("areas", "—"); });

  TC.live("progress.json").then(function (p) {
    var byTopic = {};
    p.rows.forEach(function (r) {
      if (r.retired) return;
      var t = byTopic[r.topic] || (byTopic[r.topic] = { done: 0, partial: 0, untouched: 0, unassessed: 0, n: 0, arxiv: r.arxiv });
      var states = r.completed && !r.states.length ? [] : r.states;
      states.forEach(function (s) { t[s] = (t[s] || 0) + 1; t.n++; });
    });
    var topics = Object.keys(byTopic).filter(function (k) { return byTopic[k].n; })
      .sort(function (a, b) { return byTopic[b].n - byTopic[a].n; });
    var max = Math.max.apply(null, topics.map(function (k) { return byTopic[k].n; }));
    var wrap = TC.el("div", { class: "bars" });
    var order = ["done", "partial", "untouched", "unassessed"];
    topics.forEach(function (k) {
      var t = byTopic[k];
      var track = TC.el("div", { class: "track" });
      var segs = TC.el("div", { class: "segs", style: "height:16px;margin-top:2px;width:" + (t.n / max * 100) + "%" });
      order.forEach(function (s) {
        if (!t[s]) return;
        segs.append(TC.el("div", { class: "seg " + s, style: "flex:" + t[s] + " 1 0", title: k + ": " + t[s] + " " + s }));
      });
      track.append(segs);
      wrap.append(TC.el("div", { class: "bar", title: k + ": " + order.map(function (s) { return (t[s] || 0) + " " + s; }).join(", ") }, [
        TC.el("div", { class: "name" }, [TC.el("a", { href: "structure.html?area=" + encodeURIComponent(t.arxiv), text: k })]), track,
      ]));
    });
    var box = TC.$("#by-state");
    box.replaceChildren(wrap);
  }).catch(function (e) { TC.fail("#by-state", e); });
});
