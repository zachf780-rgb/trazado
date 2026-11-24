import { jsPDF } from "jspdf";
import { snapNode, legendImage, pasteNoteList } from "./snap";

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
  refs?: { n: number; text: string }[];
  blocks?: { x: number; y: number; w: number; h: number }[];
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

function headerHeight(pageW: number) {
  return Math.round(Math.max(14, pageW * 0.015) * 2.4);
}

function stamp(pdf: jsPDF, page: number, lat: number, lng: number, title: string, head: number) {
  const pageW = pdf.internal.pageSize.getWidth();
  const size = Math.max(14, Math.round(pageW * 0.015));
  const label = title ? `${title}   ${lat.toFixed(6)}, ${lng.toFixed(6)}` : `${lat.toFixed(6)}, ${lng.toFixed(6)}   p.${page}`;
  pdf.setFillColor(255, 255, 255);
  pdf.rect(0, 0, pageW, head, "F");
  pdf.setDrawColor(210, 210, 214);
  pdf.setLineWidth(1);
  pdf.line(0, head, pageW, head);
  pdf.setTextColor(17, 17, 19);
  pdf.setFont("courier", "bold");
  pdf.setFontSize(size);
  pdf.text(label, Math.round(size * 0.7), Math.round(head * 0.66));
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

function legendFit(pageW: number, legend: HTMLImageElement) {
  const pad = Math.round(pageW * 0.012);
  const maxH = Math.round(pageW * 0.12);
  const maxW = pageW - pad * 2;
  const scale = Math.min(maxW / legend.width, maxH / legend.height);
  return { pad, w: legend.width * scale, h: legend.height * scale, foot: Math.round(legend.height * scale + pad * 2) };
}

function pageSize(image: { width: number; height: number }, legend: HTMLImageElement | null) {
  const head = headerHeight(image.width);
  const foot = legend ? legendFit(image.width, legend).foot : 0;
  return { head, foot, width: image.width, height: image.height + head + foot };
}

function drawPage(pdf: jsPDF, image: HTMLImageElement, shot: MapShot, page: number, legend: HTMLImageElement | null, title = "") {
  const head = headerHeight(image.width);
  const fit = legend ? legendFit(image.width, legend) : null;
  pdf.addImage(shot.image, "PNG", 0, head, image.width, image.height);
  if (fit && legend) {
    const y = head + image.height;
    pdf.setFillColor(255, 255, 255);
    pdf.rect(0, y, image.width, fit.foot, "F");
    pdf.setDrawColor(210, 210, 214);
    pdf.setLineWidth(1);
    pdf.line(0, y, image.width, y);
    pdf.addImage(legend, "PNG", (image.width - fit.w) / 2, y + fit.pad, fit.w, fit.h);
  }
  stamp(pdf, page, shot.lat, shot.lng, title, head);
}

export async function exportMapPdf(host: HTMLElement, shot: Omit<MapShot, "image">, filename: string) {
  const raw = await snapNode(host);
  const legendEl = document.querySelector("[data-legend]");
  const legendUrl = legendEl instanceof HTMLElement ? await legendImage(legendEl) : "";
  const legend = legendUrl ? await loadImage(legendUrl) : null;
  const loaded = await loadImage(raw);
  const size = pageSize(loaded, legend);
  const full: MapShot = { ...shot, image: raw };
  const pdf = new jsPDF({
    orientation: loaded.width >= loaded.height ? "landscape" : "portrait",
    unit: "px",
    format: [size.width, size.height],
    hotfixes: ["px_scaling"],
  });
  drawPage(pdf, loaded, full, 1, legend);
  pdf.save(filename);
}

export async function exportPdfPages(pages: MapShot[], filename: string) {
  if (pages.length === 0) return;
  const legendEl = document.querySelector("[data-legend]");
  const legendUrl = legendEl instanceof HTMLElement ? await legendImage(legendEl) : "";
  const legend = legendUrl ? await loadImage(legendUrl) : null;
  const stamped = await Promise.all(
    pages.map(async (page) => {
      const image = page.refs && page.refs.length > 0 ? await pasteNoteList(page.image, page.refs, page.blocks ?? [], null) : page.image;
      return { ...page, image };
    }),
  );
  const images = await Promise.all(stamped.map((page) => loadImage(page.image)));
  const keyUrl = stamped.length > 1 ? await keyImage(stamped) : "";
  const key = keyUrl ? await loadImage(keyUrl) : null;
  const first = key ?? images[0]!;
  const firstSize = pageSize(first, legend);
  const pdf = new jsPDF({
    orientation: first.width >= first.height ? "landscape" : "portrait",
    unit: "px",
    format: [firstSize.width, firstSize.height],
    hotfixes: ["px_scaling"],
  });
  if (key) {
    const rects = stamped.map(shotRect);
    const lat = rects.reduce((sum, rect) => sum + (rect.north + rect.south) / 2, 0) / rects.length;
    const lng = rects.reduce((sum, rect) => sum + (rect.east + rect.west) / 2, 0) / rects.length;
    const shot = { image: keyUrl, lat, lng, zoom: 0, width: key.width, height: key.height };
    drawPage(pdf, key, shot, 1, legend, "Key");
  }
  stamped.forEach((page, index) => {
    const img = images[index]!;
    const number = key ? index + 2 : index + 1;
    const size = pageSize(img, legend);
    if (key || index > 0) pdf.addPage([size.width, size.height], img.width >= img.height ? "landscape" : "portrait");
    drawPage(pdf, img, page, number, legend);
  });
  pdf.save(filename);
}
