import JSZip from "jszip";
import type {
  LatLng,
  LineFeature,
  LineKind,
  LabelSize,
  FrameFeature,
  OverlayFeature,
  PlantProject,
  PointFeature,
  PolygonFeature,
  SlotChoice,
} from "./types";
import { isCableType } from "./types";
import { escapeXml } from "./utils";
import {
  ALL_LINE_PRESETS,
  ALL_POINT_PRESETS,
  linePaint,
  lineWidth,
  lineWeightOf,
  pointIconScale,
  isLineKind,
  isPointKind,
  joinsAtEnds,
  hexToKmlColor,
  hexToRgb,
  kmlColorToHex,
  tintHex,
  nearestLineKind,
  plantTotals,
  pointPreset,
  pointLabelColor,
  isPedType,
  isVaultType,
  pedestalColor,
  pedestalDir,
  vaultColor,
} from "./presets";
import { footageSpans, formatFeet, haversineFeet, joinMask, parallelPath, offsetBeside, objectSpans, pathFrame, pathFootage, pathMidpoint, reportedFeet, spanShownFeet, squareLine2, slashMarks, slotCableTag, spanParts, calloutAt, calloutFeet, spanCalloutDir, spanCalloutStep } from "./geo";
import { blobToDataUrl, dataUrlToBytes, pedestalIconDataUrl, pointIconDataUrl, poleVariantDataUrl, stampRemoveSlashes, vaultIconDataUrl } from "./icons";

function coord(ll: LatLng): string {
  return `${ll.lng},${ll.lat}`;
}

function nudge(at: LatLng, side: string | undefined): LatLng {
  const dLat = 0.00004;
  const dLng = 0.00005;
  if (side === "bottom") return { lat: at.lat - dLat, lng: at.lng };
  if (side === "left") return { lat: at.lat, lng: at.lng - dLng };
  if (side === "right") return { lat: at.lat, lng: at.lng + dLng };
  return { lat: at.lat + dLat, lng: at.lng };
}

function coordList(path: LatLng[]): string {
  return path.map(coord).join(" ");
}

function lineStyleXml(id: string, kmlColor: string, width: number): string {
  return `    <Style id="${id}">
      <LineStyle>
        <color>${kmlColor}</color>
        <width>${width}</width>
      </LineStyle>
    </Style>`;
}

function pointStyleXml(id: string, href: string, labelScale: number, iconScale: number): string {
  return `    <Style id="${id}">
      <IconStyle>
        <scale>${iconScale}</scale>
        <hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/>
        <Icon><href>${escapeXml(href)}</href></Icon>
      </IconStyle>
      <LabelStyle>
        <scale>${labelScale}</scale>
        <color>ffffffff</color>
        <colorMode>normal</colorMode>
      </LabelStyle>
    </Style>`;
}

function kmlDescription(text: string): string {
  const t = text.trim();
  return t ? `<description>${escapeXml(t)}</description>` : "";
}

function drawGlyph(
  ctx: CanvasRenderingContext2D,
  kind: PointFeature["kind"],
  x: number,
  y: number,
  size: number,
) {
  const s = size;
  if (kind === "pin") {
    ctx.beginPath();
    ctx.moveTo(x + s / 2, y + s);
    ctx.lineTo(x + s * 0.82, y + s * 0.42);
    ctx.arc(x + s / 2, y + s * 0.38, s * 0.32, 0.4, Math.PI - 0.4, true);
    ctx.closePath();
    ctx.fillStyle = "#f4f4f5";
    ctx.fill();
    return;
  }
  if (kind === "pole") {
    ctx.beginPath();
    ctx.arc(x + s / 2, y + s / 2, s / 2 - 1, 0, Math.PI * 2);
    ctx.fillStyle = "#f4f4f5";
    ctx.strokeStyle = "#e8eaee";
    ctx.lineWidth = 1.4;
    ctx.fill();
    ctx.stroke();
    return;
  }
  if (kind === "passing") {
    ctx.beginPath();
    ctx.moveTo(x + s / 2, y);
    ctx.lineTo(x + s, y + s);
    ctx.lineTo(x, y + s);
    ctx.closePath();
    ctx.fillStyle = "#facc15";
    ctx.fill();
    return;
  }
  if (kind === "mdu") {
    ctx.fillStyle = "#e8eaee";
    ctx.fillRect(x, y, s, s);
    return;
  }
  ctx.strokeStyle = "#e8eaee";
  ctx.lineWidth = 1.6;
  ctx.strokeRect(x + 0.8, y + 0.8, s - 1.6, s - 1.6);
  if (kind === "vault") {
    ctx.fillStyle = "#e8eaee";
    ctx.font = '700 9px "IBM Plex Sans", system-ui, sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("V", x + s / 2, y + s / 2 + 0.5);
    ctx.textAlign = "left";
  }
}

function listPng(notes: { n: number; text: string }[], opacity: number): string {
  const rows = notes.slice().sort((a, b) => a.n - b.n);
  if (rows.length === 0 || typeof document === "undefined") return "";
  const width = 900;
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) return "";
  measure.font = "28px sans-serif";
  const wrapped = rows.map((note) => {
    const lines: string[] = [];
    for (const para of note.text.split(/\n/)) {
      const words = para.split(/\s+/).filter(Boolean);
      let line = "";
      for (const word of words.length ? words : [""]) {
        const next = line ? `${line} ${word}` : word;
        if (line && measure.measureText(next).width > width - 90) {
          lines.push(line);
          line = word;
        } else line = next;
      }
      if (line) lines.push(line);
    }
    return { n: note.n, lines: lines.length ? lines : [" "] };
  });
  const lineH = 36;
  const height = wrapped.reduce((sum, row) => sum + row.lines.length * lineH + 18, 24);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = Math.max(height, 48);
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = `rgba(17,17,19,${opacity})`;
  ctx.fillRect(0, 0, width, canvas.height);
  let y = 18;
  for (const row of wrapped) {
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(28, y + 16, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#111113";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#111113";
    ctx.font = "bold 18px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(row.n), 28, y + 17);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#ffffff";
    ctx.font = "28px sans-serif";
    row.lines.forEach((line, index) => ctx.fillText(line, 56, y + 24 + index * lineH));
    y += row.lines.length * lineH + 18;
  }
  return canvas.toDataURL("image/png");
}

function legendPng(lines: LineFeature[], points: PointFeature[]): string {
  const { footage, removeFootage, counts, usedLines, removeLines, usedPoints, addPipe, pullOccupied, delash, lash, strand, wreck, cables, risers, anchors, peds, vaults } = plantTotals(
    lines,
    points,
  );
  const pointRows = usedPoints.length + peds.length + vaults.length + (risers > 0 ? 1 : 0) + (anchors > 0 ? 1 : 0);
  if (usedLines.length === 0 && removeLines.length === 0 && pointRows === 0 && cables.length === 0 && addPipe === 0 && pullOccupied === 0 && delash === 0 && lash === 0 && strand === 0 && wreck === 0) return "";

  const w = 260;
  const rowH = 20;
  const pad = 12;
  const titleH = 20;
  const pipeRow = addPipe > 0 ? 1 : 0;
  const occupiedRow = pullOccupied > 0 ? 1 : 0;
  const delashRow = delash > 0 ? 1 : 0;
  const lashRow = lash > 0 ? 1 : 0;
  const strandRow = strand > 0 ? 1 : 0;
  const wreckRow = wreck > 0 ? 1 : 0;
  const gap = usedLines.length > 0 && pointRows > 0 ? 8 : 0;
  const h =
    pad * 2 +
    titleH +
    (usedLines.length + removeLines.length + pipeRow + occupiedRow + delashRow + lashRow + strandRow + wreckRow + cables.length) * rowH +
    gap +
    pointRows * 18;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = Math.max(h, 48);
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  ctx.fillStyle = "#141518";
  ctx.fillRect(0, 0, w, canvas.height);
  ctx.strokeStyle = "rgba(232,234,238,0.14)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(0.75, 0.75, w - 1.5, canvas.height - 1.5);

  ctx.fillStyle = "#e8eaee";
  ctx.font = '600 12px "IBM Plex Sans", system-ui, sans-serif';
  ctx.fillText("Trazado", pad, pad + 12);

  ctx.font = '500 11px "IBM Plex Mono", ui-monospace, monospace';
  let y = pad + titleH + 14;
  for (const preset of usedLines) {
    ctx.fillStyle = preset.color;
    ctx.fillRect(pad, y - 7, 16, 4);
    ctx.fillStyle = "#e8eaee";
    ctx.textAlign = "left";
    ctx.fillText(preset.short, pad + 22, y);
    ctx.textAlign = "right";
    ctx.fillStyle = "#c8ccd4";
    ctx.fillText(formatFeet(footage[preset.id]), w - pad, y);
    ctx.textAlign = "left";
    y += rowH;
  }

  if (addPipe > 0) {
    ctx.fillStyle = "#22c55e";
    ctx.fillRect(pad, y - 7, 16, 4);
    ctx.fillStyle = "#e8eaee";
    ctx.textAlign = "left";
    ctx.fillText("addt. Pipe/width", pad + 22, y);
    ctx.textAlign = "right";
    ctx.fillStyle = "#c8ccd4";
    ctx.fillText(formatFeet(addPipe), w - pad, y);
    ctx.textAlign = "left";
    y += rowH;
  }

  if (pullOccupied > 0) {
    ctx.fillStyle = "#2563eb";
    ctx.fillRect(pad, y - 7, 16, 4);
    ctx.fillStyle = "#e8eaee";
    ctx.textAlign = "left";
    ctx.fillText("Pull occupied", pad + 22, y);
    ctx.textAlign = "right";
    ctx.fillStyle = "#c8ccd4";
    ctx.fillText(formatFeet(pullOccupied), w - pad, y);
    ctx.textAlign = "left";
    y += rowH;
  }

  if (lash > 0) {
    ctx.fillStyle = "#c026d3";
    ctx.fillRect(pad, y - 7, 16, 4);
    ctx.fillStyle = "#e8eaee";
    ctx.textAlign = "left";
    ctx.fillText("Lash", pad + 22, y);
    ctx.textAlign = "right";
    ctx.fillStyle = "#c8ccd4";
    ctx.fillText(formatFeet(lash), w - pad, y);
    ctx.textAlign = "left";
    y += rowH;
  }

  if (strand > 0) {
    ctx.fillStyle = "#cbd5e1";
    ctx.fillRect(pad, y - 7, 16, 4);
    ctx.fillStyle = "#e8eaee";
    ctx.textAlign = "left";
    ctx.fillText("Strand", pad + 22, y);
    ctx.textAlign = "right";
    ctx.fillStyle = "#c8ccd4";
    ctx.fillText(formatFeet(strand), w - pad, y);
    ctx.textAlign = "left";
    y += rowH;
  }

  if (delash > 0) {
    ctx.fillStyle = "#f472b6";
    ctx.fillRect(pad, y - 7, 16, 4);
    ctx.fillStyle = "#e8eaee";
    ctx.textAlign = "left";
    ctx.fillText("Delash", pad + 22, y);
    ctx.textAlign = "right";
    ctx.fillStyle = "#c8ccd4";
    ctx.fillText(formatFeet(delash), w - pad, y);
    ctx.textAlign = "left";
    y += rowH;
  }

  if (wreck > 0) {
    ctx.fillStyle = "#9f1239";
    ctx.fillRect(pad, y - 7, 16, 4);
    ctx.fillStyle = "#e8eaee";
    ctx.textAlign = "left";
    ctx.fillText("partial wreck out", pad + 22, y);
    ctx.textAlign = "right";
    ctx.fillStyle = "#c8ccd4";
    ctx.fillText(formatFeet(wreck), w - pad, y);
    ctx.textAlign = "left";
    y += rowH;
  }

  for (const preset of removeLines) {
    ctx.save();
    ctx.lineCap = "butt";
    ctx.strokeStyle = preset.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(pad, y - 4);
    ctx.lineTo(pad + 16, y - 4);
    ctx.stroke();
    ctx.lineWidth = 1.3;
    [[3, 4, 6.5, -4], [9, 4, 12.5, -4]].forEach(([x1, y1, x2, y2], index) => {
      ctx.strokeStyle = index === 0 ? "#dc2626" : "#ffffff";
      ctx.beginPath();
      ctx.moveTo(pad + x1, y - 4 + y1);
      ctx.lineTo(pad + x2, y - 4 + y2);
      ctx.stroke();
    });
    ctx.restore();
    ctx.fillStyle = "#e8eaee";
    ctx.textAlign = "left";
    ctx.fillText(`remove ${preset.short}`, pad + 22, y);
    ctx.textAlign = "right";
    ctx.fillStyle = "#c8ccd4";
    ctx.fillText(formatFeet(removeFootage[preset.id]), w - pad, y);
    ctx.textAlign = "left";
    y += rowH;
  }

  if (cables.length > 0) {
    ctx.font = '500 11px "IBM Plex Mono", ui-monospace, monospace';
    for (const cable of cables) {
      ctx.fillStyle = "#e8eaee";
      ctx.textAlign = "left";
      ctx.fillText(cable.label, pad, y);
      ctx.textAlign = "right";
      ctx.fillStyle = "#c8ccd4";
      ctx.fillText(formatFeet(cable.feet), w - pad, y);
      ctx.textAlign = "left";
      y += rowH;
    }
  }

  if (usedPoints.length > 0) {
    y += gap > 0 ? 4 : 0;
    ctx.font = '500 11px "IBM Plex Sans", system-ui, sans-serif';
    for (const preset of usedPoints) {
      drawGlyph(ctx, preset.id, pad, y - 11, 12);
      ctx.fillStyle = "#e8eaee";
      ctx.fillText(preset.short, pad + 18, y);
      ctx.textAlign = "right";
      ctx.fillStyle = "#c8ccd4";
      ctx.font = '500 11px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillText(String(counts[preset.id]), w - pad, y);
      ctx.textAlign = "left";
      ctx.font = '500 11px "IBM Plex Sans", system-ui, sans-serif';
      y += 18;
    }
  }

  if (peds.length > 0) {
    ctx.font = '500 11px "IBM Plex Sans", system-ui, sans-serif';
    for (const ped of peds) {
      const bw = ped.id === "dh" || ped.id === "dd" ? 18 : ped.id === "l" ? 16 : 12;
      const bh = ped.id === "dh" || ped.id === "dd" ? 10 : 12;
      const paint = pedestalColor(ped.id);
      ctx.fillStyle = paint.fill;
      ctx.strokeStyle = "#111113";
      ctx.lineWidth = 1.2;
      if (ped.id === "s") {
        ctx.beginPath();
        ctx.roundRect(pad, y - 11, bw, bh, 3);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(pad, y - 11, bw, bh);
        ctx.strokeRect(pad, y - 11, bw, bh);
      }
      ctx.fillStyle = paint.ink;
      ctx.font = '700 7px "IBM Plex Sans", system-ui, sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(ped.id === "dh" ? "DH" : ped.id === "dd" ? "DD" : ped.id.toUpperCase(), pad + bw / 2, y - 5);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#e8eaee";
      ctx.font = '500 11px "IBM Plex Sans", system-ui, sans-serif';
      ctx.fillText(ped.label, pad + 22, y);
      ctx.textAlign = "right";
      ctx.fillStyle = "#c8ccd4";
      ctx.font = '500 11px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillText(String(ped.count), w - pad, y);
      ctx.textAlign = "left";
      y += 18;
    }
  }

  if (vaults.length > 0) {
    for (const vault of vaults) {
      const paint = vaultColor(vault.id);
      ctx.fillStyle = paint.fill;
      ctx.strokeStyle = "#111113";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      if (vault.id === "s") {
        ctx.moveTo(pad + 6, y - 12);
        ctx.lineTo(pad + 12, y - 6);
        ctx.lineTo(pad + 6, y);
        ctx.lineTo(pad, y - 6);
      } else {
        ctx.rect(pad, y - 12, 12, 12);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = paint.ink;
      ctx.font = '700 7px "IBM Plex Sans", system-ui, sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("V", pad + 6, y - 6);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#e8eaee";
      ctx.font = '500 11px "IBM Plex Sans", system-ui, sans-serif';
      ctx.fillText(vault.label, pad + 22, y);
      ctx.textAlign = "right";
      ctx.fillStyle = "#c8ccd4";
      ctx.font = '500 11px "IBM Plex Mono", ui-monospace, monospace';
      ctx.fillText(String(vault.count), w - pad, y);
      ctx.textAlign = "left";
      y += 18;
    }
  }

  if (risers > 0) {
    ctx.beginPath();
    ctx.arc(pad + 6, y - 4, 5.5, 0, Math.PI * 2);
    ctx.strokeStyle = "#111113";
    ctx.fillStyle = "#ea580c";
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.fillStyle = "#fff7ed";
    ctx.font = '700 8px "IBM Plex Sans", system-ui, sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("R", pad + 6, y - 3.5);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "right";
    ctx.font = '500 11px "IBM Plex Mono", ui-monospace, monospace';
    ctx.fillStyle = "#c8ccd4";
    ctx.fillText(String(risers), w - pad, y);
    ctx.textAlign = "left";
    y += 18;
  }

  if (anchors > 0) {
    ctx.beginPath();
    ctx.moveTo(pad + 6, y - 10);
    ctx.lineTo(pad + 11, y - 1);
    ctx.lineTo(pad + 1, y - 1);
    ctx.closePath();
    ctx.fillStyle = "#ea580c";
    ctx.fill();
    ctx.textAlign = "right";
    ctx.font = '500 11px "IBM Plex Mono", ui-monospace, monospace';
    ctx.fillStyle = "#c8ccd4";
    ctx.fillText(String(anchors), w - pad, y);
    ctx.textAlign = "left";
  }

  return canvas.toDataURL("image/png");
}

function outlinedLabelDataUrl(text: string, color: string, plate: boolean, fontSize = 64, outline = "#ffffff"): { url: string; w: number; h: number; fontSize: number } {
  const drawn = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const source = drawn.length > 0 ? drawn : [text];
  if (typeof document === "undefined") return { url: "", w: 32, h: 32, fontSize };
  const font = `700 ${fontSize}px "IBM Plex Mono", ui-monospace, monospace`;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return { url: "", w: 32, h: 32, fontSize };
  ctx.font = font;
  // Google Earth shrinks icons once a side passes about 128px, which makes long
  // "remove" and aerial labels look smaller than the other footage labels.
  const maxWidth = 96;
  const lines: string[] = [];
  for (const raw of source) {
    const words = raw.split(/\s+/).filter(Boolean);
    let current = "";
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (current && ctx.measureText(next).width > maxWidth) {
        lines.push(current);
        current = word;
      } else current = next;
    }
    if (current) lines.push(current);
  }
  const shown = lines.length > 0 ? lines : source;
  const width = Math.max(...shown.map((line) => ctx.measureText(line).width), 8);
  const stroke = Math.max(2, Math.round(fontSize * 0.2));
  const padX = stroke + Math.max(2, Math.round(fontSize * 0.1));
  const padY = stroke + Math.max(2, Math.round(fontSize * 0.06));
  const lineH = fontSize + stroke;
  const w = Math.ceil(width + padX * 2);
  const h = Math.ceil(shown.length * lineH + padY * 2);
  canvas.width = w;
  canvas.height = h;
  ctx.clearRect(0, 0, w, h);
  if (plate) {
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.beginPath();
    ctx.roundRect(2, 2, w - 4, h - 4, Math.max(2, Math.round(fontSize * 0.2)));
    ctx.fill();
  }
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.lineWidth = stroke;
  ctx.strokeStyle = outline;
  ctx.fillStyle = color;
  shown.forEach((line, index) => {
    const y = padY + lineH * index + lineH / 2;
    ctx.strokeText(line, w / 2, y);
    ctx.fillText(line, w / 2, y);
  });
  return { url: canvas.toDataURL("image/png"), w, h, fontSize };
}

const CABLE_XL_PX = 28;

export function lineLabelBitmap(text: string, color: string, plate: boolean): { url: string; w: number; h: number } {
  const art = outlinedLabelDataUrl(text, color, plate, CABLE_XL_PX, "#ffffff");
  return { url: art.url, w: art.w, h: art.h };
}

function cableLabelSize(size: string | undefined): LabelSize {
  if (size === "xs" || size === "sm" || size === "lg" || size === "xl") return size;
  return "md";
}

function kmlPaint(hex: string, opacity: number): string {
  const { r, g, b } = hexToRgb(/^#[0-9a-f]{6}$/i.test(hex) ? hex : "#d4d4d8");
  const alpha = Math.round(Math.min(1, Math.max(0, opacity)) * 255);
  const part = (n: number) => n.toString(16).padStart(2, "0");
  return `${part(alpha)}${part(b)}${part(g)}${part(r)}`;
}

function mix(a: LatLng, b: LatLng, t: number): LatLng {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

function dashCoords(a: LatLng, b: LatLng): string[] {
  const out: string[] = [];
  const parts = 16;
  for (let i = 0; i < parts; i += 2) {
    const p0 = mix(a, b, i / parts);
    const p1 = mix(a, b, Math.min(1, (i + 1) / parts));
    out.push(`${p0.lng},${p0.lat},0 ${p1.lng},${p1.lat},0`);
  }
  return out;
}

function boxEdge(box: { south: number; north: number; west: number; east: number }, toward: LatLng): LatLng {
  const south = Math.min(box.south, box.north);
  const north = Math.max(box.south, box.north);
  const west = Math.min(box.west, box.east);
  const east = Math.max(box.west, box.east);
  const lat = Math.min(north, Math.max(south, toward.lat));
  const lng = Math.min(east, Math.max(west, toward.lng));
  const inside = toward.lat > south && toward.lat < north && toward.lng > west && toward.lng < east;
  if (!inside) return { lat, lng };
  const choices = [
    { d: Math.abs(toward.lat - south), at: { lat: south, lng: toward.lng } },
    { d: Math.abs(north - toward.lat), at: { lat: north, lng: toward.lng } },
    { d: Math.abs(toward.lng - west), at: { lat: toward.lat, lng: west } },
    { d: Math.abs(east - toward.lng), at: { lat: toward.lat, lng: east } },
  ].sort((left, right) => left.d - right.d);
  return choices[0]?.at ?? { lat, lng };
}

export async function buildKmz(project: PlantProject, labelPlate = false): Promise<Blob> {
  const zip = new JSZip();
  const files = zip.folder("files");
  if (!files) throw new Error("Unable to create KMZ archive");

  for (const p of ALL_POINT_PRESETS) {
    files.file(`${p.id}.png`, dataUrlToBytes(pointIconDataUrl(p.id)).bytes);
  }
  const poleFiles = new Map<string, string>();
  const pedFiles = new Map<string, string>();
  const vaultFiles = new Map<string, string>();
  const plateFiles = new Map<string, { href: string; w: number; h: number }>();
  function textMark(text: string, at: LatLng, hex: string, size: LabelSize = "md", boxed = false, outline = "#ffffff"): string {
    const px = size === "xl" ? CABLE_XL_PX : size === "lg" ? 16 : size === "sm" || size === "xs" ? 11 : 12;
    const plate = boxed || labelPlate;
    const key = `${px}|${plate ? "p" : "n"}|${hex}|${outline}|${text}`;
    let drawn = plateFiles.get(key);
    if (!drawn) {
      const art = outlinedLabelDataUrl(text, hex, plate, px, outline);
      const name = `label-${plateFiles.size + 1}.png`;
      files!.file(name, dataUrlToBytes(art.url).bytes);
      drawn = { href: `files/${name}`, w: art.w, h: art.h };
      plateFiles.set(key, drawn);
    }
    return `      <Placemark>
        <name></name>
        <ExtendedData><Data name="spanLabel"><value>1</value></Data></ExtendedData>
        <Style>
          <IconStyle>
            <scale>1</scale>
            <hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/>
            <Icon><href>${escapeXml(drawn.href)}</href><gx:w>${drawn.w}</gx:w><gx:h>${drawn.h}</gx:h></Icon>
          </IconStyle>
          <LabelStyle><scale>0</scale></LabelStyle>
        </Style>
        <Point>
          <altitudeMode>clampToGround</altitudeMode>
          <coordinates>${coord(at)}</coordinates>
        </Point>
      </Placemark>`;
  }
  function leaderMark(from: LatLng, to: LatLng, hex: string): string {
    return `      <Placemark>
        <name>__callout</name>
        <Style><LineStyle><color>${hexToKmlColor(hex)}</color><width>1</width></LineStyle></Style>
        <LineString><altitudeMode>clampToGround</altitudeMode>
          <tessellate>1</tessellate><coordinates>${coord(from)} ${coord(to)}</coordinates></LineString>
      </Placemark>`;
  }
  const dotFiles = new Map<string, string>();
  function dotHref(color: string): string {
    const hit = dotFiles.get(color);
    if (hit) return hit;
    if (typeof document === "undefined") return "";
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    ctx.clearRect(0, 0, 64, 64);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(32, 32, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    const name = `dot-${dotFiles.size + 1}.png`;
    files!.file(name, dataUrlToBytes(canvas.toDataURL("image/png")).bytes);
    const href = `files/${name}`;
    dotFiles.set(color, href);
    return href;
  }
  for (const point of project.points) {
    if (point.kind === "pole" && (point.riser || point.anchors.length > 0)) {
      const name = poleFileName(point.riser, point.anchors);
      if (!poleFiles.has(name)) {
        files.file(name, dataUrlToBytes(poleVariantDataUrl(point.riser, point.anchors)).bytes);
        poleFiles.set(name, `files/${name}`);
      }
    }
    if (point.kind === "pedestal" && isPedType(point.pedType)) {
      const dir = pedestalDir(point.pedRotate);
      const name = `ped-${point.pedType}-${dir}.png`;
      if (!pedFiles.has(name)) {
        files.file(name, dataUrlToBytes(pedestalIconDataUrl(point.pedType, dir)).bytes);
        pedFiles.set(name, `files/${name}`);
      }
    }
    if (point.kind === "vault" && isVaultType(point.vaultType)) {
      const name = `vault-${point.vaultType}.png`;
      if (!vaultFiles.has(name)) {
        files.file(name, dataUrlToBytes(vaultIconDataUrl(point.vaultType)).bytes);
        vaultFiles.set(name, `files/${name}`);
      }
    }
  }

  const removeIcons = new Map<string, string>();
  for (const point of project.points) {
    if (!point.remove) continue;
    const art =
      point.kind === "pole" && (point.riser || point.anchors.length > 0)
        ? poleVariantDataUrl(point.riser, point.anchors)
        : point.kind === "pedestal" && isPedType(point.pedType)
          ? pedestalIconDataUrl(point.pedType, pedestalDir(point.pedRotate))
          : point.kind === "vault" && isVaultType(point.vaultType)
            ? vaultIconDataUrl(point.vaultType)
            : pointIconDataUrl(point.kind);
    const stamped = await stampRemoveSlashes(art);
    const name = `remove-${point.id.replace(/[^a-z0-9_-]/gi, "") || removeIcons.size}.png`;
    files.file(name, dataUrlToBytes(stamped).bytes);
    removeIcons.set(point.id, `files/${name}`);
  }

  const legendUrl = legendPng(project.lines, project.points);
  if (legendUrl) files.file("legend.png", dataUrlToBytes(legendUrl).bytes);
  const frameShots: { frame: FrameFeature; href: string }[] = [];

  const overlayHrefs: Record<string, string> = {};
  project.overlays.forEach((ov, i) => {
    const { bytes, ext } = dataUrlToBytes(ov.dataUrl);
    const name = `overlay-${i + 1}.${ext || "png"}`;
    files.file(name, bytes);
    overlayHrefs[ov.id] = `files/${name}`;
  });

  const { footage, removeFootage, counts, usedLines, removeLines, usedPoints, addPipe, pullOccupied, delash, lash, strand, wreck, cables, risers, anchors, peds, vaults } = plantTotals(
    project.lines,
    project.points,
  );

  const descRows = [
    ...usedLines.map(
      (t) =>
        `<tr><td><font color="${t.color}">${escapeXml(t.fullLabel)}</font></td><td align="right">${escapeXml(formatFeet(footage[t.id]))}</td></tr>`,
    ),
    ...removeLines.map(
      (t) =>
        `<tr><td><font color="${t.color}">remove ${escapeXml(t.fullLabel)}</font></td><td align="right">${escapeXml(formatFeet(removeFootage[t.id]))}</td></tr>`,
    ),
    ...(addPipe > 0
      ? [
          `<tr><td><font color="#22c55e">addt. Pipe/width</font></td><td align="right">${escapeXml(formatFeet(addPipe))}</td></tr>`,
        ]
      : []),
    ...(pullOccupied > 0
      ? [
          `<tr><td><font color="#2563eb">Pull occupied</font></td><td align="right">${escapeXml(formatFeet(pullOccupied))}</td></tr>`,
        ]
      : []),
    ...(lash > 0
      ? [
          `<tr><td><font color="#c026d3">Lash</font></td><td align="right">${escapeXml(formatFeet(lash))}</td></tr>`,
        ]
      : []),
    ...(strand > 0
      ? [
          `<tr><td><font color="#cbd5e1">Strand</font></td><td align="right">${escapeXml(formatFeet(strand))}</td></tr>`,
        ]
      : []),
    ...(delash > 0
      ? [
          `<tr><td><font color="#f472b6">Delash</font></td><td align="right">${escapeXml(formatFeet(delash))}</td></tr>`,
        ]
      : []),
    ...(wreck > 0
      ? [
          `<tr><td><font color="#9f1239">partial wreck out</font></td><td align="right">${escapeXml(formatFeet(wreck))}</td></tr>`,
        ]
      : []),
    ...cables.map(
      (cable) =>
        `<tr><td>${escapeXml(cable.label)}</td><td align="right">${escapeXml(formatFeet(cable.feet))}</td></tr>`,
    ),
    ...usedPoints.map(
      (t) =>
        `<tr><td>${escapeXml(t.fullLabel)}</td><td align="right">${counts[t.id]}</td></tr>`,
    ),
    ...(risers > 0
      ? [`<tr><td>Risers</td><td align="right">${risers}</td></tr>`]
      : []),
    ...(anchors > 0
      ? [`<tr><td>Anchors</td><td align="right">${anchors}</td></tr>`]
      : []),
    ...peds.map(
      (ped) => `<tr><td>${escapeXml(ped.label)}</td><td align="right">${ped.count}</td></tr>`,
    ),
    ...vaults.map(
      (vault) => `<tr><td>${escapeXml(vault.label)}</td><td align="right">${vault.count}</td></tr>`,
    ),
  ].join("");

  const styleBlock = [
    ...ALL_LINE_PRESETS.map((p) => lineStyleXml(`line-${p.id}`, p.kmlColor, lineWidth(p.id))),
    ...ALL_POINT_PRESETS.flatMap((p) => [
      pointStyleXml(`pt-${p.id}`, `files/${p.id}.png`, 0.45, pointIconScale(p.id)),
      pointStyleXml(`pt-${p.id}-quiet`, `files/${p.id}.png`, 0, pointIconScale(p.id)),
    ]),
    `    <Style id="remove-shade">
      <LineStyle><color>592626dc</color><width>5</width></LineStyle>
    </Style>
    <Style id="remove-slash">
      <LineStyle><color>ff2626dc</color><width>3</width></LineStyle>
    </Style>
    <Style id="remove-slash-white">
      <LineStyle><color>ffffffff</color><width>2.6</width></LineStyle>
    </Style>
    <Style id="remove-slash-edge">
      <LineStyle><color>ff111111</color><width>4.4</width></LineStyle>
    </Style>`,
    `    <Style id="poly">
      <LineStyle>
        <color>ffd8d4d4</color>
        <width>2</width>
      </LineStyle>
      <PolyStyle>
        <color>4d64748b</color>
      </PolyStyle>
    </Style>`,
  ].join("\n");

  function slashXml(marks: [LatLng, LatLng][]): string {
    return marks
      .map(([a, b], index) => {
        const coords = `${coord(a)} ${coord(b)}`;
        const red = index % 2 === 0;
        const edge = red
          ? ""
          : `      <Placemark>
        <name>__remove</name>
        <styleUrl>#remove-slash-edge</styleUrl>
        <LineString><altitudeMode>clampToGround</altitudeMode>
          <tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString>
      </Placemark>
`;
        return `${edge}      <Placemark>
        <name>__remove</name>
        <styleUrl>#${red ? "remove-slash" : "remove-slash-white"}</styleUrl>
        <LineString><altitudeMode>clampToGround</altitudeMode>
          <tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString>
      </Placemark>`;
      })
      .join("\n");
  }

  function removalXml(path: LatLng[]): string {
    return `      <Placemark>
        <name>__remove</name>
        <styleUrl>#remove-shade</styleUrl>
        <LineString><altitudeMode>clampToGround</altitudeMode>
          <tessellate>1</tessellate><coordinates>${coordList(path)}</coordinates></LineString>
      </Placemark>
${slashXml(slashMarks(path))}`;
  }

  function lineFolder(kind: LineKind, title: string): string {
    const lines = project.lines.filter((l) => l.kind === kind);
    if (lines.length === 0) return "";
    const preset = ALL_LINE_PRESETS.find((p) => p.id === kind);
    const labelColor = preset?.kmlColor ?? "ffffffff";
    const offsetColor = hexToKmlColor(tintHex(preset?.color ?? "#d4d4d8", 0.42));
    const gear = project.points
      .filter((p) => p.kind === "pedestal" || p.kind === "vault" || p.kind === "mdu" || p.kind === "pole")
      .map((p) => p.position);
    const inner = lines
      .map((line) => {
        const measured = pathFootage(line.path);
        const shown = reportedFeet(line);
        const spans = footageSpans(line.path, gear, line.splits ?? [], (line.dots ?? []).map((dot) => dot.at));
        const labels = line.kind === "road" ? "" : spans
          .map((span, index) => {
            const shownFeet = spanShownFeet(span.feet, measured, shown);
            const parts = spanParts(shownFeet, line);
            const paint = linePaint(line);
            const hex = paint;
            const size = cableLabelSize(line.labelSize);
            const footage = line.hideFootage ? "" : parts.footage;
            const stacked = span.showCable && parts.detail ? (footage ? `${footage}\n${parts.detail}` : parts.detail) : footage;
            if (!stacked) return "";
            const cableNote = line.parallel ? [slotCableTag(line, 1), slotCableTag(line, 2)].filter(Boolean).join("/") : "";
            const boxed = line.callout ? (cableNote ? `${stacked}\n${cableNote}` : stacked) : stacked;
            if (line.callout) {
              const at = calloutAt(span.labelAt, spanCalloutDir(line.calloutDirs, index), calloutFeet(spanCalloutStep(line.calloutSteps, index)));
              return `${leaderMark(span.labelAt, at, tintHex(hex, 0.45))}\n${textMark(boxed, at, hex, size, true)}`;
            }
            const at = line.parallel ? offsetBeside(span.labelAt, span.from, span.to, 4, -1) : span.labelAt;
            return textMark(stacked, at, hex, size);
          })
          .filter(Boolean)
          .join("\n");
        const cableLabels =
          line.kind === "road" || !line.parallel || line.callout
            ? ""
            : objectSpans(line.path, gear, [...(line.splits ?? []), ...(line.dots ?? []).map((dot) => dot.at)])
                .map((span) => {
                  const paint = linePaint(line);
                  const hex = paint;
                  const twinHex = tintHex(hex, 0.42);
                  const size = cableLabelSize(line.labelSize);
                  const frame1 = pathFrame(span.slice, 0.42);
                  const frame2 = pathFrame(span.slice, 0.58);
                  const tag1 = slotCableTag(line, 1);
                  const tag2 = slotCableTag(line, 2);
                  return [
                    tag1 ? textMark(tag1, offsetBeside(frame1.at, frame1.from, frame1.to, 4, -1), hex, size) : "",
                    tag2 ? textMark(tag2, offsetBeside(frame2.at, frame2.from, frame2.to, 12, 1), twinHex, size) : "",
                  ]
                    .filter(Boolean)
                    .join("\n");
                })
                .filter(Boolean)
                .join("\n");
        const canJoin = line.joinEnds && joinsAtEnds(line.kind);
        const targets = project.points
          .filter((p) => p.kind === "pedestal" || p.kind === "vault" || p.kind === "mdu" || p.kind === "pole")
          .map((p) => p.position);
        const snapped = (line.snaps ?? []).filter((snap) => targets.some((gear) => haversineFeet(snap, gear) <= 0.5));
        const twin = line.parallel && canJoin ? parallelPath(line.path, 12, joinMask(line.path, snapped, canJoin, [], 0.5)) : [];
        const twinMark =
          twin.length >= 2
            ? `      <Placemark>
        <name>__parallel</name>
        <Style>
          <LineStyle>
            <color>${offsetColor}</color>
            <width>${lineWeightOf(line)}</width>
          </LineStyle>
        </Style>
        <LineString>
          <altitudeMode>clampToGround</altitudeMode>
          <tessellate>1</tessellate>
          <coordinates>${coordList(twin)}</coordinates>
        </LineString>
      </Placemark>`
            : "";
        const meta = [
          line.parallel ? `<Data name="parallel"><value>1</value></Data>` : "",
          line.joinEnds ? `<Data name="joinEnds"><value>1</value></Data>` : "",
          line.intoSlot
            ? `<Data name="intoSlot"><value>${line.intoSlot}</value></Data>`
            : "",
          line.cables.length > 0
            ? `<Data name="cables"><value>${escapeXml(line.cables.join(","))}</value></Data>`
            : "",
          line.slot1 ? `<Data name="slot1"><value>${escapeXml(line.slot1)}</value></Data>` : "",
          line.slot2 ? `<Data name="slot2"><value>${escapeXml(line.slot2)}</value></Data>` : "",
          line.fiberCount ? `<Data name="fiberCount"><value>${escapeXml(line.fiberCount)}</value></Data>` : "",
          line.fiberCount2 ? `<Data name="fiberCount2"><value>${escapeXml(line.fiberCount2)}</value></Data>` : "",
          (line.fiberCounts ?? []).some((count) => count.trim())
            ? `<Data name="fiberCounts"><value>${escapeXml(line.fiberCounts.map((count) => count.replace(/\D/g, "")).join(","))}</value></Data>`
            : "",
          line.emptyPipe ? `<Data name="emptyPipe"><value>1</value></Data>` : "",
          line.remove ? `<Data name="remove"><value>1</value></Data>` : "",
          line.fiberUnit === "km" ? `<Data name="fiberUnit"><value>km</value></Data>` : "",
          line.overrideFootage ? `<Data name="overrideFootage"><value>1</value></Data>` : "",
          line.footageText ? `<Data name="footageText"><value>${escapeXml(line.footageText)}</value></Data>` : "",
          line.hideLegend ? `<Data name="hideLegend"><value>1</value></Data>` : "",
          line.hideFootage ? `<Data name="hideFootage"><value>1</value></Data>` : "",
          line.labelSize && line.labelSize !== "md" ? `<Data name="labelSize"><value>${line.labelSize}</value></Data>` : "",
          (line.pipeRoles ?? []).length > 0 ? `<Data name="pipeRoles"><value>${escapeXml(line.pipeRoles.join(","))}</value></Data>` : "",
          line.occupied ? `<Data name="occupied"><value>1</value></Data>` : "",
          line.hideSpan ? `<Data name="hideSpan"><value>1</value></Data>` : "",
          line.hideCable ? `<Data name="hideCable"><value>1</value></Data>` : "",
          line.aerialMode === "work" ? `<Data name="aerialMode"><value>work</value></Data>` : "",
          line.strandOnly ? `<Data name="strandOnly"><value>1</value></Data>` : "",
          (line.workOps ?? []).length > 0 ? `<Data name="workOps"><value>${line.workOps.join(",")}</value></Data>` : "",
          (line.cableWork ?? []).length > 0 ? `<Data name="cableWork"><value>${line.cableWork.map((work) => `${work.op || "-"}:${work.existing ? 1 : 0}:${work.wreck ? 1 : 0}`).join(",")}</value></Data>` : "",
          line.wreckOut ? `<Data name="wreckOut"><value>1</value></Data>` : "",
          line.callout ? `<Data name="callout"><value>1</value></Data>` : "",
          (line.calloutDirs ?? []).length > 0 ? `<Data name="calloutDirs"><value>${line.calloutDirs.join(",")}</value></Data>` : "",
          (line.calloutSteps ?? []).some((step) => step > 0) ? `<Data name="calloutSteps"><value>${line.calloutSteps.join(",")}</value></Data>` : "",
          `<Data name="kind"><value>${line.kind}</value></Data>`,
          `<Data name="id"><value>${escapeXml(line.id)}</value></Data>`,
          (line.splits ?? []).length > 0 ? `<Data name="splits"><value>${(line.splits ?? []).map((at) => `${at.lat},${at.lng}`).join(";")}</value></Data>` : "",
          (line.dots ?? []).length > 0 ? `<Data name="dots"><value>${(line.dots ?? []).map((dot) => `${dot.at.lat},${dot.at.lng},${escapeXml(dot.peer)},${dot.show ? 1 : 0}`).join(";")}</value></Data>` : "",
          (line.snaps ?? []).length > 0 ? `<Data name="snaps"><value>${(line.snaps ?? []).map((snap) => `${snap.lat},${snap.lng}`).join(";")}</value></Data>` : "",
          line.name.trim() ? `<Data name="lineName"><value>${escapeXml(line.name.trim())}</value></Data>` : "",
          line.kind === "line" && line.stroke ? `<Data name="stroke"><value>${escapeXml(line.stroke)}</value></Data>` : "",
          line.kind === "line" && line.weight ? `<Data name="weight"><value>${line.weight}</value></Data>` : "",
          line.existing ? `<Data name="existing"><value>1</value></Data>` : "",
          line.mark ? `<Data name="mark"><value>${line.mark}</value></Data>` : "",
        ]
          .filter(Boolean)
          .join("");
        const removal = line.remove ? removalXml(line.path) : "";
        const roadName = line.kind === "road" ? line.name.trim() : "";
        const visibleLine = line.remove && roadName ? `remove ${roadName}` : roadName;
        const lineStyle = line.kind === "line" || line.kind === "road" || (line.kind === "aerial-new" && line.aerialMode === "work")
          ? `<Style>
          <LineStyle><color>${line.kind === "line" ? hexToKmlColor(linePaint(line)) : line.kind === "road" ? labelColor : "ff7727db"}</color><width>${line.kind === "line" ? lineWeightOf(line) : lineWidth(line.kind)}</width></LineStyle>
          <LabelStyle><scale>0</scale></LabelStyle>
        </Style>`
          : `<styleUrl>#line-${line.kind}</styleUrl>`;
        const roadLabel = visibleLine
          ? (() => {
              const mid = pathMidpoint(line.path);
              if (!mid) return "";
              const size = cableLabelSize(line.labelSize);
              if (line.callout) {
                const at = calloutAt(mid, spanCalloutDir(line.calloutDirs, 0), calloutFeet(spanCalloutStep(line.calloutSteps, 0)));
                return `${leaderMark(mid, at, tintHex("#e4e4e7", 0.35))}\n${textMark(visibleLine, at, "#e4e4e7", size, true)}`;
              }
              return textMark(visibleLine, mid, "#e4e4e7", size);
            })()
          : "";
        const joinDots = (line.dots ?? [])
          .filter((dot) => dot.show && (!dot.peer || line.id < dot.peer))
          .map((dot) => {
            const own = preset?.color ?? "#d4d4d8";
            const peer = project.lines.find((item) => item.id === dot.peer);
            const peerHex = ALL_LINE_PRESETS.find((item) => item.id === peer?.kind)?.color ?? own;
            const color = peer && peerHex !== own ? "#b6b6be" : own;
            const href = dotHref(color);
            if (!href) return "";
            return `      <Placemark>
        <name></name>
        <ExtendedData><Data name="joinDot"><value>1</value></Data></ExtendedData>
        <Style>
          <IconStyle>
            <scale>0.72</scale>
            <hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/>
            <Icon><href>${escapeXml(href)}</href></Icon>
          </IconStyle>
          <LabelStyle><scale>0</scale></LabelStyle>
        </Style>
        <Point>
          <altitudeMode>clampToGround</altitudeMode>
          <coordinates>${coord(dot.at)}</coordinates>
        </Point>
      </Placemark>`;
          })
          .filter(Boolean)
          .join("\n");
        return `      <Placemark>
        <name></name>
        ${kmlDescription(line.notes)}
        ${meta ? `<ExtendedData>${meta}</ExtendedData>` : ""}
        ${lineStyle}
        <LineString>
          <altitudeMode>clampToGround</altitudeMode>
          <tessellate>1</tessellate>
          <coordinates>${coordList(line.path)}</coordinates>
        </LineString>
      </Placemark>
${twinMark}
${removal}
${roadLabel}
${labels}
${cableLabels}
${joinDots}`;
      })
      .join("\n");
    return `    <Folder>
      <name>${escapeXml(title)}</name>
      <open>0</open>
${inner}
    </Folder>`;
  }

  function pointFolder(kind: PointFeature["kind"], title: string, fallback: string): string {
    const pts = project.points.filter((p) => p.kind === kind);
    if (pts.length === 0) return "";
    const inner = pts
      .map((p) => {
        const named = p.name.trim() || (p.kind === "vault" && p.vaultType === "s" ? "flower pot" : "");
        const data = [
          `<Data name="kind"><value>${p.kind}</value></Data>`,
          p.kind === "pole" && p.riser ? `<Data name="riser"><value>1</value></Data>` : "",
          p.kind === "pole" && p.anchors.length > 0
            ? `<Data name="anchors"><value>${p.anchors.map((dir) => ((dir % 8) + 8) % 8).join(" ")}</value></Data>`
            : "",
          p.labelSide && p.labelSide !== "top"
            ? `<Data name="labelSide"><value>${p.labelSide}</value></Data>`
            : "",
          p.remove ? `<Data name="remove"><value>1</value></Data>` : "",
          p.hideLegend ? `<Data name="hideLegend"><value>1</value></Data>` : "",
          p.kind === "pedestal" && p.pedType ? `<Data name="pedType"><value>${p.pedType}</value></Data>` : "",
          p.kind === "pedestal" && p.pedRotate ? `<Data name="pedRotate"><value>${pedestalDir(p.pedRotate)}</value></Data>` : "",
          p.kind === "vault" && p.vaultType ? `<Data name="vaultType"><value>${p.vaultType}</value></Data>` : "",
          `<Data name="size"><value>${p.size === "big" ? "big" : p.size === "std" ? "std" : "med"}</value></Data>`,
          p.labelSize !== "lg" ? `<Data name="labelSize"><value>${p.labelSize === "sm" || p.labelSize === "md" || p.labelSize === "xl" ? p.labelSize : "lg"}</value></Data>` : "",
        ]
          .filter(Boolean)
          .join("");
        const pedDir = pedestalDir(p.pedRotate);
        const variant =
          p.kind === "pole" && (p.riser || p.anchors.length > 0)
            ? poleFiles.get(poleFileName(p.riser, p.anchors))
            : p.kind === "pedestal" && isPedType(p.pedType)
              ? pedFiles.get(`ped-${p.pedType}-${pedDir}.png`)
              : p.kind === "vault" && isVaultType(p.vaultType)
                ? vaultFiles.get(`vault-${p.vaultType}.png`)
                : "";
        const step = p.size === "big" ? "big" : p.size === "std" ? "std" : "med";
        const baseScale =
          p.kind === "pedestal"
            ? step === "big"
              ? 0.8
              : step === "med"
                ? 0.57
                : 0.34
            : p.kind === "pole"
              ? (variant ? 1.45 : 0.8) * (step === "big" ? 1.6 : 1)
              : p.kind === "vault"
                ? step === "big"
                  ? 1.28
                  : step === "std"
                    ? 0.62
                    : 0.8
                : pointIconScale(p.kind);
        const iconScale = baseScale.toFixed(2);
        const iconHref = (p.remove && removeIcons.get(p.id)) || variant || `files/${p.kind}.png`;
        const showLabel = Boolean(named) || p.remove;
        const visibleName = p.remove ? (named ? `remove ${named}` : "remove") : named || fallback;
        const nameSize = p.labelSize === "xl" ? "xl" : p.labelSize === "lg" ? "lg" : p.labelSize === "sm" || p.labelSize === "xs" ? "sm" : "md";
        const style = `<Style>
          <IconStyle>
            <scale>${iconScale}</scale>
            <hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/>
            <Icon><href>${escapeXml(iconHref)}</href></Icon>
          </IconStyle>
          <LabelStyle><scale>0</scale></LabelStyle>
        </Style>`;
        return `      <Placemark>
        <name></name>
        ${kmlDescription(p.description)}
        <ExtendedData>${data}</ExtendedData>
        ${style}
        <Point><altitudeMode>clampToGround</altitudeMode><coordinates>${coord(p.position)}</coordinates></Point>
      </Placemark>
${showLabel ? textMark(visibleName, nudge(p.position, p.labelSide), "#f8fafc", nameSize === "xl" ? "xl" : nameSize === "lg" ? "lg" : nameSize === "sm" ? "sm" : "md", false, "#111113") : ""}`;
      })
      .join("\n");
    return `    <Folder>
      <name>${escapeXml(title)}</name>
${inner}
    </Folder>`;
  }

  const polygonFolder =
    project.polygons.length === 0
      ? ""
      : `    <Folder>
      <name>Polygons</name>
${project.polygons
  .map((poly) => {
    const ring = [...poly.path, poly.path[0]].filter(Boolean) as LatLng[];
    const lat = poly.path.reduce((sum, point) => sum + point.lat, 0) / poly.path.length;
    const lng = poly.path.reduce((sum, point) => sum + point.lng, 0) / poly.path.length;
    const label = poly.name.trim()
      ? textMark(poly.name.trim(), { lat, lng }, "#f8fafc", poly.labelSize === "xl" ? "xl" : poly.labelSize === "lg" ? "lg" : poly.labelSize === "md" ? "md" : "sm", false, "#111113")
      : "";
    return `      <Placemark>
        <name>${escapeXml(poly.name)}</name>
        ${kmlDescription(poly.description)}
        <ExtendedData>
          <Data name="stroke"><value>${escapeXml(poly.stroke || "#a1a1aa")}</value></Data>
          <Data name="fill"><value>${escapeXml(poly.fill || "#64748b")}</value></Data>
          <Data name="strokeOpacity"><value>${poly.strokeOpacity ?? 1}</value></Data>
          <Data name="fillOpacity"><value>${poly.fillOpacity ?? 0.25}</value></Data>
          ${poly.labelSize && poly.labelSize !== "sm" ? `<Data name="labelSize"><value>${poly.labelSize}</value></Data>` : ""}
        </ExtendedData>
        <Style>
          <LineStyle><color>${kmlPaint(poly.stroke || "#a1a1aa", poly.strokeOpacity ?? 1)}</color><width>2</width></LineStyle>
          <PolyStyle><color>${kmlPaint(poly.fill || "#64748b", poly.fillOpacity ?? 0.25)}</color></PolyStyle>
          <LabelStyle><scale>0</scale></LabelStyle>
        </Style>
        <Polygon>
          <altitudeMode>clampToGround</altitudeMode>
          <tessellate>1</tessellate>
          <outerBoundaryIs>
            <LinearRing>
              <coordinates>${coordList(ring)}</coordinates>
            </LinearRing>
          </outerBoundaryIs>
        </Polygon>
      </Placemark>
${label}`;
  })
  .join("\n")}
    </Folder>`;

  const overlayFolder =
    project.overlays.length === 0
      ? ""
      : `    <Folder>
      <name>Image overlays</name>
${project.overlays
  .map(
    (ov) => `      <GroundOverlay>
        <name>${escapeXml(ov.name)}</name>
        ${kmlDescription(ov.description)}
        <color>${Math.round(ov.opacity * 255)
          .toString(16)
          .padStart(2, "0")}ffffff</color>
        <Icon><href>${escapeXml(overlayHrefs[ov.id] ?? "")}</href></Icon>
        <altitude>0</altitude>
      <altitudeMode>clampToGround</altitudeMode>
      <LatLonBox>
          <north>${ov.north}</north>
          <south>${ov.south}</south>
          <east>${ov.east}</east>
          <west>${ov.west}</west>
          <rotation>${-((ov.rotation || 0) % 360)}</rotation>
        </LatLonBox>
      </GroundOverlay>`,
  )
  .join("\n")}
    </Folder>`;

  const legendOverlay = legendUrl
    ? `    <ScreenOverlay>
      <name>Legend</name>
      <Icon><href>files/legend.png</href></Icon>
      <overlayXY x="0" y="0" xunits="fraction" yunits="fraction"/>
      <screenXY x="0.02" y="0.04" xunits="fraction" yunits="fraction"/>
      <size x="0" y="0" xunits="pixels" yunits="pixels"/>
    </ScreenOverlay>`
    : "";

  const frameGuide = false
    ? `    <Folder>
      <name>Frames</name>
${(project.frames ?? [])
  .flatMap((frame) => {
    const color = kmlPaint(frame.linkColor || "#f5d90a", 1);
    const source = { south: frame.south, north: frame.north, west: frame.west, east: frame.east };
    const view = { south: frame.viewSouth, north: frame.viewNorth, west: frame.viewWest, east: frame.viewEast };
    const south = Math.min(source.south, source.north);
    const north = Math.max(source.south, source.north);
    const west = Math.min(source.west, source.east);
    const east = Math.max(source.west, source.east);
    const corners: LatLng[] = [
      { lat: south, lng: west },
      { lat: south, lng: east },
      { lat: north, lng: east },
      { lat: north, lng: west },
    ];
    const srcMid = { lat: (south + north) / 2, lng: (west + east) / 2 };
    const viewMid = {
      lat: (Math.min(view.south, view.north) + Math.max(view.south, view.north)) / 2,
      lng: (Math.min(view.west, view.east) + Math.max(view.west, view.east)) / 2,
    };
    const pieces = [0, 1, 2, 3].flatMap((index) => dashCoords(corners[index]!, corners[(index + 1) % 4]!));
    pieces.push(...dashCoords(boxEdge(source, viewMid), boxEdge(view, srcMid)));
    return pieces.map(
      (coordinates) => `      <Placemark>
        <name>Frame</name>
        <Style><LineStyle><color>${color}</color><width>2</width></LineStyle></Style>
        <LineString><altitudeMode>clampToGround</altitudeMode>
          <tessellate>1</tessellate><coordinates>${coordinates}</coordinates></LineString>
      </Placemark>`,
    );
  })
  .join("\n")}
${frameShots
  .map(
    ({ frame, href }) => `      <GroundOverlay>
        <name>Frame window</name>
        <color>ffffffff</color>
        <Icon><href>${href}</href></Icon>
        <altitude>0</altitude>
        <altitudeMode>clampToGround</altitudeMode>
        <LatLonBox>
          <north>${Math.max(frame.viewNorth, frame.viewSouth)}</north>
          <south>${Math.min(frame.viewNorth, frame.viewSouth)}</south>
          <east>${Math.max(frame.viewEast, frame.viewWest)}</east>
          <west>${Math.min(frame.viewEast, frame.viewWest)}</west>
        </LatLonBox>
      </GroundOverlay>`,
  )
  .join("\n")}
    </Folder>`
    : "";

  const bypassFolder = (() => {
    const targets = project.points
      .filter((p) => p.kind === "pedestal" || p.kind === "vault" || p.kind === "mdu" || p.kind === "pole")
      .map((p) => p.position);
    const routed = project.lines
      .filter((line) => line.parallel && !(line.joinEnds && joinsAtEnds(line.kind)) && line.path.length >= 2)
      .map((line) => ({
        id: line.id,
        kind: line.kind,
        path: line.path,
        offsetFt: 12,
        drawn: parallelPath(line.path, 12, line.path.map(() => false)),
      }));
    const ties = squareLine2(routed, targets);
    if (ties.length === 0) return "";
    return `    <Folder>
      <name>Bypass</name>
${ties
  .map((tie) => {
    const color = hexToKmlColor(tintHex(ALL_LINE_PRESETS.find((p) => p.id === tie.kind)?.color ?? "#d4d4d8", 0.42));
    return `      <Placemark>
        <name>__bypass</name>
        <Style>
          <LineStyle><color>${color}</color><width>${lineWidth(tie.kind)}</width></LineStyle>
        </Style>
        <LineString>
          <altitudeMode>clampToGround</altitudeMode>
          <tessellate>1</tessellate>
          <coordinates>${coordList(tie.path)}</coordinates>
        </LineString>
      </Placemark>`;
  })
  .join("\n")}
    </Folder>`;
  })();

  const plainDesc = descRows
    .replace(/<\/tr>/g, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
  <Document>
    <name>${escapeXml(project.projectName)}</name>
    <ExtendedData><Data name="trazadoExtras"><value>${escapeXml(JSON.stringify({ notes: project.notes ?? [], board: project.board ?? null, frames: project.frames ?? [] }))}</value></Data></ExtendedData>
    <description>${escapeXml(plainDesc)}</description>
${styleBlock}
${ALL_LINE_PRESETS.map((p) => lineFolder(p.id, p.fullLabel)).join("\n")}
${bypassFolder}
${ALL_POINT_PRESETS.map((p) => pointFolder(p.id, p.fullLabel, p.label)).join("\n")}
${polygonFolder}
${overlayFolder}
${legendOverlay}
  </Document>
</kml>
`;

  zip.file("doc.kml", kml);
  return await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.google-earth.kmz",
    compression: "DEFLATE",
  });
}

function textContent(el: Element | null): string {
  return el?.textContent?.trim() ?? "";
}

function dataValue(pm: Element, key: string): string {
  for (const data of Array.from(pm.getElementsByTagName("Data"))) {
    if (data.getAttribute("name") === key) return textContent(data.getElementsByTagName("value")[0] ?? null);
  }
  return "";
}

function importedAnchors(kind: string, pm: Element): number[] {
  if (kind !== "pole") return [];
  const listed = dataValue(pm, "anchors")
    .split(/[\s,]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => Number(part))
    .filter((n) => Number.isFinite(n));
  const raw =
    listed.length > 0 ? listed : dataValue(pm, "anchor") === "1" ? [Number(dataValue(pm, "anchorDir")) || 0] : [];
  const dirs: number[] = [];
  for (const value of raw) {
    const dir = ((Math.round(value) % 8) + 8) % 8;
    if (!dirs.includes(dir)) dirs.push(dir);
  }
  return dirs.slice(0, 3);
}

function poleFileName(riser: boolean, anchors: number[]): string {
  const dirs: number[] = [];
  for (const raw of anchors) {
    const dir = ((Math.round(raw) % 8) + 8) % 8;
    if (!dirs.includes(dir)) dirs.push(dir);
    if (dirs.length === 3) break;
  }
  dirs.sort((a, b) => a - b);
  return `pole-${riser ? "r" : "p"}-${dirs.join("-") || "x"}.png`;
}

function parseCoordinates(raw: string): LatLng[] {
  return raw
    .trim()
    .split(/\s+/)
    .map((pair) => pair.split(","))
    .filter((p) => p.length >= 2)
    .map((p) => ({
      lng: Number(p[0]),
      lat: Number(p[1]),
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

function isFootageName(name: string): boolean {
  const lines = name
    .replace(/^remove\s+/i, "")
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return false;
  const footage = /^\d[\d,]*\s*(?:'+|ft|feet)$/i;
  const km = /^\d+(?:\.\d+)?\s*km$/i;
  const tag = /^(?:\.625|\.875|rg6|rg11|rock|flex|fiber|empty|\d+\s*ct)$/i;
  const [head, ...rest] = lines;
  if (!head) return false;
  if (rest.length === 0) {
    if (footage.test(head) || km.test(head) || tag.test(head)) return true;
    const split = head.split(/\s+/);
    const lead = split[0] ?? "";
    const tail = split.slice(1).join(" ");
    return (footage.test(lead) || km.test(lead)) && tail.split("/").every((part) => tag.test(part.trim()));
  }
  return (footage.test(head) || km.test(head)) && rest.every((line) => line.split("/").every((part) => tag.test(part.trim())));
}

function iconStyleOf(pm: Element): { scale: number | null; href: string } {
  const iconStyle = pm.getElementsByTagName("IconStyle")[0];
  if (!iconStyle) return { scale: null, href: "" };
  const raw = textContent(iconStyle.getElementsByTagName("scale")[0] ?? null);
  const scale = raw === "" ? null : Number(raw);
  return {
    scale: Number.isFinite(scale) ? scale : null,
    href: textContent(iconStyle.getElementsByTagName("href")[0] ?? null),
  };
}

function isEquipmentMark(styleUrl: string, icon: string, storedKind: string): boolean {
  if (isPointKind(storedKind)) return true;
  const mark = `${styleUrl} ${icon}`.toLowerCase();
  return (
    mark.includes("pt-") ||
    mark.includes("passing") ||
    mark.includes("pedestal") ||
    mark.includes("vault") ||
    mark.includes("mdu") ||
    mark.includes("pole") ||
    mark.includes("pin")
  );
}

function inferPointKind(icon: string, name: string): PointFeature["kind"] {
  const n = name.toLowerCase();
  const i = icon.toLowerCase();
  if (i.includes("pin")) return "pin";
  if (i.includes("passing") || n.startsWith("pass")) return "passing";
  if (i.includes("pole") || n.startsWith("pole")) return "pole";
  if (i.includes("vault") || n.includes("vault") || /^v-\d+/i.test(name)) return "vault";
  if (i.includes("mdu") || n.includes("mdu")) return "mdu";
  if (i.includes("pedestal") || n.includes("ped")) return "pedestal";
  return "pedestal";
}

export async function parsePlantFile(file: File): Promise<
  Pick<PlantProject, "lines" | "points" | "polygons" | "overlays" | "projectName" | "notes" | "board" | "frames">
> {
  let kmlText = "";
  const zipFiles = new Map<string, Blob>();

  if (/\.kmz$/i.test(file.name) || file.type.includes("zip")) {
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const kmlEntry =
      zip.file(/\.kml$/i)[0] ?? zip.file("doc.kml") ?? zip.file("Doc.kml");
    if (!kmlEntry) throw new Error("No KML found inside KMZ");
    kmlText = await kmlEntry.async("string");
    const jobs: Promise<void>[] = [];
    zip.forEach((path, entry) => {
      if (entry.dir) return;
      jobs.push(
        (async () => {
          const blob = await entry.async("blob");
          zipFiles.set(path.replace(/\\/g, "/"), blob);
          const base = path.split("/").pop();
          if (base) zipFiles.set(base, blob);
        })(),
      );
    });
    await Promise.all(jobs);
  } else {
    kmlText = await file.text();
  }

  const doc = new DOMParser().parseFromString(kmlText, "text/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("Could not parse KML");
  }

  const styleColor = new Map<string, string>();
  const styleIcon = new Map<string, string>();
  const styleScale = new Map<string, number>();

  for (const style of Array.from(doc.getElementsByTagName("Style"))) {
    const id = style.getAttribute("id");
    if (!id) continue;
    const color = textContent(style.getElementsByTagName("color")[0]);
    const href = textContent(style.getElementsByTagName("href")[0]);
    const scale = Number(textContent(style.getElementsByTagName("scale")[0]));
    if (color) styleColor.set(`#${id}`, color);
    if (href) styleIcon.set(`#${id}`, href);
    if (Number.isFinite(scale)) styleScale.set(`#${id}`, scale);
  }

  const lines: LineFeature[] = [];
  const points: PointFeature[] = [];
  const polygons: PolygonFeature[] = [];
  const overlays: OverlayFeature[] = [];

  for (const pm of Array.from(doc.getElementsByTagName("Placemark"))) {
    const name = textContent(pm.getElementsByTagName("name")[0]);
    if (name === "__riser" || name === "__anchor" || name === "__remove" || dataValue(pm, "roadLabel") === "1" || dataValue(pm, "spanLabel") === "1" || dataValue(pm, "polyLabel") === "1" || dataValue(pm, "joinDot") === "1") continue;
    const notes = textContent(pm.getElementsByTagName("description")[0]);
    const styleUrl = textContent(pm.getElementsByTagName("styleUrl")[0]);
    const lineEl = pm.getElementsByTagName("LineString")[0];
    const pointEl = pm.getElementsByTagName("Point")[0];
    const polyEl = pm.getElementsByTagName("Polygon")[0];

    if (lineEl) {
      if (name === "__parallel" || name === "__bypass" || name === "__callout") continue;
      const path = parseCoordinates(
        textContent(lineEl.getElementsByTagName("coordinates")[0]),
      );
      if (path.length < 2) continue;
      const color = styleColor.get(styleUrl) ?? "";
      const storedKind = dataValue(pm, "kind");
      const kind = isLineKind(storedKind) ? storedKind : color ? nearestLineKind(kmlColorToHex(color)) : "line";
      const cableValue = dataValue(pm, "cables") || dataValue(pm, "cable");
      const cables = cableValue.split(/[,\s]+/).filter(isCableType);
      const slot = (name: string): SlotChoice => {
        const value = dataValue(pm, name);
        if (isCableType(value) || value === "empty") return value;
        return "";
      };
      const storedSize = dataValue(pm, "labelSize");
      const storedId = dataValue(pm, "id");
      const splits = dataValue(pm, "splits").split(";").flatMap((part) => {
        const [lat, lng] = part.split(",").map(Number);
        return Number.isFinite(lat) && Number.isFinite(lng) ? [{ lat, lng }] : [];
      });
      const dots = dataValue(pm, "dots").split(";").flatMap((part) => {
        const bits = part.split(",");
        const lat = Number(bits[0]);
        const lng = Number(bits[1]);
        const peer = bits[2] ?? "";
        if (!Number.isFinite(lat) || !Number.isFinite(lng) || !peer) return [];
        return [{ at: { lat, lng }, peer, show: bits[3] !== "0" }];
      });
      const snaps = dataValue(pm, "snaps").split(";").flatMap((part) => {
        const [lat, lng] = part.split(",").map(Number);
        return Number.isFinite(lat) && Number.isFinite(lng) ? [{ lat, lng }] : [];
      });
      lines.push({
        id: storedId || crypto.randomUUID(),
        kind: isLineKind(kind) ? kind : "line",
        path,
        notes,
        parallel: dataValue(pm, "parallel") === "1",
        joinEnds: dataValue(pm, "joinEnds") === "1",
        intoSlot: dataValue(pm, "intoSlot") === "3" ? 3 : dataValue(pm, "intoSlot") === "2" ? 2 : dataValue(pm, "intoSlot") === "1" ? 1 : 0,
        cables,
        slot1: slot("slot1"),
        slot2: slot("slot2"),
        fiberCount: dataValue(pm, "fiberCount"),
        fiberCount2: dataValue(pm, "fiberCount2"),
        fiberCounts: dataValue(pm, "fiberCounts")
          ? dataValue(pm, "fiberCounts").split(",").map((count) => count.replace(/\D/g, ""))
          : [],
        emptyPipe: dataValue(pm, "emptyPipe") === "1",
        remove: dataValue(pm, "remove") === "1",
        fiberUnit: dataValue(pm, "fiberUnit") === "km" ? "km" : "ft",
        overrideFootage: dataValue(pm, "overrideFootage") === "1",
        footageText: dataValue(pm, "footageText"),
        hideLegend: dataValue(pm, "hideLegend") === "1",
        hideFootage: dataValue(pm, "hideFootage") === "1",
        labelSize: storedSize === "xs" || storedSize === "sm" || storedSize === "lg" || storedSize === "xl" ? storedSize : "md",
        name: dataValue(pm, "lineName") || (kind === "road" ? name : ""),
        splits,
        dots,
        snaps,
        pipeRoles: dataValue(pm, "pipeRoles").split(",").filter((role): role is "ug" | "width" | "share" => role === "ug" || role === "width" || role === "share"),
        occupied: dataValue(pm, "occupied") === "1",
        hideSpan: dataValue(pm, "hideSpan") === "1",
        hideCable: dataValue(pm, "hideCable") === "1",
        aerialMode: dataValue(pm, "aerialMode") === "work" || kind === "aerial-overlash" ? "work" : "new",
        strandOnly: dataValue(pm, "strandOnly") === "1",
        workOps: dataValue(pm, "workOps").split(",").filter((op): op is "de" | "re" | "ol" => op === "de" || op === "re" || op === "ol"),
        cableWork: dataValue(pm, "cableWork").split(",").filter(Boolean).map((part) => {
          const [op, existing, wreck] = part.split(":");
          return {
            op: op === "de" || op === "re" || op === "ol" ? op : "",
            existing: existing !== "0",
            wreck: wreck === "1",
          };
        }),
        wreckOut: dataValue(pm, "wreckOut") === "1",
        callout: dataValue(pm, "callout") === "1",
        calloutDirs: (dataValue(pm, "calloutDirs") || dataValue(pm, "calloutDir")).split(",").map((value) => Number(value)).filter((value) => Number.isFinite(value)),
        calloutSteps: dataValue(pm, "calloutSteps").split(",").map((value) => Number(value)).filter((value) => Number.isFinite(value)),
        stroke: /^#[0-9a-f]{6}$/i.test(dataValue(pm, "stroke")) ? dataValue(pm, "stroke") : "",
        weight: [1.5, 3, 6].includes(Number(dataValue(pm, "weight"))) ? Number(dataValue(pm, "weight")) : 0,
        existing: dataValue(pm, "existing") === "1",
        mark: dataValue(pm, "mark") === "ae" ? "ae" : dataValue(pm, "mark") === "ug" ? "ug" : "",
      });
      continue;
    }

    if (polyEl) {
      const path = parseCoordinates(
        textContent(polyEl.getElementsByTagName("coordinates")[0]),
      );
      if (path.length >= 3) {
        const closed =
          path.length > 1 &&
          path[0] &&
          path[path.length - 1] &&
          path[0].lat === path[path.length - 1]!.lat &&
          path[0].lng === path[path.length - 1]!.lng
            ? path.slice(0, -1)
            : path;
        const stroke = dataValue(pm, "stroke");
        const fill = dataValue(pm, "fill");
        const strokeOpacity = Number(dataValue(pm, "strokeOpacity"));
        const fillOpacity = Number(dataValue(pm, "fillOpacity"));
        polygons.push({
          id: crypto.randomUUID(),
          path: closed,
          name: name || "Polygon",
          description: notes,
          stroke: /^#[0-9a-f]{6}$/i.test(stroke) ? stroke : "#a1a1aa",
          fill: /^#[0-9a-f]{6}$/i.test(fill) ? fill : "#64748b",
          strokeOpacity: Number.isFinite(strokeOpacity) ? strokeOpacity : 1,
          fillOpacity: Number.isFinite(fillOpacity) ? fillOpacity : 0.25,
          labelSize: dataValue(pm, "labelSize") === "xl" ? "xl" : dataValue(pm, "labelSize") === "lg" ? "lg" : dataValue(pm, "labelSize") === "md" ? "md" : "sm",
        });
      }
      continue;
    }

    if (pointEl) {
      const inline = iconStyleOf(pm);
      const icon = (inline.href || styleIcon.get(styleUrl) || "").toLowerCase();
      const storedKind = dataValue(pm, "kind");
      const equipment = isEquipmentMark(styleUrl, icon, storedKind);
      const scale = inline.scale ?? styleScale.get(styleUrl) ?? 1;
      if (!equipment && (scale === 0 || icon.includes("label-") || icon.includes("glow-") || isFootageName(name))) continue;
      const path = parseCoordinates(
        textContent(pointEl.getElementsByTagName("coordinates")[0]),
      );
      const pos = path[0];
      if (!pos) continue;
      const kind = isPointKind(storedKind) ? storedKind : inferPointKind(icon, name);
      if (!isPointKind(kind)) continue;
      const marked = dataValue(pm, "remove") === "1";
      const quiet = styleUrl.endsWith("-quiet");
      const fallback = pointPreset(kind).label;
      const rawName = quiet ? "" : name === fallback ? defaultImportedName(kind, name) : name;
      const storedPed = dataValue(pm, "pedType");
      const storedVault = dataValue(pm, "vaultType");
      points.push({
        id: crypto.randomUUID(),
        kind,
        position: pos,
        name: marked ? rawName.replace(/^remove\s+/i, "") : rawName,
        description: notes,
        labelSide:
          dataValue(pm, "labelSide") === "bottom" ||
          dataValue(pm, "labelSide") === "left" ||
          dataValue(pm, "labelSide") === "right"
            ? (dataValue(pm, "labelSide") as "bottom" | "left" | "right")
            : "top",
        riser: kind === "pole" && dataValue(pm, "riser") === "1",
        anchors: importedAnchors(kind, pm),
        remove: marked,
        hideLegend: dataValue(pm, "hideLegend") === "1",
        pedType: kind === "pedestal" && isPedType(storedPed) ? storedPed : "",
        pedRotate: kind === "pedestal" ? pedestalDir(dataValue(pm, "pedRotate")) : 0,
        vaultType: kind === "vault" && isVaultType(storedVault) ? storedVault : "",
        size: (() => {
          const rawSize = dataValue(pm, "size");
          if (rawSize === "big" || rawSize === "xl") return "big" as const;
          if (rawSize === "med") return "med" as const;
          if (rawSize === "std") return "std" as const;
          return kind === "vault" ? "med" as const : "std" as const;
        })(),
        labelSize: (dataValue(pm, "labelSize") === "xl" ? "xl" : dataValue(pm, "labelSize") === "sm" || dataValue(pm, "labelSize") === "xs" ? "sm" : dataValue(pm, "labelSize") === "md" ? "md" : "lg") as "xs" | "sm" | "md" | "lg" | "xl",
      });
    }
  }

  for (const ov of Array.from(doc.getElementsByTagName("GroundOverlay"))) {
    const name = textContent(ov.getElementsByTagName("name")[0]) || "Overlay";
    if (name === "__spanlabel") continue;
    const notes = textContent(ov.getElementsByTagName("description")[0]);
    const href = textContent(ov.getElementsByTagName("href")[0]);
    const box = ov.getElementsByTagName("LatLonBox")[0];
    if (!box) continue;
    const north = Number(textContent(box.getElementsByTagName("north")[0]));
    const south = Number(textContent(box.getElementsByTagName("south")[0]));
    const east = Number(textContent(box.getElementsByTagName("east")[0]));
    const west = Number(textContent(box.getElementsByTagName("west")[0]));
    if (![north, south, east, west].every(Number.isFinite)) continue;
    const blob =
      zipFiles.get(href) ??
      zipFiles.get(href.replace(/^\.\//, "")) ??
      zipFiles.get(href.split("/").pop() ?? "");
    const dataUrl = blob
      ? await blobToDataUrl(blob)
      : href.startsWith("data:")
        ? href
        : "";
    if (!dataUrl) continue;
    const color = textContent(ov.getElementsByTagName("color")[0]);
    const alpha = /^[0-9a-f]{8}$/i.test(color) ? parseInt(color.slice(0, 2), 16) / 255 : 1;
    const rotationRaw = Number(textContent(box.getElementsByTagName("rotation")[0] ?? null));
    const rotation = Number.isFinite(rotationRaw) ? ((Math.round(-rotationRaw) % 360) + 360) % 360 : 0;
    overlays.push({
      id: crypto.randomUUID(),
      name,
      description: notes,
      dataUrl,
      north,
      south,
      east,
      west,
      opacity: Number.isFinite(alpha) ? alpha : 1,
      rotation,
    });
  }

  const projectName =
    textContent(doc.getElementsByTagName("name")[0]) || file.name.replace(/\.[^.]+$/, "");

  let extras: { notes?: PlantProject["notes"]; board?: PlantProject["board"]; frames?: PlantProject["frames"] } = {};
  const extraNode = Array.from(doc.getElementsByTagName("Data")).find((el) => el.getAttribute("name") === "trazadoExtras");
  if (extraNode) {
    try {
      extras = JSON.parse(textContent(extraNode.getElementsByTagName("value")[0]));
    } catch {
      extras = {};
    }
  }

  return { projectName, lines, points, polygons, overlays, notes: extras.notes ?? [], board: extras.board ?? null, frames: extras.frames ?? [] };
}

function defaultImportedName(kind: PointFeature["kind"], name: string): string {
  if (kind === "pedestal" && name.toLowerCase() === "ped") return "ped";
  if (kind === "mdu" && name === "MDU") return "MDU";
  if (kind === "pole" && name.toLowerCase() === "pole") return "pole";
  return name;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
