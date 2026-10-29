// DOM tests for the approval page at eatingglasses.com/approve  (S82): the real page and the real approve.js in a real DOM (jsdom)
//
//   npm i --no-save --ignore-scripts --prefix <dir> jsdom        (the prefix needs its own package.json)
//   JSDOM_DIR=<dir> node --test tests/approve-page.dom.test.mjs
// Without JSDOM_DIR (or an installed jsdom) every test here is SKIPPED with "NO VERDICT": it never reports a pass it did not earn. The logic of the page is held
// without a DOM in approve-page.test.mjs, which always runs.
//
// WHAT RUNS. approve/index.html (its scripts stripped) and approve/approve.js evaluated in a jsdom window at https://eatingglasses.com/approve/?t=<token>&do=..., with
// window.fetch replaced by a MOCK. Nothing reaches the network.
// HELD HERE: the card names the sign-up and the rule; the link's ?do= picks the main button and the other two follow; pressing locks the buttons and sends ONE
// decide; the result replaces the card; a refused or unreadable link shows a plain message with no buttons; and a name the server sends is text, never markup.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const HTML = readFileSync(path.join(ROOT, "approve", "index.html"), "utf8");
const JS = readFileSync(path.join(ROOT, "approve", "approve.js"), "utf8");

let JSDOM = null;
try {
  const base = process.env.JSDOM_DIR ? path.join(path.resolve(process.env.JSDOM_DIR), "noop.js") : import.meta.url;
  const mod = await import(pathToFileURL(createRequire(base).resolve("jsdom")).href);
  JSDOM = mod.JSDOM ?? mod.default?.JSDOM ?? null;
} catch { /* every test below is skipped, loudly */ }
const skip = JSDOM ? false : "NO VERDICT: jsdom is not installed (see the install line at the top of this file)";

const TOKEN = "A".repeat(42) + "b";
const json = (status, body) => ({ status, json: () => Promise.resolve(body) });
const tick = () => new Promise((r) => setTimeout(r, 0));

function open(search, handlers) {
  const calls = [];
  const html = HTML.replace(/<script[\s\S]*?<\/script>/g, "");
  const dom = new JSDOM(html, { url: `https://eatingglasses.com/approve/${search}`, runScripts: "outside-only" });
  const win = dom.window;
  win.fetch = (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    const h = handlers[body.action];
    return Promise.resolve(typeof h === "function" ? h(body) : h);
  };
  win.eval(JS);
  const started = win.EGApprove.boot(win);
  return { win, doc: win.document, calls, started, app: () => win.document.getElementById("app") };
}
const CARD = (over = {}) => json(200, { ok: true, status: "ok", signup: { first_name: "Sam", number: 12 }, meets_rule: true, why: "ok", stage: "awaiting_approval", rehearsal: false, ...over });
const buttons = (page) => [...page.app().querySelectorAll("button")];

test("the card names the sign-up and the rule; the link's button is first and primary, the other two follow", { skip }, async () => {
  for (const [pick, order] of [["approve", ["approve", "hold", "decline"]], ["hold", ["hold", "approve", "decline"]], ["decline", ["decline", "approve", "hold"]]]) {
    const page = open(`?t=${TOKEN}&do=${pick}`, { check: CARD() });
    await page.started;
    assert.equal(page.app().querySelector("h1").textContent, "Sam (sign-up #12)");
    assert.match(page.app().textContent, /Meets the invite rule: yes\./);
    const bs = buttons(page);
    assert.deepEqual(bs.map((b) => b.dataset.decision), order, pick);
    assert.ok(bs[0].className.includes("btn-primary"));
    assert.ok(bs.slice(1).every((b) => b.className.includes("btn-secondary")));
    assert.deepEqual(bs.map((b) => b.textContent), order.map((d) => (d === "approve" ? "Approve and invite Sam" : d === "hold" ? "Hold" : "Not a fit")));
    assert.equal(page.calls.length, 1, "opening the page asked 'check' only");
    assert.equal(page.calls[0].body.action, "check");
  }
});

test("pressing Approve locks the buttons, sends ONE decide, and the result replaces the card", { skip }, async () => {
  const page = open(`?t=${TOKEN}&do=approve`, { check: CARD(), decide: json(200, { ok: true, status: "approved", signup: { first_name: "Sam", number: 12 }, invited: true }) });
  await page.started;
  const [approve, hold] = buttons(page);
  approve.click();
  assert.ok(buttons(page).every((b) => b.disabled), "locked at once");
  hold.click(); approve.click(); // more presses while it is sent
  await tick(); await tick();
  assert.equal(page.calls.filter((c) => c.body.action === "decide").length, 1);
  assert.deepEqual(page.calls.at(-1).body, { action: "decide", token: TOKEN, decision: "approve" });
  assert.equal(page.app().querySelector("h1").textContent, "Done");
  assert.match(page.app().textContent, /Sam is invited\. Apple is sending the TestFlight invite/);
  assert.equal(buttons(page).length, 0, "no button after a decision");
});

test("a held sign-up's card says it is held and why, and offers Keep on hold and Not a fit, never Approve", { skip }, async () => {
  for (const pick of ["approve", "hold", "decline"]) {
    const page = open(`?t=${TOKEN}&do=${pick}`, { check: CARD({ stage: "held", hold_reason: "LC: waits for ready" }) });
    await page.started;
    assert.match(page.app().textContent, /On hold: LC: waits for ready/);
    const bs = buttons(page);
    assert.deepEqual(bs.map((b) => b.dataset.decision), pick === "decline" ? ["decline", "hold"] : ["hold", "decline"], pick);
    assert.deepEqual(bs.map((b) => b.textContent).sort(), ["Keep on hold", "Not a fit"]);
    assert.ok(!bs.some((b) => /Approve/.test(b.textContent)), "no Approve button");
    assert.match(page.app().textContent, /an Approve link does not release a hold: ask LC to release it first/);
    assert.equal(page.calls.length, 1, "only the check");
  }
});

test("a person already in the TestFlight group but not invited: the card says so", { skip }, async () => {
  const page = open(`?t=${TOKEN}`, { check: CARD({ in_group_not_invited: true }) });
  await page.started;
  assert.match(page.app().textContent, /Already in the TestFlight group, not invited yet\./);
  const plain = open(`?t=${TOKEN}`, { check: CARD() });
  await plain.started;
  assert.ok(!/TestFlight group/.test(plain.app().textContent));
  // after a Hold the page says they are still in the group
  const held = open(`?t=${TOKEN}`, { check: CARD({ in_group_not_invited: true }), decide: json(200, { ok: true, status: "held", signup: { first_name: "Sam", number: 12 }, in_group_not_invited: true }) });
  await held.started;
  buttons(held).find((b) => b.dataset.decision === "hold").click();
  await tick(); await tick();
  assert.match(held.app().textContent, /Apple still lists them in the TestFlight group; remove them in App Store Connect if they should not be invited\./);
});

test("a caregiver card says why; a rehearsal card says nothing will happen", { skip }, async () => {
  const care = open(`?t=${TOKEN}`, { check: CARD({ meets_rule: false, why: "caregiver" }) });
  await care.started;
  assert.match(care.app().textContent, /Meets the invite rule: no\. This is a caregiver sign-up, so the teen and parent path comes first\./);
  const reh = open(`?t=${TOKEN}`, { check: CARD({ rehearsal: true }) });
  await reh.started;
  assert.match(reh.app().textContent, /Rehearsal link from a dry run: pressing a button here decides nothing\./);
});

test("a link that opens nothing shows a plain message and no button; no link at all makes no request", { skip }, async () => {
  const none = open("", {});
  await none.started;
  assert.equal(none.calls.length, 0);
  assert.equal(none.app().querySelector("h1").textContent, "This page needs the link from the email");
  assert.equal(buttons(none).length, 0);
  for (const [reply, title] of [[json(404, { ok: false, status: "invalid" }), "This link does not work"], [json(409, { ok: false, status: "used" }), "This link was already used"], [json(410, { ok: false, status: "expired" }), "This link has expired"], [json(500, {}), "That did not work"]]) {
    const page = open(`?t=${TOKEN}`, { check: reply });
    await page.started;
    assert.equal(page.app().querySelector("h1").textContent, title);
    assert.equal(buttons(page).length, 0);
  }
});

test("a name the server sends is text, never markup", { skip }, async () => {
  const evil = `<img src=x onerror="window.__owned=1">Sam`;
  const page = open(`?t=${TOKEN}`, { check: CARD({ signup: { first_name: evil, number: 3 } }) });
  await page.started;
  assert.equal(page.app().querySelector("img"), null);
  assert.equal(page.win.__owned, undefined);
  assert.ok(page.app().querySelector("h1").textContent.includes("<img"), "shown as the characters it is");
  assert.ok(buttons(page)[0].textContent.includes("<img"));
});

test("the page after a dropped connection on a press: the buttons return with the note to reload", { skip }, async () => {
  const page = open(`?t=${TOKEN}`, { check: CARD(), decide: () => Promise.reject(new TypeError("Failed to fetch")) });
  await page.started;
  buttons(page)[0].click();
  await tick(); await tick();
  assert.ok(buttons(page).every((b) => !b.disabled));
  const note = page.app().querySelector('[role="alert"]');
  assert.equal(note.textContent, "Could not reach the server. Reload this page to see whether it went through.");
  assert.ok(note.className.includes("show"));
});
