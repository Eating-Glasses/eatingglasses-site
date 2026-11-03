// Tests for setup/index.html (the guide a tester opens from Email 2) and the /beta success words  (S84 first-connect)
//
//   node --test tests/setup-page.test.mjs        (Node 18+; no dependencies, no network)
//
// HELD HERE (Justin 11-03: "absolutely no friction ... when a new user tries to connect with their data for the first time", and "we need to make this as easy as possible for users ...
// we need to always be clear, concise, and helpful"):
//   - BEFORE YOU START is one line: turn on Apple Health sharing in the CGM app BEFORE opening Eating Glasses. It does not repeat the TestFlight install (Email 2 step 1 and the /beta
//     page already say it), and it no longer carries the "open it once, wait a minute, close it" line (that was for builds 15 and earlier; a current build waits on its own);
//   - Dexcom G7, Dexcom G6 and Stelo say the newest readings in Eating Glasses are about 3 hours behind the CGM app, and that this is normal (the vendors' own
//     pages: a 3 hour delay; read 11-03). Eversense says nothing about a delay (not confirmed). NOTHING tells a tester their first readings take a while: once sharing
//     is on, Eating Glasses reads what is already in Apple Health right away (LC, 11-03: measured 52 s and 4.8 min after a fix);
//   - the Eating Glasses step is ONE line that cannot skip a screen ("Open Eating Glasses and follow the screens. When Apple Health asks, turn on Blood Glucose, then tap Allow."), the same
//     line Email 2 step 3 says;
//   - FreeStyle Libre and Medtronic keep the wording they had before this PR ("Use a computer. It is the simplest way." for Libre, "easiest on a computer" for Medtronic): no "You need a
//     computer" and no minutes figure, which nothing in the app or the vendor pages establishes for a first-time tester; Medtronic is named the way the app names it;
//   - a "No readings came through?" section, in the app's own words for the screen it describes, with the steps in order and NO wait in it;
//   - the /beta success page tells a person who just joined to install the TestFlight app now, and the form is untouched.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SETUP = readFileSync(path.join(ROOT, "setup", "index.html"), "utf8");
const BETA = readFileSync(path.join(ROOT, "beta", "index.html"), "utf8");

const textOf = (html) => html
  .replace(/<!--[\s\S]*?-->/g, " ")
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/\s+/g, " ")
  .trim();
const MAIN = SETUP.slice(SETUP.indexOf("<main"), SETUP.indexOf("</main>"));
// one card, from its id to the next card (or the end of main)
function card(id) {
  const at = MAIN.indexOf(`id="${id}"`);
  assert.ok(at > 0, `the page has #${id}`);
  const start = MAIN.lastIndexOf("<div", at); // the card's own opening tag
  const next = MAIN.indexOf('<div class="card', at + 10);
  return textOf(MAIN.slice(start, next === -1 ? undefined : next));
}
const BEFORE = (() => {
  const start = MAIN.indexOf("<h2>Before you start</h2>");
  assert.ok(start > 0, "the page has a Before you start card");
  return textOf(MAIN.slice(start, MAIN.indexOf('<div class="card" id="dexcom-g7"')));
})();

const LAG = (brand) => `Your newest readings in Eating Glasses will be about 3 hours behind your ${brand} app. That is normal.`;

test("BEFORE YOU START: one line, turn on Apple Health sharing in the CGM app before opening Eating Glasses; the TestFlight install Email 2 already said is not repeated, and the old 'open it once, wait, close it' line is gone", () => {
  assert.equal(BEFORE, "Before you start If your CGM shares to Apple Health (Dexcom, Stelo or Eversense), turn that on in its app before you open Eating Glasses."); // S84 delta review: never tell a Libre or Medtronic member to turn on sharing they do not have
  assert.ok(!/TestFlight|invite|Spam|Junk/.test(BEFORE), "the install and the invite are Email 2 step 1 and the /beta page, not this card");
  assert.ok(!/wait about a minute|close it completely|open it once/i.test(SETUP), "that line was for builds 15 and earlier");
});

test("the lag is said for Dexcom G7, Dexcom G6 and Stelo only, as how old the newest readings are, and never as a wait", () => {
  assert.ok(card("dexcom-g7").includes(LAG("Dexcom")), "G7");
  assert.ok(card("dexcom-g6").includes(LAG("Dexcom")), "G6");
  assert.ok(card("stelo").includes(LAG("Stelo")), "Stelo");
  for (const id of ["eversense", "libre", "medtronic"]) assert.ok(!/3 hour|hours behind|delay/i.test(card(id)), `${id}: no lag claim`);
  assert.ok(!/first readings|can take a while|take up to|few hours|come back in|3 hour delay|after a minute|\bwait/i.test(textOf(MAIN)), "nobody is told to wait");
  assert.ok(!/Stelo sends readings to Apple Health on about a 3 hour delay/.test(SETUP), "Stelo's old middle-of-the-card line is replaced by the same line the others have");
});

test("each Apple Health card says first the CGM app, then Eating Glasses, in one line that cannot skip a screen", () => {
  for (const id of ["dexcom-g7", "dexcom-g6", "stelo", "eversense"]) {
    const t = card(id);
    assert.ok(t.includes("Open Eating Glasses and follow the screens. When Apple Health asks, turn on Blood Glucose, then tap Allow."), `${id}: one line that cannot skip a screen`);
    assert.ok(!/Tap Continue with Apple\. Then tap Connect Apple Health/.test(t), `${id}: no screen-by-screen taps`);
    assert.ok(t.indexOf("First, in the") < t.indexOf("Then, in Eating Glasses"), `${id}: the CGM app comes first`);
    assert.ok(!/Your readings come in from there/.test(t), `${id}: no filler`);
  }
});

test("FreeStyle Libre and Medtronic: the wording they had before this PR (Libre: 'Use a computer. It is the simplest way.'; Medtronic: 'easiest on a computer'), no 'You need a computer' and no minutes figure; Medtronic is named the way the app names it; the in-app exit is named by its real label", () => {
  for (const id of ["libre", "medtronic"]) {
    const t = card(id);
    assert.ok(!/You need a computer|Plan on|10 to 15|minute/i.test(t), `${id}: no "you need a computer" and no minutes figure`);
    assert.ok(t.includes(`tap "My CGM isn't in Apple Health"`), `${id}: the exit label`);
  }
  assert.ok(card("libre").includes("Get your file Use a computer. It is the simplest way. Open libreview.com."), "Libre: the app's own first step, as on main");
  assert.ok(card("medtronic").includes("Get your file (easiest on a computer)"), "Medtronic: the heading it had on main");
  assert.ok(card("libre").startsWith("FreeStyle Libre 2 or 3 (LibreView) Libre doesn't share readings with Apple Health, so you bring your history in from a LibreView file instead. Get your file"), "one intro sentence");
  assert.ok(card("medtronic").startsWith("Medtronic (MiniMed, Guardian) Medtronic doesn't share readings with Apple Health, so you bring your history in from a CareLink file instead. Get your file"), "one intro sentence, and the card is named like the app's row");
  assert.ok(card("medtronic").includes('Choose Medtronic (MiniMed, Guardian), then tap "Import my CareLink data"'), "and so is the in-app pick");
  assert.ok(MAIN.includes('<a href="#medtronic">Medtronic (MiniMed, Guardian)</a>'), "and the jump chip");
  assert.ok(!/Medtronic Guardian\b/.test(textOf(MAIN)), "no half-name left");
});

test("NO READINGS CAME THROUGH: a section, a jump chip, four steps in order (none of them a wait), the app's own words for the screen, and the way out", () => {
  assert.ok(MAIN.includes('<a href="#no-readings">No readings?</a>'), "a jump chip");
  const t = card("no-readings");
  assert.ok(t.startsWith("No readings came through?"), "the heading is the app's own screen title");
  const steps = [...MAIN.slice(MAIN.indexOf('id="no-readings"'), MAIN.indexOf('id="help"')).matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => textOf(m[1]));
  assert.deepEqual(steps, [
    "In the Health app, tap your picture or initials, then Apps, then Eating Glasses, and turn on Blood Glucose.",
    "In that same list, open your CGM app (for example Dexcom G7) and turn on Blood Glucose there too.",
    "In your CGM app, check that Apple Health sharing is on. If it is already on, turn it off and back on.",
    "Still stuck? Email support@eatingglasses.com with your CGM and what the screen says.",
  ]);
  assert.ok(!/after a minute|wait/i.test(t), "no wait anywhere in it (M3: readings arrive right away, so nobody is told to wait)");
  assert.match(t, /bring a file in/i, "the file way out");
  assert.ok(t.includes("Import my history"), "by the app's own label");
  assert.ok(/mailto:support@eatingglasses\.com/.test(MAIN), "and the address is a link");
  assert.ok(MAIN.indexOf('id="no-readings"') < MAIN.indexOf('id="help"'), "it sits before the general help card");
});

test("the page is still a clean page: tags balance, no em or en dash, no 'we' or 'our', the app is not called free, and it is short", () => {
  // tag balance over the page (void elements and the doctype do not close)
  const VOID = new Set(["meta", "link", "img", "br", "input", "hr"]);
  const stack = [];
  for (const m of SETUP.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g)) {
    const [, close, name, self] = m;
    if (VOID.has(name.toLowerCase()) || self) continue;
    if (close) assert.equal(stack.pop(), name.toLowerCase(), `a closing </${name}> with nothing open`);
    else stack.push(name.toLowerCase());
  }
  assert.deepEqual(stack, [], "every tag is closed");
  const t = textOf(MAIN);
  assert.ok(!/[–—]/.test(SETUP), "no em or en dash");
  assert.ok(!/\b(we|our|ours|let's)\b/i.test(t), "no 'we' or 'our'");
  assert.ok(!/\bfree\b/i.test(t), "the app is never called free");
  assert.ok(!/insulin dose|how much insulin|dose your/i.test(t.replace("Eating Glasses never suggests an insulin dose", "")), "no dosing");
  // every in-page link has a target
  for (const m of MAIN.matchAll(/href="#([^"]+)"/g)) assert.ok(MAIN.includes(`id="${m[1]}"`), `#${m[1]} exists`);
  const words = t.split(" ").length;
  assert.ok(words <= 850, `${words} words (683 before S84; the new No readings card and the lag lines are the growth; 893 before the E2 round)`);
});

test("/beta success: a person who just joined is told to install the TestFlight app now; the other two answers and the form are untouched", () => {
  // the string is a JS literal in double quotes, so the quotes around Apple's subject are escaped in the source
  const lit = (start) => new RegExp(`body\\.textContent = "(${start}(?:[^"\\\\]|\\\\.)*)";`).exec(BETA)?.[1]?.replace(/\\"/g, '"');
  const body = lit("Eating Glasses is inviting people in small groups");
  assert.ok(body, "the waitlist success text is there");
  assert.ok(body.includes("When it's your turn, you'll get a personal email from Justin. Check your inbox for a confirmation."), "the existing lines stay");
  // the real invite (Justin 11-03, verbatim): sender "Justin Silver via TestFlight", subject "Justin Silver has invited you to test Eating Glasses."
  assert.ok(body.includes('Your invite comes from Apple: look for an email from Justin Silver via TestFlight called "Justin Silver has invited you to test Eating Glasses." Check Spam, Junk and Promotions too.'), body);
  assert.ok(body.includes("Install the TestFlight app from the App Store now, so it opens in one tap."), body);
  assert.ok(!/check spam and promotions|Apple's TestFlight\./.test(body), "the vaguer old sentences are gone");
  assert.ok(!/–|—/.test(body), "no dash");
  assert.ok(!/TestFlight app/.test(lit("The first round is US and iPhone only")), "a person who is not getting an invite is not told to install it");
  assert.ok(BETA.includes('<label class="q" for="cgm_model">CGM model</label>') && BETA.includes('id="lbl-apple_health"'), "the form still asks the CGM and the Apple Health question");
});
