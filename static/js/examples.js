/* examples.html: data/roadmap-examples.json, grouped by the arXiv category progress.json gives each roadmap. */
document.addEventListener("DOMContentLoaded", function () {
  "use strict";
  var TC = window.TC;

  Promise.all([TC.local("roadmap-examples.json"), TC.live("progress.json").catch(function () { return { rows: [] }; })]).then(function (r) {
    var ex = r[0].examples, rows = {};
    r[1].rows.forEach(function (row) { rows[row.id] = row; });
    var groups = {};
    ex.forEach(function (e) {
      var row = rows["Completed/" + e.roadmap] || rows[e.roadmap] || {};
      e.row = row;
      (groups[row.topic || "Other"] = groups[row.topic || "Other"] || []).push(e);
    });
    var names = Object.keys(groups).sort();
    TC.$("#examples-meta").textContent = ex.length + " roadmaps. Statements as the API documentation printed them, " + TC.ago(r[0].generated_at) + ".";
    TC.$("#examples-nav").replaceChildren.apply(TC.$("#examples-nav"), names.map(function (n) {
      return TC.el("a", { href: "#" + slug(n), text: n + " (" + groups[n].length + ")" });
    }));
    var box = TC.$("#examples");
    box.replaceChildren();
    names.forEach(function (n) {
      box.append(TC.el("h2", { id: slug(n), text: n }));
      groups[n].sort(function (a, b) { return a.title.localeCompare(b.title); }).forEach(function (e) {
        box.append(TC.exampleCard(e, e.row));
      });
    });
    if (location.hash) { var t = document.getElementById(decodeURIComponent(location.hash.slice(1))); if (t) t.scrollIntoView(); }
  }).catch(function (e) { TC.fail("#examples", e); });

  function slug(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-"); }
});
