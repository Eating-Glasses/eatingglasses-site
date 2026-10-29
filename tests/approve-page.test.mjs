// Tests for approve/approve.js, the page Justin's approval email opens  (S82)
//
//   node --test tests/approve-page.test.mjs        (Node 18+; no dependencies)
//
// WHAT RUNS. The real approve/approve.js, loaded as a module (it exports itself when `module` exists, and sets window.EGApprove in a browser). The server is a
// MOCKED fetch: nothing here reaches the network. tests/approve-page.dom.test.mjs runs the same page in a real DOM (jsdom) when jsdom is installed.
//
// HELD HERE: the link is read from ?t= and only a 43-character token is accepted; the link's ?do= only chooses the main button; opening the page asks "check" and
// NEVER "decide", so a link scanner or a reload changes nothing; only a button press is a decide, and it is sent once however often it is pressed; every answer of
// the server maps to the right words; the page sends requests only to the beta-onboarding function; it holds no secret and no token; nothing the server sends is
// ever parsed as HTML; and the page is never indexed and never leaks its address as a referrer.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const require = createRequire(import.meta.url);
const EG = require(path.join(ROOT, "approve", "approve.js"));
const HTML = readFileSync(path.join(ROOT, "approve", "index.html"), "utf8");
const JS = readFileSync(path.join(ROOT, "approve", "approve.js"), "utf8");

const TOKEN = "A".repeat(42) + "b";
const FUNCTION_URL = "https://pnnqxzqpfjsliwymmecv.supabase.co/functions/v1/beta-onboarding";
const json = (status, body) => ({ status, json: () => Promise.resolve(body) });

function server(handlers) {
  const calls = [];
  const fetchFn = (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, init, body });
    const h = handlers[body.action];
    if (!h) throw new Error(`unexpected ${body.action}`);
    const r = typeof h === "function" ? h(body, calls.length) : h;
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  };
  return { fetchFn, calls };
}
const CARD = (over = {}) => json(200, { ok: true, status: "ok", signup: { first_name: "Sam", number: 12 }, meets_rule: true, why: "ok", stage: "awaiting_approval", rehearsal: false, ...over });

// a recording UI: what the page asked the screen to show
function recorder() {
  const log = [];
  let press = null;
  return {
    log,
    press: (d) => press(d),
    ui: {
      loading: () => log.push(["loading"]),
      message: (t, b) => log.push(["message", t, b]),
      card: (card, pick, onPress) => { log.push(["card", card, pick]); press = onPress; },
      busy: (on) => log.push(["busy", on]),
      notice: (t) => log.push(["notice", t]),
      result: (t, b, ok) => log.push(["result", t, b, ok]),
    },
    last: () => log.at(-1),
  };
}

// ── the link ────────────────────────────────────────────────────────────────────────────────────────────────────
test("the link: a 43-character token and a known ?do=; anything else is no token and the default button", () => {
  assert.deepEqual(EG.paramsFromSearch(`?t=${TOKEN}&do=hold`), { token: TOKEN, pick: "hold" });
  assert.deepEqual(EG.paramsFromSearch(`?t=${TOKEN}&do=decline`), { token: TOKEN, pick: "decline" });
  assert.deepEqual(EG.paramsFromSearch(`?t=${TOKEN}`), { token: TOKEN, pick: "approve" });
  assert.deepEqual(EG.paramsFromSearch(`?t=${TOKEN}&do=delete`), { token: TOKEN, pick: "approve" }, "an unknown button is not a button");
  assert.deepEqual(EG.paramsFromSearch(`?do=hold`), { token: null, pick: "hold" });
  for (const bad of ["", "?t=", "?t=short", `?t=${"A".repeat(44)}`, `?t=${"A".repeat(42)}!`, `?t=${TOKEN} `, `?T=${TOKEN}`, null, undefined]) assert.equal(EG.paramsFromSearch(bad).token, null, String(bad));
});

// ── the server ──────────────────────────────────────────────────────────────────────────────────────────────────
test("every answer of the server maps to one thing on the page", () => {
  const c = EG.classify;
  assert.deepEqual(c(200, { ok: true, status: "ok", signup: { first_name: "Sam", number: 1 }, meets_rule: false, why: "caregiver", rehearsal: true }), { kind: "card", signup: { first_name: "Sam", number: 1 }, meets: false, why: "caregiver", rehearsal: true });
  assert.equal(c(200, { ok: true, status: "approved", signup: {}, invited: true }).kind, "approved");
  assert.equal(c(200, { ok: true, status: "approved", signup: {}, invited: false, queued: "daily_cap" }).queued, "daily_cap");
  assert.equal(c(200, { ok: true, status: "held", signup: {} }).kind, "held");
  assert.equal(c(200, { ok: true, status: "declined", signup: {} }).kind, "declined");
  assert.deepEqual(c(200, { ok: true, status: "rehearsal", decision: "hold", signup: null }), { kind: "rehearsal", signup: null, decision: "hold" });
  assert.equal(c(404, { ok: false, status: "invalid" }).kind, "invalid");
  assert.equal(c(409, { ok: false, status: "used" }).kind, "used");
  assert.equal(c(410, { ok: false, status: "expired" }).kind, "expired");
  assert.equal(c(409, { ok: false, status: "decided", stage: "invited" }).kind, "decided");
  assert.equal(c(503, { ok: false, status: "paused", mode: "off" }).kind, "paused");
  assert.equal(c(409, { ok: false, status: "not_inviteable" }).kind, "not_inviteable");
  for (const odd of [[500, { ok: false, status: "error" }], [403, { ok: false, status: "forbidden" }], [404, { message: "Function not found" }], [200, {}], [200, null], [502, undefined]]) assert.equal(c(...odd).kind, "error", JSON.stringify(odd));
});

test("the API: check and decide are POSTs to the function with the public key; nothing else is ever called", async () => {
  const s = server({ check: CARD(), decide: json(200, { ok: true, status: "held", signup: { first_name: "Sam", number: 12 } }) });
  const api = EG.createApi(s.fetchFn);
  await api.check(TOKEN);
  await api.decide(TOKEN, "hold");
  assert.equal(s.calls.length, 2);
  for (const c of s.calls) {
    assert.equal(c.url, FUNCTION_URL);
    assert.equal(c.init.method, "POST");
    assert.equal(c.init.headers["Content-Type"], "application/json");
    assert.match(c.init.headers.apikey, /^sb_publishable_/);
    assert.equal(c.init.headers.Authorization, `Bearer ${c.init.headers.apikey}`);
  }
  assert.deepEqual(s.calls[0].body, { action: "check", token: TOKEN });
  assert.deepEqual(s.calls[1].body, { action: "decide", token: TOKEN, decision: "hold" });
  assert.equal(EG.API_URL, FUNCTION_URL);
  // a dropped connection is "network", not an error page
  const dead = EG.createApi(() => Promise.reject(new TypeError("Failed to fetch")));
  assert.equal((await dead.decide(TOKEN, "approve")).kind, "network");
  const garbage = EG.createApi(() => Promise.resolve({ status: 200, json: () => Promise.reject(new Error("not json")) }));
  assert.equal((await garbage.check(TOKEN)).kind, "error");
});

// ── the flow ────────────────────────────────────────────────────────────────────────────────────────────────────
test("OPENING THE PAGE ONLY LOOKS: one 'check', never a 'decide', whatever the link says; a reload asks again and still changes nothing", async () => {
  for (const pick of ["approve", "hold", "decline"]) {
    const s = server({ check: CARD(), decide: new Error("a scanner must never reach decide") });
    const r = recorder();
    const res = await EG.start({ token: TOKEN, pick, api: EG.createApi(s.fetchFn), ui: r.ui });
    assert.equal(res.kind, "card");
    assert.equal(s.calls.length, 1, `${pick}: one request`);
    assert.equal(s.calls[0].body.action, "check");
    assert.deepEqual(r.log.map((l) => l[0]), ["loading", "card"]);
    assert.equal(r.log[1][2], pick, "the link chooses the main button, nothing more");
  }
  const s = server({ check: CARD() });
  for (let i = 0; i < 3; i++) await EG.start({ token: TOKEN, pick: "approve", api: EG.createApi(s.fetchFn), ui: recorder().ui });
  assert.ok(s.calls.every((c) => c.body.action === "check"));
});

test("no token: a plain message and no request at all", async () => {
  const s = server({});
  const r = recorder();
  const res = await EG.start({ token: null, pick: "approve", api: EG.createApi(s.fetchFn), ui: r.ui });
  assert.equal(res.kind, "missing");
  assert.equal(s.calls.length, 0);
  assert.deepEqual(r.last(), ["message", EG.MESSAGES.missing.title, EG.MESSAGES.missing.body]);
});

test("a link that opens nothing says why, in plain words, and offers no button", async () => {
  const cases = [
    [json(404, { ok: false, status: "invalid" }), "invalid"], [json(409, { ok: false, status: "used" }), "used"], [json(410, { ok: false, status: "expired" }), "expired"],
    [json(409, { ok: false, status: "decided" }), "decided"], [json(503, { ok: false, status: "paused" }), "paused"], [json(500, { ok: false, status: "error" }), "error"],
  ];
  for (const [reply, key] of cases) {
    const r = recorder();
    await EG.start({ token: TOKEN, pick: "approve", api: EG.createApi(server({ check: reply }).fetchFn), ui: r.ui });
    assert.deepEqual(r.last(), ["message", EG.MESSAGES[key].title, EG.MESSAGES[key].body], key);
    assert.ok(!r.log.some((l) => l[0] === "card"), `${key}: no button`);
  }
  const r = recorder();
  await EG.start({ token: TOKEN, pick: "approve", api: EG.createApi(() => Promise.reject(new TypeError("x"))), ui: r.ui });
  assert.equal(r.last()[1], EG.MESSAGES.error.title, "a dropped connection while looking");
});

test("A BUTTON PRESS is the only decide, it is sent once however often it is pressed, and the page says what happened", async () => {
  const outcomes = [
    ["approve", json(200, { ok: true, status: "approved", signup: { first_name: "Sam", number: 12 }, invited: true }), "Done", /Sam is invited\. Apple is sending the TestFlight invite/],
    ["approve", json(200, { ok: true, status: "approved", signup: { first_name: "Sam", number: 12 }, invited: false, queued: "daily_cap" }), "Approved", /Sam is approved\. Today's limit of new invites is used up/],
    ["approve", json(200, { ok: true, status: "approved", signup: { first_name: "Sam", number: 12 }, invited: false, queued: "build" }), "Approved", /no approved build right now/],
    ["approve", json(200, { ok: true, status: "approved", signup: { first_name: "Sam", number: 12 }, invited: false, queued: "something_new" }), "Approved", /Sam is approved\. The invite could not be started just now/],
    ["approve", json(200, { ok: true, status: "approved", signup: { first_name: "Sam", number: 12 }, invited: false, queued: "already_in_group" }), "Approved", /Apple already lists this person in the TestFlight group, so nobody was invited again/],
    ["hold", json(200, { ok: true, status: "held", signup: { first_name: "Sam", number: 12 } }), "Held", /Sam stays on the list and nothing is sent/],
    ["decline", json(200, { ok: true, status: "declined", signup: { first_name: "Sam", number: 12 } }), "Marked not a fit", /Nothing is sent to Sam\./],
    ["approve", json(200, { ok: true, status: "rehearsal", decision: "approve", signup: { first_name: "Sam", number: 12 } }), "Rehearsal only", /changed nothing/],
    ["approve", json(409, { ok: false, status: "used" }), EG.MESSAGES.used.title, null],
    ["approve", json(410, { ok: false, status: "expired" }), EG.MESSAGES.expired.title, null],
    ["approve", json(503, { ok: false, status: "paused" }), EG.MESSAGES.paused.title, null],
    ["approve", json(409, { ok: false, status: "not_inviteable" }), EG.MESSAGES.not_inviteable.title, null],
    ["approve", json(500, { ok: false, status: "error" }), EG.MESSAGES.error.title, null],
  ];
  for (const [decision, reply, title, body] of outcomes) {
    const s = server({ check: CARD(), decide: reply });
    const r = recorder();
    await EG.start({ token: TOKEN, pick: decision, api: EG.createApi(s.fetchFn), ui: r.ui });
    const [a, b, c] = await Promise.all([r.press(decision), r.press(decision), r.press("hold")]); // three presses at once
    void a; void b; void c;
    assert.equal(s.calls.filter((x) => x.body.action === "decide").length, 1, `${decision}: sent once`);
    assert.deepEqual(s.calls.at(-1).body, { action: "decide", token: TOKEN, decision });
    const res = r.log.find((l) => l[0] === "result");
    assert.ok(res, `${decision} ${title}: a result is shown`);
    assert.equal(res[1], title);
    if (body) assert.match(res[2], body);
    assert.deepEqual(r.log.filter((l) => l[0] === "busy").map((l) => l[1]), [true], "the buttons are locked while it is sent");
  }
  // a button that is not one of the three is not sent
  const s = server({ check: CARD() });
  const r = recorder();
  await EG.start({ token: TOKEN, pick: "approve", api: EG.createApi(s.fetchFn), ui: r.ui });
  await r.press("delete");
  await r.press(undefined);
  assert.equal(s.calls.length, 1);
});

test("a dropped connection AFTER a press: the buttons come back with a plain note to reload, because the press may have landed", async () => {
  const s = server({ check: CARD(), decide: new TypeError("Failed to fetch") });
  const r = recorder();
  await EG.start({ token: TOKEN, pick: "approve", api: EG.createApi(s.fetchFn), ui: r.ui });
  await r.press("approve");
  assert.deepEqual(r.log.filter((l) => l[0] === "busy").map((l) => l[1]), [true, false]);
  assert.deepEqual(r.log.find((l) => l[0] === "notice"), ["notice", "Could not reach the server. Reload this page to see whether it went through."]);
  assert.ok(!r.log.some((l) => l[0] === "result"), "no result was claimed");
});

test("the wording: the rule line says why for a caregiver; the first name and number come from the server; a name is never made up", () => {
  assert.equal(EG.ruleLine({ meets: true }), "Meets the invite rule: yes.");
  assert.match(EG.ruleLine({ meets: false, why: "caregiver" }), /caregiver sign-up, so the teen and parent path comes first/);
  assert.match(EG.ruleLine({ meets: false, why: "other" }), /Open the sign-up row to see which part/);
  assert.match(EG.resultText({ kind: "approved", signup: null, invited: true }).body, /^This person is invited/);
});

// ── what the page is ────────────────────────────────────────────────────────────────────────────────────────────
test("the page: never indexed, no referrer, no third-party host, one script of its own, no inline handler", () => {
  assert.match(HTML, /<meta name="robots" content="noindex, nofollow" \/>/);
  assert.match(HTML, /<meta name="referrer" content="no-referrer" \/>/);
  const hosts = [...HTML.matchAll(/(?:src|href)="(https?:)?\/\/([^/"]+)/g)].map((m) => m[2]);
  assert.deepEqual(hosts, [], "no third-party host in the page");
  assert.deepEqual([...HTML.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]), ["/approve/approve.js?v=1"]);
  assert.equal((HTML.match(/<script/g) ?? []).length, 2, "the file and the one-line boot");
  assert.ok(!/\son[a-z]+=/i.test(HTML), "no inline event handler");
  assert.ok(HTML.includes("EGApprove.boot(window)"));
  assert.match(HTML, /<noscript>/);
});

test("the page holds NO SECRET and no token: its only key is the publishable one that /beta and /feedback already carry", () => {
  const publishable = [...JS.matchAll(/sb_publishable_[A-Za-z0-9_-]+/g)].map((m) => m[0]);
  assert.deepEqual([...new Set(publishable)], ["sb_publishable_eI0ziX_WG6M2UepQG4lM7Q_i8IbS3Dk"]);
  assert.ok(readFileSync(path.join(ROOT, "feedback", "feedback.js"), "utf8").includes("sb_publishable_eI0ziX_WG6M2UepQG4lM7Q_i8IbS3Dk"), "the same public key the feedback page uses");
  const bare = JS.replace(/sb_publishable_[A-Za-z0-9_-]+/g, "");
  for (const [re, what] of [[/sb_secret_/, "a Supabase secret key"], [/eyJ[A-Za-z0-9_-]{20,}/, "a JWT"], [/BEGIN (EC |RSA )?PRIVATE KEY/, "a private key"], [/\bre_[A-Za-z0-9]{12,}/, "a Resend key"], [/ONBOARDING_CRON_SECRET|x-cron-secret/i, "the cron secret"], [/ASC_[A-Z_]+/, "an App Store Connect setting"], [/["'][A-Za-z0-9_-]{43}["']/, "a 43-character token"]]) {
    assert.ok(!re.test(bare), `the page contains ${what}`);
    assert.ok(!re.test(HTML), `the page html contains ${what}`);
  }
  assert.ok(!/localStorage|sessionStorage|document\.cookie|indexedDB/.test(JS), "the page keeps nothing");
});

test("nothing the server sends is ever parsed as HTML, and the page makes no request but the two calls", () => {
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(JS), "no HTML sink");
  assert.deepEqual([...JS.matchAll(/[\w.]*\bfetch\(/g)].map((m) => m[0]), ["win.fetch("], "the only call of fetch is the browser's, handed to the API as fetchFn");
  assert.ok(!/XMLHttpRequest|sendBeacon|new WebSocket|new Image|<form|window\.open|location\.(href|assign|replace)\s*=/.test(JS + HTML), "no other way out");
  assert.ok(!/https?:\/\/(?!pnnqxzqpfjsliwymmecv\.supabase\.co\/functions\/v1\/beta-onboarding)/.test(JS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/ .*$/gm, "")), "the one address in the code is the function");
});

test("copy rules on everything the page says: no em or en dash, no 'we', 'our' or 'us', plain ASCII", () => {
  const strings = [...Object.values(EG.MESSAGES).flatMap((m) => [m.title, m.body]), ...Object.values(EG.QUEUED), EG.ruleLine({ meets: true }), EG.ruleLine({ meets: false, why: "caregiver" }), EG.ruleLine({ meets: false, why: "other" })];
  for (const k of ["approved", "held", "declined", "rehearsal"]) { const t = EG.resultText({ kind: k, signup: { first_name: "Sam", number: 1 }, invited: true }); strings.push(t.title, t.body); }
  strings.push(EG.resultText({ kind: "approved", signup: { first_name: "Sam" }, invited: false, queued: "x" }).body);
  assert.ok(strings.length > 25);
  for (const s of strings) {
    assert.ok(!/[–—]/.test(s), `a dash in: ${s}`);
    assert.ok(!/[^\x00-\x7F]/.test(s), `non-ASCII in: ${s}`);
    assert.ok(!/\b(we|we're|we'll|our|ours|us|let's)\b/i.test(s), `we-voice in: ${s}`);
  }
});
