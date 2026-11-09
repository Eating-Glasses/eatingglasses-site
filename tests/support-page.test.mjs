// Tests for support.html (the page the App Store support URL points at).
//   node --test tests/support-page.test.mjs        (Node 18+; no dependencies, no network)
// Held here: the page exists, names the one support address the app uses (constants/errorCopy.ts SUPPORT_EMAIL),
// links Privacy and Terms, and carries no dashes and no we/our/us.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = readFileSync(path.join(ROOT, "support.html"), "utf8");
const body = HTML.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ");

test("names the support address and links Privacy and Terms", () => {
  assert.match(HTML, /mailto:support@eatingglasses\.com/);
  assert.match(HTML, /href="\/privacy\.html"/);
  assert.match(HTML, /href="\/terms\.html"/);
});
test("no em or en dashes, no we/our/us", () => {
  assert.doesNotMatch(HTML, /[–—]/);
  assert.doesNotMatch(body, /\b(we|our|us)\b/i);
});
