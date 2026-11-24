import { useEffect, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react";
import L from "leaflet";
import { usePlantStore } from "@/lib/store";
import type { FrameFeature, LatLng, NoteBoard } from "@/lib/types";
import { calloutAt, calloutFeet, footageSpans, haversineFeet, joinMask, objectSpans, offsetBeside, parallelOffsetFt, parallelPath, pathFootage, pathFrame, pathMidpoint, pointSlashMarks, readableRotation, reportedFeet, slashMarks, slotCableTag, spanCalloutDir, spanCalloutStep, spanParts, spanShownFeet, squareLine2 } from "@/lib/geo";
import { isSnapTarget, joinsAtEnds, linePaint, linePreset, lineWeightOf, lineWidth, pointLabelColor, tintHex } from "@/lib/presets";
import { pedestalIconDataUrl, pointIconDataUrl } from "@/lib/icons";
import { escapeHtml } from "@/lib/utils";

const SAT =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

function frameZoom(mapZoom: number, closer: number) {
  return Math.min(22, mapZoom + Math.log2(1 + Math.max(0, closer)));
}

function paintSlashes(group: L.LayerGroup, path: LatLng[]) {
  for (const [index, [a, b]] of slashMarks(path).entries()) {
    const latlngs: [number, number][] = [
      [a.lat, a.lng],
      [b.lat, b.lng],
    ];
    const red = index % 2 === 0;
    if (!red) {
      L.polyline(latlngs, { color: "#111113", weight: 4.5, opacity: 0.9, lineCap: "butt", interactive: false }).addTo(group);
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

function projectBox(map: L.Map, box: { south: number; west: number; north: number; east: number }) {
  const sw = map.latLngToContainerPoint([Math.min(box.south, box.north), Math.min(box.west, box.east)]);
  const ne = map.latLngToContainerPoint([Math.max(box.south, box.north), Math.max(box.west, box.east)]);
  const left = Math.min(sw.x, ne.x);
  const top = Math.min(sw.y, ne.y);
  return { left, top, width: Math.max(1, Math.abs(ne.x - sw.x)), height: Math.max(1, Math.abs(ne.y - sw.y)) };
}

function edgeToward(box: { south: number; north: number; west: number; east: number }, outside: { lat: number; lng: number }) {
  const south = Math.min(box.south, box.north);
  const north = Math.max(box.south, box.north);
  const west = Math.min(box.west, box.east);
  const east = Math.max(box.west, box.east);
  const lat = Math.min(north, Math.max(south, outside.lat));
  const lng = Math.min(east, Math.max(west, outside.lng));
  const inside = outside.lat > south && outside.lat < north && outside.lng > west && outside.lng < east;
  if (!inside) return { lat, lng };
  const choices = [
    { d: Math.abs(outside.lat - south), at: { lat: south, lng: outside.lng } },
    { d: Math.abs(north - outside.lat), at: { lat: north, lng: outside.lng } },
    { d: Math.abs(outside.lng - west), at: { lat: outside.lat, lng: west } },
    { d: Math.abs(east - outside.lng), at: { lat: outside.lat, lng: east } },
  ].sort((a, b) => a.d - b.d);
  return choices[0]?.at ?? { lat, lng };
}

export function MapChrome({
  map,
  onGesture,
}: {
  map: L.Map | null;
  onGesture: (active: boolean) => void;
}) {
  const notes = usePlantStore((s) => s.notes);
  const board = usePlantStore((s) => s.board);
  const frames = usePlantStore((s) => s.frames);
  const selection = usePlantStore((s) => s.selection);
  const tool = usePlantStore((s) => s.tool);
  const shotKeep = usePlantStore((s) => s.shotKeep);
  const shotBox = usePlantStore((s) => s.shotBox);
  const [, setTick] = useState(0);
  const inners = useRef(new Map<string, L.Map>());

  useEffect(() => {
    if (!map) return;
    const bump = () => setTick((n) => n + 1);
    map.on("move zoom resize", bump);
    return () => {
      map.off("move zoom resize", bump);
    };
  }, [map]);

  useEffect(() => {
    if (!map) return;
    const live = new Set(frames.map((frame) => frame.id));
    for (const [id, inner] of inners.current) {
      if (!live.has(id)) {
        inner.remove();
        inners.current.delete(id);
      }
    }
  }, [frames, map]);

  if (!map) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-[500]">
      <svg className="pointer-events-none absolute inset-0 h-full w-full">
        {frames.map((frame) => {
          const source = { south: frame.south, north: frame.north, west: frame.west, east: frame.east };
          const view = { south: frame.viewSouth, north: frame.viewNorth, west: frame.viewWest, east: frame.viewEast };
          const sourceMid = { lat: (source.south + source.north) / 2, lng: (source.west + source.east) / 2 };
          const viewMid = { lat: (view.south + view.north) / 2, lng: (view.west + view.east) / 2 };
          const from = map.latLngToContainerPoint(edgeToward(source, viewMid));
          const to = map.latLngToContainerPoint(edgeToward(view, sourceMid));
          return (
            <line
              key={frame.id}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={frame.linkColor || "#f5d90a"}
              strokeWidth="1.25"
              strokeDasharray="3 4"
            />
          );
        })}
      </svg>
      {board && notes.length > 0 && board.opened ? (
        <Board
          map={map}
          board={board}
          notes={(shotKeep ? notes.filter((note) => shotKeep.includes(note.n)) : notes).map((note) => ({ n: note.n, text: note.text }))}
          selected={selection?.type === "board" || shotKeep != null}
          onGesture={onGesture}
        />
      ) : null}
      {shotBox ? (
        <div
          className="pointer-events-none absolute border-2 border-dashed border-[#f5d90a] bg-[#f5d90a]/10"
          style={projectBox(map, shotBox)}
        />
      ) : null}
      {tool === "select"
        ? frames.map((frame) => {
            const box = projectBox(map, frame);
            const edges = [
              { left: box.left - 8, top: box.top - 8, width: box.width + 16, height: 16 },
              { left: box.left - 8, top: box.top + box.height - 8, width: box.width + 16, height: 16 },
              { left: box.left - 8, top: box.top, width: 16, height: box.height },
              { left: box.left + box.width - 8, top: box.top, width: 16, height: box.height },
            ];
            return edges.map((edge, index) => (
              <div
                key={`${frame.id}-edge-${index}`}
                data-frame-edge="1"
                className="pointer-events-auto absolute"
                style={{ ...edge, cursor: selection?.type === "frame" && selection.id === frame.id ? "grab" : "pointer" }}
                onClick={(ev) => {
                  ev.stopPropagation();
                  if (usePlantStore.getState().tool !== "select") return;
                  usePlantStore.getState().select({ type: "frame", id: frame.id });
                }}
                onPointerDown={(ev) => {
                  if (usePlantStore.getState().tool !== "select") return;
                  ev.stopPropagation();
                  if (!(selection?.type === "frame" && selection.id === frame.id)) return;
                  const origin = { ...frame };
                  grab(ev, map, onGesture, (dLat, dLng) => {
                    usePlantStore.getState().updateFrame(frame.id, {
                      south: origin.south + dLat,
                      north: origin.north + dLat,
                      west: origin.west + dLng,
                      east: origin.east + dLng,
                    });
                  });
                }}
              />
            ));
          })
        : null}
      {frames.map((frame) => (
        <FrameInset key={frame.id} map={map} frame={frame} inners={inners} selected={selection?.type === "frame" && selection.id === frame.id} onGesture={onGesture} />
      ))}
    </div>
  );
}

function grab(
  ev: ReactPointerEvent,
  map: L.Map,
  onGesture: (active: boolean) => void,
  moveBy: (dLat: number, dLng: number) => void,
) {
  ev.stopPropagation();
  ev.preventDefault();
  onGesture(true);
  map.dragging.disable();
  usePlantStore.getState().checkpoint();
  const start = map.mouseEventToLatLng(ev.nativeEvent);
  const place = (e: PointerEvent) => {
    const ll = map.mouseEventToLatLng(e);
    moveBy(ll.lat - start.lat, ll.lng - start.lng);
  };
  const onUp = (e: PointerEvent) => {
    window.removeEventListener("pointermove", place);
    window.removeEventListener("pointerup", onUp);
    if (usePlantStore.getState().tool !== "frame") map.dragging.enable();
    onGesture(false);
    place(e);
  };
  window.addEventListener("pointermove", place);
  window.addEventListener("pointerup", onUp);
}

function inFrame(frame: FrameFeature, at: LatLng | null | undefined) {
  if (!at) return false;
  const south = Math.min(frame.south, frame.north);
  const north = Math.max(frame.south, frame.north);
  const west = Math.min(frame.west, frame.east);
  const east = Math.max(frame.west, frame.east);
  return at.lat >= south && at.lat <= north && at.lng >= west && at.lng <= east;
}

function textIcon(footage: string, detail: string, color: string, plate: boolean, size: string, turn: number) {
  const extra = detail ? `<span class="footage-detail">${escapeHtml(detail)}</span>` : "";
  const spin = turn ? `transform:rotate(${turn}deg)` : "";
  return L.divIcon({
    className: ["footage-label", plate ? "plate" : "", `size-${size}`].filter(Boolean).join(" "),
    html: `<span class="footage-stack" style="color:${color};${spin}"><span class="footage-feet">${escapeHtml(footage)}</span>${extra}</span>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  });
}

function turnOf(map: L.Map, from: LatLng, to: LatLng, text: string, size: string) {
  const a = map.latLngToContainerPoint([from.lat, from.lng]);
  const b = map.latLngToContainerPoint([to.lat, to.lng]);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const bearing = (Math.atan2(b.x - a.x, a.y - b.y) * 180) / Math.PI;
  const charW = size === "xl" ? 14 : size === "lg" ? 10.7 : size === "md" ? 8 : 7.3;
  const along = len >= Math.max(text.length, 1) * charW + 8;
  return readableRotation(along ? bearing : bearing + 90);
}

function Board({
  map,
  board,
  notes,
  selected,
  onGesture,
}: {
  map: L.Map;
  board: NoteBoard;
  notes: { n: number; text: string }[];
  selected: boolean;
  onGesture: (active: boolean) => void;
}) {
  const box = projectBox(map, board);
  const written = board.opened ? notes.filter((note) => note.text.trim()) : [];
  const body = useRef<HTMLDivElement | null>(null);
  const copy = written.map((note) => `${note.n}:${note.text}`).join("\n");
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    let size = Math.min(26, Math.max(11, box.width / 14));
    el.style.fontSize = `${size}px`;
    while (size > 8 && el.scrollHeight > el.clientHeight + 1) {
      size -= 0.5;
      el.style.fontSize = `${size}px`;
    }
  }, [box.width, box.height, copy]);
  const drag = (ev: ReactPointerEvent, mode: "move" | "se" | "nw") => {
    ev.stopPropagation();
    ev.preventDefault();
    onGesture(true);
    map.dragging.disable();
    usePlantStore.getState().checkpoint();
    const start = map.mouseEventToLatLng(ev.nativeEvent);
    const origin = { ...board };
    const place = (e: PointerEvent) => {
      const ll = map.mouseEventToLatLng(e);
      const dLat = ll.lat - start.lat;
      const dLng = ll.lng - start.lng;
      if (mode === "move") {
        usePlantStore.getState().updateBoard({
          south: origin.south + dLat,
          north: origin.north + dLat,
          west: origin.west + dLng,
          east: origin.east + dLng,
        });
        return;
      }
      if (mode === "se") {
        usePlantStore.getState().updateBoard({
          east: Math.max(Math.min(origin.west, origin.east) + 0.000008, ll.lng),
          south: Math.min(Math.max(origin.south, origin.north) - 0.000008, ll.lat),
        });
        return;
      }
      usePlantStore.getState().updateBoard({
        west: Math.min(Math.max(origin.west, origin.east) - 0.000008, ll.lng),
        north: Math.max(Math.min(origin.south, origin.north) + 0.000008, ll.lat),
      });
    };
    const onUp = (e: PointerEvent) => {
      window.removeEventListener("pointermove", place);
      window.removeEventListener("pointerup", onUp);
      if (usePlantStore.getState().tool !== "frame") map.dragging.enable();
      onGesture(false);
      place(e);
    };
    window.addEventListener("pointermove", place);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      className="pointer-events-auto absolute overflow-hidden rounded-md border border-white/70 text-white shadow-lg"
      data-board-shot="1"
      style={{
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        background: `rgba(17,17,19,${board.opened ? board.opacity : 1})`,
        lineHeight: 1.35,
        cursor: selected ? "grab" : "pointer",
      }}
      onClick={(ev) => {
        ev.stopPropagation();
        if (usePlantStore.getState().tool !== "select") return;
        if (!board.opened) {
          const view = usePlantStore.getState().view;
          const world = 256 * 2 ** (Number.isFinite(view.zoom) ? view.zoom : 18);
          const cos = Math.max(0.2, Math.abs(Math.cos((view.lat * Math.PI) / 180)));
          const west = Math.min(board.west, board.east);
          const south = Math.min(board.south, board.north);
          usePlantStore.getState().updateBoard({
            opened: true,
            west,
            south,
            east: west + (210 / world) * 360,
            north: south + (Math.max(56, notes.length * 22 + 12) / world) * 360 * cos,
          });
        }
        usePlantStore.getState().select({ type: "board" });
      }}
      onPointerDown={(ev) => {
        if ((ev.target as HTMLElement).dataset.handle) return;
        const placing = usePlantStore.getState().shotKeep != null;
        if (usePlantStore.getState().tool !== "select" && !placing) return;
        ev.stopPropagation();
        if (!selected && !placing) return;
        const origin = { ...board };
        grab(ev, map, onGesture, (dLat, dLng) => {
          usePlantStore.getState().updateBoard({
            south: origin.south + dLat,
            north: origin.north + dLat,
            west: origin.west + dLng,
            east: origin.east + dLng,
          });
        });
      }}
    >
      <div ref={body} className="pointer-events-none h-full overflow-hidden px-2 py-1" style={{ textShadow: "0 1px 2px #000" }}>
        {board.opened
          ? written
              .slice()
              .sort((a, b) => a.n - b.n)
              .map((note) => (
                <p key={note.n} className="mb-[0.35em] flex items-start gap-[0.4em] break-words whitespace-pre-wrap">
                  <span className="mt-[0.1em] inline-grid size-[1.15em] shrink-0 place-items-center rounded-full bg-white text-[0.85em] font-extrabold text-[#111113] ring-1 ring-black">{note.n}</span>
                  <span className="min-w-0 flex-1">{note.text}</span>
                </p>
              ))
          : "click to create list"}
      </div>
      {selected && board.opened ? (
        <>
          <button type="button" data-handle="nw" aria-label="Resize list from corner" className="absolute top-0 left-0 size-3 border border-white bg-[#f5d90a]" onPointerDown={(ev) => drag(ev, "nw")} />
          <button type="button" data-handle="se" aria-label="Resize list" className="absolute right-0 bottom-0 size-3 border border-white bg-[#f5d90a]" onPointerDown={(ev) => drag(ev, "se")} />
        </>
      ) : null}
    </div>
  );
}

function FrameInset({
  map,
  frame,
  inners,
  selected,
  onGesture,
}: {
  map: L.Map;
  frame: FrameFeature;
  inners: MutableRefObject<Map<string, L.Map>>;
  selected: boolean;
  onGesture: (active: boolean) => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const lines = usePlantStore((s) => s.lines);
  const points = usePlantStore((s) => s.points);
  const polygons = usePlantStore((s) => s.polygons);
  const notes = usePlantStore((s) => s.notes);
  const labelPlate = usePlantStore((s) => s.labelPlate);
  const center = L.latLng((frame.south + frame.north) / 2, (frame.west + frame.east) / 2);
  const zoom = frameZoom(map.getZoom(), frame.closer);

  useEffect(() => {
    const el = host.current;
    if (!el || inners.current.has(frame.id)) return;
    const inner = L.map(el, {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      zoomSnap: 0.1,
    });
    L.tileLayer(SAT, { maxZoom: 23, maxNativeZoom: 19, crossOrigin: "anonymous" }).addTo(inner);
    inner.getContainer().style.pointerEvents = "none";
    inner.setView(center, zoom, { animate: false });
    L.DomEvent.disableScrollPropagation(el);
    inners.current.set(frame.id, inner);
  }, [frame.id]);

  useEffect(() => {
    const inner = inners.current.get(frame.id);
    if (!inner) return;
    inner.invalidateSize({ animate: false });
    if (Math.abs(inner.getZoom() - zoom) > 0.05 || inner.getCenter().distanceTo(center) > 2) {
      inner.setView(center, zoom, { animate: false });
    }
  }, [frame.viewSouth, frame.viewNorth, frame.viewWest, frame.viewEast, frame.south, frame.north, frame.west, frame.east, frame.id, zoom, center.lat, center.lng]);

  useEffect(() => {
    const inner = inners.current.get(frame.id);
    if (!inner) return;
    let group = (inner as L.Map & { _plant?: L.LayerGroup })._plant;
    if (!group) {
      group = L.layerGroup().addTo(inner);
      (inner as L.Map & { _plant?: L.LayerGroup })._plant = group;
    }
    group.clearLayers();
    for (const poly of polygons) {
      if (poly.path.length < 3) continue;
      L.polygon(poly.path.map((p) => [p.lat, p.lng] as [number, number]), {
        color: poly.stroke || "#a1a1aa",
        weight: 2,
        fillColor: poly.fill || "#64748b",
        fillOpacity: poly.fillOpacity ?? 0.25,
        interactive: false,
      }).addTo(group);
    }
    for (const line of lines) {
      if (line.path.length < 2) continue;
      const color = linePaint(line);
      const weight = lineWeightOf(line);
      L.polyline(line.path.map((p) => [p.lat, p.lng] as [number, number]), { color, weight, interactive: false }).addTo(group);
      if (line.remove) paintSlashes(group, line.path);
    }
    for (const point of points) {
      const iconUrl = point.kind === "pedestal" && point.pedType ? pedestalIconDataUrl(point.pedType, point.pedRotate) : pointIconDataUrl(point.kind);
      if (!iconUrl) continue;
      const marker = L.marker([point.position.lat, point.position.lng], {
        interactive: false,
        keyboard: false,
        icon: L.icon({ iconUrl, iconSize: [18, 18], iconAnchor: [9, 9] }),
      }).addTo(group);
      const name = point.kind === "vault" && point.vaultType === "s" && !point.name.trim() ? "flower pot" : point.name;
      const label = point.remove ? (name.trim() ? `remove ${name.trim()}` : "remove") : name;
      if (label.trim()) {
        marker.bindTooltip(`<span style="color:${pointLabelColor(point.kind)}">${escapeHtml(label)}</span>`, {
          permanent: true,
          direction: point.labelSide || "top",
          opacity: 1,
          className: `object-label size-${point.labelSize || "lg"}`,
        });
      }
      if (point.remove) {
        for (const [a, b] of pointSlashMarks(point.position)) {
          L.polyline(
            [
              [a.lat, a.lng],
              [b.lat, b.lng],
            ],
            { color: "#dc2626", weight: 2, opacity: 1, lineCap: "butt", interactive: false },
          ).addTo(group);
        }
      }
    }
    const gear = points.filter((point) => isSnapTarget(point.kind)).map((point) => point.position);
    const project = (ll: LatLng) => {
      const px = inner.latLngToContainerPoint([ll.lat, ll.lng]);
      return { x: px.x, y: px.y };
    };
    const open: { id: string; kind: (typeof lines)[number]["kind"]; path: LatLng[]; offsetFt: number; drawn: LatLng[] }[] = [];
    for (const line of lines) {
      if (!line.parallel || line.path.length < 2) continue;
      const offsetFt = parallelOffsetFt(line.path, project);
      const canJoin = Boolean(line.joinEnds) && joinsAtEnds(line.kind);
      const snapped = (line.snaps ?? []).filter((snap) => gear.some((at) => haversineFeet(snap, at) <= 0.5));
      const drawn = parallelPath(line.path, offsetFt, joinMask(line.path, snapped, canJoin, [], 0.5));
      if (drawn.length < 2) continue;
      if (!canJoin) {
        open.push({ id: line.id, kind: line.kind, path: line.path, offsetFt, drawn });
        continue;
      }
      L.polyline(drawn.map((p) => [p.lat, p.lng] as [number, number]), {
        color: tintHex(linePaint(line), 0.42),
        weight: lineWeightOf(line),
        interactive: false,
      }).addTo(group);
      if (line.remove) paintSlashes(group, drawn);
    }
    for (const figure of squareLine2(open, gear)) {
      if (figure.path.length < 2) continue;
      L.polyline(figure.path.map((p) => [p.lat, p.lng] as [number, number]), {
        color: tintHex(linePreset(figure.kind).color, 0.42),
        weight: lineWidth(figure.kind),
        interactive: false,
      }).addTo(group);
      const source = lines.find((line) => line.id === figure.id);
      if (source?.remove) paintSlashes(group, figure.path);
    }
    const seenDots = new Set<string>();
    for (const line of lines) {
      for (const dot of line.dots ?? []) {
        if (!dot.show || !inFrame(frame, dot.at)) continue;
        const key = `${dot.at.lat.toFixed(5)},${dot.at.lng.toFixed(5)}`;
        if (seenDots.has(key)) continue;
        seenDots.add(key);
        const color = linePreset(line.kind).color;
        L.circleMarker([dot.at.lat, dot.at.lng], {
          radius: Math.max(5, lineWidth(line.kind) * 0.8),
          color: "#ffffff",
          weight: 2,
          fillColor: color,
          fillOpacity: 1,
          interactive: false,
        }).addTo(group);
      }
    }
    for (const line of lines) {
      if (line.path.length < 2 || line.kind === "road") continue;
      const paint = linePaint(line);
      const measured = pathFootage(line.path);
      const shown = reportedFeet(line);
      const size = line.labelSize || "md";
      const spans = footageSpans(line.path, gear, line.splits ?? [], (line.dots ?? []).map((dot) => dot.at));
      spans.forEach((span, index) => {
        if (!inFrame(frame, span.labelAt)) return;
        const parts = spanParts(spanShownFeet(span.feet, measured, shown), line);
        const footage = line.hideFootage ? "" : parts.footage;
        const detail = span.showCable ? parts.detail : "";
        if (!footage && !detail) return;
        if (line.callout) {
          const at = calloutAt(span.labelAt, spanCalloutDir(line.calloutDirs, index), calloutFeet(spanCalloutStep(line.calloutSteps, index)));
          L.polyline([[span.labelAt.lat, span.labelAt.lng], [at.lat, at.lng]], { color: tintHex(paint, 0.45), weight: 1, interactive: false }).addTo(group);
          L.marker([at.lat, at.lng], { icon: textIcon(footage, detail, paint, true, size, 0), interactive: false, keyboard: false }).addTo(group);
          return;
        }
        const mid = span.from;
        const origin = inner.latLngToContainerPoint([mid.lat, mid.lng]);
        const shifted = inner.containerPointToLatLng(L.point(origin.x + 8, origin.y));
        const offsetFt = Math.max(8, haversineFeet(mid, { lat: shifted.lat, lng: shifted.lng }));
        const at = line.parallel ? offsetBeside(span.labelAt, span.from, span.to, offsetFt * 0.35, -1) : span.labelAt;
        L.marker([at.lat, at.lng], {
          icon: textIcon(footage, detail, paint, labelPlate, size, turnOf(inner, span.from, span.to, `${footage}${detail}`, size)),
          interactive: false,
          keyboard: false,
        }).addTo(group);
      });
      if (line.parallel && !line.callout) {
        for (const span of objectSpans(line.path, gear, [...(line.splits ?? []), ...(line.dots ?? []).map((dot) => dot.at)])) {
          if (!inFrame(frame, span.from) && !inFrame(frame, span.to)) continue;
          const tag1 = slotCableTag(line, 1);
          const tag2 = slotCableTag(line, 2);
          const mid = span.slice[Math.floor(span.slice.length / 2)] ?? span.from;
          const origin = inner.latLngToContainerPoint([mid.lat, mid.lng]);
          const shifted = inner.containerPointToLatLng(L.point(origin.x + 8, origin.y));
          const offsetFt = Math.max(8, haversineFeet(mid, { lat: shifted.lat, lng: shifted.lng }));
          const frame1 = pathFrame(span.slice, 0.42);
          const frame2 = pathFrame(span.slice, 0.58);
          if (tag1) {
            const at = offsetBeside(frame1.at, frame1.from, frame1.to, offsetFt * 0.35, -1);
            L.marker([at.lat, at.lng], { icon: textIcon(tag1, "", paint, labelPlate, size, turnOf(inner, frame1.from, frame1.to, tag1, size)), interactive: false, keyboard: false }).addTo(group);
          }
          if (tag2) {
            const at = offsetBeside(frame2.at, frame2.from, frame2.to, offsetFt, 1);
            L.marker([at.lat, at.lng], { icon: textIcon(tag2, "", tintHex(paint, 0.42), labelPlate, size, turnOf(inner, frame2.from, frame2.to, tag2, size)), interactive: false, keyboard: false }).addTo(group);
          }
        }
      }
    }
    for (const poly of polygons) {
      const mid = pathMidpoint(poly.path);
      if (!mid || !poly.name.trim() || !inFrame(frame, mid)) continue;
      L.marker([mid.lat, mid.lng], {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({ className: "ref-badge-wrap", html: `<span class="object-label poly-${poly.labelSize || "sm"}" style="color:#d4d4d8">${escapeHtml(poly.name)}</span>`, iconSize: [0, 0], iconAnchor: [0, 0] }),
      }).addTo(group);
    }
    for (const note of notes) {
      if (!inFrame(frame, note.at) && !inFrame(frame, note.anchor)) continue;
      if (note.callout && note.anchor) {
        L.polyline([[note.anchor.lat, note.anchor.lng], [note.at.lat, note.at.lng]], { color: "#f5d90a", weight: 1.25, dashArray: "2 3", interactive: false }).addTo(group);
      }
      L.marker([note.at.lat, note.at.lng], {
        interactive: false,
        keyboard: false,
        icon: L.divIcon({ className: "ref-badge-wrap", html: `<span class="ref-badge">${note.n}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
      }).addTo(group);
    }
  }, [frame, lines, points, polygons, notes, labelPlate, zoom]);

  const box = projectBox(map, { south: frame.viewSouth, west: frame.viewWest, north: frame.viewNorth, east: frame.viewEast });
  const drag = (ev: ReactPointerEvent, mode: "move" | "se") => {
    ev.stopPropagation();
    ev.preventDefault();
    onGesture(true);
    map.dragging.disable();
    usePlantStore.getState().checkpoint();
    const start = map.mouseEventToLatLng(ev.nativeEvent);
    const origin = { ...frame };
    const place = (e: PointerEvent) => {
      const ll = map.mouseEventToLatLng(e);
      if (mode === "move") {
        const dLat = ll.lat - start.lat;
        const dLng = ll.lng - start.lng;
        usePlantStore.getState().updateFrame(frame.id, {
          viewSouth: origin.viewSouth + dLat,
          viewNorth: origin.viewNorth + dLat,
          viewWest: origin.viewWest + dLng,
          viewEast: origin.viewEast + dLng,
        });
        return;
      }
      usePlantStore.getState().updateFrame(frame.id, {
        viewEast: Math.max(Math.min(origin.viewWest, origin.viewEast) + 0.00001, ll.lng),
        viewSouth: Math.min(Math.max(origin.viewSouth, origin.viewNorth) - 0.00001, ll.lat),
      });
    };
    const onUp = (e: PointerEvent) => {
      window.removeEventListener("pointermove", place);
      window.removeEventListener("pointerup", onUp);
      if (usePlantStore.getState().tool !== "frame") map.dragging.enable();
      onGesture(false);
      place(e);
    };
    window.addEventListener("pointermove", place);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      className="pointer-events-auto absolute overflow-hidden border-2 bg-black shadow-lg"
      data-frame-id={frame.id}
      style={{ left: box.left, top: box.top, width: box.width, height: box.height, cursor: selected ? "grab" : "pointer", borderColor: frame.linkColor || "#f5d90a", borderStyle: "dashed" }}
      onClick={(ev) => {
        ev.stopPropagation();
        if (usePlantStore.getState().tool !== "select") return;
        usePlantStore.getState().select({ type: "frame", id: frame.id });
      }}
      onPointerDown={(ev) => {
        if ((ev.target as HTMLElement).dataset.handle) return;
        if (usePlantStore.getState().tool !== "select") return;
        ev.stopPropagation();
        if (!selected) return;
        const origin = { ...frame };
        grab(ev, map, onGesture, (dLat, dLng) => {
          usePlantStore.getState().updateFrame(frame.id, {
            viewSouth: origin.viewSouth + dLat,
            viewNorth: origin.viewNorth + dLat,
            viewWest: origin.viewWest + dLng,
            viewEast: origin.viewEast + dLng,
          });
        });
      }}
      onWheel={(ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const closer = Math.min(3, Math.max(0, frame.closer + (ev.deltaY < 0 ? 0.1 : -0.1)));
        usePlantStore.getState().updateFrame(frame.id, { closer });
      }}
    >
      <div ref={host} className="pointer-events-none h-full w-full" />
      <span className="export-hide pointer-events-none absolute bottom-1 left-1 rounded bg-black/70 px-1 py-0.5 text-[9px] text-white">pdf only</span>
      {selected ? (
        <button
          type="button"
          data-handle="se"
          aria-label="Resize frame"
          className="absolute right-0 bottom-0 z-[1000] size-3 border border-white"
          style={{ background: frame.linkColor || "#f5d90a" }}
          onPointerDown={(ev) => drag(ev, "se")}
        />
      ) : null}
    </div>
  );
}
