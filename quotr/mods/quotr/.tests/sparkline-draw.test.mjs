import test from "node:test";
import assert from "node:assert/strict";
import { watchlistSparkline } from "../sparkline.js";
import { formatPrice } from "../quotes.js";
import { Watchlist } from "../watchlist.js";
import { fixture, START, END, NOW } from "./helpers/spark-fixtures.mjs";
import { views, walk, element, theme } from "./helpers/view-harness.mjs";

const extent = g => Math.max(...g.line.map(p => p[1])) - Math.min(...g.line.map(p => p[1]));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
const moveQuote = percent => fixture([100, 100 * (1 + percent / 100)], {
  price: 100 * (1 + percent / 100), changePercent: percent,
});
// watchlistChart returns the 56×22 box; an open card is a Popup child beside it.
const sparkBox = tree => walk(tree).find(n => n.calls?.some(c => c[0] === "id" && /^quotr-spark-/.test(c[1])));
function recordings(tree) {
  const box = sparkBox(tree);
  assert.ok(box.calls.some(c => c[0] === "w" && c[1] === 56));
  assert.ok(box.calls.some(c => c[0] === "h" && c[1] === 22));
  return walk(box).filter(n => n.kind === "paint").map(n => {
    const calls = n.calls.find(c => c[0] === "path")[1].calls;
    const width = calls.find(c => c[0] === "stroke")[1];
    const coords = calls.filter(c => ["move_to", "line_to"].includes(c[0])).map(c => {
      assert.match(c[1], /^\d+(\.\d+)?%$/, "actual PathBuilder x must be element-local percent");
      assert.match(c[2], /^\d+(\.\d+)?%$/, "actual PathBuilder y must be element-local percent");
      const x = parseFloat(c[1]) * 56 / 100, y = parseFloat(c[2]) * 22 / 100;
      assert.ok(x - width / 2 >= -1e-9 && x + width / 2 <= 56 + 1e-9, "stroke x bounds");
      assert.ok(y - width / 2 >= -1e-9 && y + width / 2 <= 22 + 1e-9, "stroke y bounds");
      return [x, y];
    });
    return { width, coords, color: n.calls.find(c => c[0] === "paint")[1] };
  });
}

// Recording builders execute actual view code; these are not GPUI pixel/contrast tests.
test("actual draw paths use local percent coordinates, bounded strokes, signs and visible small cues above tick", async () => {
  const { ChartParts } = await views(); const v = new ChartParts();
  for (const percent of [-60, -50, -30, -1.03, -1, -0.1, -0.004, 0, 0.1, 1, 1.03, 30, 50, 60]) {
    const q = moveQuote(percent), g = watchlistSparkline(q, NOW);
    const color = v.changeColor(theme, percent);
    const paths = recordings(v.watchlistChart(q, color, theme, NOW));
    const [line, track, tick, rail, cap] = paths;
    assert.equal(line.color, theme.muted); assert.equal(line.width, 1.25);
    assert.equal(line.coords.length, q.points.length);
    line.coords.forEach((p, i) => p.forEach((n, axis) => near(n, g.line[i][axis])));
    assert.equal(track.color, theme.border); assert.equal(track.width, 1);
    track.coords.forEach((p, i) => { near(p[0], i ? 54 : 2); near(p[1], 19); });
    assert.equal(tick.color, theme.muted); assert.equal(tick.width, 1);
    tick.coords.forEach(p => near(p[0], 28));
    near(tick.coords[0][1], 16); near(tick.coords[1][1], 21);
    if (percent === 0) {
      assert.equal(paths.length, 3, "zero has neutral tick only");
    } else {
      assert.equal(rail.width, 2.5); assert.equal(rail.color, percent > 0 ? theme.ansi2 : theme.ansi1);
      near(rail.coords[0][0], 28); near(rail.coords[1][0], g.move.to);
      rail.coords.forEach(p => near(p[1], 19));
      assert.ok(Math.sign(rail.coords[1][0] - 28) === Math.sign(percent));
      near(Math.abs(rail.coords[1][0] - 28), Math.max(3, 26 * Math.min(1, Math.abs(percent) / 50)));
      assert.match(g.description, /3px visibility minimum, not linear magnitude/);
      if (Math.abs(percent) > 50) {
        assert.equal(paths.length, 5, "capped rail needs end stop");
        assert.equal(cap.color, color); cap.coords.forEach(p => near(p[0], g.move.to));
        near(cap.coords[0][1], 16); near(cap.coords[1][1], 21);
      } else assert.equal(paths.length, 4);
    }
  }
});

test("draw layer honors empty, single dot, no reference, malformed cache and stale/failed opacity", async () => {
  const { ChartParts } = await views(); const v = new ChartParts();
  for (const [q, count, dot] of [[fixture([]), 3, false], [fixture([130]), 4, true],
    [fixture(undefined, { previousClose: null }), 1, false],
    [fixture(undefined, { changePercent: -30 }), 1, false],
    [fixture(undefined, { points: [] }), 3, false],
    [fixture(undefined, { series: [...fixture().series, 200] }), 3, false],
    [fixture(undefined, { points: [...fixture().points, { close: 130, t: END }] }), 3, false]]) {
    const paths = recordings(v.watchlistChart(q, theme.ansi2, theme, NOW));
    assert.equal(paths.length, count);
    if (dot) {
      assert.equal(paths[0].width, 2); assert.equal(paths[0].color, theme.muted);
      near(paths[0].coords[0][0], 1); near(paths[0].coords[1][0], 3);
      paths[0].coords.forEach(p => near(p[1], 7.5));
    }
  }
  for (const [q, now, options, opacity] of [[fixture(), NOW, {}, 1], [fixture(), NOW+180001, {}, 0.5],
    [fixture(), NOW, { failed: true }, 0.5], [fixture(undefined, { fetchedAt: null }), NOW, {}, 0.5],
    [fixture(), NOW-1, {}, 0.5], [fixture(), NaN, {}, 0.5]]) {
    const box = v.watchlistChart(q, theme.ansi2, theme, now, options);
    assert.equal(sparkBox(box).calls.find(c => c[0] === "opacity")[1], opacity);
    assert.equal(recordings(box).length, 4);
  }
});

test("price-relative floor makes noise flatter than swings across price levels, references and crypto", () => {
  for (const price of [0.00000441, 0.13, 1, 130, 100000]) {
    for (const symbol of ["SAMPLE", "COIN/USDT"]) {
      for (const previousClose of [null, price, price / 1.3]) {
        const q = values => fixture(values.map(v => price*v), { symbol, previousClose });
        const noise = watchlistSparkline(q([1, 1.00015, 0.99985, 1]), NOW);
        const swing = watchlistSparkline(q([1, 1.1, 0.9, 1]), NOW);
        const ordinary = watchlistSparkline(q([1, 1.005, 1.01]), NOW);
        near(extent(noise), 0.33); near(extent(swing), 11/1.16);
        assert.ok(extent(ordinary) > 9 && extent(ordinary) < 10, "ordinary 1% trend stays legible");
        near(extent(watchlistSparkline(q([1, 1, 1]), NOW)), 0);
        assert.equal(watchlistSparkline(q([1]), NOW).line[0][1], 7.5);
        assert.equal(watchlistSparkline(q([]), NOW).line.length, 0);
        assert.match(noise.description, /minimum total span 1% of observed midpoint/);
      }
    }
  }
});

const DAY = 86400000, BAR = 900000;
function crypto(timestamp, points) {
  return fixture(points.map(p => p.close), { symbol: "COIN/USDT", timestamp,
    fetchedAt: timestamp, points, periods: null, timeZone: { name: "UTC", offset: 0 } });
}
test("crypto rollover clips only outside bars after full pair/order validation; survivors keep time coverage", () => {
  const t0 = Date.UTC(2026,0,12,12,14,30);
  const points = Array.from({length:96}, (_, i) => ({ t: Math.floor(t0/BAR)*BAR-(95-i)*BAR, close: 100+i/10 }));
  for (const lag of [0, 60000, 31*60000]) {
    const q = crypto(t0+lag, points); const copy = JSON.stringify(q);
    const g = watchlistSparkline(q, t0+lag);
    const kept = points.filter(p => p.t >= q.timestamp-DAY && p.t <= q.timestamp);
    assert.equal(g.line.length, kept.length); assert.ok(g.line.length >= 93);
    g.line.forEach((p,i) => near(p[0], 2+52*(kept[i].t-(q.timestamp-DAY))/DAY));
    assert.ok(g.line[0][0]>2 && g.line.at(-1)[0]<54, "blank coverage never stretched");
    assert.match(g.description, /bar freshness is independent/); assert.equal(JSON.stringify(q), copy);
  }
  const future = [...points, {t:t0+BAR,close:110}];
  assert.equal(watchlistSparkline(crypto(t0,future),t0).line.length,96, "P5b keeps earlier bars");
  assert.equal(watchlistSparkline(crypto(t0+2*DAY,points),t0+2*DAY).line.length,0);
  assert.equal(watchlistSparkline(crypto(points[0].t-DAY,points),t0).line.length,0);
  const single = [{t:t0-DAY-1,close:100},{t:t0,close:101},{t:t0+1,close:102}];
  assert.equal(watchlistSparkline(crypto(t0,single),t0).line.length,1);
  for (const corrupt of [[{t:t0-DAY-1,close:NaN}, ...points], [points[1],points[0]], [points[0],points[0]]]) {
    assert.equal(watchlistSparkline(crypto(t0,corrupt),t0).line.length,0,"corruption outside window cannot be laundered by clipping");
  }
  const sparse = crypto(t0,points); sparse.points = sparse.points.slice(); delete sparse.points[0];
  assert.equal(watchlistSparkline(sparse,t0).line.length,0,"sparse cache entries fail integrity before clipping");
  const unpaired = crypto(t0, points); unpaired.series.push(101);
  assert.equal(watchlistSparkline(unpaired,t0).line.length,0);
  const fresh = crypto(t0+BAR, points.slice(1).concat({t:t0+BAR-30000, close:110}));
  assert.equal(watchlistSparkline(fresh,t0+BAR).line.length,96);
  assert.equal(watchlistSparkline({...fresh,points:undefined},t0+BAR).line.length,0);
  for (const timestamp of [null, NaN, Infinity, 0]) {
    assert.equal(watchlistSparkline({...fresh,timestamp,periods:{regular:[START,END]}},t0).line.length,0,
      "crypto with missing quote time cannot use stock session fallback");
  }
  const failed = watchlistSparkline(fresh,t0+BAR,{failed:true});
  assert.equal(failed.line.length,96); assert.equal(failed.stale,true);
  const old = watchlistSparkline(fresh,t0+BAR+180001); assert.equal(old.line.length,96); assert.equal(old.stale,true);
  const stock = fixture([130,131],{points:[{t:START-1,close:130},{t:END,close:131}]});
  assert.equal(watchlistSparkline(stock,NOW).line.length,0,"stock conservative session rule unchanged");
});

test("tooltips format observed and reference prices using existing supported precision and currency", () => {
  const q = fixture([129.8800048828125,130.0500030517578], {
    previousClose:100.12999725341797, price:130.05,
    changePercent:(130.05-100.12999725341797)/100.12999725341797*100,
  });
  const g = watchlistSparkline(q,NOW);
  assert.match(g.description,/observed range 129.88 USD–130.05 USD/);
  assert.match(g.description,/previous regular close 100.13 USD/);
  assert.doesNotMatch(g.description,/48828125|517578|341797/);
  const p = 0.00000441;
  const low = fixture([p,p*1.001],{symbol:"COIN/USDT",previousClose:p,price:p*1.001,changePercent:0.1,currency:"USDT"});
  assert.ok(watchlistSparkline(low,NOW).description.includes(formatPrice({price:p,currency:"USDT"})));
  for (const q of [fixture([]),fixture(undefined,{previousClose:NaN}),fixture([NaN]),fixture([Infinity])]) {
    assert.doesNotMatch(watchlistSparkline(q,NOW).description,/NaN|Infinity|undefined/);
  }
});

test("real panel draw call passes failed state and current dimensions, paints capped rail; reorder suppresses draw", async () => {
  const { Quotr } = await views(); const v = new Quotr();
  v.watch = {preferences:{symbols:["SAMPLE", "UNKNOWN"],paused:false},quotes:{SAMPLE:moveQuote(-60)},
    errors:{SAMPLE:"sample failure"},message:"",inflight:new Set()};
  v.assetIcon=()=>element();v.logoCredits=()=>[];
  v.size={width:340,height:640}; // responsive.js draws charts from the 340 stage
  const tree = v.panel(element(),theme);
  const spark = walk(tree).find(n => n.calls?.some(c=>c[0]==="id"&&c[1]==="quotr-spark-SAMPLE"));
  assert.equal(spark.calls.find(c=>c[0]==="opacity")[1],0.5);
  const paths = recordings(spark);assert.equal(paths.length,5);assert.equal(paths[3].color,theme.ansi1);
  v.reordering=true;
  assert.equal(walk(v.panel(element(),theme)).filter(n=>n.kind==="paint").length,0);
});


test("actual crypto refresh retains timed bars while klines wait or fail, then adopts fresh or empty bars", async () => {
  const t0 = Date.UTC(2026,0,12,12,14,30);
  const points = Array.from({length:96}, (_, i) => ({t:Math.floor(t0/BAR)*BAR-(95-i)*BAR,close:100+i/10}));
  let now=t0+60000, mode="pending", release, requested;
  const started=new Promise(resolve=>{requested=resolve;});
  const response=(body,status=200)=>({ok:status===200,status,text:async()=>typeof body==="string"?body:JSON.stringify(body)});
  const w=new Watchlist({load:()=>({version:1,symbols:["COIN/USDT"],paused:false}),
    now:()=>now,changed:()=>{},fetch:async url=>{
      if (!url.includes("klines")) return response({symbol:"COINUSDT",lastPrice:"110",prevClosePrice:"100",closeTime:now});
      if (mode==="pending") { requested(); return new Promise((_resolve,reject)=>{release=reject;}); }
      if (mode==="status") return response({},500);
      if (mode==="malformed") return response("invalid sample");
      if (mode==="empty") return response([]);
      return response(Array.from({length:96},(_,i)=>[Math.floor(now/BAR)*BAR-(95-i)*BAR,"0","0","0",String(100+i/10)]));
    }});
  w.quotes["COIN/USDT"]=crypto(t0,points);
  const pending=w.crypto(["COIN/USDT"],()=>true);await started;
  assert.equal(w.quotes["COIN/USDT"].timestamp,now,"ticker advanced before klines");
  assert.equal(watchlistSparkline(w.quotes["COIN/USDT"],now).line.length,95,"pending bars retain honest subset");
  release(new Error("sample no answer"));await pending;
  for (mode of ["status","malformed"]) {
    now=t0+31*60000;await w.crypto(["COIN/USDT"],()=>true);
    const q=w.quotes["COIN/USDT"],g=watchlistSparkline(q,now);
    assert.equal(q.points,points);assert.equal(g.line.length,93);assert.equal(g.stale,false,"quote itself is fresh");
    assert.match(g.description,/bar freshness is independent/);
  }
  mode="fresh";await w.crypto(["COIN/USDT"],()=>true);
  assert.equal(watchlistSparkline(w.quotes["COIN/USDT"],now).line.length,96);
  mode="empty";await w.crypto(["COIN/USDT"],()=>true);
  assert.equal(watchlistSparkline(w.quotes["COIN/USDT"],now).line.length,0,"observed empty answer has no fabricated bars");
});
