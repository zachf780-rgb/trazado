import type { PedType, PointKind, VaultType } from "./types";
import { pedestalBody, pedestalColor, pedestalDir, pedestalPixels, pedestalRotates, vaultColor, vaultPixels } from "./presets";

const cache = new Map<string, string>();

function drawPointMarker(kind: PointKind, size: number): string {
  const key = `${kind}-${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (typeof document === "undefined") return "";

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const pad = Math.round(size * 0.16);
  const w = size - pad * 2;
  const stroke = Math.max(2, Math.round(size * 0.08));
  const cx = size / 2;
  const cy = size / 2;

  ctx.lineJoin = "miter";
  ctx.lineCap = "square";

  if (kind === "pin") {
    const r = w * 0.28;
    const headY = pad + r + 1;
    ctx.beginPath();
    ctx.arc(cx, headY, r, Math.PI * 0.18, Math.PI * 0.82, true);
    ctx.lineTo(cx, size - pad * 0.12);
    ctx.closePath();
    ctx.fillStyle = "#f4f4f5";
    ctx.strokeStyle = "#111113";
    ctx.lineWidth = stroke;
    ctx.lineJoin = "round";
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, headY, r * 0.32, 0, Math.PI * 2);
    ctx.fillStyle = "#111113";
    ctx.fill();
  } else if (kind === "pole") {
    ctx.beginPath();
    ctx.arc(cx, cy, w / 2, 0, Math.PI * 2);
    ctx.fillStyle = "#f4f4f5";
    ctx.strokeStyle = "#111113";
    ctx.lineWidth = stroke;
    ctx.fill();
    ctx.stroke();
  } else if (kind === "passing") {
    ctx.beginPath();
    ctx.moveTo(cx, pad * 0.55);
    ctx.lineTo(size - pad * 0.35, size - pad * 0.45);
    ctx.lineTo(pad * 0.35, size - pad * 0.45);
    ctx.closePath();
    ctx.fillStyle = "#facc15";
    ctx.strokeStyle = "#111113";
    ctx.lineWidth = stroke;
    ctx.lineJoin = "round";
    ctx.fill();
    ctx.stroke();
  } else if (kind === "mdu") {
    ctx.fillStyle = "#111113";
    ctx.strokeStyle = "#f4f4f5";
    ctx.lineWidth = Math.max(2, stroke * 0.7);
    ctx.fillRect(pad, pad, w, w);
    ctx.strokeRect(pad + 0.5, pad + 0.5, w - 1, w - 1);
  } else {
    ctx.fillStyle = "#f4f4f5";
    ctx.strokeStyle = "#111113";
    ctx.lineWidth = stroke;
    ctx.fillRect(pad, pad, w, w);
    ctx.strokeRect(pad + stroke / 2, pad + stroke / 2, w - stroke, w - stroke);
    if (kind === "vault") {
      ctx.fillStyle = "#111113";
      ctx.font = `700 ${Math.round(size * 0.48)}px "IBM Plex Sans", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("V", cx, cy + size * 0.03);
    }
  }

  const url = canvas.toDataURL("image/png");
  cache.set(key, url);
  return url;
}

export function pointIconDataUrl(kind: PointKind, size = 64): string {
  return drawPointMarker(kind, size);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export function pedestalIconDataUrl(type: Exclude<PedType, "">, dir: number): string {
  const turns = pedestalRotates(type) ? pedestalDir(dir) : 0;
  const body = pedestalBody(type);
  const box = pedestalPixels(type, turns);
  const scale = 64 / 22;
  const w = Math.max(12, Math.round(box.w * scale));
  const h = Math.max(12, Math.round(box.h * scale));
  const paint = pedestalColor(type);
  const key = `ped-${type}-${turns}-${w}x${h}-${paint.fill}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (typeof document === "undefined") return "";
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const bw = body.w * scale;
  const bh = body.h * scale;
  const stroke = Math.max(3, Math.round(Math.min(bw, bh) * 0.09));
  const letter = type === "dh" ? "DH" : type === "dd" ? "DD" : type.toUpperCase();
  ctx.translate(w / 2, h / 2);
  ctx.rotate((turns * Math.PI) / 4);
  ctx.lineJoin = "miter";
  ctx.fillStyle = paint.fill;
  ctx.strokeStyle = "#111113";
  ctx.lineWidth = stroke;
  const rw = bw - stroke * 0.5;
  const rh = bh - stroke * 0.5;
  if (type === "s") roundRect(ctx, -rw / 2, -rh / 2, rw, rh, Math.min(rw, rh) * 0.22);
  else ctx.rect(-rw / 2, -rh / 2, rw, rh);
  ctx.fill();
  ctx.stroke();
  const font = Math.round(Math.min(rw, rh) * (letter.length > 1 ? 0.42 : 0.52));
  ctx.fillStyle = paint.ink;
  ctx.font = `700 ${font}px "IBM Plex Sans", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(letter, 0, font * 0.04);
  const url = canvas.toDataURL("image/png");
  cache.set(key, url);
  return url;
}

export function vaultIconDataUrl(type: Exclude<VaultType, "">): string {
  const box = vaultPixels();
  const paint = vaultColor(type);
  const scale = 64 / 22;
  const w = Math.max(12, Math.round(box.w * scale));
  const h = Math.max(12, Math.round(box.h * scale));
  const key = `vault-${type}-${w}x${h}-${paint.fill}-v`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (typeof document === "undefined") return "";
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const stroke = Math.max(3, Math.round(Math.min(w, h) * 0.08));
  ctx.lineJoin = "miter";
  ctx.fillStyle = paint.fill;
  ctx.strokeStyle = "#111113";
  ctx.lineWidth = stroke;
  const inset = stroke;
  ctx.beginPath();
  if (type === "s") {
    ctx.moveTo(w / 2, inset);
    ctx.lineTo(w - inset, h / 2);
    ctx.lineTo(w / 2, h - inset);
    ctx.lineTo(inset, h / 2);
  } else {
    ctx.rect(inset, inset, w - inset * 2, h - inset * 2);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  const font = Math.round(Math.min(w, h) * (type === "s" ? 0.38 : 0.46));
  ctx.fillStyle = paint.ink;
  ctx.font = `700 ${font}px "IBM Plex Sans", system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("V", w / 2, h / 2 + font * 0.04);
  const url = canvas.toDataURL("image/png");
  cache.set(key, url);
  return url;
}

export function poleVariantDataUrl(riser: boolean, anchors: number[], size = 128): string {
  const dirs: number[] = [];
  for (const raw of anchors) {
    const dir = ((Math.round(raw) % 8) + 8) % 8;
    if (!dirs.includes(dir)) dirs.push(dir);
    if (dirs.length === 3) break;
  }
  dirs.sort((a, b) => a - b);
  const key = `polev-${size}-${riser ? 1 : 0}-${dirs.join(".")}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (typeof document === "undefined") return "";

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const c = size / 2;

  for (const dir of dirs) {
    const rad = (dir * 45 * Math.PI) / 180;
    const ox = Math.sin(rad);
    const oy = -Math.cos(rad);
    const px = -oy;
    const py = ox;
    const inner = size * 0.2;
    const base = size * 0.3;
    const tip = size * 0.48;
    const half = size * 0.15;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111113";
    ctx.fillStyle = "#ea580c";
    ctx.lineWidth = size * 0.055;
    ctx.beginPath();
    ctx.moveTo(c + ox * inner, c + oy * inner);
    ctx.lineTo(c + ox * base, c + oy * base);
    ctx.stroke();
    ctx.lineWidth = Math.max(2, size * 0.028);
    ctx.beginPath();
    ctx.moveTo(c + ox * tip, c + oy * tip);
    ctx.lineTo(c + ox * base + px * half, c + oy * base + py * half);
    ctx.lineTo(c + ox * base - px * half, c + oy * base - py * half);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  const radius = riser ? size * 0.22 : size * 0.16;
  ctx.beginPath();
  ctx.arc(c, c, radius, 0, Math.PI * 2);
  ctx.fillStyle = riser ? "#ea580c" : "#f4f4f5";
  ctx.strokeStyle = "#111113";
  ctx.lineWidth = Math.max(3, size * 0.035);
  ctx.fill();
  ctx.stroke();
  if (riser) {
    const letter = Math.round(size * 0.28);
    ctx.font = `800 ${letter}px "IBM Plex Sans", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = Math.max(3, size * 0.028);
    ctx.strokeStyle = "#111113";
    ctx.fillStyle = "#fff7ed";
    ctx.strokeText("R", c, c + size * 0.02);
    ctx.fillText("R", c, c + size * 0.02);
  }

  const url = canvas.toDataURL("image/png");
  cache.set(key, url);
  return url;
}

export function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; ext: string } {
  const match = /^data:image\/([\w+.-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return { bytes: new Uint8Array(), ext: "png" };
  const mime = match[1] ?? "png";
  const b64 = match[2] ?? "";
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const ext = mime === "jpeg" ? "jpg" : mime.replace("svg+xml", "svg");
  return { bytes, ext };
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
