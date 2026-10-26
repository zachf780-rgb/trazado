import type { CableType, LineFeature, LineKind, PedType, PointFeature, PointKind, Tool, VaultType } from "./types";
import { LINE_KINDS, POINT_KINDS } from "./types";
import { cableEntries, legendFeet } from "./geo";

export const LINE_WIDTH = 3;
export const DROP_WIDTH = 1.5;

export function lineWidth(kind: LineKind): number {
  if (kind === "drop") return DROP_WIDTH;
  if (kind === "road") return 12;
  return LINE_WIDTH;
}

export function lineOpacity(kind: LineKind): number {
  return kind === "road" ? 0.5 : 1;
}

export const OBJECT_SMALL = 0.62;

export function canResize(kind: PointKind): boolean {
  return kind === "pedestal" || kind === "vault" || kind === "mdu" || kind === "pole";
}

export function objectScale(size: string | undefined): number {
  return size === "sm" ? OBJECT_SMALL : 1;
}

export const PED_TYPES: { id: Exclude<PedType, "">; letter: string; legend: string }[] = [
  { id: "s", letter: "S", legend: "small ped" },
  { id: "m", letter: "M", legend: "Medium LE ped" },
  { id: "l", letter: "L", legend: "Large amp ped" },
  { id: "dh", letter: "DH", legend: "Doghouse ped" },
  { id: "dd", letter: "DD", legend: "double door node ped" },
];

export function isPedType(value: unknown): value is Exclude<PedType, ""> {
  return PED_TYPES.some((type) => type.id === value);
}

export function pedLegend(type: Exclude<PedType, "">): string {
  return PED_TYPES.find((item) => item.id === type)?.legend ?? "ped";
}

/** Typed peds are smaller than the plain 22px square. Rotation is 0–7, in 45° steps. */
export function pedestalBody(type: PedType): { w: number; h: number } {
  if (type === "l") return { w: 26, h: 20 };
  if (type === "dh" || type === "dd") return { w: 36, h: 20 };
  if (type === "s" || type === "m") return { w: 17, h: 17 };
  return { w: 22, h: 22 };
}

export function pedestalDir(value: unknown): number {
  if (value === true) return 2;
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return ((Math.round(n) % 8) + 8) % 8;
}

export function pedestalPixels(type: PedType, dir: number): { w: number; h: number } {
  const body = pedestalBody(type);
  if (!pedestalRotates(type)) return body;
  const rad = (pedestalDir(dir) * Math.PI) / 4;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  return {
    w: Math.max(body.w, Math.ceil(body.w * c + body.h * s) + 2),
    h: Math.max(body.h, Math.ceil(body.w * s + body.h * c) + 2),
  };
}

export function pedestalColor(type: PedType): { fill: string; ink: string } {
  if (type === "m") return { fill: "#4f46e5", ink: "#ffffff" };
  if (type === "l") return { fill: "#a16207", ink: "#ffffff" };
  if (type === "dh") return { fill: "#0891b2", ink: "#ffffff" };
  if (type === "dd") return { fill: "#c026d3", ink: "#ffffff" };
  return { fill: "#f4f4f5", ink: "#111113" };
}

export function pedestalRotates(type: PedType): boolean {
  return type === "l" || type === "dh" || type === "dd";
}

export const VAULT_TYPES: { id: Exclude<VaultType, "">; legend: string }[] = [
  { id: "s", legend: "flower pot vault" },
];

export function isVaultType(value: unknown): value is Exclude<VaultType, ""> {
  return value === "s";
}

export function vaultPixels(): { w: number; h: number } {
  return { w: 16, h: 16 };
}

export function vaultColor(type: VaultType): { fill: string; ink: string } {
  if (type === "s") return { fill: "#a3e635", ink: "#111113" };
  return { fill: "#f4f4f5", ink: "#111113" };
}

export function pointIconScale(kind: PointKind): number {
  if (kind === "passing") return 0.45;
  if (kind === "pin") return 1.1;
  return 0.8;
}

export interface LinePreset {
  id: LineKind;
  label: string;
  short: string;
  fullLabel: string;
  color: string;
  kmlColor: string;
}

export interface PointPreset {
  id: PointKind;
  label: string;
  short: string;
  fullLabel: string;
}

export const LINE_PRESETS: LinePreset[] = [
  {
    id: "ug-new",
    label: "UG New",
    short: "UG",
    fullLabel: "Underground — New",
    color: "#22c55e",
    kmlColor: "ff5ec522",
  },
  {
    id: "ug-pull",
    label: "UG Pull",
    short: "Pull",
    fullLabel: "Underground — Pull Through",
    color: "#2563eb",
    kmlColor: "ffeb6325",
  },
  {
    id: "aerial-new",
    label: "Aerial",
    short: "Aer",
    fullLabel: "Aerial — New",
    color: "#ea580c",
    kmlColor: "ff0c58ea",
  },
  {
    id: "aerial-overlash",
    label: "Overlash",
    short: "Ovl",
    fullLabel: "Aerial — Overlash",
    color: "#db2777",
    kmlColor: "ff7727db",
  },
  {
    id: "drop",
    label: "Drop",
    short: "Drop",
    fullLabel: "Drop",
    color: "#f5d90a",
    kmlColor: "ff0ad9f5",
  },
];

export const CONDUIT_PRESETS: LinePreset[] = [
  {
    id: "in-4",
    label: "4 in",
    short: "4 in",
    fullLabel: "4 in",
    color: "#a855f7",
    kmlColor: "fff755a8",
  },
  {
    id: "in-2",
    label: "2 in",
    short: "2 in",
    fullLabel: "2 in",
    color: "#14b8a6",
    kmlColor: "ffa6b814",
  },
  {
    id: "in-075",
    label: "3/4 in",
    short: "3/4",
    fullLabel: "3/4 in",
    color: "#ef4444",
    kmlColor: "ff4444ef",
  },
];

export const GENERIC_LINE: LinePreset = {
  id: "line",
  label: "Line",
  short: "Line",
  fullLabel: "Line",
  color: "#d4d4d8",
  kmlColor: "ffd8d4d4",
};

export const ROAD_PRESET: LinePreset = {
  id: "road",
  label: "Road",
  short: "Road",
  fullLabel: "Road",
  color: "#c4c4cc",
  kmlColor: "80ccc4c4",
};

export const ALL_LINE_PRESETS: LinePreset[] = [
  ...LINE_PRESETS,
  ...CONDUIT_PRESETS,
  GENERIC_LINE,
  ROAD_PRESET,
];

export const POINT_PRESETS: PointPreset[] = [
  { id: "pedestal", label: "Ped", short: "P", fullLabel: "Pedestals" },
  { id: "vault", label: "Vault", short: "V", fullLabel: "Vaults" },
  { id: "mdu", label: "MDU", short: "MDU", fullLabel: "MDU Boxes" },
  { id: "pole", label: "Pole", short: "Pole", fullLabel: "Poles" },
  { id: "passing", label: "Pass", short: "Pass", fullLabel: "Passings" },
];

export const PIN_PRESET: PointPreset = {
  id: "pin",
  label: "Pin",
  short: "Pin",
  fullLabel: "Pins",
};

export const ALL_POINT_PRESETS: PointPreset[] = [...POINT_PRESETS, PIN_PRESET];

export function defaultPointName(kind: PointKind): string {
  if (kind === "pedestal") return "ped";
  if (kind === "mdu") return "MDU";
  if (kind === "pole") return "pole";
  return "";
}

export function isSnapTarget(kind: PointKind): boolean {
  return kind === "pedestal" || kind === "vault" || kind === "mdu" || kind === "pole";
}

export function snapTargetLabel(kind: PointKind, name: string): string {
  const trimmed = name.trim();
  if (trimmed) return trimmed;
  if (kind === "pedestal") return "ped";
  if (kind === "mdu") return "MDU";
  if (kind === "pole") return "pole";
  if (kind === "vault") return "vault";
  return "object";
}

export function pointLabelColor(kind: PointKind): string {
  if (kind === "passing") return "#facc15";
  if (kind === "mdu") return "#e8eaee";
  return "#f4f4f5";
}

export function emptyFootage(): Record<LineKind, number> {
  return {
    "ug-new": 0,
    "ug-pull": 0,
    "aerial-new": 0,
    "aerial-overlash": 0,
    drop: 0,
    "in-4": 0,
    "in-2": 0,
    "in-075": 0,
    line: 0,
    road: 0,
  };
}

export function emptyCounts(): Record<PointKind, number> {
  return {
    pedestal: 0,
    vault: 0,
    mdu: 0,
    pole: 0,
    passing: 0,
    pin: 0,
  };
}

export function isLineKind(value: string): value is LineKind {
  return (LINE_KINDS as string[]).includes(value);
}

export function isPointKind(value: string): value is PointKind {
  return (POINT_KINDS as string[]).includes(value);
}

export function allowedCables(kind: LineKind | undefined): CableType[] {
  const drop: CableType[] = ["rg6", "rg11", "rock", "flex"];
  const coax: CableType[] = ["625", "875", "fiber"];
  if (kind === "road") return [];
  if (kind === "drop") return drop;
  if (kind === "ug-pull") return [...coax, ...drop];
  return coax;
}

export function allowsEmpty(kind: LineKind | undefined): boolean {
  return kind !== "drop";
}

export function joinsAtEnds(kind: LineKind | undefined): boolean {
  return kind === "ug-new" || kind === "ug-pull" || kind === "drop";
}

const CABLE_LABEL: Record<CableType, string> = {
  "625": ".625",
  "875": ".875",
  fiber: "Fiber",
  rg6: "rg6",
  rg11: "rg11",
  rock: "rock drop",
  flex: "flex",
};

export function cableChoices(kind: LineKind): { id: CableType; label: string }[] {
  return allowedCables(kind).map((id) => ({ id, label: CABLE_LABEL[id] }));
}

export function plantTotals(
  lines: LineFeature[],
  points: Pick<PointFeature, "kind" | "riser" | "anchors" | "hideLegend" | "pedType" | "vaultType">[],
) {
  const footage = emptyFootage();
  const removeFootage = emptyFootage();
  let addPipe = 0;
  const ug = { "625": 0, "875": 0 };
  const ae = { "625": 0, "875": 0 };
  const other = { "625": 0, "875": 0 };
  const fiber = new Map<string, number>();
  const dropFeet: Record<"rg6" | "rg11" | "rock" | "flex", number> = {
    rg6: 0,
    rg11: 0,
    rock: 0,
    flex: 0,
  };
  for (const line of lines) {
    if (!isLineKind(line.kind) || line.kind === "road") continue;
    const feet = legendFeet(line);
    if (line.remove) {
      removeFootage[line.kind] += feet;
      continue;
    }
    footage[line.kind] += feet;
    if (line.parallel && line.kind === "ug-new") addPipe += feet;
    const bucket =
      line.kind === "ug-new" || line.kind === "ug-pull"
        ? ug
        : line.kind === "aerial-new" || line.kind === "aerial-overlash"
          ? ae
          : other;
    for (const entry of cableEntries(line)) {
      if (entry.cable === "fiber") {
        const count = entry.count.trim();
        fiber.set(count, (fiber.get(count) ?? 0) + feet);
      } else if (entry.cable === "625" || entry.cable === "875") bucket[entry.cable] += feet;
      else dropFeet[entry.cable] += feet;
    }
  }
  const counts = emptyCounts();
  const pedCounts: Record<Exclude<PedType, "">, number> = { s: 0, m: 0, l: 0, dh: 0, dd: 0 };
  const vaultCounts: Record<Exclude<VaultType, "">, number> = { s: 0 };
  let risers = 0;
  let anchors = 0;
  for (const point of points) {
    if (!isPointKind(point.kind)) continue;
    if (point.hideLegend) continue;
    if (point.kind === "pedestal" && isPedType(point.pedType)) {
      pedCounts[point.pedType] += 1;
    } else if (point.kind === "vault" && isVaultType(point.vaultType)) {
      vaultCounts[point.vaultType] += 1;
    } else {
      counts[point.kind] += 1;
    }
    if (point.kind === "pole" && point.riser) risers += 1;
    if (point.kind === "pole") anchors += point.anchors?.length ?? 0;
  }
  const usedLines = ALL_LINE_PRESETS.filter((p) => footage[p.id] > 0);
  const removeLines = ALL_LINE_PRESETS.filter((p) => removeFootage[p.id] > 0);
  const usedPoints = ALL_POINT_PRESETS.filter((p) => counts[p.id] > 0);
  const peds = PED_TYPES.filter((type) => pedCounts[type.id] > 0).map((type) => ({
    id: type.id,
    label: type.legend,
    count: pedCounts[type.id],
  }));
  const vaults = VAULT_TYPES.filter((type) => vaultCounts[type.id] > 0).map((type) => ({
    id: type.id,
    label: type.legend,
    count: vaultCounts[type.id],
  }));
  const grand = usedLines.reduce((n, p) => n + footage[p.id], 0);
  const coaxRows = (
    group: "ug" | "AE" | "",
    bucket: { "625": number; "875": number },
  ) =>
    (["625", "875"] as const)
      .filter((id) => bucket[id] > 0)
      .map((id) => ({
        id: `${group || "other"}-${id}`,
        label: `${group ? `${group} ` : ""}${id === "625" ? ".625" : ".875"}`,
        feet: bucket[id],
      }));
  const fiberRows = [...fiber.entries()]
    .filter(([, feet]) => feet > 0)
    .sort(([a], [b]) => {
      const na = Number(a);
      const nb = Number(b);
      if (a === "") return 1;
      if (b === "") return -1;
      if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
      return a.localeCompare(b);
    })
    .map(([count, feet]) => ({
      id: count ? `fiber-${count}` : "fiber",
      label: count ? `Fiber ${count}ct` : "Fiber",
      feet,
    }));
  const dropRows = (["rg6", "rg11", "rock", "flex"] as const)
    .filter((id) => dropFeet[id] > 0)
    .map((id) => ({ id, label: CABLE_LABEL[id], feet: dropFeet[id] }));
  const cables = [
    ...coaxRows("ug", ug),
    ...coaxRows("AE", ae),
    ...coaxRows("", other),
    ...fiberRows,
    ...dropRows,
  ];
  return { footage, removeFootage, counts, usedLines, removeLines, usedPoints, grand, addPipe, cables, risers, anchors, peds, vaults };
}

export function linePreset(kind: LineKind): LinePreset {
  return ALL_LINE_PRESETS.find((p) => p.id === kind) ?? GENERIC_LINE;
}

export function pointPreset(kind: PointKind): PointPreset {
  return ALL_POINT_PRESETS.find((p) => p.id === kind) ?? POINT_PRESETS[0]!;
}

export function isLineTool(tool: Tool): tool is LineKind {
  return isLineKind(tool);
}

export function isPointTool(tool: Tool): tool is PointKind {
  return isPointKind(tool);
}

export function tintHex(hex: string, towardWhite: number): string {
  const { r, g, b } = hexToRgb(hex);
  const mix = (n: number) => Math.round(n + (255 - n) * towardWhite);
  const part = (n: number) => Math.min(255, Math.max(0, mix(n))).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

export function hexToKmlColor(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  const part = (n: number) => n.toString(16).padStart(2, "0");
  return `ff${part(b)}${part(g)}${part(r)}`;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: Number.parseInt(h.slice(0, 2), 16) || 0,
    g: Number.parseInt(h.slice(2, 4), 16) || 0,
    b: Number.parseInt(h.slice(4, 6), 16) || 0,
  };
}

export function kmlColorToHex(kml: string): string {
  const s = kml.trim().toLowerCase();
  const padded = s.length === 6 ? `ff${s}` : s;
  if (padded.length < 8) return "#d4d4d8";
  const b = padded.slice(2, 4);
  const g = padded.slice(4, 6);
  const r = padded.slice(6, 8);
  return `#${r}${g}${b}`;
}

export function nearestLineKind(hex: string): LineKind {
  const c = hexToRgb(hex.startsWith("#") ? hex : kmlColorToHex(hex));
  let best: LineKind = "line";
  let bestD = Infinity;
  for (const p of ALL_LINE_PRESETS) {
    const q = hexToRgb(p.color);
    const d = (c.r - q.r) ** 2 + (c.g - q.g) ** 2 + (c.b - q.b) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p.id;
    }
  }
  return best;
}
