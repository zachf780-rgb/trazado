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

function copyPaint(from: HTMLElement, to: HTMLElement) {
  const sources = [from, ...from.querySelectorAll<HTMLElement>("*")];
  const copies = [to, ...to.querySelectorAll<HTMLElement>("*")];
  sources.forEach((src, index) => {
    const dst = copies[index];
    if (!dst) return;
    const style = getComputedStyle(src);
    dst.style.color = style.color;
    dst.style.backgroundColor = style.backgroundColor;
    dst.style.borderTopColor = style.borderTopColor;
    dst.style.borderRightColor = style.borderRightColor;
    dst.style.borderBottomColor = style.borderBottomColor;
    dst.style.borderLeftColor = style.borderLeftColor;
    dst.style.borderTopWidth = style.borderTopWidth;
    dst.style.borderRightWidth = style.borderRightWidth;
    dst.style.borderBottomWidth = style.borderBottomWidth;
    dst.style.borderLeftWidth = style.borderLeftWidth;
    dst.style.borderStyle = style.borderTopStyle;
    dst.style.borderRadius = style.borderRadius;
    dst.style.font = style.font;
    dst.style.lineHeight = style.lineHeight;
    dst.style.letterSpacing = style.letterSpacing;
    dst.style.paddingTop = style.paddingTop;
    dst.style.paddingRight = style.paddingRight;
    dst.style.paddingBottom = style.paddingBottom;
    dst.style.paddingLeft = style.paddingLeft;
    dst.style.marginTop = style.marginTop;
    dst.style.marginRight = style.marginRight;
    dst.style.marginBottom = style.marginBottom;
    dst.style.marginLeft = style.marginLeft;
    dst.style.display = style.display;
    dst.style.alignItems = style.alignItems;
    dst.style.justifyContent = style.justifyContent;
    dst.style.gap = style.gap;
    dst.style.columnGap = style.columnGap;
    dst.style.rowGap = style.rowGap;
    dst.style.flex = style.flex;
    dst.style.gridTemplateColumns = style.gridTemplateColumns;
    dst.style.opacity = style.opacity;
    dst.style.whiteSpace = style.whiteSpace;
  });
}

/** The on-screen legend, painted with resolved colors so it can sit on a PDF page. */
export async function legendImage(legend: HTMLElement): Promise<string> {
  const clone = legend.cloneNode(true) as HTMLElement;
  const width = Math.max(160, Math.round(legend.getBoundingClientRect().width));
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-12000px;top:0;width:${width}px;z-index:-1;`;
  clone.style.position = "static";
  clone.style.maxHeight = "none";
  clone.style.height = "auto";
  clone.style.overflow = "visible";
  clone.style.width = `${width}px`;
  host.appendChild(clone);
  document.body.appendChild(host);
  copyPaint(legend, clone);
  try {
    return await toPng(clone, { pixelRatio: 2, cacheBust: true, skipFonts: true });
  } catch {
    return "";
  } finally {
    host.remove();
  }
}

export async function pasteLegend(pageUrl: string, legendUrl: string): Promise<string> {
  if (!legendUrl) return pageUrl;
  const [page, mark] = await Promise.all([loadImage(pageUrl), loadImage(legendUrl)]);
  const canvas = document.createElement("canvas");
  canvas.width = page.width;
  canvas.height = page.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return pageUrl;
  ctx.drawImage(page, 0, 0);
  const margin = Math.round(Math.min(page.width, page.height) * 0.02);
  const maxW = page.width * 0.46;
  const maxH = page.height * 0.72;
  const scale = Math.min(maxW / mark.width, maxH / mark.height, 1);
  const w = mark.width * scale;
  const h = mark.height * scale;
  ctx.drawImage(mark, page.width - w - margin, page.height - h - margin, w, h);
  return canvas.toDataURL("image/png");
}
