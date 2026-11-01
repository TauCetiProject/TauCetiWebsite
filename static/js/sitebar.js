/* The top bar: its dropdowns, its menu on narrow screens, and the light or dark theme. The theme
   choice is kept under "tauceti:theme", which the review app reads too; the page's <head> applies it
   before first paint. A group is a disclosure: its button shows or hides a list of links. */
(function () {
  "use strict";
  var KEY = "tauceti:theme";
  var root = document.documentElement;
  var narrow = window.matchMedia("(max-width: 760px)");

  function label(btn) {
    var next = root.dataset.theme === "light" ? "dark" : "light";
    btn.setAttribute("aria-label", "Switch to " + next + " mode");
    btn.title = "Switch to " + next + " mode";
  }

  document.addEventListener("DOMContentLoaded", function () {
    var bar = document.querySelector(".site-nav");
    if (!bar) return;
    var groups = Array.prototype.slice.call(bar.querySelectorAll(".nav-group > .nav-top"));

    function close(except) {
      groups.forEach(function (b) { if (b !== except && !narrow.matches) b.setAttribute("aria-expanded", "false"); });
    }
    function open(b, focusFirst) {
      close(b);
      b.setAttribute("aria-expanded", "true");
      if (focusFirst) { var first = b.nextElementSibling.querySelector("a"); if (first) first.focus(); }
    }

    // On a narrow screen every group is shown under the Menu button, its name a heading, not a control.
    function layout() {
      groups.forEach(function (b) {
        if (narrow.matches) { b.setAttribute("aria-expanded", "true"); b.setAttribute("tabindex", "-1"); }
        else { b.setAttribute("aria-expanded", "false"); b.removeAttribute("tabindex"); }
      });
    }
    layout();
    if (narrow.addEventListener) narrow.addEventListener("change", layout);

    groups.forEach(function (b) {
      var group = b.parentElement, menu = b.nextElementSibling;
      b.addEventListener("click", function () {
        if (narrow.matches) return;
        if (b.getAttribute("aria-expanded") === "true") b.setAttribute("aria-expanded", "false");
        else open(b, false);
      });
      b.addEventListener("keydown", function (e) {
        if (e.key === "ArrowDown" && !narrow.matches) { e.preventDefault(); open(b, true); }
      });
      menu.addEventListener("keydown", function (e) {
        var links = Array.prototype.slice.call(menu.querySelectorAll("a")), i = links.indexOf(document.activeElement);
        if (e.key === "ArrowDown" && i >= 0) { e.preventDefault(); links[(i + 1) % links.length].focus(); }
        if (e.key === "ArrowUp" && i >= 0) { e.preventDefault(); links[(i - 1 + links.length) % links.length].focus(); }
      });
      // A link to a section of this page leaves the menu open over it; close it.
      menu.addEventListener("click", function (e) { if (e.target.closest("a") && !narrow.matches) b.setAttribute("aria-expanded", "false"); });
      group.addEventListener("focusout", function (e) {
        if (!narrow.matches && !group.contains(e.relatedTarget)) b.setAttribute("aria-expanded", "false");
      });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      var openBtn = groups.filter(function (b) { return b.getAttribute("aria-expanded") === "true"; })[0];
      if (openBtn && !narrow.matches) { openBtn.setAttribute("aria-expanded", "false"); openBtn.focus(); }
    });
    document.addEventListener("click", function (e) { if (!bar.contains(e.target)) close(null); });

    // The narrow-screen drawer. Its links come before the Menu button in the page, so opening it moves
    // focus into it, and closing it by Escape returns focus to the button.
    var menuBtn = bar.querySelector(".nav-toggle"), links = bar.querySelector(".nav-links");
    function drawer(open, refocus) {
      links.classList.toggle("open", open);
      menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) { var first = links.querySelector("a"); if (first) first.focus(); }
      else if (refocus) menuBtn.focus();
    }
    if (menuBtn && links) {
      menuBtn.addEventListener("click", function () { drawer(!links.classList.contains("open"), false); });
      links.addEventListener("click", function (e) { if (e.target.closest("a") && narrow.matches) drawer(false, false); });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && links.classList.contains("open")) drawer(false, true);
      });
      document.addEventListener("click", function (e) {
        if (links.classList.contains("open") && !bar.contains(e.target)) drawer(false, false);
      });
      if (narrow.addEventListener) narrow.addEventListener("change", function () { if (!narrow.matches) drawer(false, false); });
    }

    var theme = bar.querySelector(".theme-toggle");
    if (!theme) return;
    label(theme);
    theme.addEventListener("click", function () {
      var next = root.dataset.theme === "light" ? "dark" : "light";
      root.dataset.theme = next;
      try { localStorage.setItem(KEY, next); } catch (e) { /* kept for this page only */ }
      label(theme);
      document.dispatchEvent(new CustomEvent("tc-theme", { detail: next }));
    });
  });
})();
