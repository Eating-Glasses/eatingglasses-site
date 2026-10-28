/* eatingglasses.com/feedback: the personal feedback form (S82; tester feedback kit v4, approved by Justin 10-28).
 *
 * A tester arrives from an email at /feedback/?t=<token>. This script asks the feedback-submit Edge Function what that link opens ({action:"check"}), draws the
 * form it answers with, and posts the answers back. THE PAGE HOLDS NO QUESTION TEXT: the wording, the options, the order and the validation live in one place,
 * cd-preview/supabase-functions/feedback-submit/forms.ts, and arrive here as data, so the page can never drift from the approved questions.
 *
 * Everything the server sends is put on the page with textContent, never as HTML. The token is read from the address, held in memory, and sent only to the
 * feedback-submit function. An in-progress form is kept in sessionStorage (this tab only, gone when it closes) so a reload does not lose five minutes of work;
 * it holds answers, never the token, and is cleared once they are sent.
 *
 * Written as one file with no build step, like the rest of the site, and loadable in Node for tests (module.exports) as well as in the browser (window.EGFeedback).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.EGFeedback = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // PRD Supabase project. The publishable key is public by design (it is also in /beta); feedback-submit is deployed without JWT verification and checks the token.
  var API_URL = "https://pnnqxzqpfjsliwymmecv.supabase.co/functions/v1/feedback-submit";
  var PUBLISHABLE_KEY = "sb_publishable_eI0ziX_WG6M2UepQG4lM7Q_i8IbS3Dk";
  var TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

  // What a tester reads when a link opens no form. Plain, no blame, and the actors are You and Eating Glasses.
  var MESSAGES = {
    missing: { title: "This page needs your personal link", body: "Open the link from your email." },
    invalid: { title: "This link does not work", body: "Open the link from your email again. If it still does not work, reply to that email and Eating Glasses will send you a new one." },
    expired: { title: "This link has expired", body: "Reply to the email it came in and Eating Glasses will send you a new one." },
    used: { title: "You already sent this one", body: "Thank you. Every answer is read." },
    error: { title: "The form did not load", body: "Check your connection and reload the page. If it keeps happening, reply to the email and Eating Glasses will look into it." }
  };
  var NOT_SENT = "Your answers were not sent. Check your connection and try again.";
  var SOMETHING_WRONG = "Something went wrong. Please try again in a moment.";
  var FORM_WRONG = "Something is wrong with the answers. Reload the page and try again.";

  // ── the link ──────────────────────────────────────────────────────────────────────────────────────────────────
  function tokenFromSearch(search) {
    var raw = null;
    try { raw = new URLSearchParams(search || "").get("t"); } catch (e) { return null; }
    return raw && TOKEN_RE.test(raw) ? raw : null;
  }

  // ── the server ────────────────────────────────────────────────────────────────────────────────────────────────
  function classify(http, j) {
    j = j || {};
    if (j.ok === true && j.form) return { kind: "form", form: j.form };
    if (j.ok === true && j.status === "saved") return { kind: "saved" };
    if (j.status === "invalid" && http === 404) return { kind: "invalid" };
    if (j.status === "used") return { kind: "used" };
    if (j.status === "expired") return { kind: "expired" };
    if (j.status === "invalid_answers") return { kind: "invalid_answers", errors: j.errors || {} };
    return { kind: "error" }; // a 5xx, a 403, a platform 404 (the function is not there), a non-JSON answer
  }

  function createApi(fetchFn, cfg) {
    cfg = cfg || {};
    var url = cfg.url || API_URL;
    var key = cfg.key || PUBLISHABLE_KEY;
    function post(body) {
      return fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": key, "Authorization": "Bearer " + key },
        body: JSON.stringify(body)
      }).then(function (res) {
        return res.json().then(function (j) { return classify(res.status, j); }, function () { return { kind: "error" }; });
      }, function () { return { kind: "error" }; });
    }
    return {
      check: function (token) { return post({ action: "check", token: token }); },
      submit: function (token, answers) { return post({ token: token, answers: answers }); }
    };
  }

  // ── the answers ───────────────────────────────────────────────────────────────────────────────────────────────
  function isObj(v) { return typeof v === "object" && v !== null && !Array.isArray(v); }
  function trim(s) { return typeof s === "string" ? s.replace(/^\s+|\s+$/g, "") : ""; }
  function indexOf(arr, v) { return arr ? arr.indexOf(v) : -1; }

  function createState(form, initial) {
    var qs = form.questions;
    var a = {};
    var listeners = [];
    var allowed = {};
    qs.forEach(function (q) {
      if (q.type === "pair") q.parts.forEach(function (p) { allowed[p.id] = true; });
      else allowed[q.id] = true;
      if (q.follow) allowed[q.id + "_t"] = true;
    });
    if (isObj(initial)) Object.keys(initial).forEach(function (k) { if (allowed[k]) a[k] = initial[k]; });

    function isShown(q) {
      if (q.type !== "multi" || !q.showIf) return true;
      var v = a[q.showIf.id];
      return typeof v === "string" && v !== "" && indexOf(q.showIf.unless, v) < 0;
    }
    function followOpen(q) {
      if (!q.follow) return false;
      var v = a[q.id];
      if (q.follow.when) return typeof v === "string" && indexOf(q.follow.when, v) >= 0;
      if (typeof q.follow.lte === "number") return typeof v === "number" && v <= q.follow.lte;
      return false;
    }
    function rank(q) {
      var v = a[q.id];
      return isObj(v) && Array.isArray(v.order) && Array.isArray(v.unused) ? v : { order: [], unused: [] };
    }
    function isAnswered(q) {
      var v = a[q.id];
      if (q.type === "rank") { var r = rank(q); return r.order.length + r.unused.length === q.items.length; }
      if (q.type === "pair") return q.parts.every(function (p) { return a[p.id] === "yes" || a[p.id] === "no"; });
      if (q.type === "multi") return Array.isArray(v) && v.length > 0;
      if (q.type === "open") return trim(v) !== "";
      return v !== undefined && v !== null && v !== "";
    }
    function changed() { listeners.forEach(function (fn) { fn(); }); }

    return {
      form: form,
      questions: qs,
      isShown: isShown,
      followOpen: followOpen,
      isAnswered: isAnswered,
      get: function (key) { return a[key]; },
      set: function (key, value) { a[key] = value; changed(); },
      rank: rank,
      rankPlace: function (q, key) { // tap a part: place it next in the order, or take it back out
        var r = rank(q); var order = r.order.slice(); var i = order.indexOf(key);
        if (i >= 0) order.splice(i, 1); else if (r.unused.indexOf(key) < 0) order.push(key);
        a[q.id] = { order: order, unused: r.unused.slice() }; changed();
      },
      rankUnused: function (q, key, on) { // "Haven't used it": out of the ranking, into the unused list
        var r = rank(q); var order = r.order.slice(); var unused = r.unused.slice();
        var oi = order.indexOf(key); var ui = unused.indexOf(key);
        if (on) { if (oi >= 0) order.splice(oi, 1); if (ui < 0) unused.push(key); } else if (ui >= 0) unused.splice(ui, 1);
        a[q.id] = { order: order, unused: unused }; changed();
      },
      toggleMulti: function (q, key, on) {
        var cur = Array.isArray(a[q.id]) ? a[q.id].slice() : []; var i = cur.indexOf(key);
        if (on && i < 0) cur.push(key); if (!on && i >= 0) cur.splice(i, 1);
        a[q.id] = cur; changed();
      },
      subscribe: function (fn) { listeners.push(fn); },
      // the required questions that are shown and not answered
      missing: function () {
        return qs.filter(function (q) { return q.req && isShown(q) && !isAnswered(q); }).map(function (q) { return q.id; });
      },
      progress: function () {
        var shown = qs.filter(isShown);
        return { answered: shown.filter(isAnswered).length, total: shown.length };
      },
      // exactly what is sent: shown questions only, text trimmed, nothing empty, a follow-up box only when its answer opens it
      payload: function () {
        var out = {};
        qs.forEach(function (q) {
          if (!isShown(q)) return;
          if (q.type === "pair") { q.parts.forEach(function (p) { if (a[p.id] === "yes" || a[p.id] === "no") out[p.id] = a[p.id]; }); return; }
          var v = a[q.id];
          if (q.type === "open") { if (trim(v) !== "") out[q.id] = trim(v); return; }
          if (q.type === "rank") { var r = rank(q); if (r.order.length + r.unused.length > 0) out[q.id] = { order: r.order.slice(), unused: r.unused.slice() }; return; }
          if (q.type === "multi") { if (Array.isArray(v) && v.length > 0) out[q.id] = v.slice(); return; }
          if (v === undefined || v === null || v === "") return;
          out[q.id] = v;
          if (q.follow && followOpen(q) && trim(a[q.id + "_t"]) !== "") out[q.id + "_t"] = trim(a[q.id + "_t"]);
        });
        return out;
      },
      snapshot: function () { return JSON.parse(JSON.stringify(a)); }
    };
  }

  // ── the draft kept in this tab ────────────────────────────────────────────────────────────────────────────────
  function sessionDraft(storage, token) {
    var h = 5381; // a short fingerprint of the token, so the key never holds the token itself
    for (var i = 0; i < token.length; i++) h = ((h << 5) + h + token.charCodeAt(i)) | 0;
    var key = "eg_feedback_draft:" + (h >>> 0).toString(16);
    return {
      load: function () { try { return JSON.parse(storage.getItem(key)); } catch (e) { return null; } },
      save: function (answers) { try { storage.setItem(key, JSON.stringify(answers)); } catch (e) { /* private mode, full: the form still works */ } },
      clear: function () { try { storage.removeItem(key); } catch (e) { /* nothing to clear */ } }
    };
  }

  // ── the flow: link -> check -> form -> submit -> thank you, or a plain message ───────────────────────────────
  // env: { token, api, ui, draft? }. Returns a promise of how it ended; every step goes through ui, so a test can watch it with a fake.
  function start(env) {
    var ui = env.ui, api = env.api, token = env.token, draft = env.draft || null;
    if (!token) { ui.message("missing"); return Promise.resolve("missing"); }
    ui.loading();
    return api.check(token).then(function (r) {
      if (r.kind !== "form") { ui.message(r.kind === "saved" ? "error" : r.kind); return r.kind; }
      var form = r.form;
      var state = createState(form, draft ? draft.load() : null);
      if (draft) state.subscribe(function () { draft.save(state.snapshot()); });
      var sending = false;
      function submit() {
        if (sending) return Promise.resolve("busy"); // a double tap sends once
        var missing = state.missing();
        if (missing.length) { ui.showMissing(missing); return Promise.resolve("missing_answers"); }
        sending = true; ui.busy(true);
        return api.submit(token, state.payload()).then(function (res) {
          sending = false; ui.busy(false);
          if (res.kind === "saved") { if (draft) draft.clear(); ui.thanks(form.thanks); return "saved"; }
          if (res.kind === "invalid_answers") { ui.serverErrors(res.errors); return "invalid_answers"; }
          if (res.kind === "used" || res.kind === "expired" || res.kind === "invalid") { ui.message(res.kind); return res.kind; }
          ui.banner(NOT_SENT); return "error";
        });
      }
      ui.form(form, state, submit);
      return "form";
    });
  }

  // ── the page ──────────────────────────────────────────────────────────────────────────────────────────────────
  function createDomUi(doc, app) {
    var model = null; // { form, state, blocks, banner, progress, button, submit }

    function el(tag, attrs, kids) {
      var n = doc.createElement(tag);
      Object.keys(attrs || {}).forEach(function (k) {
        var v = attrs[k];
        if (v === false || v === null || v === undefined) return;
        if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else n.setAttribute(k, v === true ? "" : v);
      });
      (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? doc.createTextNode(c) : c); });
      return n;
    }
    function clear() { while (app.firstChild) app.removeChild(app.firstChild); model = null; }
    function focus(n) { if (n && n.focus) { try { n.focus({ preventScroll: false }); } catch (e) { n.focus(); } } }
    function reveal(n) { if (n && n.scrollIntoView) n.scrollIntoView({ block: "center" }); }

    function card(title, body, kind) {
      clear();
      var h = el("h2", { class: "fb-h", tabindex: "-1", text: title });
      app.appendChild(el("div", { class: "fb-msg " + (kind || "") }, [h, el("p", { text: body })]));
      focus(h);
    }

    function chip(type, name, id, value, label, checked, onChange) {
      var input = el("input", { type: type, name: name, id: id, value: value, checked: checked });
      input.addEventListener("change", function () { onChange(input.checked); });
      return el("span", { class: "chip" }, [input, el("label", { for: id, text: label })]);
    }

    // ── one block per question ────────────────────────────────────────────────────────────────────────────────
    function buildBlock(q, state, refresh) {
      var lbl = "lbl-" + q.id;
      var num = el("span", { class: "q-n", "aria-hidden": "true" });
      var title = q.type === "pair" ? q.parts[0].text : q.text;
      var head = el("div", { class: "q", id: lbl }, [num, el("span", { class: "qt" }, [title, q.req ? el("span", { class: "req", "aria-hidden": "true", text: " *" }) : null])]);
      var block = el("div", { class: "fq", id: "fq-" + q.id, "data-q": q.id });
      block.appendChild(head);
      if (q.pre) block.appendChild(el("p", { class: "q-pre", text: q.pre }));
      var err = el("span", { class: "errtext", id: "err-" + q.id, hidden: true });
      var body = el("div", { class: "fq-body" });
      block.appendChild(body);
      var follow = null;

      if (q.type === "choice") {
        var g = el("div", { class: "chips", role: "group", "aria-labelledby": lbl, "aria-required": q.req ? "true" : false });
        q.opts.forEach(function (o) { g.appendChild(chip("radio", "q-" + q.id, "q-" + q.id + "-" + o[0], o[0], o[1], state.get(q.id) === o[0], function () { state.set(q.id, o[0]); refresh(); })); });
        body.appendChild(g);
      } else if (q.type === "scale") {
        var sc = el("div", { class: "scale", role: "group", "aria-labelledby": lbl, "aria-required": q.req ? "true" : false });
        for (var v = q.min; v <= q.max; v++) (function (val) { sc.appendChild(chip("radio", "q-" + q.id, "q-" + q.id + "-" + val, String(val), String(val), state.get(q.id) === val, function () { state.set(q.id, val); refresh(); })); })(v);
        body.appendChild(sc);
        body.appendChild(el("div", { class: "scale-ends" }, [el("span", { text: q.min + " = " + q.lo }), el("span", { text: q.max + " = " + q.hi })]));
      } else if (q.type === "open") {
        var ta = el("textarea", { id: "q-" + q.id, rows: "3", maxlength: "1000", "aria-labelledby": lbl });
        ta.value = state.get(q.id) || "";
        ta.addEventListener("input", function () { state.set(q.id, ta.value); refresh(); });
        body.appendChild(ta);
        body.appendChild(el("p", { class: "hint", text: model.form.openHint }));
      } else if (q.type === "pair") {
        q.parts.forEach(function (p, i) {
          var pid = "lbl-" + p.id;
          if (i > 0) body.appendChild(el("div", { class: "q q-sub", id: pid }, [el("span", { class: "qt", text: p.text })]));
          var pg = el("div", { class: "chips", role: "group", "aria-labelledby": i > 0 ? pid : lbl });
          [["yes", "Yes"], ["no", "No"]].forEach(function (o) { pg.appendChild(chip("radio", "q-" + p.id, "q-" + p.id + "-" + o[0], o[0], o[1], state.get(p.id) === o[0], function () { state.set(p.id, o[0]); refresh(); })); });
          body.appendChild(pg);
        });
      } else if (q.type === "multi") {
        var mg = el("div", { class: "chips", role: "group", "aria-labelledby": lbl });
        var cur = state.get(q.id) || [];
        q.items.forEach(function (o) { mg.appendChild(chip("checkbox", "q-" + q.id, "q-" + q.id + "-" + o[0], o[0], o[1], cur.indexOf(o[0]) >= 0, function (on) { state.toggleMulti(q, o[0], on); refresh(); })); });
        body.appendChild(mg);
      } else if (q.type === "rank") {
        body.appendChild(el("p", { class: "hint", text: "Tap the parts in order, starting with the most useful. Tap a ranked part again to remove it." }));
        var list = el("ul", { class: "rank-list", "aria-labelledby": lbl });
        var status = el("p", { class: "rk-status" });
        body.appendChild(list); body.appendChild(status);
        block._renderRank = function () {
          var r = state.rank(q);
          while (list.firstChild) list.removeChild(list.firstChild);
          q.items.forEach(function (it) {
            var pos = r.order.indexOf(it[0]); var un = r.unused.indexOf(it[0]) >= 0;
            var btn = el("button", { type: "button", class: "rk-main", "aria-pressed": pos >= 0 ? "true" : "false", disabled: un, "data-k": it[0] }, [el("span", { class: "rk-n", text: pos >= 0 ? String(pos + 1) : "" }), el("span", { text: it[1] })]);
            btn.addEventListener("click", function () { state.rankPlace(q, it[0]); refresh(); focusRank(it[0], "button"); });
            var cb = el("input", { type: "checkbox", id: "q-" + q.id + "-un-" + it[0], checked: un, "data-k": it[0] });
            cb.addEventListener("change", function () { state.rankUnused(q, it[0], cb.checked); refresh(); focusRank(it[0], "checkbox"); });
            list.appendChild(el("li", { class: "rk" + (pos >= 0 ? " is-ranked" : "") + (un ? " is-unused" : "") }, [btn, el("label", { class: "rk-un", for: cb.id }, [cb, " Haven't used it"])]));
          });
          status.textContent = (r.order.length + r.unused.length) + " of " + q.items.length + " placed";
        };
        var focusRank = function (key, what) {
          var sel = what === "button" ? "button[data-k]" : "input[data-k]";
          var nodes = list.querySelectorAll(sel);
          for (var i = 0; i < nodes.length; i++) if (nodes[i].getAttribute("data-k") === key && !nodes[i].disabled) { nodes[i].focus(); return; }
        };
        block._renderRank();
      }

      if (q.follow) {
        var ft = el("textarea", { id: "q-" + q.id + "_t", rows: "2", maxlength: "500" });
        ft.value = state.get(q.id + "_t") || "";
        ft.addEventListener("input", function () { state.set(q.id + "_t", ft.value); });
        follow = el("div", { class: "follow", id: "fol-" + q.id, hidden: true }, [el("label", { class: "q", for: ft.id, text: q.follow.label }), ft, el("p", { class: "hint", text: q.follow.hint })]);
        block.appendChild(follow);
      }
      block.appendChild(err);
      return { q: q, node: block, num: num, follow: follow, err: err };
    }

    function refresh() {
      var m = model; if (!m) return;
      var n = 0;
      m.blocks.forEach(function (b) {
        var shown = m.state.isShown(b.q);
        b.node.hidden = !shown;
        if (shown) { n++; b.num.textContent = String(n); }
        if (b.follow) b.follow.hidden = !m.state.followOpen(b.q);
        if (b.node._renderRank) b.node._renderRank();
        if (b.err.textContent && m.state.isAnswered(b.q)) { b.err.textContent = ""; b.err.hidden = true; b.node.className = b.node.className.replace(" is-err", ""); }
      });
      var p = m.state.progress();
      m.progress.textContent = p.answered + " of " + p.total + " answered";
    }

    var ui = {
      loading: function () { clear(); app.appendChild(el("p", { class: "fb-loading", role: "status", text: "Loading your form..." })); },
      message: function (kind) { var m = MESSAGES[kind] || MESSAGES.error; card(m.title, m.body, kind === "used" ? "ok" : ""); },
      thanks: function (t) { card((t && t.title) || "Thank you", (t && t.body) || "Your answers are saved and every one is read.", "ok"); if (app.scrollIntoView) app.scrollIntoView({ block: "start" }); },
      form: function (form, state, submit) {
        clear();
        model = { form: form, state: state, blocks: [], banner: null, progress: null, button: null, submit: submit };
        var banner = el("div", { class: "status-banner", role: "alert" });
        var progress = el("p", { class: "prog", "aria-live": "polite" });
        var button = el("button", { type: "submit", class: "btn btn-primary", text: "Submit" });
        model.banner = banner; model.progress = progress; model.button = button;
        var f = el("form", { class: "fb-form", novalidate: true });
        var h = el("h1", { class: "fb-title", tabindex: "-1", text: form.title });
        f.appendChild(el("p", { class: "k", text: "Eating Glasses beta" }));
        f.appendChild(h);
        f.appendChild(el("p", { class: "step-sub", text: form.sub }));
        f.appendChild(banner);
        form.questions.forEach(function (q) { var b = buildBlock(q, state, refresh); model.blocks.push(b); f.appendChild(b.node); });
        f.appendChild(el("div", { class: "fb-foot" }, [progress, button]));
        f.addEventListener("submit", function (e) { e.preventDefault(); submit(); });
        app.appendChild(f);
        refresh();
      },
      busy: function (on) { if (!model) return; model.button.disabled = !!on; model.button.textContent = on ? "Sending..." : "Submit"; },
      banner: function (text) { if (!model) return; model.banner.textContent = text; model.banner.className = "status-banner show err"; },
      showMissing: function (ids) {
        if (!model) return;
        var first = null;
        model.blocks.forEach(function (b) {
          if (ids.indexOf(b.q.id) < 0) return;
          b.err.textContent = b.q.type === "choice" || b.q.type === "scale" ? "Choose one." : b.q.type === "rank" ? "Rank each part, or tick Haven't used it." : "Answer this one.";
          b.err.hidden = false;
          if (b.node.className.indexOf(" is-err") < 0) b.node.className += " is-err";
          if (!first) first = b;
        });
        ui.banner("Please answer the " + ids.length + " marked question" + (ids.length === 1 ? "" : "s") + ".");
        if (first) { reveal(first.node); }
      },
      serverErrors: function (errors) {
        if (!model) return;
        var shownAny = false; var first = null;
        model.blocks.forEach(function (b) {
          var keys = [b.q.id, b.q.id + "_t"].concat(b.q.parts ? b.q.parts.map(function (p) { return p.id; }) : []);
          var msg = null;
          keys.forEach(function (k) { if (errors && typeof errors[k] === "string" && !msg) msg = errors[k]; });
          if (!msg) return;
          b.err.textContent = msg; b.err.hidden = false; shownAny = true;
          if (b.node.className.indexOf(" is-err") < 0) b.node.className += " is-err";
          if (!first) first = b;
        });
        ui.banner(shownAny ? "Please fix the marked questions and send again." : (errors && errors._form) || FORM_WRONG);
        if (first) reveal(first.node);
      },
      _model: function () { return model; }
    };
    return ui;
  }

  // ── boot: wire the real page ─────────────────────────────────────────────────────────────────────────────────
  function boot(win) {
    win = win || window;
    var token = tokenFromSearch(win.location.search);
    var storage = null;
    try { storage = win.sessionStorage; } catch (e) { storage = null; }
    return start({
      token: token,
      api: createApi(function (u, o) { return win.fetch(u, o); }),
      ui: createDomUi(win.document, win.document.getElementById("app")),
      draft: token && storage ? sessionDraft(storage, token) : null
    });
  }

  return { API_URL: API_URL, MESSAGES: MESSAGES, NOT_SENT: NOT_SENT, tokenFromSearch: tokenFromSearch, classify: classify, createApi: createApi, createState: createState, sessionDraft: sessionDraft, start: start, createDomUi: createDomUi, boot: boot };
});
