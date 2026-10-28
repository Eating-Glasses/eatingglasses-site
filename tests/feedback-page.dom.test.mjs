// DOM tests for the personal feedback form at eatingglasses.com/feedback  (S82): the real page and the real feedback.js in a real DOM (jsdom)
//
//   npm i --no-save --ignore-scripts --prefix <dir> jsdom
//   JSDOM_DIR=<dir> node --test tests/feedback-page.dom.test.mjs
// Without JSDOM_DIR (or an installed jsdom) every test here is SKIPPED with "NO VERDICT": it never reports a pass it did not earn. The logic of the page is held
// without a DOM in feedback-page.test.mjs, which always runs.
//
// WHAT RUNS. feedback/index.html (its scripts stripped) and feedback/feedback.js evaluated in a jsdom window at https://eatingglasses.com/feedback/?t=<token>,
// with window.fetch replaced by a MOCK. Nothing reaches the network. The form is the fixture the server would send; the page holds no question text of its own.
// HELD HERE: the form is drawn from the data (every type, in order, numbered, required marked), the follow-up boxes and the pay-for question open and close,
// the ranking works with taps, a submit with a gap names the gap, a full submit sends exactly the shown answers once and ends on the thank-you, a dropped
// connection keeps the form, a link that opens nothing shows a plain message, a reload keeps the draft, and nothing the server sends is ever parsed as HTML.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const HTML = readFileSync(path.join(ROOT, "feedback", "index.html"), "utf8");
const JS = readFileSync(path.join(ROOT, "feedback", "feedback.js"), "utf8");

let JSDOM = null;
try {
  const base = process.env.JSDOM_DIR ? path.join(path.resolve(process.env.JSDOM_DIR), "noop.js") : import.meta.url;
  const mod = await import(pathToFileURL(createRequire(base).resolve("jsdom")).href);
  JSDOM = mod.JSDOM ?? mod.default?.JSDOM ?? null;
} catch { /* every test below is skipped, loudly */ }
const skip = JSDOM ? false : "NO VERDICT: jsdom is not installed (see the install line at the top of this file)";

const TOKEN = "A".repeat(42) + "b";
const FORM = {
  kind: "d14", version: 1, title: "Two weeks with Eating Glasses", openHint: "Please leave out glucose values and other health details.",
  sub: "About 5 minutes. Every tester gets the same questions. * means required.",
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
const OK_FORM = { status: 200, body: { ok: true, status: "ok", form: FORM } };
const SAVED = { status: 200, body: { ok: true, status: "saved" } };

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), get size() { return m.size; }, entries: () => [...m] };
}

async function page({ search = "?t=" + TOKEN, replies = [OK_FORM], storage = memoryStorage() } = {}) {
  const html = HTML.replace(/<script[\s\S]*?<\/script>/g, ""); // the page's own boot is replaced by the explicit call below
  const dom = new JSDOM(html, { url: "https://eatingglasses.com/feedback/" + search, pretendToBeVisual: true, runScripts: "outside-only" });
  const w = dom.window;
  const calls = [];
  w.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, init, body });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (r instanceof Error) throw r;
    return { status: r.status, json: async () => r.body };
  };
  Object.defineProperty(w, "sessionStorage", { value: storage, configurable: true });
  w.eval(JS);
  const ended = await w.EGFeedback.boot(w);
  const $ = (s) => w.document.querySelector(s);
  const $$ = (s) => [...w.document.querySelectorAll(s)];
  const click = (sel) => { const n = typeof sel === "string" ? $(sel) : sel; assert.ok(n, `nothing at ${sel}`); n.click(); };
  const choose = (name, value) => click(`label[for="q-${name}-${value}"]`);
  const type = (sel, text) => { const n = $(sel); n.value = text; n.dispatchEvent(new w.Event("input", { bubbles: true })); };
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const shown = () => $$(".fq").filter((n) => !n.hidden);
  return { w, dom, calls, ended, $, $$, click, choose, type, settle, shown, storage };
}
function answerRequired(p) {
  p.choose("q1", "very"); p.choose("q2", 9); p.choose("q4", "no");
  p.click('button[data-k="results"]'); p.click('button[data-k="patterns"]'); p.click('label[for="q-q6-un-widget"]');
}

test("the form is drawn from the data: every question in order, numbered, required ones marked, the hidden one not shown", { skip }, async () => {
  const p = await page();
  assert.equal(p.ended, "form");
  assert.equal(p.$("h1").textContent, FORM.title);
  assert.equal(p.$(".step-sub").textContent, FORM.sub);
  assert.equal(p.$(".k").textContent, "Eating Glasses beta");
  assert.deepEqual(p.shown().map((n) => n.dataset.q), ["q1", "q2", "q4", "g3", "q6", "q9", "pay", "q12"], "g9 waits for a price");
  assert.deepEqual(p.shown().map((n) => n.querySelector(".q-n").textContent), ["1", "2", "3", "4", "5", "6", "7", "8"]);
  assert.equal(p.$$(".req").length, 4, "q1, q2, q4 and q6 carry the required star");
  assert.equal(p.$("#fq-q1 .qt").textContent, "How would you feel if you could no longer use Eating Glasses? *");
  assert.equal(p.$$("#fq-q2 input[type=radio]").length, 11, "0 to 10");
  assert.equal(p.$$("#fq-g3 input[type=radio]").length, 5);
  assert.equal(p.$("#fq-q2 .scale-ends").textContent, "0 = Not at all likely" + "10 = Extremely likely");
  assert.equal(p.$("#fq-pay .q-pre").textContent, FORM.questions[6].pre);
  assert.equal(p.$("#q-q9").getAttribute("maxlength"), "1000");
  assert.equal(p.$("#fq-q9 .hint").textContent, FORM.openHint, "the no-glucose hint is under every open box");
  assert.equal(p.$(".prog").textContent, "0 of 8 answered");
  assert.equal(p.$("button[type=submit]").textContent, "Submit");
  assert.equal(p.$$(".follow").every((f) => f.hidden), true, "no follow-up box until an answer opens it");
  assert.equal(p.calls.length, 1);
  assert.deepEqual(p.calls[0].body, { action: "check", token: TOKEN });
});

test("answering opens and closes the follow-up boxes, the pay-for question, and keeps the count and the numbers right", { skip }, async () => {
  const p = await page();
  p.choose("q1", "very");
  assert.equal(p.$(".prog").textContent, "1 of 8 answered");
  assert.equal(p.$("#q-q1-very").checked, true);
  p.choose("q4", "yes");
  assert.equal(p.$("#fol-q4").hidden, false);
  assert.equal(p.$("#fol-q4 label").textContent, "Where?");
  assert.equal(p.$("#fol-q4 .hint").textContent, "The screen or card is enough. You do not need to type any glucose numbers.");
  p.choose("q4", "no");
  assert.equal(p.$("#fol-q4").hidden, true);
  p.choose("g3", 4);
  assert.equal(p.$("#fol-g3").hidden, true);
  p.choose("g3", 2);
  assert.equal(p.$("#fol-g3").hidden, false, "3 or lower asks what would make it easier");
  assert.equal(p.$("#fol-g3 label").textContent, "What would make it easier?");
  p.choose("pay", "p999");
  assert.deepEqual(p.shown().map((n) => n.dataset.q), ["q1", "q2", "q4", "g3", "q6", "q9", "pay", "g9", "q12"]);
  assert.deepEqual(p.shown().map((n) => n.querySelector(".q-n").textContent), ["1", "2", "3", "4", "5", "6", "7", "8", "9"], "the numbers close up");
  p.click('label[for="q-g9-report"]');
  p.choose("pay", "none");
  assert.deepEqual(p.shown().map((n) => n.dataset.q), ["q1", "q2", "q4", "g3", "q6", "q9", "pay", "q12"]);
  assert.equal(p.$(".prog").textContent, "4 of 8 answered", "q1, q4, g3, pay");
  p.type("#q-q9", "  something useful ");
  assert.equal(p.$(".prog").textContent, "5 of 8 answered");
  p.type("#q-q9", "   ");
  assert.equal(p.$(".prog").textContent, "4 of 8 answered", "blank is not an answer");
});

test("the ranking: tap in order, tap again to remove, tick Haven't used it; the status counts placed parts", { skip }, async () => {
  const p = await page();
  const btn = (k) => p.$(`#fq-q6 button[data-k="${k}"]`);
  assert.equal(p.$("#fq-q6 .rk-status").textContent, "0 of 3 placed");
  p.click(btn("results"));
  p.click(btn("patterns"));
  assert.equal(btn("results").querySelector(".rk-n").textContent, "1");
  assert.equal(btn("patterns").querySelector(".rk-n").textContent, "2");
  assert.equal(btn("results").getAttribute("aria-pressed"), "true");
  p.click(btn("results"));
  assert.equal(btn("results").querySelector(".rk-n").textContent, "");
  assert.equal(btn("patterns").querySelector(".rk-n").textContent, "1", "the others close up");
  p.click('label[for="q-q6-un-widget"]');
  assert.equal(btn("widget").disabled, true, "an unused part cannot be ranked");
  assert.equal(p.$("#fq-q6 .rk-status").textContent, "2 of 3 placed");
  p.click('label[for="q-q6-un-widget"]');
  assert.equal(btn("widget").disabled, false);
  assert.equal(p.$("#fq-q6 .rk-status").textContent, "1 of 3 placed");
});

test("submit with gaps: the page names how many, marks them, and sends nothing", { skip }, async () => {
  const p = await page();
  p.choose("q1", "very");
  p.click("button[type=submit]");
  await p.settle();
  assert.equal(p.$(".status-banner").textContent, "Please answer the 3 marked questions.");
  assert.ok(p.$(".status-banner").className.includes("show"));
  assert.deepEqual(p.$$(".fq.is-err").map((n) => n.dataset.q), ["q2", "q4", "q6"]);
  assert.equal(p.$("#err-q2").textContent, "Choose one.");
  assert.equal(p.$("#err-q6").textContent, "Rank each part, or tick Haven't used it.");
  assert.equal(p.calls.length, 1, "only the check went out");
  p.choose("q2", 7);
  assert.equal(p.$("#fq-q2").className.includes("is-err"), false, "answering clears that question's mark");
  assert.equal(p.$("#err-q2").hidden, true);
});

test("a full submit sends exactly the shown answers once and ends on the thank-you; the draft is gone", { skip }, async () => {
  const storage = memoryStorage();
  const p = await page({ replies: [OK_FORM, SAVED], storage });
  answerRequired(p);
  p.choose("q4", "yes"); p.type("#q-q4_t", "  The home screen  ");
  p.choose("pay", "p999"); p.click('label[for="q-g9-report"]'); p.choose("pay", "none");
  p.type("#q-q9", "Useful");
  p.choose("q12b", "yes");
  assert.ok(storage.size === 1, "a draft is being kept in this tab");
  p.click("button[type=submit]");
  assert.equal(p.$("button[type=submit]").disabled, true, "the button is held while it sends");
  assert.equal(p.$("button[type=submit]").textContent, "Sending...");
  await p.settle(); await p.settle();
  assert.equal(p.calls.length, 2);
  assert.deepEqual(p.calls[1].body, {
    token: TOKEN,
    answers: { q1: "very", q2: 9, q4: "yes", q4_t: "The home screen", q6: { order: ["results", "patterns"], unused: ["widget"] }, q9: "Useful", pay: "none", q12b: "yes" },
  });
  assert.equal(p.$("h1").textContent, "Thank you");
  assert.equal(p.$$("h1").length, 1, "one h1 on every state of the page");
  assert.equal(p.$("#app p").textContent, "Your answers are saved and every one is read.");
  assert.equal(p.w.document.activeElement, p.$("h1"), "focus moves to the heading, so a screen reader announces it");
  assert.equal(p.$$("form").length, 0, "the form is gone");
  assert.equal(storage.size, 0, "the draft is cleared");
});

test("a dropped connection keeps the form and the answers; the next tap sends", { skip }, async () => {
  const p = await page({ replies: [OK_FORM, new Error("offline"), SAVED] });
  answerRequired(p);
  p.click("button[type=submit]");
  await p.settle(); await p.settle();
  assert.equal(p.$(".status-banner").textContent, "Your answers were not sent. Check your connection and try again.");
  assert.equal(p.$("button[type=submit]").disabled, false);
  assert.equal(p.$("button[type=submit]").textContent, "Submit");
  assert.equal(p.$("#q-q1-very").checked, true, "nothing was lost");
  assert.equal(p.$$("form").length, 1);
  p.click("button[type=submit]");
  await p.settle(); await p.settle();
  assert.equal(p.$("h1").textContent, "Thank you");
});

test("the server's refusal marks the questions it names", { skip }, async () => {
  const refusal = { status: 400, body: { ok: false, status: "invalid_answers", errors: { q2: "Choose a number from 0 to 10." } } };
  const p = await page({ replies: [OK_FORM, refusal] });
  answerRequired(p);
  p.click("button[type=submit]");
  await p.settle(); await p.settle();
  assert.equal(p.$("#err-q2").textContent, "Choose a number from 0 to 10.");
  assert.ok(p.$("#fq-q2").className.includes("is-err"));
  assert.equal(p.$(".status-banner").textContent, "Please fix the marked questions and send again.");
  const wrongForm = await page({ replies: [OK_FORM, { status: 400, body: { ok: false, status: "invalid_answers", errors: { _form: "Something is wrong with the answers. Reload the page and try again." } } }] });
  answerRequired(wrongForm);
  wrongForm.click("button[type=submit]");
  await wrongForm.settle(); await wrongForm.settle();
  assert.equal(wrongForm.$(".status-banner").textContent, "Something is wrong with the answers. Reload the page and try again.");
});

test("a link that opens nothing shows a plain message, with the same wording the flow test holds", { skip }, async () => {
  const cases = [
    [{ status: 404, body: { ok: false, status: "invalid" } }, "This link does not work"],
    [{ status: 409, body: { ok: false, status: "used" } }, "You already sent this one"],
    [{ status: 410, body: { ok: false, status: "expired" } }, "This link has expired"],
    [{ status: 500, body: { ok: false, status: "error" } }, "The form did not load"],
    [new Error("offline"), "The form did not load"],
  ];
  for (const [reply, title] of cases) {
    const p = await page({ replies: [reply] });
    assert.equal(p.$("h1").textContent, title);
    assert.equal(p.$$("h1").length, 1);
    assert.equal(p.$$("form").length, 0);
    assert.equal(p.w.document.activeElement, p.$("h1"));
  }
  const noLink = await page({ search: "" });
  assert.equal(noLink.$("h1").textContent, "This page needs your personal link");
  assert.equal(noLink.calls.length, 0, "no link, no request");
  const bad = await page({ search: "?t=not-a-token" });
  assert.equal(bad.$("h1").textContent, "This page needs your personal link");
  assert.equal(bad.calls.length, 0);
});

test("a reload keeps what the tester had typed (this tab only), and never stores the token", { skip }, async () => {
  const storage = memoryStorage();
  const first = await page({ storage });
  first.choose("q1", "somewhat"); first.choose("q4", "yes"); first.type("#q-q4_t", "Home"); first.type("#q-q9", "half a thought");
  first.click('button[data-k="results"]');
  const dump = JSON.stringify(storage.entries());
  assert.ok(!dump.includes(TOKEN), "no token in storage");
  const again = await page({ storage }); // the reload: a fresh page over the same tab storage
  assert.equal(again.$("#q-q1-somewhat").checked, true);
  assert.equal(again.$("#fol-q4").hidden, false);
  assert.equal(again.$("#q-q4_t").value, "Home");
  assert.equal(again.$("#q-q9").value, "half a thought");
  assert.equal(again.$('#fq-q6 button[data-k="results"] .rk-n').textContent, "1");
  assert.equal(again.$(".prog").textContent, "3 of 8 answered");
  // a different link has its own draft
  const other = await page({ storage, search: "?t=" + "B".repeat(42) + "c" });
  assert.equal(other.$("#q-q1-somewhat").checked, false);
});

test("nothing the server sends is parsed as HTML: markup in a title, a label or an option stays text", { skip }, async () => {
  const evil = JSON.parse(JSON.stringify(FORM));
  evil.title = "<img src=x onerror=window.__pwned=1>Two weeks";
  evil.sub = "<script>window.__pwned=1</script>About 5 minutes";
  evil.questions[0].text = "<b>bold</b> How would you feel?";
  evil.questions[0].opts[0][1] = "<i onclick=window.__pwned=1>Very</i>";
  evil.questions[2].follow.label = "<a href=javascript:1>Where?</a>";
  const p = await page({ replies: [{ status: 200, body: { ok: true, status: "ok", form: evil } }] });
  assert.equal(p.$("h1").textContent, evil.title);
  assert.equal(p.$$("#app img, #app script, #app b, #app i, #app a").length, 0, "no element was created from the server's text");
  assert.equal(p.w.__pwned, undefined);
  assert.ok(p.$("#fq-q1 .qt").textContent.includes("<b>bold</b>"));
  assert.equal(p.$("label[for='q-q1-very']").textContent, "<i onclick=window.__pwned=1>Very</i>");
  p.click("label[for='q-q1-very']");
  assert.equal(p.w.__pwned, undefined);
});

test("keyboard and screen readers: real radios, checkboxes and buttons; groups are labelled; the banner is an alert", { skip }, async () => {
  const p = await page();
  assert.equal(p.$$("#fq-q1 input[type=radio]").length, 3);
  const group = p.$("#fq-q1 [role=group]");
  assert.equal(group.getAttribute("aria-labelledby"), "lbl-q1");
  assert.equal(group.getAttribute("aria-required"), "true");
  assert.equal(p.$("#fq-q9 [role=group]"), null);
  assert.equal(p.$("#q-q9").getAttribute("aria-labelledby"), "lbl-q9");
  assert.equal(p.$("#fq-q6 ul").getAttribute("aria-labelledby"), "lbl-q6");
  assert.ok(p.$$("#fq-q6 input[type=checkbox]").length === 3);
  assert.ok(p.$$("#fq-q6 button").every((b) => b.type === "button"), "rank buttons never submit the form");
  assert.equal(p.$(".status-banner").getAttribute("role"), "alert");
  assert.equal(p.$(".prog").getAttribute("aria-live"), "polite");
  // every radio and checkbox has a label that points at it
  for (const input of p.$$("input[type=radio], input[type=checkbox]")) assert.ok(p.$(`label[for="${input.id}"]`), `no label for ${input.id}`);
  assert.equal(p.$("form").getAttribute("novalidate"), "", "the page does its own, friendlier, validation");
});
