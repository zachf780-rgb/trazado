import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  Draft,
  LatLng,
  LineFeature,
  LabelSize,
  ObjectSize,
  OverlayFeature,
  PlantProject,
  PointFeature,
  PointKind,
  PolygonFeature,
  Selection,
  Tool,
  CableType,
  SlotChoice,
  NoteRef,
  NoteBoard,
  FrameFeature,
  LabelSide,
} from "./types";
import { EMPTY_PROJECT, LINE_KINDS, CABLE_IDS, isAerialOp, isCableType, type CableWork, type LineKind } from "./types";
import { uid } from "./utils";
import { constrainCardinal, footageSpans, haversineFeet, lineLossNote, normalizeBox, notesWithLoss, pathFootage, pathMidpoint, roundFeet } from "./geo";
import { optimizeLayout, layoutNotes } from "./optimize";
import { defaultPointName, allowedCables, allowsEmpty, canResize, isLineKind, isPedType, isPipeRole, isPointKind, isSnapTarget, isVaultType, pedestalDir } from "./presets";

const HISTORY_LIMIT = 60;

type Snapshot = Pick<PlantProject, "lines" | "points" | "polygons" | "overlays" | "notes" | "board" | "frames">;

export interface GpsFix {
  lat: number;
  lng: number;
  accuracy: number;
}

interface PlantState extends PlantProject {
  tool: Tool;
  selection: Selection | null;
  draft: Draft | null;
  pointer: LatLng | null;
  shift: boolean;
  hydrated: boolean;
  flyTo: { lat: number; lng: number; zoom: number } | null;
  searchMark: LatLng | null;
  gps: GpsFix | null;
  gpsFollow: boolean;
  snapAsk: string | null;
  lineSnap: { lineId: string; at: LatLng; kind: "end" | "cross"; click: LatLng; showDot: boolean; measureAt?: LatLng } | null;
  eggTool: boolean;
  eggPlacing: boolean;
  eggOpen: boolean;
  eggs: { id: string; lat: number; lng: number }[];
  unlockEgg: () => void;
  setEggPlacing: (on: boolean) => void;
  placeEgg: (at: LatLng) => void;
  openEgg: () => void;
  closeEgg: () => void;
  addNote: (at: LatLng, anchor: LatLng | null) => void;
  addRef: (target: { type: "line" | "point"; id: string }) => void;
  updateNote: (id: string, patch: Partial<Pick<NoteRef, "at" | "anchor" | "callout" | "text" | "side" | "span">>) => void;
  updateBoard: (patch: Partial<NoteBoard>) => void;
  addFrame: (frame: FrameFeature) => void;
  updateFrame: (id: string, patch: Partial<Omit<FrameFeature, "id">>) => void;
  placeSize: ObjectSize;
  setPlaceSize: (placeSize: ObjectSize) => void;
  labelPlate: boolean;
  setLabelPlate: (labelPlate: boolean) => void;
  labelSize: LabelSize;
  objectLabelSize: LabelSize;
  polygonLabelSize: LabelSize;
  lineInk: { color: string; weight: number };
  setLineInk: (ink: Partial<{ color: string; weight: number }>) => void;
  fontStep: number;
  setLabelSize: (labelSize: LabelSize) => void;
  setObjectLabelSize: (objectLabelSize: LabelSize) => void;
  setPolygonLabelSize: (polygonLabelSize: LabelSize) => void;
  setAllFonts: (target: "line" | "point" | "polygon", size: LabelSize) => void;
  optimizeLabels: () => boolean;
  past: Snapshot[];
  future: Snapshot[];
  setTool: (tool: Tool) => void;
  setShift: (shift: boolean) => void;
  setPointer: (ll: LatLng | null) => void;
  setView: (view: PlantProject["view"]) => void;
  setProjectName: (name: string) => void;
  setFlyTo: (ll: { lat: number; lng: number; zoom: number } | null) => void;
  setSearchMark: (ll: LatLng | null) => void;
  setGps: (gps: GpsFix | null) => void;
  setGpsFollow: (follow: boolean) => void;
  askSnap: (pointId: string) => void;
  confirmSnap: () => void;
  dismissSnap: () => void;
  askLineSnap: (hit: { lineId: string; at: LatLng; kind: "end" | "cross"; click: LatLng; showDot: boolean }) => void;
  confirmLineSnap: () => void;
  dismissLineSnap: (place: boolean) => void;
  setLineSnapDot: (showDot: boolean) => void;
  setLineDots: (lineId: string, show: boolean) => void;
  select: (sel: Selection | null) => void;
  clearSelection: () => void;
  addPoint: (kind: PointKind, position: LatLng) => void;
  extendDraft: (ll: LatLng, exact?: boolean) => void;
  startOverlay: (file: File) => Promise<void>;
  finishDraft: () => boolean;
  cancelDraft: () => void;
  moveLineVertex: (id: string, index: number, ll: LatLng) => void;
  movePoint: (id: string, ll: LatLng) => void;
  updateLine: (
    id: string,
    patch: Partial<
      Pick<LineFeature, "notes" | "name" | "parallel" | "joinEnds" | "intoSlot" | "cables" | "slot1" | "slot2" | "fiberCount" | "fiberCount2" | "fiberCounts" | "emptyPipe" | "remove" | "fiberUnit" | "overrideFootage" | "footageText" | "hideLegend" | "hideFootage" | "labelSize" | "pipeRoles" | "occupied" | "hideSpan" | "aerialMode" | "strandOnly" | "workOps" | "cableWork" | "wreckOut" | "callout" | "calloutDirs" | "calloutSteps" | "stroke" | "weight" | "existing" | "mark">
    >,
  ) => void;
  updatePoint: (id: string, patch: Partial<Pick<PointFeature, "name" | "description" | "labelSide" | "riser" | "anchors" | "remove" | "hideLegend" | "pedType" | "pedRotate" | "vaultType" | "size" | "labelSize">>) => void;
  updatePolygon: (
    id: string,
    patch: Partial<Pick<PolygonFeature, "name" | "description" | "stroke" | "fill" | "strokeOpacity" | "fillOpacity" | "labelSize">>,
  ) => void;
  updateOverlay: (id: string, patch: Partial<OverlayFeature>) => void;
  deleteSelection: () => void;
  replaceProject: (project: Partial<PlantProject> & Snapshot) => void;
  clearProject: () => void;
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;
  markHydrated: () => void;
}

function cloneSnap(s: Snapshot): Snapshot {
  return structuredClone({
    lines: s.lines,
    points: s.points,
    polygons: s.polygons,
    overlays: s.overlays,
    notes: s.notes ?? [],
    board: s.board ?? null,
    frames: s.frames ?? [],
  });
}

function commit(s: PlantState, next: Partial<Snapshot>): Partial<PlantState> {
  const past = [...s.past, cloneSnap(s)].slice(-HISTORY_LIMIT);
  return { ...next, past, future: [] };
}

function isCable(value: unknown): value is CableType {
  return isCableType(value);
}

function isSlot(value: unknown): value is Exclude<SlotChoice, ""> {
  return isCable(value) || value === "empty";
}

function countedCables(value: unknown, legacy: unknown, allowed: Set<string>, cap = 4): CableType[] {
  const raw = Array.isArray(value) ? value : legacy ? [legacy] : [];
  const counts = new Map<CableType, number>();
  for (const id of raw) {
    if (!isCable(id) || (allowed.size > 0 && !allowed.has(id))) continue;
    counts.set(id, Math.min(cap, (counts.get(id) ?? 0) + 1));
  }
  return CABLE_IDS.filter((id) => counts.has(id)).flatMap((id) => Array.from({ length: counts.get(id) ?? 0 }, () => id));
}

function countText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\D/g, "").slice(0, 4) : "";
}

function cableFields(line: Partial<LineFeature> & { cable?: unknown }): Pick<
  LineFeature,
  "cables" | "slot1" | "slot2" | "fiberCount" | "fiberCount2" | "fiberCounts"
> {
  const parallel = line.parallel === true;
  const allowed = new Set(allowedCables(line.kind));
  const counted = countedCables(line.cables, line.cable, line.kind ? allowed : new Set(CABLE_IDS), line.kind === "drop" ? 12 : 4);
  let slot1: SlotChoice = isSlot(line.slot1) ? line.slot1 : "";
  let slot2: SlotChoice = isSlot(line.slot2) ? line.slot2 : "";
  if (parallel && slot1 === "" && slot2 === "") {
    slot1 = counted.find((id) => allowed.has(id)) ?? "";
    slot2 = counted.filter((id) => allowed.has(id))[1] ?? "";
  }
  const emptyOk = !line.kind || allowsEmpty(line.kind);
  if (!emptyOk) {
    if (slot1 === "empty") slot1 = "";
    if (slot2 === "empty") slot2 = "";
  } else if (parallel && slot2 === "" && line.emptyPipe) {
    slot2 = "empty";
  }
  if (slot1 !== "" && slot1 !== "empty" && line.kind && !allowed.has(slot1)) slot1 = "";
  if (slot2 !== "" && slot2 !== "empty" && line.kind && !allowed.has(slot2)) slot2 = "";
  return {
    slot1: parallel ? slot1 : "",
    slot2: parallel ? slot2 : "",
    cables: parallel ? [slot1, slot2].filter(isCable) : counted,
    fiberCount: countText(line.fiberCount),
    fiberCount2: countText(line.fiberCount2),
    fiberCounts: counted.map((id, index) => (id === "fiber" ? countText(Array.isArray(line.fiberCounts) ? line.fiberCounts[index] : "") : "")),
  };
}

function aerialFields(line: Partial<LineFeature> & { kind: LineKind; calloutDir?: number }): Pick<LineFeature, "kind" | "aerialMode" | "strandOnly" | "workOps" | "cableWork" | "wreckOut" | "callout" | "calloutDirs" | "calloutSteps"> {
  let kind: LineKind = line.kind;
  let aerialMode: LineFeature["aerialMode"] = line.aerialMode === "work" ? "work" : "new";
  let workOps = Array.isArray(line.workOps) ? line.workOps.filter(isAerialOp) : [];
  if (kind === "aerial-overlash") {
    kind = "aerial-new";
    aerialMode = "work";
    if (workOps.length === 0) workOps = ["ol"];
  }
  const cableWork: CableWork[] = Array.isArray(line.cableWork)
    ? line.cableWork.map((item) => ({
        op: item && isAerialOp(item.op) ? item.op : "",
        existing: item ? item.existing !== false : true,
        wreck: item?.wreck === true,
      }))
    : [];
  const hasCable = (Array.isArray(line.cables) && line.cables.length > 0) || isCableType(line.slot1) || isCableType(line.slot2);
  const strandOnly = aerialMode === "new" && line.strandOnly === true && !hasCable;
  const fromList = Array.isArray(line.calloutDirs) ? line.calloutDirs : line.calloutDir != null ? [line.calloutDir] : [];
  const calloutDirs = fromList.map((value) => {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? ((n % 8) + 8) % 8 : 0;
  });
  const calloutSteps = (Array.isArray(line.calloutSteps) ? line.calloutSteps : []).map((value) => {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.max(0, Math.min(6, n)) : 0;
  });
  return {
    kind,
    aerialMode,
    strandOnly,
    workOps,
    cableWork,
    wreckOut: line.wreckOut === true,
    callout: line.callout === true,
    calloutDirs,
    calloutSteps,
  };
}

function stampLoss(line: LineFeature): LineFeature {
  return { ...line, notes: notesWithLoss(line.notes, lineLossNote(line)) };
}

function clampAnchorDir(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return ((Math.round(n) % 8) + 8) % 8;
}

function readAnchors(point: {
  kind?: string;
  anchors?: unknown;
  anchor?: unknown;
  anchorDir?: unknown;
}): number[] {
  if (point.kind !== "pole") return [];
  const raw = Array.isArray(point.anchors)
    ? point.anchors
    : point.anchor
      ? [point.anchorDir]
      : [];
  const dirs: number[] = [];
  for (const value of raw) {
    const dir = clampAnchorDir(value);
    if (!dirs.includes(dir)) dirs.push(dir);
  }
  return dirs.slice(0, 3);
}

function clampOpacity(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

function isLabelSize(value: unknown): value is LabelSize {
  return value === "xs" || value === "sm" || value === "md" || value === "lg" || value === "xl";
}

function objectSizeOf(kind: PointKind, raw: unknown): ObjectSize {
  if (raw === "std" || raw === "med" || raw === "big") return raw;
  if (kind === "vault") return raw === "xl" ? "big" : "med";
  if (raw === "xl") return "big";
  return "std";
}

function isLatLng(value: unknown): value is LatLng {
  if (!value || typeof value !== "object") return false;
  const v = value as LatLng;
  return Number.isFinite(v.lat) && Number.isFinite(v.lng);
}

function sanitizeProject(raw: Partial<PlantProject>): Snapshot & Pick<PlantProject, "projectName" | "view"> {
  const lines: LineFeature[] = [];
  for (const line of raw.lines ?? []) {
    if (!line || !isLineKind(line.kind) || !Array.isArray(line.path)) continue;
    const path = line.path.filter(isLatLng);
    if (path.length < 2) continue;
    lines.push(stampLoss({
      id: typeof line.id === "string" ? line.id : uid(),
      path,
      notes: typeof line.notes === "string" ? line.notes : "",
      parallel: line.parallel === true,
      joinEnds: line.joinEnds === true,
      intoSlot: line.intoSlot === 1 || line.intoSlot === 2 || line.intoSlot === 3 ? line.intoSlot : 0,
      ...cableFields(line),
      emptyPipe: line.emptyPipe === true && allowsEmpty(line.kind),
      remove: line.remove === true,
      fiberUnit: line.fiberUnit === "km" ? "km" : "ft",
      overrideFootage: line.overrideFootage === true,
      footageText: typeof line.footageText === "string" ? line.footageText : "",
      hideLegend: line.hideLegend === true,
      hideFootage: line.hideFootage === true,
      labelSize: isLabelSize(line.labelSize) ? line.labelSize : "md",
      name: typeof line.name === "string" ? line.name : "",
      splits: Array.isArray(line.splits) ? line.splits.filter(isLatLng) : [],
      dots: Array.isArray(line.dots)
        ? line.dots
            .filter((dot) => dot && isLatLng(dot.at) && typeof dot.peer === "string")
            .map((dot) => ({ at: dot.at, peer: dot.peer, show: dot.show !== false }))
        : [],
      snaps: Array.isArray(line.snaps) ? line.snaps.filter(isLatLng) : [],
      pipeRoles: Array.isArray(line.pipeRoles) ? line.pipeRoles.filter(isPipeRole) : [],
      occupied: line.occupied === true,
      hideSpan: line.hideSpan === true,
      stroke: line.kind === "line" && /^#[0-9a-f]{6}$/i.test(line.stroke ?? "") ? line.stroke : "",
      weight: line.kind === "line" && (line.weight === 1.5 || line.weight === 3 || line.weight === 6) ? line.weight : 0,
      existing: line.kind === "line" && line.existing === true,
      mark: line.kind === "line" && (line.mark === "ae" || line.mark === "ug") ? line.mark : "",
      ...aerialFields(line),
    }));
  }
  const points: PointFeature[] = [];
  for (const point of raw.points ?? []) {
    if (!point || !isPointKind(point.kind) || !isLatLng(point.position)) continue;
    points.push({
      id: typeof point.id === "string" ? point.id : uid(),
      kind: point.kind,
      position: point.position,
      name:
        point.kind === "vault" && isVaultType(point.vaultType) && point.vaultType === "s" && !(typeof point.name === "string" && point.name.trim())
          ? "flower pot"
          : typeof point.name === "string"
            ? point.name
            : defaultPointName(point.kind),
      description: typeof point.description === "string" ? point.description : "",
      labelSide:
        point.labelSide === "bottom" ||
        point.labelSide === "left" ||
        point.labelSide === "right" ||
        point.labelSide === "top"
          ? point.labelSide
          : "top",
      riser: point.kind === "pole" && point.riser === true,
      anchors: readAnchors(point),
      remove: point.remove === true,
      hideLegend: point.hideLegend === true,
      pedType: point.kind === "pedestal" && isPedType(point.pedType) ? point.pedType : "",
      pedRotate: point.kind === "pedestal" ? pedestalDir(point.pedRotate) : 0,
      vaultType: point.kind === "vault" && isVaultType(point.vaultType) ? point.vaultType : "",
      size: objectSizeOf(point.kind, point.size),
      labelSize:
        point.kind === "passing" && point.labelSize !== "sm" && point.labelSize !== "xl"
          ? "lg"
          : point.labelSize === "sm" || point.labelSize === "md" || point.labelSize === "lg" || point.labelSize === "xl"
            ? point.labelSize
            : "lg",
    });
  }
  const polygons: PolygonFeature[] = [];
  for (const poly of raw.polygons ?? []) {
    if (!poly || !Array.isArray(poly.path)) continue;
    const path = poly.path.filter(isLatLng);
    if (path.length < 3) continue;
    polygons.push({
      id: typeof poly.id === "string" ? poly.id : uid(),
      path,
      name: typeof poly.name === "string" ? poly.name : "Polygon",
      description: typeof poly.description === "string" ? poly.description : "",
      stroke: /^#[0-9a-f]{6}$/i.test(poly.stroke ?? "") ? poly.stroke : "#a1a1aa",
      fill: /^#[0-9a-f]{6}$/i.test(poly.fill ?? "") ? poly.fill : "#64748b",
      strokeOpacity: clampOpacity(poly.strokeOpacity, 1),
      fillOpacity: clampOpacity(poly.fillOpacity, 0.25),
      labelSize: isLabelSize(poly.labelSize) ? poly.labelSize : "sm",
    });
  }
  const overlays: OverlayFeature[] = [];
  for (const ov of raw.overlays ?? []) {
    if (!ov || typeof ov.dataUrl !== "string") continue;
    if (![ov.south, ov.west, ov.north, ov.east].every((n) => Number.isFinite(n))) continue;
    overlays.push({
      id: typeof ov.id === "string" ? ov.id : uid(),
      name: typeof ov.name === "string" ? ov.name : "Overlay",
      description: typeof ov.description === "string" ? ov.description : "",
      dataUrl: ov.dataUrl,
      south: ov.south,
      west: ov.west,
      north: ov.north,
      east: ov.east,
      opacity: Number.isFinite(ov.opacity) ? ov.opacity : 0.85,
      rotation: Number.isFinite(ov.rotation) ? ((Math.round(ov.rotation) % 360) + 360) % 360 : 0,
    });
  }
  const notes: NoteRef[] = [];
  const used = new Set<number>();
  for (const note of raw.notes ?? []) {
    if (!note || !isLatLng(note.at)) continue;
    const n = Math.round(Number(note.n));
    if (!Number.isFinite(n) || n < 1 || used.has(n)) continue;
    used.add(n);
    notes.push({
      id: typeof note.id === "string" ? note.id : uid(),
      n,
      at: note.at,
      anchor: isLatLng(note.anchor) ? note.anchor : null,
      callout: note.callout === true,
      text: typeof note.text === "string" ? note.text : "",
      side: note.side === "bottom" || note.side === "left" || note.side === "right" ? note.side : "top",
      span: Number.isFinite(note.span) ? Math.max(0, Math.round(note.span)) : 0,
      target: note.target && (note.target.type === "line" || note.target.type === "point") && typeof note.target.id === "string" ? { type: note.target.type, id: note.target.id } : null,
    });
  }
  const boardRaw = raw.board as (Partial<NoteBoard> & { lat?: number; lng?: number; w?: number; h?: number; x?: number; y?: number }) | null | undefined;
  const opacity = boardRaw && [0, 0.25, 0.5, 0.75, 1].includes(Number(boardRaw.opacity)) ? Number(boardRaw.opacity) : 1;
  const opened = boardRaw?.opened === true || notes.some((note) => note.text.trim().length > 0);
  const board: NoteBoard | null = !boardRaw
    ? null
    : [boardRaw.south, boardRaw.west, boardRaw.north, boardRaw.east].every((n) => Number.isFinite(n))
      ? { south: boardRaw.south as number, west: boardRaw.west as number, north: boardRaw.north as number, east: boardRaw.east as number, opacity, opened }
      : null;
  const frames: FrameFeature[] = [];
  for (const frame of raw.frames ?? []) {
    if (!frame || ![frame.south, frame.west, frame.north, frame.east].every((n) => Number.isFinite(n))) continue;
    const legacy = frame as FrameFeature & { lat?: number; lng?: number; zoom?: number };
    const spanLat = Math.max(Math.abs(frame.north - frame.south), 0.00005);
    const spanLng = Math.max(Math.abs(frame.east - frame.west), 0.00005);
    frames.push({
      id: typeof frame.id === "string" ? frame.id : uid(),
      south: frame.south,
      west: frame.west,
      north: frame.north,
      east: frame.east,
      viewSouth: Number.isFinite(frame.viewSouth) ? frame.viewSouth : Math.min(frame.south, frame.north),
      viewNorth: Number.isFinite(frame.viewNorth) ? frame.viewNorth : Math.max(frame.south, frame.north),
      viewWest: Number.isFinite(frame.viewWest) ? frame.viewWest : Math.max(frame.west, frame.east) + spanLng * 0.15,
      viewEast: Number.isFinite(frame.viewEast) ? frame.viewEast : Math.max(frame.west, frame.east) + spanLng * 0.15 + spanLng,
      closer: Number.isFinite(frame.closer) ? Math.min(3, Math.max(0, frame.closer)) : Number.isFinite(legacy.zoom) ? 0.3 : 0.3,
      liftLabels: frame.liftLabels === true,
      linkColor: /^#[0-9a-f]{6}$/i.test(frame.linkColor ?? "") ? frame.linkColor : "#f5d90a",
    });
  }
  for (const line of lines) {
    if (line.snaps.length > 0) continue;
    line.snaps = points
      .filter((point) => point.kind === "pedestal" || point.kind === "vault" || point.kind === "mdu" || point.kind === "pole")
      .map((point) => point.position)
      .filter((gear) => line.path.some((vertex) => haversineFeet(vertex, gear) <= 0.5));
  }
  const view = raw.view;
  return {
    projectName:
      typeof raw.projectName === "string" && raw.projectName.trim()
        ? raw.projectName
        : "Untitled plant",
    lines,
    points,
    polygons,
    overlays,
    notes,
    board,
    frames,
    view:
      view && Number.isFinite(view.lat) && Number.isFinite(view.lng) && Number.isFinite(view.zoom)
        ? view
        : EMPTY_PROJECT.view,
  };
}

function lineSpanAt(line: LineFeature, points: PointFeature[], index: number): { at: LatLng; count: number; span: number } | null {
  const gear = points.filter((point) => point.kind === "pedestal" || point.kind === "vault" || point.kind === "mdu" || point.kind === "pole").map((point) => point.position);
  const spans = footageSpans(line.path, gear, line.splits ?? [], (line.dots ?? []).map((dot) => dot.at));
  if (spans.length === 0) {
    const mid = pathMidpoint(line.path);
    return mid ? { at: mid, count: 1, span: 0 } : null;
  }
  const span = Math.max(0, Math.min(spans.length - 1, index));
  return { at: spans[span]?.labelAt ?? spans[0]!.labelAt, count: spans.length, span };
}

function beside(anchor: LatLng, side: LabelSide, zoom: number): LatLng {
  const step = (360 / 2 ** (Number.isFinite(zoom) ? zoom : 18)) * 0.05;
  if (side === "bottom") return { lat: anchor.lat - step, lng: anchor.lng };
  if (side === "left") return { lat: anchor.lat, lng: anchor.lng - step };
  if (side === "right") return { lat: anchor.lat, lng: anchor.lng + step };
  return { lat: anchor.lat + step, lng: anchor.lng };
}

function defaultBoard(view: { lat: number; lng: number; zoom: number }): NoteBoard {
  const world = 256 * 2 ** (Number.isFinite(view.zoom) ? view.zoom : 18);
  const cos = Math.max(0.2, Math.abs(Math.cos((view.lat * Math.PI) / 180)));
  const dLng = (150 / world) * 360;
  const dLat = (26 / world) * 360 * cos;
  const north = view.lat + (90 / world) * 360 * cos;
  const west = view.lng - (220 / world) * 360;
  return { south: north - dLat, north, west, east: west + dLng, opacity: 1, opened: false };
}

export const usePlantStore = create<PlantState>()(
  persist(
    (set, get) => ({
      ...EMPTY_PROJECT,
      tool: "select",
      selection: null,
      draft: null,
      pointer: null,
      shift: false,
      hydrated: false,
      flyTo: null,
      searchMark: null,
      gps: null,
      gpsFollow: false,
      snapAsk: null,
      lineSnap: null,
      eggTool: false,
      eggPlacing: false,
      eggOpen: false,
      eggs: [],
      placeSize: "med",
      labelPlate: false,
      labelSize: "md",
      objectLabelSize: "lg",
      polygonLabelSize: "sm",
      lineInk: { color: "#ffffff", weight: 3 },
      fontStep: 2,
      past: [],
      future: [],

      markHydrated: () => {
        const s = get();
        const clean = sanitizeProject(s);
        const reset = s.fontStep !== 2;
        set({
          ...clean,
          hydrated: true,
          draft: null,
          selection: null,
          fontStep: 2,
          labelSize: reset ? "md" : isLabelSize(s.labelSize) ? s.labelSize : "md",
          polygonLabelSize: isLabelSize(s.polygonLabelSize) ? s.polygonLabelSize : "sm",
        });
      },
      setTool: (tool) =>
        set({
          tool,
          eggPlacing: false,
          draft: null,
          pointer: null,
          snapAsk: null,
          lineSnap: null,
          selection: tool === "select" ? get().selection : null,
        }),
      unlockEgg: () => set({ eggTool: true }),
      setEggPlacing: (eggPlacing) =>
        set({
          eggPlacing,
          tool: "select",
          draft: null,
          pointer: null,
          snapAsk: null,
          lineSnap: null,
          selection: null,
        }),
      placeEgg: (at) => set({ eggs: [...get().eggs, { id: uid(), lat: at.lat, lng: at.lng }] }),
      openEgg: () => set({ eggOpen: true }),
      closeEgg: () => set({ eggOpen: false }),
      addNote: (at, anchor) => {
        if (!isLatLng(at)) return;
        const s = get();
        const n = s.notes.reduce((max, note) => Math.max(max, note.n), 0) + 1;
        const note: NoteRef = { id: uid(), n, at, anchor: isLatLng(anchor) ? anchor : null, callout: false, text: "", side: "top", span: 0, target: null };
        const board = s.board ?? defaultBoard(s.view);
        set({
          ...commit(s, { notes: [...s.notes, note], board }),
          selection: { type: "note", id: note.id },
        });
      },
      addRef: (target) => {
        const s = get();
        let anchor: LatLng | null = null;
        let span = 0;
        if (target.type === "point") anchor = s.points.find((point) => point.id === target.id)?.position ?? null;
        else {
          const line = s.lines.find((item) => item.id === target.id);
          const placed = line ? lineSpanAt(line, s.points, 0) : null;
          anchor = placed?.at ?? null;
          span = placed?.span ?? 0;
        }
        if (!anchor) return;
        const n = s.notes.reduce((max, note) => Math.max(max, note.n), 0) + 1;
        const note: NoteRef = {
          id: uid(),
          n,
          at: beside(anchor, "top", s.view.zoom),
          anchor,
          callout: false,
          text: "",
          side: "top",
          span,
          target,
        };
        set({
          ...commit(s, { notes: [...s.notes, note], board: s.board ?? defaultBoard(s.view) }),
          selection: { type: "note", id: note.id },
        });
      },
      updateNote: (id, patch) =>
        set({
          notes: get().notes.map((note) => {
            if (note.id !== id) return note;
            const side = patch.side ?? note.side ?? "top";
            let span = patch.span ?? note.span ?? 0;
            let anchor = patch.anchor === null ? null : patch.anchor ?? note.anchor;
            if (patch.span != null && note.target?.type === "line") {
              const line = get().lines.find((item) => item.id === note.target?.id);
              const placed = line ? lineSpanAt(line, get().points, patch.span) : null;
              if (placed) {
                span = placed.span;
                anchor = placed.at;
              }
            }
            const moved = patch.side != null || patch.span != null;
            return {
              ...note,
              ...patch,
              side,
              span,
              anchor,
              at: patch.at ?? (moved && anchor ? beside(anchor, side, get().view.zoom) : note.at),
            };
          }),
        }),
      updateBoard: (patch) => {
        const board = get().board;
        if (!board) return;
        set({ board: { ...board, ...patch } });
      },
      addFrame: (frame) => {
        const s = get();
        set({
          ...commit(s, { frames: [...s.frames, frame] }),
          draft: null,
          pointer: null,
          selection: { type: "frame", id: frame.id },
          tool: "select",
        });
      },
      updateFrame: (id, patch) =>
        set({
          frames: get().frames.map((frame) => (frame.id === id ? { ...frame, ...patch } : frame)),
        }),
      setShift: (shift) => set({ shift }),
      setPointer: (pointer) => set({ pointer }),
      setView: (view) => set({ view }),
      setProjectName: (projectName) => set({ projectName }),
      setFlyTo: (flyTo) => set({ flyTo }),
      setSearchMark: (searchMark) => set({ searchMark }),
      setGps: (gps) => set({ gps }),
      setGpsFollow: (gpsFollow) => set({ gpsFollow }),
      askSnap: (pointId) => {
        const point = get().points.find((p) => p.id === pointId);
        if (!point || !isSnapTarget(point.kind) || !isLineKind(get().tool)) return;
        set({ snapAsk: pointId });
      },
      confirmSnap: () => {
        const s = get();
        const point = s.points.find((p) => p.id === s.snapAsk);
        set({ snapAsk: null });
        if (!point || !isSnapTarget(point.kind) || !isLineKind(get().tool)) return;
        get().extendDraft(point.position, true);
      },
      dismissSnap: () => set({ snapAsk: null }),
      askLineSnap: (hit) => {
        if (!isLineKind(get().tool)) return;
        set({ lineSnap: { ...hit, showDot: true }, snapAsk: null });
      },
      setLineSnapDot: (showDot) => {
        const ask = get().lineSnap;
        if (ask) set({ lineSnap: { ...ask, showDot } });
      },
      confirmLineSnap: () => {
        const s = get();
        const ask = s.lineSnap;
        if (!ask || !isLineKind(s.tool)) {
          set({ lineSnap: null });
          return;
        }
        const kind = s.tool;
        const pending = {
          at: ask.at,
          targetId: ask.lineId,
          kind: ask.kind,
          showDot: ask.showDot,
          measureAt: ask.measureAt,
        };
        if (!s.draft || s.draft.mode !== "line") {
          set({
            lineSnap: null,
            selection: null,
            draft: { mode: "line", kind, path: [ask.at], declined: [], pending: [pending], snaps: [] },
          });
          return;
        }
        set({
          lineSnap: null,
          draft: {
            ...s.draft,
            path: [...s.draft.path, ask.at],
            pending: [...s.draft.pending, pending],
          },
        });
      },
      dismissLineSnap: (place) => {
        const s = get();
        const ask = s.lineSnap;
        if (!ask || !place || !isLineKind(s.tool)) {
          set({ lineSnap: null });
          return;
        }
        const kind = s.tool;
        const declined = { lineId: ask.lineId, at: ask.at };
        if (!s.draft || s.draft.mode !== "line") {
          set({
            lineSnap: null,
            selection: null,
            draft: { mode: "line", kind, path: [ask.click], declined: [declined], pending: [], snaps: [] },
          });
          return;
        }
        set({
          lineSnap: null,
          draft: {
            ...s.draft,
            path: [...s.draft.path, ask.click],
            declined: [...s.draft.declined, declined],
          },
        });
      },
      setLineDots: (lineId, show) => {
        const lines = get().lines.map((line) => ({ ...line, dots: (line.dots ?? []).map((dot) => ({ ...dot })) }));
        const mine = lines.find((line) => line.id === lineId);
        if (!mine) return;
        for (const dot of mine.dots) {
          dot.show = show;
          const peer = lines.find((line) => line.id === dot.peer);
          const match = peer?.dots.find((other) => haversineFeet(other.at, dot.at) < 4 && other.peer === lineId);
          if (match) match.show = show;
        }
        set({ lines });
      },
      setPlaceSize: (placeSize) => set({ placeSize }),
      setLabelPlate: (labelPlate) => set({ labelPlate }),
      setLabelSize: (labelSize) => set({ labelSize: isLabelSize(labelSize) ? labelSize : "md" }),
      setObjectLabelSize: (objectLabelSize) => set({ objectLabelSize }),
      setPolygonLabelSize: (polygonLabelSize) => set({ polygonLabelSize: isLabelSize(polygonLabelSize) ? polygonLabelSize : "sm" }),
      setLineInk: (ink) => {
        const current = get().lineInk;
        const color = /^#[0-9a-f]{6}$/i.test(ink.color ?? "") ? (ink.color as string) : current.color;
        const weight = ink.weight === 1.5 || ink.weight === 3 || ink.weight === 6 ? ink.weight : current.weight;
        set({ lineInk: { color, weight } });
      },
      setAllFonts: (target, size) => {
        const s = get();
        if (target === "line") {
          const labelSize = size === "xs" ? "sm" : size;
          set({
            ...commit(s, { lines: s.lines.map((line) => ({ ...line, labelSize })) }),
            labelSize,
          });
          return;
        }
        if (target === "polygon") {
          const labelSize = size === "xs" ? "sm" : size;
          set({
            ...commit(s, { polygons: s.polygons.map((poly) => ({ ...poly, labelSize })) }),
            polygonLabelSize: labelSize,
          });
          return;
        }
        const labelSize = size === "xs" ? "lg" : size;
        set({
          ...commit(s, { points: s.points.map((point) => ({ ...point, labelSize })) }),
          objectLabelSize: labelSize,
        });
      },
      optimizeLabels: () => {
        const s = get();
        const next = optimizeLayout(s.lines, s.points, s.view);
        const refs = layoutNotes(s.notes, s.lines, s.points, s.view);
        if (!next && !refs) return false;
        set(commit(s, { lines: next?.lines ?? s.lines, points: next?.points ?? s.points, ...(refs ?? {}) }));
        return true;
      },
      select: (selection) => set({ selection, tool: "select", draft: null }),
      clearSelection: () => set({ selection: null }),

      addPoint: (kind, position) => {
        if (!isPointKind(kind) || !isLatLng(position)) return;
        const s = get();
        const point: PointFeature = {
          id: uid(),
          kind,
          position,
          name: defaultPointName(kind),
          description: "",
          labelSide: "top",
          riser: false,
          anchors: [],
          remove: false,
          hideLegend: false,
          pedType: "",
          pedRotate: 0,
          vaultType: "",
          size: !canResize(kind) ? "med" : kind === "pedestal" || kind === "vault" ? (s.placeSize === "std" || s.placeSize === "big" || s.placeSize === "med" ? s.placeSize : "med") : s.placeSize === "big" ? "big" : "std",
          labelSize: s.objectLabelSize === "sm" || s.objectLabelSize === "md" || s.objectLabelSize === "xl" ? s.objectLabelSize : "lg",
        };
        set({
          ...commit(s, { points: [...s.points, point] }),
          selection: { type: "point", id: point.id },
        });
      },

      extendDraft: (raw, exact = false) => {
        if (!isLatLng(raw)) return;
        const s = get();
        const tool = s.tool;
        let ll = raw;
        const last =
          s.draft && "path" in s.draft
            ? s.draft.path[s.draft.path.length - 1]
            : s.draft?.mode === "overlay"
              ? s.draft.a
              : null;
        if (!exact && s.shift && last) ll = constrainCardinal(last, raw);

        if (tool === "polygon") {
          if (!s.draft || s.draft.mode !== "polygon") {
            set({ draft: { mode: "polygon", path: [ll] }, selection: null });
            return;
          }
          set({ draft: { mode: "polygon", path: [...s.draft.path, ll] } });
          return;
        }

        if (tool === "frame") {
          set({ draft: { mode: "frame", a: ll }, selection: null });
          return;
        }

        if (tool === "overlay") {
          if (!s.draft || s.draft.mode !== "overlay") return;
          if (!s.draft.a) {
            set({ draft: { ...s.draft, a: ll } });
            return;
          }
          const box = normalizeBox(s.draft.a, ll);
          const overlay: OverlayFeature = {
            id: uid(),
            name: s.draft.name,
            description: "",
            dataUrl: s.draft.dataUrl,
            ...box,
            opacity: 1,
            rotation: 0,
          };
          set({
            ...commit(s, { overlays: [...s.overlays, overlay] }),
            draft: null,
            pointer: null,
            selection: { type: "overlay", id: overlay.id },
            tool: "select",
          });
          return;
        }

        if (LINE_KINDS.includes(tool as LineFeature["kind"])) {
          const kind = tool as LineFeature["kind"];
          if (!s.draft || s.draft.mode !== "line") {
            set({
              draft: { mode: "line", kind, path: [ll], declined: [], pending: [], snaps: exact ? [ll] : [] },
              selection: null,
            });
            return;
          }
          set({
            draft: { mode: "line", kind: s.draft.kind, path: [...s.draft.path, ll], declined: s.draft.declined, pending: s.draft.pending, snaps: exact ? [...s.draft.snaps, ll] : s.draft.snaps },
          });
        }
      },

      startOverlay: async (file) => {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        set({
          tool: "overlay",
          draft: {
            mode: "overlay",
            name: file.name.replace(/\.[^.]+$/, "") || "Overlay",
            dataUrl,
            a: null,
          },
          selection: null,
        });
      },

      finishDraft: () => {
        const s = get();
        const d = s.draft;
        if (!d) return false;
        if (d.mode === "line") {
          let path = d.path.filter(isLatLng);
          if (path.length >= 3) {
            const last = path[path.length - 1];
            const prev = path[path.length - 2];
            if (last && prev && haversineFeet(last, prev) < 2) {
              path = path.slice(0, -1);
            }
          }
          if (path.length < 2) return false;
          const measured = path.map((point) => {
            const swap = d.pending.find((join) => join.measureAt && haversineFeet(join.at, point) < 2);
            return swap?.measureAt && haversineFeet(swap.measureAt, point) >= 1 ? swap.measureAt : point;
          });
          const overridden = measured.some((point, index) => point !== path[index]);
          const created: LineFeature = stampLoss({
            id: uid(),
            kind: d.kind,
            path,
            notes: "",
            parallel: false,
            joinEnds: false,
            intoSlot: 0,
            cables: [],
            slot1: "",
            slot2: "",
            fiberCount: "",
            fiberCount2: "",
            fiberCounts: [],
            emptyPipe: false,
            remove: false,
            fiberUnit: "ft",
            overrideFootage: overridden,
            footageText: overridden ? String(roundFeet(pathFootage(measured))) : "",
            hideLegend: false,
            hideFootage: false,
            labelSize: isLabelSize(s.labelSize) ? s.labelSize : "md",
            name: "",
            splits: [],
            dots: d.pending.map((join) => ({ at: join.at, peer: join.targetId, show: join.showDot })),
            snaps: d.snaps ?? [],
            pipeRoles: [],
            occupied: false,
            hideSpan: false,
            aerialMode: "new",
            strandOnly: false,
            workOps: [],
            cableWork: [],
            wreckOut: false,
            callout: false,
            calloutDirs: [],
            calloutSteps: [],
            stroke: d.kind === "line" ? s.lineInk.color : "",
            weight: d.kind === "line" ? s.lineInk.weight : 0,
            existing: false,
            mark: "",
          });
          const lines = s.lines.map((existing) => {
            const joins = d.pending.filter((join) => join.targetId === existing.id);
            if (joins.length === 0) return existing;
            return {
              ...existing,
              dots: [...(existing.dots ?? []), ...joins.map((join) => ({ at: join.at, peer: created.id, show: join.showDot }))],
              splits: [...(existing.splits ?? []), ...joins.filter((join) => join.kind === "cross").map((join) => join.measureAt ?? join.at)],
            };
          });
          set({
            ...commit(s, { lines: [...lines, created] }),
            draft: null,
            pointer: null,
            snapAsk: null,
            lineSnap: null,
            selection: { type: "line", id: created.id },
          });
          return true;
        }
        if (d.mode === "polygon") {
          const path = d.path.filter(isLatLng);
          if (path.length < 3) return false;
          const polygon: PolygonFeature = {
            id: uid(),
            path,
            name: `Polygon ${s.polygons.length + 1}`,
            description: "",
            stroke: "#a1a1aa",
            fill: "#64748b",
            strokeOpacity: 1,
            fillOpacity: 0.25,
            labelSize: isLabelSize(s.polygonLabelSize) ? s.polygonLabelSize : "sm",
          };
          set({
            ...commit(s, { polygons: [...s.polygons, polygon] }),
            draft: null,
            pointer: null,
            selection: { type: "polygon", id: polygon.id },
            tool: "select",
          });
          return true;
        }
        return false;
      },

      cancelDraft: () => set({ draft: null, pointer: null, snapAsk: null, lineSnap: null }),

      moveLineVertex: (id, index, ll) => {
        if (!isLatLng(ll)) return;
        const lines = get().lines;
        const current = lines.find((line) => line.id === id);
        const from = current?.path[index];
        set({
          lines: lines.map((line) => {
            if (line.id === id) {
              const next = stampLoss({
                ...line,
                path: line.path.map((p, i) => (i === index ? ll : p)),
                dots: (line.dots ?? []).map((dot) => (from && haversineFeet(dot.at, from) < 4 ? { ...dot, at: ll } : dot)),
              });
              return next;
            }
            if (!from) return line;
            return {
              ...line,
              dots: (line.dots ?? []).map((dot) => (dot.peer === id && haversineFeet(dot.at, from) < 4 ? { ...dot, at: ll } : dot)),
              splits: (line.splits ?? []).map((at) => (haversineFeet(at, from) < 4 ? ll : at)),
            };
          }),
        });
      },

      movePoint: (id, ll) => {
        if (!isLatLng(ll)) return;
        set({
          points: get().points.map((p) =>
            p.id === id ? { ...p, position: ll } : p,
          ),
        });
      },

      updateLine: (id, patch) =>
        set({
          lines: get().lines.map((l) => (l.id === id ? stampLoss({ ...l, ...patch }) : l)),
        }),
      updatePoint: (id, patch) =>
        set({
          points: get().points.map((p) =>
            p.id === id
              ? {
                  ...p,
                  ...patch,
                  anchors: patch.anchors ? readAnchors({ ...p, ...patch }) : p.anchors,
                }
              : p,
          ),
        }),
      updatePolygon: (id, patch) =>
        set({
          polygons: get().polygons.map((p) =>
            p.id === id ? { ...p, ...patch } : p,
          ),
        }),
      updateOverlay: (id, patch) =>
        set({
          overlays: get().overlays.map((o) =>
            o.id === id ? { ...o, ...patch } : o,
          ),
        }),

      deleteSelection: () => {
        const s = get();
        const sel = s.selection;
        if (!sel) return;
        if (sel.type === "line") {
          set({
            ...commit(s, {
              lines: s.lines
                .filter((line) => line.id !== sel.id)
                .map((line) => ({
                  ...line,
                  dots: (line.dots ?? []).filter((dot) => dot.peer !== sel.id),
                  splits: (line.splits ?? []).filter((at) => !(s.lines.find((item) => item.id === sel.id)?.dots ?? []).some((dot) => dot.peer === line.id && haversineFeet(dot.at, at) < 4)),
                })),
            }),
            selection: null,
          });
        } else if (sel.type === "point") {
          set({
            ...commit(s, { points: s.points.filter((p) => p.id !== sel.id) }),
            selection: null,
          });
        } else if (sel.type === "polygon") {
          set({
            ...commit(s, {
              polygons: s.polygons.filter((p) => p.id !== sel.id),
            }),
            selection: null,
          });
        } else if (sel.type === "note") {
          set({
            ...commit(s, { notes: s.notes.filter((note) => note.id !== sel.id) }),
            selection: null,
          });
        } else if (sel.type === "frame") {
          set({
            ...commit(s, { frames: s.frames.filter((frame) => frame.id !== sel.id) }),
            selection: null,
          });
        } else if (sel.type === "callout") {
          set({
            ...commit(s, { lines: s.lines.map((line) => (line.id === sel.id ? { ...line, callout: false } : line)) }),
            selection: null,
          });
        } else if (sel.type === "board") {
          set({
            ...commit(s, { board: null }),
            selection: null,
          });
        } else if (sel.type === "overlay") {
          set({
            ...commit(s, {
              overlays: s.overlays.filter((o) => o.id !== sel.id),
            }),
            selection: null,
          });
        }
      },

      replaceProject: (project) => {
        const s = get();
        const clean = sanitizeProject({ ...s, ...project });
        set({
          ...commit(s, {
            lines: clean.lines,
            points: clean.points,
            polygons: clean.polygons,
            overlays: clean.overlays,
            notes: clean.notes,
            board: clean.board,
            frames: clean.frames,
          }),
          projectName: clean.projectName,
          view: project.view ?? s.view,
          selection: null,
          draft: null,
        });
      },

      clearProject: () => {
        const s = get();
        set({
          ...commit(s, {
            lines: [],
            points: [],
            polygons: [],
            overlays: [],
            notes: [],
            board: null,
            frames: [],
          }),
          selection: null,
          draft: null,
          projectName: "Untitled plant",
        });
      },

      checkpoint: () => {
        const s = get();
        set({ past: [...s.past, cloneSnap(s)].slice(-HISTORY_LIMIT), future: [] });
      },

      undo: () => {
        const s = get();
        const prev = s.past[s.past.length - 1];
        if (!prev) return;
        set({
          ...cloneSnap(prev),
          past: s.past.slice(0, -1),
          future: [cloneSnap(s), ...s.future].slice(0, HISTORY_LIMIT),
          selection: null,
          draft: null,
        });
      },
      redo: () => {
        const s = get();
        const next = s.future[0];
        if (!next) return;
        set({
          ...cloneSnap(next),
          future: s.future.slice(1),
          past: [...s.past, cloneSnap(s)].slice(-HISTORY_LIMIT),
          selection: null,
          draft: null,
        });
      },
    }),
    {
      name: "plantline-v3",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (s) => ({
        projectName: s.projectName,
        lines: s.lines,
        points: s.points,
        polygons: s.polygons,
        overlays: s.overlays,
        notes: s.notes,
        board: s.board,
        frames: s.frames,
        view: s.view,
        labelPlate: s.labelPlate,
        labelSize: s.labelSize,
        polygonLabelSize: s.polygonLabelSize,
        lineInk: s.lineInk,
        fontStep: s.fontStep,
      }),
    },
  ),
);
