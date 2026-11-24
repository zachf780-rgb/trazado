import { jsPDF } from "jspdf";
import { snapNode, legendImage, pasteLegend } from "./snap";

export type MapShot = {
  image: string;
  lat: number;
  lng: number;
  zoom: number;
  width: number;
  height: number;
  south?: number;
  north?: number;
  west?: number;
  east?: number;
};

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read the map picture"));
    img.src = url;
  });
}

function stamp(pdf: jsPDF, page: number, lat: number, lng: number, title = "") {
  const pageW = pdf.internal.pageSize.getWidth();
  const size = Math.max(14, Math.round(pageW * 0.015));
  const label = title ? `${title}   ${lat.toFixed(6)}, ${lng.toFixed(6)}` : `${lat.toFixed(6)}, ${lng.toFixed(6)}   p.${page}`;
  pdf.setFont("courier", "bold");
  pdf.setFontSize(size);
  const pad = Math.round(size * 0.4);
  const height = Math.round(size * 1.45);
  const width = pdf.getTextWidth(label) + pad * 2;
  pdf.setFillColor(17, 17, 19);
  pdf.rect(pad, pad, width, height, "F");
  pdf.setDrawColor(245, 217, 10);
  pdf.setLineWidth(Math.max(1, size * 0.05));
  pdf.rect(pad, pad, width, height, "S");
  pdf.setTextColor(248, 250, 252);
  pdf.text(label, pad * 2, pad + Math.round(size * 1.05));
}

function worldAt(lat: number, lng: number, zoom: number) {
  const scale = 256 * 2 ** zoom;
  const x = ((lng + 180) / 360) * scale;
  const sine = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * scale;
  return { x, y, scale };
}

function shotRect(shot: MapShot) {
  if ([shot.south, shot.north, shot.west, shot.east].every((n) => typeof n === "number" && Number.isFinite(n))) {
    return { south: shot.south as number, north: shot.north as number, west: shot.west as number, east: shot.east as number };
  }
  const { x, y, scale } = worldAt(shot.lat, shot.lng, shot.zoom);
  const lngOf = (px: number) => (px / scale) * 360 - 180;
  const latOf = (py: number) => {
    const n = Math.PI - (2 * Math.PI * py) / scale;
    return (180 / Math.PI) * Math.atan(Math.sinh(n));
  };
  return {
    west: lngOf(x - shot.width / 2),
    east: lngOf(x + shot.width / 2),
    north: latOf(y - shot.height / 2),
    south: latOf(y + shot.height / 2),
  };
}

async function keyImage(pages: MapShot[]) {
  const rects = pages.map(shotRect);
  let south = Math.min(...rects.map((rect) => rect.south));
  let north = Math.max(...rects.map((rect) => rect.north));
  let west = Math.min(...rects.map((rect) => rect.west));
  let east = Math.max(...rects.map((rect) => rect.east));
  const padLat = Math.max((north - south) * 0.4, 0.0005);
  const padLng = Math.max((east - west) * 0.4, 0.0005);
  south -= padLat;
  north += padLat;
  west -= padLng;
  east += padLng;
  let zoom = 3;
  for (let z = 18; z >= 3; z -= 1) {
    const nw = worldAt(north, west, z);
    const se = worldAt(south, east, z);
    if (se.x - nw.x <= 1400 && se.y - nw.y <= 1000) {
      zoom = z;
      break;
    }
  }
  const nw = worldAt(north, west, zoom);
  const se = worldAt(south, east, zoom);
  const width = Math.max(2, Math.ceil(se.x - nw.x));
  const height = Math.max(2, Math.ceil(se.y - nw.y));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#1c1c1c";
  ctx.fillRect(0, 0, width, height);
  const x0 = Math.floor(nw.x / 256);
  const x1 = Math.floor(se.x / 256);
  const y0 = Math.floor(nw.y / 256);
  const y1 = Math.floor(se.y / 256);
  await Promise.all(
    Array.from({ length: (x1 - x0 + 1) * (y1 - y0 + 1) }, (_, index) => {
      const span = x1 - x0 + 1;
      const tx = x0 + (index % span);
      const ty = y0 + Math.floor(index / span);
      return loadImage(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${tx}`)
        .then((img) => ctx.drawImage(img, tx * 256 - nw.x, ty * 256 - nw.y, 256, 256))
        .catch(() => undefined);
    }),
  );
  rects.forEach((rect, index) => {
    const a = worldAt(rect.north, rect.west, zoom);
    const b = worldAt(rect.south, rect.east, zoom);
    const x = a.x - nw.x;
    const y = a.y - nw.y;
    const rw = b.x - a.x;
    const rh = b.y - a.y;
    ctx.strokeStyle = "#f5d90a";
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 7]);
    ctx.strokeRect(x, y, rw, rh);
    ctx.setLineDash([]);
    const label = `p.${index + 2}`;
    ctx.font = "700 22px sans-serif";
    const tw = ctx.measureText(label).width + 16;
    const labelY = y + 8 + index * 30;
    ctx.fillStyle = "#111113";
    ctx.fillRect(x + 8, labelY, tw, 28);
    ctx.fillStyle = "#f5d90a";
    ctx.fillText(label, x + 16, labelY + 20);
  });
  return canvas.toDataURL("image/png");
}

function drawPage(pdf: jsPDF, image: HTMLImageElement, shot: MapShot, page: number) {
  pdf.addImage(shot.image, "PNG", 0, 0, image.width, image.height);
  stamp(pdf, page, shot.lat, shot.lng);
}

export async function exportMapPdf(host: HTMLElement, shot: Omit<MapShot, "image">, filename: string) {
  const raw = await snapNode(host);
  const legend = document.querySelector("[data-legend]");
  const legendUrl = legend instanceof HTMLElement ? await legendImage(legend) : "";
  const image = legendUrl ? await pasteLegend(raw, legendUrl) : raw;
  const loaded = await loadImage(image);
  const full: MapShot = { ...shot, image };
  const pdf = new jsPDF({
    orientation: loaded.width >= loaded.height ? "landscape" : "portrait",
    unit: "px",
    format: [loaded.width, loaded.height],
    hotfixes: ["px_scaling"],
  });
  drawPage(pdf, loaded, full, 1);
  pdf.save(filename);
}

export async function exportPdfPages(pages: MapShot[], filename: string) {
  if (pages.length === 0) return;
  const legendEl = document.querySelector("[data-legend]");
  const legendUrl = legendEl instanceof HTMLElement ? await legendImage(legendEl) : "";
  const legendMark = legendUrl ? await loadImage(legendUrl) : null;
  const sample = legendMark ? await loadImage(pages[0]!.image) : null;
  const snapshotScale =
    legendMark && sample
      ? Math.min((sample.width * 0.34) / legendMark.width, (sample.height * 0.62) / legendMark.height, 1)
      : 1;
  const stamped = legendUrl
    ? await Promise.all(pages.map(async (page) => ({ ...page, image: await pasteLegend(page.image, legendUrl, snapshotScale) })))
    : pages;
  const images = await Promise.all(stamped.map((page) => loadImage(page.image)));
  const keyUrl = stamped.length > 1 ? await keyImage(stamped) : "";
  const keyPlain = keyUrl ? await loadImage(keyUrl) : null;
  const keyScale =
    legendMark && sample && keyPlain ? Math.min(snapshotScale, (keyPlain.width / sample.width) * snapshotScale) : snapshotScale;
  const keyMarked = keyUrl && legendUrl ? await pasteLegend(keyUrl, legendUrl, keyScale) : keyUrl;
  const key = keyMarked ? await loadImage(keyMarked) : null;
  const first = key ?? images[0]!;
  const pdf = new jsPDF({
    orientation: first.width >= first.height ? "landscape" : "portrait",
    unit: "px",
    format: [first.width, first.height],
    hotfixes: ["px_scaling"],
  });
  if (key) {
    const rects = stamped.map(shotRect);
    const lat = rects.reduce((sum, rect) => sum + (rect.north + rect.south) / 2, 0) / rects.length;
    const lng = rects.reduce((sum, rect) => sum + (rect.east + rect.west) / 2, 0) / rects.length;
    pdf.addImage(keyMarked, "PNG", 0, 0, key.width, key.height);
    stamp(pdf, 1, lat, lng, "Key");
  }
  stamped.forEach((page, index) => {
    const img = images[index]!;
    const number = key ? index + 2 : index + 1;
    if (key || index > 0) pdf.addPage([img.width, img.height], img.width >= img.height ? "landscape" : "portrait");
    drawPage(pdf, img, page, number);
  });
  pdf.save(filename);
}
