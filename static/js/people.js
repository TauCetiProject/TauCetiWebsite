document.addEventListener("DOMContentLoaded", function () {
  "use strict";
  var TC = window.TC;

  // Every plotted account as its own line on a log axis, so the long tail stays visible; colours
  // repeat after eight, so later rounds are dashed and the end labels name each line.
  var DASH = ["", "6 3", "2 3"];
  function cumulative(sel, dates, plotted, label, updated) {
    var names = Object.keys(plotted), last = function (n) { return plotted[n][plotted[n].length - 1]; };
    var others = names.filter(function (n) { return /^Other/.test(n); });
    var named = names.filter(function (n) { return !/^Other/.test(n); }).sort(function (a, b) { return last(b) - last(a); });
    var series = named.map(function (n, i) {
      return { name: n, values: plotted[n], color: TC.SERIES[i % TC.SERIES.length], dash: DASH[Math.floor(i / TC.SERIES.length) % DASH.length] };
    });
    others.forEach(function (o) {
      var m = o.match(/\((\d+)/);
      series.push({ name: m ? "Everyone else (" + m[1] + ")" : o, values: plotted[o], color: TC.OTHER, dash: "1 3" });
    });
    TC.timeChart(sel, { dates: dates, series: series, log: true, endLabels: true, tipLimit: 10, label: label, updated: updated });
  }

  // taucetiproject.org publishes these counts only inside its chart, in the chart's title and description.
  fetch(TC.LIVE + "participation.svg").then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.text();
  }).then(function (text) {
    var svg = new DOMParser().parseFromString(text, "image/svg+xml");
    var title = (svg.querySelector("title") || {}).textContent || "", desc = (svg.querySelector("desc") || {}).textContent || "";
    var total = title.match(/(\d+) people .* as of (\d{4}-\d\d-\d\d)/), repos = [];
    desc.replace(/(\w+): (\d+)/g, function (_, name, n) { repos.push({ label: name, value: +n, href: "https://github.com/TauCetiProject/" + name }); });
    if (!total || !repos.length) throw new Error("unexpected chart format");
    TC.set("people", TC.fmt(+total[1]), "as of " + TC.dayYear(total[2]));
    TC.bars("#participation", repos.map(function (r) { r.color = TC.SERIES[1]; r.valueText = TC.fmt(r.value) + " accounts"; return r; }));
  }).catch(function (e) { TC.fail("#participation", e); });

  TC.live("pr-stats.json").then(function (s) {
    var merges = s.merge_totals_by_contributor, reviews = s.review_totals_by_contributor;
    TC.set("authors", TC.fmt(Object.keys(merges).length));
    TC.set("reviewers", TC.fmt(Object.keys(reviews).length));
    TC.set("reviews", TC.fmt(Object.values(reviews).reduce(function (a, b) { return a + b; }, 0)));
    TC.set("active", TC.fmt(s.rolling_seven_day[s.rolling_seven_day.length - 1].active_authors));
    cumulative("#cum-merges", s.cumulative_dates, s.cumulative_merges_plotted, "Cumulative merged pull requests by contributor", s.snapshot);
    cumulative("#cum-reviews", s.cumulative_dates, s.cumulative_reviews_plotted, "Cumulative reviews by contributor", s.snapshot);

    var logins = Object.keys(merges);
    Object.keys(reviews).forEach(function (l) { if (!(l in merges)) logins.push(l); });
    logins.sort(function (a, b) { return ((merges[b] || 0) + (reviews[b] || 0)) - ((merges[a] || 0) + (reviews[a] || 0)); });
    TC.$("#leader-note").textContent = "Every account with a merged pull request or a review, through " + TC.dayYear(s.snapshot) + ".";
    var tbody = TC.el("tbody");
    logins.forEach(function (l, i) {
      tbody.append(TC.el("tr", null, [
        TC.el("td", { class: "n", text: String(i + 1) }),
        TC.el("td", null, [TC.el("a", { href: TC.GH + encodeURIComponent(l), text: l })]),
        TC.el("td", { class: "n", text: TC.fmt(merges[l] || 0) }),
        TC.el("td", { class: "n", text: TC.fmt(reviews[l] || 0) }),
      ]));
    });
    var table = TC.el("table", { class: "data" }, [
      TC.el("thead", null, [TC.el("tr", null, [TC.el("th", { class: "n", text: "#" }), TC.el("th", { text: "Account" }), TC.el("th", { class: "n", text: "Merged PRs" }), TC.el("th", { class: "n", text: "Reviews" })])]),
      tbody,
    ]);
    TC.$("#leaders").replaceChildren(TC.el("div", { class: "scroll", style: "max-height:28rem;overflow:auto" }, [table]));
  }).catch(function (e) { TC.fail("#cum-merges", e); TC.fail("#cum-reviews", e); TC.fail("#leaders", e); });
});
