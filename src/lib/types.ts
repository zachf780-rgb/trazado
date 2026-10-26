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
  | "overlay";

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
  emptyPipe: boolean;
  remove: boolean;
  fiberUnit: "ft" | "km";
  overrideFootage: boolean;
  footageText: string;
  hideLegend: boolean;
  hideFootage: boolean;
  name: string;
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
  size: "lg" | "sm";
}

export interface PolygonFeature {
  id: string;
  path: LatLng[];
  name: string;
  description: string;
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
  | { type: "overlay"; id: string };

export type Draft =
  | { mode: "line"; kind: LineKind; path: LatLng[] }
  | { mode: "polygon"; path: LatLng[] }
  | { mode: "overlay"; name: string; dataUrl: string; a: LatLng | null };

export interface PlantProject {
  projectName: string;
  lines: LineFeature[];
  points: PointFeature[];
  polygons: PolygonFeature[];
  overlays: OverlayFeature[];
  view: MapViewState;
}

export const EMPTY_PROJECT: PlantProject = {
  projectName: "Untitled plant",
  lines: [],
  points: [],
  polygons: [],
  overlays: [],
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
