import { useEffect, useRef } from "react";

type Cable = { x: number; y: number; w: number };

export function BucketRun({ onClose }: { onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const aim = { up: false, down: false };
    let bucket = 92;
    let speed = 2.4;
    let score = 0;
    let over = false;
    let started = false;
    const cables: Cable[] = [];
    let spawn = 0;
    let frame = 0;

    const reset = () => {
      started = true;
      over = false;
      score = 0;
      speed = 2.4;
      bucket = 92;
      cables.splice(0, cables.length);
      spawn = 20;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
        return;
      }
      const down = e.type === "keydown";
      if (e.key === "ArrowUp" || e.key === "w" || e.key === "W") aim.up = down;
      if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") aim.down = down;
      if (down && (e.key === " " || e.key === "Enter") && (over || !started)) {
        e.preventDefault();
        reset();
      }
      e.stopPropagation();
    };
    const onPointer = (e: PointerEvent) => {
      if (e.type === "pointermove" && e.buttons === 0) return;
      const rect = canvas.getBoundingClientRect();
      const up = e.clientY < rect.top + rect.height / 2;
      aim.up = e.type !== "pointerup" && up;
      aim.down = e.type !== "pointerup" && !up;
      if (!started || over) reset();
    };
    const onPointerEnd = () => {
      aim.up = false;
      aim.down = false;
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    canvas.addEventListener("pointerdown", onPointer);
    canvas.addEventListener("pointermove", onPointer);
    window.addEventListener("pointerup", onPointerEnd);

    let raf = 0;
    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      frame += 1;
      if (started && !over) {
        if (aim.up) bucket -= 2.4;
        if (aim.down) bucket += 2.4;
        bucket = Math.max(28, Math.min(150, bucket));
        speed = Math.min(6.2, 2.4 + score / 400);
        spawn -= 1;
        if (spawn <= 0) {
          cables.push({ x: w + 10, y: 36 + Math.random() * 110, w: 54 + Math.random() * 70 });
          spawn = 46 + Math.random() * 50;
        }
        for (const cable of cables) cable.x -= speed;
        while (cables.length && cables[0]!.x + cables[0]!.w < 0) cables.shift();
        score += 1;
        for (const cable of cables) {
          const hitsX = cable.x < 128 && cable.x + cable.w > 110;
          if (hitsX && Math.abs(cable.y - bucket) < 12) over = true;
        }
      }
      ctx.fillStyle = "#10140f";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#3f6212";
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let x = 0; x < w; x += 28) {
        ctx.moveTo(x, 176);
        ctx.lineTo(x + 14, 176);
      }
      ctx.stroke();
      ctx.fillStyle = "#eab308";
      ctx.fillRect(28, 132, 54, 28);
      ctx.fillStyle = "#111";
      ctx.fillRect(36, 158, 12, 12);
      ctx.fillRect(62, 158, 12, 12);
      ctx.strokeStyle = "#a16207";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(58, 132);
      ctx.lineTo(118, bucket);
      ctx.stroke();
      ctx.fillStyle = "#f8fafc";
      ctx.beginPath();
      ctx.arc(118, bucket - 10, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#38bdf8";
      ctx.fillRect(108, bucket - 4, 20, 10);
      ctx.strokeStyle = "#f87171";
      ctx.lineWidth = 3;
      for (const cable of cables) {
        ctx.beginPath();
        ctx.moveTo(cable.x, cable.y);
        ctx.lineTo(cable.x + cable.w, cable.y + Math.sin((cable.x + frame) / 18) * 2);
        ctx.stroke();
      }
      ctx.fillStyle = "#e8eaee";
      ctx.font = "14px ui-monospace, monospace";
      ctx.fillText(String(Math.floor(score / 6)), 12, 22);
      if (!started || over) {
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = "#fff";
        ctx.font = "16px ui-monospace, monospace";
        ctx.fillText(over ? "Line hit. Space to go again." : "Up / down to dodge the cables.", 16, 96);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      canvas.removeEventListener("pointerdown", onPointer);
      canvas.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerup", onPointerEnd);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-xl">
        <div className="mb-2 flex items-center justify-between text-xs text-zinc-300">
          <span>Bucket run</span>
          <button type="button" className="rounded border border-zinc-600 px-2 py-1" onClick={onClose}>
            Close
          </button>
        </div>
        <canvas ref={canvasRef} width={560} height={200} className="w-full touch-none rounded border border-zinc-700 bg-black" />
        <p className="mt-2 text-center text-[11px] text-zinc-400">Hold the top half to raise the bucket, the bottom half to lower it.</p>
      </div>
    </div>
  );
}
