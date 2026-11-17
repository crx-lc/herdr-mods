// Tests for logo sources (logosource.js), monograms (assetlogo.js) and the
// logo file check (svgcheck.js). Logos come from the online sources only; none ship with the mod.
// Run: npm test from the repository root, or node --test ".tests/*.test.mjs" in the mod's folder.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assetLogo, initialOf } from "../assetlogo.js";
import { ELBSTREAM, LOGO_SOURCES, elbstreamLookup, resolveLogo, sourceById } from "../logosource.js";
import { svgProblem } from "../svgcheck.js";

const MOD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// A sample list covering crypto, US stocks, ADRs and a preferred share.
const SAMPLE = ["BTC/USDT", "AAPL", "MSFT", "NVDA", "TSM", "BRK-B", "PETR4.SA", "0700.HK", "MSTR", "STRC"];

test("AllInvestView, then Elbstream; no logo files ship with the mod", () => {
  assert.deepEqual(LOGO_SOURCES.map((s) => s.id), ["allinvestview", "elbstream"]);
  assert.equal(fs.existsSync(path.join(MOD, "logos")), false, "no bundled logo folder");
  assert.equal(fs.existsSync(path.join(MOD, "logos.js")), false, "no bundled logo map");
  assert.equal(fs.existsSync(path.join(MOD, ".tools")), false, "no vendoring tools");
  assert.equal(sourceById("elbstream"), ELBSTREAM, "still known, so its cached entries are recognized");
  assert.equal(sourceById("simple-icons"), null);
});

test("Elbstream: every asset in a sample list resolves to its checked logo", () => {
  const urls = Object.fromEntries(SAMPLE.map((s) => [s, resolveLogo(s, [ELBSTREAM])?.url ?? null]));
  assert.deepEqual(urls, {
    "BTC/USDT": "https://api.elbstream.com/logos/crypto/BTC",
    AAPL: "https://api.elbstream.com/logos/symbol/AAPL",
    MSFT: "https://api.elbstream.com/logos/symbol/MSFT",
    NVDA: "https://api.elbstream.com/logos/symbol/NVDA",
    TSM: "https://api.elbstream.com/logos/symbol/TSM",
    "BRK-B": "https://api.elbstream.com/logos/symbol/BRK-B",
    "PETR4.SA": "https://api.elbstream.com/logos/symbol/PETR4.SA",
    "0700.HK": "https://api.elbstream.com/logos/symbol/0700.HK",
    MSTR: "https://api.elbstream.com/logos/symbol/MSTR",
    STRC: "https://api.elbstream.com/logos/symbol/MSTR", // the issuer's: Elbstream's own STRC is another company
  });
});

test("automatic rules: any crypto pair by its base asset, no list needed", () => {
  const api = "https://api.elbstream.com/logos/";
  assert.equal(resolveLogo("XTZ/USDT", [ELBSTREAM])?.url, `${api}crypto/XTZ`, "a pair no list names");
  assert.equal(resolveLogo("ETH/USDT", [ELBSTREAM])?.url, `${api}crypto/ETH`);
  assert.equal(resolveLogo("BTC/BRL", [ELBSTREAM])?.url, `${api}crypto/BTC`, "same coin, other quote currency");
  assert.equal(resolveLogo("1INCH/USDT", [ELBSTREAM])?.url, `${api}crypto/1INCH`);
});

test("automatic rules: any stock, ADR, ETF or suffixed listing by its exact Yahoo symbol", () => {
  const api = "https://api.elbstream.com/logos/";
  for (const s of ["AAPL", "PETR4.SA", "INBR32.SA", "BRK-B", "0700.HK", "7203.T", "SPY"]) {
    assert.equal(resolveLogo(s, [ELBSTREAM])?.url, `${api}symbol/${s}`, s);
  }
});

test("no logo exists for indices, FX or futures, and odd input gets nothing: monogram, no request", () => {
  for (const s of ["^GSPC", "^BVSP", "EURUSD=X", "CL=F", "nu", "__proto__", "", undefined, "a/b", "BTC/usdt"]) {
    assert.equal(resolveLogo(s, [ELBSTREAM]), null, String(s));
  }
});

test("corrections override the automatic lookup", () => {
  assert.deepEqual(ELBSTREAM.corrections, { STRC: "symbol/MSTR" });
  assert.equal(resolveLogo("STRC", [ELBSTREAM])?.url, "https://api.elbstream.com/logos/symbol/MSTR", "Strategy's preferred: the issuer's logo");
  assert.equal(elbstreamLookup("STRC"), "symbol/MSTR");
});

test("an adapter added later is used after Elbstream, and only https URLs count", () => {
  // An index logo source, say: Elbstream has no rule for "^GSPC", so the next adapter gets its turn.
  const extra = { id: "other", name: "Other", attribution: null,
    lookup: (s) => (s === "^GSPC" ? "https://logos.example/GSPC.svg" : s === "^BAD" ? "http://x/y.png" : null) };
  const sources = [ELBSTREAM, extra];
  assert.equal(resolveLogo("^GSPC", sources).source, extra);
  assert.equal(resolveLogo("NU", sources).source, ELBSTREAM, "first source wins");
  assert.equal(resolveLogo("^BAD", sources), null, "not https: refused");
});

test("Elbstream's attribution: its link, at the footer's size (the size its terms ask is recorded)", () => {
  assert.deepEqual(ELBSTREAM.attribution, { text: "Logos by Elbstream ↗", url: "https://elbstream.com", minPx: null, termsMinPx: 16 });
});

test("monograms: round for crypto by base asset, square for the rest, never a guess", () => {
  assert.deepEqual(assetLogo("BTC/USDT"), { kind: "crypto", initial: "B" });
  assert.deepEqual(assetLogo("INTR"), { kind: "stock", initial: "I" });
  assert.equal(assetLogo("^GSPC").initial, "G");
  assert.equal(assetLogo("0700.HK").initial, "0");
  assert.equal(initialOf(""), "?");
  assert.equal(initialOf(undefined), "?");
  assert.equal(initialOf("--"), "?");
});

test("malformed or unsafe SVGs are refused", () => {
  const ok = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>';
  assert.equal(svgProblem(ok), null);
  assert.equal(svgProblem(`<?xml version="1.0"?>\n${ok}\n`), null, "an XML prolog is fine");
  assert.equal(svgProblem(""), "empty");
  assert.equal(svgProblem(undefined), "empty");
  assert.equal(svgProblem("<html><body>Page not found</body></html>"), "not an <svg> document", "an error page saved as .svg");
  assert.equal(svgProblem("\u0089PNG\r\n"), "not an <svg> document");
  assert.equal(svgProblem(ok.slice(0, -6)), "unterminated <svg>", "a truncated download");
  assert.equal(svgProblem('<svg viewBox="0 0 1 1"><svg></svg>'), "unbalanced <svg> elements");
  assert.equal(svgProblem("<svg><path/></svg>"), "no size or viewBox");
  assert.equal(svgProblem(ok.replace("<path", "<script>alert(1)</script><path")), "unsafe markup");
  assert.equal(svgProblem(ok.replace("<path", '<image href="https://tracker.example/x.png"/><path')), "unsafe markup");
  assert.equal(svgProblem(ok.replace("<path", '<path onload="x()"')), "unsafe markup");
  assert.equal(svgProblem(`<!DOCTYPE svg [<!ENTITY x "y">]>${ok}`), "unsafe markup");
  assert.equal(svgProblem(ok.replace("</svg>", `${" ".repeat(200_001)}</svg>`)), "too large");
});

test("NFLX, added later, resolves to its checked Elbstream logo", () => {
  assert.equal(resolveLogo("NFLX", [ELBSTREAM])?.url, "https://api.elbstream.com/logos/symbol/NFLX");
  assert.equal(resolveLogo("NFLX34.SA", [ELBSTREAM])?.url, "https://api.elbstream.com/logos/symbol/NFLX34.SA", "the B3 BDR by its own symbol");
});
