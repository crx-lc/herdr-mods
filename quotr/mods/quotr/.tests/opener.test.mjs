// Tests for opener.js: which program opens a link on each platform, what happens when it can't,
// and which URLs are refused. Herdr's exec is faked; nothing is launched.
// Run: node --test "%USERPROFILE%\.config\herdr-app\mods\quotr\.tests"
import test from "node:test";
import assert from "node:assert/strict";
import { normalizePlatform, openExternal, openersFor, safeUrl } from "../opener.js";

const URL = "https://www.allinvestview.com/tools/ticker-logos/?a=1&b=2";

// A fake exec: `programs` maps a command to its exit code; absent = not installed (rejects).
function fakeExec(programs) {
  const calls = [];
  const exec = async (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    if (!(cmd in programs)) throw new Error(`${cmd}: not found`);
    return { code: programs[cmd], stdout: "", stderr: "" };
  };
  return { exec, calls };
}

test("each platform gets its own opener, the URL as a single argument", () => {
  assert.deepEqual(openersFor("macos", URL), [{ cmd: "open", args: [URL], anyExit: false }]);
  assert.deepEqual(openersFor("windows", URL), [{ cmd: "rundll32", args: ["url.dll,FileProtocolHandler", URL], anyExit: true }]);
  assert.deepEqual(openersFor("linux", URL).map((o) => [o.cmd, o.args]), [["xdg-open", [URL]], ["gio", ["open", URL]]]);
  assert.deepEqual(openersFor("unknown", URL).map((o) => o.cmd), ["open", "rundll32", "xdg-open", "gio"]);
});

test("platform names from Herdr or from the runtime", () => {
  for (const [given, want] of [["macos", "macos"], ["darwin", "macos"], ["windows", "windows"], ["win32", "windows"],
    ["linux", "linux"], ["LINUX", "linux"], ["freebsd", "unknown"], [undefined, "unknown"]]) {
    assert.equal(normalizePlatform(given), want, String(given));
  }
});

test("Linux: xdg-open opens it", async () => {
  const f = fakeExec({ "xdg-open": 0, gio: 0 });
  assert.deepEqual(await openExternal(URL, "linux", f.exec), { ok: true, via: "xdg-open", tried: ["xdg-open"] });
  assert.deepEqual(f.calls[0].args, [URL]);
  assert.equal(f.calls[0].opts.timeout, 10_000, "a stuck opener gives up");
});

test("Linux without xdg-open, or with no handler for it: gio open", async () => {
  const missing = fakeExec({ gio: 0 });
  assert.equal((await openExternal(URL, "linux", missing.exec)).via, "gio");
  assert.deepEqual(missing.calls.map((c) => c.cmd), ["xdg-open", "gio"]);
  const noHandler = fakeExec({ "xdg-open": 3, gio: 0 }); // xdg-open exits 3 when no tool is found
  assert.equal((await openExternal(URL, "linux", noHandler.exec)).via, "gio");
});

test("Linux with neither: the link just doesn't open, nothing throws", async () => {
  const f = fakeExec({});
  assert.deepEqual(await openExternal(URL, "linux", f.exec), { ok: false, via: null, tried: ["xdg-open", "gio"], error: "no opener worked" });
  const failing = fakeExec({ "xdg-open": 4, gio: 1 });
  assert.equal((await openExternal(URL, "linux", failing.exec)).ok, false);
});

test("macOS: open, and a failure is reported, not thrown", async () => {
  assert.deepEqual(await openExternal(URL, "macos", fakeExec({ open: 0 }).exec), { ok: true, via: "open", tried: ["open"] });
  assert.equal((await openExternal(URL, "macos", fakeExec({ open: 1 }).exec)).ok, false);
});

test("Windows: the URL handler, as before; its exit code doesn't matter", async () => {
  const f = fakeExec({ rundll32: 1 });
  assert.deepEqual(await openExternal(URL, "windows", f.exec), { ok: true, via: "rundll32", tried: ["rundll32"] });
  assert.deepEqual(f.calls[0].args, ["url.dll,FileProtocolHandler", URL], "& stays inside the one argument");
  assert.equal((await openExternal(URL, "windows", fakeExec({}).exec)).ok, false, "rundll32 missing");
});

test("an unknown platform tries each opener until one works (Linux-like here)", async () => {
  const f = fakeExec({ open: 1, "xdg-open": 0 }); // e.g. Debian's unrelated `open` (openvt) fails
  assert.deepEqual(await openExternal(URL, "plan9", f.exec), { ok: true, via: "xdg-open", tried: ["open", "rundll32", "xdg-open"] });
});

test("no shell is ever involved", async () => {
  for (const platform of ["macos", "windows", "linux", "unknown"]) {
    for (const o of openersFor(platform, URL)) {
      assert.ok(!["sh", "bash", "cmd", "cmd.exe", "powershell", "pwsh"].includes(o.cmd), `${platform}: ${o.cmd}`);
      assert.ok(o.args.includes(URL), "the URL is passed as one whole argument");
    }
  }
});

test("only plain https URLs are opened; anything else runs nothing", async () => {
  for (const bad of ["http://example.com", "javascript:alert(1)", "file:///etc/passwd", "https://a b.com",
    "https://x.com/\nrm -rf", "https://x.com\u0000", "", null, undefined, 42, `https://${"a".repeat(2100)}.com`]) {
    const f = fakeExec({ "xdg-open": 0 });
    const r = await openExternal(bad, "linux", f.exec);
    assert.equal(r.ok, false, String(bad));
    assert.equal(f.calls.length, 0, `${String(bad)}: nothing launched`);
  }
  assert.equal(safeUrl(URL), URL);
});

test("platform detection: Herdr's window first, the runtime when there is no window", async () => {
  const { detectPlatform } = await import("../opener.js");
  assert.equal(detectPlatform(() => ({ platform: "linux" }), { platform: "windows" }), "linux", "the window wins");
  assert.equal(detectPlatform(() => null, { platform: "windows" }), "windows", "herdr-app check: window() is null");
  assert.equal(detectPlatform(() => { throw new Error("no window"); }, { platform: "darwin" }), "macos");
  assert.equal(detectPlatform(undefined, { platform: "linux" }), "linux");
  assert.equal(detectPlatform(() => ({ platform: "beos" }), {}), "unknown", "then every opener is tried in turn");
});
