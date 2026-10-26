import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  Draft,
  LatLng,
  LineFeature,
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
import { defaultPointName, allowedCables, allowsEmpty, canResize, isLineKind, isPedType, isPointKind, isSnapTarget, isVaultType, pedestalDir } from "./presets";

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
  placeSmall: boolean;
  setPlaceSmall: (placeSmall: boolean) => void;
  labelPlate: boolean;
  setLabelPlate: (labelPlate: boolean) => void;
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
      Pick<LineFeature, "notes" | "name" | "parallel" | "joinEnds" | "intoSlot" | "cables" | "slot1" | "slot2" | "fiberCount" | "fiberCount2" | "emptyPipe" | "remove" | "fiberUnit" | "overrideFootage" | "footageText" | "hideLegend" | "hideFootage">
    >,
  ) => void;
  updatePoint: (id: string, patch: Partial<Pick<PointFeature, "name" | "description" | "labelSide" | "riser" | "anchors" | "remove" | "hideLegend" | "pedType" | "pedRotate" | "vaultType" | "size">>) => void;
  updatePolygon: (
    id: string,
    patch: Partial<Pick<PolygonFeature, "name" | "description">>,
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

function uniqueCables(value: unknown, legacy: unknown): CableType[] {
  const raw = Array.isArray(value) ? value : legacy ? [legacy] : [];
  return CABLE_IDS.filter((id) => raw.includes(id));
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
  const unique = uniqueCables(line.cables, line.cable).filter((id) => !line.kind || allowed.has(id));
  const raw = Array.isArray(line.cables) ? line.cables.filter(isCable) : unique;
  let slot1: SlotChoice = isSlot(line.slot1) ? line.slot1 : "";
  let slot2: SlotChoice = isSlot(line.slot2) ? line.slot2 : "";
  if (parallel && slot1 === "" && slot2 === "") {
    slot1 = raw.find((id) => allowed.has(id)) ?? "";
    slot2 = raw.filter((id) => allowed.has(id))[1] ?? "";
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
    cables: parallel ? [slot1, slot2].filter(isCable) : unique,
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
      name: typeof line.name === "string" ? line.name : "",
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
      placeSmall: false,
      labelPlate: false,
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
      setPlaceSmall: (placeSmall) => set({ placeSmall }),
      setLabelPlate: (labelPlate) => set({ labelPlate }),
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
              draft: { mode: "line", kind, path: [ll] },
              selection: null,
            });
            return;
          }
          set({
            draft: { mode: "line", kind: s.draft.kind, path: [...s.draft.path, ll] },
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
          const line: LineFeature = stampLoss({
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
            name: "",
          });
          set({
            ...commit(s, { lines: [...s.lines, line] }),
            draft: null,
            pointer: null,
            snapAsk: null,
            selection: { type: "line", id: line.id },
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

      cancelDraft: () => set({ draft: null, pointer: null, snapAsk: null }),

      moveLineVertex: (id, index, ll) => {
        if (!isLatLng(ll)) return;
        set({
          lines: get().lines.map((line) => {
            if (line.id !== id) return line;
            return stampLoss({
              ...line,
              path: line.path.map((p, i) => (i === index ? ll : p)),
            });
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
            ...commit(s, { lines: s.lines.filter((l) => l.id !== sel.id) }),
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
      }),
    },
  ),
);
