import { toPng } from "html-to-image";

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image"));
    img.src = url;
  });
}

async function baked(node: HTMLElement): Promise<string> {
  const saved: { img: HTMLImageElement; src: string }[] = [];
  for (const img of node.querySelectorAll("img")) {
    if (!img.complete || !img.naturalWidth || img.src.startsWith("data:")) continue;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.drawImage(img, 0, 0);
      saved.push({ img, src: img.src });
      img.src = canvas.toDataURL("image/jpeg", 0.92);
    } catch {
      // A tile that is not readable stays as it is.
    }
  }
  try {
    return await toPng(node, { pixelRatio: 2, cacheBust: false, skipFonts: true });
  } finally {
    for (const item of saved) item.img.src = item.src;
  }
}

/** Picture of an element as it is painted on screen, including its colors. */
export async function snapNode(node: HTMLElement): Promise<string> {
  const hidden = [...node.querySelectorAll<HTMLElement>(".export-hide, [data-handle], .leaflet-control, .gps-crosshair")];
  hidden.forEach((el) => {
    el.dataset.snapVisibility = el.style.visibility;
    el.style.visibility = "hidden";
  });
  try {
    try {
      return await toPng(node, { pixelRatio: 2, cacheBust: true, skipFonts: true });
    } catch {
      return await baked(node);
    }
  } finally {
    hidden.forEach((el) => {
      el.style.visibility = el.dataset.snapVisibility ?? "";
      delete el.dataset.snapVisibility;
    });
  }
}

function drawSvg(ctx: CanvasRenderingContext2D, svg: SVGSVGElement, origin: DOMRect) {
  const ctm = svg.getScreenCTM();
  if (!ctm) return;
  for (const path of svg.querySelectorAll("path")) {
    const d = path.getAttribute("d") ?? "";
    const pts = [...d.matchAll(/[ML]\s*([-\d.]+)(?:[,\s]+)([-\d.]+)/g)].map((match) => {
      const point = new DOMPoint(Number(match[1]), Number(match[2])).matrixTransform(ctm);
      return { x: point.x - origin.left, y: point.y - origin.top };
    });
    if (pts.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    for (const point of pts.slice(1)) ctx.lineTo(point.x, point.y);
    const fill = path.getAttribute("fill");
    if (fill && fill !== "none") {
      ctx.fillStyle = fill;
      ctx.globalAlpha = Number(path.getAttribute("fill-opacity") ?? 0.25);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = path.getAttribute("stroke") || "#ffffff";
    ctx.lineWidth = Number(path.getAttribute("stroke-width") || 2);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  }
}

/** The zoomed map inside a frame, tiles and drawn lines, as a PNG. */
export async function captureFrame(root: HTMLElement): Promise<string> {
  const mapEl = root.querySelector<HTMLElement>(".leaflet-container") ?? root;
  const pending = [...mapEl.querySelectorAll("img")].filter((img) => !img.complete);
  await Promise.all(
    pending.map(
      (img) =>
        new Promise((resolve) => {
          img.addEventListener("load", resolve, { once: true });
          img.addEventListener("error", resolve, { once: true });
        }),
    ),
  );
  const rect = mapEl.getBoundingClientRect();
  const w = Math.max(2, Math.round(rect.width));
  const h = Math.max(2, Math.round(rect.height));
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.scale(scale, scale);
  ctx.fillStyle = "#1c1c1c";
  ctx.fillRect(0, 0, w, h);
  for (const img of mapEl.querySelectorAll<HTMLImageElement>("img.leaflet-tile")) {
    if (!img.complete || !img.naturalWidth) continue;
    const r = img.getBoundingClientRect();
    try {
      ctx.drawImage(img, r.left - rect.left, r.top - rect.top, r.width, r.height);
    } catch {
      // Skip a tile the browser will not copy.
    }
  }
  for (const svg of mapEl.querySelectorAll("svg")) drawSvg(ctx, svg, rect);
  for (const icon of mapEl.querySelectorAll<HTMLImageElement>("img.leaflet-marker-icon")) {
    if (!icon.complete || !icon.naturalWidth) continue;
    const r = icon.getBoundingClientRect();
    try {
      ctx.drawImage(icon, r.left - rect.left, r.top - rect.top, r.width, r.height);
    } catch {
      // Skip an icon the browser will not copy.
    }
  }
  ctx.font = "700 12px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const label of mapEl.querySelectorAll<HTMLElement>(".leaflet-tooltip, .leaflet-div-icon")) {
    const text = (label.innerText || "").trim();
    if (!text) continue;
    const r = label.getBoundingClientRect();
    const color = getComputedStyle(label).color || "#f8fafc";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#111113";
    ctx.strokeText(text, r.left - rect.left + r.width / 2, r.top - rect.top + r.height / 2);
    ctx.fillStyle = color;
    ctx.fillText(text, r.left - rect.left + r.width / 2, r.top - rect.top + r.height / 2);
  }
  const border = getComputedStyle(root).borderTopColor;
  ctx.setLineDash([7, 5]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = border && border !== "rgba(0, 0, 0, 0)" ? border : "#f5d90a";
  ctx.strokeRect(1, 1, w - 2, h - 2);
  return canvas.toDataURL("image/png");
}

export { loadImage };
