// Local customization tests for per-ticker logo choices (resolveLogo's choice, sourcesFor, the cache).
// Run: node --test "%USERPROFILE%\.config\herdr-app\mods\quotr\.tests"
import test from "node:test";
import assert from "node:assert/strict";
import { LOGO_SOURCES, resolveLogo, sourcesFor } from "../logosource.js";
import { LogoCache } from "../logocache.js";

test("the dialog offers only sources that can show the ticker", () => {
  assert.deepEqual(sourcesFor("BTC/USDT").map((s) => s.id), ["allinvestview", "elbstream"]);
  assert.deepEqual(sourcesFor("MSTR").map((s) => s.id), ["allinvestview", "elbstream"], "AllInvestView is offered even though Auto skips it");
  assert.deepEqual(sourcesFor("INTR").map((s) => s.id), ["allinvestview", "elbstream"]);
  assert.deepEqual(sourcesFor("^GSPC"), [], "an index: no choice row");
});

test("a choice forces that source; None is the monogram; Auto and unknown choices keep the usual order", () => {
  const pick = (s, c) => resolveLogo(s, LOGO_SOURCES, c)?.source.id ?? "monogram";
  assert.equal(pick("MSTR"), "elbstream");
  assert.equal(pick("MSTR", "auto"), "elbstream");
  assert.equal(pick("MSTR", "allinvestview"), "allinvestview", "explicit: past Auto's decline");
  assert.equal(pick("INTR", "elbstream"), "elbstream");
  assert.equal(pick("BTC/USDT", "allinvestview"), "allinvestview");
  assert.equal(pick("INTR", "none"), "monogram");
  assert.equal(pick("INTR", "local"), "allinvestview", "a source that no longer exists (the old bundled one): back to Auto");
  assert.equal(pick("INTR", "made-up"), "allinvestview");
  assert.equal(resolveLogo("MSTR", LOGO_SOURCES, "allinvestview").chosen, true);
});

// A cache whose host reports the choices; the network is a fake.
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 128, 0, 0, 0, 128, 8, 6, 0, 0, 0, 0, 0, 0, 0]);
function host(choices) {
  const files = new Map();
  const h = {
    dir: "/c", rel: "r", clock: 1_800_000_000_000, downloads: [], files,
    preference: (s) => choices[s],
    fetchText: async () => JSON.stringify([{ symbol: "INTR", website: "https://inter.co" }]),
    readFile: async (p) => { if (!files.has(p)) throw new Error("ENOENT"); return files.get(p); },
    readText: async (p) => (files.has(p) ? String(files.get(p)) : null),
    writeFile: async (p, v) => { files.set(p, v); }, copyFile: async (a, b) => { files.set(b, files.get(a)); },
    exists: async (p) => files.has(p), mkdir: async () => {}, unlink: async (p) => { files.delete(p); },
    now: () => h.clock,
    download: async (u, to) => { h.downloads.push(u); files.set(to, PNG); return { status: 200, contentType: "image/png" }; },
  };
  return h;
}

test("switching a ticker's source replaces its logo (and its credit); switching back to Auto does too", async () => {
  const choices = {};
  const h = host(choices);
  const c = new LogoCache(h);
  await c.load();
  await c.refresh("INTR");
  assert.equal(c.sourceFor("INTR").id, "allinvestview");
  choices.INTR = "elbstream";
  assert.equal(c.pathFor("INTR"), null, "the AllInvestView file isn't shown under the new choice");
  assert.equal(c.needs("INTR", h.clock), true);
  await c.refresh("INTR");
  assert.equal(c.sourceFor("INTR").id, "elbstream");
  assert.equal(h.downloads.at(-1), "https://api.elbstream.com/logos/symbol/INTR");
  delete choices.INTR;
  assert.equal(c.needs("INTR", h.clock), true, "back to Auto: AllInvestView again");
});

test("None shows the monogram and makes no request", async () => {
  const h = host({ INTR: "none" });
  const c = new LogoCache(h);
  await c.load();
  assert.equal(c.needs("INTR", h.clock), false);
  assert.equal(await c.refresh("INTR"), false);
  assert.equal(c.pathFor("INTR"), null);
  assert.equal(c.sourceFor("INTR"), null, "so no credit for it either");
  assert.deepEqual(h.downloads, []);
});

test("a broken preference reader never breaks logos", async () => {
  const h = host({});
  h.preference = () => { throw new Error("shared state unavailable"); };
  const c = new LogoCache(h);
  await c.load();
  assert.equal(c.needs("INTR", h.clock), true, "Auto");
});

test("Change cycles through the ticker's sources from the one shown now, wrapping round", async () => {
  const { nextLogoSource } = await import("../logosource.js");
  assert.equal(nextLogoSource("MSTR"), "allinvestview", "Auto shows Elbstream: next is AllInvestView");
  assert.equal(nextLogoSource("MSTR", undefined, "allinvestview"), "elbstream", "and back");
  assert.equal(nextLogoSource("INTR"), "elbstream", "Auto shows AllInvestView");
  const order = [];
  let c;
  for (let i = 0; i < 3; i++) order.push((c = nextLogoSource("BTC/USDT", undefined, c)));
  assert.deepEqual(order, ["elbstream", "allinvestview", "elbstream"], "BTC: AllInvestView (Auto) → Elbstream → AllInvestView → …");
  assert.equal(nextLogoSource("INTR", undefined, "none"), "allinvestview", "from the monogram: the first source");
  assert.equal(nextLogoSource("^GSPC"), "auto", "nothing to cycle");
});
