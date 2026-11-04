// Tests for clinician/index.html (queue item 11: eatingglasses.com/clinician was a 404).
//
//   node --test tests/clinician-page.test.mjs        (Node 18+; no dependencies, no network)
//
// HELD HERE:
//   - the six sections a clinician asks for are there, in order, with the approved 10-second pitch verbatim in the hero;
//   - the bright line is stated (never a dose, never a diagnosis, never a prediction), and the data lines are the approved wording only
//     (no "your data stays on your phone", no HIPAA, no "free app", no first or only);
//   - three actors only (no we, our, us, let's), no em or en dash, people-first language;
//   - every link resolves: internal paths to a file in this repo, in-page anchors to an id, the beta link carries ?ref=cl01, the contact is mailto:support@eatingglasses.com;
//   - the page is in sitemap.xml.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = readFileSync(path.join(ROOT, "clinician", "index.html"), "utf8");
const SITEMAP = readFileSync(path.join(ROOT, "sitemap.xml"), "utf8");

const textOf = (html) => html
  .replace(/<!--[\s\S]*?-->/g, " ")
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/\s+/g, " ")
  .trim();
const MAIN = HTML.slice(HTML.indexOf("<main"), HTML.indexOf("</main>"));
const TEXT = textOf(MAIN);

test("the page has the six sections, in order, and the approved 10-second pitch verbatim", () => {
  const h2 = [...MAIN.matchAll(/<h2>([\s\S]*?)<\/h2>/g)].map((m) => textOf(m[1]));
  assert.deepEqual(h2, [
    "What it does",
    "What it never does",
    "How data is handled",
    "The care-team report",
    "How a patient joins the beta",
    "Contact",
  ]);
  assert.match(textOf(MAIN.slice(0, MAIN.indexOf("</section>"))), /^For clinicians Eating Glasses finds the patterns in your CGM data, suggests small steps drawn from published research to work on them, and tracks your progress, all with nothing to log\./);
  assert.ok(/<h1[^>]*>For clinicians<\/h1>/.test(MAIN), "one h1");
});

test("the bright line is stated, and the data wording is the approved wording only", () => {
  for (const line of [
    "It never computes or suggests an insulin dose.",
    "It never diagnoses a condition.",
    "It never predicts glucose or sends alarms. The CGM keeps that job.",
    "It never sells health data or shares it with advertisers.",
    "Your CGM readings never leave your phone.",
    "Glucose is analyzed on the phone by a rules-based engine and never sent to an AI.",
    "Optional food scans go to an Eating Glasses server and an AI service.",
    "The account and its diabetes profile settings are stored on an Eating Glasses server.",
    "Every report states that it is observations only, contains no treatment recommendations, and is not a diagnosis.",
  ]) assert.ok(TEXT.includes(line), `missing: ${line}`);
  // each phrase below was proposed by someone and is false or unprovable (the claims file's "Never say" list)
  for (const [name, rx] of [
    ["your data stays on your phone", /\b(?:your|all) data stays on (?:your|the) phone/i],
    ["only food scans leave", /no data leaves|only health-related data/i],
    ["free app", /\bfree app\b/i],
    ["an endorsement or review claim", /approved by the ADA|clinically verified|peer-reviewed/i],
    ["HIPAA", /HIPAA/i],
    ["an outcome promise", /\bit worked\b|\bwhat works\b/i],
    ["first, only or nobody else", /\b(?:the first|the only|nobody else)\b/i],
    ["Loop or Trio", /\b(?:Loop|Trio)\b/],
    ["treatment recommendations offered", /\boffers? treatment recommendations\b/i],
  ]) assert.ok(!rx.test(TEXT), `banned claim: ${name}`);
  assert.ok(TEXT.includes("The beta is free."), "the beta is free (never 'free app')");
  assert.ok(TEXT.includes("A basic care-team report stays free."), "the free promise as the app makes it");
});

test("the voice: three actors only, no dash, people-first", () => {
  assert.ok(!/[–—]/.test(HTML), "no em or en dash anywhere in the file");
  assert.ok(!/\b(we|our|ours|us|let's)\b/i.test(TEXT), "no we, our, us or let's");
  assert.ok(!/\bdiabetics?\b/i.test(TEXT), "never 'diabetic' for a person");
  assert.ok(!/\bshould\b|\bmust\b/i.test(TEXT), "no directive to the reader");
});

test("the contact and the beta link are exact", () => {
  assert.ok(MAIN.includes('<a href="mailto:support@eatingglasses.com">support@eatingglasses.com</a>'), "the contact");
  assert.ok(!/hello@eatingglasses\.com/.test(HTML), "the old address is not used");
  assert.ok(MAIN.includes('href="/beta/?ref=cl01"'), "the beta link carries the clinician ref");
});

test("every link resolves: internal paths to a file, anchors to an id, mailto to the support address", () => {
  const hrefs = [...HTML.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length > 10);
  for (const h of hrefs) {
    if (/^https?:\/\//.test(h)) continue; // the canonical URL is checked below
    if (h.startsWith("mailto:")) { assert.equal(h, "mailto:support@eatingglasses.com"); continue; }
    if (h.startsWith("#")) { assert.ok(HTML.includes(`id="${h.slice(1)}"`), `${h} has no target`); continue; }
    assert.ok(h.startsWith("/"), `${h} is site-relative`);
    const clean = h.split("#")[0].split("?")[0];
    const file = path.join(ROOT, clean);
    const resolved = clean.endsWith("/") ? path.join(file, "index.html") : file;
    assert.ok(existsSync(resolved) && statSync(resolved).isFile(), `${h} does not resolve to a file (${resolved})`);
  }
  assert.ok(HTML.includes('<link rel="canonical" href="https://eatingglasses.com/clinician/" />'));
});

test("the page is in the sitemap, once", () => {
  assert.equal(SITEMAP.split("<loc>https://eatingglasses.com/clinician/</loc>").length - 1, 1);
});

test("the page is a clean page: tags balance, a title and a description, and it is short", () => {
  const VOID = new Set(["meta", "link", "img", "br", "input", "hr"]);
  const stack = [];
  for (const m of HTML.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g)) {
    const [, close, name, self] = m;
    if (VOID.has(name.toLowerCase()) || self) continue;
    if (close) assert.equal(stack.pop(), name.toLowerCase(), `a closing </${name}> with nothing open`);
    else stack.push(name.toLowerCase());
  }
  assert.deepEqual(stack, [], "every tag is closed");
  assert.match(HTML, /<title>For clinicians \| Eating Glasses<\/title>/);
  assert.match(HTML, /<meta name="description" content="[^"]{40,}" \/>/);
  const words = TEXT.split(" ").length;
  assert.ok(words <= 450, `${words} words`);
});
