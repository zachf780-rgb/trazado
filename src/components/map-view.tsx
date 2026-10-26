"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { usePlantStore } from "@/lib/store";
import { canResize, isLineTool, isPointTool, isSnapTarget, joinsAtEnds, lineOpacity, linePreset, lineWidth, objectScale, pedestalDir, pedestalPixels, pointLabelColor, tintHex, vaultPixels } from "@/lib/presets";
import {
  constrainCardinal,
  footageSpans,
  formatFootageLabel,
  haversineFeet,
  parallelPath,
  pathFootage,
  pathMidpoint,
  reportedFeet,
  spanShownFeet,
  joinMask,
  offsetBeside,
  squareLine2,
  slotCableTag,
  spanParts,
  slashMarks,
} from "@/lib/geo";
import { pedestalIconDataUrl, pointIconDataUrl, vaultIconDataUrl } from "@/lib/icons";
import type { LabelSide, LatLng, LineKind, PointKind } from "@/lib/types";
import { escapeHtml } from "@/lib/utils";

const OSM = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 23,
  maxNativeZoom: 19,
  attribution: "&copy; OpenStreetMap",
});

const SAT = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  { maxZoom: 23, maxNativeZoom: 19, attribution: "Tiles &copy; Esri" },
);

const SAT_LABELS = L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
  { maxZoom: 23, maxNativeZoom: 19, attribution: "" },
);

function footageIcon(footage: string, detail: string, color: string, plate = false): L.DivIcon {
  const extra = detail
    ? `<span class="footage-detail">${escapeHtml(detail)}</span>`
    : "";
  return L.divIcon({
    className: plate ? "footage-label plate" : "footage-label",
    html: `<span class="footage-stack" style="color:${color}"><span class="footage-feet">${escapeHtml(footage)}</span>${extra}</span>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

function bindName(
  layer: L.Layer,
  text: string,
  color: string,
  side: LabelSide = "top",
  kind?: PointKind,
) {
  const label = text.trim();
  if (!label) return;
  const half = kind === "pin" ? 16 : kind === "passing" ? 7 : kind ? 11 : 8;
  const gap = kind === "passing" ? 2 : 6;
  const pad = half + gap;
  const offset: [number, number] =
    kind === "pin" && side === "top"
      ? [0, -46]
      : side === "bottom"
        ? [0, pad]
        : side === "left"
          ? [-pad, kind === "pin" ? -18 : 0]
          : side === "right"
            ? [pad, kind === "pin" ? -18 : 0]
            : [0, kind === "passing" ? -pad : kind === "pin" ? -46 : kind ? -22 : -14];
  layer.bindTooltip(`<span style="color:${color}">${escapeHtml(label)}</span>`, {
    permanent: true,
    direction: side,
    offset,
    opacity: 1,
    className: "object-label",
    interactive: false,
  });
}

function poleMarkIcon(riser: boolean, anchors: number[], scale = 1): L.DivIcon {
  const dirs: number[] = [];
  for (const raw of anchors) {
    const dir = ((Math.round(Number(raw)) % 8) + 8) % 8;
    if (!dirs.includes(dir)) dirs.push(dir);
    if (dirs.length === 3) break;
  }
  const guys = dirs
    .map(
      (dir) =>
        `<span class="pole-guy" style="transform:rotate(${dir * 45}deg)"><span class="pole-guy-line"></span><span class="pole-guy-head"></span></span>`,
    )
    .join("");
  const base = dirs.length > 0 ? 72 : riser ? 28 : 22;
  const size = Math.max(10, Math.round(base * scale));
  return L.divIcon({
    className: "pole-icon",
    html: `<span class="pole-unit" style="width:${base}px;height:${base}px;transform:scale(${scale});transform-origin:0 0"><span class="pole-disc${riser ? " pole-disc-riser" : ""}">${riser ? "R" : ""}</span>${guys}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

const iconCache = new Map<string, L.Icon>();
const pedestalCache = new Map<string, L.Icon>();

function pedestalIcon(type: "s" | "m" | "l" | "dh" | "dd", dir: number, scale = 1): L.Icon {
  const turns = pedestalDir(dir);
  const key = `${type}-${turns}-${scale}`;
  const hit = pedestalCache.get(key);
  if (hit) return hit;
  const box = pedestalPixels(type, turns);
  const w = Math.max(8, Math.round(box.w * scale));
  const h = Math.max(8, Math.round(box.h * scale));
  const icon = L.icon({
    iconUrl: pedestalIconDataUrl(type, turns),
    iconSize: [w, h],
    iconAnchor: [w / 2, h / 2],
    className: "equipment-icon",
  });
  pedestalCache.set(key, icon);
  return icon;
}

const vaultCache = new Map<string, L.Icon>();

function vaultIcon(type: "s", scale = 1): L.Icon {
  const key = `${type}-${scale}`;
  const hit = vaultCache.get(key);
  if (hit) return hit;
  const box = vaultPixels();
  const w = Math.max(8, Math.round(box.w * scale));
  const h = Math.max(8, Math.round(box.h * scale));
  const icon = L.icon({
    iconUrl: vaultIconDataUrl(type),
    iconSize: [w, h],
    iconAnchor: [w / 2, h / 2],
    className: "equipment-icon",
  });
  vaultCache.set(key, icon);
  return icon;
}

function pointIcon(kind: PointKind, scale = 1): L.Icon {
  const key = `${kind}-${scale}`;
  const hit = iconCache.get(key);
  if (hit) return hit;
  const pin = kind === "pin";
  const passing = kind === "passing";
  const base: [number, number] = pin ? [26, 36] : passing ? [14, 14] : [22, 22];
  const size: [number, number] = [Math.max(8, Math.round(base[0] * scale)), Math.max(8, Math.round(base[1] * scale))];
  const icon = L.icon({
    iconUrl: pointIconDataUrl(kind, 64),
    iconSize: size,
    iconAnchor: pin ? [size[0] / 2, size[1] - 2] : [size[0] / 2, size[1] / 2],
    className: "equipment-icon",
  });
  iconCache.set(key, icon);
  return icon;
}

function gearPoints(points: { kind: PointKind; position: LatLng }[]): LatLng[] {
  return points.filter((point) => isSnapTarget(point.kind)).map((point) => point.position);
}

function toLL(ll: LatLng): L.LatLng {
  return L.latLng(ll.lat, ll.lng);
}

function paintParallel(
  map: L.Map,
  group: L.LayerGroup,
  lines: ReturnType<typeof usePlantStore.getState>["lines"],
  points: ReturnType<typeof usePlantStore.getState>["points"],
) {
  group.clearLayers();
  const placed: {
    id: string;
    kind: LineKind;
    path: LatLng[];
    parallel: boolean;
    intoSlot: 0 | 1 | 2 | 3;
    slot1: (typeof lines)[number]["slot1"];
    slot2: (typeof lines)[number]["slot2"];
    fiberCount: string;
    fiberCount2: string;
    offsetFt: number;
    joinEnds: boolean;
  }[] = [];
  for (const line of lines) {
    if (!line.parallel || line.path.length < 2) continue;
    const mid = line.path[Math.floor(line.path.length / 2)] ?? line.path[0];
    if (!mid) continue;
    const origin = map.latLngToContainerPoint([mid.lat, mid.lng]);
    const shifted = map.containerPointToLatLng(L.point(origin.x + 8, origin.y));
    const offsetFt = Math.max(8, haversineFeet(mid, { lat: shifted.lat, lng: shifted.lng }));
    placed.push({
      id: line.id,
      kind: line.kind,
      path: line.path,
      parallel: true,
      intoSlot: line.intoSlot,
      slot1: line.slot1,
      slot2: line.slot2,
      fiberCount: line.fiberCount,
      fiberCount2: line.fiberCount2,
      offsetFt,
      joinEnds: line.joinEnds,
    });
  }
  const open: { id: string; kind: LineKind; path: LatLng[]; offsetFt: number; drawn: LatLng[] }[] = [];
  for (const line of placed) {
    const canJoin = line.joinEnds && joinsAtEnds(line.kind);
    const targets = points
      .filter((p) => p.kind === "pedestal" || p.kind === "vault" || p.kind === "mdu" || p.kind === "pole")
      .map((p) => p.position);
    const path = parallelPath(line.path, line.offsetFt, joinMask(line.path, targets, canJoin, []));
    if (path.length < 2) continue;
    if (!canJoin) {
      open.push({ id: line.id, kind: line.kind, path: line.path, offsetFt: line.offsetFt, drawn: path });
      continue;
    }
    L.polyline(
      path.map((p) => [p.lat, p.lng] as [number, number]),
      {
        color: tintHex(linePreset(line.kind).color, 0.42),
        weight: lineWidth(line.kind),
        opacity: 1,
        lineJoin: "round",
        lineCap: "round",
        interactive: false,
      },
    ).addTo(group);
  }
  const boxes = points
    .filter((p) => p.kind === "pedestal" || p.kind === "vault" || p.kind === "mdu" || p.kind === "pole")
    .map((p) => p.position);
  for (const figure of squareLine2(open, boxes)) {
    if (figure.path.length < 2) continue;
    L.polyline(
      figure.path.map((p) => [p.lat, p.lng] as [number, number]),
      {
        color: tintHex(linePreset(figure.kind).color, 0.42),
        weight: lineWidth(figure.kind),
        opacity: 1,
        lineJoin: "round",
        lineCap: "round",
        interactive: false,
      },
    ).addTo(group);
  }
}

export function MapView({ basemap }: { basemap: "satellite" | "streets" }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const featuresRef = useRef<L.LayerGroup | null>(null);
  const draftRef = useRef<L.LayerGroup | null>(null);
  const gpsRef = useRef<L.LayerGroup | null>(null);
  const searchRef = useRef<L.LayerGroup | null>(null);
  const parallelRef = useRef<L.LayerGroup | null>(null);
  const baseRef = useRef<L.TileLayer>(SAT);
  const labelsRef = useRef<L.TileLayer>(SAT_LABELS);
  const draggingRef = useRef(false);
  const touchingRef = useRef(false);

  const lines = usePlantStore((s) => s.lines);
  const points = usePlantStore((s) => s.points);
  const polygons = usePlantStore((s) => s.polygons);
  const overlays = usePlantStore((s) => s.overlays);
  const selection = usePlantStore((s) => s.selection);
  const draft = usePlantStore((s) => s.draft);
  const pointer = usePlantStore((s) => s.pointer);
  const tool = usePlantStore((s) => s.tool);
  const shift = usePlantStore((s) => s.shift);
  const flyTo = usePlantStore((s) => s.flyTo);
  const hydrated = usePlantStore((s) => s.hydrated);
  const gps = usePlantStore((s) => s.gps);
  const gpsFollow = usePlantStore((s) => s.gpsFollow);
  const searchMark = usePlantStore((s) => s.searchMark);
  const labelPlate = usePlantStore((s) => s.labelPlate);

  useEffect(() => {
    const el = hostRef.current;
    if (!el || mapRef.current) return;

    const view = usePlantStore.getState().view;
    const map = L.map(el, {
      zoomControl: false,
      doubleClickZoom: false,
      attributionControl: true,
      minZoom: 3,
      maxZoom: 23,
      // Pinch zoom on phones scales the line layer separately from the
      // imagery and leaves the stroke in the wrong place. Snap instead.
      zoomAnimation: false,
      markerZoomAnimation: false,
      zoomSnap: L.Browser.touch ? 0 : 1,
      renderer: L.canvas({ padding: 0.5 }),
      center: [view.lat, view.lng],
      zoom: view.zoom,
    });

    L.control.zoom({ position: "bottomleft" }).addTo(map);
    L.control.scale({ imperial: true, metric: false, position: "bottomleft" }).addTo(map);

    SAT.addTo(map);
    SAT_LABELS.addTo(map);
    baseRef.current = SAT;
    labelsRef.current = SAT_LABELS;

    const features = L.layerGroup().addTo(map);
    const draftLayer = L.layerGroup().addTo(map);
    const gpsLayer = L.layerGroup().addTo(map);
    const searchLayer = L.layerGroup().addTo(map);
    const parallelLayer = L.layerGroup().addTo(map);
    featuresRef.current = features;
    draftRef.current = draftLayer;
    gpsRef.current = gpsLayer;
    searchRef.current = searchLayer;
    parallelRef.current = parallelLayer;
    mapRef.current = map;

    let gestureUntil = 0;
    const dragMoving = () => Boolean((map.dragging as { moving?: () => boolean }).moving?.());
    const armGesture = (ms: number) => {
      gestureUntil = Date.now() + ms;
    };
    const onClick = (e: L.LeafletMouseEvent) => {
      if (Date.now() < gestureUntil) return;
      const s = usePlantStore.getState();
      const ll = { lat: e.latlng.lat, lng: e.latlng.lng };
      if (s.tool === "select") {
        const hit = [...s.overlays].reverse().find((ov) => {
          const south = Math.min(ov.south, ov.north);
          const north = Math.max(ov.south, ov.north);
          const west = Math.min(ov.west, ov.east);
          const east = Math.max(ov.west, ov.east);
          return ll.lat >= south && ll.lat <= north && ll.lng >= west && ll.lng <= east;
        });
        s.select(hit ? { type: "overlay", id: hit.id } : null);
        return;
      }
      if (s.snapAsk) s.dismissSnap();
      if (isPointTool(s.tool)) {
        s.addPoint(s.tool, ll);
        return;
      }
      if (isLineTool(s.tool) || s.tool === "polygon" || s.tool === "overlay") {
        s.extendDraft(ll);
      }
    };

    const onDblClick = (e: L.LeafletMouseEvent) => {
      L.DomEvent.stop(e);
      const s = usePlantStore.getState();
      if (isLineTool(s.tool) || s.tool === "polygon") {
        s.finishDraft();
      }
    };

    const onMove = (e: L.LeafletMouseEvent) => {
      const s = usePlantStore.getState();
      if (!s.draft) {
        if (s.pointer) s.setPointer(null);
        return;
      }
      s.setPointer({ lat: e.latlng.lat, lng: e.latlng.lng });
    };

    const onMoveEnd = () => {
      const c = map.getCenter();
      usePlantStore.getState().setView({
        lat: c.lat,
        lng: c.lng,
        zoom: map.getZoom(),
      });
    };

    map.on("dragstart", () => {
      armGesture(900);
      if (usePlantStore.getState().gpsFollow) {
        usePlantStore.getState().setGpsFollow(false);
      }
    });
    map.on("zoomstart", () => {
      armGesture(900);
    });
    map.on("zoomend dragend", () => {
      gestureUntil = Math.min(gestureUntil, Date.now() + 280);
    });
    map.on("zoomend", () => {
      const group = parallelRef.current;
      if (group) {
        const s = usePlantStore.getState();
        paintParallel(map, group, s.lines, s.points);
      }
    });
    map.on("click", onClick);
    map.on("dblclick", onDblClick);
    map.on("mousemove", onMove);
    map.on("moveend", onMoveEnd);

    const onResize = () => {
      map.invalidateSize({ pan: false, animate: false });
    };
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(el);
    window.visualViewport?.addEventListener("resize", onResize);
    requestAnimationFrame(onResize);

    const host = el;
    const onPointerDown = () => {
      touchingRef.current = true;
      if (!dragMoving()) gestureUntil = 0;
      map.stop();
    };
    const onPointerUp = () => {
      touchingRef.current = false;
    };
    host.addEventListener("pointerdown", onPointerDown);
    host.addEventListener("pointerup", onPointerUp);
    host.addEventListener("pointercancel", onPointerUp);
    const onDrop = (ev: DragEvent) => {
      ev.preventDefault();
      const file = ev.dataTransfer?.files[0];
      if (file && file.type.startsWith("image/")) {
        void usePlantStore.getState().startOverlay(file);
      }
    };
    const onDragOver = (ev: DragEvent) => ev.preventDefault();
    host.addEventListener("drop", onDrop);
    host.addEventListener("dragover", onDragOver);

    return () => {
      host.removeEventListener("drop", onDrop);
      host.removeEventListener("dragover", onDragOver);
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointerup", onPointerUp);
      host.removeEventListener("pointercancel", onPointerUp);
      resizeObserver.disconnect();
      window.visualViewport?.removeEventListener("resize", onResize);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.removeLayer(baseRef.current);
    if (map.hasLayer(labelsRef.current)) map.removeLayer(labelsRef.current);
    if (basemap === "satellite") {
      SAT.addTo(map);
      SAT_LABELS.addTo(map);
      baseRef.current = SAT;
    } else {
      OSM.addTo(map);
      baseRef.current = OSM;
    }
  }, [basemap]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTo) return;
    map.flyTo([flyTo.lat, flyTo.lng], flyTo.zoom, { duration: 0.85 });
    usePlantStore.getState().setFlyTo(null);
  }, [flyTo]);

  useEffect(() => {
    const map = mapRef.current;
    const group = gpsRef.current;
    if (!map || !group) return;
    group.clearLayers();
    if (!gps) return;

    if (gps.accuracy > 0) {
      L.circle([gps.lat, gps.lng], {
        radius: gps.accuracy,
        color: "#f8fafc",
        weight: 1,
        opacity: 0.7,
        fillColor: "#f8fafc",
        fillOpacity: 0.08,
        interactive: false,
      }).addTo(group);
    }

    L.marker([gps.lat, gps.lng], {
      interactive: false,
      keyboard: false,
      zIndexOffset: 1400,
      icon: L.divIcon({
        className: "gps-crosshair",
        html: '<span class="arm-h"></span><span class="arm-v"></span><span class="ring"></span>',
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      }),
    }).addTo(group);

    if (gpsFollow) {
      const flying = Boolean((map as L.Map & { _flyToFrame?: number })._flyToFrame);
      if (!flying && !touchingRef.current && !Boolean((map.dragging as { moving?: () => boolean }).moving?.())) {
        const here = map.getCenter();
        const meters = map.distance(here, L.latLng(gps.lat, gps.lng));
        if (meters > 4) {
          map.panTo([gps.lat, gps.lng], { animate: meters > 30, duration: 0.25 });
        }
      }
    }
  }, [gps, gpsFollow]);

  useEffect(() => {
    const group = searchRef.current;
    if (!group) return;
    group.clearLayers();
    if (!searchMark) return;
    L.marker([searchMark.lat, searchMark.lng], {
      interactive: false,
      keyboard: false,
      zIndexOffset: 1500,
      icon: L.divIcon({
        className: "gps-crosshair",
        html: '<span class="arm-h"></span><span class="arm-v"></span><span class="ring"></span>',
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      }),
    }).addTo(group);
  }, [searchMark]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hydrated) return;
    const view = usePlantStore.getState().view;
    map.setView([view.lat, view.lng], view.zoom);
  }, [hydrated]);

  useEffect(() => {
    const map = mapRef.current;
    const group = featuresRef.current;
    if (!map || !group) return;
    if (draggingRef.current) return;

    group.clearLayers();

    for (const ov of overlays) {
      const editing = tool === "select" && selection?.type === "overlay" && selection.id === ov.id;
      const layer = L.imageOverlay(
        ov.dataUrl,
        [
          [ov.south, ov.west],
          [ov.north, ov.east],
        ],
        {
          opacity: ov.opacity,
          interactive: editing,
          bubblingMouseEvents: false,
          zIndex: editing ? 450 : 1,
        },
      );
      if (editing) {
        layer.on("click", (e) => {
          L.DomEvent.stopPropagation(e);
        });
      }
      layer.addTo(group);
      if (selection?.type === "overlay" && selection.id === ov.id) {
        const sw = L.marker([ov.south, ov.west], {
          draggable: true,
          icon: L.divIcon({
            className: "vertex-handle",
            iconSize: [12, 12],
            iconAnchor: [6, 6],
          }),
          zIndexOffset: 1200,
        });
        const ne = L.marker([ov.north, ov.east], {
          draggable: true,
          icon: L.divIcon({
            className: "vertex-handle",
            iconSize: [12, 12],
            iconAnchor: [6, 6],
          }),
          zIndexOffset: 1200,
        });
        const commitBox = () => {
          const a = sw.getLatLng();
          const b = ne.getLatLng();
          usePlantStore.getState().updateOverlay(ov.id, {
            south: Math.min(a.lat, b.lat),
            north: Math.max(a.lat, b.lat),
            west: Math.min(a.lng, b.lng),
            east: Math.max(a.lng, b.lng),
          });
        };
        sw.on("dragstart", () => {
          draggingRef.current = true;
          usePlantStore.getState().checkpoint();
        });
        ne.on("dragstart", () => {
          draggingRef.current = true;
          usePlantStore.getState().checkpoint();
        });
        sw.on("drag", () => {
          const a = sw.getLatLng();
          const b = ne.getLatLng();
          layer.setBounds(
            L.latLngBounds(
              [Math.min(a.lat, b.lat), Math.min(a.lng, b.lng)],
              [Math.max(a.lat, b.lat), Math.max(a.lng, b.lng)],
            ),
          );
        });
        ne.on("drag", () => {
          const a = sw.getLatLng();
          const b = ne.getLatLng();
          layer.setBounds(
            L.latLngBounds(
              [Math.min(a.lat, b.lat), Math.min(a.lng, b.lng)],
              [Math.max(a.lat, b.lat), Math.max(a.lng, b.lng)],
            ),
          );
        });
        sw.on("dragend", () => {
          draggingRef.current = false;
          commitBox();
        });
        ne.on("dragend", () => {
          draggingRef.current = false;
          commitBox();
        });
        const el = layer.getElement();
        if (el) {
          el.style.cursor = "grab";
          el.style.touchAction = "none";
          const onDown = (ev: PointerEvent) => {
            if (ev.button != null && ev.button !== 0) return;
            ev.stopPropagation();
            ev.preventDefault();
            draggingRef.current = true;
            map.dragging.disable();
            usePlantStore.getState().checkpoint();
            const start = map.mouseEventToLatLng(ev);
            const origin = { south: ov.south, west: ov.west, north: ov.north, east: ov.east };
            let last = origin;
            const place = (e: PointerEvent) => {
              const ll = map.mouseEventToLatLng(e);
              const dLat = ll.lat - start.lat;
              const dLng = ll.lng - start.lng;
              last = {
                south: origin.south + dLat,
                north: origin.north + dLat,
                west: origin.west + dLng,
                east: origin.east + dLng,
              };
              layer.setBounds(L.latLngBounds([last.south, last.west], [last.north, last.east]));
              sw.setLatLng([last.south, last.west]);
              ne.setLatLng([last.north, last.east]);
            };
            const onMove = (e: PointerEvent) => place(e);
            const onUp = (e: PointerEvent) => {
              place(e);
              window.removeEventListener("pointermove", onMove);
              window.removeEventListener("pointerup", onUp);
              map.dragging.enable();
              draggingRef.current = false;
              usePlantStore.getState().updateOverlay(ov.id, last);
            };
            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
          };
          el.addEventListener("pointerdown", onDown);
        }
        sw.addTo(group);
        ne.addTo(group);
      }
    }

    for (const poly of polygons) {
      const selected = selection?.type === "polygon" && selection.id === poly.id;
      const layer = L.polygon(
        poly.path.map((p) => [p.lat, p.lng] as [number, number]),
        {
          color: selected ? "#e8eaee" : "#a1a1aa",
          weight: selected ? 2.5 : 2,
          fillColor: "#64748b",
          fillOpacity: 0.28,
        },
      );
      layer.on("click", (e) => {
        if (isPointTool(usePlantStore.getState().tool)) return;
        L.DomEvent.stopPropagation(e);
        usePlantStore.getState().select({ type: "polygon", id: poly.id });
      });
      layer.addTo(group);
      bindName(layer, poly.name, "#d4d4d8");
    }

    for (const line of lines) {
      const preset = linePreset(line.kind);
      const selected = selection?.type === "line" && selection.id === line.id;
      const latlngs = line.path.map((p) => [p.lat, p.lng] as [number, number]);
      const hit = L.polyline(latlngs, {
        color: "#000",
        weight: 14,
        opacity: 0,
        interactive: true,
      });
      const width = lineWidth(line.kind);
      if (selected) {
        L.polyline(latlngs, {
          color: "#e8eaee",
          weight: width + 4,
          opacity: 0.9,
          interactive: false,
        }).addTo(group);
      }
      const vis = L.polyline(latlngs, {
        color: preset.color,
        weight: width,
        opacity: lineOpacity(line.kind),
        lineJoin: "round",
        lineCap: "round",
        interactive: false,
      });
      hit.on("click", (e) => {
        if (isPointTool(usePlantStore.getState().tool)) return;
        L.DomEvent.stopPropagation(e);
        usePlantStore.getState().select({ type: "line", id: line.id });
      });
      hit.addTo(group);
      vis.addTo(group);
      if (line.remove) {
        L.polyline(latlngs, {
          color: "#dc2626",
          weight: width + 1,
          opacity: 0.28,
          lineJoin: "round",
          lineCap: "butt",
          interactive: false,
        }).addTo(group);
        for (const [index, [a, b]] of slashMarks(line.path).entries()) {
          const latlngs: [number, number][] = [
            [a.lat, a.lng],
            [b.lat, b.lng],
          ];
          const red = index % 2 === 0;
          if (!red) {
            L.polyline(latlngs, {
              color: "#111113",
              weight: 4.5,
              opacity: 0.9,
              lineCap: "butt",
              interactive: false,
            }).addTo(group);
          }
          L.polyline(latlngs, {
            color: red ? "#dc2626" : "#ffffff",
            weight: red ? 3 : 2.5,
            opacity: 1,
            lineCap: "butt",
            interactive: false,
          }).addTo(group);
        }
      }
      const measured = pathFootage(line.path);
      const shown = reportedFeet(line);
      if (line.kind === "road") {
        const roadName = line.name.trim();
        if (roadName) {
          const mid = pathMidpoint(line.path);
          if (mid) {
            L.marker([mid.lat, mid.lng], {
              icon: footageIcon(line.remove ? `remove ${roadName}` : roadName, "", "#e4e4e7", labelPlate),
              interactive: false,
              keyboard: false,
              zIndexOffset: 400,
            }).addTo(group);
          }
        }
      } else for (const span of footageSpans(line.path, gearPoints(points))) {
        const parts = spanParts(spanShownFeet(span.feet, measured, shown), line);
        const mid = line.path[Math.floor(line.path.length / 2)] ?? line.path[0];
        const origin = mid ? map.latLngToContainerPoint([mid.lat, mid.lng]) : L.point(0, 0);
        const shifted = map.containerPointToLatLng(L.point(origin.x + 8, origin.y));
        const offsetFt = mid ? Math.max(8, haversineFeet(mid, { lat: shifted.lat, lng: shifted.lng })) : 8;
        const line1At = line.parallel ? offsetBeside(span.labelAt, span.from, span.to, offsetFt * 0.35, -1) : span.labelAt;
        const cable1At = offsetBeside(span.cableAt, span.from, span.to, offsetFt * 0.35, -1);
        const cable2At = offsetBeside(span.cableAt2, span.from, span.to, offsetFt, 1);
        L.marker([line1At.lat, line1At.lng], {
          icon: footageIcon(parts.footage, parts.detail, preset.color, labelPlate),
          interactive: false,
          keyboard: false,
          zIndexOffset: 400,
        }).addTo(group);
        if (!line.parallel) continue;
        const tag1 = slotCableTag(line, 1);
        const tag2 = slotCableTag(line, 2);
        if (tag1) {
          L.marker([cable1At.lat, cable1At.lng], {
            icon: footageIcon(tag1, "", preset.color, labelPlate),
            interactive: false,
            keyboard: false,
            zIndexOffset: 390,
          }).addTo(group);
        }
        if (tag2) {
          L.marker([cable2At.lat, cable2At.lng], {
            icon: footageIcon(tag2, "", tintHex(preset.color, 0.42), labelPlate),
            interactive: false,
            keyboard: false,
            zIndexOffset: 390,
          }).addTo(group);
        }
      }
      if (selected) {
        line.path.forEach((vertex, index) => {
          const handle = L.marker([vertex.lat, vertex.lng], {
            draggable: true,
            icon: L.divIcon({
              className: "vertex-handle",
              iconSize: [12, 12],
              iconAnchor: [6, 6],
            }),
            zIndexOffset: 1000,
          });
          handle.on("dragstart", () => {
            draggingRef.current = true;
            usePlantStore.getState().checkpoint();
          });
          handle.on("drag", (e) => {
            const ll = (e.target as L.Marker).getLatLng();
            vis.setLatLngs(
              line.path.map((p, i) =>
                i === index ? [ll.lat, ll.lng] : [p.lat, p.lng],
              ),
            );
            hit.setLatLngs(vis.getLatLngs() as L.LatLngExpression[]);
          });
          handle.on("dragend", (e) => {
            const ll = (e.target as L.Marker).getLatLng();
            draggingRef.current = false;
            usePlantStore.getState().moveLineVertex(line.id, index, {
              lat: ll.lat,
              lng: ll.lng,
            });
          });
          handle.on("click", (e) => L.DomEvent.stopPropagation(e));
          handle.addTo(group);
        });
      }
    }

    for (const pt of points) {
      const selected = selection?.type === "point" && selection.id === pt.id;
      const canSnap = isLineTool(tool) && isSnapTarget(pt.kind);
      const marked = pt.kind === "pole" && (pt.riser || (pt.anchors?.length ?? 0) > 0);
      const typedPed = pt.kind === "pedestal" && pt.pedType ? pt.pedType : "";
      const pedDir = pedestalDir(pt.pedRotate);
      const scale = canResize(pt.kind) ? objectScale(pt.size) : 1;
      const pedBox = typedPed ? pedestalPixels(typedPed, pedDir) : null;
      const typedVault = pt.kind === "vault" && pt.vaultType === "s" ? "s" : "";
      const vaultBox = typedVault ? vaultPixels() : null;
      const marker = L.marker([pt.position.lat, pt.position.lng], {
        icon: marked
          ? poleMarkIcon(Boolean(pt.riser), pt.anchors ?? [], scale)
          : typedPed
            ? pedestalIcon(typedPed, pedDir, scale)
            : typedVault
              ? vaultIcon(typedVault, scale)
              : pointIcon(pt.kind, scale),
        draggable: selected,
        zIndexOffset: canSnap ? 900 : selected ? 800 : 500,
      });
      marker.on("click", (e) => {
        const s = usePlantStore.getState();
        if (isPointTool(s.tool)) return;
        if (isLineTool(s.tool) && isSnapTarget(pt.kind)) {
          L.DomEvent.stopPropagation(e);
          s.askSnap(pt.id);
          return;
        }
        if (isLineTool(s.tool)) {
          L.DomEvent.stopPropagation(e);
          const ll = e.latlng;
          s.extendDraft({ lat: ll.lat, lng: ll.lng });
          return;
        }
        L.DomEvent.stopPropagation(e);
        s.select({ type: "point", id: pt.id });
      });
      if (selected) {
        marker.on("dragstart", () => usePlantStore.getState().checkpoint());
        marker.on("dragend", (e) => {
          const ll = (e.target as L.Marker).getLatLng();
          usePlantStore.getState().movePoint(pt.id, { lat: ll.lat, lng: ll.lng });
        });
      }
      const vaultLabel = pt.kind === "vault" && pt.vaultType === "s" && !pt.name.trim() ? "flower pot" : pt.name;
      bindName(
        marker,
        pt.remove ? (vaultLabel.trim() ? `remove ${vaultLabel.trim()}` : "remove") : vaultLabel,
        pointLabelColor(pt.kind),
        pt.labelSide ?? "top",
        pt.kind,
      );
      marker.addTo(group);
      if (pt.remove) {
        const box = pedBox
          ? { w: pedBox.w, h: pedBox.h, ax: pedBox.w / 2, ay: pedBox.h / 2 }
          : vaultBox
            ? { w: vaultBox.w, h: vaultBox.h, ax: vaultBox.w / 2, ay: vaultBox.h / 2 }
            : pt.kind === "pin"
            ? { w: 26, h: 36, ax: 13, ay: 34 }
            : pt.kind === "passing"
              ? { w: 16, h: 16, ax: 8, ay: 8 }
              : pt.kind === "pole" && (pt.anchors?.length ?? 0) > 0
                ? { w: 28, h: 28, ax: 14, ay: 14 }
                : pt.kind === "pole" && pt.riser
                  ? { w: 26, h: 26, ax: 13, ay: 13 }
                  : { w: 22, h: 22, ax: 11, ay: 11 };
        L.marker([pt.position.lat, pt.position.lng], {
          interactive: false,
          keyboard: false,
          zIndexOffset: 870,
          icon: L.divIcon({
            className: "remove-mark",
            html: '<span class="remove-slash"></span>',
            iconSize: [box.w * scale, box.h * scale],
            iconAnchor: [box.ax * scale, box.ay * scale],
          }),
        }).addTo(group);
      }
      if (canSnap) {
        marker.getElement()?.classList.add("snap-ready");
        L.marker([pt.position.lat, pt.position.lng], {
          interactive: false,
          keyboard: false,
          zIndexOffset: 980,
          icon: L.divIcon({
            className: "snap-point",
            html: '<span class="snap-point-dot"></span>',
            iconSize: [14, 14],
            iconAnchor: [7, 7],
          }),
        }).addTo(group);
      }
    }

    const parallel = parallelRef.current;
    if (parallel) paintParallel(map, parallel, lines, points);
  }, [lines, points, polygons, overlays, selection, tool, labelPlate]);

  useEffect(() => {
    const group = draftRef.current;
    if (!group) return;
    group.clearLayers();
    if (!draft) return;

    const ghostPoint = (ll: LatLng, kind: string) => {
      const color = kind === "poly" ? "#d4d4d8" : linePreset(kind as LineKind).color;
      L.circleMarker([ll.lat, ll.lng], {
        radius: 4,
        color: "#0a0b0d",
        weight: 1,
        fillColor: color,
        fillOpacity: 1,
      }).addTo(group);
    };

    if (draft.mode === "line") {
      const last = draft.path[draft.path.length - 1];
      let extra: LatLng[] = [];
      if (pointer && last) {
        extra = [shift ? constrainCardinal(last, pointer) : pointer];
      }
      const path = [...draft.path, ...extra];
      if (path.length >= 2) {
        L.polyline(
          path.map((p) => [p.lat, p.lng] as [number, number]),
          {
            color: linePreset(draft.kind).color,
            weight: lineWidth(draft.kind),
            opacity: lineOpacity(draft.kind),
            dashArray: extra.length ? "6 6" : undefined,
          },
        ).addTo(group);
      }
      for (const p of draft.path) ghostPoint(p, draft.kind);
      if (draft.path.length >= 2 && draft.kind !== "road") {
        for (const span of footageSpans(draft.path, gearPoints(points))) {
          L.marker([span.labelAt.lat, span.labelAt.lng], {
            icon: footageIcon(formatFootageLabel(span.feet), "", linePreset(draft.kind).color, labelPlate),
            interactive: false,
          }).addTo(group);
        }
      }
      if (extra.length === 1 && last) {
        const tip = extra[0];
        if (tip) {
          const feet = haversineFeet(last, tip);
          if (feet >= 1) {
            L.marker([(last.lat + tip.lat) / 2, (last.lng + tip.lng) / 2], {
              icon: footageIcon(formatFootageLabel(feet), "", linePreset(draft.kind).color, labelPlate),
              interactive: false,
              zIndexOffset: 1200,
            }).addTo(group);
          }
        }
      }
    }

    if (draft.mode === "polygon") {
      const last = draft.path[draft.path.length - 1];
      let extra: LatLng[] = [];
      if (pointer && last) {
        extra = [shift ? constrainCardinal(last, pointer) : pointer];
      }
      const path = [...draft.path, ...extra];
      if (path.length >= 2) {
        L.polygon(
          path.map((p) => [p.lat, p.lng] as [number, number]),
          {
            color: "#d4d4d8",
            weight: 2,
            fillColor: "#64748b",
            fillOpacity: 0.2,
            dashArray: "6 6",
          },
        ).addTo(group);
      }
      for (const p of draft.path) ghostPoint(p, "poly");
    }

    if (draft.mode === "overlay" && draft.a) {
      ghostPoint(draft.a, "ug-new");
      if (pointer) {
        L.rectangle(L.latLngBounds(toLL(draft.a), toLL(pointer)), {
          color: "#e8eaee",
          weight: 1,
          dashArray: "5 4",
          fillOpacity: 0.08,
        }).addTo(group);
        L.imageOverlay(draft.dataUrl, L.latLngBounds(toLL(draft.a), toLL(pointer)), {
          opacity: 0.55,
        }).addTo(group);
      }
    }
  }, [draft, pointer, shift, points, labelPlate]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getContainer().classList.toggle("drawing-cursor", tool !== "select");
  }, [tool]);

  return <div ref={hostRef} className="absolute inset-0 z-0" />;
}
