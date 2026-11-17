// Opening an external link in the system's browser, per platform. No Herdr imports (the platform
// and Herdr's `exec` are passed in), so `node --test` runs it.
//
// Every opener is a program run directly with the URL as one argument: never through a shell.
// macOS: `open`. Windows: the URL protocol handler (`rundll32 url.dll,FileProtocolHandler`), which
// takes the URL whole (a `cmd /c start` would split it at `&`). Linux: `xdg-open`, then `gio open`.

/**
 * The openers to try for a platform, in order: { cmd, args, anyExit }.
 * `anyExit`: starting the program counts as success (rundll32's exit code says nothing useful);
 * otherwise only exit code 0 does, so a missing handler falls through to the next opener.
 */
export function openersFor(platform, url) {
  const mac = { cmd: "open", args: [url], anyExit: false };
  const windows = { cmd: "rundll32", args: ["url.dll,FileProtocolHandler", url], anyExit: true };
  const linux = [{ cmd: "xdg-open", args: [url], anyExit: false }, { cmd: "gio", args: ["open", url], anyExit: false }];
  if (platform === "macos") return [mac];
  if (platform === "windows") return [windows];
  if (platform === "linux") return linux;
  return [mac, windows, ...linux]; // unknown: try each, the wrong ones fail to start or exit non-zero
}

/** Herdr's names for the platform, from Node-style `process.platform` values too. */
export function normalizePlatform(value) {
  const v = String(value ?? "").toLowerCase();
  if (v === "macos" || v === "darwin") return "macos";
  if (v === "windows" || v === "win32") return "windows";
  if (v === "linux") return "linux";
  return "unknown";
}

/**
 * The platform to open links on: Herdr's window().platform when there is a window (it returns null
 * during `herdr-app check`), else the runtime's process.platform (Herdr reports "windows" there too).
 */
export function detectPlatform(herdrWindow, runtime = globalThis.process) {
  try {
    const p = normalizePlatform(herdrWindow?.()?.platform);
    if (p !== "unknown") return p;
  } catch { /* no window API here */ }
  try { return normalizePlatform(runtime?.platform); } catch { return "unknown"; }
}

/** Only a plain https URL is opened: no other scheme, no whitespace or control characters. */
export function safeUrl(url) {
  if (typeof url !== "string" || url.length > 2048) return null;
  if (!/^https:\/\/[^\s\u0000-\u001f\u007f]+$/.test(url)) return null;
  return url;
}

/**
 * Tries the platform's openers in turn. Resolves { ok, via, tried } and never rejects: a missing or
 * failing opener moves on to the next; when none works, the link simply doesn't open.
 * exec(cmd, args, { timeout }) is Herdr's: it rejects when the program can't start, else resolves
 * { code, stdout, stderr }.
 */
export async function openExternal(url, platform, exec, { timeout = 10_000 } = {}) {
  const safe = safeUrl(url);
  if (!safe) return { ok: false, via: null, tried: [], error: "not an https URL" };
  const tried = [];
  for (const o of openersFor(normalizePlatform(platform), safe)) {
    tried.push(o.cmd);
    try {
      const r = await exec(o.cmd, o.args, { timeout });
      if (o.anyExit || r?.code === 0) return { ok: true, via: o.cmd, tried };
    } catch { /* not installed, or failed to start: try the next */ }
  }
  return { ok: false, via: null, tried, error: "no opener worked" };
}
