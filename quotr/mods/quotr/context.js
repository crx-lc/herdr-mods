// What the view's files share, on Herdr's side: storage keys, the brand color, the history store,
// the logo cache and its host (files, curl, fetch), the quote snapshot and the link opener.
// Module scope on purpose: module code is shared by every copy, so the panel's downloads and a
// dialog's history serve the other copies too. No host call happens until something is used.
// Herdr's window() under another name: `window` is GPUI's drawing global in view code.
import { exec, settings, shared, appHome, window as herdrWindow } from "herdr";
import * as fs from "fs/promises";
import { CACHE, LogoCache } from "./logocache.js";
import { formatStaleDate, formatTime, USER_AGENT } from "./quotes.js";
import { HistoryStore } from "./history.js";
import { detectPlatform, openExternal } from "./opener.js";

// The watchlist lives in Herdr's shared state (persisted), so every copy sees one list.
export const STORE = "quotr.watchlist.v1";
// Per-ticker logo choices ({ SYMBOL: source id | "none" }; absent = Auto), and a
// counter bumped when a chosen logo arrives so every copy redraws.
export const LOGO_CHOICES = "quotr.logos.v1";
export const LOGO_REVISION = "quotr.logos.rev";
// Saved under the Pulse names before the rename (2026-11-17): copied over once, on first start.
export const RENAMED_KEYS = [[STORE, "pulse.watchlist.v1"], [LOGO_CHOICES, "pulse.logos.v1"]];
export const HEADERS = { "User-Agent": USER_AGENT, Accept: "application/json" };
// Below this height the panel draws the one-line band.
export const BAND_HEIGHT = 72;
export const LOGO = "mods/quotr/icon.svg";
// Pulse's blue: the bright one on dark themes, the text-safe one on light.
export const brand = () => (settings().dark === false ? "#1066C6" : "#6AB0FF");
// Fetched 1W / 1M / 1Y periods and the dialogs' Yahoo cooldown.
// Deliberately module scope: module code is shared by every copy, so each dialog
// (a new copy per open) reuses what an earlier one fetched. Plain memory, no host
// calls; a reload of the mod starts it empty. Exported only so a check harness can seed it.
export const HISTORY = new HistoryStore();

// "13:05" today, "Nov 16 13:05" before; "unknown" without a time.
export function stamp(t, now) {
  if (!(t > 0)) return "unknown";
  const day = formatStaleDate(t, now);
  return `${day ? `${day} ` : ""}${formatTime(t)}`;
}

// The last quotes, kept in this copy's localStorage so a reload or restart
// shows them (with their own times) instead of "Waiting…" while the first refresh runs.
export const SNAPSHOT_KEY = "quotr.quotes.v1";
export function loadSnapshot() {
  try { const text = localStorage.getItem(SNAPSHOT_KEY); return text ? JSON.parse(text)?.quotes ?? null : null; } catch { return null; }
}
export function saveSnapshot(quotes, symbols) {
  try {
    const kept = {};
    for (const s of symbols) if (quotes[s]) kept[s] = quotes[s];
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ savedAt: Date.now(), quotes: kept }));
  } catch { /* storage full or unavailable: the next refresh still fills the rows */ }
}

// Opens a fixed https link (the logo sources' attribution links) in the system's
// browser: macOS `open`, Windows' URL handler, Linux `xdg-open` then `gio open` (opener.js). Never
// through a shell; not awaited, so a missing or slow opener never holds the UI; failures are silent.
export function openUrl(url) {
  openExternal(url, detectPlatform(herdrWindow), exec).catch(() => {});
}

// Logos from the online sources (logosource.js), cached in a hidden
// folder of this mod (Herdr's image() takes local paths only). Module scope so the panel's
// downloads serve the dialogs too; no host call happens until it is used.
export const LOGO_HOST = {
  get dir() { return `${appHome().replace(/\\/g, "/")}/mods/quotr/.cache/logos`; },
  rel: "mods/quotr/.cache/logos",
  readFile: (p) => fs.readFile(p),
  readText: async (p) => ((await fs.exists(p)) ? fs.readFile(p, "utf8") : null),
  writeFile: (p, text) => fs.writeFile(p, text),
  // Byte-for-byte local copy with curl's file:// support (fs.writeFile wrote empty files for binary data).
  copyFile: async (from, to) => {
    const r = await exec("curl", ["-sS", "--proto", "=file", "-o", to, `file:///${from.replace(/^\/+/, "")}`], { timeout: 15_000 });
    if (r.code !== 0) throw new Error(`copy failed (${r.code})`);
  },
  exists: (p) => fs.exists(p),
  mkdir: (p) => fs.mkdir(p, { recursive: true }),
  unlink: (p) => fs.unlink(p),
  // curl (in Windows since 10, macOS and Linux): https only, redirects too, size and time capped.
  download: async (url, to) => {
    const r = await exec("curl", ["-sS", "-L", "--proto", "=https", "--proto-redir", "=https", "--max-time", "20",
      "--max-filesize", String(CACHE.maxBytes), "-A", CACHE.userAgent, "-o", to, "-w", "%{http_code} %{content_type}", url],
      { timeout: 30_000 });
    const [status, ...type] = String(r.stdout ?? "").trim().split(" ");
    return { status: Number(status) || 0, contentType: type.join(" ") };
  },
  now: () => Date.now(),
  preference: (symbol) => { const c = shared(LOGO_CHOICES); return c && typeof c === "object" ? c[symbol] : undefined; },
  // Text lookups a source needs before the image (AllInvestView's symbol search), via the mod's fetch.
  fetchText: async (url) => {
    const r = await fetch(url, { headers: HEADERS });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.text();
  },
};
export const LOGOS = new LogoCache(LOGO_HOST);
