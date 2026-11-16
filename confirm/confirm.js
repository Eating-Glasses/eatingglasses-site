/* eatingglasses.com/confirm: the page two emails open (S84; tester onboarding Option C, off until Justin flips it).
 *
 *   /confirm/?t=<43 characters>   the "confirm your email" link beta-join mails a new sign-up. One button: "Confirm my email".
 *   /confirm/?s=<row id>.<43>     the stop link at the end of an automated tester email. One button: "Stop these emails". It pauses; it never deletes.
 *
 * Opening the page changes NOTHING and asks the server nothing, so a mail scanner that follows the link, or a reload, costs nothing. ONLY the button is a POST to the
 * beta-onboarding Edge Function ({action:"confirm_email"} or {action:"stop"}). The token is read from the address, held in memory, and sent only to that function.
 * The page holds no secret of its own (the publishable key is public by design, like /approve, /beta and /feedback) and keeps nothing in storage. Everything the server
 * says is put on the page with textContent, never as HTML.
 *
 * One file, no build step, and loadable in Node for tests (module.exports) as well as in the browser (window.EGConfirm).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.EGConfirm = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var API_URL = "https://pnnqxzqpfjsliwymmecv.supabase.co/functions/v1/beta-onboarding";
  var PUBLISHABLE_KEY = "sb_publishable_eI0ziX_WG6M2UepQG4lM7Q_i8IbS3Dk";
  var CONFIRM_RE = /^[A-Za-z0-9_-]{43}$/;
  var STOP_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/;

  var CARDS = {
    confirm: { title: "Confirm your email", body: "Press the button to confirm that this is your email address.", button: "Confirm my email", action: "confirm_email" },
    stop: { title: "Stop these emails?", body: "Press the button and you will get no more setup or reminder emails from Justin. Your place on the list stays.", button: "Stop these emails", action: "stop" }
  };
  // What the page says after the button, by what the server answered. Short, plain, one next step.
  var RESULTS = {
    confirmed: { title: "Email confirmed", body: "Thank you. Nothing else to do: you will get an email from Justin when it is your turn.", ok: true },
    stopped: { title: "Stopped", body: "You will get no more setup or reminder emails. If you change your mind, reply to any email from Justin.", ok: true },
    used: { title: "Already confirmed", body: "This link was already used. Nothing else to do.", ok: true },
    expired: { title: "This link has expired", body: "Reply to the email from Justin and ask for a new one.", ok: false },
    invalid: { title: "This link does not work", body: "Open the newest email from Justin and use the link in it.", ok: false },
    paused: { title: "Not available right now", body: "Please try this link again in a day or two.", ok: false },
    error: { title: "That did not work", body: "Nothing was changed that this page can see. Reload the page to check, or try again in a moment.", ok: false },
    missing: { title: "This page needs the link from the email", body: "Open the link in the email from Justin.", ok: false }
  };

  function paramsFromSearch(search) {
    var p = null, t = null, s = null;
    try { p = new URLSearchParams(search || ""); t = p.get("t"); s = p.get("s"); } catch (e) { return { mode: null, token: null }; }
    if (s && STOP_RE.test(s)) return { mode: "stop", token: s };
    if (t && CONFIRM_RE.test(t)) return { mode: "confirm", token: t };
    return { mode: null, token: null };
  }

  function classify(http, j) {
    j = j || {};
    if (j.ok === true && (j.status === "confirmed" || j.status === "stopped")) return j.status;
    if (j.status === "used") return "used";
    if (j.status === "expired") return "expired";
    if (j.status === "paused") return "paused";
    if (http === 404 && j.status === "invalid") return "invalid";
    return "error"; // a 5xx, a 403, a platform 404, a non-JSON answer
  }

  function createApi(fetchFn, cfg) {
    cfg = cfg || {};
    var url = cfg.url || API_URL;
    var key = cfg.key || PUBLISHABLE_KEY;
    return {
      press: function (mode, token) {
        return fetchFn(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "apikey": key, "Authorization": "Bearer " + key },
          body: JSON.stringify({ action: CARDS[mode].action, token: token })
        }).then(function (res) {
          return res.json().then(function (j) { return classify(res.status, j); }, function () { return "error"; });
        }, function () { return "network"; });
      }
    };
  }

  // ui: { message(title, body, ok), card(card, onPress), busy(bool), notice(text) }
  function start(opts) {
    var ui = opts.ui, api = opts.api, mode = opts.mode, token = opts.token;
    if (!mode || !token) { var m = RESULTS.missing; ui.message(m.title, m.body, false); return Promise.resolve("missing"); }
    var pressed = false;
    ui.card(CARDS[mode], function () {
      if (pressed) return Promise.resolve(null);
      pressed = true;
      ui.busy(true);
      return api.press(mode, token).then(function (kind) {
        if (kind === "network") {
          // the POST may or may not have landed: let the person look, and press again only if the page says it did not
          pressed = false;
          ui.busy(false);
          ui.notice("Could not reach the server. Reload this page to see whether it went through.");
          return kind;
        }
        var r = RESULTS[kind] || RESULTS.error;
        ui.message(r.title, r.body, r.ok);
        return kind;
      });
    });
    return Promise.resolve("card");
  }

  function createDomUi(doc, mount) {
    function el(tag, attrs, kids) {
      var n = doc.createElement(tag);
      Object.keys(attrs || {}).forEach(function (k) {
        if (k === "text") n.textContent = attrs[k];
        else if (attrs[k] === true) n.setAttribute(k, "");
        else if (attrs[k] !== false && attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
      });
      (kids || []).forEach(function (c) { n.appendChild(typeof c === "string" ? doc.createTextNode(c) : c); });
      return n;
    }
    function clear() { while (mount.firstChild) mount.removeChild(mount.firstChild); }
    function focusTitle() { var h = mount.querySelector("h1"); if (h) { h.setAttribute("tabindex", "-1"); if (h.focus) h.focus(); } }
    var button = null, noticeNode = null;
    return {
      message: function (title, body, ok) {
        clear();
        mount.appendChild(el("div", { class: "fb-msg" + (ok ? " ok" : "") }, [el("h1", { class: "fb-title", text: title }), el("p", { text: body })]));
        focusTitle();
      },
      card: function (card, onPress) {
        clear();
        button = el("button", { type: "button", class: "btn btn-primary", text: card.button });
        button.addEventListener("click", function () { onPress(); });
        noticeNode = el("p", { class: "status-banner err", role: "alert", text: "" });
        [el("h1", { class: "fb-title", text: card.title }), el("p", { class: "step-sub", text: card.body }), el("div", { class: "ap-actions" }, [button]), noticeNode].forEach(function (k) { mount.appendChild(k); });
        focusTitle();
      },
      busy: function (on) { if (!button) return; if (on) button.setAttribute("disabled", ""); else button.removeAttribute("disabled"); if (on && noticeNode) { noticeNode.className = "status-banner err"; noticeNode.textContent = ""; } },
      notice: function (text) { if (noticeNode) { noticeNode.textContent = text; noticeNode.className = "status-banner err show"; } }
    };
  }

  function boot(win) {
    win = win || window;
    var p = paramsFromSearch(win.location.search);
    return start({
      mode: p.mode,
      token: p.token,
      api: createApi(function (u, o) { return win.fetch(u, o); }),
      ui: createDomUi(win.document, win.document.getElementById("app"))
    });
  }

  return { API_URL: API_URL, CARDS: CARDS, RESULTS: RESULTS, paramsFromSearch: paramsFromSearch, classify: classify, createApi: createApi, start: start, createDomUi: createDomUi, boot: boot };
});
