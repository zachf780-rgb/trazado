import { isCableType, type CableType, type LatLng, type LineFeature, type LineKind } from "./types";

const EARTH_M = 6371008.8;
const FT_PER_M = 3.280839895;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineFeet(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const m = 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
  return m * FT_PER_M;
}

export function pathFootage(path: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1];
    const to = path[i];
    if (!from || !to) continue;
    total += haversineFeet(from, to);
  }
  return total;
}

export function pathMidpoint(path: LatLng[]): LatLng | null {
  if (path.length === 0) return null;
  if (path.length === 1) return path[0] ?? null;
  let total = 0;
  const lengths: number[] = [];
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1];
    const to = path[i];
    const length = from && to ? haversineFeet(from, to) : 0;
    lengths.push(length);
    total += length;
  }
  let remain = total / 2;
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i] ?? 0;
    const from = path[i];
    const to = path[i + 1];
    if (!from || !to) continue;
    if (remain <= length || i === lengths.length - 1) {
      const t = length === 0 ? 0 : Math.min(1, remain / length);
      return { lat: from.lat + (to.lat - from.lat) * t, lng: from.lng + (to.lng - from.lng) * t };
    }
    remain -= length;
  }
  return path[path.length - 1] ?? null;
}

export function reportedFeet(
  line: Pick<LineFeature, "path" | "overrideFootage" | "footageText">,
): number {
  const measured = pathFootage(line.path);
  if (!line.overrideFootage) return measured;
  const n = Number(String(line.footageText).replace(/,/g, "").trim());
  if (!Number.isFinite(n) || n < 0) return measured;
  return n;
}

export function legendFeet(
  line: Pick<LineFeature, "path" | "overrideFootage" | "footageText" | "hideLegend" | "hideFootage">,
): number {
  if (line.hideLegend) return 0;
  return reportedFeet(line);
}

export function spanShownFeet(spanFeet: number, measuredTotal: number, shownTotal: number): number {
  if (Math.abs(shownTotal - measuredTotal) < 0.05) return spanFeet;
  if (measuredTotal <= 0) return shownTotal;
  return (spanFeet / measuredTotal) * shownTotal;
}

export function slashMarks(path: LatLng[], everyFt = 22, halfFt = 9): [LatLng, LatLng][] {
  const marks: [LatLng, LatLng][] = [];
  let carried = everyFt / 2;
  const place = (mid: LatLng, bearing: number) => {
    const ang = bearing + Math.PI / 4;
    const east = Math.sin(ang);
    const north = Math.cos(ang);
    marks.push([
      offsetFeet(mid, east * halfFt, north * halfFt),
      offsetFeet(mid, -east * halfFt, -north * halfFt),
    ]);
  };
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (!a || !b) continue;
    const len = haversineFeet(a, b);
    if (len < 1) continue;
    const br = toRad(bearingDeg(a, b));
    let dist = carried;
    while (dist <= len) {
      const t = dist / len;
      place({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t }, br);
      dist += everyFt;
    }
    carried = dist - len;
  }
  if (marks.length === 0 && path.length >= 2 && path[0] && path[1]) {
    const a = path[0];
    const b = path[1];
    place({ lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 }, toRad(bearingDeg(a, b)));
  }
  return marks;
}

export function pointSlashMarks(at: LatLng): [LatLng, LatLng][] {
  const half = 5;
  const gap = 4;
  const ang = toRad(-32);
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const px = -uy;
  const py = ux;
  return [-1, 0, 1].map((step) => {
    const ox = px * gap * step;
    const oy = py * gap * step;
    return [
      offsetFeet(at, ox + ux * half, oy + uy * half),
      offsetFeet(at, ox - ux * half, oy - uy * half),
    ] as [LatLng, LatLng];
  });
}

export function roundFeet(ft: number): number {
  return Math.round(ft);
}

export function formatFeet(ft: number): string {
  return `${roundFeet(ft).toLocaleString("en-US")} ft`;
}

export function formatFootageLabel(ft: number): string {
  return `${roundFeet(ft).toLocaleString("en-US")}'`;
}

const FT_PER_KM = 3280.839895;

export function formatKmLabel(ft: number): string {
  const km = ft / FT_PER_KM;
  const digits = km >= 1 ? 2 : 3;
  return `${km.toFixed(digits)} km`;
}

const TURN_SPLIT_DEG = 30;

export function bearingDeg(a: LatLng, b: LatLng): number {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function turnDelta(a: number, b: number): number {
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

export interface FootageSpan {
  feet: number;
  labelAt: LatLng;
  cableAt: LatLng;
  cableAt2: LatLng;
  from: LatLng;
  to: LatLng;
}

/** Split at turns over 30° and at vertices snapped to equipment. Totals still use the whole path. */
export function footageSpans(path: LatLng[], gear: LatLng[] = []): FootageSpan[] {
  if (path.length < 2) return [];
  const cuts: number[] = [0];
  for (let i = 1; i < path.length - 1; i++) {
    const prev = path[i - 1];
    const here = path[i];
    const next = path[i + 1];
    if (!prev || !here || !next) continue;
    const snapped = gear.some((target) => haversineFeet(here, target) <= 15);
    if (!snapped && (haversineFeet(prev, here) < 8 || haversineFeet(here, next) < 8)) continue;
    const delta = turnDelta(bearingDeg(prev, here), bearingDeg(here, next));
    if (snapped || delta >= TURN_SPLIT_DEG) cuts.push(i);
  }
  cuts.push(path.length - 1);

  const spans: FootageSpan[] = [];
  for (let c = 0; c < cuts.length - 1; c++) {
    const start = cuts[c] ?? 0;
    const end = cuts[c + 1] ?? start;
    const slice = path.slice(start, end + 1);
    if (slice.length < 2) continue;
    const feet = pathFootage(slice);
    if (feet < 1) continue;
    const from = slice[0];
    const to = slice[slice.length - 1];
    if (!from || !to) continue;
    spans.push({
      feet,
      labelAt: alongPath(slice, 0.5),
      cableAt: alongPath(slice, 0.28),
      cableAt2: alongPath(slice, 0.78),
      from,
      to,
    });
  }
  return spans;
}

export function alongPath(path: LatLng[], t = 0.5): LatLng {
  if (path.length === 0) return { lat: 0, lng: 0 };
  const first = path[0];
  if (!first) return { lat: 0, lng: 0 };
  if (path.length === 1) return { ...first };

  const total = pathFootage(path);
  if (total <= 0) {
    const last = path[path.length - 1] ?? first;
    return {
      lat: (first.lat + last.lat) / 2,
      lng: (first.lng + last.lng) / 2,
    };
  }

  const target = total * t;
  let walked = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (!a || !b) continue;
    const seg = haversineFeet(a, b);
    if (walked + seg >= target) {
      const r = seg === 0 ? 0 : (target - walked) / seg;
      return {
        lat: a.lat + (b.lat - a.lat) * r,
        lng: a.lng + (b.lng - a.lng) * r,
      };
    }
    walked += seg;
  }
  const last = path[path.length - 1] ?? first;
  return { ...last };
}

export function constrainCardinal(from: LatLng, to: LatLng): LatLng {
  const dLat = Math.abs(to.lat - from.lat);
  const dLng = Math.abs(to.lng - from.lng);
  if (dLng > dLat) return { lat: from.lat, lng: to.lng };
  return { lat: to.lat, lng: from.lng };
}

export function offsetFeet(origin: LatLng, eastFt: number, northFt: number): LatLng {
  const latFt = 364000;
  const lngFt = 364000 * Math.cos(toRad(origin.lat));
  return {
    lat: origin.lat + northFt / latFt,
    lng: origin.lng + eastFt / Math.max(lngFt, 1),
  };
}

export function offsetBeside(point: LatLng, from: LatLng, to: LatLng, offsetFt: number, sign = 1): LatLng {
  const bearing = toRad(bearingDeg(from, to));
  return offsetFeet(point, Math.cos(bearing) * offsetFt * sign, -Math.sin(bearing) * offsetFt * sign);
}

function segmentsCross(a: LatLng, b: LatLng, c: LatLng, d: LatLng): boolean {
  const turn = (p: LatLng, q: LatLng, r: LatLng) =>
    (q.lng - p.lng) * (r.lat - p.lat) - (q.lat - p.lat) * (r.lng - p.lng);
  const o1 = turn(a, b, c);
  const o2 = turn(a, b, d);
  const o3 = turn(c, d, a);
  const o4 = turn(c, d, b);
  if (o1 === 0 || o2 === 0 || o3 === 0 || o4 === 0) return false;
  return o1 > 0 !== o2 > 0 && o3 > 0 !== o4 > 0;
}

type BypassLine = { id: string; path: LatLng[]; parallel: boolean; offsetFt: number };

type Incident = {
  id: string;
  seg: number;
  vertex: number;
  gear: LatLng;
  neighbor: LatLng;
  atStart: boolean;
  offsetFt: number;
};

function incidentOffset(inc: Incident, sign: number): LatLng {
  const a = inc.atStart ? inc.gear : inc.neighbor;
  const b = inc.atStart ? inc.neighbor : inc.gear;
  const bearing = toRad(bearingDeg(a, b));
  return offsetFeet(inc.gear, Math.cos(bearing) * inc.offsetFt * sign, -Math.sin(bearing) * inc.offsetFt * sign);
}

function gearPositions(points: { kind: string; position: LatLng }[]): LatLng[] {
  return points
    .filter(
      (point) =>
        point.kind === "pedestal" || point.kind === "vault" || point.kind === "mdu" || point.kind === "pole",
    )
    .map((point) => point.position);
}

function incidentsAt(lines: BypassLine[], gear: LatLng): Incident[] {
  const found: Incident[] = [];
  for (const line of lines) {
    if (!line.parallel || line.path.length < 2) continue;
    line.path.forEach((vertex, index) => {
      if (haversineFeet(vertex, gear) > 15) return;
      if (index > 0) {
        const neighbor = line.path[index - 1];
        if (neighbor) {
          found.push({
            id: line.id,
            seg: index - 1,
            vertex: index,
            gear: vertex,
            neighbor,
            atStart: false,
            offsetFt: line.offsetFt,
          });
        }
      }
      if (index < line.path.length - 1) {
        const neighbor = line.path[index + 1];
        if (neighbor) {
          found.push({
            id: line.id,
            seg: index,
            vertex: index,
            gear: vertex,
            neighbor,
            atStart: true,
            offsetFt: line.offsetFt,
          });
        }
      }
    });
  }
  return found;
}

/** Body side stays the same through corners. A different tip sign is only the side used at a pedestal or vault. */
export function bypassPlan(
  lines: BypassLine[],
  points: { kind: string; position: LatLng }[],
): { run: Map<string, number[]>; tip: Map<string, number[]> } {
  const run = new Map<string, number[]>();
  const tip = new Map<string, number[]>();
  for (const line of lines) {
    if (!line.parallel || line.path.length < 2) continue;
    run.set(
      line.id,
      Array.from({ length: line.path.length - 1 }, () => 1),
    );
    tip.set(
      line.id,
      Array.from({ length: line.path.length }, () => 1),
    );
  }
  const pedVault = points
    .filter((point) => point.kind === "pedestal" || point.kind === "vault")
    .map((point) => point.position);
  for (const gear of pedVault) {
    const incidents = incidentsAt(lines, gear).slice(0, 4);
    if (incidents.length < 2) continue;
    const flexible = incidents.map((inc) => {
      const line = lines.find((item) => item.id === inc.id);
      if (!line) return false;
      return inc.vertex === 0 || inc.vertex === line.path.length - 1;
    });
    let best: number[] | null = null;
    let bestClear = -1;
    let bestAny: number[] | null = null;
    let bestAnyClear = -1;
    for (let mask = 0; mask < 1 << incidents.length; mask++) {
      const signs = incidents.map((inc, index) => {
        if (!flexible[index]) return 1;
        return (mask & (1 << index)) === 0 ? 1 : -1;
      });
      const pts = incidents.map((inc, index) => incidentOffset(inc, signs[index] ?? 1));
      let crosses = false;
      for (let i = 0; i < incidents.length && !crosses; i++) {
        for (let j = i + 1; j < incidents.length && !crosses; j++) {
          const a = pts[i];
          const b = pts[j];
          if (!a || !b) continue;
          for (const inc of incidents) {
            if (segmentsCross(a, b, inc.neighbor, inc.gear)) crosses = true;
          }
        }
      }
      let clear = 0;
      let pairs = 0;
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const a = pts[i];
          const b = pts[j];
          if (!a || !b) continue;
          clear += haversineFeet(lerpLatLng(a, b, 0.5), gear);
          pairs++;
        }
      }
      const avg = pairs ? clear / pairs : 0;
      if (avg > bestAnyClear) {
        bestAnyClear = avg;
        bestAny = signs;
      }
      if (crosses) continue;
      if (avg > bestClear) {
        bestClear = avg;
        best = signs;
      }
    }
    const chosen = best ?? bestAny;
    incidents.forEach((inc, index) => {
      const row = tip.get(inc.id);
      if (row && chosen) row[inc.vertex] = chosen[index] ?? 1;
    });
  }
  return { run, tip };
}

export function bypassSides(lines: BypassLine[], points: { kind: string; position: LatLng }[]): Map<string, number[]> {
  return bypassPlan(lines, points).run;
}

export function spanOffset(path: LatLng[], sides: number[], at: LatLng, offsetFt: number): LatLng {
  let best = 0;
  let bestFt = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    if (!a || !b) continue;
    const dist = haversineFeet(lerpLatLng(a, b, 0.5), at);
    if (dist < bestFt) {
      bestFt = dist;
      best = i;
    }
  }
  const from = path[best];
  const to = path[best + 1];
  if (!from || !to) return at;
  return offsetBeside(at, from, to, offsetFt, sides[best] ?? 1);
}

export function slotCableTag(
  line: Pick<LineFeature, "slot1" | "slot2" | "fiberCount" | "fiberCount2">,
  slot: 1 | 2,
): string {
  const id = slot === 1 ? line.slot1 : line.slot2;
  if (id === "empty") return "empty";
  if (!isCableType(id)) return "";
  return cableTag(id, slot === 1 ? line.fiberCount : line.fiberCount2);
}

function lerpLatLng(a: LatLng, b: LatLng, t: number): LatLng {
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
  };
}

function pushDistinct(out: LatLng[], point: LatLng) {
  const last = out[out.length - 1];
  if (
    last &&
    Math.abs(last.lat - point.lat) < 1e-10 &&
    Math.abs(last.lng - point.lng) < 1e-10
  ) {
    return;
  }
  out.push(point);
}

/** Joined vertices taper onto the original line. Vertices in `holdOff` stay offset so a bypass can pass through. */
export function joinMask(
  path: LatLng[],
  targets: LatLng[],
  enabled: boolean,
  holdOff: LatLng[] = [],
): boolean[] {
  return path.map((vertex) => {
    if (!enabled) return false;
    if (holdOff.some((target) => haversineFeet(vertex, target) <= 15)) return false;
    return targets.some((target) => haversineFeet(vertex, target) <= 15);
  });
}
function overpass(origin: LatLng, bearing: number, offsetFt: number, fromSign: number): LatLng[] {
  const pts: LatLng[] = [];
  const steps = 24;
  const alongEast = Math.sin(bearing);
  const alongNorth = Math.cos(bearing);
  const sideEast = Math.cos(bearing);
  const sideNorth = -Math.sin(bearing);
  const radius = offsetFt;
  for (let step = 0; step <= steps; step++) {
    const theta = (Math.PI * step) / steps;
    const side = Math.cos(theta) * fromSign * radius;
    const fwd = Math.sin(theta) * radius;
    pts.push(offsetFeet(origin, sideEast * side + alongEast * fwd, sideNorth * side + alongNorth * fwd));
  }
  return pts;
}

function pushAll(out: LatLng[], pts: LatLng[]) {
  for (const point of pts) pushDistinct(out, point);
}

function sideShift(from: LatLng, to: LatLng, offsetFt: number, sign: number) {
  const bearing = toRad(bearingDeg(from, to));
  return {
    e: Math.cos(bearing) * offsetFt * sign,
    n: -Math.sin(bearing) * offsetFt * sign,
    de: Math.sin(bearing),
    dn: Math.cos(bearing),
  };
}

export function parallelPath(
  path: LatLng[],
  offsetFt: number,
  join: boolean[],
  _sides: number[] = [],
  _tip: number[] = [],
): LatLng[] {
  if (path.length < 2 || offsetFt <= 0) return [];
  const sign = 1;
  const out: LatLng[] = [];
  const miterAt = (index: number): LatLng => {
    const vertex = path[index];
    const prev = path[index - 1];
    const next = path[index + 1];
    if (!vertex) return { lat: 0, lng: 0 };
    if (prev && next) {
      const a = sideShift(prev, vertex, offsetFt, sign);
      const b = sideShift(vertex, next, offsetFt, sign);
      const den = a.de * b.dn - a.dn * b.de;
      if (Math.abs(den) > 1e-4) {
        const t = ((b.e - a.e) * b.dn - (b.n - a.n) * b.de) / den;
        const me = a.e + t * a.de;
        const mn = a.n + t * a.dn;
        if (Math.hypot(me, mn) <= offsetFt * 3) return offsetFeet(vertex, me, mn);
      }
      return offsetFeet(vertex, (a.e + b.e) / 2, (a.n + b.n) / 2);
    }
    const leg = prev
      ? sideShift(prev, vertex, offsetFt, sign)
      : next
        ? sideShift(vertex, next, offsetFt, sign)
        : null;
    return leg ? offsetFeet(vertex, leg.e, leg.n) : vertex;
  };
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    if (!a || !b) continue;
    const feet = haversineFeet(a, b);
    if (feet < 1) continue;
    const bearing = toRad(bearingDeg(a, b));
    const shift = (point: LatLng) =>
      offsetFeet(point, Math.cos(bearing) * offsetFt * sign, -Math.sin(bearing) * offsetFt * sign);
    const ao = shift(a);
    const bo = shift(b);
    const joinA = join[i] === true;
    const joinB = join[i + 1] === true;
    const taper = Math.min(feet * 0.42, Math.max(offsetFt * 5, 22));
    const t = Math.min(0.42, taper / feet);
    if (joinA) pushDistinct(out, a);
    else if (i === 0) pushDistinct(out, miterAt(i));
    if (joinA) pushDistinct(out, lerpLatLng(ao, bo, t));
    if (joinB) pushDistinct(out, lerpLatLng(ao, bo, 1 - t));
    if (joinB) pushDistinct(out, b);
    else pushDistinct(out, miterAt(i + 1));
  }
  return out.length >= 2 ? out : [];
}

function destination(origin: LatLng, bearing: number, feet: number): LatLng {
  const rad = toRad(bearing);
  return offsetFeet(origin, Math.sin(rad) * feet, Math.cos(rad) * feet);
}

function exteriorBearing(gear: LatLng, a: LatLng, b: LatLng): number {
  const b1 = bearingDeg(gear, a);
  const b2 = bearingDeg(gear, b);
  let delta = b2 - b1;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return b1 + delta / 2 + 180;
}

function crossCircle(gear: LatLng, outside: LatLng, inside: LatLng, radius: number): LatLng {
  let lo = 0;
  let hi = 1;
  for (let step = 0; step < 18; step++) {
    const mid = (lo + hi) / 2;
    const point = lerpLatLng(outside, inside, mid);
    if (haversineFeet(gear, point) > radius) lo = mid;
    else hi = mid;
  }
  return lerpLatLng(outside, inside, lo);
}

function minorArc(gear: LatLng, a: LatLng, b: LatLng): LatLng[] {
  const start = bearingDeg(gear, a);
  let sweep = bearingDeg(gear, b) - start;
  while (sweep > 180) sweep -= 360;
  while (sweep < -180) sweep += 360;
  const radius = Math.max(haversineFeet(gear, a), haversineFeet(gear, b));
  const steps = Math.max(10, Math.round(Math.abs(sweep) / 10));
  const pts: LatLng[] = [];
  for (let i = 0; i <= steps; i++) pts.push(destination(gear, start + sweep * (i / steps), radius));
  return pts;
}

/** Keep a bypass outside the pedestal and arc it around instead of through the icon. */
export function routeBypass(
  lines: { id: string; kind: LineKind; offsetFt: number; drawn: LatLng[] }[],
  gears: LatLng[],
): { path: LatLng[]; kind: LineKind }[] {
  const figures: { path: LatLng[]; kind: LineKind }[] = [];
  const cuts: { at: LatLng; gear: LatLng; id: string; kind: LineKind }[] = [];
  for (const line of lines) {
    const radius = Math.max(line.offsetFt * 8, 24);
    const parts: LatLng[][] = [];
    let current: LatLng[] = [];
    const hit = (point: LatLng) => gears.find((gear) => haversineFeet(gear, point) <= radius) ?? null;
    const flush = () => {
      if (current.length >= 2) parts.push(current);
      current = [];
    };
    for (let i = 0; i < line.drawn.length; i++) {
      const point = line.drawn[i];
      if (!point) continue;
      const box = hit(point);
      if (!box) {
        current.push(point);
        continue;
      }
      const prev = current[current.length - 1];
      if (prev && !hit(prev)) {
        const edge = crossCircle(box, prev, point, radius);
        current.push(edge);
        cuts.push({ at: edge, gear: box, id: line.id, kind: line.kind });
      }
      flush();
      let lastInside = point;
      while (i + 1 < line.drawn.length && line.drawn[i + 1] && hit(line.drawn[i + 1]!)) {
        i++;
        lastInside = line.drawn[i] ?? lastInside;
      }
      const next = line.drawn[i + 1];
      if (next && !hit(next)) {
        const edge = crossCircle(box, next, lastInside, radius);
        current.push(edge);
        cuts.push({ at: edge, gear: box, id: line.id, kind: line.kind });
      }
    }
    flush();
    for (const part of parts) figures.push({ path: part, kind: line.kind });
  }
  const groups = new Map<string, { gear: LatLng; cuts: typeof cuts }>();
  for (const cut of cuts) {
    const key = `${cut.gear.lat.toFixed(6)},${cut.gear.lng.toFixed(6)}`;
    const group = groups.get(key) ?? { gear: cut.gear, cuts: [] };
    group.cuts.push(cut);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const used = new Set<number>();
    const byLine = new Map<string, number[]>();
    group.cuts.forEach((cut, index) => {
      const list = byLine.get(cut.id) ?? [];
      list.push(index);
      byLine.set(cut.id, list);
    });
    for (const indexes of byLine.values()) {
      if (indexes.length < 2) continue;
      const i = indexes[0];
      const j = indexes[1];
      const a = i === undefined ? undefined : group.cuts[i];
      const b = j === undefined ? undefined : group.cuts[j];
      if (!a || !b || i === undefined || j === undefined) continue;
      used.add(i);
      used.add(j);
      if (haversineFeet(a.at, b.at) >= 1) figures.push({ path: minorArc(group.gear, a.at, b.at), kind: a.kind });
    }
    const open = group.cuts.filter((_, index) => !used.has(index)).slice(0, 2);
    const a = open[0];
    const b = open[1];
    if (a && b && haversineFeet(a.at, b.at) >= 1) {
      figures.push({ path: minorArc(group.gear, a.at, b.at), kind: a.kind });
    }
  }
  return figures;
}

function localFeet(gear: LatLng, point: LatLng): { e: number; n: number } {
  const latFt = 364000;
  const lngFt = 364000 * Math.cos(toRad(gear.lat));
  return {
    e: (point.lng - gear.lng) * Math.max(lngFt, 1),
    n: (point.lat - gear.lat) * latFt,
  };
}

function inSquare(gear: LatLng, point: LatLng, size: number): boolean {
  const { e, n } = localFeet(gear, point);
  return Math.abs(e) <= size && Math.abs(n) <= size;
}

function crossSquare(gear: LatLng, outside: LatLng, inside: LatLng, size: number): LatLng {
  let lo = 0;
  let hi = 1;
  for (let step = 0; step < 20; step++) {
    const mid = (lo + hi) / 2;
    const point = lerpLatLng(outside, inside, mid);
    if (!inSquare(gear, point, size)) lo = mid;
    else hi = mid;
  }
  const hit = lerpLatLng(outside, inside, lo);
  const { e, n } = localFeet(gear, hit);
  const onEast = size - Math.abs(e) <= size - Math.abs(n);
  return offsetFeet(gear, onEast ? Math.sign(e || 1) * size : e, onEast ? n : Math.sign(n || 1) * size);
}

function squareParam(gear: LatLng, point: LatLng, size: number): number {
  const { e, n } = localFeet(gear, point);
  if (size - Math.abs(e) <= size - Math.abs(n)) {
    if (e >= 0) return (size - n) / (2 * size);
    return 2 + (n + size) / (2 * size);
  }
  if (n < 0) return 1 + (size - e) / (2 * size);
  return 3 + (e + size) / (2 * size);
}

function pointOnSquare(gear: LatLng, t: number, size: number): LatLng {
  const u = ((t % 4) + 4) % 4;
  const e = u < 1 ? size : u < 2 ? size - (u - 1) * 2 * size : u < 3 ? -size : -size + (u - 3) * 2 * size;
  const n = u < 1 ? size - u * 2 * size : u < 2 ? -size : u < 3 ? -size + (u - 2) * 2 * size : size;
  return offsetFeet(gear, e, n);
}

function squareWalk(gear: LatLng, from: LatLng, to: LatLng, size: number, force?: 1 | -1): LatLng[] {
  const u = squareParam(gear, from, size);
  const v = squareParam(gear, to, size);
  let delta = v - u;
  while (delta <= -4) delta += 4;
  while (delta > 4) delta -= 4;
  if (force === 1) {
    while (delta < 0) delta += 4;
  } else if (force === -1) {
    while (delta > 0) delta -= 4;
    if (delta === 0) delta = -4;
  } else {
    while (delta > 2) delta -= 4;
    while (delta < -2) delta += 4;
  }
  const marks = [u];
  if (delta >= 0) {
    for (let corner = Math.floor(u) + 1; corner < u + delta - 1e-6; corner++) marks.push(corner);
  } else {
    for (let corner = Math.ceil(u) - 1; corner > u + delta + 1e-6; corner--) marks.push(corner);
  }
  marks.push(u + delta);
  return marks.map((mark) => pointOnSquare(gear, mark, size));
}

function walkHits(path: LatLng[], centers: [LatLng, LatLng][]): number {
  let hits = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    if (!a || !b) continue;
    for (const [c, d] of centers) {
      if (segmentsCross(a, b, c, d)) hits += 1;
    }
  }
  return hits;
}

function clipSquare(drawn: LatLng[], gear: LatLng, size: number): { parts: LatLng[][]; cuts: LatLng[] } {
  const parts: LatLng[][] = [];
  const cuts: LatLng[] = [];
  let current: LatLng[] = [];
  for (let i = 0; i < drawn.length; i++) {
    const point = drawn[i];
    if (!point) continue;
    if (!inSquare(gear, point, size)) {
      current.push(point);
      continue;
    }
    const prev = current[current.length - 1];
    if (prev && !inSquare(gear, prev, size)) {
      const edge = crossSquare(gear, prev, point, size);
      current.push(edge);
      cuts.push(edge);
    }
    if (current.length >= 2) parts.push(current);
    current = [];
    let last = point;
    while (i + 1 < drawn.length && drawn[i + 1] && inSquare(gear, drawn[i + 1]!, size)) {
      i++;
      last = drawn[i] ?? last;
    }
    const next = drawn[i + 1];
    if (next && !inSquare(gear, next, size)) {
      const edge = crossSquare(gear, next, last, size);
      current.push(edge);
      cuts.push(edge);
    }
  }
  if (current.length >= 2) parts.push(current);
  return { parts, cuts };
}

/** Keep line 2 outside a square around each snapped object and run it along that edge to the next line 2. */
export function squareLine2(
  lines: { id: string; kind: LineKind; path: LatLng[]; offsetFt: number; drawn: LatLng[] }[],
  gears: LatLng[],
): { path: LatLng[]; kind: LineKind }[] {
  const figures: { path: LatLng[]; kind: LineKind }[] = [];
  const cuts = new Map<string, { gear: LatLng; at: LatLng; id: string; kind: LineKind }[]>();
  for (const line of lines) {
    let pieces = [line.drawn];
    for (const gear of gears) {
      if (!line.path.some((vertex) => haversineFeet(vertex, gear) <= 15)) continue;
      const touching = lines.filter((other) => other.path.some((vertex) => haversineFeet(vertex, gear) <= 15));
      const offset = Math.max(...touching.map((other) => other.offsetFt), line.offsetFt);
      let reach = Infinity;
      for (const other of touching) {
        other.path.forEach((vertex, index) => {
          if (haversineFeet(vertex, gear) > 15) return;
          const prev = other.path[index - 1];
          const next = other.path[index + 1];
          if (prev) reach = Math.min(reach, haversineFeet(vertex, prev));
          if (next) reach = Math.min(reach, haversineFeet(vertex, next));
        });
      }
      const wanted = offset * 2.7;
      const size = Math.max(offset * 2, Math.min(wanted, Number.isFinite(reach) ? reach * 0.28 : wanted));
      const next: LatLng[][] = [];
      for (const piece of pieces) {
        const clipped = clipSquare(piece, gear, size);
        next.push(...clipped.parts);
        const key = `${gear.lat.toFixed(6)},${gear.lng.toFixed(6)}`;
        const list = cuts.get(key) ?? [];
        for (const at of clipped.cuts) list.push({ gear, at, id: line.id, kind: line.kind });
        cuts.set(key, list);
      }
      pieces = next;
    }
    for (const path of pieces) {
      if (path.length >= 2) figures.push({ path, kind: line.kind });
    }
  }
  for (const group of cuts.values()) {
    const gear = group[0]?.gear;
    if (!gear || group.length < 2) continue;
    const size = (() => {
      const sample = group[0];
      if (!sample) return 48;
      const { e, n } = localFeet(gear, sample.at);
      return Math.max(Math.abs(e), Math.abs(n));
    })();
    const used = new Set<number>();
    const byLine = new Map<string, number[]>();
    group.forEach((cut, index) => {
      const list = byLine.get(cut.id) ?? [];
      list.push(index);
      byLine.set(cut.id, list);
    });
    const centers: [LatLng, LatLng][] = [];
    for (const line of lines) {
      line.path.forEach((vertex, index) => {
        if (haversineFeet(vertex, gear) > 15) return;
        const prev = line.path[index - 1];
        const next = line.path[index + 1];
        if (prev) centers.push([prev, vertex]);
        if (next) centers.push([vertex, next]);
      });
    }
    const pair = (i: number, j: number) => {
      const a = group[i];
      const b = group[j];
      if (!a || !b || haversineFeet(a.at, b.at) < 1) return;
      const cw = squareWalk(gear, a.at, b.at, size, 1);
      const ccw = squareWalk(gear, a.at, b.at, size, -1);
      const cwHits = walkHits(cw, centers);
      const ccwHits = walkHits(ccw, centers);
      const path =
        cwHits === ccwHits ? (cw.length <= ccw.length ? cw : ccw) : cwHits < ccwHits ? cw : ccw;
      figures.push({ path, kind: a.kind });
    };
    for (const indexes of byLine.values()) {
      if (indexes.length < 2) continue;
      const i = indexes[0];
      const j = indexes[1];
      if (i === undefined || j === undefined) continue;
      used.add(i);
      used.add(j);
      pair(i, j);
    }
    const open = group.map((_, index) => index).filter((index) => !used.has(index));
    for (let n = 0; n + 1 < open.length; n += 2) {
      const i = open[n];
      const j = open[n + 1];
      if (i === undefined || j === undefined) continue;
      pair(i, j);
    }
  }
  return figures;
}

export function bypassAvailable(
  line: { id: string; path: LatLng[] },
  lines: { id: string; path: LatLng[]; parallel?: boolean; intoSlot?: number }[],
  points: { kind: string; position: LatLng }[],
): boolean {
  const boxes = points.filter((point) => point.kind === "pedestal" || point.kind === "vault");
  const touches = (path: LatLng[], at: LatLng) => path.some((vertex) => haversineFeet(vertex, at) <= 15);
  for (const box of boxes) {
    if (!touches(line.path, box.position)) continue;
    const others = lines.filter(
      (other) =>
        other.id !== line.id &&
        other.parallel &&
        (other.intoSlot === 1 || other.intoSlot === 2) &&
        touches(other.path, box.position),
    );
    if (others.length >= 2) return false;
  }
  return true;
}
export function bypassConnectors(
  lines: (Pick<
    LineFeature,
    "id" | "kind" | "path" | "parallel" | "intoSlot" | "slot1" | "slot2" | "fiberCount" | "fiberCount2"
  > & { offsetFt: number })[],
  points: { kind: string; position: LatLng }[],
  sides: Map<string, number[]> = new Map(),
  tip: Map<string, number[]> = new Map(),
): { path: LatLng[]; kind: LineKind }[] {
  const ties: { path: LatLng[]; kind: LineKind }[] = [];
  for (const gear of gearPositions(points)) {
    const incidents = incidentsAt(lines, gear);
    const byLine = new Map<string, { at: LatLng; kind: LineKind; offsetFt: number; neighbor: LatLng }>();
    for (const inc of incidents) {
      const sign = tip.get(inc.id)?.[inc.vertex] ?? sides.get(inc.id)?.[inc.seg] ?? 1;
      const at = incidentOffset(inc, sign);
      const line = lines.find((item) => item.id === inc.id);
      const kind = line?.kind ?? "line";
      const existing = byLine.get(inc.id);
      if (!existing) {
        byLine.set(inc.id, { at, kind, offsetFt: inc.offsetFt, neighbor: inc.neighbor });
        continue;
      }
      byLine.set(inc.id, {
        at: lerpLatLng(existing.at, at, 0.5),
        kind,
        offsetFt: inc.offsetFt,
        neighbor: inc.neighbor,
      });
    }
    const hits = [...byLine.values()].slice(0, 2);
    if (hits.length < 2) continue;
    const link = (a: (typeof hits)[number], b: (typeof hits)[number]) => {
      if (!a || !b || haversineFeet(a.at, b.at) < 1) return;
      const gap = Math.max(a.offsetFt, b.offsetFt);
      const mid = lerpLatLng(a.at, b.at, 0.5);
      const dist = haversineFeet(mid, gear);
      const bump = Math.max(0, gap * 1.8 - dist);
      const aim = dist < gap * 0.4 ? exteriorBearing(gear, a.neighbor, b.neighbor) : bearingDeg(gear, mid);
      const crown = bump > 1 ? destination(gear, aim, dist + bump) : mid;
      const samples: LatLng[] = [];
      const steps = 8;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const u = 1 - t;
        samples.push({
          lat: u * u * a.at.lat + 2 * u * t * crown.lat + t * t * b.at.lat,
          lng: u * u * a.at.lng + 2 * u * t * crown.lng + t * t * b.at.lng,
        });
      }
      ties.push({ path: samples, kind: a.kind });
    };
    if (hits.length === 2 && hits[0] && hits[1]) link(hits[0], hits[1]);
  }
  return ties;
}

function stationPoint(inc: Incident, sign: number, back: number): LatLng {
  const span = Math.max(haversineFeet(inc.gear, inc.neighbor), 1);
  const t = Math.min(0.7, back / span);
  const on = lerpLatLng(inc.gear, inc.neighbor, t);
  const a = inc.atStart ? inc.gear : inc.neighbor;
  const b = inc.atStart ? inc.neighbor : inc.gear;
  const bearing = toRad(bearingDeg(a, b));
  return offsetFeet(on, Math.cos(bearing) * inc.offsetFt * sign, -Math.sin(bearing) * inc.offsetFt * sign);
}

function trimToward(path: LatLng[], gear: LatLng, stopFt: number): LatLng[] {
  if (path.length < 2) return path;
  let index = path.length - 1;
  while (index > 0 && path[index] && haversineFeet(path[index], gear) < stopFt) index--;
  const outside = path[index];
  const inside = path[index + 1] ?? path[index];
  if (!outside || !inside) return path;
  const edge = haversineFeet(outside, gear) >= stopFt ? crossCircle(gear, outside, inside, stopFt) : outside;
  return [...path.slice(0, index + 1), edge];
}

function pullOffGear(pieces: LatLng[][], gear: LatLng, stopFt: number): LatLng[][] {
  let pieceIndex = -1;
  let dist = Infinity;
  for (let index = 0; index < pieces.length; index++) {
    const piece = pieces[index];
    if (!piece) continue;
    for (const point of piece) {
      const here = haversineFeet(point, gear);
      if (here < dist) {
        dist = here;
        pieceIndex = index;
      }
    }
  }
  if (pieceIndex < 0 || dist > stopFt) return pieces;
  const piece = pieces[pieceIndex];
  if (!piece || piece.length < 2) return pieces;
  let nearest = 0;
  let nearestDist = Infinity;
  piece.forEach((point, index) => {
    const here = haversineFeet(point, gear);
    if (here < nearestDist) {
      nearestDist = here;
      nearest = index;
    }
  });
  const before = trimToward(piece.slice(0, nearest + 1), gear, stopFt);
  const after = trimToward(piece.slice(nearest).slice().reverse(), gear, stopFt).reverse();
  const next = pieces.slice();
  const replacement = [before, after].filter((part) => part.length >= 2);
  next.splice(pieceIndex, 1, ...replacement);
  return next;
}

/** Connect bypass lines around a shared object. A side change is a half-circle up the span, not on the object. */
export function tieBypasses(
  lines: { id: string; kind: LineKind; path: LatLng[]; offsetFt: number; drawn: LatLng[] }[],
  gears: LatLng[],
): { path: LatLng[]; kind: LineKind }[] {
  const figures: { path: LatLng[]; kind: LineKind }[] = [];
  const drawn = new Map<string, LatLng[][]>(lines.map((line) => [line.id, [line.drawn.slice()]]));
  const kindOf = new Map(lines.map((line) => [line.id, line.kind]));
  const asBypass: BypassLine[] = lines.map((line) => ({
    id: line.id,
    path: line.path,
    parallel: true,
    offsetFt: line.offsetFt,
  }));
  for (const gear of gears) {
    const incidents = incidentsAt(asBypass, gear);
    const byLine = new Map<string, Incident[]>();
    for (const inc of incidents) {
      const list = byLine.get(inc.id) ?? [];
      list.push(inc);
      byLine.set(inc.id, list);
    }
    const pairs: [Incident, Incident][] = [];
    const loose: Incident[] = [];
    for (const list of byLine.values()) {
      if (list.length >= 2 && list[0] && list[1]) pairs.push([list[0], list[1]]);
      else if (list[0]) loose.push(list[0]);
    }
    if (loose.length >= 2 && loose[0] && loose[1]) pairs.push([loose[0], loose[1]]);
    for (const [a, b] of pairs) {
      const gap = Math.max(a.offsetFt, b.offsetFt);
      const hopFor = (inc: Incident) =>
        Math.min(Math.max(gap * 8, 32), Math.max(haversineFeet(inc.gear, inc.neighbor), 1) * 0.45);
      const hopA = hopFor(a);
      const hopB = hopFor(b);
      const near = Math.min(Math.max(gap * 3.2, 20), Math.min(hopA, hopB) * 0.55);
      const probeA = stationPoint(a, 1, near);
      const probeB = stationPoint(b, 1, near);
      const flip = segmentsCross(probeA, probeB, a.neighbor, a.gear) || segmentsCross(probeA, probeB, b.neighbor, b.gear) ? b : null;
      const finish = (inc: Incident, hop: number) => {
        const stop = flip === inc ? hop : near;
        drawn.set(inc.id, pullOffGear(drawn.get(inc.id) ?? [], gear, stop));
        if (flip !== inc) return stationPoint(inc, 1, near);
        const span = Math.max(haversineFeet(inc.gear, inc.neighbor), 1);
        const center = lerpLatLng(inc.gear, inc.neighbor, Math.min(0.7, hop / span));
        const arc = overpass(center, toRad(bearingDeg(inc.gear, inc.neighbor)), inc.offsetFt, 1);
        const stub = stationPoint(inc, -1, near);
        figures.push({ path: [...arc, stub], kind: kindOf.get(inc.id) ?? "line" });
        return stub;
      };
      const endA = finish(a, hopA);
      const endB = finish(b, hopB);
      const mid = lerpLatLng(endA, endB, 0.5);
      const dist = haversineFeet(mid, gear);
      const aim = dist < gap ? exteriorBearing(gear, a.neighbor, b.neighbor) : bearingDeg(gear, mid);
      const crown = dist < near ? destination(gear, aim, near * 1.25) : mid;
      const bridge: LatLng[] = [];
      for (let step = 0; step <= 8; step++) {
        const t = step / 8;
        const u = 1 - t;
        bridge.push({
          lat: u * u * endA.lat + 2 * u * t * crown.lat + t * t * endB.lat,
          lng: u * u * endA.lng + 2 * u * t * crown.lng + t * t * endB.lng,
        });
      }
      figures.push({ path: bridge, kind: kindOf.get(a.id) ?? "line" });
    }
  }
  for (const line of lines) {
    for (const path of drawn.get(line.id) ?? []) {
      if (path.length >= 2) figures.push({ path, kind: line.kind });
    }
  }
  return figures;
}

export function cableTag(cable: CableType, fiberCount: string): string {
  if (cable === "625") return ".625";
  if (cable === "875") return ".875";
  if (cable === "rg6") return "rg6";
  if (cable === "rg11") return "rg11";
  if (cable === "rock") return "rock";
  if (cable === "flex") return "flex";
  const count = fiberCount.trim();
  return count ? `${count}ct` : "fiber";
}

export function cableEntries(
  line: Pick<LineFeature, "parallel" | "cables" | "slot1" | "slot2" | "fiberCount" | "fiberCount2">,
): { cable: CableType; count: string }[] {
  if (line.parallel) {
    const out: { cable: CableType; count: string }[] = [];
    if (isCableType(line.slot1)) {
      out.push({ cable: line.slot1, count: line.fiberCount });
    }
    if (isCableType(line.slot2)) {
      out.push({ cable: line.slot2, count: line.fiberCount2 });
    }
    return out;
  }
  return line.cables.map((cable) => ({ cable, count: line.fiberCount }));
}

export function spanParts(
  feet: number,
  line: Pick<
    LineFeature,
    "parallel" | "cables" | "slot1" | "slot2" | "fiberCount" | "fiberCount2" | "emptyPipe" | "remove" | "kind" | "fiberUnit"
  >,
): { footage: string; detail: string } {
  const tags = cableEntries(line).map((entry) => cableTag(entry.cable, entry.count));
  if (line.emptyPipe && !tags.includes("empty")) tags.push("empty");
  const detail = line.parallel ? "" : tags.join("/");
  const fiberOnlyLabel =
    line.fiberUnit === "km" && line.kind !== "drop" && cableEntries(line).some((entry) => entry.cable === "fiber");
  const footage = fiberOnlyLabel ? formatKmLabel(feet) : formatFootageLabel(feet);
  return { footage: line.remove ? `remove ${footage}` : footage, detail };
}

export function spanLabel(
  feet: number,
  line: Pick<
    LineFeature,
    | "parallel"
    | "cables"
    | "slot1"
    | "slot2"
    | "fiberCount"
    | "fiberCount2"
    | "emptyPipe"
    | "remove"
    | "kind"
    | "fiberUnit"
  >,
): string {
  const { footage, detail } = spanParts(feet, line);
  return detail ? `${footage}\n${detail}` : footage;
}

const LOSS_DB_PER_100: Partial<Record<CableType, number>> = {
  "875": 1.4,
  "625": 1.8,
  flex: 2.3,
  rg11: 4,
  rg6: 6,
};

export function formatDb(db: number): string {
  return `${db.toFixed(1)} dB`;
}

function formatDbRange(low: number, high: number): string {
  const digits = high >= 0.1 ? 2 : 3;
  return `${low.toFixed(digits)}–${high.toFixed(digits)} dB`;
}

export function lineLossParts(
  line: Pick<LineFeature, "path" | "kind" | "parallel" | "cables" | "slot1" | "slot2" | "fiberCount" | "fiberCount2">,
): { label: string; feet: number; db: number; text?: string }[] {
  const feet = pathFootage(line.path);
  if (feet <= 0) return [];
  const parts: { label: string; feet: number; db: number; text?: string }[] = [];
  const seen = new Set<string>();
  const fibers = cableEntries(line).filter((entry) => entry.cable === "fiber");
  if (fibers.length > 0 && line.kind !== "drop") {
    const km = feet / FT_PER_KM;
    const low = km * 0.2;
    const high = km * 0.35;
    const counts = [...new Set(fibers.map((entry) => entry.count.trim()).filter(Boolean))];
    parts.push({
      label: counts.length === 1 ? `${counts[0]}ct` : "fiber",
      feet,
      db: (low + high) / 2,
      text: formatDbRange(low, high),
    });
  }
  for (const entry of cableEntries(line)) {
    if (entry.cable === "fiber") continue;
    const rate = LOSS_DB_PER_100[entry.cable];
    if (!rate) continue;
    const label = cableTag(entry.cable, "");
    if (seen.has(label)) continue;
    seen.add(label);
    parts.push({ label, feet, db: (feet / 100) * rate });
  }
  return parts;
}

export function lineLossNote(
  line: Pick<LineFeature, "path" | "kind" | "parallel" | "cables" | "slot1" | "slot2" | "fiberCount" | "fiberCount2">,
): string {
  return lineLossParts(line)
    .map((part) => `${part.label} ${part.text ?? formatDb(part.db)}`)
    .join(", ");
}

export function notesWithLoss(notes: string, detail: string): string {
  const mark = notes.startsWith("Line loss:") ? 0 : notes.indexOf("\nLine loss:");
  const base = (mark >= 0 ? notes.slice(0, mark) : notes).replace(/\s+$/, "");
  if (!detail) return base;
  return base ? `${base}\nLine loss: ${detail}` : `Line loss: ${detail}`;
}

export function plantLineLoss(lines: LineFeature[]): { label: string; feet: number; db: number }[] {
  const totals = new Map<string, { feet: number; db: number }>();
  for (const line of lines) {
    for (const part of lineLossParts(line)) {
      const prev = totals.get(part.label) ?? { feet: 0, db: 0 };
      prev.feet += part.feet;
      prev.db += part.db;
      totals.set(part.label, prev);
    }
  }
  const order = [".625", ".875", "flex", "rg11", "rg6"];
  return [...totals.entries()]
    .map(([label, row]) => ({ label, feet: row.feet, db: row.db }))
    .sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
}

export function boundsOf(points: LatLng[]): {
  south: number;
  west: number;
  north: number;
  east: number;
} | null {
  if (points.length === 0) return null;
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const p of points) {
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
    west = Math.min(west, p.lng);
    east = Math.max(east, p.lng);
  }
  return { south, west, north, east };
}

export function normalizeBox(a: LatLng, b: LatLng) {
  return {
    south: Math.min(a.lat, b.lat),
    north: Math.max(a.lat, b.lat),
    west: Math.min(a.lng, b.lng),
    east: Math.max(a.lng, b.lng),
  };
}
