export type LineKind =
  | "ug-new"
  | "ug-pull"
  | "aerial-new"
  | "aerial-overlash"
  | "drop"
  | "in-4"
  | "in-2"
  | "in-075"
  | "line"
  | "road";

export type PointKind = "pedestal" | "vault" | "mdu" | "pole" | "passing" | "pin";

export type PedType = "" | "s" | "m" | "l" | "dh" | "dd";

export type VaultType = "" | "s";

export type Tool =
  | "select"
  | LineKind
  | PointKind
  | "polygon"
  | "overlay"
  | "note"
  | "frame";

export interface LatLng {
  lat: number;
  lng: number;
}

export const CABLE_IDS = ["625", "875", "fiber", "rg6", "rg11", "rock", "flex"] as const;
export type CableType = (typeof CABLE_IDS)[number];
export type SlotChoice = CableType | "empty" | "";

export function isCableType(value: unknown): value is CableType {
  return typeof value === "string" && (CABLE_IDS as readonly string[]).includes(value);
}

export type LabelSize = "xs" | "sm" | "md" | "lg" | "xl";
export type ObjectSize = "std" | "med" | "big";

export type PipeRole = "ug" | "width" | "share";

export type AerialOp = "de" | "re" | "ol";
export type AerialMode = "new" | "work";

export interface CableWork {
  op: AerialOp | "";
  existing: boolean;
  wreck: boolean;
}

export function isAerialOp(value: unknown): value is AerialOp {
  return value === "de" || value === "re" || value === "ol";
}

export interface LineDot {
  at: LatLng;
  peer: string;
  show: boolean;
}

export interface LineFeature {
  id: string;
  kind: LineKind;
  path: LatLng[];
  notes: string;
  parallel: boolean;
  joinEnds: boolean;
  intoSlot: 0 | 1 | 2 | 3;
  cables: CableType[];
  slot1: SlotChoice;
  slot2: SlotChoice;
  fiberCount: string;
  fiberCount2: string;
  fiberCounts: string[];
  emptyPipe: boolean;
  remove: boolean;
  fiberUnit: "ft" | "km";
  overrideFootage: boolean;
  footageText: string;
  hideLegend: boolean;
  hideFootage: boolean;
  labelSize: LabelSize;
  name: string;
  splits: LatLng[];
  dots: LineDot[];
  snaps: LatLng[];
  pipeRoles: PipeRole[];
  occupied: boolean;
  hideSpan: boolean;
  aerialMode: AerialMode;
  strandOnly: boolean;
  workOps: AerialOp[];
  cableWork: CableWork[];
  wreckOut: boolean;
  callout: boolean;
  calloutDirs: number[];
  calloutSteps: number[];
  stroke: string;
  weight: number;
  existing: boolean;
  mark: "" | "ae" | "ug";
}

export type LabelSide = "top" | "bottom" | "left" | "right";

export interface PointFeature {
  id: string;
  kind: PointKind;
  position: LatLng;
  name: string;
  description: string;
  labelSide: LabelSide;
  riser: boolean;
  anchors: number[];
  remove: boolean;
  hideLegend: boolean;
  pedType: PedType;
  pedRotate: number;
  vaultType: VaultType;
  size: ObjectSize;
  labelSize: LabelSize;
}

export interface PolygonFeature {
  id: string;
  path: LatLng[];
  name: string;
  description: string;
  stroke: string;
  fill: string;
  strokeOpacity: number;
  fillOpacity: number;
  labelSize: LabelSize;
}

export interface OverlayFeature {
  id: string;
  name: string;
  description: string;
  dataUrl: string;
  south: number;
  west: number;
  north: number;
  east: number;
  opacity: number;
  rotation: number;
}

export interface NoteRef {
  id: string;
  n: number;
  at: LatLng;
  anchor: LatLng | null;
  callout: boolean;
  text: string;
  side: LabelSide;
  span: number;
  target: { type: "line" | "point"; id: string } | null;
}

export interface NoteBoard {
  south: number;
  west: number;
  north: number;
  east: number;
  opacity: number;
  opened: boolean;
}

export interface FrameFeature {
  id: string;
  south: number;
  west: number;
  north: number;
  east: number;
  viewSouth: number;
  viewWest: number;
  viewNorth: number;
  viewEast: number;
  closer: number;
  liftLabels: boolean;
  linkColor: string;
}

export interface MapViewState {
  lat: number;
  lng: number;
  zoom: number;
}

export type Selection =
  | { type: "line"; id: string }
  | { type: "point"; id: string }
  | { type: "polygon"; id: string }
  | { type: "overlay"; id: string }
  | { type: "note"; id: string }
  | { type: "board" }
  | { type: "frame"; id: string }
  | { type: "callout"; id: string };

export type Draft =
  | { mode: "line"; kind: LineKind; path: LatLng[]; declined: { lineId: string; at: LatLng }[]; pending: { at: LatLng; targetId: string; kind: "end" | "cross"; showDot: boolean; measureAt?: LatLng }[]; snaps: LatLng[] }
  | { mode: "polygon"; path: LatLng[] }
  | { mode: "overlay"; name: string; dataUrl: string; a: LatLng | null }
  | { mode: "frame"; a: LatLng | null };

export interface PlantProject {
  projectName: string;
  lines: LineFeature[];
  points: PointFeature[];
  polygons: PolygonFeature[];
  overlays: OverlayFeature[];
  notes: NoteRef[];
  board: NoteBoard | null;
  frames: FrameFeature[];
  view: MapViewState;
}

export const EMPTY_PROJECT: PlantProject = {
  projectName: "Untitled plant",
  lines: [],
  points: [],
  polygons: [],
  overlays: [],
  notes: [],
  board: null,
  frames: [],
  view: { lat: 39.8283, lng: -98.5795, zoom: 5 },
};

export const LINE_KINDS: LineKind[] = [
  "ug-new",
  "ug-pull",
  "aerial-new",
  "aerial-overlash",
  "drop",
  "in-4",
  "in-2",
  "in-075",
  "line",
  "road",
];

export const POINT_KINDS: PointKind[] = [
  "pedestal",
  "vault",
  "mdu",
  "pole",
  "passing",
  "pin",
];
