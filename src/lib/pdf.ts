import { jsPDF } from "jspdf";
import { snapNode } from "./snap";

export type MapShot = {
  image: string;
  lat: number;
  lng: number;
  zoom: number;
  width: number;
  height: number;
};

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read the map picture"));
    img.src = url;
  });
}

function stamp(pdf: jsPDF, page: number, lat: number, lng: number) {
  const label = `${lat.toFixed(6)}, ${lng.toFixed(6)}   p.${page}`;
  pdf.setFillColor(17, 17, 19);
  pdf.rect(10, 10, Math.max(210, label.length * 7.2), 26, "F");
  pdf.setTextColor(248, 250, 252);
  pdf.setFont("courier", "bold");
  pdf.setFontSize(13);
  pdf.text(label, 18, 28);
}

function pointToward(from: MapShot, to: MapShot): "left" | "right" | "up" | "down" {
  const dx = to.lng - from.lng;
  const dy = to.lat - from.lat;
  if (Math.abs(dx) >= Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy > 0 ? "up" : "down";
}

function nextArrow(pdf: jsPDF, edge: "left" | "right" | "up" | "down", page: number, w: number, h: number, slot = 0) {
  const label = `p.${page}`;
  pdf.setFont("courier", "bold");
  pdf.setFontSize(12);
  const boxW = 54;
  const boxH = 22;
  const gap = slot * (boxH + 8);
  let x = w / 2 - boxW / 2;
  let y = h / 2 - boxH / 2;
  if (edge === "left") {
    x = 12;
    y += gap;
  }
  if (edge === "right") {
    x = w - boxW - 12;
    y += gap;
  }
  if (edge === "up") {
    y = 44;
    x += gap;
  }
  if (edge === "down") {
    y = h - boxH - 12;
    x += gap;
  }
  pdf.setFillColor(17, 17, 19);
  pdf.rect(x, y, boxW, boxH, "F");
  const cx = x + 14;
  const cy = y + boxH / 2;
  pdf.setDrawColor(245, 217, 10);
  pdf.setLineWidth(1.5);
  if (edge === "left") pdf.triangle(cx - 8, cy, cx + 4, cy - 6, cx + 4, cy + 6, "S");
  if (edge === "right") pdf.triangle(cx + 8, cy, cx - 4, cy - 6, cx - 4, cy + 6, "S");
  if (edge === "up") pdf.triangle(cx, cy - 8, cx - 6, cy + 4, cx + 6, cy + 4, "S");
  if (edge === "down") pdf.triangle(cx, cy + 8, cx - 6, cy - 4, cx + 6, cy - 4, "S");
  pdf.setTextColor(245, 217, 10);
  pdf.text(label, x + 24, y + 15);
}

function drawPage(pdf: jsPDF, image: HTMLImageElement, shot: MapShot, page: number, prev: MapShot | null, next: MapShot | null) {
  pdf.addImage(shot.image, "PNG", 0, 0, image.width, image.height);
  stamp(pdf, page, shot.lat, shot.lng);
  const marks = [
    prev ? { shot: prev, page: page - 1 } : null,
    next ? { shot: next, page: page + 1 } : null,
  ].filter((mark): mark is { shot: MapShot; page: number } => mark !== null);
  const used = new Map<string, number>();
  for (const mark of marks) {
    const edge = pointToward(shot, mark.shot);
    const slot = used.get(edge) ?? 0;
    used.set(edge, slot + 1);
    nextArrow(pdf, edge, mark.page, image.width, image.height, slot);
  }
}

export async function exportMapPdf(host: HTMLElement, shot: Omit<MapShot, "image">, filename: string) {
  const image = await snapNode(host);
  const loaded = await loadImage(image);
  const full: MapShot = { ...shot, image };
  const pdf = new jsPDF({
    orientation: loaded.width >= loaded.height ? "landscape" : "portrait",
    unit: "px",
    format: [loaded.width, loaded.height],
    hotfixes: ["px_scaling"],
  });
  drawPage(pdf, loaded, full, 1, null, null);
  pdf.save(filename);
}

export async function exportPdfPages(pages: MapShot[], filename: string) {
  if (pages.length === 0) return;
  const images = await Promise.all(pages.map((page) => loadImage(page.image)));
  const first = images[0]!;
  const pdf = new jsPDF({
    orientation: first.width >= first.height ? "landscape" : "portrait",
    unit: "px",
    format: [first.width, first.height],
    hotfixes: ["px_scaling"],
  });
  pages.forEach((page, index) => {
    const img = images[index]!;
    if (index > 0) pdf.addPage([img.width, img.height], img.width >= img.height ? "landscape" : "portrait");
    drawPage(pdf, img, page, index + 1, pages[index - 1] ?? null, pages[index + 1] ?? null);
  });
  pdf.save(filename);
}
