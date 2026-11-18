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
  if (size === "xl") return 22;
  if (size === "lg") return 16;
  if (size === "sm" || size === "xs") return 11;
  return 12;
}

function charW(size: string): number {
  if (size === "xl") return 14;
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

function gearOf(points: PointFeature[]): LatLng[] {
  return points
    .filter((point) => point.kind === "pedestal" || point.kind === "vault" || point.kind === "mdu" || point.kind === "pole")
    .map((point) => point.position);
}

function jobsFor(line: LineFeature, points: PointFeature[]): SpanJob[] {
  const size = line.labelSize === "xs" || line.labelSize === "sm" || line.labelSize === "lg" ? line.labelSize : "md";
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

  const linePatch = new Map<string, Pick<LineFeature, "callout" | "calloutDirs" | "calloutSteps">>();
  for (const [id, jobs] of byLine) {
    const useCallout = calloutLine.has(id);
    const dirs = jobs.map(() => 0);
    const steps = jobs.map(() => 0);
    if (useCallout) {
      jobs.forEach((job, index) => {
        const anchor = world(job.at, zoom);
        const size = boxSize(job.footage, job.calloutDetail, job.size);
        const minPx = Math.hypot(size.w, size.h) / 2 + 20;
        let best: { dir: number; step: number; area: number; reach: number } | null = null;
        for (let dir = 0; dir < 8; dir++) {
          for (let step = 0; step <= 6; step++) {
            const reach = calloutFeet(step) / feetPerPixel(job.at.lat, zoom);
            if (reach < minPx && step < 6) continue;
            const at = world(calloutAt(job.at, dir, calloutFeet(step)), zoom);
            const rect = rectAt(at.x, at.y, size.w, size.h);
            const area = blocked(rect, taken);
            const score = area * 100 + step;
            const bestScore = best ? best.area * 100 + best.step : Infinity;
            if (!best || score < bestScore || (score === bestScore && reach < best.reach)) {
              best = { dir, step, area, reach };
            }
          }
        }
        const pick = best ?? { dir: 0, step: 6, area: 0, reach: 0 };
        dirs[index] = pick.dir;
        steps[index] = pick.step;
        const at = world(calloutAt(job.at, pick.dir, calloutFeet(pick.step)), zoom);
        taken.push(rectAt(at.x, at.y, size.w, size.h));
      });
    }
    linePatch.set(id, { callout: useCallout, calloutDirs: dirs, calloutSteps: steps });
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
