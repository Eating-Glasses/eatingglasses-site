/* eatingglasses.com/approve: the page Justin's approval email opens (S82; tester onboarding Option B, approved 10-29).
 *
 * An email to Justin about a new beta sign-up has three links (Approve and invite, Hold, Not a fit). Each opens THIS page, which asks the beta-onboarding Edge
 * Function what the link is for ({action:"check"}: it consumes nothing, so a link scanner that opens the page, or a reload, costs nothing), shows the sign-up's first
 * name and number, and waits. ONLY the button is a POST that changes anything ({action:"decide"}). The link chooses which button is the main one; the page never
 * decides by itself.
 *
 * THE PAGE HOLDS NO SECRET AND NO TOKEN OF ITS OWN. The publishable key below is public by design (it is also in /beta and /feedback); the function is deployed
 * without JWT verification and checks the one-use token. The token is read from the address, held in memory, and sent only to beta-onboarding. Everything the server
 * sends is put on the page with textContent, never as HTML. The page keeps nothing in storage.
 *
 * Written as one file with no build step, like the rest of the site, and loadable in Node for tests (module.exports) as well as in the browser (window.EGApprove).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.EGApprove = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // PRD Supabase project.
  var API_URL = "https://pnnqxzqpfjsliwymmecv.supabase.co/functions/v1/beta-onboarding";
  var PUBLISHABLE_KEY = "sb_publishable_eI0ziX_WG6M2UepQG4lM7Q_i8IbS3Dk";
  var TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
  var DECISIONS = ["approve", "hold", "decline"];

  // What Justin reads when a link opens nothing. Plain, no blame.
  var MESSAGES = {
    missing: { title: "This page needs the link from the email", body: "Open one of the three links in the sign-up email." },
    invalid: { title: "This link does not work", body: "A newer email for this sign-up may have replaced it. Open the link in the newest email." },
    expired: { title: "This link has expired", body: "The next daily run sends a fresh email for this sign-up." },
    used: { title: "This link was already used", body: "The sign-up has been decided. Nothing more to do." },
    decided: { title: "This sign-up has moved on", body: "It was decided or handled another way since this email was sent. Nothing was changed." },
    on_hold: { title: "This sign-up is on hold", body: "A hold was placed after this email was sent. An Approve link does not release a hold: ask LC to release it, and the next daily run sends a fresh email. Nothing was changed." },
    paused: { title: "Onboarding is switched off right now", body: "Nothing was done, and the link still works when it is switched back on." },
    not_inviteable: { title: "This sign-up cannot be invited", body: "It has no OK to email on file, so nobody can be invited from it. Nothing was changed." },
    error: { title: "That did not work", body: "Nothing was changed that this page can see. Reload the page to check, or try again in a moment." }
  };
  // Approved, but the invite could not go out at once. The daily run tries again.
  var QUEUED = {
    daily_cap: "Today's limit of new invites is used up, so the invite goes in a later daily run.",
    invited_pause: "Too many people are waiting at Invited, so the invite goes once some of them accept.",
    build: "TestFlight has no approved build right now, so the invite goes once it has one.",
    public_link: "The TestFlight group has a public link switched on, so new invites are paused until it is off.",
    email_cap: "Today's email limit is used up, so the invite goes in a later daily run.",
    rate_limited: "Apple asked for a pause, so the invite goes in a later daily run.",
    asc_error: "Apple did not accept the invite just now, so the daily run tries again.",
    in_progress: "Another run is already inviting this person.",
    paused: "This person is paused, so no invite goes.",
    no_consent: "This person has no OK to email on file, so no invite goes.",
    revoked: "Apple says this person stopped testing or was removed, so the sign-up was put on hold instead.",
    already_in_group: "Apple already lists this person in the TestFlight group, so nobody was invited again.",
    unreadable: "The invite could not be started just now, so the daily run tries again."
  };

  // ── the link ──────────────────────────────────────────────────────────────────────────────────────────────────
  function paramsFromSearch(search) {
    var p = null, t = null, d = null;
    try { p = new URLSearchParams(search || ""); t = p.get("t"); d = p.get("do"); } catch (e) { return { token: null, pick: "approve" }; }
    return { token: t && TOKEN_RE.test(t) ? t : null, pick: DECISIONS.indexOf(d) >= 0 ? d : "approve" };
  }

  // ── the server ────────────────────────────────────────────────────────────────────────────────────────────────
  function classify(http, j, asked) {
    j = j || {};
    if (j.ok === true && j.status === "ok" && j.signup) return { kind: "card", signup: j.signup, meets: j.meets_rule === true, why: j.why || "other", rehearsal: j.rehearsal === true, stage: j.stage || "awaiting_approval", holdReason: typeof j.hold_reason === "string" ? j.hold_reason : "" };
    if (j.ok === true && j.status === "rehearsal") return { kind: "rehearsal", signup: j.signup || null, decision: j.decision || asked || null };
    if (j.ok === true && j.status === "approved") return { kind: "approved", signup: j.signup || null, invited: j.invited === true, queued: typeof j.queued === "string" ? j.queued : null };
    if (j.ok === true && (j.status === "held" || j.status === "declined")) return { kind: j.status, signup: j.signup || null };
    if (http === 404 && j.status === "invalid") return { kind: "invalid" };
    if (j.status === "used") return { kind: "used" };
    if (j.status === "expired") return { kind: "expired" };
    if (j.status === "decided") return { kind: "decided" };
    if (j.status === "on_hold") return { kind: "on_hold" };
    if (j.status === "paused") return { kind: "paused" };
    if (j.status === "not_inviteable") return { kind: "not_inviteable" };
    return { kind: "error" }; // a 5xx, a 403, a platform 404 (the function is not there), a non-JSON answer
  }

  function createApi(fetchFn, cfg) {
    cfg = cfg || {};
    var url = cfg.url || API_URL;
    var key = cfg.key || PUBLISHABLE_KEY;
    function post(body, asked) {
      return fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": key, "Authorization": "Bearer " + key },
        body: JSON.stringify(body)
      }).then(function (res) {
        return res.json().then(function (j) { return classify(res.status, j, asked); }, function () { return { kind: "error" }; });
      }, function () { return { kind: "network" }; });
    }
    return {
      check: function (token) { return post({ action: "check", token: token }); },
      decide: function (token, decision) { return post({ action: "decide", token: token, decision: decision }, decision); }
    };
  }

  // ── the wording on the card and after a button ────────────────────────────────────────────────────────────────
  function who(signup) {
    var name = signup && signup.first_name ? String(signup.first_name) : "This person";
    var num = signup && signup.number !== null && signup.number !== undefined ? " (sign-up #" + signup.number + ")" : "";
    return { name: name, label: name + num };
  }
  function ruleLine(card) {
    if (card.meets) return "Meets the invite rule: yes.";
    if (card.why === "caregiver") return "Meets the invite rule: no. This is a caregiver sign-up, so the teen and parent path comes first.";
    return "Meets the invite rule: no. Open the sign-up row to see which part.";
  }
  // A held sign-up's link can still Hold (keep the hold) or Not a fit, never Approve: the server refuses it, and the page does not offer it.
  function decisionsFor(card) {
    return card && card.stage === "held" ? ["hold", "decline"] : DECISIONS;
  }
  function holdLine(card) {
    var why = card.holdReason ? String(card.holdReason) : "";
    return "On hold" + (why ? ": " + why : ".");
  }
  function buttonLabel(decision, name, held) {
    return decision === "approve" ? "Approve and invite " + name : decision === "hold" ? (held ? "Keep on hold" : "Hold") : "Not a fit";
  }
  function resultText(res) {
    var w = who(res.signup).name;
    switch (res.kind) {
      case "approved":
        return res.invited
          ? { title: "Done", body: w + " is invited. Apple is sending the TestFlight invite, and the setup email goes with it." }
          : { title: "Approved", body: w + " is approved. " + (QUEUED[res.queued] || QUEUED.unreadable) };
      case "held": return { title: "Held", body: w + " stays on the list and nothing is sent. Ask LC to release the hold when you are ready." };
      case "declined": return { title: "Marked not a fit", body: "Nothing is sent to " + w + "." };
      case "rehearsal": return { title: "Rehearsal only", body: "This link came from a dry run, so pressing the button changed nothing. Nobody was invited or told anything." };
      default: return null;
    }
  }

  // ── the flow ──────────────────────────────────────────────────────────────────────────────────────────────────
  // ui: { loading(), message(title, body), card(card, pick, onPress), result(title, body, isOk), busy(bool), notice(text) }
  function start(opts) {
    var ui = opts.ui, api = opts.api, token = opts.token, pick = opts.pick || "approve";
    if (!token) { ui.message(MESSAGES.missing.title, MESSAGES.missing.body); return Promise.resolve({ kind: "missing" }); }
    ui.loading();
    return api.check(token).then(function (res) {
      if (res.kind !== "card") {
        var m = MESSAGES[res.kind] || MESSAGES.error;
        ui.message(m.title, m.body);
        return res;
      }
      var pressed = false;
      ui.card(res, pick, function (decision) {
        if (pressed || decisionsFor(res).indexOf(decision) < 0) return Promise.resolve(null);
        pressed = true;
        ui.busy(true);
        return api.decide(token, decision).then(function (out) {
          var text = resultText(out);
          if (text) { ui.result(text.title, text.body, true); return out; }
          if (out.kind === "network") {
            // the POST may or may not have landed: let Justin look, and press again only if the page says it did not
            pressed = false;
            ui.busy(false);
            ui.notice("Could not reach the server. Reload this page to see whether it went through.");
            return out;
          }
          var msg = MESSAGES[out.kind] || MESSAGES.error;
          ui.result(msg.title, msg.body, false);
          return out;
        });
      });
      return res;
    }).then(function (final) { return final; }, function () { ui.message(MESSAGES.error.title, MESSAGES.error.body); return { kind: "error" }; });
  }

  // ── the DOM ─────────────────────────────────────────────────────────────────────────────────────────────────
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
    var buttons = [];
    var noticeNode = null;
    return {
      loading: function () { clear(); mount.appendChild(el("p", { class: "fb-loading", text: "Loading the sign-up..." })); },
      message: function (title, body) {
        clear();
        mount.appendChild(el("div", { class: "fb-msg" }, [el("h1", { class: "fb-title", text: title }), el("p", { text: body })]));
        focusTitle();
      },
      card: function (card, pick, onPress) {
        clear();
        buttons = [];
        var w = who(card.signup);
        var held = card.stage === "held";
        var kids = [el("h1", { class: "fb-title", text: w.label }), el("p", { class: "step-sub", text: ruleLine(card) })];
        if (held) kids.push(el("p", { class: "rehearsal", text: holdLine(card) }));
        if (card.rehearsal) kids.push(el("p", { class: "rehearsal", text: "Rehearsal link from a dry run: pressing a button here decides nothing." }));
        var row = el("div", { class: "ap-actions" });
        // the link's choice first and as the main button; the other two follow
        var offered = decisionsFor(card);
        var main = offered.indexOf(pick) >= 0 ? pick : offered[0];
        var order = [main].concat(offered.filter(function (d) { return d !== main; }));
        order.forEach(function (d) {
          var b = el("button", { type: "button", class: "btn " + (d === main ? "btn-primary" : "btn-secondary"), "data-decision": d, text: buttonLabel(d, w.name, held) });
          b.addEventListener("click", function () { onPress(d); });
          buttons.push(b);
          row.appendChild(b);
        });
        kids.push(row);
        kids.push(el("p", { class: "hint", text: held
          ? "This sign-up is on hold, and an Approve link does not release a hold: ask LC to release it first. Nothing is sent to " + w.name + "."
          : "Nothing happens until you press a button. Nothing is sent to " + w.name + " until you approve." }));
        noticeNode = el("p", { class: "status-banner err", role: "alert", text: "" });
        kids.push(noticeNode);
        kids.forEach(function (k) { mount.appendChild(k); });
        focusTitle();
      },
      busy: function (on) { buttons.forEach(function (b) { if (on) b.setAttribute("disabled", ""); else b.removeAttribute("disabled"); }); if (on && noticeNode) { noticeNode.className = "status-banner err"; noticeNode.textContent = ""; } },
      notice: function (text) { if (noticeNode) { noticeNode.textContent = text; noticeNode.className = "status-banner err show"; } },
      result: function (title, body, isOk) {
        clear();
        mount.appendChild(el("div", { class: "fb-msg" + (isOk ? " ok" : "") }, [el("h1", { class: "fb-title", text: title }), el("p", { text: body })]));
        focusTitle();
      }
    };
  }

  function boot(win) {
    win = win || window;
    var p = paramsFromSearch(win.location.search);
    return start({
      token: p.token,
      pick: p.pick,
      api: createApi(function (u, o) { return win.fetch(u, o); }),
      ui: createDomUi(win.document, win.document.getElementById("app"))
    });
  }

  return { API_URL: API_URL, MESSAGES: MESSAGES, QUEUED: QUEUED, paramsFromSearch: paramsFromSearch, classify: classify, createApi: createApi, resultText: resultText, ruleLine: ruleLine, holdLine: holdLine, decisionsFor: decisionsFor, start: start, createDomUi: createDomUi, boot: boot };
});
