import {
  calloutAt,
  calloutFeet,
  footageSpans,
  pathFootage,
  pathMidpoint,
  readableRotation,
  reportedFeet,
  spanParts,
  spanShownFeet,
  slotCableTag,
} from "./geo";
import type { LabelSide, LatLng, LineFeature, MapViewState, PointFeature } from "./types";

type Rect = { x: number; y: number; w: number; h: number };

const SIDES: LabelSide[] = ["top", "right", "bottom", "left"];

function fontPx(size: string): number {
  if (size === "xl") return 28;
  if (size === "lg") return 16;
  if (size === "sm" || size === "xs") return 11;
  return 12;
}

function charW(size: string): number {
  if (size === "xl") return 17;
  if (size === "lg") return 10.7;
  if (size === "md") return 8;
  return 7.3;
}

function world(ll: LatLng, zoom: number): { x: number; y: number } {
  const scale = 256 * 2 ** zoom;
  const x = ((ll.lng + 180) / 360) * scale;
  const sin = Math.sin((ll.lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  return { x, y };
}

function feetPerPixel(lat: number, zoom: number): number {
  const mpp = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
  return mpp * 3.280839895;
}

function boxSize(footage: string, detail: string, size: string): { w: number; h: number } {
  const px = fontPx(size);
  const w = Math.max(footage.length, detail.length, 1) * charW(size) + 8;
  const h = (detail ? px * 2.35 : px * 1.35) + 4;
  return { w, h };
}

function rectAt(cx: number, cy: number, w: number, h: number, deg = 0): Rect {
  const rad = (deg * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  const rw = w * c + h * s;
  const rh = w * s + h * c;
  return { x: cx - rw / 2, y: cy - rh / 2, w: rw, h: rh };
}

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return w * h;
}

function blocked(rect: Rect, taken: Rect[]): number {
  let area = 0;
  for (const box of taken) area += overlap(rect, box);
  return area;
}

function pointText(point: PointFeature): string {
  const named = point.kind === "vault" && point.vaultType === "s" && !point.name.trim() ? "flower pot" : point.name.trim();
  if (point.remove) return named ? `remove ${named}` : "remove";
  return named;
}

function objectRect(anchor: { x: number; y: number }, side: LabelSide, w: number, h: number, kind: PointFeature["kind"]): Rect {
  const gap = kind === "passing" ? 8 : kind === "pin" ? 36 : 16;
  if (side === "bottom") return { x: anchor.x - w / 2, y: anchor.y + gap, w, h };
  if (side === "left") return { x: anchor.x - gap - w, y: anchor.y - h / 2, w, h };
  if (side === "right") return { x: anchor.x + gap, y: anchor.y - h / 2, w, h };
  return { x: anchor.x - w / 2, y: anchor.y - gap - h, w, h };
}

function screenBearing(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return (Math.atan2(b.x - a.x, a.y - b.y) * 180) / Math.PI;
}

type SpanJob = {
  line: LineFeature;
  index: number;
  at: LatLng;
  from: LatLng;
  to: LatLng;
  footage: string;
  detail: string;
  calloutDetail: string;
  size: string;
};

function compass(dx: number, dy: number): number {
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return ((Math.round(deg / 45) % 8) + 8) % 8;
}

function pointInRect(p: { x: number; y: number }, rect: Rect, pad = 0): boolean {
  return p.x >= rect.x - pad && p.x <= rect.x + rect.w + pad && p.y >= rect.y - pad && p.y <= rect.y + rect.h + pad;
}

function segmentsCross(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }): boolean {
  const cross = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (d1 === 0 || d2 === 0 || d3 === 0 || d4 === 0) return false;
  return d1 * d2 < 0 && d3 * d4 < 0;
}

function segmentHitsRect(a: { x: number; y: number }, b: { x: number; y: number }, rect: Rect): boolean {
  if (pointInRect(b, rect)) return true;
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.w, y: rect.y },
    { x: rect.x + rect.w, y: rect.y + rect.h },
    { x: rect.x, y: rect.y + rect.h },
  ];
  for (let i = 0; i < 4; i++) {
    const next = corners[(i + 1) % 4];
    if (next && segmentsCross(a, b, corners[i]!, next)) return true;
  }
  return false;
}

type Leader = { a: { x: number; y: number }; b: { x: number; y: number } };

function leaderCost(a: { x: number; y: number }, b: { x: number; y: number }, rects: Rect[], leaders: Leader[]): number {
  let hits = 0;
  for (const box of rects) {
    if (pointInRect(a, box, 2)) continue;
    if (segmentHitsRect(a, b, box)) hits += 1;
  }
  for (const other of leaders) {
    if (segmentsCross(a, b, other.a, other.b)) hits += 1;
  }
  return hits;
}

type Spot = { dir: number; step: number; score: number; rect: Rect; leader: Leader };

function scoreSpot(job: SpanJob, dir: number, zoom: number, taken: Rect[], leaders: Leader[], penalty: number): Spot | null {
  const anchor = world(job.at, zoom);
  const size = boxSize(job.footage, job.calloutDetail || job.detail, job.size);
  const minPx = Math.hypot(size.w, size.h) / 2 + 20;
  let best: Spot | null = null;
  for (let step = 0; step <= 6; step++) {
    const reach = calloutFeet(step) / feetPerPixel(job.at.lat, zoom);
    if (reach < minPx && step < 6) continue;
    const at = world(calloutAt(job.at, dir, calloutFeet(step)), zoom);
    const rect = rectAt(at.x, at.y, size.w, size.h);
    const area = blocked(rect, taken);
    const crosses = leaderCost(anchor, at, taken, leaders);
    const score = area * 100 + crosses * 8000 + step * 3 + penalty;
    if (!best || score < best.score) best = { dir, step, score, rect, leader: { a: anchor, b: at } };
  }
  return best;
}

function bestSpot(job: SpanJob, options: { dir: number; penalty: number }[], zoom: number, taken: Rect[], leaders: Leader[]): Spot {
  let best: Spot | null = null;
  for (const option of options) {
    const spot = scoreSpot(job, option.dir, zoom, taken, leaders, option.penalty);
    if (spot && (!best || spot.score < best.score)) best = spot;
  }
  if (best) return best;
  const anchor = world(job.at, zoom);
  return { dir: 0, step: 6, score: 0, rect: rectAt(anchor.x, anchor.y, 8, 8), leader: { a: anchor, b: anchor } };
}

function sideOptions(dir: number): { dir: number; penalty: number }[] {
  return [
    { dir, penalty: 0 },
    { dir: (dir + 1) % 8, penalty: 1800 },
    { dir: (dir + 7) % 8, penalty: 1800 },
  ];
}

function gearOf(points: PointFeature[]): LatLng[] {
  return points
    .filter((point) => point.kind === "pedestal" || point.kind === "vault" || point.kind === "mdu" || point.kind === "pole")
    .map((point) => point.position);
}

function jobsFor(line: LineFeature, points: PointFeature[]): SpanJob[] {
  const size = line.labelSize === "xs" || line.labelSize === "sm" || line.labelSize === "lg" || line.labelSize === "xl" ? line.labelSize : "md";
  if (line.kind === "road") {
    const name = line.name.trim();
    const mid = line.path.length >= 2 ? pathMidpoint(line.path) : null;
    const from = line.path[0];
    const to = line.path[line.path.length - 1];
    if (!name || !mid || !from || !to) return [];
    return [
      {
        line,
        index: 0,
        at: mid,
        from,
        to,
        footage: line.remove ? `remove ${name}` : name,
        detail: "",
        calloutDetail: "",
        size,
      },
    ];
  }
  const measured = pathFootage(line.path);
  const shown = reportedFeet(line);
  const gear = gearOf(points);
  const cableNote = line.parallel ? [slotCableTag(line, 1), slotCableTag(line, 2)].filter(Boolean).join("/") : "";
  return footageSpans(line.path, gear, line.splits ?? [], (line.dots ?? []).map((dot) => dot.at)).map((span, index) => {
    const parts = spanParts(spanShownFeet(span.feet, measured, shown), line);
    const detail = span.showCable ? parts.detail : "";
    return {
      line,
      index,
      at: span.labelAt,
      from: span.from,
      to: span.to,
      footage: parts.footage,
      detail,
      calloutDetail: [detail, cableNote].filter(Boolean).join(" "),
      size,
    };
  });
}

function fitsInline(job: SpanJob, zoom: number): boolean {
  const a = world(job.from, zoom);
  const b = world(job.to, zoom);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const text = job.detail ? `${job.footage} ${job.detail}` : job.footage;
  return len >= Math.max(text.length, 1) * charW(job.size) + 18;
}

export function optimizeLayout(
  lines: LineFeature[],
  points: PointFeature[],
  view: MapViewState,
): { lines: LineFeature[]; points: PointFeature[] } | null {
  const zoom = Number.isFinite(view.zoom) ? view.zoom : 18;
  const taken: Rect[] = [];
  const iconBoxes: Rect[] = [];

  for (const point of points) {
    const at = world(point.position, zoom);
    const r = point.kind === "pin" ? 16 : point.kind === "passing" ? 8 : 12;
    iconBoxes.push({ x: at.x - r, y: at.y - r, w: r * 2, h: r * 2 });
  }
  taken.push(...iconBoxes);

  const byLine = new Map<string, SpanJob[]>();
  for (const line of lines) {
    if (line.kind === "road" && !line.name.trim()) continue;
    const jobs = jobsFor(line, points);
    if (jobs.length === 0) continue;
    byLine.set(line.id, jobs);
  }

  const calloutLine = new Set<string>();
  for (const [id, jobs] of byLine) {
    if (jobs.some((job) => !fitsInline(job, zoom))) calloutLine.add(id);
  }

  const inlineBoxes = new Map<string, Rect>();
  for (const [id, jobs] of byLine) {
    if (calloutLine.has(id)) continue;
    for (const job of jobs) {
      const at = world(job.at, zoom);
      const a = world(job.from, zoom);
      const b = world(job.to, zoom);
      const size = boxSize(job.footage, job.detail, job.size);
      const text = job.detail ? `${job.footage} ${job.detail}` : job.footage;
      const turn = readableRotation(screenBearing(a, b));
      const rect = rectAt(at.x, at.y, size.w, size.h, turn);
      const hits = blocked(rect, [...iconBoxes, ...inlineBoxes.values()]);
      if (hits > 12 || size.w > Math.hypot(b.x - a.x, b.y - a.y)) {
        calloutLine.add(id);
        break;
      }
      inlineBoxes.set(`${id}:${job.index}`, rect);
    }
  }
  for (const id of calloutLine) {
    for (const key of [...inlineBoxes.keys()]) {
      if (key.startsWith(`${id}:`)) inlineBoxes.delete(key);
    }
  }
  taken.push(...inlineBoxes.values());

  const leaders: Leader[] = [];
  const linePatch = new Map<string, Pick<LineFeature, "callout" | "calloutDirs" | "calloutSteps">>();
  const commit = (job: SpanJob, spot: Spot, dirs: number[], steps: number[]) => {
    dirs[job.index] = spot.dir;
    steps[job.index] = spot.step;
    taken.push(spot.rect);
    leaders.push(spot.leader);
  };
  const placeRow = (jobs: SpanJob[], dir: number, skip: number, dirs: number[], steps: number[]) => {
    let score = 0;
    const ordered = jobs.filter((job) => job.index !== skip).sort((a, b) => world(a.at, zoom).y - world(b.at, zoom).y);
    for (const job of ordered) {
      const spot = bestSpot(job, sideOptions(dir), zoom, taken, leaders);
      score += spot.score;
      commit(job, spot, dirs, steps);
    }
    return score;
  };

  const tops: { id: string; job: SpanJob; dir: number; dirs: number[]; steps: number[] }[] = [];

  const orderedIds = [...byLine.keys()].sort((a, b) => {
    const spanCount = (key: string) => (calloutLine.has(key) ? (byLine.get(key)?.length ?? 0) : -1);
    return spanCount(b) - spanCount(a);
  });
  for (const id of orderedIds) {
    const jobs = byLine.get(id) ?? [];
    const useCallout = calloutLine.has(id);
    const dirs = jobs.map(() => 0);
    const steps = jobs.map(() => 0);
    if (useCallout && jobs.length > 0) {
      let dx = 0;
      let dy = 0;
      for (const job of jobs) {
        const a = world(job.from, zoom);
        const b = world(job.to, zoom);
        dx += b.x - a.x;
        dy += b.y - a.y;
      }
      const along = compass(dx, dy);
      const sideA = (along + 2) % 8;
      const sideB = (along + 6) % 8;
      const top = jobs.reduce((best, job) => (world(job.at, zoom).y < world(best.at, zoom).y ? job : best), jobs[0]!);
      const liftTop = jobs.length > 1 && Math.abs(dy) > Math.abs(dx) && (top.index === 0 || top.index === jobs.length - 1);
      const savedTaken = taken.slice();
      const savedLeaders = leaders.slice();
      const dirsA = dirs.slice();
      const stepsA = steps.slice();
      const scoreA = placeRow(jobs, sideA, liftTop ? top.index : -1, dirsA, stepsA);
      const takenA = taken.slice();
      const leadersA = leaders.slice();
      taken.splice(0, taken.length, ...savedTaken);
      leaders.splice(0, leaders.length, ...savedLeaders);
      const dirsB = dirs.slice();
      const stepsB = steps.slice();
      const scoreB = placeRow(jobs, sideB, liftTop ? top.index : -1, dirsB, stepsB);
      if (scoreA <= scoreB) {
        taken.splice(0, taken.length, ...takenA);
        leaders.splice(0, leaders.length, ...leadersA);
        dirs.splice(0, dirs.length, ...dirsA);
        steps.splice(0, steps.length, ...stepsA);
      } else {
        dirs.splice(0, dirs.length, ...dirsB);
        steps.splice(0, steps.length, ...stepsB);
      }
      const side = scoreA <= scoreB ? sideA : sideB;
      if (liftTop) tops.push({ id, job: top, dir: side, dirs, steps });
    }
    linePatch.set(id, { callout: useCallout, calloutDirs: dirs, calloutSteps: steps });
  }

  for (const item of tops) {
    const spot = bestSpot(
      item.job,
      [
        { dir: 0, penalty: 0 },
        { dir: 7, penalty: 700 },
        { dir: 1, penalty: 700 },
        { dir: item.dir, penalty: 2600 },
        { dir: (item.dir + 1) % 8, penalty: 3200 },
        { dir: (item.dir + 7) % 8, penalty: 3200 },
      ],
      zoom,
      taken,
      leaders,
    );
    commit(item.job, spot, item.dirs, item.steps);
    const patch = linePatch.get(item.id);
    if (patch) linePatch.set(item.id, { ...patch, calloutDirs: item.dirs, calloutSteps: item.steps });
  }

  const pointPatch = new Map<string, LabelSide>();
  const named = points
    .map((point) => ({ point, text: pointText(point) }))
    .filter((item) => item.text);
  named.sort((a, b) => {
    const crowd = (item: (typeof named)[number]) =>
      named.filter((other) => {
        if (other === item) return false;
        const left = world(item.point.position, zoom);
        const right = world(other.point.position, zoom);
        return Math.hypot(left.x - right.x, left.y - right.y) < 90;
      }).length;
    return crowd(b) - crowd(a);
  });
  for (const item of named) {
    const anchor = world(item.point.position, zoom);
    const size = boxSize(item.text, "", item.point.labelSize || "lg");
    let bestSide: LabelSide = item.point.labelSide || "top";
    let bestArea = Infinity;
    for (const side of SIDES) {
      const rect = objectRect(anchor, side, size.w, size.h, item.point.kind);
      const area = blocked(rect, taken);
      if (area < bestArea) {
        bestArea = area;
        bestSide = side;
      }
    }
    pointPatch.set(item.point.id, bestSide);
    taken.push(objectRect(anchor, bestSide, size.w, size.h, item.point.kind));
  }

  let changed = false;
  const nextLines = lines.map((line) => {
    const patch = linePatch.get(line.id);
    if (!patch) return line;
    const same =
      line.callout === patch.callout &&
      patch.calloutDirs.every((dir, index) => dir === (line.calloutDirs?.[index] ?? 0)) &&
      patch.calloutDirs.length === (line.calloutDirs?.length ?? 0) &&
      patch.calloutSteps.every((step, index) => step === (line.calloutSteps?.[index] ?? 0)) &&
      patch.calloutSteps.length === (line.calloutSteps?.length ?? 0);
    if (same) return line;
    changed = true;
    return { ...line, ...patch };
  });
  const nextPoints = points.map((point) => {
    const side = pointPatch.get(point.id);
    if (!side || side === (point.labelSide || "top")) return point;
    changed = true;
    return { ...point, labelSide: side };
  });
  if (!changed) return null;
  return { lines: nextLines, points: nextPoints };
}
