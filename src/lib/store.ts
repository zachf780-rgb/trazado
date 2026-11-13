import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  Draft,
  LatLng,
  LineFeature,
  LabelSize,
  OverlayFeature,
  PlantProject,
  PointFeature,
  PointKind,
  PolygonFeature,
  Selection,
  Tool,
  CableType,
  SlotChoice,
} from "./types";
import { EMPTY_PROJECT, LINE_KINDS, CABLE_IDS, isCableType } from "./types";
import { uid } from "./utils";
import { constrainCardinal, haversineFeet, lineLossNote, normalizeBox, notesWithLoss } from "./geo";
import { defaultPointName, allowedCables, allowsEmpty, canResize, isLineKind, isPedType, isPipeRole, isPointKind, isSnapTarget, isVaultType, pedestalDir } from "./presets";

const HISTORY_LIMIT = 60;

type Snapshot = Pick<PlantProject, "lines" | "points" | "polygons" | "overlays">;

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
  lineSnap: { lineId: string; at: LatLng; kind: "end" | "cross"; click: LatLng; showDot: boolean } | null;
  placeSmall: boolean;
  setPlaceSmall: (placeSmall: boolean) => void;
  labelPlate: boolean;
  setLabelPlate: (labelPlate: boolean) => void;
  labelSize: LabelSize;
  setLabelSize: (labelSize: LabelSize) => void;
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
      Pick<LineFeature, "notes" | "name" | "parallel" | "joinEnds" | "intoSlot" | "cables" | "slot1" | "slot2" | "fiberCount" | "fiberCount2" | "emptyPipe" | "remove" | "fiberUnit" | "overrideFootage" | "footageText" | "hideLegend" | "hideFootage" | "labelSize" | "pipeRoles" | "occupied" | "hideSpan">
    >,
  ) => void;
  updatePoint: (id: string, patch: Partial<Pick<PointFeature, "name" | "description" | "labelSide" | "riser" | "anchors" | "remove" | "hideLegend" | "pedType" | "pedRotate" | "vaultType" | "size">>) => void;
  updatePolygon: (
    id: string,
    patch: Partial<Pick<PolygonFeature, "name" | "description" | "stroke" | "fill" | "strokeOpacity" | "fillOpacity">>,
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
  "cables" | "slot1" | "slot2" | "fiberCount" | "fiberCount2"
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
  return value === "sm" || value === "md" || value === "lg";
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
      kind: line.kind,
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
      pipeRoles: Array.isArray(line.pipeRoles) ? line.pipeRoles.filter(isPipeRole) : [],
      occupied: line.occupied === true,
      hideSpan: line.hideSpan === true,
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
      size: canResize(point.kind) && point.size === "sm" ? "sm" : "lg",
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
    view:
      view && Number.isFinite(view.lat) && Number.isFinite(view.lng) && Number.isFinite(view.zoom)
        ? view
        : EMPTY_PROJECT.view,
  };
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
      placeSmall: false,
      labelPlate: false,
      labelSize: "md",
      past: [],
      future: [],

      markHydrated: () => {
        const clean = sanitizeProject(get());
        set({ ...clean, hydrated: true, draft: null, selection: null });
      },
      setTool: (tool) =>
        set({
          tool,
          draft: null,
          pointer: null,
          snapAsk: null,
          lineSnap: null,
          selection: tool === "select" ? get().selection : null,
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
        const pending = { at: ask.at, targetId: ask.lineId, kind: ask.kind, showDot: ask.showDot };
        if (!s.draft || s.draft.mode !== "line") {
          set({
            lineSnap: null,
            selection: null,
            draft: { mode: "line", kind, path: [ask.at], declined: [], pending: [pending] },
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
            draft: { mode: "line", kind, path: [ask.click], declined: [declined], pending: [] },
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
      setPlaceSmall: (placeSmall) => set({ placeSmall }),
      setLabelPlate: (labelPlate) => set({ labelPlate }),
      setLabelSize: (labelSize) => set({ labelSize }),
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
          size: canResize(kind) && s.placeSmall ? "sm" : "lg",
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
              draft: { mode: "line", kind, path: [ll], declined: [], pending: [] },
              selection: null,
            });
            return;
          }
          set({
            draft: { mode: "line", kind: s.draft.kind, path: [...s.draft.path, ll], declined: s.draft.declined, pending: s.draft.pending },
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
            emptyPipe: false,
            remove: false,
            fiberUnit: "ft",
            overrideFootage: false,
            footageText: "",
            hideLegend: false,
            hideFootage: false,
            labelSize: isLabelSize(s.labelSize) ? s.labelSize : "md",
            name: "",
            splits: [],
            dots: d.pending.map((join) => ({ at: join.at, peer: join.targetId, show: join.showDot })),
            pipeRoles: [],
            occupied: false,
            hideSpan: false,
          });
          const lines = s.lines.map((existing) => {
            const joins = d.pending.filter((join) => join.targetId === existing.id);
            if (joins.length === 0) return existing;
            return {
              ...existing,
              dots: [...(existing.dots ?? []), ...joins.map((join) => ({ at: join.at, peer: created.id, show: join.showDot }))],
              splits: [...(existing.splits ?? []), ...joins.filter((join) => join.kind === "cross").map((join) => join.at)],
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
        } else {
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
        view: s.view,
        labelPlate: s.labelPlate,
        labelSize: s.labelSize,
      }),
    },
  ),
);
