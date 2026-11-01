document.addEventListener("DOMContentLoaded", function () {
  "use strict";
  var TC = window.TC;

  function cumulative(sel, dates, plotted, label, updated) {
    var names = Object.keys(plotted);
    var others = names.filter(function (n) { return /^Other/.test(n); });
    var named = names.filter(function (n) { return !/^Other/.test(n); })
      .sort(function (a, b) { return plotted[b][plotted[b].length - 1] - plotted[a][plotted[a].length - 1]; });
    var top = named.slice(0, 7), rest = named.slice(7).concat(others);
    var series = top.map(function (n, i) { return { name: n, values: plotted[n], color: TC.SERIES[i] }; });
    var restCount = named.length - 7 + others.reduce(function (a, o) { var m = o.match(/\((\d+)/); return a + (m ? +m[1] : 0); }, 0);
    if (rest.length) series.push({
      name: "Everyone else (" + restCount + ")", color: TC.OTHER,
      values: dates.map(function (_, i) { return rest.reduce(function (a, n) { return a + plotted[n][i]; }, 0); }),
    });
    TC.timeChart(sel, { dates: dates, series: series, stacked: true, label: label, updated: updated });
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
    TC.bars("#participation", repos.map(function (r) { r.color = TC.SERIES[1]; r.valueText = TC.fmt(r.value) + " people"; return r; }));
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
