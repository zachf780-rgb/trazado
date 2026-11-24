// @ts-nocheck
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import {
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Hash,
  ImagePlus,
  Layers,
  LocateFixed,
  MapPin,
  MoreHorizontal,
  MousePointer2,
  Pentagon,
  Scan,
  Redo2,
  Search,
  Spline,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { toast, Toaster } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePlantStore } from "@/lib/store";
import {
  AERIAL_SWATCH,
  CONDUIT_PRESETS,
  LINE_PRESETS,
  POINT_PRESETS,
  ROAD_PRESET,
  allowsEmpty,
  alignPipeRoles,
  alignCableWork,
  cableChoices,
  canResize,
  isLineTool,
  joinsAtEnds,
  linePreset,
  linePaint,
  lineWeightOf,
  LINE_INK_COLORS,
  LINE_INK_WEIGHTS,
  pipeAccount,
  plantTotals,
  pedestalColor,
  pedestalDir,
  pedestalRotates,
  PED_TYPES,
  vaultColor,
  pointLabelColor,
  pointPreset,
  snapTargetLabel,
} from "@/lib/presets";
import { constrainCardinal, formatFeet, footageSpans, pathFootage, reportedFeet, spanCalloutDir, spanCalloutStep } from "@/lib/geo";
import { isCableType } from "@/lib/types";
import { buildKmz, downloadBlob, parsePlantFile } from "@/lib/kml";
import { searchPlaces } from "@/lib/geocode";
import { BucketRun } from "@/components/bucket-run";
import { cn } from "@/lib/utils";

function parseDecimalCoord(raw) {
  const text = String(raw).trim().replace(/[()]/g, "").replace(/°/g, "");
  const match = text.match(/^(-?\d+(?:\.\d+)?)\s*([nNsS])?\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*([eEwW])?$/);
  if (!match) return null;
  let a = Number(match[1]);
  let b = Number(match[3]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const aH = match[2]?.toUpperCase();
  const bH = match[4]?.toUpperCase();
  if (aH === "S") a = -Math.abs(a);
  if (aH === "N") a = Math.abs(a);
  if (bH === "W") b = -Math.abs(b);
  if (bH === "E") b = Math.abs(b);
  let lat = a;
  let lng = b;
  if (Math.abs(lat) > 90 && Math.abs(lng) <= 90 && Math.abs(lat) <= 180) {
    lat = b;
    lng = a;
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, label: `${lat.toFixed(6)}, ${lng.toFixed(6)}` };
}

function PedestalGlyph({ className }) {
	return /* @__PURE__ */ jsx("span", { className: cn("inline-block size-3 border-2 border-foreground bg-foreground/15", className) });
}
function VaultGlyph({ className }) {
	return /* @__PURE__ */ jsx("span", {
		className: cn("inline-flex size-3 items-center justify-center border-2 border-foreground bg-foreground/15 font-sans text-xs font-semibold leading-none", className),
		children: "V"
	});
}
function MduGlyph({ className }) {
	return /* @__PURE__ */ jsx("span", { className: cn("inline-block size-3 bg-foreground", className) });
}
function PoleGlyph({ className }) {
	return /* @__PURE__ */ jsx("span", { className: cn("inline-block size-3 rounded-full border-2 border-foreground bg-foreground/15", className) });
}
function PassingGlyph({ className }) {
	return /* @__PURE__ */ jsx("svg", {
		viewBox: "0 0 12 12",
		className: cn("size-3 fill-plant-passing", className),
		"aria-hidden": true,
		children: /* @__PURE__ */ jsx("polygon", { points: "6,1.2 11.2,10.8 0.8,10.8" })
	});
}
function PinGlyph({ className }) {
	return /* @__PURE__ */ jsx(MapPin, { className: cn("size-3.5 text-foreground", className) });
}
var POINT_GLYPH = {
	pedestal: PedestalGlyph,
	vault: VaultGlyph,
	mdu: MduGlyph,
	pole: PoleGlyph,
	passing: PassingGlyph,
	pin: PinGlyph
};
function isTypingTarget(el) {
	if (!(el instanceof HTMLElement)) return false;
	const tag = el.tagName;
	return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
}
var fieldClass = "flex w-full rounded-[var(--radius-sm)] border border-border bg-surface px-3 py-2 text-sm text-foreground shadow-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
function notesForShot(host: HTMLElement) {
	const map = (host as HTMLElement & { _trazadoMap?: { getBounds: () => { contains: (ll: [number, number]) => boolean } } })._trazadoMap;
	if (!map) return [];
	const bounds = map.getBounds();
	const inside = (ll: { lat: number; lng: number } | null | undefined) => Boolean(ll) && bounds.contains([ll.lat, ll.lng]);
	return usePlantStore.getState().notes
		.filter((note) => inside(note.at) || inside(note.anchor))
		.map((note) => ({ n: note.n, text: note.text.trim() }))
		.filter((note) => note.text)
		.sort((a, b) => a.n - b.n);
}
function plantBlocks(host: HTMLElement) {
	type ShotMap = { latLngToContainerPoint: (ll: [number, number]) => { x: number; y: number } };
	const map = (host as HTMLElement & { _trazadoMap?: ShotMap })._trazadoMap;
	if (!map) return [];
	const width = Math.max(1, host.clientWidth);
	const height = Math.max(1, host.clientHeight);
	const blocks: { x: number; y: number; w: number; h: number }[] = [];
	const add = (x: number, y: number, w: number, h: number) => {
		blocks.push({ x: x / width, y: y / height, w: w / width, h: h / height });
	};
	const state = usePlantStore.getState();
	for (const line of state.lines) {
		for (let i = 1; i < line.path.length; i += 1) {
			const a = line.path[i - 1];
			const b = line.path[i];
			if (!a || !b) continue;
			const pa = map.latLngToContainerPoint([a.lat, a.lng]);
			const pb = map.latLngToContainerPoint([b.lat, b.lng]);
			const steps = Math.max(1, Math.ceil(Math.hypot(pb.x - pa.x, pb.y - pa.y) / 14));
			for (let step = 0; step <= steps; step += 1) {
				const t = step / steps;
				add(pa.x + (pb.x - pa.x) * t - 8, pa.y + (pb.y - pa.y) * t - 8, 16, 16);
			}
		}
	}
	for (const point of state.points) {
		const at = map.latLngToContainerPoint([point.position.lat, point.position.lng]);
		add(at.x - 16, at.y - 16, 32, 32);
	}
	for (const note of state.notes) {
		if (!note.at) continue;
		const at = map.latLngToContainerPoint([note.at.lat, note.at.lng]);
		add(at.x - 12, at.y - 12, 24, 24);
	}
	const hostRect = host.getBoundingClientRect();
	for (const el of host.querySelectorAll<HTMLElement>(".leaflet-tooltip, .leaflet-div-icon, .leaflet-marker-icon")) {
		if (el.closest("[data-board-shot]")) continue;
		const rect = el.getBoundingClientRect();
		if (rect.width < 2 || rect.height < 2) continue;
		add(rect.left - hostRect.left - 3, rect.top - hostRect.top - 3, rect.width + 6, rect.height + 6);
	}
	return blocks;
}
function hideBoard(host: HTMLElement) {
	const board = host.querySelector("[data-board-shot]");
	if (!(board instanceof HTMLElement)) return null;
	const display = board.style.display;
	board.style.display = "none";
	return () => {
		board.style.display = display;
	};
}
export function PlantApp() {
	const [mounted, setMounted] = useState(false);
	const [MapCmp, setMapCmp] = useState(null);
	const [basemap, setBasemap] = useState("satellite");
	const [shots, setShots] = useState([]);
	const [shooting, setShooting] = useState(false);
	const [shotStep, setShotStep] = useState(null);
	const [query, setQuery] = useState("");
	const [results, setResults] = useState([]);
	const [searching, setSearching] = useState(false);
	const [searchSettled, setSearchSettled] = useState(false);
	const [clearOpen, setClearOpen] = useState(false);
	const importRef = useRef(null);
	const overlayRef = useRef(null);
	const gpsWatch = useRef(null);
	const tool = usePlantStore((s) => s.tool);
	const placeSize = usePlantStore((s) => s.placeSize);
	const draft = usePlantStore((s) => s.draft);
	const pointer = usePlantStore((s) => s.pointer);
	const shift = usePlantStore((s) => s.shift);
	const selection = usePlantStore((s) => s.selection);
	const lines = usePlantStore((s) => s.lines);
	const points = usePlantStore((s) => s.points);
	const polygons = usePlantStore((s) => s.polygons);
	const notes = usePlantStore((s) => s.notes);
	const board = usePlantStore((s) => s.board);
	const frames = usePlantStore((s) => s.frames);
	const overlays = usePlantStore((s) => s.overlays);
	const projectName = usePlantStore((s) => s.projectName);
	const eggTool = usePlantStore((s) => s.eggTool);
	const eggPlacing = usePlantStore((s) => s.eggPlacing);
	const eggOpen = usePlantStore((s) => s.eggOpen);
	const past = usePlantStore((s) => s.past);
	const future = usePlantStore((s) => s.future);
	const gps = usePlantStore((s) => s.gps);
	const snapAsk = usePlantStore((s) => s.snapAsk);
	const lineSnap = usePlantStore((s) => s.lineSnap);
	useEffect(() => {
		return () => {
			if (gpsWatch.current != null) navigator.geolocation.clearWatch(gpsWatch.current);
		};
	}, []);
	useEffect(() => {
		Promise.resolve(usePlantStore.persist.rehydrate()).finally(() => {
			usePlantStore.getState().markHydrated();
			setMounted(true);
		});
		import("@/components/map-view").then((m) => setMapCmp(() => m.MapView)).catch(() => toast.error("Map failed to load"));
	}, []);
	useEffect(() => {
		function onKeyDown(e) {
			if (isTypingTarget(e.target)) return;
			const s = usePlantStore.getState();
			if (e.key === "Shift") s.setShift(true);
			if (e.key === "Enter") {
				e.preventDefault();
				if (s.snapAsk) s.confirmSnap();
				else if (s.lineSnap) s.confirmLineSnap();
				else s.finishDraft();
			}
			if (e.key === "Escape") {
				if (s.snapAsk) s.dismissSnap();
				else if (s.lineSnap) s.dismissLineSnap(true);
				else if (s.draft && "path" in s.draft && s.draft.path.length > 0) s.undoDraftPoint();
				else if (s.draft) s.cancelDraft();
				else s.clearSelection();
			}
			if ((e.key === "Delete" || e.key === "Backspace") && !s.selection && s.draft && "path" in s.draft) {
				e.preventDefault();
				s.undoDraftPoint();
			} else if ((e.key === "Delete" || e.key === "Backspace") && s.selection) {
				e.preventDefault();
				s.deleteSelection();
			}
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey && s.draft && "path" in s.draft && s.draft.path.length > 0) {
				e.preventDefault();
				s.undoDraftPoint();
			} else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
				e.preventDefault();
				if (e.shiftKey) s.redo();
				else s.undo();
			}
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
				e.preventDefault();
				exportKmz();
			}
			if (!e.metaKey && !e.ctrlKey && !e.altKey) {
				if (e.key === "v" || e.key === "V") s.setTool("select");
				if (e.key === "1") s.setTool("ug-new");
				if (e.key === "2") s.setTool("ug-pull");
				if (e.key === "3") s.setTool("aerial-new");
				if (e.key === "5") s.setTool("drop");
				if (e.key === "6") s.setTool("pedestal");
				if (e.key === "7") s.setTool("vault");
				if (e.key === "8") s.setTool("mdu");
				if (e.key === "9") s.setTool("pole");
				if (e.key === "0") s.setTool("passing");
			}
		}
		function onKeyUp(e) {
			if (e.key === "Shift") usePlantStore.getState().setShift(false);
		}
		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("keyup", onKeyUp);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("keyup", onKeyUp);
		};
	}, []);
	useEffect(() => {
		const trimmed = query.trim();
		if (!trimmed) {
			setResults([]);
			setSearchSettled(false);
			return;
		}
		const coord = parseDecimalCoord(trimmed);
		if (coord) {
			setResults([coord]);
			setSearching(false);
			setSearchSettled(true);
			return;
		}
		setSearchSettled(false);
		const handle = window.setTimeout(async () => {
			setSearching(true);
			try {
				const rows = await searchPlaces({ data: query.trim() });
				setResults(rows);
			} catch {
				try {
					const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query.trim())}&limit=5`);
					if (!res.ok) throw new Error("Search failed");
					const data = await res.json();
					setResults((data.features ?? []).map((f) => {
						const [lng, lat] = f.geometry?.coordinates ?? [];
						const props = f.properties ?? {};
						const bits = [
							[props.housenumber, props.street].filter(Boolean).join(" ") || props.name,
							props.city,
							props.state,
							props.country
						].filter(Boolean);
						if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
						return { label: bits.join(", ") || "Result", lat, lng };
					}).filter(Boolean));
				} catch {
					setResults([]);
				}
			} finally {
				setSearching(false);
				setSearchSettled(true);
			}
		}, 280);
		return () => window.clearTimeout(handle);
	}, [query]);
	const totals = useMemo(() => plantTotals(lines, points), [lines, points]);
	const selectedLine = selection?.type === "line" ? lines.find((l) => l.id === selection.id) : null;
	const selectedPoint = selection?.type === "point" ? points.find((p) => p.id === selection.id) : null;
	const selectedPolygon = selection?.type === "polygon" ? polygons.find((p) => p.id === selection.id) : null;
	const selectedOverlay = selection?.type === "overlay" ? overlays.find((o) => o.id === selection.id) : null;
	const selectedNote = selection?.type === "note" ? notes.find((note) => note.id === selection.id) : null;
	const selectedFrame = selection?.type === "frame" ? frames.find((frame) => frame.id === selection.id) : null;
	const selectedCallout = selection?.type === "callout" ? lines.find((line) => line.id === selection.id) : null;
	const selectedBoard = selection?.type === "board" ? board : null;
	const legendOpen = totals.usedLines.length > 0 || totals.removeLines.length > 0 || totals.usedPoints.length > 0 || totals.peds.length > 0 || totals.vaults.length > 0;
	const canFinish = draft?.mode === "line" && draft.path.length >= 2 || draft?.mode === "polygon" && draft.path.length >= 3;
	const showDraftBar = Boolean(draft);
	const drawingFeet = useMemo(() => {
		if (!draft || draft.mode !== "line" || draft.path.length === 0) return null;
		const last = draft.path[draft.path.length - 1];
		if (!last) return null;
		const tip = pointer ? shift ? constrainCardinal(last, pointer) : pointer : null;
		const path = tip ? [...draft.path, tip] : draft.path;
		if (path.length < 2) return null;
		const feet = pathFootage(path);
		return feet >= 1 ? feet : null;
	}, [draft, pointer, shift]);
	const snapPoint = snapAsk ? points.find((p) => p.id === snapAsk) : null;
	async function makeKmz() {
		const state = usePlantStore.getState();
		return {
			state,
			blob: await buildKmz(state, state.labelPlate),
			filename: `${(state.projectName || "trazado").replace(/[^\w.-]+/g, "-")}.kmz`
		};
	}
	async function exportKmz() {
		try {
			const { state, blob, filename } = await makeKmz();
			downloadBlob(blob, filename);
			toast.success("KMZ downloaded");
			if ((state.projectName || "").trim().toLowerCase() === "steverino") usePlantStore.getState().unlockEgg();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Download failed");
		}
	}
	function mapShot(host) {
		const map = host._trazadoMap;
		if (map) {
			const bounds = map.getBounds();
			const center = map.getCenter();
			const size = map.getSize();
			return {
				lat: center.lat,
				lng: center.lng,
				zoom: map.getZoom(),
				width: size.x,
				height: size.y,
				south: bounds.getSouth(),
				north: bounds.getNorth(),
				west: bounds.getWest(),
				east: bounds.getEast()
			};
		}
		const view = usePlantStore.getState().view;
		return { lat: view.lat, lng: view.lng, zoom: view.zoom, width: host.clientWidth, height: host.clientHeight };
	}
	async function exportPdf() {
		const host = document.querySelector("[data-map]");
		if (!(host instanceof HTMLElement)) return;
		try {
			const name = (usePlantStore.getState().projectName || "trazado").replace(/[^\w.-]+/g, "-");
			const { exportMapPdf } = await import("@/lib/pdf");
			await exportMapPdf(host, mapShot(host), `${name}.pdf`);
			toast.success("PDF downloaded");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "PDF failed");
		}
	}
	async function cropToBox(host, image, box) {
		const map = host._trazadoMap;
		if (!map) return image;
		const nw = map.latLngToContainerPoint([Math.max(box.south, box.north), Math.min(box.west, box.east)]);
		const se = map.latLngToContainerPoint([Math.min(box.south, box.north), Math.max(box.west, box.east)]);
		const ratio = 2;
		const sx = Math.max(0, Math.min(nw.x, se.x) * ratio);
		const sy = Math.max(0, Math.min(nw.y, se.y) * ratio);
		const sw = Math.max(2, Math.abs(se.x - nw.x) * ratio);
		const sh = Math.max(2, Math.abs(se.y - nw.y) * ratio);
		const img = await new Promise((resolve, reject) => {
			const el = new Image();
			el.onload = () => resolve(el);
			el.onerror = () => reject(new Error("Could not crop the snapshot"));
			el.src = image;
		});
		const canvas = document.createElement("canvas");
		canvas.width = Math.round(sw);
		canvas.height = Math.round(sh);
		const ctx = canvas.getContext("2d");
		if (!ctx) return image;
		ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
		return canvas.toDataURL("image/png");
	}
	function boundsOf(host, box) {
		if (box) return box;
		const map = host._trazadoMap;
		if (!map) return null;
		const bounds = map.getBounds();
		return { south: bounds.getSouth(), north: bounds.getNorth(), west: bounds.getWest(), east: bounds.getEast() };
	}
	function noteIdsInside(box) {
		const south = Math.min(box.south, box.north);
		const north = Math.max(box.south, box.north);
		const west = Math.min(box.west, box.east);
		const east = Math.max(box.west, box.east);
		const inside = (ll) => Boolean(ll) && ll.lat >= south && ll.lat <= north && ll.lng >= west && ll.lng <= east;
		return usePlantStore.getState().notes.filter((note) => inside(note.at) || inside(note.anchor)).map((note) => note.n);
	}
	function pullListInto(box) {
		const board = usePlantStore.getState().board;
		if (!board) return;
		const south = Math.min(box.south, box.north);
		const north = Math.max(box.south, box.north);
		const west = Math.min(box.west, box.east);
		const east = Math.max(box.west, box.east);
		const latSpan = Math.max(north - south, 0.00001);
		const lngSpan = Math.max(east - west, 0.00001);
		const height = Math.min(Math.abs(board.north - board.south) || latSpan * 0.28, latSpan * 0.5);
		const width = Math.min(Math.abs(board.east - board.west) || lngSpan * 0.34, lngSpan * 0.5);
		const top = north - latSpan * 0.08;
		const left = west + lngSpan * 0.05;
		usePlantStore.getState().updateBoard({ opened: true, north: top, south: top - height, west: left, east: left + width });
	}
	function listInside(box) {
		const board = usePlantStore.getState().board;
		if (!board) return true;
		const lat = (board.south + board.north) / 2;
		const lng = (board.west + board.east) / 2;
		const south = Math.min(box.south, box.north);
		const north = Math.max(box.south, box.north);
		const west = Math.min(box.west, box.east);
		const east = Math.max(box.west, box.east);
		return lat >= south && lat <= north && lng >= west && lng <= east;
	}
	async function captureShot(box) {
		const host = document.querySelector("[data-map]");
		if (!(host instanceof HTMLElement)) return;
		try {
			const { snapNode } = await import("@/lib/snap");
			let image = await snapNode(host);
			if (box) image = await cropToBox(host, image, box);
			const frame = boundsOf(host, box);
			const meta = frame
				? { ...mapShot(host), lat: (frame.south + frame.north) / 2, lng: (frame.west + frame.east) / 2, south: Math.min(frame.south, frame.north), north: Math.max(frame.south, frame.north), west: Math.min(frame.west, frame.east), east: Math.max(frame.west, frame.east) }
				: mapShot(host);
			setShots((list) => [...list, { image, ...meta }]);
			usePlantStore.getState().setShotKeep(null);
			usePlantStore.getState().setShotBox(null);
			setShotStep(null);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Snapshot failed");
		}
	}
	function beginPlace(box) {
		const host = document.querySelector("[data-map]");
		if (!(host instanceof HTMLElement)) return;
		const frame = boundsOf(host, box);
		if (!frame) return;
		const ids = noteIdsInside(frame);
		const board = usePlantStore.getState().board;
		if (!board || ids.length === 0) {
			void captureShot(box);
			return;
		}
		if (!listInside(frame)) pullListInto(frame);
		usePlantStore.getState().setShotBox(box);
		usePlantStore.getState().setShotKeep(ids);
		usePlantStore.getState().select({ type: "board" });
		setShotStep("place");
	}
	function confirmPlace() {
		const host = document.querySelector("[data-map]");
		if (!(host instanceof HTMLElement)) return;
		const box = usePlantStore.getState().shotBox;
		const frame = boundsOf(host, box);
		if (frame && !listInside(frame)) {
			toast.error("Move the list into the shot first");
			return;
		}
		void captureShot(box);
	}
	function pageFramePixels() {
		const host = document.querySelector("[data-map]");
		if (!(host instanceof HTMLElement)) return null;
		const ratio = 11 / 8.5;
		const maxW = host.clientWidth * 0.84;
		const maxH = host.clientHeight * 0.7;
		let width = maxW;
		let height = width / ratio;
		if (height > maxH) {
			height = maxH;
			width = height * ratio;
		}
		return { left: (host.clientWidth - width) / 2, top: (host.clientHeight - height) / 2, width, height };
	}
	function startPageBoundary() {
		usePlantStore.getState().setShotBox(null);
		usePlantStore.getState().setShotKeep(null);
		setShotStep("frame");
	}
	function confirmFrame() {
		const host = document.querySelector("[data-map]");
		const map = host instanceof HTMLElement ? host._trazadoMap : null;
		const frame = pageFramePixels();
		if (!map || !frame) return;
		const nw = map.containerPointToLatLng([frame.left, frame.top]);
		const se = map.containerPointToLatLng([frame.left + frame.width, frame.top + frame.height]);
		beginPlace({ south: se.lat, north: nw.lat, west: nw.lng, east: se.lng });
	}
	function runOptimize() {
		const changed = usePlantStore.getState().optimizeLabels();
		toast.success(changed ? "Labels adjusted for this zoom" : "Labels already clear at this zoom");
	}
	function cancelShotStep() {
		usePlantStore.getState().setShotKeep(null);
		usePlantStore.getState().setShotBox(null);
		setShotStep(null);
	}
	async function downloadSnapshots() {
		if (shots.length === 0) return;
		try {
			const name = (usePlantStore.getState().projectName || "trazado").replace(/[^\w.-]+/g, "-");
			const { exportPdfPages } = await import("@/lib/pdf");
			await exportPdfPages(shots, `${name}.pdf`);
			setShots([]);
			setShooting(false);
			setShotStep(null);
			usePlantStore.getState().setShotKeep(null);
			usePlantStore.getState().setShotBox(null);
			toast.success("PDF downloaded");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "PDF failed");
		}
	}
	function focusOf(project) {
		const spots = [];
		for (const line of project.lines ?? []) for (const point of line.path ?? []) spots.push(point);
		for (const point of project.points ?? []) if (point.position) spots.push(point.position);
		for (const poly of project.polygons ?? []) for (const point of poly.path ?? []) spots.push(point);
		for (const overlay of project.overlays ?? []) {
			spots.push({ lat: overlay.south, lng: overlay.west });
			spots.push({ lat: overlay.north, lng: overlay.east });
		}
		const usable = spots.filter((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lng));
		if (!usable.length) return null;
		const south = Math.min(...usable.map((point) => point.lat));
		const north = Math.max(...usable.map((point) => point.lat));
		const west = Math.min(...usable.map((point) => point.lng));
		const east = Math.max(...usable.map((point) => point.lng));
		const latSpan = Math.max(north - south, 0.00008);
		const lngSpan = Math.max(east - west, 0.00008);
		const zoom = Math.min(18, Math.max(4, Math.min(Math.log2(700 / lngSpan), Math.log2(420 / latSpan)) - 0.4));
		return { lat: (south + north) / 2, lng: (west + east) / 2, zoom };
	}
	async function onImport(file) {
		try {
			const project = await parsePlantFile(file);
			const focus = focusOf(project);
			const store = usePlantStore.getState();
			store.setGpsFollow(false);
			store.replaceProject(focus ? { ...project, view: focus } : project);
			if (focus) store.setFlyTo(focus);
			toast.success("Plant loaded");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Import failed");
		}
	}
	function locate() {
		if (!navigator.geolocation) {
			toast.error("Location is not available");
			return;
		}
		if (gpsWatch.current != null) {
			const fix = usePlantStore.getState().gps;
			if (fix && !usePlantStore.getState().gpsFollow) {
				usePlantStore.getState().setGpsFollow(true);
				usePlantStore.getState().setFlyTo({
					lat: fix.lat,
					lng: fix.lng,
					zoom: 18
				});
				return;
			}
			navigator.geolocation.clearWatch(gpsWatch.current);
			gpsWatch.current = null;
			usePlantStore.getState().setGps(null);
			usePlantStore.getState().setGpsFollow(false);
			return;
		}
		gpsWatch.current = navigator.geolocation.watchPosition((pos) => {
			const fix = {
				lat: pos.coords.latitude,
				lng: pos.coords.longitude,
				accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : 0
			};
			const last = usePlantStore.getState().gps;
			const first = !last;
			if (last) {
				const moved = Math.hypot((fix.lat - last.lat) * 111320, (fix.lng - last.lng) * 111320 * Math.cos(fix.lat * Math.PI / 180));
				if (moved < 1.5 && Math.abs(fix.accuracy - last.accuracy) < 8) return;
			}
			usePlantStore.getState().setGps(fix);
			if (first) {
				usePlantStore.getState().setGpsFollow(true);
				usePlantStore.getState().setFlyTo({
					lat: fix.lat,
					lng: fix.lng,
					zoom: 18
				});
			}
		}, () => {
			toast.error("Could not read location");
			if (gpsWatch.current != null) {
				navigator.geolocation.clearWatch(gpsWatch.current);
				gpsWatch.current = null;
			}
			usePlantStore.getState().setGps(null);
			usePlantStore.getState().setGpsFollow(false);
		}, {
			enableHighAccuracy: true,
			maximumAge: 1e3,
			timeout: 12e3
		});
	}
	return /* @__PURE__ */ jsx(TooltipProvider, {
		delayDuration: 250,
		children: /* @__PURE__ */ jsxs("div", {
			className: "relative h-dvh w-full overflow-hidden bg-background text-foreground",
			"data-screen": "1",
			children: [
				mounted && MapCmp ? /* @__PURE__ */ jsx(MapCmp, { basemap }) : null,
				shotStep === "frame" ? /* @__PURE__ */ jsx("div", {
					className: "pointer-events-none absolute z-40 border-2 border-dashed border-[#f5d90a]",
					style: (() => {
						const frame = pageFramePixels();
						return frame ? { left: frame.left, top: frame.top, width: frame.width, height: frame.height, boxShadow: "0 0 0 9999px rgba(0,0,0,0.45)" } : { display: "none" };
					})()
				}) : null,
				shooting ? /* @__PURE__ */ jsxs("div", {
					className: "export-hide pointer-events-auto absolute bottom-28 left-1/2 z-50 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-border bg-elevated px-2 py-2 shadow-lg",
					children: [
						shotStep === "frame" ? /* @__PURE__ */ jsx("span", { className: "px-1 text-sm", children: "Pan and zoom so the page is inside the box" }) : null,
						shotStep === "place" ? /* @__PURE__ */ jsx("span", { className: "px-1 text-sm", children: "Move the list into the shot" }) : null,
						shotStep === "frame" ? /* @__PURE__ */ jsxs(Button, {
							size: "sm",
							onClick: () => confirmFrame(),
							children: [/* @__PURE__ */ jsx(Check, { className: "size-4" }), " Confirm page"]
						}) : null,
						shotStep === "place" ? /* @__PURE__ */ jsxs(Button, {
							size: "sm",
							onClick: () => confirmPlace(),
							children: [/* @__PURE__ */ jsx(Check, { className: "size-4" }), " Confirm list"]
						}) : null,
						shotStep == null ? /* @__PURE__ */ jsxs(Button, {
							size: "sm",
							onClick: () => beginPlace(null),
							children: [/* @__PURE__ */ jsx(Camera, { className: "size-4" }), shots.length ? ` Snapshot screen ${shots.length + 1}` : " Snapshot screen"]
						}) : null,
						shotStep == null ? /* @__PURE__ */ jsx(Button, {
							size: "sm",
							variant: "secondary",
							onClick: () => startPageBoundary(),
							children: "Use page boundary"
						}) : null,
						/* @__PURE__ */ jsx(Button, {
							size: "sm",
							variant: "secondary",
							onClick: () => runOptimize(),
							children: "Optimize"
						}),
						shotStep != null ? /* @__PURE__ */ jsx(Button, {
							size: "sm",
							variant: "ghost",
							onClick: () => cancelShotStep(),
							children: "Back"
						}) : null,
						/* @__PURE__ */ jsx(Button, {
							size: "sm",
							variant: "secondary",
							disabled: shots.length === 0,
							onClick: () => void downloadSnapshots(),
							children: shots.length ? `Download ${shots.length}` : "Download"
						}),
						/* @__PURE__ */ jsx(Button, {
							size: "icon",
							variant: "ghost",
							"aria-label": "Cancel snapshots",
							onClick: () => { setShots([]); setShooting(false); setShotStep(null); usePlantStore.getState().setShotKeep(null); usePlantStore.getState().setShotBox(null); },
							children: /* @__PURE__ */ jsx(X, { className: "size-4" })
						})
					]
				}) : null,
				board && !board.opened && notes.length > 0 ? /* @__PURE__ */ jsx("button", {
					type: "button",
					className: "ref-prompt export-hide pointer-events-auto absolute top-1/2 left-1/2 z-50 rounded-md border-2 border-[#f5d90a] bg-[#111113] px-4 py-2 text-sm font-extrabold tracking-wide text-[#f5d90a]",
					onClick: () => {
						const view = usePlantStore.getState().view;
						const world = 256 * 2 ** (Number.isFinite(view.zoom) ? view.zoom : 18);
						const cos = Math.max(0.2, Math.abs(Math.cos((view.lat * Math.PI) / 180)));
						const west = view.lng - (80 / world) * 360;
						const north = view.lat + (20 / world) * 360 * cos;
						usePlantStore.getState().updateBoard({
							opened: true,
							west,
							north,
							east: west + (240 / world) * 360,
							south: north - (Math.max(72, notes.length * 26 + 16) / world) * 360 * cos
						});
						usePlantStore.getState().select({ type: "board" });
					},
					children: "Click to create list"
				}) : null,
				!mounted ? /* @__PURE__ */ jsx("div", { className: "absolute inset-0 bg-background" }) : null,
				/* @__PURE__ */ jsxs("header", {
					className: "pointer-events-none absolute inset-x-0 top-0 z-40 flex items-start justify-between gap-3 p-3 md:p-4",
					children: [/* @__PURE__ */ jsxs("div", {
						className: "pointer-events-auto flex min-w-0 flex-col gap-2",
						children: [/* @__PURE__ */ jsx("div", {
							className: "flex items-center gap-2 rounded-[var(--radius-lg)] border border-border bg-elevated py-2 pr-2 pl-3",
							children: /* @__PURE__ */ jsxs("div", {
								className: "min-w-0",
								children: [/* @__PURE__ */ jsx("p", {
									className: "font-sans text-sm font-semibold tracking-tight",
									children: "Trazado"
								}), /* @__PURE__ */ jsx("input", {
									value: projectName,
									onChange: (e) => usePlantStore.getState().setProjectName(e.target.value),
									className: "w-40 max-w-40 truncate bg-transparent text-xs text-muted-foreground outline-none md:w-52",
									"aria-label": "Project name"
								})]
							})
						}), /* @__PURE__ */ jsxs("div", {
							className: "relative z-50 w-full max-w-xs",
							children: [
								/* @__PURE__ */ jsx(Search, { className: "pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" }),
								/* @__PURE__ */ jsx(Input, {
									value: query,
									onChange: (e) => setQuery(e.target.value),
									onKeyDown: (e) => {
										if (e.key === "Enter") {
											e.preventDefault();
											const coord = parseDecimalCoord(query);
											const first = coord ?? results[0];
											if (first) {
												const store = usePlantStore.getState();
												store.setSearchMark({ lat: first.lat, lng: first.lng });
												store.setFlyTo({
													lat: first.lat,
													lng: first.lng,
													zoom: 18
												});
												setQuery("");
												setResults([]);
											}
										}
										if (e.key === "Escape") {
											setQuery("");
											setResults([]);
										}
									},
									placeholder: "Place or 40.12, -75.34",
									className: "h-10 rounded-[var(--radius-md)] bg-elevated pl-9",
									role: "combobox",
									"aria-expanded": results.length > 0,
									"aria-autocomplete": "list"
								}),
								query && results.length > 0 ? /* @__PURE__ */ jsx("ul", {
									className: "absolute top-full z-[70] mt-1 w-full overflow-hidden rounded-[var(--radius-md)] border border-border bg-elevated py-1 shadow-lg",
									children: results.map((r) => /* @__PURE__ */ jsx("li", { children: /* @__PURE__ */ jsx("button", {
										type: "button",
										className: "flex w-full px-3 py-2 text-left text-sm hover:bg-surface-2",
										onMouseDown: (e) => e.preventDefault(),
										onClick: () => {
											const store = usePlantStore.getState();
											store.setSearchMark({ lat: r.lat, lng: r.lng });
											store.setFlyTo({
												lat: r.lat,
												lng: r.lng,
												zoom: 18
											});
											setQuery("");
											setResults([]);
										},
										children: r.label
									}) }, `${r.lat},${r.lng},${r.label}`))
								}) : null,
								query && searchSettled && !searching && results.length === 0 ? /* @__PURE__ */ jsx("p", {
									className: "absolute top-full z-[70] mt-1 w-full rounded-[var(--radius-md)] border border-border bg-elevated px-3 py-2 text-sm text-muted-foreground shadow-lg",
									children: "No places found"
								}) : null,
								searching ? /* @__PURE__ */ jsx("p", {
									className: "sr-only",
									children: "Searching"
								}) : null
							]
						})]
					}), /* @__PURE__ */ jsxs("div", {
						className: "pointer-events-auto flex flex-wrap items-center justify-end gap-1.5 rounded-[var(--radius-lg)] border border-border bg-elevated p-1.5",
						children: [
							/* @__PURE__ */ jsxs(Tooltip, { children: [/* @__PURE__ */ jsx(TooltipTrigger, {
								asChild: true,
								children: /* @__PURE__ */ jsx(Button, {
									variant: gps ? "default" : "ghost",
									size: "icon",
									onClick: locate,
									"aria-label": gps ? "GPS on" : "Locate me",
									"aria-pressed": Boolean(gps),
									children: /* @__PURE__ */ jsx(LocateFixed, {})
								})
							}), /* @__PURE__ */ jsx(TooltipContent, { children: gps ? "GPS crosshair" : "My location" })] }),
							/* @__PURE__ */ jsxs(Button, {
								variant: "ghost",
								size: "sm",
								onClick: () => setBasemap((b) => b === "satellite" ? "streets" : "satellite"),
								children: [/* @__PURE__ */ jsx(Layers, { className: "size-4" }), /* @__PURE__ */ jsx("span", {
									className: "hidden sm:inline",
									children: basemap === "satellite" ? "Satellite" : "Streets"
								})]
							}),
							/* @__PURE__ */ jsxs(DropdownMenu, { children: [/* @__PURE__ */ jsx(DropdownMenuTrigger, {
								asChild: true,
								children: /* @__PURE__ */ jsx(Button, {
									variant: "ghost",
									size: "sm",
									children: "Labels"
								})
							}), /* @__PURE__ */ jsxs(DropdownMenuContent, {
								align: "end",
								className: "w-64",
								children: [
									/* @__PURE__ */ jsx(DropdownMenuItem, {
										onSelect: () => {
											const on = usePlantStore.getState().labelPlate;
											usePlantStore.getState().setLabelPlate(!on);
										},
										children: [usePlantStore((s) => s.labelPlate) ? /* @__PURE__ */ jsx(Check, { className: "size-4" }) : null, "Label box"]
									}),
									/* @__PURE__ */ jsx(DropdownMenuItem, {
										onSelect: () => {
											const changed = usePlantStore.getState().optimizeLabels();
											toast.success(changed ? "Labels adjusted for this zoom" : "Labels already clear at this zoom");
										},
										children: "Optimize labels"
									}),
									/* @__PURE__ */ jsx(DropdownMenuSeparator, {}),
									/* @__PURE__ */ jsx(DropdownMenuLabel, { children: "Cable label size" }),
									/* @__PURE__ */ jsx("div", {
										className: "flex flex-wrap gap-1 px-2 pb-2",
										children: [["sm", "Small"], ["md", "Medium"], ["lg", "Large"], ["xl", "Extra large"]].map(([size, label]) => /* @__PURE__ */ jsx("button", {
											type: "button",
											className: cn("rounded-[var(--radius-xs)] border px-2 py-1 text-xs", lines.length > 0 && lines.every((line) => (line.labelSize || "md") === size) ? "border-foreground bg-foreground text-background" : "border-border text-foreground"),
											onClick: () => usePlantStore.getState().setAllFonts("line", size),
											children: label
										}, size))
									}),
									/* @__PURE__ */ jsx(DropdownMenuLabel, { children: "Polygon label size" }),
									/* @__PURE__ */ jsx("div", {
										className: "flex flex-wrap gap-1 px-2 pb-2",
										children: [["sm", "Small"], ["md", "Medium"], ["lg", "Large"], ["xl", "Extra large"]].map(([size, label]) => /* @__PURE__ */ jsx("button", {
											type: "button",
											className: cn("rounded-[var(--radius-xs)] border px-2 py-1 text-xs", polygons.length > 0 && polygons.every((poly) => (poly.labelSize || "sm") === size) ? "border-foreground bg-foreground text-background" : "border-border text-foreground"),
											onClick: () => usePlantStore.getState().setAllFonts("polygon", size),
											children: label
										}, size))
									}),
									/* @__PURE__ */ jsx(DropdownMenuLabel, { children: "Object label size" }),
									/* @__PURE__ */ jsx("div", {
										className: "flex flex-wrap gap-1 px-2 pb-2",
										children: [["sm", "Small"], ["md", "Medium"], ["lg", "Large"], ["xl", "Extra large"]].map(([size, label]) => /* @__PURE__ */ jsx("button", {
											type: "button",
											className: cn("rounded-[var(--radius-xs)] border px-2 py-1 text-xs", points.length > 0 && points.every((point) => (point.labelSize || "lg") === size) ? "border-foreground bg-foreground text-background" : "border-border text-foreground"),
											onClick: () => usePlantStore.getState().setAllFonts("point", size),
											children: label
										}, size))
									})
								]
							})] }),
							/* @__PURE__ */ jsx(Separator, {
								orientation: "vertical",
								className: "hidden h-6 sm:block"
							}),
							/* @__PURE__ */ jsxs(Tooltip, { children: [/* @__PURE__ */ jsx(TooltipTrigger, {
								asChild: true,
								children: /* @__PURE__ */ jsx(Button, {
									variant: "ghost",
									size: "icon",
									onClick: () => usePlantStore.getState().undo(),
									disabled: past.length === 0,
									"aria-label": "Undo",
									children: /* @__PURE__ */ jsx(Undo2, {})
								})
							}), /* @__PURE__ */ jsx(TooltipContent, { children: "Undo" })] }),
							/* @__PURE__ */ jsxs(Tooltip, { children: [/* @__PURE__ */ jsx(TooltipTrigger, {
								asChild: true,
								children: /* @__PURE__ */ jsx(Button, {
									variant: "ghost",
									size: "icon",
									onClick: () => usePlantStore.getState().redo(),
									disabled: future.length === 0,
									"aria-label": "Redo",
									children: /* @__PURE__ */ jsx(Redo2, {})
								})
							}), /* @__PURE__ */ jsx(TooltipContent, { children: "Redo" })] }),
							/* @__PURE__ */ jsx("input", {
								ref: importRef,
								type: "file",
								accept: ".kmz,.kml,application/vnd.google-earth.kmz,application/vnd.google-earth.kml+xml",
								className: "hidden",
								onChange: (e) => {
									const file = e.target.files?.[0];
									if (file) onImport(file);
									e.target.value = "";
								}
							}),
							/* @__PURE__ */ jsx("input", {
								ref: overlayRef,
								type: "file",
								accept: "image/*",
								className: "hidden",
								onChange: (e) => {
									const file = e.target.files?.[0];
									if (file) usePlantStore.getState().startOverlay(file).catch(() => toast.error("Could not read image"));
									e.target.value = "";
								}
							}),
							/* @__PURE__ */ jsxs(DropdownMenu, { children: [/* @__PURE__ */ jsx(DropdownMenuTrigger, {
								asChild: true,
								children: /* @__PURE__ */ jsx(Button, {
									variant: "ghost",
									size: "icon",
									"aria-label": "File",
									children: /* @__PURE__ */ jsx(MoreHorizontal, {})
								})
							}), /* @__PURE__ */ jsxs(DropdownMenuContent, {
								align: "end",
								children: [
									/* @__PURE__ */ jsx(DropdownMenuLabel, { children: "Project" }),
									/* @__PURE__ */ jsxs(DropdownMenuItem, {
										onSelect: () => importRef.current?.click(),
										children: [/* @__PURE__ */ jsx(Upload, { className: "size-4" }), " Import KMZ / KML"]
									}),
									/* @__PURE__ */ jsx(DropdownMenuSeparator, {}),
									/* @__PURE__ */ jsxs(DropdownMenuItem, {
										onSelect: () => setClearOpen(true),
										children: [/* @__PURE__ */ jsx(Trash2, { className: "size-4" }), " Clear plant"]
									})
								]
							})] }),
							/* @__PURE__ */ jsxs(DropdownMenu, { children: [/* @__PURE__ */ jsx(DropdownMenuTrigger, {
								asChild: true,
								children: /* @__PURE__ */ jsxs(Button, {
									size: "sm",
									"aria-label": "Download",
									children: [/* @__PURE__ */ jsx(Download, { className: "size-4" }), "Download"]
								})
							}), /* @__PURE__ */ jsxs(DropdownMenuContent, {
								align: "end",
								children: [
									/* @__PURE__ */ jsx(DropdownMenuItem, { onSelect: () => void exportKmz(), children: "KMZ" }),
									/* @__PURE__ */ jsx(DropdownMenuItem, { onSelect: () => void exportPdf(), children: "PDF this screen" }),
									/* @__PURE__ */ jsx(DropdownMenuItem, { onSelect: () => { setShots([]); setShooting(true); }, children: "PDF snapshots" })
								]
							})] }),
						]
					})]
				}),
				/* @__PURE__ */ jsx(ToolDock, {
					tool,
					eggTool,
					eggPlacing,
					onTool: (t) => usePlantStore.getState().setTool(t),
					onEgg: () => usePlantStore.getState().setEggPlacing(!usePlantStore.getState().eggPlacing),
					onOverlay: () => overlayRef.current?.click()
				}),
				tool === "pedestal" || tool === "vault" || tool === "mdu" || tool === "pole" ? /* @__PURE__ */ jsxs("div", {
					className: "absolute bottom-[8.25rem] left-3 z-30 flex items-center gap-1 rounded-[var(--radius-md)] border border-border bg-elevated px-2 py-1.5 text-xs shadow-lg md:bottom-4 md:left-36",
					children: [/* @__PURE__ */ jsx("span", {
						className: "mr-1 text-muted-foreground",
						children: "Size"
					}), (tool === "pedestal" || tool === "vault" ? [["std", "Std"], ["med", "Med"], ["big", "Lg"]] : [["std", "Std"], ["big", "Lg"]]).map(([size, label]) => /* @__PURE__ */ jsx("button", {
						type: "button",
						className: cn("rounded-[var(--radius-xs)] border px-2 py-1", (tool === "pole" || tool === "mdu" ? placeSize === "big" ? "big" : "std" : placeSize) === size ? "border-foreground bg-foreground text-background" : "border-border text-foreground"),
						onClick: () => usePlantStore.getState().setPlaceSize(size === "big" ? "big" : size === "std" ? "std" : "med"),
						children: label
					}, size))]
				}) : null,
				showDraftBar ? /* @__PURE__ */ jsx("div", {
					className: "pointer-events-none absolute inset-x-0 bottom-[7.4rem] z-40 flex justify-center px-3 md:bottom-auto md:top-20",
					children: /* @__PURE__ */ jsxs("div", {
						className: "pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-[var(--radius-md)] border border-border bg-elevated px-2 py-1.5 shadow-lg",
						children: [drawingFeet != null ? /* @__PURE__ */ jsx("span", {
							className: "px-1 font-mono text-sm font-semibold tabular-nums",
							children: formatFeet(drawingFeet)
						}) : null, draft && "path" in draft && draft.path.length > 0 ? /* @__PURE__ */ jsxs(Button, {
							variant: "secondary",
							className: "h-11 px-3",
							onClick: () => usePlantStore.getState().undoDraftPoint(),
							children: [/* @__PURE__ */ jsx(Undo2, { className: "size-4" }), " Undo"]
						}) : null, canFinish ? /* @__PURE__ */ jsxs(Button, {
							className: "h-11 px-3",
							onClick: () => usePlantStore.getState().finishDraft(),
							children: [/* @__PURE__ */ jsx(Check, { className: "size-4" }), " Finish"]
						}) : null, /* @__PURE__ */ jsxs(Button, {
							variant: "ghost",
							className: "h-11 px-3",
							onClick: () => usePlantStore.getState().cancelDraft(),
							children: [/* @__PURE__ */ jsx(X, { className: "size-4" }), " Cancel"]
						})]
					})
				}) : null,
				snapPoint && isLineTool(tool) ? /* @__PURE__ */ jsxs("div", {
					className: "pointer-events-auto absolute bottom-28 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-[var(--radius-md)] border border-border bg-elevated px-3 py-2 shadow-lg md:bottom-6",
					children: [
						/* @__PURE__ */ jsxs("p", {
							className: "pr-1 text-sm",
							children: [
								"Snap to ",
								snapTargetLabel(snapPoint.kind, snapPoint.name),
								"?"
							]
						}),
						/* @__PURE__ */ jsx(Button, {
							variant: "secondary",
							size: "icon",
							className: "size-8",
							"aria-label": "Don't snap",
							onClick: () => usePlantStore.getState().dismissSnap(),
							children: /* @__PURE__ */ jsx(X, {})
						}),
						/* @__PURE__ */ jsx(Button, {
							size: "icon",
							className: "size-8",
							"aria-label": "Snap",
							onClick: () => usePlantStore.getState().confirmSnap(),
							children: /* @__PURE__ */ jsx(Check, {})
						})
					]
				}) : null,
				lineSnap && isLineTool(tool) ? /* @__PURE__ */ jsxs("div", {
					className: "pointer-events-auto absolute bottom-28 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-[var(--radius-md)] border border-border bg-elevated px-3 py-2 shadow-lg md:bottom-6",
					children: [
						/* @__PURE__ */ jsx("p", {
							className: "pr-1 text-sm whitespace-nowrap",
							children: lineSnap.kind === "end" ? "Snap to line end?" : "Snap to line?"
						}),
						/* @__PURE__ */ jsxs("label", {
							className: "flex items-center gap-1 text-xs text-muted-foreground",
							children: [/* @__PURE__ */ jsx("input", {
								type: "checkbox",
								className: "size-3.5 accent-white",
								checked: lineSnap.showDot,
								onChange: (e) => usePlantStore.getState().setLineSnapDot(e.target.checked)
							}), "Dot"]
						}),
						/* @__PURE__ */ jsx(Button, {
							variant: "secondary",
							size: "icon",
							className: "size-8",
							"aria-label": "Don't snap",
							onClick: () => usePlantStore.getState().dismissLineSnap(true),
							children: /* @__PURE__ */ jsx(X, {})
						}),
						/* @__PURE__ */ jsx(Button, {
							size: "icon",
							className: "size-8",
							"aria-label": "Snap",
							onClick: () => usePlantStore.getState().confirmLineSnap(),
							children: /* @__PURE__ */ jsx(Check, {})
						})
					]
				}) : null,
				legendOpen ? /* @__PURE__ */ jsxs("aside", {
					"data-legend": "1",
					className: "absolute right-2 bottom-[7.75rem] z-20 max-h-[calc(100dvh-16rem)] w-52 overflow-y-auto rounded-[var(--radius-md)] border border-border bg-elevated/95 px-2 py-1.5 md:right-4 md:bottom-4 md:max-h-[calc(100dvh-6rem)]",
					children: [
						totals.usedLines.length > 0 || totals.removeLines.length > 0 || totals.addPipe > 0 || totals.pullOccupied > 0 || totals.delash > 0 || totals.wreck > 0 ? /* @__PURE__ */ jsxs("ul", {
							className: "space-y-1",
							children: [totals.usedLines.map((preset) => /* @__PURE__ */ jsxs("li", {
								className: "flex items-baseline justify-between gap-2",
								children: [/* @__PURE__ */ jsxs("span", {
									className: "flex min-w-0 items-center gap-1.5 text-xs",
									children: [/* @__PURE__ */ jsx("span", {
										className: "inline-block h-0.5 w-3.5 shrink-0 rounded-full",
										style: { background: preset.color }
									}), /* @__PURE__ */ jsx("span", {
										className: "truncate",
										children: preset.short
									})]
								}), /* @__PURE__ */ jsx("span", {
									className: "font-mono text-xs tabular-nums text-muted-foreground",
									children: formatFeet(totals.footage[preset.id])
								})]
							}, preset.id)), totals.addPipe > 0 ? /* @__PURE__ */ jsxs("li", {
								className: "flex items-baseline justify-between gap-2",
								children: [/* @__PURE__ */ jsxs("span", {
									className: "flex min-w-0 items-center gap-1.5 text-xs",
									children: [/* @__PURE__ */ jsx("span", {
										className: "inline-block h-0.5 w-3.5 shrink-0 rounded-full",
										style: { background: linePreset("ug-new").color }
									}), /* @__PURE__ */ jsx("span", {
										className: "truncate",
										children: "addt. Pipe/width"
									})]
								}), /* @__PURE__ */ jsx("span", {
									className: "font-mono text-xs tabular-nums text-muted-foreground",
									children: formatFeet(totals.addPipe)
								})]
							}) : null, totals.pullOccupied > 0 ? /* @__PURE__ */ jsxs("li", {
								className: "flex items-baseline justify-between gap-2",
								children: [/* @__PURE__ */ jsxs("span", {
									className: "flex min-w-0 items-center gap-1.5 text-xs",
									children: [/* @__PURE__ */ jsx("span", {
										className: "inline-block h-0.5 w-3.5 shrink-0 rounded-full",
										style: { background: linePreset("ug-pull").color }
									}), /* @__PURE__ */ jsx("span", {
										className: "truncate",
										children: "Pull occupied"
									})]
								}), /* @__PURE__ */ jsx("span", {
									className: "font-mono text-xs tabular-nums text-muted-foreground",
									children: formatFeet(totals.pullOccupied)
								})]
							}) : null, totals.delash > 0 ? /* @__PURE__ */ jsxs("li", {
								className: "flex items-baseline justify-between gap-2",
								children: [/* @__PURE__ */ jsxs("span", {
									className: "flex min-w-0 items-center gap-1.5 text-xs",
									children: [/* @__PURE__ */ jsx("span", {
										className: "inline-block h-0.5 w-3.5 shrink-0 rounded-full",
										style: { background: "#f472b6" }
									}), /* @__PURE__ */ jsx("span", {
										className: "truncate",
										children: "Delash"
									})]
								}), /* @__PURE__ */ jsx("span", {
									className: "font-mono text-xs tabular-nums text-muted-foreground",
									children: formatFeet(totals.delash)
								})]
							}) : null, totals.wreck > 0 ? /* @__PURE__ */ jsxs("li", {
								className: "flex items-baseline justify-between gap-2",
								children: [/* @__PURE__ */ jsxs("span", {
									className: "flex min-w-0 items-center gap-1.5 text-xs",
									children: [/* @__PURE__ */ jsx("span", {
										className: "inline-block h-0.5 w-3.5 shrink-0 rounded-full",
										style: { background: "#fb7185" }
									}), /* @__PURE__ */ jsx("span", {
										className: "whitespace-normal leading-tight",
										children: "partial wreck out"
									})]
								}), /* @__PURE__ */ jsx("span", {
									className: "font-mono text-xs tabular-nums text-muted-foreground",
									children: formatFeet(totals.wreck)
								})]
							}) : null, totals.removeLines.map((preset) => /* @__PURE__ */ jsxs("li", {
								className: "flex items-baseline justify-between gap-2",
								children: [/* @__PURE__ */ jsxs("span", {
									className: "flex min-w-0 items-center gap-1.5 text-xs",
									children: [/* @__PURE__ */ jsxs("svg", {
										width: "16",
										height: "10",
										viewBox: "0 0 16 10",
										className: "shrink-0",
										"aria-hidden": true,
										children: [/* @__PURE__ */ jsx("line", {
											x1: "0",
											y1: "5",
											x2: "16",
											y2: "5",
											stroke: preset.color,
											strokeWidth: "2.5",
											strokeLinecap: "round"
										}), /* @__PURE__ */ jsx("line", {
											x1: "3",
											y1: "9",
											x2: "6.5",
											y2: "1",
											stroke: "#dc2626",
											strokeWidth: "1.4"
										}), /* @__PURE__ */ jsx("line", {
											x1: "8.5",
											y1: "9",
											x2: "12",
											y2: "1",
											stroke: "#ffffff",
											strokeWidth: "1.4"
										})]
									}), /* @__PURE__ */ jsx("span", {
										className: "truncate",
										children: `remove ${preset.short}`
									})]
								}), /* @__PURE__ */ jsx("span", {
									className: "font-mono text-xs tabular-nums text-muted-foreground",
									children: formatFeet(totals.removeFootage[preset.id])
								})]
							}, `remove-${preset.id}`))]
						}) : null,
						totals.cables.length > 0 ? /* @__PURE__ */ jsx("ul", {
							className: "mt-1.5 space-y-1 border-t border-border pt-1.5",
							children: totals.cables.map((cable) => /* @__PURE__ */ jsxs("li", {
								className: "flex items-baseline justify-between gap-2",
								children: [/* @__PURE__ */ jsx("span", {
									className: "text-xs",
									children: cable.label
								}), /* @__PURE__ */ jsx("span", {
									className: "font-mono text-xs tabular-nums text-muted-foreground",
									children: formatFeet(cable.feet)
								})]
							}, cable.id))
						}) : null,
						totals.usedPoints.length > 0 ? /* @__PURE__ */ jsx("ul", {
							className: cn("grid grid-cols-2 gap-x-2 gap-y-1", totals.usedLines.length > 0 && "mt-1.5 border-t border-border pt-1.5"),
							children: totals.usedPoints.map((preset) => {
								const Glyph = POINT_GLYPH[preset.id];
								return /* @__PURE__ */ jsxs("li", {
									className: "flex items-center gap-1 text-xs",
									children: [
										/* @__PURE__ */ jsx(Glyph, {}),
										/* @__PURE__ */ jsx("span", {
											className: "text-muted-foreground",
											children: preset.short
										}),
										/* @__PURE__ */ jsx("span", {
											className: "font-mono tabular-nums",
											children: totals.counts[preset.id]
										})
									]
								}, preset.id);
							})
						}) : null,
						totals.risers > 0 || totals.anchors > 0 ? /* @__PURE__ */ jsxs("ul", {
							className: "mt-1.5 space-y-1 border-t border-border pt-1.5",
							children: [
								totals.risers > 0 ? /* @__PURE__ */ jsxs("li", {
									className: "flex items-center justify-between gap-2 text-xs",
									children: [/* @__PURE__ */ jsx("span", {
										className: "legend-riser",
										"aria-label": "Riser",
										children: "R"
									}), /* @__PURE__ */ jsx("span", {
										className: "font-mono tabular-nums text-muted-foreground",
										children: totals.risers
									})]
								}) : null,
								totals.anchors > 0 ? /* @__PURE__ */ jsxs("li", {
									className: "flex items-center justify-between gap-2 text-xs",
									children: [/* @__PURE__ */ jsx("span", {
										className: "legend-anchor",
										"aria-label": "Anchor"
									}), /* @__PURE__ */ jsx("span", {
										className: "font-mono tabular-nums text-muted-foreground",
										children: totals.anchors
									})]
								}) : null
							]
						}) : null,
						totals.peds.length > 0 ? /* @__PURE__ */ jsx("ul", {
							className: cn("space-y-1", (totals.usedLines.length > 0 || totals.usedPoints.length > 0 || totals.risers > 0 || totals.anchors > 0) && "mt-1.5 border-t border-border pt-1.5"),
							children: totals.peds.map((ped) => /* @__PURE__ */ jsxs("li", {
								className: "flex items-center justify-between gap-2 text-xs",
								children: [/* @__PURE__ */ jsxs("span", {
									className: "flex min-w-0 items-center gap-1.5",
									children: [
										/* @__PURE__ */ jsx("span", {
											className: cn("inline-flex shrink-0 items-center justify-center border border-foreground font-sans text-[8px] font-semibold leading-none", ped.id === "s" && "rounded-[3px]", ped.id === "dh" || ped.id === "dd" ? "h-3 w-4" : ped.id === "l" ? "h-2.5 w-3.5" : "size-3"),
											style: { background: pedestalColor(ped.id).fill, color: pedestalColor(ped.id).ink },
											children: PED_TYPES.find((type) => type.id === ped.id)?.letter
										}),
										/* @__PURE__ */ jsx("span", {
											className: "leading-tight",
											children: ped.label
										})
									]
								}), /* @__PURE__ */ jsx("span", {
									className: "font-mono tabular-nums text-muted-foreground",
									children: ped.count
								})]
							}, ped.id))
						}) : null,
						totals.vaults.length > 0 ? /* @__PURE__ */ jsx("ul", {
							className: cn("space-y-1", (totals.usedLines.length > 0 || totals.usedPoints.length > 0 || totals.peds.length > 0 || totals.risers > 0 || totals.anchors > 0) && "mt-1.5 border-t border-border pt-1.5"),
							children: totals.vaults.map((vault) => /* @__PURE__ */ jsxs("li", {
								className: "flex items-center justify-between gap-2 text-xs",
								children: [/* @__PURE__ */ jsxs("span", {
									className: "flex min-w-0 items-center gap-1.5",
									children: [
										/* @__PURE__ */ jsx("span", {
											className: "inline-flex size-3 shrink-0 items-center justify-center border border-foreground font-sans text-[7px] font-semibold leading-none",
											style: {
												background: vaultColor(vault.id).fill,
												color: vaultColor(vault.id).ink,
												clipPath: vault.id === "s" ? "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)" : undefined
											},
											children: "V"
										}),
										/* @__PURE__ */ jsx("span", {
											className: "leading-tight",
											children: vault.label
										})
									]
								}), /* @__PURE__ */ jsx("span", {
									className: "font-mono tabular-nums text-muted-foreground",
									children: vault.count
								})]
							}, vault.id))
						}) : null
					]
				}) : null,
				selectedLine || selectedPoint || selectedPolygon || selectedOverlay || selectedNote || selectedFrame || selectedBoard || selectedCallout ? /* @__PURE__ */ jsx(Inspector, {
					line: selectedCallout ? null : selectedLine,
					point: selectedPoint,
					polygon: selectedPolygon,
					overlay: selectedOverlay,
					note: selectedNote,
					frame: selectedFrame,
					board: selectedBoard,
					callout: selectedCallout
				}) : null,
				/* @__PURE__ */ jsx(Dialog, {
					open: clearOpen,
					onOpenChange: setClearOpen,
					children: /* @__PURE__ */ jsxs(DialogContent, { children: [/* @__PURE__ */ jsxs(DialogHeader, { children: [/* @__PURE__ */ jsx(DialogTitle, { children: "Clear this plant?" }), /* @__PURE__ */ jsx(DialogDescription, { children: "Lines, equipment, and overlays will be removed from this project." })] }), /* @__PURE__ */ jsxs("div", {
						className: "flex justify-end gap-2",
						children: [/* @__PURE__ */ jsx(Button, {
							variant: "secondary",
							onClick: () => setClearOpen(false),
							children: "Keep"
						}), /* @__PURE__ */ jsx(Button, {
							variant: "destructive",
							onClick: () => {
								usePlantStore.getState().clearProject();
								setClearOpen(false);
							},
							children: "Clear"
						})]
					})] })
				}),
				/* @__PURE__ */ jsx(Toaster, {
					theme: "dark",
					position: "bottom-left"
				}),
				eggOpen ? /* @__PURE__ */ jsx(BucketRun, { onClose: () => usePlantStore.getState().closeEgg() }) : null
			]
		})
	});
}
function ToolDock({ tool, onTool, onOverlay, eggTool, eggPlacing, onEgg }) {
	const eggButton = (compact) => eggTool ? /* @__PURE__ */ jsx(DockButton, {
		compact,
		active: eggPlacing,
		onClick: onEgg,
		label: "Egg",
		icon: /* @__PURE__ */ jsx("span", { className: "egg-body egg-tool" })
	}) : null;
	return /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsxs("nav", {
		className: "absolute top-1/2 left-2 z-20 hidden max-h-[calc(100dvh-2rem)] w-28 -translate-y-1/2 flex-col gap-0.5 overflow-y-auto rounded-[var(--radius-md)] border border-border bg-elevated/95 p-1 md:flex",
		children: [
			/* @__PURE__ */ jsx(DockButton, {
				active: tool === "select",
				onClick: () => onTool("select"),
				label: "Select",
				icon: /* @__PURE__ */ jsx(MousePointer2, { className: "size-3.5" })
			}),
			/* @__PURE__ */ jsx("p", {
				className: "mt-0.5 px-2 pt-1 text-xs tracking-wide text-muted-foreground uppercase",
				children: "Lines"
			}),
			LINE_PRESETS.map((p) => /* @__PURE__ */ jsx(DockButton, {
				active: tool === p.id,
				onClick: () => onTool(p.id),
				label: p.label,
				swatch: p.id === "aerial-new" ? AERIAL_SWATCH : p.color
			}, p.id)),
			/* @__PURE__ */ jsx("p", {
				className: "mt-0.5 px-2 pt-1 text-xs tracking-wide text-muted-foreground uppercase",
				children: "Objects"
			}),
			POINT_PRESETS.map((p) => {
				const Glyph = POINT_GLYPH[p.id];
				return /* @__PURE__ */ jsx(DockButton, {
					active: tool === p.id,
					onClick: () => onTool(p.id),
					label: p.label,
					icon: /* @__PURE__ */ jsx(Glyph, {})
				}, p.id);
			}),
			eggButton(false),
			/* @__PURE__ */ jsx(Separator, { className: "my-1" }),
			/* @__PURE__ */ jsx(AdvancedMenu, {
				tool,
				onTool,
				onOverlay
			})
		]
	}), /* @__PURE__ */ jsxs("nav", {
		className: "absolute inset-x-0 bottom-0 z-30 border-t border-border bg-elevated p-2 md:hidden",
		children: [/* @__PURE__ */ jsxs("div", {
			className: "flex gap-1 overflow-x-auto pb-1",
			children: [/* @__PURE__ */ jsx(DockButton, {
				compact: true,
				active: tool === "select",
				onClick: () => onTool("select"),
				label: "Select",
				icon: /* @__PURE__ */ jsx(MousePointer2, { className: "size-3.5" })
			}), LINE_PRESETS.map((p) => /* @__PURE__ */ jsx(DockButton, {
				compact: true,
				active: tool === p.id,
				onClick: () => onTool(p.id),
				label: p.label,
				swatch: p.id === "aerial-new" ? AERIAL_SWATCH : p.color
			}, p.id))]
		}), /* @__PURE__ */ jsxs("div", {
			className: "flex gap-1 overflow-x-auto",
			children: [POINT_PRESETS.map((p) => {
				const Glyph = POINT_GLYPH[p.id];
				return /* @__PURE__ */ jsx(DockButton, {
					compact: true,
					active: tool === p.id,
					onClick: () => onTool(p.id),
					label: p.label,
					icon: /* @__PURE__ */ jsx(Glyph, {})
				}, p.id);
			}), eggButton(true), /* @__PURE__ */ jsx(AdvancedMenu, {
				tool,
				onTool,
				onOverlay,
				compact: true
			})]
		})]
	})] });
}
function DockButton({ active, onClick, label, swatch, icon, compact }) {
	return /* @__PURE__ */ jsxs("button", {
		type: "button",
		onClick,
		className: cn("flex shrink-0 items-center gap-2 rounded-[var(--radius-sm)] px-2 text-left text-xs transition-colors duration-[var(--motion-quick)]", compact ? "min-h-11 min-w-14 flex-col justify-center gap-1 py-1.5" : "min-h-8 w-full", active ? "bg-surface-2 text-foreground" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"),
		children: [swatch ? /* @__PURE__ */ jsx("span", {
			className: "h-0.5 w-5 rounded-full",
			style: { background: swatch }
		}) : icon, /* @__PURE__ */ jsx("span", {
			className: "leading-none",
			children: label
		})]
	});
}
function AdvancedMenu({ tool, onTool, onOverlay, compact }) {
	return /* @__PURE__ */ jsxs(DropdownMenu, { children: [/* @__PURE__ */ jsx(DropdownMenuTrigger, {
		asChild: true,
		children: /* @__PURE__ */ jsxs("button", {
			type: "button",
			className: cn("flex min-h-8 w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 text-left text-xs text-muted-foreground hover:bg-surface-2 hover:text-foreground", compact && "min-h-11 min-w-14 w-auto flex-col justify-center", (tool === "line" || tool === "polygon" || tool === "overlay" || tool === "pin" || tool === "frame" || tool === "in-4" || tool === "in-2" || tool === "in-075" || tool === "road") && "bg-surface-2 text-foreground"),
			children: [/* @__PURE__ */ jsx(ChevronDown, { className: "size-3.5" }), /* @__PURE__ */ jsx("span", { children: "Advanced" })]
		})
	}), /* @__PURE__ */ jsxs(DropdownMenuContent, {
		side: compact ? "top" : "right",
		align: "start",
		children: [
			/* @__PURE__ */ jsx(DropdownMenuLabel, { children: "Hidden tools" }),
			CONDUIT_PRESETS.map((p) => /* @__PURE__ */ jsxs(DropdownMenuItem, {
				onSelect: () => onTool(p.id),
				children: [/* @__PURE__ */ jsx("span", {
					className: "h-0.5 w-4 rounded-full",
					style: { background: p.color }
				}), p.label]
			}, p.id)),
			/* @__PURE__ */ jsxs(DropdownMenuItem, {
				onSelect: () => onTool(ROAD_PRESET.id),
				children: [/* @__PURE__ */ jsx("span", {
					className: "h-1.5 w-4 rounded-full",
					style: { background: ROAD_PRESET.color }
				}), "Road"]
			}),
			/* @__PURE__ */ jsx(DropdownMenuSeparator, {}),
			/* @__PURE__ */ jsxs(DropdownMenuItem, {
				onSelect: () => onTool("pin"),
				children: [/* @__PURE__ */ jsx(MapPin, { className: "size-4" }), " Pin"]
			}),
			/* @__PURE__ */ jsxs(DropdownMenuItem, {
				onSelect: () => onTool("frame"),
				children: [/* @__PURE__ */ jsx(Scan, { className: "size-4" }), " Frame · pdf only"]
			}),
			/* @__PURE__ */ jsxs(DropdownMenuItem, {
				onSelect: () => onTool("line"),
				children: [/* @__PURE__ */ jsx(Spline, { className: "size-4" }), " Line"]
			}),
			/* @__PURE__ */ jsxs(DropdownMenuItem, {
				onSelect: () => onTool("polygon"),
				children: [/* @__PURE__ */ jsx(Pentagon, { className: "size-4" }), " Polygon"]
			}),
			/* @__PURE__ */ jsxs(DropdownMenuItem, {
				onSelect: onOverlay,
				children: [/* @__PURE__ */ jsx(ImagePlus, { className: "size-4" }), " Image overlay"]
			})
		]
	})] });
}
function setLineSlot(line, slot, id) {
	const slot1 = slot === 1 ? line.slot1 === id ? "" : id : line.slot1;
	const slot2 = slot === 2 ? line.slot2 === id ? "" : id : line.slot2;
	usePlantStore.getState().updateLine(line.id, {
		slot1,
		slot2,
		cables: [slot1, slot2].filter(isCableType),
		emptyPipe: false,
		strandOnly: false
	});
}
function slotCableName(line, slot) {
	const id = slot === 1 ? line.slot1 : line.slot2;
	if (id === "empty") return "Empty";
	if (id === "fiber") {
		const count = String(slot === 1 ? line.fiberCount : line.fiberCount2).trim();
		return count ? `${count}ct` : "Fiber";
	}
	return cableChoices(line.kind).find((choice) => choice.id === id)?.label ?? `Line ${slot}`;
}
function Inspector({ line, point, polygon, overlay, note, frame, board, callout }) {
	const lines = usePlantStore((s) => s.lines);
	const points = usePlantStore((s) => s.points);
	const notes = usePlantStore((s) => s.notes);
	if (note || board || frame || callout) {
		const title = note ? `Reference ${note.n} · pdf only` : frame ? "Frame · pdf only" : callout ? "Call out" : "Instructions · pdf only";
		return /* @__PURE__ */ jsxs("div", {
			className: "inspector-panel absolute top-[9.25rem] bottom-[9.5rem] left-2 z-30 w-[11rem] overflow-y-auto overscroll-contain rounded-[var(--radius-md)] border border-border bg-elevated/95 p-1.5 shadow-lg md:top-20 md:bottom-auto md:left-auto md:right-3 md:max-h-[calc(100dvh-12rem)] md:w-48",
			children: [
				/* @__PURE__ */ jsx("p", { className: "text-sm font-medium", children: title }),
				note ? /* @__PURE__ */ jsxs("div", {
					className: "mt-2",
					children: [
						/* @__PURE__ */ jsx("p", { className: "text-xs text-muted-foreground", children: "Number location" }),
						/* @__PURE__ */ jsx("div", {
							className: "mt-1 flex flex-wrap gap-1",
							children: [["top", "Top"], ["bottom", "Bottom"], ["left", "Left"], ["right", "Right"]].map(([side, label]) => /* @__PURE__ */ jsx("button", {
								type: "button",
								className: cn("rounded-[var(--radius-xs)] border px-2 py-1 text-xs", (note.side || "top") === side ? "border-foreground bg-foreground text-background" : "border-border"),
								onClick: () => usePlantStore.getState().updateNote(note.id, { side }),
								children: label
							}, side))
						}),
						/* @__PURE__ */ jsxs("label", {
							className: "mt-2 flex items-center gap-2 text-xs",
							children: [/* @__PURE__ */ jsx("input", {
								type: "checkbox",
								className: "size-3.5 accent-white",
								checked: note.callout,
								onChange: (e) => usePlantStore.getState().updateNote(note.id, { callout: e.target.checked })
							}), "Call out"]
						}),
						note.target?.type === "line" ? (() => {
							const host = lines.find((item) => item.id === note.target?.id);
							const count = host ? footageSpans(host.path, points.filter((item) => item.kind === "pedestal" || item.kind === "vault" || item.kind === "mdu" || item.kind === "pole").map((item) => item.position), host.splits ?? [], (host.dots ?? []).map((dot) => dot.at)).length : 0;
							if (count < 2) return null;
							const span = Math.max(0, Math.min(count - 1, note.span || 0));
							return /* @__PURE__ */ jsxs("div", {
								className: "mt-2 flex items-center gap-1",
								children: [
									/* @__PURE__ */ jsx("button", {
										type: "button",
										className: "rounded-[var(--radius-xs)] border border-border px-2 py-1 text-xs",
										onClick: () => usePlantStore.getState().updateNote(note.id, { span: span - 1 }),
										children: "←"
									}),
									/* @__PURE__ */ jsxs("span", { className: "text-xs text-muted-foreground", children: ["Span ", span + 1, " / ", count] }),
									/* @__PURE__ */ jsx("button", {
										type: "button",
										className: "rounded-[var(--radius-xs)] border border-border px-2 py-1 text-xs",
										onClick: () => usePlantStore.getState().updateNote(note.id, { span: span + 1 }),
										children: "→"
									})
								]
							});
						})() : null
					]
				}) : null,
				board ? /* @__PURE__ */ jsxs("div", {
					className: "mt-2",
					children: [
						/* @__PURE__ */ jsx("p", { className: "text-xs text-muted-foreground", children: "Instructions · pdf only" }),
						notes.slice().sort((a, b) => a.n - b.n).map((item) => /* @__PURE__ */ jsxs("label", {
							className: "mt-2 block",
							children: [
								/* @__PURE__ */ jsxs("span", { className: "text-xs text-muted-foreground", children: [item.n, "."] }),
								/* @__PURE__ */ jsx("textarea", {
									className: cn(fieldClass, "mt-1 min-h-14 resize-y"),
									placeholder: "Instruction",
									value: item.text,
									onChange: (e) => usePlantStore.getState().updateNote(item.id, { text: e.target.value })
								})
							]
						}, item.id)),
						/* @__PURE__ */ jsx("p", { className: "mt-2 text-xs text-muted-foreground", children: "Panel" }),
						/* @__PURE__ */ jsx("div", {
							className: "mt-1 flex flex-wrap gap-1",
							children: [[0, "0%"], [0.25, "25%"], [0.5, "50%"], [0.75, "75%"], [1, "100%"]].map(([opacity, label]) => /* @__PURE__ */ jsx("button", {
								type: "button",
								className: cn("rounded-[var(--radius-xs)] border px-2 py-1 text-xs", board.opacity === opacity ? "border-foreground bg-foreground text-background" : "border-border"),
								onClick: () => usePlantStore.getState().updateBoard({ opacity }),
								children: label
							}, label))
						}),
						/* @__PURE__ */ jsx("p", { className: "mt-2 text-[11px] text-muted-foreground", children: "The list stays the size you make it. Zooming the map scales it with the ground. It shows only the instructions you type." })
					]
				}) : null,
				frame ? /* @__PURE__ */ jsxs("div", {
					className: "mt-2",
					children: [
						/* @__PURE__ */ jsx("p", { className: "text-xs text-muted-foreground", children: `Window · pdf only · ${Math.round(frame.closer * 100)}% closer than the map` }),
						/* @__PURE__ */ jsxs("div", {
							className: "mt-1 flex gap-1",
							children: [
								/* @__PURE__ */ jsx("button", {
									type: "button",
									className: "rounded-[var(--radius-xs)] border border-border px-2 py-1 text-xs",
									onClick: () => usePlantStore.getState().updateFrame(frame.id, { closer: Math.max(0, frame.closer - 0.1) }),
									children: "Farther"
								}),
								/* @__PURE__ */ jsx("button", {
									type: "button",
									className: "rounded-[var(--radius-xs)] border border-border px-2 py-1 text-xs",
									onClick: () => usePlantStore.getState().updateFrame(frame.id, { closer: Math.min(3, frame.closer + 0.1) }),
									children: "Closer"
								})
							]
						}),
						/* @__PURE__ */ jsxs("label", {
							className: "mt-2 flex items-center gap-2 text-xs",
							children: [/* @__PURE__ */ jsx("input", {
								type: "checkbox",
								className: "size-3.5 accent-white",
								checked: frame.liftLabels === true,
								onChange: (e) => usePlantStore.getState().updateFrame(frame.id, { liftLabels: e.target.checked })
							}), "Move callouts into this window"]
						}),
						/* @__PURE__ */ jsx("p", { className: "mt-2 text-xs text-muted-foreground", children: "Dotted line" }),
						/* @__PURE__ */ jsx("div", {
							className: "mt-1 flex flex-wrap gap-1",
							children: ["#f5d90a", "#ffffff", "#fb923c", "#f87171", "#f472b6", "#38bdf8", "#4ade80"].map((color) => /* @__PURE__ */ jsx("button", {
								type: "button",
								className: cn("size-5 rounded-full border", (frame.linkColor || "#f5d90a") === color ? "border-white" : "border-black/40"),
								style: { background: color },
								"aria-label": `Line color ${color}`,
								onClick: () => usePlantStore.getState().updateFrame(frame.id, { linkColor: color })
							}, color))
						}),
						/* @__PURE__ */ jsx("p", { className: "mt-2 text-[11px] text-muted-foreground", children: "Select the frame, then drag the dotted box to move what is framed. Drag the window to move the zoomed view. Both stay where you leave them." })
					]
				}) : null,
				callout ? /* @__PURE__ */ jsx("p", { className: "mt-2 text-[11px] text-muted-foreground", children: "Delete removes this call out. The line stays." }) : null,
				note || frame || callout ? /* @__PURE__ */ jsxs(Button, {
					variant: "secondary",
					size: "sm",
					className: "mt-3 w-full",
					onClick: () => usePlantStore.getState().deleteSelection(),
					children: [/* @__PURE__ */ jsx(Trash2, { className: "size-4" }), " Delete"]
				}) : null,
				/* @__PURE__ */ jsx(Button, {
					variant: "secondary",
					size: "sm",
					className: "mt-3 w-full",
					onClick: () => usePlantStore.getState().clearSelection(),
					children: "Done"
				})
			]
		});
	}
	const title = line ? line.kind === "aerial-new" ? "Aerial" : linePreset(line.kind).fullLabel : point ? pointPreset(point.kind).fullLabel : polygon ? "Polygon" : "Image overlay";
	const accent = line ? linePaint(line) : point ? pointLabelColor(point.kind) : "#d4d4d8";
	const calloutCount = line ? line.kind === "road" ? 1 : Math.max(1, footageSpans(line.path, points.filter((item) => item.kind === "pedestal" || item.kind === "vault" || item.kind === "mdu" || item.kind === "pole").map((item) => item.position), line.splits ?? [], (line.dots ?? []).map((dot) => dot.at)).length) : 1;
	const compass = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
	function confirm() {
		usePlantStore.getState().clearSelection();
	}
	return /* @__PURE__ */ jsxs("div", {
		className: "inspector-panel absolute top-[9.25rem] bottom-[9.5rem] left-2 z-30 w-[11rem] overflow-y-auto overscroll-contain rounded-[var(--radius-md)] border border-border bg-elevated/95 p-1.5 shadow-lg md:top-20 md:bottom-auto md:left-auto md:right-3 md:max-h-[calc(100dvh-12rem)] md:w-48",
		children: [
			/* @__PURE__ */ jsxs("div", {
				className: "flex items-start justify-between gap-2",
				children: [/* @__PURE__ */ jsx("p", {
					className: "pt-1 text-xs tracking-wide uppercase",
					style: { color: accent },
					children: title
				}), /* @__PURE__ */ jsx(Button, {
					size: "icon",
					className: "size-8 shrink-0",
					onClick: confirm,
					"aria-label": "Done",
					children: /* @__PURE__ */ jsx(Check, {})
				})]
			}),
			line ? /* @__PURE__ */ jsxs(Fragment, { children: [
				line.kind === "road" ? null : /* @__PURE__ */ jsx("p", {
					className: "mt-1 font-mono text-lg tabular-nums",
					style: { color: accent },
					children: formatFeet(reportedFeet(line))
				}),
				/* @__PURE__ */ jsxs("p", {
					className: "mt-1 text-xs text-muted-foreground",
					children: [
						line.path.length,
						" vertices · ",
						line.kind === "drop" ? "1.5" : line.kind === "road" ? "12" : line.kind === "line" ? String(lineWeightOf(line)) : "3",
						"-pt stroke"
					]
				}),
				/* @__PURE__ */ jsxs("div", {
					className: "mt-2 flex flex-wrap items-center gap-1",
					children: [
						/* @__PURE__ */ jsx("span", {
							className: "mr-1 text-xs text-muted-foreground",
							children: "Font"
						}),
						[["sm", "S"], ["md", "M"], ["lg", "L"], ["xl", "XL"]].map(([size, label]) => /* @__PURE__ */ jsx("button", {
							type: "button",
							className: cn("rounded-[var(--radius-xs)] border px-2 py-1 text-xs", (line.labelSize || "md") === size ? "border-foreground bg-foreground text-background" : "border-border text-foreground"),
							onClick: () => {
								const next = size === "xs" || size === "sm" || size === "lg" || size === "xl" ? size : "md";
								usePlantStore.getState().setLabelSize(next);
								usePlantStore.getState().updateLine(line.id, { labelSize: next });
							},
							children: label
						}, size))
					]
				}),
				line.kind === "line" ? /* @__PURE__ */ jsxs("div", {
					className: "mt-2",
					children: [
						/* @__PURE__ */ jsx("p", { className: "text-xs text-muted-foreground", children: "Color" }),
						/* @__PURE__ */ jsx("div", {
							className: "mt-1 flex flex-wrap gap-1",
							children: LINE_INK_COLORS.map((color) => /* @__PURE__ */ jsx("button", {
								type: "button",
								className: "size-5 rounded-full border",
								style: { background: color, borderColor: linePaint(line) === color ? "#fff" : color === "#ffffff" ? "#52525b" : "transparent" },
								"aria-label": `Line color ${color}`,
								onClick: () => {
									usePlantStore.getState().setLineInk({ color });
									usePlantStore.getState().updateLine(line.id, { stroke: color });
								}
							}, color))
						}),
						/* @__PURE__ */ jsx("p", { className: "mt-2 text-xs text-muted-foreground", children: "Thickness" }),
						/* @__PURE__ */ jsx("div", {
							className: "mt-1 flex gap-1",
							children: LINE_INK_WEIGHTS.map((weight) => /* @__PURE__ */ jsx("button", {
								type: "button",
								className: cn("rounded-[var(--radius-xs)] border px-2 py-1 text-xs", lineWeightOf(line) === weight ? "border-foreground bg-foreground text-background" : "border-border text-foreground"),
								onClick: () => {
									usePlantStore.getState().setLineInk({ weight });
									usePlantStore.getState().updateLine(line.id, { weight });
								},
								children: weight
							}, weight))
						}),
						/* @__PURE__ */ jsxs("label", {
							className: "mt-2 flex items-center gap-2 text-xs",
							children: [/* @__PURE__ */ jsx("input", {
								type: "checkbox",
								className: "size-3.5 accent-white",
								checked: line.hideFootage === true,
								onChange: (e) => usePlantStore.getState().updateLine(line.id, { hideFootage: e.target.checked })
							}), "Hide footage"]
						}),
						/* @__PURE__ */ jsxs("label", {
							className: "mt-2 flex items-center gap-2 text-xs",
							children: [/* @__PURE__ */ jsx("input", {
								type: "checkbox",
								className: "size-3.5 accent-white",
								checked: line.existing === true,
								onChange: (e) => usePlantStore.getState().updateLine(line.id, { existing: e.target.checked, mark: e.target.checked ? line.mark : "" })
							}), "Existing"]
						}),
						line.existing ? /* @__PURE__ */ jsx("div", {
							className: "mt-1 flex gap-1",
							children: [["ae", "AE"], ["ug", "UG"]].map(([id, label]) => /* @__PURE__ */ jsxs("label", {
								className: "flex items-center gap-1 text-xs",
								children: [/* @__PURE__ */ jsx("input", {
									type: "checkbox",
									className: "size-3.5 accent-white",
									checked: line.mark === id,
									onChange: () => usePlantStore.getState().updateLine(line.id, { mark: line.mark === id ? "" : id })
								}), label]
							}, id))
						}) : null
					]
				}) : null,
				line.kind === "aerial-new" ? /* @__PURE__ */ jsxs("div", {
					className: "mt-3 space-y-1",
					children: [/* @__PURE__ */ jsx("p", {
						className: "text-[10px] font-semibold tracking-wide text-muted-foreground uppercase",
						children: "Choose one"
					}), /* @__PURE__ */ jsxs("div", {
						className: "grid grid-cols-2 gap-1 rounded-full bg-black/55 p-1",
						children: [["new", "New", "#ea580c"], ["work", "Lash/OL", "#db2777"]].map(([mode, label, color]) => /* @__PURE__ */ jsx("button", {
							type: "button",
							className: cn("rounded-full px-2 py-1.5 text-xs font-semibold", (line.aerialMode === "work" ? "work" : "new") === mode ? "text-white shadow" : "text-muted-foreground"),
							style: (line.aerialMode === "work" ? "work" : "new") === mode ? { background: color } : undefined,
							onClick: () => {
								const next = mode === "work" ? "work" : "new";
								if ((line.aerialMode === "work" ? "work" : "new") === next) return;
								usePlantStore.getState().updateLine(line.id, {
									aerialMode: next,
									strandOnly: false,
									cables: [],
									slot1: "",
									slot2: "",
									fiberCount: "",
									fiberCount2: "",
									cableWork: [],
									workOps: [],
									pipeRoles: [],
									emptyPipe: false,
									wreckOut: false
								});
							},
							children: label
						}, mode))
					}), line.aerialMode !== "work" ? null : line.cables.length === 0 && !(line.parallel && (line.slot1 || line.slot2)) ? /* @__PURE__ */ jsxs("div", {
						className: "flex gap-1",
						children: [["de", "De"], ["re", "Lash"], ["ol", "OL"]].map(([op, label]) => /* @__PURE__ */ jsx("button", {
							type: "button",
							className: cn("rounded-[var(--radius-xs)] border px-2 py-1 text-xs", (line.workOps ?? []).includes(op) ? "border-foreground bg-foreground text-background" : "border-border text-foreground"),
							onClick: () => {
								const has = (line.workOps ?? []).includes(op);
								const workOps = ["de", "re", "ol"].filter((item) => item === op ? !has : (line.workOps ?? []).includes(item));
								usePlantStore.getState().updateLine(line.id, { workOps });
							},
							children: label
						}, op))
					}) : null]
				}) : null,
				/* @__PURE__ */ jsxs("label", {
					className: "mt-2 flex items-center gap-2 text-xs",
					children: [/* @__PURE__ */ jsx("input", {
						type: "checkbox",
						className: "size-3.5 accent-white",
						checked: line.callout === true,
						onChange: (e) => usePlantStore.getState().updateLine(line.id, { callout: e.target.checked })
					}), "Callout"]
				}),
				line.callout ? /* @__PURE__ */ jsx("div", {
					className: "mt-1 space-y-1",
					children: Array.from({ length: calloutCount }, (_, index) => /* @__PURE__ */ jsxs("div", {
						className: "flex items-center gap-1",
						children: [/* @__PURE__ */ jsx("span", {
							className: "w-12 text-[10px] text-muted-foreground",
							children: calloutCount > 1 ? `Span ${index + 1}` : "Place"
						}), /* @__PURE__ */ jsx("button", {
							type: "button",
							className: "rounded-[var(--radius-xs)] border border-border px-2 py-1 text-xs",
							"aria-label": `Move span ${index + 1} callout counterclockwise`,
							onClick: () => {
								const dirs = Array.from({ length: calloutCount }, (_, i) => spanCalloutDir(line.calloutDirs, i));
								dirs[index] = (dirs[index] + 7) % 8;
								usePlantStore.getState().updateLine(line.id, { calloutDirs: dirs });
							},
							children: "←"
						}), /* @__PURE__ */ jsx("span", {
							className: "w-6 text-center text-[10px] text-muted-foreground",
							children: compass[spanCalloutDir(line.calloutDirs, index)]
						}), /* @__PURE__ */ jsx("button", {
							type: "button",
							className: "rounded-[var(--radius-xs)] border border-border px-2 py-1 text-xs",
							"aria-label": `Move span ${index + 1} callout clockwise`,
							onClick: () => {
								const dirs = Array.from({ length: calloutCount }, (_, i) => spanCalloutDir(line.calloutDirs, i));
								dirs[index] = (dirs[index] + 1) % 8;
								usePlantStore.getState().updateLine(line.id, { calloutDirs: dirs });
							},
							children: "→"
						}), /* @__PURE__ */ jsx("button", {
							type: "button",
							className: "rounded-[var(--radius-xs)] border border-border px-2 py-1 text-xs",
							"aria-label": `Shorten span ${index + 1} callout`,
							onClick: () => {
								const steps = Array.from({ length: calloutCount }, (_, i) => spanCalloutStep(line.calloutSteps, i));
								steps[index] = Math.max(0, steps[index] - 1);
								usePlantStore.getState().updateLine(line.id, { calloutSteps: steps });
							},
							children: "−"
						}), /* @__PURE__ */ jsx("button", {
							type: "button",
							className: "rounded-[var(--radius-xs)] border border-border px-2 py-1 text-xs",
							"aria-label": `Lengthen span ${index + 1} callout`,
							onClick: () => {
								const steps = Array.from({ length: calloutCount }, (_, i) => spanCalloutStep(line.calloutSteps, i));
								steps[index] = Math.min(6, steps[index] + 1);
								usePlantStore.getState().updateLine(line.id, { calloutSteps: steps });
							},
							children: "+"
						})]
					}, index))
				}) : null,
				(line.dots ?? []).length > 0 ? /* @__PURE__ */ jsxs("label", {
					className: "mt-2 flex items-center gap-2 text-xs",
					children: [/* @__PURE__ */ jsx("input", {
						type: "checkbox",
						className: "size-3.5 accent-white",
						checked: line.dots.every((dot) => dot.show),
						onChange: (e) => usePlantStore.getState().setLineDots(line.id, e.target.checked)
					}), "Junction dot"]
				}) : null,
				/* @__PURE__ */ jsxs("label", {
					className: "mt-3 flex items-center gap-2 text-xs",
					children: [/* @__PURE__ */ jsx("input", {
						type: "checkbox",
						className: "size-3.5 accent-white",
						checked: line.remove,
						onChange: (e) => usePlantStore.getState().updateLine(line.id, { remove: e.target.checked })
					}), "Remove"]
				}),
				line.kind === "road" ? null : /* @__PURE__ */ jsxs("label", {
					className: "mt-3 flex items-center gap-2 text-xs",
					children: [/* @__PURE__ */ jsx("input", {
						type: "checkbox",
						className: "size-3.5 accent-white",
						checked: line.overrideFootage,
						onChange: (e) => {
							const overrideFootage = e.target.checked;
							usePlantStore.getState().updateLine(line.id, {
								overrideFootage,
								footageText: overrideFootage && !line.footageText ? String(Math.round(pathFootage(line.path))) : line.footageText
							});
						}
					}), "Override footage"]
				}),
				line.kind !== "road" && line.overrideFootage ? /* @__PURE__ */ jsx(Input, {
					className: "mt-1 h-7 px-2 text-xs",
					inputMode: "decimal",
					placeholder: "ft",
					"aria-label": "Footage override",
					value: line.footageText ?? "",
					onChange: (e) => usePlantStore.getState().updateLine(line.id, { footageText: e.target.value.replace(/[^\d.]/g, "").slice(0, 8) })
				}) : null,
				line.kind === "road" || line.kind === "line" ? null : /* @__PURE__ */ jsxs("label", {
					className: "mt-3 flex items-center gap-2 text-xs",
					children: [/* @__PURE__ */ jsx("input", {
						type: "checkbox",
						className: "size-3.5 accent-white",
						checked: line.hideLegend,
						onChange: (e) => usePlantStore.getState().updateLine(line.id, { hideLegend: e.target.checked })
					}), "Exclude from legend"]
				}),
				line.kind === "road" ? /* @__PURE__ */ jsx(Input, {
					className: "mt-2 h-9",
					value: line.name ?? "",
					placeholder: "Road name",
					onChange: (e) => usePlantStore.getState().updateLine(line.id, { name: e.target.value })
				}) : /* @__PURE__ */ jsxs("label", {
					className: "mt-3 flex items-center gap-2 text-xs",
					children: [/* @__PURE__ */ jsx("input", {
						type: "checkbox",
						className: "size-3.5 accent-white",
						checked: line.parallel,
						onChange: (e) => {
							const parallel = e.target.checked;
							if (parallel) {
								const choices = cableChoices(line.kind).map((choice) => choice.id);
								const kept = line.cables.filter((id) => choices.includes(id));
								const slot1 = kept[0] ?? "";
								const slot2 = kept[1] ?? (line.emptyPipe && allowsEmpty(line.kind) ? "empty" : "");
								usePlantStore.getState().updateLine(line.id, {
									parallel,
									slot1,
									slot2,
									cables: [slot1, slot2].filter(isCableType),
									emptyPipe: false,
									strandOnly: false
								});
								return;
							}
							const picked = [line.slot1, line.slot2];
							usePlantStore.getState().updateLine(line.id, {
								parallel,
								slot1: "",
								slot2: "",
								cables: cableChoices(line.kind).map((choice) => choice.id).filter((id) => picked.includes(id)),
								emptyPipe: allowsEmpty(line.kind) && picked.includes("empty"),
								intoSlot: 0,
								joinEnds: false
							});
						}
					}), "Double path"]
				}),
				line.kind !== "road" && line.parallel ? /* @__PURE__ */ jsx("div", {
					className: "mt-3 space-y-2",
					children: [1, 2].map((slot) => {
						const active = slot === 1 ? line.slot1 : line.slot2;
						return /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsxs("div", {
							className: "flex flex-wrap items-center gap-1",
							children: [
								/* @__PURE__ */ jsxs("span", {
									className: "w-10 text-xs text-muted-foreground",
									children: ["Line ", slot]
								}),
								cableChoices(line.kind).map((choice) => /* @__PURE__ */ jsx("button", {
									type: "button",
									className: cn("rounded-[var(--radius-xs)] border px-2 py-1 text-xs", active === choice.id ? "border-foreground bg-foreground text-background" : "border-border text-foreground"),
									onClick: () => setLineSlot(line, slot, choice.id),
									children: choice.label
								}, choice.id)),
								allowsEmpty(line.kind) ? /* @__PURE__ */ jsx("button", {
									type: "button",
									className: cn("rounded-[var(--radius-xs)] border px-2 py-1 text-xs", active === "empty" ? "border-foreground bg-foreground text-background" : "border-border text-foreground"),
									onClick: () => setLineSlot(line, slot, "empty"),
									children: "Empty"
								}) : null
							]
						}), slot === 2 && joinsAtEnds(line.kind) ? /* @__PURE__ */ jsxs("label", {
							className: "ml-10 flex items-center gap-2 text-xs",
							children: [/* @__PURE__ */ jsx("input", {
								type: "checkbox",
								className: "size-3.5 accent-white",
								checked: line.joinEnds,
								onChange: (e) => usePlantStore.getState().updateLine(line.id, {
									joinEnds: e.target.checked,
									intoSlot: 0
								})
							}), "Join at object"]
						}) : null, line.kind === "aerial-new" && line.aerialMode === "work" && active && active !== "empty" ? /* @__PURE__ */ jsxs("div", {
							className: "ml-10 space-y-1",
							children: [/* @__PURE__ */ jsxs("div", {
								className: "flex gap-1",
								children: [["de", "De"], ["re", "Lash"], ["ol", "OL"]].map(([op, label]) => /* @__PURE__ */ jsx("button", {
									type: "button",
									className: cn("rounded-[var(--radius-xs)] border px-1.5 py-0.5 text-[10px]", (line.cableWork?.[slot - 1]?.op === "de" || line.cableWork?.[slot - 1]?.op === "re" || line.cableWork?.[slot - 1]?.op === "ol" ? line.cableWork?.[slot - 1]?.op : "re") === op ? "border-foreground bg-foreground text-background" : "border-border text-foreground"),
									onClick: () => {
										const cableWork = alignCableWork(2, line.cableWork);
										const current = cableWork[slot - 1] ?? { op: "re", existing: true, wreck: false };
										cableWork[slot - 1] = { ...current, op, existing: op === "ol" ? true : current.existing, wreck: op === "de" ? current.wreck : false };
										usePlantStore.getState().updateLine(line.id, { cableWork, strandOnly: false });
									},
									children: label
								}, op))
							}), line.cableWork?.[slot - 1]?.op === "ol" ? /* @__PURE__ */ jsxs("label", {
								className: "flex items-center gap-2 text-[10px]",
								children: [/* @__PURE__ */ jsx("input", {
									type: "checkbox",
									className: "size-3.5 accent-white",
									checked: line.cableWork?.[slot - 1]?.existing !== false,
									onChange: (e) => {
										const cableWork = alignCableWork(2, line.cableWork);
										const current = cableWork[slot - 1] ?? { op: "ol", existing: true, wreck: false };
										cableWork[slot - 1] = { ...current, existing: e.target.checked };
										usePlantStore.getState().updateLine(line.id, { cableWork });
									}
								}), "existing?"]
							}) : null, line.cableWork?.[slot - 1]?.op === "de" ? /* @__PURE__ */ jsxs("label", {
								className: "flex items-center gap-2 text-[10px]",
								children: [/* @__PURE__ */ jsx("input", {
									type: "checkbox",
									className: "size-3.5 accent-white",
									checked: line.cableWork?.[slot - 1]?.wreck === true,
									onChange: (e) => {
										const cableWork = alignCableWork(2, line.cableWork);
										const current = cableWork[slot - 1] ?? { op: "de", existing: true, wreck: false };
										cableWork[slot - 1] = { ...current, wreck: e.target.checked };
										usePlantStore.getState().updateLine(line.id, {
											cableWork,
											wreckOut: cableWork.some((work) => work.wreck)
										});
									}
								}), "wreck out"]
							}) : null]
						}) : null, active === "fiber" ? /* @__PURE__ */ jsxs("label", {
							className: "flex items-center gap-2 text-xs",
							children: [
								"Fiber count",
								/* @__PURE__ */ jsx(Input, {
									className: "h-7 w-20 px-2 text-xs",
									inputMode: "numeric",
									placeholder: "ct",
									"aria-label": `Line ${slot} fiber count`,
									value: slot === 1 ? line.fiberCount : line.fiberCount2,
									onChange: (e) => {
										const fiberCount = e.target.value.replace(/\D/g, "").slice(0, 4);
										usePlantStore.getState().updateLine(line.id, slot === 1 ? { fiberCount } : { fiberCount2: fiberCount });
									}
								})
							]
						}) : null] }, slot);
					})
				}) : line.kind === "road" ? null : /* @__PURE__ */ jsxs("div", {
					className: "mt-3 flex flex-wrap items-center gap-1",
					children: [
						/* @__PURE__ */ jsx("span", {
							className: "mr-1 text-xs text-muted-foreground",
							children: "Cable"
						}),
						cableChoices(line.kind).map((choice) => {
							const count = line.cables.filter((id) => id === choice.id).length;
							const cap = line.kind === "drop" ? 12 : 4;
							return /* @__PURE__ */ jsx("button", {
								type: "button",
								className: cn("rounded-[var(--radius-xs)] border px-2 py-1 text-xs", count > 0 ? "border-foreground bg-foreground text-background" : "border-border text-foreground"),
								onClick: () => {
									const cables = line.kind === "drop"
										? count > 0
											? count >= cap ? [] : Array.from({ length: count + 1 }, () => choice.id)
											: [choice.id]
										: cableChoices(line.kind).flatMap((item) => {
											const n = item.id === choice.id ? (count >= cap ? 0 : count + 1) : line.cables.filter((id) => id === item.id).length;
											return Array.from({ length: n }, () => item.id);
										});
									const kept = new Map<string, ("ug" | "width" | "share")[]>();
									line.cables.forEach((id, index) => {
										const list = kept.get(id) ?? [];
										const role = line.pipeRoles?.[index];
										list.push(role === "ug" || role === "width" || role === "share" ? role : index === 0 ? "ug" : "share");
										kept.set(id, list);
									});
									const pipeRoles = cables.map((id, index) => kept.get(id)?.shift() ?? (index === 0 ? "ug" : "share"));
									const keptWork = new Map<string, { op: "" | "de" | "re" | "ol"; existing: boolean; wreck: boolean }[]>();
									line.cables.forEach((id, index) => {
										const list = keptWork.get(id) ?? [];
										const item = line.cableWork?.[index];
										list.push({
											op: item?.op === "de" || item?.op === "re" || item?.op === "ol" ? item.op : "",
											existing: item ? item.existing !== false : true,
											wreck: item?.wreck === true
										});
										keptWork.set(id, list);
									});
									const keptCounts: string[] = [];
									line.cables.forEach((id, index) => {
										if (id === "fiber") keptCounts.push((line.fiberCounts?.[index] ?? "").replace(/\D/g, ""));
									});
									const fiberCounts = cables.map((id) => (id === "fiber" ? keptCounts.shift() ?? "" : ""));
									const cableWork = cables.map((id) => keptWork.get(id)?.shift() ?? { op: line.kind === "aerial-new" && line.aerialMode === "work" ? "re" as const : "" as const, existing: true, wreck: false });
									usePlantStore.getState().updateLine(line.id, {
										cables,
										pipeRoles,
										cableWork,
										fiberCounts,
										strandOnly: cables.length > 0 ? false : line.strandOnly
									});
								},
								children: count > 1 ? `${choice.label} ×${count}` : choice.label
							}, choice.id);
						}),
						line.kind === "aerial-new" && line.aerialMode !== "work" ? /* @__PURE__ */ jsx("button", {
							type: "button",
							className: cn("rounded-[var(--radius-xs)] border px-2 py-1 text-xs", line.strandOnly && line.cables.length === 0 ? "border-foreground bg-foreground text-background" : "border-border text-foreground"),
							onClick: () => usePlantStore.getState().updateLine(line.id, {
								strandOnly: !(line.strandOnly && line.cables.length === 0),
								cables: [],
								cableWork: [],
								pipeRoles: [],
								slot1: "",
								slot2: "",
								fiberCount: "",
								fiberCount2: "",
								fiberCounts: [],
								emptyPipe: false
							}),
							children: "Strand"
						}) : null,
						allowsEmpty(line.kind) ? /* @__PURE__ */ jsx("button", {
							type: "button",
							className: cn("rounded-[var(--radius-xs)] border px-2 py-1 text-xs", line.emptyPipe ? "border-foreground bg-foreground text-background" : "border-border text-foreground"),
							onClick: () => usePlantStore.getState().updateLine(line.id, { emptyPipe: !line.emptyPipe }),
							children: "Empty"
						}) : null
					]
				}),
				line.kind !== "road" && !line.parallel ? /* @__PURE__ */ jsx("p", {
					className: "mt-1 text-[10px] leading-tight text-muted-foreground",
					children: line.kind === "drop" ? "One cable type. Tap again to add, up to 12." : "Tap a cable again to add another, up to 4."
				}) : null,
				!line.parallel && pipeAccount(line.kind) && line.cables.length > 1 ? /* @__PURE__ */ jsx("div", {
					className: "mt-2 space-y-1",
					children: alignPipeRoles(line.cables, line.pipeRoles).map((role, index) => {
						const id = line.cables[index];
						const base = cableChoices(line.kind).find((choice) => choice.id === id)?.label ?? "";
						const countText = id === "fiber" ? line.fiberCounts?.[index]?.trim() || line.fiberCount : "";
						const name = id === "fiber" && countText ? `${countText}ct` : base;
						const bore = linePreset(line.kind).short;
						return /* @__PURE__ */ jsxs("div", {
							className: "flex items-center gap-1",
							children: [
								/* @__PURE__ */ jsx("span", {
									className: "w-3 text-[10px] text-muted-foreground",
									children: String.fromCharCode(65 + index)
								}),
								/* @__PURE__ */ jsx("span", {
									className: "w-10 truncate text-[10px]",
									children: name
								}),
								[["ug", bore], ["width", "+W"], ["share", "Share"]].map(([value, label]) => /* @__PURE__ */ jsx("button", {
									type: "button",
									className: cn("rounded-[var(--radius-xs)] border px-1 py-0.5 text-[10px]", role === value ? "border-foreground bg-foreground text-background" : "border-border text-foreground"),
									onClick: () => {
										const next = value === "width" || value === "share" ? value : "ug";
										const pipeRoles = alignPipeRoles(line.cables, line.pipeRoles).map((item, i) => i === index ? next : item);
										usePlantStore.getState().updateLine(line.id, { pipeRoles });
									},
									children: label
								}, value))
							]
						}, `${id}-${index}`);
					})
				}) : null,
				line.kind === "aerial-new" && line.aerialMode === "work" && !line.parallel && line.cables.length > 0 ? /* @__PURE__ */ jsx("div", {
					className: "mt-2 space-y-1",
					children: alignCableWork(line.cables.length, line.cableWork).map((work, index) => {
						const id = line.cables[index];
						const base = cableChoices(line.kind).find((choice) => choice.id === id)?.label ?? "";
						const countText = id === "fiber" ? line.fiberCounts?.[index]?.trim() || line.fiberCount : "";
						const name = id === "fiber" && countText ? `${countText}ct` : base;
						const setWork = (patch: Partial<typeof work>) => {
							const cableWork = alignCableWork(line.cables.length, line.cableWork).map((item, i) => i === index ? { ...item, ...patch } : item);
							usePlantStore.getState().updateLine(line.id, { cableWork });
						};
						const shown = work.op === "de" || work.op === "re" || work.op === "ol" ? work.op : "re";
						return /* @__PURE__ */ jsxs("div", {
							className: "space-y-1",
							children: [/* @__PURE__ */ jsxs("div", {
								className: "flex items-center gap-1",
								children: [/* @__PURE__ */ jsx("span", {
									className: "w-10 truncate text-[10px]",
									children: name
								}), [["de", "De"], ["re", "Lash"], ["ol", "OL"]].map(([op, label]) => /* @__PURE__ */ jsx("button", {
									type: "button",
									className: cn("rounded-[var(--radius-xs)] border px-1 py-0.5 text-[10px]", shown === op ? "border-foreground bg-foreground text-background" : "border-border text-foreground"),
									onClick: () => setWork({ op, existing: op === "ol" ? true : work.existing, wreck: op === "de" ? work.wreck : false }),
									children: label
								}, op))]
							}), shown === "ol" ? /* @__PURE__ */ jsxs("label", {
								className: "ml-10 flex items-center gap-2 text-[10px]",
								children: [/* @__PURE__ */ jsx("input", {
									type: "checkbox",
									className: "size-3.5 accent-white",
									checked: work.existing !== false,
									onChange: (e) => setWork({ existing: e.target.checked })
								}), "existing?"]
							}) : null, shown === "de" ? /* @__PURE__ */ jsxs("label", {
								className: "ml-10 flex items-center gap-2 text-[10px]",
								children: [/* @__PURE__ */ jsx("input", {
									type: "checkbox",
									className: "size-3.5 accent-white",
									checked: work.wreck === true,
									onChange: (e) => {
										const cableWork = alignCableWork(line.cables.length, line.cableWork).map((item, i) => i === index ? { ...item, wreck: e.target.checked } : item);
										usePlantStore.getState().updateLine(line.id, { cableWork, wreckOut: cableWork.some((work) => work.wreck) });
									}
								}), "wreck out"]
							}) : null]
						}, `${id}-${index}`);
					})
				}) : null,
				line.kind === "ug-pull" && !line.parallel && line.cables.length > 1 ? /* @__PURE__ */ jsxs("label", {
					className: "mt-2 flex items-center gap-2 text-xs",
					children: [/* @__PURE__ */ jsx("input", {
						type: "checkbox",
						className: "size-3.5 accent-white",
						checked: line.occupied === true,
						onChange: (e) => usePlantStore.getState().updateLine(line.id, { occupied: e.target.checked })
					}), "Occupied"]
				}) : null,
				line.kind === "in-4" || line.kind === "in-2" || line.kind === "in-075" ? /* @__PURE__ */ jsxs("label", {
					className: "mt-2 flex items-center gap-2 text-xs",
					children: [/* @__PURE__ */ jsx("input", {
						type: "checkbox",
						className: "size-3.5 accent-white",
						checked: line.hideSpan === true,
						onChange: (e) => usePlantStore.getState().updateLine(line.id, { hideSpan: e.target.checked })
					}), "Span off legend"]
				}) : null,
				!line.parallel && line.cables.includes("fiber") ? /* @__PURE__ */ jsx("div", {
					className: "mt-2 space-y-1",
					children: line.cables.map((id, index) => {
						if (id !== "fiber") return null;
						const fibers = line.cables.filter((cable) => cable === "fiber").length;
						const which = line.cables.slice(0, index + 1).filter((cable) => cable === "fiber").length;
						const first = line.cables.indexOf("fiber") === index;
						const own = (line.fiberCounts?.[index] ?? "").replace(/\D/g, "");
						const shown = first ? line.fiberCount : own || line.fiberCount;
						return /* @__PURE__ */ jsxs("label", {
							className: "flex items-center gap-2 text-xs",
							children: [
								fibers > 1 ? `Fiber ${which} count` : "Fiber count",
								/* @__PURE__ */ jsx(Input, {
									className: "h-7 w-20 px-2 text-xs",
									inputMode: "numeric",
									placeholder: "ct",
									"aria-label": fibers > 1 ? `Fiber ${which} count` : "Fiber count",
									value: shown,
									onChange: (e) => {
										const next = e.target.value.replace(/\D/g, "").slice(0, 4);
										if (first) {
											usePlantStore.getState().updateLine(line.id, { fiberCount: next });
											return;
										}
										const fiberCounts = line.cables.map((cable, i) => (cable === "fiber" ? (line.fiberCounts?.[i] ?? "").replace(/\D/g, "") : ""));
										fiberCounts[index] = next === line.fiberCount ? "" : next;
										usePlantStore.getState().updateLine(line.id, { fiberCounts });
									}
								})
							]
						}, `fiber-count-${index}`);
					})
				}) : null,
				line.kind !== "drop" && (line.parallel ? line.slot1 === "fiber" || line.slot2 === "fiber" : line.cables.includes("fiber")) ? /* @__PURE__ */ jsxs("div", {
					className: "mt-2 flex items-center gap-1",
					children: [/* @__PURE__ */ jsx("span", {
						className: "mr-1 text-xs text-muted-foreground",
						children: "Length"
					}), ["ft", "km"].map((unit) => /* @__PURE__ */ jsx("button", {
						type: "button",
						className: cn("rounded-[var(--radius-xs)] border px-2 py-1 text-xs", (line.fiberUnit ?? "ft") === unit ? "border-foreground bg-foreground text-background" : "border-border text-foreground"),
						onClick: () => usePlantStore.getState().updateLine(line.id, { fiberUnit: unit }),
						children: unit === "ft" ? "Feet" : "km"
					}, unit))]
				}) : null,
				/* @__PURE__ */ jsx("textarea", {
					className: cn(fieldClass, "mt-2 min-h-16 resize-y"),
					placeholder: "Description",
					value: line.notes,
					onChange: (e) => usePlantStore.getState().updateLine(line.id, { notes: e.target.value })
				}),
				/* @__PURE__ */ jsx("button", {
					type: "button",
					className: "mt-2 w-full rounded-[var(--radius-xs)] border border-border px-2 py-1 text-xs",
					onClick: () => usePlantStore.getState().addRef({ type: "line", id: line.id }),
					children: "Add ref · pdf only"
				})
			] }) : null,
			point ? /* @__PURE__ */ jsxs(Fragment, { children: [
				/* @__PURE__ */ jsx(Input, {
					className: "mt-2 h-9",
					value: point.name,
					placeholder: "Name",
					onChange: (e) => usePlantStore.getState().updatePoint(point.id, { name: e.target.value }),
					onKeyDown: (e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							confirm();
						}
					}
				}),
				canResize(point.kind) ? /* @__PURE__ */ jsxs("div", {
					className: "mt-2 flex flex-wrap items-center gap-1",
					children: [/* @__PURE__ */ jsx("span", {
						className: "mr-1 text-xs text-muted-foreground",
						children: "Size"
					}), (point.kind === "pedestal" || point.kind === "vault" ? [["std", "Std"], ["med", "Med"], ["big", "Lg"]] : [["std", "Std"], ["big", "Lg"]]).map(([size, label]) => /* @__PURE__ */ jsx("button", {
						type: "button",
						className: cn("rounded-[var(--radius-xs)] border px-2 py-1 text-xs", (point.size || "med") === size ? "border-foreground bg-foreground text-background" : "border-border text-foreground"),
						onClick: () => usePlantStore.getState().updatePoint(point.id, { size: size === "big" ? "big" : size === "std" ? "std" : "med" }),
						children: label
					}, size))]
				}) : null,
				/* @__PURE__ */ jsxs("div", {
					className: "mt-2 flex flex-wrap items-center gap-1",
					children: [/* @__PURE__ */ jsx("span", {
						className: "mr-1 text-xs text-muted-foreground",
						children: "Font"
					}), [["sm", "S"], ["md", "M"], ["lg", "L"], ["xl", "XL"]].map(([size, label]) => /* @__PURE__ */ jsx("button", {
						type: "button",
						className: cn("rounded-[var(--radius-xs)] border px-2 py-1 text-xs", (point.labelSize || "lg") === size ? "border-foreground bg-foreground text-background" : "border-border text-foreground"),
						onClick: () => {
							const next = size === "sm" || size === "md" || size === "xl" ? size : "lg";
							usePlantStore.getState().setObjectLabelSize(next);
							usePlantStore.getState().updatePoint(point.id, { labelSize: next });
						},
						children: label
					}, size))]
				}),
				/* @__PURE__ */ jsxs("label", {
					className: "mt-2 flex items-center gap-2 text-sm",
					children: [/* @__PURE__ */ jsx("input", {
						type: "checkbox",
						checked: point.remove,
						onChange: (e) => usePlantStore.getState().updatePoint(point.id, { remove: e.target.checked })
					}), "Remove"]
				}),
				/* @__PURE__ */ jsxs("label", {
					className: "mt-2 flex items-center gap-2 text-sm",
					children: [/* @__PURE__ */ jsx("input", {
						type: "checkbox",
						checked: point.hideLegend,
						onChange: (e) => usePlantStore.getState().updatePoint(point.id, { hideLegend: e.target.checked })
					}), "Exclude from legend"]
				}),
				point.kind === "pedestal" ? /* @__PURE__ */ jsxs("div", {
					className: "mt-2",
					children: [/* @__PURE__ */ jsx("p", {
						className: "mb-1 text-xs text-muted-foreground",
						children: "Ped type"
					}), /* @__PURE__ */ jsx("div", {
						className: "flex flex-wrap gap-1",
						children: [{ id: "", letter: "Ped" }, ...PED_TYPES.map((type) => ({ id: type.id, letter: type.letter }))].map((type) => /* @__PURE__ */ jsx("button", {
							type: "button",
							className: cn("rounded-[var(--radius-xs)] border px-2 py-1 text-xs", (point.pedType || "") === type.id ? "border-foreground bg-foreground text-background" : "border-border text-foreground"),
							onClick: () => usePlantStore.getState().updatePoint(point.id, {
								pedType: type.id,
								pedRotate: pedestalRotates(type.id) ? pedestalDir(point.pedRotate) : 0
							}),
							children: type.letter
						}, type.id || "plain"))
					}), pedestalRotates(point.pedType) ? /* @__PURE__ */ jsxs("div", {
						className: "mt-1 flex items-center gap-1",
						children: [/* @__PURE__ */ jsx("button", {
							type: "button",
							className: "inline-flex size-7 items-center justify-center rounded-[var(--radius-xs)] border border-border",
							"aria-label": "Rotate pedestal counterclockwise",
							onClick: () => usePlantStore.getState().updatePoint(point.id, { pedRotate: (pedestalDir(point.pedRotate) + 7) % 8 }),
							children: /* @__PURE__ */ jsx(ChevronLeft, { className: "size-4" })
						}), /* @__PURE__ */ jsx("button", {
							type: "button",
							className: "inline-flex size-7 items-center justify-center rounded-[var(--radius-xs)] border border-border",
							"aria-label": "Rotate pedestal clockwise",
							onClick: () => usePlantStore.getState().updatePoint(point.id, { pedRotate: (pedestalDir(point.pedRotate) + 1) % 8 }),
							children: /* @__PURE__ */ jsx(ChevronRight, { className: "size-4" })
						})]
					}) : null]
				}) : null,
				point.kind === "vault" ? /* @__PURE__ */ jsxs("div", {
					className: "mt-2",
					children: [/* @__PURE__ */ jsx("p", {
						className: "mb-1 text-xs text-muted-foreground",
						children: "Vault type"
					}), /* @__PURE__ */ jsx("div", {
						className: "flex flex-wrap gap-1",
						children: [{ id: "", letter: "Vault" }, { id: "s", letter: "Flower pot" }].map((type) => /* @__PURE__ */ jsx("button", {
							type: "button",
							className: cn("rounded-[var(--radius-xs)] border px-2 py-1 text-xs", (point.vaultType || "") === type.id ? "border-foreground bg-foreground text-background" : "border-border text-foreground"),
							onClick: () => {
								const name = point.name.trim();
								usePlantStore.getState().updatePoint(point.id, {
									vaultType: type.id,
									name: type.id === "s" ? name || "flower pot" : name === "flower pot" ? "" : point.name
								});
							},
							children: type.letter
						}, type.id || "plain"))
					})]
				}) : null,
				/* @__PURE__ */ jsxs("div", {
					className: "mt-2 flex flex-wrap items-center gap-1",
					children: [/* @__PURE__ */ jsx("span", {
						className: "mr-1 text-xs text-muted-foreground",
						children: "Label"
					}), [
						["top", "Top"],
						["bottom", "Bottom"],
						["left", "Left"],
						["right", "Right"]
					].map(([side, label]) => /* @__PURE__ */ jsxs("button", {
						type: "button",
						className: cn("inline-flex items-center gap-1 rounded-[var(--radius-xs)] border px-2 py-1 text-xs", (point.labelSide ?? "top") === side ? "border-foreground bg-foreground text-background" : "border-border text-foreground"),
						onClick: () => usePlantStore.getState().updatePoint(point.id, { labelSide: side }),
						children: [(point.labelSide ?? "top") === side ? /* @__PURE__ */ jsx(Check, { className: "size-3" }) : null, label]
					}, side))]
				}),
				point.kind === "pole" ? /* @__PURE__ */ jsxs("div", {
					className: "mt-2 flex flex-col gap-2",
					children: [/* @__PURE__ */ jsxs("label", {
						className: "flex items-center gap-2 text-sm",
						children: [/* @__PURE__ */ jsx("input", {
							type: "checkbox",
							checked: Boolean(point.riser),
							onChange: (e) => usePlantStore.getState().updatePoint(point.id, { riser: e.target.checked })
						}), "Riser"]
					}), /* @__PURE__ */ jsxs("div", {
						className: "flex items-center justify-between gap-2",
						children: [/* @__PURE__ */ jsx("span", {
							className: "text-sm",
							children: "Anchors"
						}), /* @__PURE__ */ jsx("button", {
							type: "button",
							className: "rounded-[var(--radius-xs)] border border-border px-2 py-1 text-xs disabled:opacity-40",
							disabled: (point.anchors ?? []).length >= 3,
							onClick: () => {
								const dirs = point.anchors ?? [];
								const next = [0, 1, 2, 3, 4, 5, 6, 7].find((dir) => !dirs.includes(dir));
								if (next == null) return;
								usePlantStore.getState().updatePoint(point.id, { anchors: [...dirs, next] });
							},
							children: "Add"
						})]
					}), ...(point.anchors ?? []).map((dir, index) => /* @__PURE__ */ jsxs("div", {
						className: "flex items-center gap-1",
						children: [/* @__PURE__ */ jsx("button", {
							type: "button",
							className: "inline-flex size-7 items-center justify-center rounded-[var(--radius-xs)] border border-border",
							"aria-label": "Rotate anchor counterclockwise",
							onClick: () => {
								const dirs = [...point.anchors ?? []];
								const used = new Set(dirs);
								let next = dirs[index] ?? 0;
								for (let step = 0; step < 8; step += 1) {
									next = (next + 7) % 8;
									if (!used.has(next)) break;
								}
								dirs[index] = next;
								usePlantStore.getState().updatePoint(point.id, { anchors: dirs });
							},
							children: /* @__PURE__ */ jsx(ChevronLeft, { className: "size-4" })
						}), /* @__PURE__ */ jsx("span", {
							className: "w-8 text-center font-mono text-xs",
							children: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][((dir % 8) + 8) % 8]
						}), /* @__PURE__ */ jsx("button", {
							type: "button",
							className: "inline-flex size-7 items-center justify-center rounded-[var(--radius-xs)] border border-border",
							"aria-label": "Rotate anchor clockwise",
							onClick: () => {
								const dirs = [...point.anchors ?? []];
								const used = new Set(dirs);
								let next = dirs[index] ?? 0;
								for (let step = 0; step < 8; step += 1) {
									next = (next + 1) % 8;
									if (!used.has(next)) break;
								}
								dirs[index] = next;
								usePlantStore.getState().updatePoint(point.id, { anchors: dirs });
							},
							children: /* @__PURE__ */ jsx(ChevronRight, { className: "size-4" })
						}), /* @__PURE__ */ jsx("button", {
							type: "button",
							className: "inline-flex size-7 items-center justify-center rounded-[var(--radius-xs)] border border-border",
							"aria-label": "Remove anchor",
							onClick: () => usePlantStore.getState().updatePoint(point.id, { anchors: (point.anchors ?? []).filter((_, i) => i !== index) }),
							children: /* @__PURE__ */ jsx(X, { className: "size-3.5" })
						})]
					}, `${index}-${dir}`))]
				}) : null,
				/* @__PURE__ */ jsx("textarea", {
					className: cn(fieldClass, "mt-2 min-h-16 resize-y"),
					placeholder: "Description",
					value: point.description,
					onChange: (e) => usePlantStore.getState().updatePoint(point.id, { description: e.target.value })
				}),
				/* @__PURE__ */ jsx("button", {
					type: "button",
					className: "mt-2 w-full rounded-[var(--radius-xs)] border border-border px-2 py-1 text-xs",
					onClick: () => usePlantStore.getState().addRef({ type: "point", id: point.id }),
					children: "Add ref · pdf only"
				})
			] }) : null,
			polygon ? /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx(Input, {
				className: "mt-2 h-9",
				value: polygon.name,
				placeholder: "Name",
				onChange: (e) => usePlantStore.getState().updatePolygon(polygon.id, { name: e.target.value }),
				onKeyDown: (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						confirm();
					}
				}
			}), /* @__PURE__ */ jsxs("div", {
				className: "mt-2 flex flex-wrap items-center gap-1",
				children: [/* @__PURE__ */ jsx("span", {
					className: "mr-1 text-xs text-muted-foreground",
					children: "Font"
				}), [["sm", "S"], ["md", "M"], ["lg", "L"], ["xl", "XL"]].map(([size, label]) => /* @__PURE__ */ jsx("button", {
					type: "button",
					className: cn("rounded-[var(--radius-xs)] border px-2 py-1 text-xs", (polygon.labelSize || "sm") === size ? "border-foreground bg-foreground text-background" : "border-border text-foreground"),
					onClick: () => {
						const next = size === "md" || size === "lg" || size === "xl" ? size : "sm";
						usePlantStore.getState().setPolygonLabelSize(next);
						usePlantStore.getState().updatePolygon(polygon.id, { labelSize: next });
					},
					children: label
				}, size))]
			}), /* @__PURE__ */ jsx("p", {
				className: "mt-3 text-xs text-muted-foreground",
				children: "Outline"
			}), /* @__PURE__ */ jsx("div", {
				className: "mt-1 flex flex-wrap gap-1",
				children: ["#e8eaee", "#facc15", "#fb923c", "#f87171", "#f472b6", "#38bdf8", "#4ade80", "#c084fc"].map((color) => /* @__PURE__ */ jsx("button", {
					type: "button",
					className: "size-5 rounded-full border",
					style: { background: color, borderColor: (polygon.stroke || "#a1a1aa") === color ? "#fff" : "transparent" },
					"aria-label": `Outline ${color}`,
					onClick: () => usePlantStore.getState().updatePolygon(polygon.id, { stroke: color })
				}, color))
			}), /* @__PURE__ */ jsx("div", {
				className: "mt-1 flex flex-wrap gap-1",
				children: [[0.25, "25%"], [0.5, "50%"], [0.75, "75%"], [1, "100%"]].map(([value, label]) => /* @__PURE__ */ jsx("button", {
					type: "button",
					className: cn("rounded-[var(--radius-xs)] border px-2 py-1 text-xs", Math.abs((polygon.strokeOpacity ?? 1) - Number(value)) < 0.02 ? "border-foreground bg-foreground text-background" : "border-border text-foreground"),
					onClick: () => usePlantStore.getState().updatePolygon(polygon.id, { strokeOpacity: Number(value) }),
					children: label
				}, `stroke-${label}`))
			}), /* @__PURE__ */ jsx("p", {
				className: "mt-2 text-xs text-muted-foreground",
				children: "Fill"
			}), /* @__PURE__ */ jsx("div", {
				className: "mt-1 flex flex-wrap gap-1",
				children: ["#e8eaee", "#facc15", "#fb923c", "#f87171", "#f472b6", "#38bdf8", "#4ade80", "#c084fc"].map((color) => /* @__PURE__ */ jsx("button", {
					type: "button",
					className: "size-5 rounded-full border",
					style: { background: color, borderColor: (polygon.fill || "#64748b") === color ? "#fff" : "transparent" },
					"aria-label": `Fill ${color}`,
					onClick: () => usePlantStore.getState().updatePolygon(polygon.id, { fill: color })
				}, color))
			}), /* @__PURE__ */ jsx("div", {
				className: "mt-1 flex flex-wrap gap-1",
				children: [[0.25, "25%"], [0.5, "50%"], [0.75, "75%"], [1, "100%"]].map(([value, label]) => /* @__PURE__ */ jsx("button", {
					type: "button",
					className: cn("rounded-[var(--radius-xs)] border px-2 py-1 text-xs", Math.abs((polygon.fillOpacity ?? 0.25) - Number(value)) < 0.02 ? "border-foreground bg-foreground text-background" : "border-border text-foreground"),
					onClick: () => usePlantStore.getState().updatePolygon(polygon.id, { fillOpacity: Number(value) }),
					children: label
				}, `fill-${label}`))
			}), /* @__PURE__ */ jsx("textarea", {
				className: cn(fieldClass, "mt-2 min-h-16 resize-y"),
				placeholder: "Description",
				value: polygon.description,
				onChange: (e) => usePlantStore.getState().updatePolygon(polygon.id, { description: e.target.value })
			})] }) : null,
			overlay ? /* @__PURE__ */ jsxs(Fragment, { children: [/* @__PURE__ */ jsx(Input, {
				className: "mt-2 h-9",
				value: overlay.name,
				placeholder: "Name",
				onChange: (e) => usePlantStore.getState().updateOverlay(overlay.id, { name: e.target.value }),
				onKeyDown: (e) => {
					if (e.key === "Enter") {
						e.preventDefault();
						confirm();
					}
				}
			}), /* @__PURE__ */ jsx("textarea", {
				className: cn(fieldClass, "mt-2 min-h-16 resize-y"),
				placeholder: "Description",
				value: overlay.description,
				onChange: (e) => usePlantStore.getState().updateOverlay(overlay.id, { description: e.target.value })
			}), /* @__PURE__ */ jsx("p", {
				className: "mt-3 text-xs text-muted-foreground",
				children: "Opacity"
			}), /* @__PURE__ */ jsx("div", {
				className: "mt-1 flex flex-wrap gap-1",
				children: [[0.25, "25%"], [0.5, "50%"], [0.75, "75%"], [1, "100%"]].map(([value, label]) => /* @__PURE__ */ jsx("button", {
					type: "button",
					className: cn("rounded-[var(--radius-xs)] border px-2 py-1 text-xs", Math.abs(overlay.opacity - Number(value)) < 0.02 ? "border-foreground bg-foreground text-background" : "border-border text-foreground"),
					onClick: () => usePlantStore.getState().updateOverlay(overlay.id, { opacity: Number(value) }),
					children: label
				}, label))
			}), /* @__PURE__ */ jsx("p", {
				className: "mt-3 text-xs text-muted-foreground",
				children: "Rotate"
			}), /* @__PURE__ */ jsxs("div", {
				className: "mt-1 flex items-center gap-1",
				children: [/* @__PURE__ */ jsx("button", {
					type: "button",
					className: "inline-flex size-7 items-center justify-center rounded-[var(--radius-xs)] border border-border",
					"aria-label": "Rotate overlay counterclockwise",
					onClick: () => usePlantStore.getState().updateOverlay(overlay.id, { rotation: (((overlay.rotation || 0) - 15) % 360 + 360) % 360 }),
					children: /* @__PURE__ */ jsx(ChevronLeft, { className: "size-4" })
				}), /* @__PURE__ */ jsx("span", {
					className: "w-12 text-center font-mono text-xs",
					children: `${overlay.rotation || 0}°`
				}), /* @__PURE__ */ jsx("button", {
					type: "button",
					className: "inline-flex size-7 items-center justify-center rounded-[var(--radius-xs)] border border-border",
					"aria-label": "Rotate overlay clockwise",
					onClick: () => usePlantStore.getState().updateOverlay(overlay.id, { rotation: ((overlay.rotation || 0) + 15) % 360 }),
					children: /* @__PURE__ */ jsx(ChevronRight, { className: "size-4" })
				})]
			}), /* @__PURE__ */ jsx("p", {
				className: "mt-2 text-xs text-muted-foreground",
				children: "Drag the image to move it. Corners resize it."
			})] }) : null,
			/* @__PURE__ */ jsxs(Button, {
				variant: "secondary",
				size: "sm",
				className: "mt-3 w-full",
				onClick: () => usePlantStore.getState().deleteSelection(),
				children: [/* @__PURE__ */ jsx(Trash2, { className: "size-4" }), " Delete"]
			})
		]
	});
}
