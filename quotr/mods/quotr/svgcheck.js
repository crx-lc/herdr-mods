// What a cached logo file must be (logocache.js).
// A plain drawing in one <svg> root: no script, event handler, foreign object, entity or DOCTYPE,
// and no reference outside the file (only #fragment links).

const UNSAFE = /<script|<foreignObject|\son[a-z]+\s*=|(?:xlink:)?href\s*=\s*["'](?!#)|<!ENTITY|<!DOCTYPE|url\(\s*["']?(?!#)/i;

/** null when `text` is an acceptable logo SVG, else the reason it isn't. */
export function svgProblem(text) {
  if (typeof text !== "string" || !text.trim()) return "empty";
  if (text.length > 200_000) return "too large";
  if (UNSAFE.test(text)) return "unsafe markup";
  const body = text.replace(/^﻿/, "").replace(/^\s*<\?xml[^>]*\?>\s*/, "").replace(/^\s*<!--[\s\S]*?-->\s*/, "");
  if (!/^<svg[\s>]/.test(body)) return "not an <svg> document";
  if (!/<\/svg>\s*$/.test(body)) return "unterminated <svg>";
  if ((body.match(/<svg[\s>]/g) ?? []).length !== (body.match(/<\/svg>/g) ?? []).length) return "unbalanced <svg> elements";
  if (!/viewBox\s*=\s*["'][^"']+["']|width\s*=\s*["'][^"']+["']/.test(body)) return "no size or viewBox";
  return null;
}
