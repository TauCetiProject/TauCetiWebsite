document.addEventListener("DOMContentLoaded", function () {
  "use strict";
  var TC = window.TC;

  // Who a stage waits on, for the reader deciding whether it is theirs to unblock.
  var WAITS_ON = {
    "awaiting-CI": "CI", "awaiting-review": "reviewers", "review-in-progress": "reviewers",
    "ready-to-merge": "merge queue", "needs-human-review": "maintainers", "awaiting-dependency": "another PR",
    "on-hold": "maintainers", "ci-failed": "author", "merge-check-failed": "author", "awaiting-author": "author",
  };

  function vs(now, base) {
    if (base == null || !base) return "";
    var r = now / base;
    return (r >= 1 ? "×" + TC.fmt1(r) : TC.pct(r)) + " of the 14-day rate (" + TC.fmt1(base) + ")";
  }

  TC.live("pipeline-health.json").then(function (ph) {
    TC.$("#ph-meta").textContent = "Pipeline snapshot " + TC.ago(ph.generated_at) + " (" + ph.generated_at.replace("T", " ").slice(0, 16) + " UTC).";
    TC.set("open", TC.fmt(ph.open_prs));
    TC.set("opened", TC.fmt1(ph.opened_per_hour), vs(ph.opened_per_hour, ph.baseline_opened_per_hour));
    TC.set("merged", TC.fmt1(ph.merged_per_hour), vs(ph.merged_per_hour, ph.baseline_merged_per_hour));
    var mr = ph.merge_readiness || {};
    TC.set("ready", TC.fmt(mr.eligible_not_queued), TC.fmt(mr.verified_eligible) + " verified eligible · " + TC.fmt(mr.blocked) + " blocked");

    var diag = TC.$("#diagnosis");
    if (ph.anomalies && ph.anomalies.length) {
      ph.anomalies.forEach(function (a) {
        diag.append(TC.el("div", { class: "callout" }, [
          TC.el("span", { class: "status-pill warning", text: a.filling ? "filling" : a.stalled ? "slow" : "anomaly" }),
          document.createTextNode(" "), TC.el("b", { text: a.stage }), document.createTextNode(": " + a.why + "."),
        ]));
      });
    } else {
      diag.append(TC.el("div", { class: "callout teal" }, [TC.el("span", { class: "status-pill good", text: "normal" }), document.createTextNode(" No stage is filling up or moving unusually slowly.")]));
    }

    var head = ["Stage", "Waits on", "Open", "Median wait", "Oldest", "Typical stay (now / 14 d)", "In per hour (now / 14 d)"];
    var tbody = TC.el("tbody");
    ph.stages.filter(function (s) { return s.depth || s.entered_per_hour || s.baseline_entered_per_hour; }).forEach(function (s) {
      var flagged = (ph.anomalies || []).some(function (a) { return a.stage === s.stage; });
      tbody.append(TC.el("tr", null, [
        TC.el("td", null, [TC.el("code", { text: s.stage }), flagged ? TC.el("span", { class: "status-pill warning", style: "margin-left:0.4rem", text: "slow" }) : null]),
        TC.el("td", { text: WAITS_ON[s.stage] || "" }),
        TC.el("td", { class: "n", text: TC.fmt(s.depth) }),
        TC.el("td", { class: "n", text: TC.hours(s.median_waiting_hours) }),
        TC.el("td", { class: "n", text: TC.hours(s.oldest_waiting_hours) }),
        TC.el("td", { class: "n", text: TC.hours(s.median_dwell_hours) + " / " + TC.hours(s.baseline_median_dwell_hours) }),
        TC.el("td", { class: "n", text: TC.fmt1(s.entered_per_hour) + " / " + TC.fmt1(s.baseline_entered_per_hour) }),
      ]));
    });
    TC.$("#stages").replaceChildren(TC.el("table", { class: "data" }, [
      TC.el("thead", null, [TC.el("tr", null, head.map(function (h, i) { return TC.el("th", { class: i > 1 ? "n" : null, text: h }); }))]), tbody,
    ]));
  }).catch(function (e) { TC.fail("#stages", e); });

  TC.live("pr-stats.json").then(function (s) {
    var hrs = s.queue.total_open_hours;
    var buckets = [["under a day", 0, 24], ["1–3 days", 24, 72], ["3–7 days", 72, 168], ["1–2 weeks", 168, 336], ["2–4 weeks", 336, 672], ["over 4 weeks", 672, Infinity]];
    TC.bars("#age", buckets.map(function (b, i) {
      var n = hrs.filter(function (h) { return h >= b[1] && h < b[2]; }).length;
      return { label: b[0], value: n, color: TC.SERIES[0], valueText: TC.fmt(n) + " PRs" };
    }));

    var rc = s.review_cycles, reach = rc.reach.map(function (r) { return r.prs; });
    function exactly(k) { return (reach[k - 1] || 0) - (reach[k] || 0); }
    function range(a, b) { return (reach[a - 1] || 0) - (b == null ? 0 : reach[b] || 0); }
    var items = [1, 2, 3, 4, 5].map(function (k) { return { label: k + (k === 1 ? " round" : " rounds"), value: exactly(k) }; })
      .concat([{ label: "6–10 rounds", value: range(6, 10) }, { label: "more than 10", value: range(11) }]);
    TC.bars("#cycles", items.map(function (it) { it.color = TC.SERIES[6]; it.valueText = TC.fmt(it.value) + " PRs"; return it; }));
    TC.$("#cycles-note").textContent = TC.fmt(rc.reviewed_prs) + " pull requests, " + TC.fmt1(rc.total_cycles / rc.reviewed_prs) + " rounds on average, since " + TC.dayYear(rc.label_epoch) + ".";

    var r = s.rolling_seven_day, dates = r.map(function (x) { return x.date; });
    TC.timeChart("#merges7", { dates: dates, updated: s.snapshot, label: "Merges in trailing seven days", series: [{ name: "Merges, trailing 7 days", values: r.map(function (x) { return x.merges; }), color: TC.SERIES[2] }] });
    TC.timeChart("#latency", {
      dates: dates, updated: s.snapshot, label: "Hours from opening to merge", yFormat: function (v) { return TC.fmt(v) + "h"; }, tipFormat: TC.hours,
      series: [
        { name: "Median", values: r.map(function (x) { return x.median_merge_hours; }), color: TC.SERIES[0] },
        { name: "90th percentile", values: r.map(function (x) { return x.p90_merge_hours; }), color: TC.SERIES[1], dash: "5 4" },
      ],
    });
  }).catch(function (e) { TC.fail("#age", e); TC.fail("#cycles", e); TC.fail("#merges7", e); TC.fail("#latency", e); });

  TC.live("roadmap-completion.json").then(function (rc) {
    var L = rc.forecast.estimates.layers;
    var stop = L.stop_authoring, cont = L.continue_authoring;
    TC.set("runway", stop.state === "finite" ? TC.fmt(stop.days) : "—", TC.fmt(L.backlog) + " layers left at " + TC.fmt1(L.completion_units_per_day) + " a day");
    var text = TC.fmt(L.backlog) + " roadmap layers are not yet recorded done. At the current pace of about " + TC.fmt1(L.completion_units_per_day) +
      " layers a day, the agents would finish them in about " + (stop.state === "finite" ? TC.fmt(stop.days) + " days" : "an unknown time") + " if no new roadmap work were added. ";
    if (cont.state === "finite") text += "With roadmaps still being written at the last week’s rate, it would take about " + TC.fmt(cont.days) + " days.";
    else text += "But over the last week new layers were written at " + TC.fmt1(L.authoring_units_per_day) + " a day, faster than they were completed, so at current rates the backlog is growing rather than shrinking.";
    TC.$("#runway-text").textContent = text;
  }).catch(function (e) { TC.fail("#runway-text", e); TC.set("runway", "—"); });

  TC.local("ci-current.json").then(function (c) {
    function list(o) {
      var k = Object.keys(o || {});
      return k.length ? k.map(function (p) { return o[p] + " on " + p; }).join(", ") : "none";
    }
    var run = Object.values(c.running || {}).reduce(function (a, b) { return a + b; }, 0);
    var q = Object.values(c.queued || {}).reduce(function (a, b) { return a + b; }, 0);
    TC.$("#ci-now").textContent = "When this site was last built (" + TC.ago(c.generated_at || c.fetched_at) + "), " + run + " CI " + (run === 1 ? "job was" : "jobs were") + " running (" + list(c.running) +
      ") and " + q + (q === 1 ? " was" : " were") + " queued" + (q ? " (" + list(c.queued) + ")" : "") + ".";
    // The CI service's own chart URLs are newer than the copies static/ holds from the last build.
    TC.$$("[data-ci-asset]").forEach(function (img) {
      var u = (c.assets || {})[img.getAttribute("data-ci-asset")];
      if (u) img.src = u;
    });
  }).catch(function () { TC.$("#ci-now").textContent = "Current job counts are unavailable."; });
});
