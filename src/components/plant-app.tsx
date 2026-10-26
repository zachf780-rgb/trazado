// @ts-nocheck
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  ImagePlus,
  Layers,
  LocateFixed,
  MapPin,
  MoreHorizontal,
  MousePointer2,
  Pentagon,
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
  CONDUIT_PRESETS,
  LINE_PRESETS,
  POINT_PRESETS,
  ROAD_PRESET,
  allowsEmpty,
  cableChoices,
  canResize,
  isLineTool,
  joinsAtEnds,
  linePreset,
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
import { constrainCardinal, formatFeet, pathFootage, reportedFeet } from "@/lib/geo";
import { isCableType } from "@/lib/types";
import { buildKmz, downloadBlob, parsePlantFile } from "@/lib/kml";
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
export function PlantApp() {
	const [mounted, setMounted] = useState(false);
	const [MapCmp, setMapCmp] = useState(null);
	const [basemap, setBasemap] = useState("satellite");
	const [query, setQuery] = useState("");
	const [results, setResults] = useState([]);
	const [searching, setSearching] = useState(false);
	const [searchSettled, setSearchSettled] = useState(false);
	const [clearOpen, setClearOpen] = useState(false);
	const importRef = useRef(null);
	const overlayRef = useRef(null);
	const gpsWatch = useRef(null);
	const tool = usePlantStore((s) => s.tool);
	const placeSmall = usePlantStore((s) => s.placeSmall);
	const draft = usePlantStore((s) => s.draft);
	const pointer = usePlantStore((s) => s.pointer);
	const shift = usePlantStore((s) => s.shift);
	const selection = usePlantStore((s) => s.selection);
	const lines = usePlantStore((s) => s.lines);
	const points = usePlantStore((s) => s.points);
	const polygons = usePlantStore((s) => s.polygons);
	const overlays = usePlantStore((s) => s.overlays);
	const projectName = usePlantStore((s) => s.projectName);
	const past = usePlantStore((s) => s.past);
	const future = usePlantStore((s) => s.future);
	const gps = usePlantStore((s) => s.gps);
	const snapAsk = usePlantStore((s) => s.snapAsk);
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
				else s.finishDraft();
			}
			if (e.key === "Escape") {
				if (s.snapAsk) s.dismissSnap();
				else if (s.draft) s.cancelDraft();
				else s.clearSelection();
			}
			if ((e.key === "Delete" || e.key === "Backspace") && s.selection) {
				e.preventDefault();
				s.deleteSelection();
			}
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
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
				if (e.key === "4") s.setTool("aerial-overlash");
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
				const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query.trim())}&limit=5`);
				if (!res.ok) throw new Error("Search failed");
				const data = await res.json();
				setResults((data.features ?? []).map((f) => {
					const [lng, lat] = f.geometry.coordinates;
					const bits = [
						[f.properties.housenumber, f.properties.street].filter(Boolean).join(" ") || f.properties.name,
						f.properties.city,
						f.properties.state,
						f.properties.country
					].filter(Boolean);
					if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
					return {
						label: bits.join(", ") || "Result",
						lat,
						lng
					};
				}).filter((row) => row !== null));
			} catch {
				setResults([]);
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
			const { blob, filename } = await makeKmz();
			downloadBlob(blob, filename);
			toast.success("KMZ downloaded");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Download failed");
		}
	}
	async function onImport(file) {
		try {
			const project = await parsePlantFile(file);
			usePlantStore.getState().replaceProject(project);
			const first = project.lines[0]?.path[0] ?? project.points[0]?.position ?? project.polygons[0]?.path[0];
			if (first) usePlantStore.getState().setFlyTo({
				lat: first.lat,
				lng: first.lng,
				zoom: 17
			});
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
			children: [
				mounted && MapCmp ? /* @__PURE__ */ jsx(MapCmp, { basemap }) : null,
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
									className: "absolute top-full z-50 mt-1 w-full overflow-hidden rounded-[var(--radius-md)] border border-border bg-elevated py-1 shadow-lg",
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
									className: "absolute top-full z-50 mt-1 w-full rounded-[var(--radius-md)] border border-border bg-elevated px-3 py-2 text-sm text-muted-foreground shadow-lg",
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
							/* @__PURE__ */ jsx(Button, {
								variant: usePlantStore((s) => s.labelPlate) ? "default" : "ghost",
								size: "sm",
								onClick: () => {
									const on = usePlantStore.getState().labelPlate;
									usePlantStore.getState().setLabelPlate(!on);
								},
								"aria-pressed": usePlantStore((s) => s.labelPlate),
								children: "Label box"
							}),
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
							/* @__PURE__ */ jsxs(Button, {
								size: "sm",
								"aria-label": "Download",
								onClick: () => void exportKmz(),
								children: [/* @__PURE__ */ jsx(Download, { className: "size-4" }), "Download"]
							})
						]
					})]
				}),
				/* @__PURE__ */ jsx(ToolDock, {
					tool,
					onTool: (t) => usePlantStore.getState().setTool(t),
					onOverlay: () => overlayRef.current?.click()
				}),
				tool === "pedestal" || tool === "vault" || tool === "mdu" || tool === "pole" ? /* @__PURE__ */ jsxs("label", {
					className: "absolute bottom-[8.25rem] left-3 z-30 flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-elevated px-2.5 py-1.5 text-xs shadow-lg md:bottom-4 md:left-36",
					children: [/* @__PURE__ */ jsx("input", {
						type: "checkbox",
						className: "size-3.5 accent-white",
						checked: placeSmall,
						onChange: (e) => usePlantStore.getState().setPlaceSmall(e.target.checked)
					}), "Small"]
				}) : null,
				showDraftBar ? /* @__PURE__ */ jsx("div", {
					className: "pointer-events-none absolute inset-x-0 top-28 z-20 flex justify-center px-3 md:top-20",
					children: /* @__PURE__ */ jsxs("div", {
						className: "pointer-events-auto flex items-center gap-2 rounded-[var(--radius-md)] border border-border bg-elevated px-2 py-1.5 shadow-lg",
						children: [drawingFeet != null ? /* @__PURE__ */ jsx("span", {
							className: "px-1 font-mono text-sm font-semibold tabular-nums",
							children: formatFeet(drawingFeet)
						}) : null, canFinish ? /* @__PURE__ */ jsxs(Button, {
							size: "sm",
							onClick: () => usePlantStore.getState().finishDraft(),
							children: [/* @__PURE__ */ jsx(Check, { className: "size-4" }), " Finish"]
						}) : null, /* @__PURE__ */ jsxs(Button, {
							variant: "ghost",
							size: "sm",
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
				legendOpen ? /* @__PURE__ */ jsxs("aside", {
					className: "absolute right-2 bottom-[7.75rem] z-20 max-h-[calc(100dvh-16rem)] w-52 overflow-y-auto rounded-[var(--radius-md)] border border-border bg-elevated/95 px-2 py-1.5 md:right-4 md:bottom-4 md:max-h-[calc(100dvh-6rem)]",
					children: [
						totals.usedLines.length > 0 || totals.removeLines.length > 0 ? /* @__PURE__ */ jsxs("ul", {
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
							}) : null, totals.removeLines.map((preset) => /* @__PURE__ */ jsxs("li", {
								className: "flex items-baseline justify-between gap-2",
								children: [/* @__PURE__ */ jsxs("span", {
									className: "flex min-w-0 items-center gap-1.5 text-xs",
									children: [/* @__PURE__ */ jsx("span", {
										className: "inline-block h-0.5 w-3.5 shrink-0 rounded-full",
										style: { background: preset.color }
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
				selectedLine || selectedPoint || selectedPolygon || selectedOverlay ? /* @__PURE__ */ jsx(Inspector, {
					line: selectedLine,
					point: selectedPoint,
					polygon: selectedPolygon,
					overlay: selectedOverlay
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
				})
			]
		})
	});
}
function ToolDock({ tool, onTool, onOverlay }) {
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
				swatch: p.color
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
				swatch: p.color
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
			}), /* @__PURE__ */ jsx(AdvancedMenu, {
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
			className: cn("flex min-h-8 w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 text-left text-xs text-muted-foreground hover:bg-surface-2 hover:text-foreground", compact && "min-h-11 min-w-14 w-auto flex-col justify-center", (tool === "line" || tool === "polygon" || tool === "overlay" || tool === "pin" || tool === "in-4" || tool === "in-2" || tool === "in-075" || tool === "road") && "bg-surface-2 text-foreground"),
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
		emptyPipe: false
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
function Inspector({ line, point, polygon, overlay }) {
	const lines = usePlantStore((s) => s.lines);
	const points = usePlantStore((s) => s.points);
	const title = line ? linePreset(line.kind).fullLabel : point ? pointPreset(point.kind).fullLabel : polygon ? "Polygon" : "Image overlay";
	const accent = line ? linePreset(line.kind).color : point ? pointLabelColor(point.kind) : "#d4d4d8";
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
						line.kind === "drop" ? "1.5" : line.kind === "road" ? "12" : "3",
						"-pt stroke"
					]
				}),
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
				line.kind === "road" ? null : /* @__PURE__ */ jsxs("label", {
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
									emptyPipe: false
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
						cableChoices(line.kind).map((choice) => /* @__PURE__ */ jsx("button", {
							type: "button",
							className: cn("rounded-[var(--radius-xs)] border px-2 py-1 text-xs", line.cables.includes(choice.id) ? "border-foreground bg-foreground text-background" : "border-border text-foreground"),
							onClick: () => {
								const order = cableChoices(line.kind).map((item) => item.id);
								const next = line.cables.includes(choice.id) ? line.cables.filter((cable) => cable !== choice.id) : [...line.cables, choice.id];
								usePlantStore.getState().updateLine(line.id, { cables: order.filter((cable) => next.includes(cable)) });
							},
							children: choice.label
						}, choice.id)),
						allowsEmpty(line.kind) ? /* @__PURE__ */ jsx("button", {
							type: "button",
							className: cn("rounded-[var(--radius-xs)] border px-2 py-1 text-xs", line.emptyPipe ? "border-foreground bg-foreground text-background" : "border-border text-foreground"),
							onClick: () => usePlantStore.getState().updateLine(line.id, { emptyPipe: !line.emptyPipe }),
							children: "Empty"
						}) : null
					]
				}),
				!line.parallel && line.cables.includes("fiber") ? /* @__PURE__ */ jsxs("label", {
					className: "mt-2 flex items-center gap-2 text-xs",
					children: [
						"Fiber count",
						/* @__PURE__ */ jsx(Input, {
							className: "h-7 w-20 px-2 text-xs",
							inputMode: "numeric",
							placeholder: "ct",
							"aria-label": "Fiber count",
							value: line.fiberCount,
							onChange: (e) => usePlantStore.getState().updateLine(line.id, { fiberCount: e.target.value.replace(/\D/g, "").slice(0, 4) })
						})
					]
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
				canResize(point.kind) ? /* @__PURE__ */ jsxs("label", {
					className: "mt-2 flex items-center gap-2 text-sm",
					children: [/* @__PURE__ */ jsx("input", {
						type: "checkbox",
						checked: point.size === "sm",
						onChange: (e) => usePlantStore.getState().updatePoint(point.id, { size: e.target.checked ? "sm" : "lg" })
					}), "Small"]
				}) : null,
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
