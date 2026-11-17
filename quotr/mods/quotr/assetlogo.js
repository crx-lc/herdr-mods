// Local customization (not part of upstream Pulse): the monogram shown for every asset, under its
// logo when one is cached, alone when none is (see logosource.js / logocache.js). No Herdr imports.
import { isCryptoPair } from "./quotes.js";

/** The first letter or digit, upper-cased: "^GSPC" → "G", "0700.HK" → "0"; "?" when there is none. */
export function initialOf(code) {
  const m = String(code ?? "").toUpperCase().match(/[A-Z0-9]/);
  return m ? m[0] : "?";
}

/** { kind, initial }: a crypto pair (round) by its base asset's initial, anything else (square) by its symbol's. */
export function assetLogo(symbol) {
  const s = String(symbol ?? "");
  if (isCryptoPair(s)) return { kind: "crypto", initial: initialOf(s.split("/")[0]) };
  return { kind: "stock", initial: initialOf(s) };
}
