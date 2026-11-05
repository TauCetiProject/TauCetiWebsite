document.addEventListener("DOMContentLoaded", function () {
  "use strict";
  var TC = window.TC;
  var S = TC.SERIES;

  TC.local("library-counts.json").then(function (c) {
    TC.timeChart("#decls", {
      dates: c.dates, label: "Theorems and definitions by day", updated: c.generated_at,
      series: [
        { name: "Theorems", values: c.theorems, color: S[0] },
        { name: "Definitions", values: c.definitions, color: S[2] },
      ],
    });
  }).catch(function (e) { TC.fail("#decls", e); });

  TC.local("library-loc.json").then(function (l) {
    TC.timeChart("#loc", { dates: l.dates, updated: l.generated_at, series: [{ name: "Lines of Lean", values: l.lines, color: S[1] }], area: true, label: "Lines of Lean by day" });
  }).catch(function () {
    // Without the git-derived series, fall back to the chart scripts/build_static.sh renders.
    TC.$("#loc").replaceChildren(TC.el("figure", { class: "img" }, [TC.el("img", { src: TC.LIVE + "loc-tauceti.svg", alt: "Tau Ceti: lines of Lean by date" })]));
  });

  TC.live("roadmap-completion.json").then(function (rc) {
    TC.set("loc", TC.fmt(rc.forecast.library_lines), "as of " + TC.dayYear(rc.forecast.last_full_day));
    TC.set("perday", TC.fmt(rc.forecast.library_growth_lines_per_day));
    var h = rc.history;
    var dates = h.map(function (x) { return x.date; });
    TC.timeChart("#layers", {
      dates: dates, label: "Roadmap layers named and done",
      series: [
        { name: "Layers named", values: h.map(function (x) { return x.layers; }), color: S[0] },
        { name: "Layers done", values: h.map(function (x) { return x.completed_layers; }), color: S[2] },
      ],
    });
    TC.timeChart("#roadmaps", { dates: dates, label: "Roadmaps", series: [{ name: "Roadmaps", values: h.map(function (x) { return x.roadmaps; }), color: S[6] }] });
  }).catch(function (e) { TC.fail("#layers", e); TC.fail("#roadmaps", e); });

  TC.local("loc-by-topic.json").then(function (d) {
    var top = d.topics.slice(0, 7), rest = d.topics.slice(7);
    var series = top.map(function (t, i) { return { name: t.name, values: t.series, color: S[i] }; });
    if (rest.length) {
      var other = d.dates.map(function (_, i) { return rest.reduce(function (a, t) { return a + t.series[i]; }, 0); });
      series.push({ name: "Other areas (" + rest.length + ")", values: other, color: TC.OTHER });
    }
    TC.timeChart("#topics", { dates: d.dates, updated: d.generated_at, series: series, stacked: true, label: "Net lines of Lean by area" });
  }).catch(function (e) { TC.fail("#topics", e); });

  TC.live("pr-stats.json").then(function (s) {
    var r = s.rolling_seven_day, last = r[r.length - 1];
    TC.set("merges7", TC.fmt(last.merges));
    TC.set("authors7", TC.fmt(last.active_authors));
    TC.set("latency", TC.hours(last.median_merge_hours));
    TC.timeChart("#authors", { dates: r.map(function (x) { return x.date; }), updated: s.snapshot, label: "Active authors", series: [{ name: "Active authors", values: r.map(function (x) { return x.active_authors; }), color: S[4] }] });
  }).catch(function (e) { TC.fail("#authors", e); });

  TC.live("progress.json").then(function (p) {
    // Drop the week still in progress: a partial count reads as a collapse.
    var cutoff = new Date(p.cutoff).getTime(), weeks = p.weeks.slice(), counts = p.global.weekly.slice();
    while (weeks.length && new Date(weeks[weeks.length - 1] + "T00:00:00Z").getTime() + 7 * 864e5 > cutoff) { weeks.pop(); counts.pop(); }
    TC.timeChart("#weekly", {
      dates: weeks, label: "Merged pull requests per week", updated: p.exported_at,
      series: [{ name: "Merged in the week starting", values: counts, color: S[0] }],
    });
  }).catch(function (e) { TC.fail("#weekly", e); });
});
