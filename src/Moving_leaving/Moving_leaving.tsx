import React, { useEffect, useRef } from "react";

export default function Moving() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // --- maska śladu (CSS px) ---
    let trail = new Uint8Array(1);
    let tw = 1, th = 1;

    // Rozmiar + HiDPI
    const setSize = () => {
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // tło tylko raz (i przy resize)
      ctx.fillStyle = "#0b1020";
      ctx.fillRect(0, 0, w, h);

      // (re)alloc maski śladu
      tw = canvas.clientWidth;
      th = canvas.clientHeight;
      trail = new Uint8Array(tw * th);
    };

    setSize();
    window.addEventListener("resize", setSize);

    // Parametry ruchu
    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    let angle = 0;                 // 0 = w prawo
    const r = 2;                   // 4 px średnicy
    const forwardSpeed = 80;       // px/s
    const turnSpeed = Math.PI / 2; // rad/s
    const keys: Record<string, boolean> = {};
    let moving = false;            // stan start/stop

    // Bufor najnowszego śladu, którego NIE traktujemy jako kolizję
    const RECENT_IGNORE_FRAMES = 10;       // ile ostatnich stempli ignorować
    const IGNORE_EXTRA_MARGIN = 0.75;      // dodatkowy margines (px) dla płynności
    const recent: Array<{x:number;y:number}> = [];

    const pushRecent = (px:number, py:number) => {
      recent.push({ x: px, y: py });
      if (recent.length > RECENT_IGNORE_FRAMES) recent.shift();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === " ") { e.preventDefault(); moving = !moving; return; } // spacja = toggle
      keys[k] = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === " ") { e.preventDefault(); return; }
      keys[k] = false;
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    // --- pomocnicze: praca z maską ---
    const markVisited = (cx: number, cy: number) => {
      const xmin = Math.max(0, Math.floor(cx - r));
      const xmax = Math.min(tw - 1, Math.ceil(cx + r));
      const ymin = Math.max(0, Math.floor(cy - r));
      const ymax = Math.min(th - 1, Math.ceil(cy + r));
      const rr = r;
      const r2 = rr * rr;
      for (let iy = ymin; iy <= ymax; iy++) {
        const dy = iy - cy, dy2 = dy * dy, row = iy * tw;
        for (let ix = xmin; ix <= xmax; ix++) {
          const dx = ix - cx;
          if (dx * dx + dy2 <= r2) trail[row + ix] = 1;
        }
      }
    };

    // kolizja: trafiamy w odwiedzony piksel, który NIE należy do „najnowszego” ogona
    const collidesExcludingRecent = (nx: number, ny: number): boolean => {
      const xmin = Math.max(0, Math.floor(nx - r));
      const xmax = Math.min(tw - 1, Math.ceil(nx + r));
      const ymin = Math.max(0, Math.floor(ny - r));
      const ymax = Math.min(th - 1, Math.ceil(ny + r));

      const ignoreR = r + IGNORE_EXTRA_MARGIN;
      const ignoreR2 = ignoreR * ignoreR;
      const r2 = r * r;

      for (let iy = ymin; iy <= ymax; iy++) {
        const dy = iy - ny, dy2 = dy * dy, row = iy * tw;
        for (let ix = xmin; ix <= xmax; ix++) {
          const dx = ix - nx;
          if (dx * dx + dy2 <= r2) {
            if (trail[row + ix]) {
              // sprawdź, czy ten piksel należy do któregoś z „najnowszych” stempli
              let belongsToRecent = false;
              for (let j = 0; j < recent.length; j++) {
                const rx = recent[j].x, ry = recent[j].y;
                const drx = ix - rx, dry = iy - ry;
                if (drx * drx + dry * dry <= ignoreR2) { belongsToRecent = true; break; }
              }
              if (!belongsToRecent) return true; // prawdziwa kolizja ze starszym śladem
            }
          }
        }
      }
      return false;
    };

    // startowa kropka + znacznik
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fillStyle = "#66e3ff"; ctx.fill();
    markVisited(Math.round(x), Math.round(y));
    pushRecent(Math.round(x), Math.round(y));

    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;

      // obrót A/D – działa zawsze
      if (keys["a"]) angle -= turnSpeed * dt;
      if (keys["d"]) angle += turnSpeed * dt;

      if (moving) {
        let nx = x + Math.cos(angle) * forwardSpeed * dt;
        let ny = y + Math.sin(angle) * forwardSpeed * dt;

        // granice
        const w = canvas.clientWidth, h = canvas.clientHeight;
        nx = Math.max(r, Math.min(w - r, nx));
        ny = Math.max(r, Math.min(h - r, ny));

        // kolizja ze śladem, z wyłączeniem najnowszego ogona
        if (!collidesExcludingRecent(Math.round(nx), Math.round(ny))) {
          x = nx; y = ny;
          markVisited(Math.round(x), Math.round(y));
          pushRecent(Math.round(x), Math.round(y));
        } else {
          console.log('dupa'); // kolizja
          moving = false;
        }
      }

      // ślad – dorysuj kropkę (nie czyścimy tła)
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = "#66e3ff";
      ctx.fill();

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("resize", setSize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return <canvas ref={canvasRef} style={{ position: "fixed", inset: 0 }} />;
}
