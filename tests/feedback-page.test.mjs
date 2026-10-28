// Tests for feedback/feedback.js, the personal feedback form at eatingglasses.com/feedback  (S82)
//
//   node --test tests/feedback-page.test.mjs        (Node 18+; no dependencies)
//
// WHAT RUNS. The real feedback/feedback.js, loaded as a module (it exports itself when `module` exists, and sets window.EGFeedback in a browser). The server is a
// MOCKED fetch: nothing here reaches the network, and no token or answer leaves this process. The form definition is a fixture with the same shape the
// feedback-submit function sends (cd-preview/supabase-functions/feedback-submit/forms.ts publicForm()); the page holds no question text of its own.
//
// HELD HERE: the link is read from ?t= and only a 43-character token is accepted; every reply of the server maps to the right thing on the page; the submit
// flow (check, form, validate, send once, thank-you; a refusal, a used link, a dropped connection) is driven end to end through a recording UI; what is sent is
// exactly the shown questions, trimmed, with a follow-up only when its answer opens it; the in-progress draft survives a reload and never holds the token; and the
// copy rules for what a tester reads (no em dash, never "we", never "free" for the app) and the privacy basics of the page (noindex, no referrer, no
// third-party host, nothing put on the page as HTML).
// tests/feedback-page.dom.test.mjs runs the same page in a real DOM (jsdom) when jsdom is installed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const require = createRequire(import.meta.url);
const EG = require(path.join(ROOT, "feedback", "feedback.js"));
const HTML = readFileSync(path.join(ROOT, "feedback", "index.html"), "utf8");
const JS = readFileSync(path.join(ROOT, "feedback", "feedback.js"), "utf8");

const TOKEN = "A".repeat(42) + "b";
const FORM = {
  kind: "d14", version: 1, title: "Two weeks with Eating Glasses", openHint: "Please leave out glucose values and other health details.",
  sub: "About 5 minutes. Every tester gets the same questions, so answers can be compared. Nothing here asks for glucose numbers or health details. Your answers are saved by Eating Glasses and linked to your beta sign-up. * means required.",
  thanks: { title: "Thank you", body: "Your answers are saved and every one is read." },
  questions: [
    { id: "q1", type: "choice", req: true, text: "How would you feel if you could no longer use Eating Glasses?", opts: [["very", "Very disappointed"], ["somewhat", "Somewhat disappointed"], ["not", "Not disappointed"]] },
    { id: "q2", type: "scale", req: true, min: 0, max: 10, lo: "Not at all likely", hi: "Extremely likely", text: "How likely are you to recommend it to someone with Type 1?" },
    { id: "q4", type: "choice", req: true, text: "Has anything looked wrong about your numbers?", opts: [["yes", "Yes"], ["no", "No"]], follow: { when: ["yes"], label: "Where?", hint: "The screen or card is enough. You do not need to type any glucose numbers." } },
    { id: "g3", type: "scale", min: 1, max: 5, lo: "Very hard", hi: "Very easy", text: "How easy is it to keep your glucose data coming into Eating Glasses?", follow: { lte: 3, label: "What would make it easier?", hint: "A short answer is fine." } },
    { id: "q6", type: "rank", req: true, text: "Rank the parts by how useful they are to you.", items: [["patterns", "Patterns"], ["results", "Results"], ["widget", "Widget"]] },
    { id: "q9", type: "open", text: "What is the most useful thing it has done for you?" },
    { id: "pay", type: "choice", pre: "The beta is free. This question is about later, and nothing changes for you today.", text: "After the beta, what is the most you would pay each month for Eating Glasses?", opts: [["p999", "Up to $9.99 a month"], ["none", "I would not pay for it"]] },
    { id: "g9", type: "multi", text: "Which parts would you pay for?", pre: "Pick any that apply.", items: [["report", "Care-team report"], ["patterns", "Patterns"]], showIf: { id: "pay", unless: ["none"] } },
    { id: "q12", type: "pair", parts: [{ id: "q12a", text: "May Eating Glasses quote you, first name only?" }, { id: "q12b", text: "Up for a 20-minute call?" }] },
  ],
};
const ALL_PARTS = { order: ["results", "patterns"], unused: ["widget"] };

// a mocked fetch: replies in order, records every request
function mockFetch(...replies) {
  const calls = [];
  const fn = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, init, body });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (r instanceof Error) throw r;
    return { status: r.status, json: async () => { if (r.raw !== undefined) throw new SyntaxError("not json"); return r.body; } };
  };
  fn.calls = calls;
  return fn;
}
const OK_FORM = { status: 200, body: { ok: true, status: "ok", form: FORM } };
const SAVED = { status: 200, body: { ok: true, status: "saved" } };

// a UI that records what the flow asks of it
function recordingUi() {
  const calls = [];
  const rec = (name) => (...a) => { calls.push([name, ...a]); };
  const ui = { loading: rec("loading"), message: rec("message"), thanks: rec("thanks"), form: rec("form"), busy: rec("busy"), banner: rec("banner"), showMissing: rec("showMissing"), serverErrors: rec("serverErrors") };
  const names = () => calls.map((c) => c[0]);
  return { ui, calls, names, last: (n) => [...calls].reverse().find((c) => c[0] === n) };
}
function memoryDraft(initial) {
  let data = initial ?? null; let cleared = 0; const saves = [];
  return { load: () => data, save: (a) => { data = a; saves.push(a); }, clear: () => { data = null; cleared++; }, saves, get cleared() { return cleared; } };
}
// start() and then get at the state + submit the flow handed to ui.form
async function open({ replies = [OK_FORM], draft = null, token = TOKEN } = {}) {
  const fetch = mockFetch(...replies);
  const r = recordingUi();
  const result = await EG.start({ token, api: EG.createApi(fetch), ui: r.ui, draft });
  const form = r.last("form");
  return { fetch, ...r, result, state: form && form[2], submit: form && form[3] };
}
function answerRequired(state) {
  state.set("q1", "very"); state.set("q2", 9); state.set("q4", "no");
  state.rankPlace(FORM.questions[4], "results"); state.rankPlace(FORM.questions[4], "patterns"); state.rankUnused(FORM.questions[4], "widget", true);
}

// ── the link ────────────────────────────────────────────────────────────────────────────────────────────────────
test("the link: only ?t= with a 43-character token counts", () => {
  assert.equal(EG.tokenFromSearch("?t=" + TOKEN), TOKEN);
  assert.equal(EG.tokenFromSearch("t=" + TOKEN), TOKEN);
  assert.equal(EG.tokenFromSearch("?x=1&t=" + TOKEN + "&y=2"), TOKEN);
  const good = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP-_";
  assert.equal(good.length, 44);
  for (const bad of ["", "?", "?t=", "?t=short", "?t=" + TOKEN + "x", "?t=" + TOKEN.slice(1), "?t=" + "A".repeat(42) + "!", "?t=" + "A".repeat(42) + "%20", "?token=" + TOKEN, "?T=" + TOKEN, "?t=%3Cscript%3E", null, undefined]) {
    assert.equal(EG.tokenFromSearch(bad), null, JSON.stringify(bad));
  }
  assert.equal(EG.tokenFromSearch("?t=" + "A".repeat(42) + "_"), "A".repeat(42) + "_", "base64url's _ and - are fine");
  assert.equal(EG.tokenFromSearch("?t=" + "A".repeat(42) + "-"), "A".repeat(42) + "-");
});

// ── what the server's answers mean ──────────────────────────────────────────────────────────────────────────────
test("every reply of feedback-submit maps to one thing the page does", () => {
  const c = (http, j) => EG.classify(http, j).kind;
  assert.equal(c(200, { ok: true, status: "ok", form: FORM }), "form");
  assert.equal(c(200, { ok: true, status: "saved" }), "saved");
  assert.equal(c(200, { ok: true, status: "saved", rehearsal: true }), "saved", "a dry-run link thanks the tester the same way");
  assert.equal(c(404, { ok: false, status: "invalid" }), "invalid");
  assert.equal(c(409, { ok: false, status: "used" }), "used");
  assert.equal(c(410, { ok: false, status: "expired" }), "expired");
  assert.equal(c(400, { ok: false, status: "invalid_answers", errors: { q1: "Choose one." } }), "invalid_answers");
  assert.deepEqual(EG.classify(400, { ok: false, status: "invalid_answers", errors: { q1: "Choose one." } }).errors, { q1: "Choose one." });
  assert.deepEqual(EG.classify(400, { ok: false, status: "invalid_answers" }).errors, {}, "no errors object is an empty one");
  // not ours, or not working: an error, never "this link does not work" (the function may simply not be deployed yet)
  for (const [http, j] of [[500, { ok: false, status: "error" }], [403, { ok: false, status: "forbidden" }], [413, { ok: false, status: "too_large" }], [404, { code: "NOT_FOUND", message: "Requested function was not found" }], [502, null], [200, {}], [200, null]]) {
    assert.equal(c(http, j), "error", `${http} ${JSON.stringify(j)}`);
  }
  assert.equal(c(200, { status: "invalid" }), "error", "'invalid' counts only with the 404 the function sends with it");
  assert.equal(c(200, { ok: true, status: "ok" }), "error", "ok with no form is not a form");
  assert.equal(c(500, { ok: true, status: "saved" }), "saved", "the body decides, as the function answers consistently");
});

test("the API client sends the token and answers as the function expects, with the public key, and survives a dead network", async () => {
  const f = mockFetch(OK_FORM, SAVED, { status: 500, body: { ok: false, status: "error" } });
  const api = EG.createApi(f);
  assert.equal((await api.check(TOKEN)).kind, "form");
  assert.equal((await api.submit(TOKEN, { q1: "very" })).kind, "saved");
  assert.equal((await api.check(TOKEN)).kind, "error");
  assert.deepEqual(f.calls[0].body, { action: "check", token: TOKEN });
  assert.deepEqual(f.calls[1].body, { token: TOKEN, answers: { q1: "very" } });
  for (const c of f.calls) {
    assert.equal(c.url, "https://pnnqxzqpfjsliwymmecv.supabase.co/functions/v1/feedback-submit");
    assert.equal(c.init.method, "POST");
    assert.equal(c.init.headers["Content-Type"], "application/json");
    assert.match(c.init.headers.apikey, /^sb_publishable_/, "the public key, as /beta uses");
    assert.equal(c.init.headers.Authorization, "Bearer " + c.init.headers.apikey);
  }
  const dead = EG.createApi(mockFetch(new Error("offline")));
  assert.equal((await dead.check(TOKEN)).kind, "error");
  assert.equal((await dead.submit(TOKEN, {})).kind, "error");
  const notJson = EG.createApi(mockFetch({ status: 502, raw: "<html>bad gateway</html>" }));
  assert.equal((await notJson.check(TOKEN)).kind, "error");
});

// ── the answers ─────────────────────────────────────────────────────────────────────────────────────────────────
test("what is sent: only the shown questions, text trimmed, nothing empty, a follow-up only when its answer opens it", () => {
  const s = EG.createState(FORM);
  assert.deepEqual(s.payload(), {}, "nothing answered, nothing sent");
  s.set("q1", "very"); s.set("q2", 0); // 0 is a real answer
  s.set("q4", "yes"); s.set("q4_t", "  The home screen  ");
  s.set("g3", 3); s.set("g3_t", "Daily updates");
  s.set("q9", "   "); // blank is skipped
  s.set("q12a", "yes");
  assert.deepEqual(s.payload(), { q1: "very", q2: 0, q4: "yes", q4_t: "The home screen", g3: 3, g3_t: "Daily updates", q12a: "yes" });
  s.set("q4", "no");
  assert.ok(!("q4_t" in s.payload()), "Where? only follows a Yes, even though the text is still in the box");
  s.set("g3", 4);
  assert.ok(!("g3_t" in s.payload()), "easier? only for 3 or lower");
  s.set("q9", "  Useful  ");
  assert.equal(s.payload().q9, "Useful");
});

test("the ranking: place in order, take one back, mark one 'Haven't used it', and it counts as placed", () => {
  const s = EG.createState(FORM);
  const q = FORM.questions[4];
  assert.deepEqual(s.rank(q), { order: [], unused: [] });
  s.rankPlace(q, "results"); s.rankPlace(q, "patterns");
  assert.deepEqual(s.rank(q).order, ["results", "patterns"]);
  s.rankPlace(q, "results"); // tap again: out
  assert.deepEqual(s.rank(q).order, ["patterns"]);
  s.rankPlace(q, "results");
  assert.deepEqual(s.rank(q).order, ["patterns", "results"], "back in, at the end");
  assert.equal(s.isAnswered(q), false, "two of three placed");
  s.rankUnused(q, "widget", true);
  assert.equal(s.isAnswered(q), true);
  s.rankUnused(q, "patterns", true);
  assert.deepEqual(s.rank(q), { order: ["results"], unused: ["widget", "patterns"] }, "an unused part leaves the ranking");
  s.rankPlace(q, "patterns");
  assert.deepEqual(s.rank(q).order, ["results"], "an unused part cannot be ranked until it is un-ticked");
  s.rankUnused(q, "patterns", false);
  s.rankPlace(q, "patterns");
  assert.deepEqual(s.rank(q), { order: ["results", "patterns"], unused: ["widget"] });
  assert.deepEqual(s.payload().q6, { order: ["results", "patterns"], unused: ["widget"] });
});

test("'which parts would you pay for' shows only after a price is named, and what was ticked while it was hidden is not sent", () => {
  const s = EG.createState(FORM);
  const g9 = FORM.questions[7];
  assert.equal(s.isShown(g9), false, "no price yet");
  s.set("pay", "p999");
  assert.equal(s.isShown(g9), true);
  s.toggleMulti(g9, "report", true); s.toggleMulti(g9, "patterns", true); s.toggleMulti(g9, "patterns", false);
  assert.deepEqual(s.payload().g9, ["report"]);
  s.set("pay", "none");
  assert.equal(s.isShown(g9), false);
  assert.ok(!("g9" in s.payload()), "'I would not pay for it' hides the question and its answer goes with it");
  s.set("pay", "p999");
  assert.deepEqual(s.payload().g9, ["report"], "it comes back as it was");
  assert.equal(s.progress().total, 9);
});

test("required questions: what is missing, what counts as answered, progress", () => {
  const s = EG.createState(FORM);
  assert.deepEqual(s.missing(), ["q1", "q2", "q4", "q6"]);
  s.set("q2", 0);
  assert.ok(!s.missing().includes("q2"), "0 is an answer");
  s.set("q1", "very"); s.set("q4", "yes");
  assert.deepEqual(s.missing(), ["q6"]);
  s.rankPlace(FORM.questions[4], "results");
  assert.deepEqual(s.missing(), ["q6"], "a part short of all three");
  s.rankUnused(FORM.questions[4], "patterns", true); s.rankUnused(FORM.questions[4], "widget", true);
  assert.deepEqual(s.missing(), []);
  assert.deepEqual(s.progress(), { answered: 4, total: 8 });
  // the pair counts as answered only when both parts are
  s.set("q12a", "yes");
  assert.equal(s.progress().answered, 4);
  s.set("q12b", "no");
  assert.equal(s.progress().answered, 5);
  // a hidden required question would not be asked (none is hidden in the real forms, but the rule holds)
  assert.ok(!s.missing().includes("g9"));
});

test("a saved draft is restored only for keys the form has, and every change is saved", () => {
  const state = EG.createState(FORM, { q1: "very", q4: "yes", q4_t: "Home", is_admin: true, __proto__x: 1, q6: { order: ["results"], unused: [] } });
  assert.equal(state.get("q1"), "very");
  assert.equal(state.get("q4_t"), "Home");
  assert.equal(state.get("is_admin"), undefined, "a key the form does not have is dropped");
  assert.deepEqual(state.rank(FORM.questions[4]), { order: ["results"], unused: [] });
  assert.equal(EG.createState(FORM, "not an object").get("q1"), undefined);
  assert.equal(EG.createState(FORM, null).get("q1"), undefined);
});

test("the draft key holds a fingerprint of the token, never the token", () => {
  const store = new Map();
  const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const d = EG.sessionDraft(storage, TOKEN);
  assert.equal(d.load(), null);
  d.save({ q1: "very" });
  assert.deepEqual(d.load(), { q1: "very" });
  const [key] = [...store.keys()];
  assert.match(key, /^eg_feedback_draft:[0-9a-f]+$/);
  assert.ok(!key.includes(TOKEN) && !JSON.stringify([...store]).includes(TOKEN), "no token in the key or the value");
  const otherKeys = [];
  EG.sessionDraft({ getItem: () => null, setItem: (k) => otherKeys.push(k), removeItem() {} }, "B".repeat(43)).save({});
  assert.equal(otherKeys.length, 1);
  assert.notEqual(otherKeys[0], key, "another link, another key");
  d.clear();
  assert.equal(d.load(), null);
  // storage that throws (private mode, full) never breaks the form
  const broken = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("full"); }, removeItem() { throw new Error("denied"); } };
  const b = EG.sessionDraft(broken, TOKEN);
  assert.equal(b.load(), null);
  assert.doesNotThrow(() => { b.save({ q1: "x" }); b.clear(); });
});

// ── the flow, end to end, with a recording UI and a mocked server ────────────────────────────────────────────────
test("no link: a plain message and no request at all", async () => {
  const f = mockFetch(OK_FORM);
  const r = recordingUi();
  assert.equal(await EG.start({ token: null, api: EG.createApi(f), ui: r.ui }), "missing");
  assert.deepEqual(r.calls, [["message", "missing"]]);
  assert.equal(f.calls.length, 0);
});

test("a link that opens nothing gets a plain message, and the form is never drawn", async () => {
  for (const [reply, kind] of [
    [{ status: 404, body: { ok: false, status: "invalid" } }, "invalid"],
    [{ status: 409, body: { ok: false, status: "used" } }, "used"],
    [{ status: 410, body: { ok: false, status: "expired" } }, "expired"],
    [{ status: 500, body: { ok: false, status: "error" } }, "error"],
    [new Error("offline"), "error"],
  ]) {
    const o = await open({ replies: [reply] });
    assert.equal(o.result, kind);
    assert.deepEqual(o.names(), ["loading", "message"]);
    assert.deepEqual(o.last("message"), ["message", kind]);
    assert.equal(o.fetch.calls.length, 1, "one check, nothing else");
    assert.deepEqual(o.fetch.calls[0].body, { action: "check", token: TOKEN });
  }
  for (const kind of ["missing", "invalid", "expired", "used", "error"]) {
    const m = EG.MESSAGES[kind];
    assert.ok(m.title && m.body, kind);
  }
});

test("an open link draws the form once; the check consumed nothing", async () => {
  const o = await open();
  assert.equal(o.result, "form");
  assert.deepEqual(o.names(), ["loading", "form"]);
  assert.equal(o.last("form")[1], FORM);
  assert.equal(o.fetch.calls.length, 1);
});

test("submit with a required question missing: the page names them and sends nothing", async () => {
  const o = await open();
  o.state.set("q1", "very");
  assert.equal(await o.submit(), "missing_answers");
  assert.deepEqual(o.last("showMissing"), ["showMissing", ["q2", "q4", "q6"]]);
  assert.equal(o.fetch.calls.length, 1, "still only the check");
  assert.ok(!o.names().includes("busy"));
});

test("submit with everything answered sends once, exactly the shown answers, then says thank you and forgets the draft", async () => {
  const draft = memoryDraft();
  const o = await open({ replies: [OK_FORM, SAVED], draft });
  answerRequired(o.state);
  o.state.set("q4", "yes"); o.state.set("q4_t", "  Home screen "); o.state.set("pay", "none"); o.state.toggleMulti(FORM.questions[7], "report", true);
  assert.equal(await o.submit(), "saved");
  assert.equal(o.fetch.calls.length, 2);
  assert.deepEqual(o.fetch.calls[1].body, {
    token: TOKEN,
    answers: { q1: "very", q2: 9, q4: "yes", q4_t: "Home screen", q6: { order: ["results", "patterns"], unused: ["widget"] }, pay: "none" },
  });
  assert.deepEqual(o.calls.filter((c) => c[0] === "busy"), [["busy", true], ["busy", false]]);
  assert.deepEqual(o.last("thanks"), ["thanks", FORM.thanks], "the thank-you wording comes from the server");
  assert.equal(draft.cleared, 1, "the draft is cleared once the answers are safe");
  assert.equal(draft.load(), null);
});

test("a double tap sends once", async () => {
  const o = await open({ replies: [OK_FORM, SAVED] });
  answerRequired(o.state);
  const [a, b] = await Promise.all([o.submit(), o.submit()]);
  assert.deepEqual([a, b].sort(), ["busy", "saved"]);
  assert.equal(o.fetch.calls.length, 2, "one check, ONE submit");
});

test("a dropped connection keeps the form and the answers, says so, and the next tap sends", async () => {
  const draft = memoryDraft();
  const o = await open({ replies: [OK_FORM, new Error("offline"), SAVED], draft });
  answerRequired(o.state);
  assert.equal(await o.submit(), "error");
  assert.deepEqual(o.last("banner"), ["banner", EG.NOT_SENT]);
  assert.equal(EG.NOT_SENT, "Your answers were not sent. Check your connection and try again.");
  assert.equal(o.names().includes("thanks"), false);
  assert.equal(o.names().includes("message"), false, "no redirect to a dead end: the form stays");
  assert.equal(draft.cleared, 0, "the draft survives a failed send");
  assert.deepEqual(o.calls.filter((c) => c[0] === "busy").map((c) => c[1]), [true, false], "the button is released");
  assert.equal(await o.submit(), "saved", "the retry works");
  assert.equal(draft.cleared, 1);
});

test("a refusal from the server marks the questions it names; a used or expired link ends the form with a plain message", async () => {
  const o = await open({ replies: [OK_FORM, { status: 400, body: { ok: false, status: "invalid_answers", errors: { q2: "Choose a number from 0 to 10.", q12a: "Choose one." } } }] });
  answerRequired(o.state);
  assert.equal(await o.submit(), "invalid_answers");
  assert.deepEqual(o.last("serverErrors"), ["serverErrors", { q2: "Choose a number from 0 to 10.", q12a: "Choose one." }]);
  assert.equal(o.names().includes("thanks"), false);

  for (const [reply, kind] of [[{ status: 409, body: { ok: false, status: "used" } }, "used"], [{ status: 410, body: { ok: false, status: "expired" } }, "expired"], [{ status: 404, body: { ok: false, status: "invalid" } }, "invalid"]]) {
    const x = await open({ replies: [OK_FORM, reply] });
    answerRequired(x.state);
    assert.equal(await x.submit(), kind);
    assert.deepEqual(x.last("message"), ["message", kind]);
  }
  const e = await open({ replies: [OK_FORM, { status: 500, body: { ok: false, status: "error" } }] });
  answerRequired(e.state);
  assert.equal(await e.submit(), "error");
  assert.deepEqual(e.last("banner"), ["banner", EG.NOT_SENT]);
});

test("a draft from an earlier visit is picked up, and every change is saved as it happens", async () => {
  const draft = memoryDraft({ q1: "somewhat", q9: "from before" });
  const o = await open({ draft });
  assert.equal(o.state.get("q1"), "somewhat");
  assert.equal(o.state.get("q9"), "from before");
  o.state.set("q2", 7);
  assert.deepEqual(draft.saves.at(-1), { q1: "somewhat", q9: "from before", q2: 7 });
  assert.ok(!JSON.stringify(draft.saves).includes(TOKEN));
});

// ── the copy and the page ───────────────────────────────────────────────────────────────────────────────────────
const WE = /\b(?:[Ww]e|[Oo]ur|[Oo]urs|[Oo]urselves|us)(?:['’](?:ll|re|ve|d))?\b|\b[Ll]et['’]s\b/;
const DASH = /[–—]/;
function pageText() {
  const body = HTML.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!--[\s\S]*?-->/g, "");
  return body.replace(/<[^>]+>/g, " ").replace(/&middot;|&#183;/g, " ").replace(/\s+/g, " ");
}

test("copy a tester reads: the plain messages, the buttons and the page: no em dash, never 'we', the app never called free", () => {
  const strings = [
    ...Object.entries(EG.MESSAGES).flatMap(([k, m]) => [[`message ${k} title`, m.title], [`message ${k} body`, m.body]]),
    ["not sent", EG.NOT_SENT],
    ["page text", pageText()],
    ["fixture sub", FORM.sub],
  ];
  assert.ok(WE.test("We will send it") && WE.test("let's go") && !WE.test("Eating Glasses will send it") && !WE.test("the US"), "the 'we' detector works");
  for (const [label, s] of strings) {
    assert.ok(!DASH.test(s), `${label}: an em or en dash`);
    assert.ok(!WE.test(s), `${label}: says we, our or us: ${s.slice(0, 80)}`);
    assert.ok(!/\bfree\b/i.test(s), `${label}: says free`);
  }
  // the actors: a link that fails points the tester to Eating Glasses, by reply
  assert.match(EG.MESSAGES.invalid.body, /reply to that email and Eating Glasses will send you a new one/);
  assert.match(EG.MESSAGES.expired.body, /Eating Glasses will send you a new one/);
  // the glucose hint is on the page: the open-question hint comes from the server, the intro says nothing here asks for numbers
  assert.ok(FORM.openHint.includes("glucose values") && FORM.sub.includes("Nothing here asks for glucose numbers"));
});

test("the page: never indexed, no referrer, no third-party host, the one script it loads is its own, nothing from the server is put on the page as HTML", () => {
  assert.match(HTML, /<meta name="robots" content="noindex, nofollow" \/>/);
  assert.match(HTML, /<meta name="referrer" content="no-referrer" \/>/);
  assert.match(HTML, /<script src="\/feedback\/feedback\.js\?v=\d+"><\/script>/);
  assert.match(HTML, /EGFeedback\.boot\(window\)/);
  assert.match(HTML, /<div id="app"/);
  assert.match(HTML, /<noscript>/);
  const hosts = [...(HTML + JS).matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase());
  const allowed = new Set(["pnnqxzqpfjsliwymmecv.supabase.co", "www.w3.org"]);
  for (const h of hosts) assert.ok(allowed.has(h), `the page contacts or names ${h}`);
  assert.ok(!/googleapis|gstatic|cdn\.|unpkg|jsdelivr|cloudflare/i.test(HTML + JS), "fonts and scripts are served from this site");
  // the form's words go on the page as text
  assert.ok(!/\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write|\beval\(/.test(JS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "feedback.js must not build HTML from the server's text");
  // the token goes nowhere but the function: not into storage, not into the address
  const code = JS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/localStorage|history\.(push|replace)State|document\.cookie/.test(code));
  assert.equal((code.match(/sessionStorage/g) || []).length, 1, "the one use of sessionStorage is the draft (answers, never the token)");
});

test("the file loads in a browser as window.EGFeedback and in Node as a module, and only the documented surface is exported", () => {
  assert.deepEqual(Object.keys(EG).sort(), ["API_URL", "MESSAGES", "NOT_SENT", "boot", "classify", "createApi", "createDomUi", "createState", "sessionDraft", "start", "tokenFromSearch"]);
  assert.match(JS, /root\.EGFeedback = factory\(\)/);
  assert.equal(EG.API_URL, "https://pnnqxzqpfjsliwymmecv.supabase.co/functions/v1/feedback-submit");
});
