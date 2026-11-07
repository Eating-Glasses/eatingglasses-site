// Tests for confirm/confirm.js, the page the "confirm your email" email and the stop link open  (S84, Option C; merged only when Justin flips the switch)
//
//   node --test tests/confirm-page.test.mjs        (Node 18+; no dependencies)
//
// WHAT RUNS. The real confirm/confirm.js, loaded as a module. The server is a MOCKED fetch: nothing here reaches the network.
// HELD HERE: the link is read from ?t= (43 characters) or ?s= (a row id, a dot, 43 characters) and nothing else is accepted; opening the page and drawing the card send
// NOTHING, so a scanner or a reload changes nothing; only the button is a POST, once however often it is pressed, to the beta-onboarding function and nowhere else, with
// the action that matches the link; every answer maps to plain words; a lost connection lets the person look and try again; nothing the server sends is parsed as
// HTML; the page holds no secret of its own; and it is never indexed and never leaks its address as a referrer.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const require = createRequire(import.meta.url);
const EG = require(path.join(ROOT, "confirm", "confirm.js"));
const HTML = readFileSync(path.join(ROOT, "confirm", "index.html"), "utf8");
const JS = readFileSync(path.join(ROOT, "confirm", "confirm.js"), "utf8");

const T = "A".repeat(42) + "b";
const S = "0a1b2c3d-4e5f-6789-abcd-ef0123456789." + "C".repeat(42) + "d";
const FUNCTION_URL = "https://pnnqxzqpfjsliwymmecv.supabase.co/functions/v1/beta-onboarding";
const json = (status, body) => ({ status, json: () => Promise.resolve(body) });

function world(answer) {
  const calls = [];
  const log = [];
  let press = null;
  const fetchFn = (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); const r = typeof answer === "function" ? answer(calls.length) : answer; return r instanceof Error ? Promise.reject(r) : Promise.resolve(r); };
  const ui = {
    message: (t, b, ok) => log.push(["message", t, b, ok]),
    card: (card, onPress) => { log.push(["card", card]); press = onPress; },
    busy: (on) => log.push(["busy", on]),
    notice: (t) => log.push(["notice", t]),
  };
  return { calls, log, ui, api: EG.createApi(fetchFn), press: () => press(), last: () => log.at(-1) };
}

test("the link: ?t= takes 43 characters, ?s= takes a row id, a dot and 43 characters; anything else is no link", () => {
  assert.deepEqual(EG.paramsFromSearch(`?t=${T}`), { mode: "confirm", token: T });
  assert.deepEqual(EG.paramsFromSearch(`?s=${S}`), { mode: "stop", token: S });
  assert.deepEqual(EG.paramsFromSearch(`?t=${T}&s=${S}`), { mode: "stop", token: S }, "stop wins when both are there: it is the safer thing to do");
  for (const bad of ["", "?", "?t=", "?t=short", `?t=${T}x`, `?t=${S}`, `?s=${T}`, "?s=not-a-row.token", `?s=${S}0`, "?x=1"]) assert.deepEqual(EG.paramsFromSearch(bad), { mode: null, token: null }, bad);
  assert.deepEqual(EG.paramsFromSearch(undefined), { mode: null, token: null });
});

test("opening the page sends nothing: a card with one button; no link shows the plain 'needs the link' message", async () => {
  const w = world(json(500, {}));
  assert.equal(await EG.start({ ui: w.ui, api: w.api, mode: "confirm", token: T }), "card");
  assert.equal(w.calls.length, 0, "no request until the button");
  assert.equal(w.last()[1].button, "Confirm my email");
  const s = world(json(500, {}));
  await EG.start({ ui: s.ui, api: s.api, mode: "stop", token: S });
  assert.equal(s.last()[1].button, "Stop these emails");
  assert.equal(s.calls.length, 0);
  const n = world(json(500, {}));
  assert.equal(await EG.start({ ui: n.ui, api: n.api, mode: null, token: null }), "missing");
  assert.deepEqual(n.last(), ["message", "This page needs the link from the email", "Open the link in the email from Justin.", false]);
  assert.equal(n.calls.length, 0);
});

test("the button is one POST with the matching action, sent once however often it is pressed, to the beta-onboarding function only", async () => {
  for (const [mode, token, action, status, title] of [["confirm", T, "confirm_email", "confirmed", "Email confirmed"], ["stop", S, "stop", "stopped", "Stopped"]]) {
    const w = world(json(200, { ok: true, status }));
    await EG.start({ ui: w.ui, api: w.api, mode, token });
    await Promise.all([w.press(), w.press(), w.press()]);
    assert.equal(w.calls.length, 1, "pressed three times, sent once");
    assert.equal(w.calls[0].url, FUNCTION_URL);
    assert.equal(w.calls[0].init.method, "POST");
    assert.deepEqual(w.calls[0].body, { action, token });
    assert.equal(w.last()[1], title);
    assert.equal(w.last()[3], true);
  }
});

test("every answer of the server has plain words; a refused link is not shown as success", async () => {
  const cases = [
    [json(409, { ok: false, status: "used" }), "Already confirmed", true],
    [json(410, { ok: false, status: "expired" }), "This link has expired", false],
    [json(404, { ok: false, status: "invalid" }), "This link does not work", false],
    [json(503, { ok: false, status: "paused", mode: "off" }), "Not available right now", false],
    [json(500, { ok: false, status: "error" }), "That did not work", false],
    [json(403, { ok: false, status: "forbidden" }), "That did not work", false],
    [json(404, "<html>platform 404</html>"), "That did not work", false],
    [{ status: 200, json: () => Promise.reject(new Error("not json")) }, "That did not work", false],
  ];
  for (const [answer, title, ok] of cases) {
    const w = world(answer);
    await EG.start({ ui: w.ui, api: w.api, mode: "confirm", token: T });
    await w.press();
    assert.deepEqual([w.last()[1], w.last()[3]], [title, ok], title);
  }
});

test("a lost connection lets the person look and press again; the page never says it worked", async () => {
  const w = world((n) => (n === 1 ? new Error("offline") : json(200, { ok: true, status: "confirmed" })));
  await EG.start({ ui: w.ui, api: w.api, mode: "confirm", token: T });
  await w.press();
  assert.deepEqual(w.log.slice(-2), [["busy", false], ["notice", "Could not reach the server. Reload this page to see whether it went through."]]);
  await w.press();
  assert.equal(w.calls.length, 2);
  assert.equal(w.last()[1], "Email confirmed");
});

test("the HTML: never indexed, no referrer, no inline secret, only this page's own script, and the key is the public one", () => {
  assert.match(HTML, /<meta name="robots" content="noindex, nofollow"/);
  assert.match(HTML, /<meta name="referrer" content="no-referrer"/);
  assert.match(HTML, /<script src="\/confirm\/confirm\.js\?v=1"><\/script>\s*<script>EGConfirm\.boot\(window\);<\/script>/);
  assert.ok(!/<script src="https?:/.test(HTML), "no third-party script");
  assert.ok(!/eyJ[A-Za-z0-9_-]{20,}|sb_secret_|service_role/.test(HTML + JS), "no secret, no JWT");
  assert.deepEqual([...new Set([...JS.matchAll(/sb_[a-z]+_[A-Za-z0-9_]+/g)].map((m) => m[0].split("_").slice(0, 2).join("_")))], ["sb_publishable"]);
  assert.ok(!/localStorage|sessionStorage|document\.cookie|innerHTML|insertAdjacentHTML|document\.write/.test(JS), "keeps nothing, writes no HTML");
  assert.deepEqual([...JS.matchAll(/https?:\/\/[^"'\s)]+/g)].map((m) => m[0]).filter((u) => !u.startsWith("https://pnnqxzqpfjsliwymmecv.supabase.co/functions/v1/beta-onboarding")), [], "it names no other address");
});

test("the words: no dash, no 'we', plain; a stop never says delete", () => {
  const all = Object.values(EG.CARDS).flatMap((c) => [c.title, c.body, c.button]).concat(Object.values(EG.RESULTS).flatMap((r) => [r.title, r.body]));
  for (const s of all) {
    assert.ok(!/[–—]/.test(s), `dash in ${s}`);
    assert.ok(!/\b(we|our|us|let's)\b/i.test(s), `we-voice in ${s}`);
    assert.ok(!/delete/i.test(s), `${s}`);
  }
  assert.match(EG.CARDS.stop.body, /Your place on the list stays\./);
});
