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
    // From schema 6 the counts cover GitHub and the Forgejo mirror; `by_forge` splits them.
    var forges = ph.by_forge || null;
    function split(text, field) {
      var by = forges ? "GitHub " + TC.fmt(forges.github[field]) + ", Forgejo " + TC.fmt(forges.forgejo[field]) : "GitHub only";
      return [text, by].filter(Boolean).join(" · ");
    }
    TC.set("open", TC.fmt(ph.open_prs), split("", "open_prs"));
    TC.set("opened", TC.fmt1(ph.opened_per_hour), split(vs(ph.opened_per_hour, ph.baseline_opened_per_hour), "opened_count"));
    TC.set("merged", TC.fmt1(ph.merged_per_hour), split(vs(ph.merged_per_hour, ph.baseline_merged_per_hour), "merged_count"));
    var mr = ph.merge_readiness || {};
    TC.set("ready", TC.fmt(mr.eligible_not_queued), TC.fmt(mr.verified_eligible) + " verified eligible" +
      (mr.eligible_queued != null ? ", " + TC.fmt(mr.eligible_queued) + " already queued" : "") + " · " + TC.fmt(mr.blocked) + " blocked · GitHub only");

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
    // GitHub's open pull requests, and the Forgejo mirror's where pr-stats.json publishes them.
    var forgejoAges = s.queue.forgejo_open_hours;
    var hrs = s.queue.total_open_hours.concat(forgejoAges || []);
    TC.$("#age-scope").textContent = forgejoAges ? "on GitHub and the Forgejo mirror" : "on GitHub only";
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
    if (s.merge_latency) {
      latencyChart(s.merge_latency, s.snapshot);
    } else {
      // A pr-stats.json from before `merge_latency`: the trailing seven-day series alone.
      TC.$("#latency-sub").textContent = "Median and 90th percentile over pull requests merged in the trailing seven days, " +
        "from opening to merge, in hours. A point lags a change in the queue by up to a week.";
      TC.timeChart("#latency", {
        dates: dates, updated: s.snapshot, label: "Hours from opening to merge", yFormat: function (v) { return TC.fmt(v) + "h"; }, tipFormat: TC.hours,
        series: [
          { name: "Median", values: r.map(function (x) { return x.median_merge_hours; }), color: TC.SERIES[0] },
          { name: "90th percentile", values: r.map(function (x) { return x.p90_merge_hours; }), color: TC.SERIES[1], dash: "5 4" },
        ],
      });
    }
  }).catch(function (e) { TC.fail("#age", e); TC.fail("#cycles", e); TC.fail("#merges7", e); TC.fail("#latency", e); });

  // Time to merge, by window and measure, from pr-stats.json's `merge_latency` (the queue's landings
  // joined with the forges' opening times). Each daily point covers the window ending that UTC day.
  var WINDOWS = [["24h", "24 hours"], ["7d", "7 days"]];
  var MEASURES = [["open_to_land", "Opening to land"], ["open_to_approval", "Opening to approval"], ["approval_to_land", "Approval to land"]];
  function latencyChart(ml, updated) {
    var state = { window: "24h", measure: "open_to_land" };
    var controls = TC.$("#latency-controls");
    function group(label, options, key) {
      var g = TC.el("div", { class: "range", role: "group", "aria-label": label, style: "justify-content:flex-start;flex-wrap:wrap;margin:0.2rem 0" });
      g.append(TC.el("span", { class: "small muted", style: "margin-right:0.3rem", text: label + ":" }));
      options.forEach(function (o) {
        var b = TC.el("button", { type: "button", "aria-pressed": String(state[key] === o[0]), text: o[1] });
        b.addEventListener("click", function () {
          state[key] = o[0];
          TC.$$("button", g).forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
          draw();
        });
        g.append(b);
      });
      return g;
    }
    controls.replaceChildren(group("Window", WINDOWS, "window"), group("Measure", MEASURES, "measure"));
    function name(list, key) { return list.filter(function (o) { return o[0] === key; })[0][1]; }
    function draw() {
      var sr = ml.series[state.window][state.measure];
      var whole = ml.current && ml.current[state.window], now = whole && whole[state.measure];
      var span = state.window === "24h" ? "the 24 hours" : "the 7 days";
      TC.$("#latency-now").textContent = !whole ? "The queue's data does not yet cover " + span + " to the snapshot."
        : now.count
        ? name(MEASURES, state.measure) + ", " + span + " to " + ml.current.as_of.replace("T", " ").slice(0, 16) + " UTC: median " + TC.hours(now.median) +
          " (25th–75th percentile " + TC.hours(now.p25) + "–" + TC.hours(now.p75) + ") over " + TC.fmt(now.count) + " pull requests."
        : "No pull requests landed in " + span + " to " + ml.current.as_of.replace("T", " ").slice(0, 16) + " UTC.";
      // A window the queue's data does not wholly cover is null: trim those from both ends (the
      // chart joins across any left inside), and say so if nothing is left.
      var lo = 0, hi = sr.median.length;
      while (lo < hi && sr.median[lo] == null) lo++;
      while (hi > lo && sr.median[hi - 1] == null) hi--;
      if (lo === hi) {
        TC.$("#latency").replaceChildren(TC.el("p", { class: "muted", text: "The queue's data does not yet cover a whole window of " + (state.window === "24h" ? "24 hours" : "7 days") + "." }));
        return;
      }
      TC.timeChart("#latency", {
        dates: ml.dates.slice(lo, hi), updated: updated, yFormat: function (v) { return TC.fmt(v) + "h"; }, tipFormat: TC.hours,
        label: name(MEASURES, state.measure) + ", pull requests landed in " + span + " ending each day, in hours",
        series: [
          { name: "Median", values: sr.median.slice(lo, hi), color: TC.SERIES[0] },
          { name: "25th percentile", values: sr.p25.slice(lo, hi), color: TC.SERIES[1], dash: "5 4" },
          { name: "75th percentile", values: sr.p75.slice(lo, hi), color: TC.SERIES[1], dash: "5 4" },
        ],
      });
    }
    draw();
  }

  TC.live("roadmap-completion.json").then(function (rc) {
    // Observed rates over the last seven complete days: net layers added to the roadmaps (floored
    // at zero), and net layer completion events (reopenings subtract). The lines-of-Lean model is
    // not shown here.
    var L = rc.forecast.estimates.layers;
    var written = L.authoring_units_per_day, done = L.observed_completion_units_per_day;
    var stop = L.observed_stop_authoring || {}, cont = L.observed_continue_authoring || {};
    var day = TC.dayYear(rc.forecast.last_full_day);
    // One format for both rates, monotone in the value, so the tile cannot reverse their order.
    function rate(n) { return n >= 100 ? TC.fmt(n) : TC.fmt1(n); }
    var text = TC.fmt(L.backlog) + " roadmap " + (L.backlog === 1 ? "layer is" : "layers are") + " not yet recorded done. ";
    if (done === undefined || done === null) {
      var why = done === undefined ? "this data snapshot predates the observed rates" : "the roadmap history does not yet cover a whole week";
      TC.set("runway", "—", why);
      TC.$("#runway-text").textContent = text + "There are no observed rates or runway estimate yet: " + why + ".";
      return;
    }
    TC.set("runway", rate(written) + " vs " + rate(done), "7 days to " + day + "; " + TC.fmt(L.backlog) + " layers left");
    text += "Over the seven days to " + day + ", new layers were written at " + rate(written) + " a day and layers were completed at " +
      rate(done) + " a day, net of reopenings. ";
    if (stop.state === "exhausted") text += "No layers are waiting to be done.";
    else if (stop.state === "finite") {
      text += "As a rough model, at that completion pace the agents would finish the current layers in about " + TC.fmt(stop.days) +
        " days if no new roadmap work were added. ";
      if (cont.state === "finite") text += "With roadmaps still being written at the same rate, it would take about " + TC.fmt(cont.days) + " days.";
      else if (written > done) text += "But authoring currently outpaces completion, so the backlog is growing and that estimate is not a forecast.";
      else text += "But authoring keeps pace with completion, so at these rates the backlog would not shrink.";
    } else {
      text += "With no net completions, the rough model gives no estimate" + (written > 0 ? ", and the backlog is growing." : ".");
    }
    TC.$("#runway-text").textContent = text;
  }).catch(function (e) { TC.fail("#runway-text", e); TC.set("runway", "—"); });

  TC.local("ci-current.json").then(function (c) {
    function list(o) {
      var k = Object.keys(o || {});
      return k.length ? k.map(function (p) { return o[p] + " on " + p; }).join(", ") : "none";
    }
    var run = Object.values(c.running || {}).reduce(function (a, b) { return a + b; }, 0);
    var q = Object.values(c.queued || {}).reduce(function (a, b) { return a + b; }, 0);
    // `as_of` is how current the CI service's counts are; it can trail the manifest's `generated_at`.
    TC.$("#ci-now").textContent = "In the CI service's counts at the last site build (as of " + TC.ago(c.as_of || c.generated_at || c.fetched_at) + "), " + run + " CI " + (run === 1 ? "job was" : "jobs were") + " running (" + list(c.running) +
      ") and " + q + (q === 1 ? " was" : " were") + " queued" + (q ? " (" + list(c.queued) + ")" : "") + ".";
    // The CI service's own chart URLs are newer than the copies static/ holds from the last build.
    TC.$$("[data-ci-asset]").forEach(function (img) {
      var u = (c.assets || {})[img.getAttribute("data-ci-asset")];
      if (u) img.src = u;
    });
  }).catch(function () { TC.$("#ci-now").textContent = "Current job counts are unavailable."; });
});
