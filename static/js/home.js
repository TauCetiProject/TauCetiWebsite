document.addEventListener("DOMContentLoaded", function () {
  "use strict";
  var TC = window.TC;

  TC.live("roadmap-completion.json").then(function (rc) {
    var f = rc.forecast;
    TC.set("loc", TC.fmt(f.library_lines), "as of " + TC.dayYear(f.last_full_day));
    var h = rc.history[rc.history.length - 1];
    TC.set("roadmaps", TC.fmt(h.roadmaps), h.completed_roadmaps + " archived as complete, as of " + TC.dayYear(h.date));
  }).catch(function (e) { TC.set("loc", "—"); TC.set("roadmaps", "—"); console.error(e); });

  TC.live("progress.json").then(function (p) {
    TC.set("merged", TC.fmt(p.global.total), TC.fmt(p.global.open) + " open now");
  }).catch(function (e) { TC.set("merged", "—"); console.error(e); });

  // Tau Ceti Review's own counts, from the data/ its app reads.
  var review = TC.$("[data-review-data]");
  if (review) fetch(review.getAttribute("data-review-data") + "meta.json")
    .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)); })
    .then(function (m) {
      var c = m.counts;
      TC.set("r-decls", TC.fmt(c.declarations));
      TC.set("r-reviewed", TC.fmt(c.reviewed));
      TC.set("r-people", TC.fmt(c.accepts.people));
      TC.set("r-problems", TC.fmt(c.problems));
    })
    .catch(function (e) { ["r-decls", "r-reviewed", "r-people", "r-problems"].forEach(function (k) { TC.set(k, "—"); }); console.error(e); });
});
