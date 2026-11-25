// Executes real view method bodies against recording builders, NOT a GPUI renderer.
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import * as quotes from "../../quotes.js";
import * as readout from "../../readout.js";
import * as extended from "../../extended.js";
import * as spark from "../../sparkline.js";
export function element(kind = "div") {
  const target = { kind, nodes: [], calls: [] };
  const proxy = new Proxy(target, { get(o, key) {
    if (key in o) return o[key];
    if (key === "child") return (child) => { o.nodes.push(child); return proxy; };
    if (key === "children") return (children) => { o.nodes.push(...children); return proxy; };
    if (key === "when") return (condition, fn) => { if (condition) fn(proxy); return proxy; };
    if (key === "build") return () => ({ calls: o.calls.slice() });
    return (...args) => { o.calls.push([key, ...args]); return proxy; };
  } });
  return proxy;
}
export function walk(tree) {
  return tree && typeof tree === "object" ? [tree, ...(tree.nodes ?? []).flatMap(walk)] : tree == null ? [] : [tree];
}
export async function views() {
  const bindings = { ...quotes, ...readout, ...extended, ...spark,
    View: class {}, div: () => element(), image: () => element("image"),
    v_flex: () => element("column"), h_flex: () => element("row"),
    PathBuilder: { stroke: (width) => element("path").stroke(width), fill: () => element("path").fill() },
    Background: { solid: (color) => element().solid(color) },
    window: { paint_path: (path, paint) => element("paint").path(path).paint(paint) },
    Input: { new: () => element("input") }, INTERVAL_MS: 60_000,
    // A Popup's trigger is a constructor argument; recorded as its first node so walk() reaches it.
    Popup: { new: (id, trigger) => element("popup").popup(id).child(trigger) },
    brand: () => "brand", stamp: () => "12:00", LOGO: "sample.svg",
    LogoParts: class {}, DialogParts: class {},
  };
  const load = async (name, className) => {
    const source = await readFile(new URL(`../../${name}.js`, import.meta.url), "utf8");
    const code = source.replace(/^import\s[\s\S]*?;\n/gm, "")
      .replace(`export default class ${className}`, `class ${className}`)
      .replace(`export class ${className}`, `class ${className}`);
    return runInNewContext(`${code}\n;${className}`, bindings, { filename: `${name}.js` });
  };
  bindings.ChartParts = await load("charts", "ChartParts");
  return { ChartParts: bindings.ChartParts, Quotr: await load("main", "Quotr") };
}
export const theme = { muted: "muted", dim: "dim", border: "border", ansi1: "red", ansi2: "green",
  popover: "popover", foreground: "foreground" };
