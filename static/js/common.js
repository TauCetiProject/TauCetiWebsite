/* Shared helpers: data loading, number formats, and the two chart forms the site uses
   (time series with a crosshair tooltip, and labelled horizontal bars). No dependencies. */
(function () {
  "use strict";

  // taucetiproject.org publishes its generated data with `Access-Control-Allow-Origin: *`.
  var LIVE = "https://taucetiproject.org/static/";
  var cache = {};

  function getJSON(url) {
    if (!cache[url]) {
      cache[url] = fetch(url, { cache: "no-cache" }).then(function (r) {
        if (!r.ok) throw new Error(url + ": HTTP " + r.status);
        return r.json();
      });
    }
    return cache[url];
  }

  var TC = (window.TC = {
    LIVE: LIVE,
    live: function (name) { return getJSON(LIVE + name); },
    local: function (name) { return getJSON("data/" + name); },
    ROADMAP_BLOB: "https://github.com/TauCetiProject/TauCetiRoadmap/blob/main/",
    GH: "https://github.com/",
  });

  /* ---------- formats ---------- */
  var nf = new Intl.NumberFormat("en-US");
  TC.fmt = function (n) { return n == null || isNaN(n) ? "—" : nf.format(Math.round(n)); };
  TC.fmt1 = function (n) { return n == null || isNaN(n) ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 1 }); };
  TC.compact = function (n) {
    if (n == null || isNaN(n)) return "—";
    var a = Math.abs(n);
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, "") + "M";
    if (a >= 1e4) return Math.round(n / 1e3) + "k";
    if (a >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "k";
    return String(Math.round(n));
  };
  TC.pct = function (x) { return x == null || isNaN(x) ? "—" : Math.round(x * 100) + "%"; };
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  TC.day = function (iso) {
    var d = new Date(iso.length === 10 ? iso + "T00:00:00Z" : iso);
    return MONTHS[d.getUTCMonth()] + " " + d.getUTCDate();
  };
  TC.dayYear = function (iso) {
    var d = new Date(iso.length === 10 ? iso + "T00:00:00Z" : iso);
    return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()] + " " + d.getUTCFullYear();
  };
  TC.ago = function (iso) {
    var s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 90) return "just now";
    if (s < 5400) return Math.round(s / 60) + " minutes ago";
    if (s < 129600) return Math.round(s / 3600) + " hours ago";
    return Math.round(s / 86400) + " days ago";
  };
  TC.hours = function (h) {
    if (h == null || isNaN(h)) return "—";
    if (h < 1) return Math.round(h * 60) + " min";
    if (h < 48) return TC.fmt1(h) + " h";
    return TC.fmt1(h / 24) + " days";
  };

  /* ---------- DOM ---------- */
  TC.el = function (tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === "text") e.textContent = attrs[k];
      else if (k === "class") e.className = attrs[k];
      else if (k === "style") e.setAttribute("style", attrs[k]);
      else if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    }
    (children || []).forEach(function (c) { if (c != null) e.append(c); });
    return e;
  };
  TC.$ = function (sel, root) { return (root || document).querySelector(sel); };
  TC.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  TC.set = function (key, value, detail) {
    TC.$$('[data-stat="' + key + '"]').forEach(function (t) {
      t.classList.remove("loading");
      var v = t.querySelector(".v");
      if (v) v.textContent = value; else t.textContent = value;
      var d = t.querySelector(".d");
      if (d && detail != null) d.textContent = detail;
    });
  };
  TC.fail = function (target, err) {
    console.error(err);
    if (typeof target === "string") target = TC.$(target);
    if (target) target.replaceChildren(TC.el("p", { class: "error small", text: "Could not load this data (" + (err && err.message || err) + ")." }));
  };

  // CSS variables rather than values, so a theme switch recolours every chart without redrawing it.
  TC.SERIES = ["--s1", "--s2", "--s3", "--s4", "--s5", "--s6", "--s7", "--s8"].map(function (v) { return "var(" + v + ")"; });
  TC.OTHER = "var(--s-other)";

  /* ---------- time series ---------- */
  var SVGNS = "http://www.w3.org/2000/svg";
  // A var() colour goes in style: SVG presentation attributes do not resolve CSS variables everywhere.
  function s(tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) {
      if ((k === "fill" || k === "stroke") && String(attrs[k]).indexOf("var(") === 0) e.style[k] = attrs[k];
      else e.setAttribute(k, attrs[k]);
    }
    return e;
  }
  function niceMax(v) {
    if (v <= 0) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p;
    var step = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
    return step * p;
  }

  /* opts: dates (ISO days), series [{name, values, color, dash, note}], stacked, area,
     yFormat, tipFormat, height, legend (default: when ≥ 2 series), markers [{date, label}] */
  /* A time chart with a range control (30 days, 90 days, all, when the series is long enough for them
     to differ) and a footnote saying how fresh it is and how to read it by keyboard. opts as plot()'s,
     plus updated (an ISO time; else the last date is given) and ranges: false. */
  TC.timeChart = function (container, opts) {
    if (typeof container === "string") container = TC.$(container);
    container.replaceChildren();
    var n = opts.dates.length;
    var body = TC.el("div");
    var choices = [["30 days", 30], ["90 days", 90], ["All", 0]].filter(function (c) { return !c[1] || c[1] < n - 10; });
    if (opts.ranges !== false && choices.length > 1) {
      var group = TC.el("div", { class: "range", role: "group", "aria-label": "Time range" });
      choices.forEach(function (c) {
        var b = TC.el("button", { type: "button", "aria-pressed": c[1] ? "false" : "true", text: c[0] });
        b.addEventListener("click", function () {
          TC.$$("button", group).forEach(function (o) { o.setAttribute("aria-pressed", o === b ? "true" : "false"); });
          show(c[1]);
        });
        group.append(b);
      });
      container.append(group);
    }
    container.append(body);
    var when = opts.updated ? "Updated " + TC.dayYear(opts.updated) + ", " + opts.updated.slice(11, 16) + " UTC" : "Through " + TC.dayYear(opts.dates[n - 1]);
    container.append(TC.el("p", { class: "chart-foot", text: when + " · Hover for values, or focus the chart and use ← → to step through it." }));
    function show(days) {
      var lo = days ? Math.max(0, n - days) : 0;
      plot(body, Object.assign({}, opts, {
        dates: opts.dates.slice(lo),
        series: opts.series.map(function (sr) { return Object.assign({}, sr, { values: sr.values.slice(lo) }); }),
      }));
    }
    show(0);
  };

  function plot(container, opts) {
    container.replaceChildren();
    container.classList.add("chart");
    var series = opts.series, dates = opts.dates, n = dates.length;
    var yFormat = opts.yFormat || TC.compact, tipFormat = opts.tipFormat || TC.fmt;
    if (opts.legend !== false && series.length > 1) {
      container.append(TC.el("div", { class: "legend" }, series.map(function (sr) {
        return TC.el("span", null, [TC.el("i", { class: opts.area || opts.stacked ? "" : "line", style: "background:" + sr.color }), sr.name]);
      })));
    }
    var host = TC.el("div", { style: "position:relative" });
    var tip = TC.el("div", { class: "tooltip", role: "status" });
    host.append(tip);
    container.append(host);

    // Stacked series draw cumulative bands; first series at the bottom.
    var tops = series.map(function () { return new Array(n); });
    for (var t = 0; t < n; t++) {
      var acc = 0;
      for (var k = 0; k < series.length; k++) {
        var v = series[k].values[t];
        acc = opts.stacked ? acc + (v || 0) : v;
        tops[k][t] = acc;
      }
    }

    function draw() {
      var W = Math.max(280, host.clientWidth || container.clientWidth || 600);
      var H = opts.height || (W < 520 ? 240 : 300);
      var m = { l: 46, r: 14, t: 10, b: 26 };
      var w = W - m.l - m.r, h = H - m.t - m.b;
      var ymax = opts.yMax;
      if (ymax == null) {
        ymax = 0;
        tops.forEach(function (arr) { arr.forEach(function (v) { if (v > ymax) ymax = v; }); });
        ymax = niceMax(ymax * 1.04);
      }
      var x = function (i) { return m.l + (n <= 1 ? w / 2 : (i / (n - 1)) * w); };
      var y = function (v) { return m.t + h - (Math.max(0, v) / ymax) * h; };
      var svg = s("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, role: "img", "aria-label": opts.label || "chart" });
      // grid + y axis
      var ticks = 4;
      for (var g = 0; g <= ticks; g++) {
        var val = (ymax / ticks) * g, yy = y(val);
        svg.append(s("line", { class: g === 0 ? "baseline" : "gridline", x1: m.l, x2: m.l + w, y1: yy, y2: yy }));
        var tx = s("text", { class: "axis", x: m.l - 6, y: yy + 3.5, "text-anchor": "end" });
        tx.textContent = yFormat(val);
        svg.append(tx);
      }
      // x labels
      var want = Math.max(2, Math.min(7, Math.floor(w / 95)));
      for (var q = 0; q < want; q++) {
        var idx = Math.round((q / (want - 1)) * (n - 1));
        var lx = s("text", { class: "axis", x: x(idx), y: H - 6, "text-anchor": q === 0 ? "start" : q === want - 1 ? "end" : "middle" });
        lx.textContent = TC.day(dates[idx]);
        svg.append(lx);
      }
      (opts.markers || []).forEach(function (mk) {
        var i = dates.indexOf(mk.date);
        if (i < 0) return;
        svg.append(s("line", { class: "gridline", x1: x(i), x2: x(i), y1: m.t, y2: m.t + h, "stroke-dasharray": "3 3" }));
      });
      // bands (stacked) draw top-down so lower bands paint over; areas get a 1.5px surface seam
      for (var k2 = series.length - 1; k2 >= 0; k2--) {
        var sr = series[k2], top = tops[k2];
        var line = "";
        for (var i2 = 0; i2 < n; i2++) if (top[i2] != null) line += (line ? "L" : "M") + x(i2).toFixed(1) + "," + y(top[i2]).toFixed(1);
        if (opts.stacked || opts.area) {
          var below = opts.stacked && k2 > 0 ? tops[k2 - 1] : null, back = "";
          for (var j = n - 1; j >= 0; j--) back += "L" + x(j).toFixed(1) + "," + y(below ? below[j] : 0).toFixed(1);
          svg.append(s("path", { d: line + back + "Z", fill: sr.color, "fill-opacity": opts.stacked ? 0.88 : 0.18 }));
          svg.append(s("path", { d: line, fill: "none", stroke: opts.stacked ? "var(--surface)" : sr.color, "stroke-width": opts.stacked ? 1.5 : 2 }));
        } else {
          svg.append(s("path", { d: line, fill: "none", stroke: sr.color, "stroke-width": 2, "stroke-dasharray": sr.dash || "", "stroke-linejoin": "round", "stroke-linecap": "round" }));
        }
      }
      // direct label on the last point of a lone, unstacked series
      if (series.length === 1 && opts.endLabel !== false) {
        var last = series[0].values[n - 1];
        var el = s("text", { class: "label", x: x(n - 1) - 4, y: y(last) - 8, "text-anchor": "end" });
        el.textContent = TC.fmt(last);
        svg.append(el);
      }
      var cross = s("line", { class: "crosshair", x1: 0, x2: 0, y1: m.t, y2: m.t + h, visibility: "hidden" });
      svg.append(cross);
      var dots = series.map(function (sr) {
        var c = s("circle", { r: 4, fill: sr.color, stroke: "var(--surface)", "stroke-width": 2, visibility: "hidden" });
        svg.append(c);
        return c;
      });
      var hit = s("rect", { x: m.l, y: m.t, width: w, height: h, fill: "transparent", tabindex: 0 });
      svg.append(hit);
      var old = host.querySelector("svg");
      if (old) old.remove();
      host.insertBefore(svg, tip);

      function show(i) {
        var cx = x(i);
        cross.setAttribute("x1", cx); cross.setAttribute("x2", cx); cross.setAttribute("visibility", "visible");
        tip.replaceChildren(TC.el("div", { class: "t", text: TC.dayYear(dates[i]) }));
        var order = series.map(function (_, k) { return k; });
        if (opts.stacked) order.reverse();
        order.forEach(function (k) {
          var v = series[k].values[i];
          dots[k].setAttribute("cx", cx); dots[k].setAttribute("cy", y(tops[k][i]));
          dots[k].setAttribute("visibility", v == null ? "hidden" : "visible");
          tip.append(TC.el("div", { class: "r" }, [
            TC.el("i", { class: "key", style: "background:" + series[k].color }),
            TC.el("b", { text: tipFormat(v) }),
            TC.el("em", { text: series[k].name }),
          ]));
        });
        if (opts.stacked && opts.total !== false) {
          tip.append(TC.el("div", { class: "r" }, [TC.el("span"), TC.el("b", { text: tipFormat(tops[series.length - 1][i]) }), TC.el("em", { text: "total" })]));
        }
        var scale = host.clientWidth / W;
        var left = cx * scale + 14, tw = tip.offsetWidth || 180;
        if (left + tw > host.clientWidth) left = cx * scale - tw - 14;
        tip.style.left = Math.max(0, left) + "px";
        tip.style.top = Math.max(0, m.t * scale) + "px";
        tip.classList.add("on");
      }
      function hide() {
        cross.setAttribute("visibility", "hidden");
        dots.forEach(function (d) { d.setAttribute("visibility", "hidden"); });
        tip.classList.remove("on");
      }
      var cur = n - 1;
      hit.addEventListener("pointermove", function (ev) {
        var r = svg.getBoundingClientRect();
        var px = ((ev.clientX - r.left) / r.width) * W;
        cur = Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / w) * (n - 1))));
        show(cur);
      });
      hit.addEventListener("pointerleave", hide);
      hit.addEventListener("focus", function () { show(cur); });
      hit.addEventListener("blur", hide);
      hit.addEventListener("keydown", function (ev) {
        if (ev.key === "ArrowLeft") { cur = Math.max(0, cur - 1); show(cur); ev.preventDefault(); }
        if (ev.key === "ArrowRight") { cur = Math.min(n - 1, cur + 1); show(cur); ev.preventDefault(); }
      });
    }
    draw();
    var lastW = host.clientWidth;
    if (window.ResizeObserver) new ResizeObserver(function () {
      if (Math.abs(host.clientWidth - lastW) > 4) { lastW = host.clientWidth; draw(); }
    }).observe(host);
  }

  /* ---------- horizontal bars ---------- */
  /* items: [{label, value, color, href, title, valueText}] */
  TC.bars = function (container, items, opts) {
    opts = opts || {};
    if (typeof container === "string") container = TC.$(container);
    var max = opts.max || Math.max.apply(null, items.map(function (i) { return i.value; }).concat([1]));
    var fmt = opts.format || TC.fmt;
    var wrap = TC.el("div", { class: "bars" });
    items.forEach(function (it) {
      var name = it.href ? TC.el("a", { href: it.href, text: it.label }) : document.createTextNode(it.label);
      // --w is the share of the longest bar; the stylesheet scales it so the value label fits beside it.
      var w = "--w:" + (Math.max(0, it.value) / max * 100).toFixed(2);
      var val = TC.el("span", { class: "val", text: it.valueText || fmt(it.value), style: w });
      wrap.append(TC.el("div", { class: "bar", title: it.title || (it.label + ": " + fmt(it.value)) }, [
        TC.el("div", { class: "name" }, [name]),
        TC.el("div", { class: "track" }, [TC.el("div", { class: "fill", style: w + ";background:" + (it.color || TC.SERIES[0]) }), val]),
      ]));
    });
    container.replaceChildren(wrap);
  };

  /* ---------- Lean highlighting (keywords and comments only) ---------- */
  var KW = /\b(theorem|lemma|def|structure|class|instance|open|in|namespace|end|variable|import|by|fun|let|have|show|from|where|example|noncomputable|abbrev)\b/g;
  TC.highlightLean = function (code) {
    var esc = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    var parts = esc.split(/(\/--[\s\S]*?-\/|--[^\n]*)/g);
    return parts.map(function (p) {
      if (/^(\/--|--)/.test(p)) return '<span class="cm">' + p + "</span>";
      return p.replace(KW, '<span class="kw">$1</span>').replace(/(:=|→|↔|∀|∃|≃ₜ|∧)/g, '<span class="sy">$1</span>');
    }).join("");
  };

  /* ---------- copy buttons ---------- */
  function copyText(text) {
    // The Clipboard API is absent on plain http:// and can refuse an unfocused document;
    // execCommand still works from the click in both cases.
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return legacyCopy(text);
  }
  function legacyCopy(text) {
    return new Promise(function (resolve, reject) {
      var ta = TC.el("textarea", { style: "position:fixed;top:-1000px;opacity:0", readonly: "" });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      var ok = document.execCommand("copy");
      ta.remove();
      ok ? resolve() : reject(new Error("copy failed"));
    });
  }
  // The usual copy glyph (two overlapping sheets) and a check for the moment after.
  var ICONS = {
    copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>',
    done: '<polyline points="20 6 9 17 4 12"></polyline>',
  };
  function setButton(b, icon, label) {
    b.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[icon] + "</svg>";
    b.append(label);
  }
  /* Wraps pre in a .codeblock holding the button, so the button stays put while a long line scrolls.
     Returns the wrapper, which a caller building pre off-document inserts in its place. */
  /* One headline declaration (data/roadmap-examples.json) as a Lean header: its arguments filled into lines of
     at most WIDTH characters, its type on the next, both linked into the API docs as the docs link them.
     The args and type are HTML the build sanitised to text, <a href> and nothing else. */
  TC.exampleBlock = function (e) {
    var WIDTH = 92, probe = document.createElement("span");
    function len(h) { probe.innerHTML = h; return probe.textContent.length; }
    var lines = ['<span class="kw">' + TC.esc(e.kind) + "</span> " + TC.esc(e.name)], width = len(lines[0]);
    e.args.forEach(function (a) {
      var w = len(a);
      if (width + 1 + w > WIDTH) { lines.push("    " + a); width = 4 + w; }
      else { lines[lines.length - 1] += " " + a; width += 1 + w; }
    });
    lines[lines.length - 1] += " :";
    var body = lines.join("\n") + "\n    " + e.type.split("\n").join("\n    ");
    var pre = TC.el("pre", { class: "lean sig" }), code = TC.el("code");
    code.innerHTML = body;
    pre.append(code);
    return TC.copyable(pre);
  };
  // The example as a panel: the result's name, the roadmap it completes (row: its progress.json row, if known),
  // what it says, the statement, and where to find it.
  TC.exampleCard = function (e, row) {
    var title = row && row.title ? row.title.charAt(0).toUpperCase() + row.title.slice(1) : e.roadmap;
    var from = row && row.id
      ? TC.el("a", { href: "roadmap.html?id=" + encodeURIComponent(row.id), text: title })
      : document.createTextNode(title);
    var links = [TC.el("a", { href: e.docs, text: "Documentation" })];
    if (e.source) links.push(document.createTextNode(" · "), TC.el("a", { href: e.source, text: "Source" }));
    links.push(document.createTextNode(" · "), TC.el("code", { text: "import " + e.module }));
    return TC.el("div", { class: "panel example", id: "ex-" + e.roadmap }, [
      TC.el("h3", { text: e.title }),
      TC.el("p", { class: "small muted" }, [document.createTextNode("From the roadmap "), from]),
      TC.el("p", { text: e.summary }),
      TC.exampleBlock(e),
      TC.el("p", { class: "small ex-links" }, links),
    ]);
  };
  TC.esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };

  TC.copyable = function (pre) {
    if (pre.parentNode && pre.parentNode.classList && pre.parentNode.classList.contains("codeblock")) return pre.parentNode;
    var wrap = TC.el("div", { class: "codeblock" });
    if (pre.parentNode) pre.parentNode.insertBefore(wrap, pre);
    wrap.append(pre);
    var b = TC.el("button", { class: "copy", type: "button", title: "Copy to clipboard", "aria-label": "Copy to clipboard" });
    var status = TC.el("span", { class: "sr-only", role: "status" });
    setButton(b, "copy", "Copy");
    var timer;
    b.addEventListener("click", function () {
      var code = pre.querySelector("code") || pre;
      copyText(code.innerText.replace(/\n$/, "")).then(function () {
        setButton(b, "done", "Copied"); b.classList.add("done"); status.textContent = "Copied to the clipboard";
      }, function () { setButton(b, "copy", "Press ⌘C"); status.textContent = "Could not copy; select the text and press ⌘C"; }).then(function () {
        clearTimeout(timer);
        timer = setTimeout(function () { setButton(b, "copy", "Copy"); b.classList.remove("done"); status.textContent = ""; }, 1600);
      });
    });
    wrap.append(b, status);
    return wrap;
  };

  /* ---------- page chrome ---------- */
  document.addEventListener("DOMContentLoaded", function () {
    TC.$$("pre").forEach(TC.copyable);
    // Tabs: only the selected one is in the tab order; the arrow keys, Home and End move between them.
    TC.$$("[data-tabs]").forEach(function (group) {
      var buttons = TC.$$("[role=tab]", group);
      function select(b) {
        buttons.forEach(function (o) {
          var on = o === b;
          o.setAttribute("aria-selected", on ? "true" : "false");
          o.tabIndex = on ? 0 : -1;
          var p = document.getElementById(o.getAttribute("aria-controls"));
          if (p) p.hidden = !on;
        });
      }
      buttons.forEach(function (b, i) {
        b.tabIndex = b.getAttribute("aria-selected") === "true" ? 0 : -1;
        b.addEventListener("click", function () { select(b); });
        b.addEventListener("keydown", function (e) {
          var j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: buttons.length - 1 }[e.key];
          if (j === undefined) return;
          e.preventDefault();
          var next = buttons[(j + buttons.length) % buttons.length];
          select(next); next.focus();
        });
      });
    });
  });
})();
