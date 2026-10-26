import JSZip from "jszip";
import type {
  LatLng,
  LineFeature,
  LineKind,
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
  lineWidth,
  pointIconScale,
  isLineKind,
  isPointKind,
  joinsAtEnds,
  hexToKmlColor,
  kmlColorToHex,
  tintHex,
  nearestLineKind,
  plantTotals,
  pointPreset,
  isPedType,
  isVaultType,
  objectScale,
  pedestalColor,
  pedestalDir,
  vaultColor,
} from "./presets";
import { footageSpans, formatFeet, joinMask, parallelPath, offsetBeside, pathFootage, pathMidpoint, reportedFeet, spanShownFeet, squareLine2, pointSlashMarks, slashMarks, slotCableTag, spanLabel } from "./geo";
import { blobToDataUrl, dataUrlToBytes, pedestalIconDataUrl, pointIconDataUrl, poleVariantDataUrl, vaultIconDataUrl } from "./icons";

function coord(ll: LatLng): string {
  return `${ll.lng},${ll.lat},0`;
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

function legendPng(lines: LineFeature[], points: PointFeature[]): string {
  const { footage, removeFootage, counts, usedLines, removeLines, usedPoints, addPipe, cables, risers, anchors, peds, vaults } = plantTotals(
    lines,
    points,
  );
  const pointRows = usedPoints.length + peds.length + vaults.length + (risers > 0 ? 1 : 0) + (anchors > 0 ? 1 : 0);
  if (usedLines.length === 0 && removeLines.length === 0 && pointRows === 0) return "";

  const w = 260;
  const rowH = 20;
  const pad = 12;
  const titleH = 20;
  const pipeRow = addPipe > 0 ? 1 : 0;
  const gap = usedLines.length > 0 && pointRows > 0 ? 8 : 0;
  const h =
    pad * 2 +
    titleH +
    (usedLines.length + removeLines.length + pipeRow + cables.length) * rowH +
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

  for (const preset of removeLines) {
    ctx.fillStyle = preset.color;
    ctx.fillRect(pad, y - 7, 16, 4);
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

function labelPlateDataUrl(text: string, color: string): string {
  const drawn = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const lines = drawn.length > 0 ? drawn : [text];
  if (typeof document === "undefined") return "";
  const fontSize = 28;
  const font = `600 ${fontSize}px "IBM Plex Mono", ui-monospace, monospace`;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.font = font;
  const width = Math.max(...lines.map((line) => ctx.measureText(line).width), 8);
  const padX = 22;
  const padY = 14;
  const lineH = Math.round(fontSize * 1.25);
  const w = Math.ceil(width + padX * 2);
  const h = Math.ceil(lines.length * lineH + padY * 2);
  canvas.width = w;
  canvas.height = h;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.beginPath();
  ctx.roundRect(2, 2, w - 4, h - 4, 10);
  ctx.fill();
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.lineWidth = 10;
  ctx.strokeStyle = "#ffffff";
  ctx.fillStyle = color;
  lines.forEach((line, index) => {
    const y = padY + lineH * index + lineH / 2;
    ctx.strokeText(line, w / 2, y);
    ctx.fillText(line, w / 2, y);
  });
  return canvas.toDataURL("image/png");
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
  const plateFiles = new Map<string, string>();
  function plateHref(text: string, color: string): string {
    const key = `${color}|${text}`;
    const hit = plateFiles.get(key);
    if (hit) return hit;
    const name = `label-${plateFiles.size + 1}.png`;
    files!.file(name, dataUrlToBytes(labelPlateDataUrl(text, color)).bytes);
    const href = `files/${name}`;
    plateFiles.set(key, href);
    return href;
  }
  function textMark(text: string, at: LatLng, kmlColor: string, hex: string): string {
    if (labelPlate) {
      return `      <Placemark>
        <name></name>
        <ExtendedData><Data name="spanLabel"><value>1</value></Data></ExtendedData>
        <Style>
          <IconStyle>
            <scale>0.5</scale>
            <hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/>
            <Icon><href>${escapeXml(plateHref(text, hex))}</href></Icon>
          </IconStyle>
          <LabelStyle><scale>0</scale></LabelStyle>
        </Style>
        <Point>
          <altitudeMode>clampToGround</altitudeMode>
          <coordinates>${coord(at)}</coordinates>
        </Point>
      </Placemark>`;
    }
    return `      <Placemark>
        <name>${escapeXml(text)}</name>
        <Style>
          <IconStyle><scale>0</scale></IconStyle>
          <LabelStyle>
            <color>${kmlColor}</color>
            <colorMode>normal</colorMode>
            <scale>0.6</scale>
          </LabelStyle>
        </Style>
        <Point>
          <altitudeMode>clampToGround</altitudeMode>
          <coordinates>${coord(at)}</coordinates>
        </Point>
      </Placemark>`;
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

  const legendUrl = legendPng(project.lines, project.points);
  if (legendUrl) files.file("legend.png", dataUrlToBytes(legendUrl).bytes);

  const overlayHrefs: Record<string, string> = {};
  project.overlays.forEach((ov, i) => {
    const { bytes, ext } = dataUrlToBytes(ov.dataUrl);
    const name = `overlay-${i + 1}.${ext || "png"}`;
    files.file(name, bytes);
    overlayHrefs[ov.id] = `files/${name}`;
  });

  const { footage, removeFootage, counts, usedLines, removeLines, usedPoints, addPipe, cables, risers, anchors, peds, vaults } = plantTotals(
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
      pointStyleXml(`pt-${p.id}`, `files/${p.id}.png`, 0.6, pointIconScale(p.id)),
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
        <LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString>
      </Placemark>
`;
        return `${edge}      <Placemark>
        <name>__remove</name>
        <styleUrl>#${red ? "remove-slash" : "remove-slash-white"}</styleUrl>
        <LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString>
      </Placemark>`;
      })
      .join("\n");
  }

  function removalXml(path: LatLng[]): string {
    return `      <Placemark>
        <name>__remove</name>
        <styleUrl>#remove-shade</styleUrl>
        <LineString><tessellate>1</tessellate><coordinates>${coordList(path)}</coordinates></LineString>
      </Placemark>
${slashXml(slashMarks(path))}`;
  }

  function lineFolder(kind: LineKind, title: string): string {
    const lines = project.lines.filter((l) => l.kind === kind);
    if (lines.length === 0) return "";
    const preset = ALL_LINE_PRESETS.find((p) => p.id === kind);
    const labelColor = preset?.kmlColor ?? "ffffffff";
    const centerColor = labelColor;
    const offsetColor = hexToKmlColor(tintHex(preset?.color ?? "#d4d4d8", 0.42));
    const gear = project.points
      .filter((p) => p.kind === "pedestal" || p.kind === "vault" || p.kind === "mdu" || p.kind === "pole")
      .map((p) => p.position);
    const inner = lines
      .map((line) => {
        const measured = pathFootage(line.path);
        const shown = reportedFeet(line);
        const spans = footageSpans(line.path, gear);
        const labels = line.kind === "road" ? "" : spans
          .map((span) => {
            const footage = textMark(spanLabel(spanShownFeet(span.feet, measured, shown), line), span.labelAt, labelColor, preset?.color ?? "#d4d4d8");
            if (!line.parallel) return footage;
            const cableMark = (name: string, at: LatLng, kmlColor: string, hex: string) =>
              name ? textMark(name, at, kmlColor, hex) : "";
            const footageAt = offsetBeside(span.labelAt, span.from, span.to, 4, -1);
            return [
              footage.replace(coord(span.labelAt), coord(footageAt)),
              cableMark(slotCableTag(line, 1), offsetBeside(span.cableAt, span.from, span.to, 4, -1), centerColor, preset?.color ?? "#d4d4d8"),
              cableMark(slotCableTag(line, 2), offsetBeside(span.cableAt2, span.from, span.to, 12, 1), offsetColor, tintHex(preset?.color ?? "#d4d4d8", 0.42)),
            ]
              .filter(Boolean)
              .join("\n");
          })
          .join("\n");
        const canJoin = line.joinEnds && joinsAtEnds(line.kind);
        const targets = project.points
          .filter((p) => p.kind === "pedestal" || p.kind === "vault" || p.kind === "mdu" || p.kind === "pole")
          .map((p) => p.position);
        const twin = line.parallel && canJoin ? parallelPath(line.path, 12, joinMask(line.path, targets, canJoin, [])) : [];
        const twinMark =
          twin.length >= 2
            ? `      <Placemark>
        <name>__parallel</name>
        <Style>
          <LineStyle>
            <color>${offsetColor}</color>
            <width>${lineWidth(line.kind)}</width>
          </LineStyle>
        </Style>
        <LineString>
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
          line.emptyPipe ? `<Data name="emptyPipe"><value>1</value></Data>` : "",
          line.remove ? `<Data name="remove"><value>1</value></Data>` : "",
          line.fiberUnit === "km" ? `<Data name="fiberUnit"><value>km</value></Data>` : "",
          line.overrideFootage ? `<Data name="overrideFootage"><value>1</value></Data>` : "",
          line.footageText ? `<Data name="footageText"><value>${escapeXml(line.footageText)}</value></Data>` : "",
          line.hideLegend ? `<Data name="hideLegend"><value>1</value></Data>` : "",
          line.hideFootage ? `<Data name="hideFootage"><value>1</value></Data>` : "",
          `<Data name="kind"><value>${line.kind}</value></Data>`,
          line.name.trim() ? `<Data name="lineName"><value>${escapeXml(line.name.trim())}</value></Data>` : "",
        ]
          .filter(Boolean)
          .join("");
        const removal = line.remove ? removalXml(line.path) : "";
        const roadName = line.kind === "road" ? line.name.trim() : "";
        const visibleLine = line.remove && roadName ? `remove ${roadName}` : roadName;
        const lineStyle = line.kind === "road"
          ? `<Style>
          <LineStyle><color>${labelColor}</color><width>${lineWidth(line.kind)}</width></LineStyle>
          <LabelStyle><scale>0</scale></LabelStyle>
        </Style>`
          : `<styleUrl>#line-${line.kind}</styleUrl>`;
        const roadLabel = visibleLine
          ? (() => {
              const mid = pathMidpoint(line.path);
              if (!mid) return "";
              if (labelPlate) return textMark(visibleLine, mid, "ffe4e4e7", "#e4e4e7");
              return `      <Placemark>
        <name>${escapeXml(visibleLine)}</name>
        <ExtendedData><Data name="roadLabel"><value>1</value></Data></ExtendedData>
        <Style>
          <IconStyle><scale>0</scale></IconStyle>
          <LabelStyle><color>ffe4e4e7</color><colorMode>normal</colorMode><scale>0.6</scale></LabelStyle>
        </Style>
        <Point><altitudeMode>clampToGround</altitudeMode><coordinates>${coord(mid)}</coordinates></Point>
      </Placemark>`;
            })()
          : "";
        return `      <Placemark>
        <name></name>
        ${kmlDescription(line.notes)}
        ${meta ? `<ExtendedData>${meta}</ExtendedData>` : ""}
        ${lineStyle}
        <LineString>
          <tessellate>1</tessellate>
          <coordinates>${coordList(line.path)}</coordinates>
        </LineString>
      </Placemark>
${twinMark}
${removal}
${roadLabel}
${labels}`;
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
          p.size === "sm" ? `<Data name="size"><value>sm</value></Data>` : "",
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
        const sized = (p.kind === "pedestal" && isPedType(p.pedType)) || (p.kind === "vault" && isVaultType(p.vaultType));
        const small = p.size === "sm" ? objectScale("sm") : 1;
        const iconScale = ((sized ? 0.8 : variant ? 1.45 : pointIconScale(p.kind)) * small).toFixed(2);
        const iconHref = variant || `files/${p.kind}.png`;
        const showLabel = Boolean(named) || p.remove;
        const visibleName = p.remove ? (named ? `remove ${named}` : "remove") : named || fallback;
        const style = variant || small !== 1
          ? `<Style>
          <IconStyle>
            <scale>${iconScale}</scale>
            <hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/>
            <Icon><href>${escapeXml(iconHref)}</href></Icon>
          </IconStyle>
          <LabelStyle><color>ffffffff</color><colorMode>normal</colorMode><scale>${showLabel ? 0.6 : 0}</scale></LabelStyle>
        </Style>`
          : `<styleUrl>#pt-${p.kind}${showLabel ? "" : "-quiet"}</styleUrl>`;
        const removal = p.remove ? slashXml(pointSlashMarks(p.position)) : "";
        return `      <Placemark>
        <name>${escapeXml(visibleName)}</name>
        ${kmlDescription(p.description)}
        <ExtendedData>${data}</ExtendedData>
        ${style}
        <Point><coordinates>${coord(p.position)}</coordinates></Point>
      </Placemark>
${removal}`;
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
    return `      <Placemark>
        <name>${escapeXml(poly.name)}</name>
        ${kmlDescription(poly.description)}
        <styleUrl>#poly</styleUrl>
        <Polygon>
          <tessellate>1</tessellate>
          <outerBoundaryIs>
            <LinearRing>
              <coordinates>${coordList(ring)}</coordinates>
            </LinearRing>
          </outerBoundaryIs>
        </Polygon>
      </Placemark>`;
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
        <LatLonBox>
          <north>${ov.north}</north>
          <south>${ov.south}</south>
          <east>${ov.east}</east>
          <west>${ov.west}</west>
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
          <tessellate>1</tessellate>
          <coordinates>${coordList(tie.path)}</coordinates>
        </LineString>
      </Placemark>`;
  })
  .join("\n")}
    </Folder>`;
  })();

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
  <Document>
    <name>${escapeXml(project.projectName)}</name>
    <description><![CDATA[
      <h3>Trazado</h3>
      <table cellpadding="4">${descRows}</table>
    ]]></description>
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
  return /^\d[\d,]*\s*('+|ft|feet)?$/i.test(name.trim());
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
  Pick<PlantProject, "lines" | "points" | "polygons" | "overlays" | "projectName">
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
    if (name === "__riser" || name === "__anchor" || name === "__remove" || dataValue(pm, "roadLabel") === "1" || dataValue(pm, "spanLabel") === "1") continue;
    const notes = textContent(pm.getElementsByTagName("description")[0]);
    const styleUrl = textContent(pm.getElementsByTagName("styleUrl")[0]);
    const lineEl = pm.getElementsByTagName("LineString")[0];
    const pointEl = pm.getElementsByTagName("Point")[0];
    const polyEl = pm.getElementsByTagName("Polygon")[0];

    if (lineEl) {
      if (name === "__parallel" || name === "__bypass") continue;
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
      lines.push({
        id: crypto.randomUUID(),
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
        emptyPipe: dataValue(pm, "emptyPipe") === "1",
        remove: dataValue(pm, "remove") === "1",
        fiberUnit: dataValue(pm, "fiberUnit") === "km" ? "km" : "ft",
        overrideFootage: dataValue(pm, "overrideFootage") === "1",
        footageText: dataValue(pm, "footageText"),
        hideLegend: dataValue(pm, "hideLegend") === "1",
        hideFootage: dataValue(pm, "hideFootage") === "1",
        name: dataValue(pm, "lineName") || (kind === "road" ? name : ""),
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
        polygons.push({
          id: crypto.randomUUID(),
          path: closed,
          name: name || "Polygon",
          description: notes,
        });
      }
      continue;
    }

    if (pointEl) {
      const scale = styleScale.get(styleUrl) ?? 1;
      const icon = (styleIcon.get(styleUrl) ?? "").toLowerCase();
      const storedKind = dataValue(pm, "kind");
      const equipment = isEquipmentMark(styleUrl, icon, storedKind);
      if (!equipment && (scale === 0 || isFootageName(name))) continue;
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
        size: dataValue(pm, "size") === "sm" ? "sm" : "lg",
      });
    }
  }

  for (const ov of Array.from(doc.getElementsByTagName("GroundOverlay"))) {
    const name = textContent(ov.getElementsByTagName("name")[0]) || "Overlay";
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
    });
  }

  const projectName =
    textContent(doc.getElementsByTagName("name")[0]) || file.name.replace(/\.[^.]+$/, "");

  return { projectName, lines, points, polygons, overlays };
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
