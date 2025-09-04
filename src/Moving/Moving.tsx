// Moving.tsx
import React, {useEffect, useRef} from "react";

/* =========================================
 * 1) Konfiguracja i stałe (bez magic numbers)
 * ========================================= */
const CONFIG = {
    COLORS: {
        backgroundHex: "#0b1020",
        dotHex: "#66e3ff",
    },
    DOT: {
        radiusPixels: 2, // promień kropki/śladu w pikselach CSS
    },
    PHYSICS: {
        forwardSpeedPixelsPerSecond: 80,          // stała prędkość postępowa
        turnSpeedRadiansPerSecond: Math.PI / 2,   // szybkość skrętu
    },
    INPUT: {
        toggleMovementKey: " ",   // spacja – start/stop
        turnLeftKey: "a",
        turnRightKey: "d",
        restartKey: "r",          // przygotowane pod przyszły restart
    },
    TRAIL: {
        recentIgnoreFrameCount: 10,   // ile najnowszych „stempli” śladu ignorować przy kolizji
        extraIgnoreMarginPixels: 0.75 // dodatkowy margines ignorowania (w pikselach)
    }
} as const;

/* =========================
 * 2) Typy pomocnicze
 * ========================= */
type Vector2D = { x: number; y: number };

type TrailMask = {
    widthPixels: number;    // szerokość w pikselach CSS
    heightPixels: number;   // wysokość w pikselach CSS
    occupancy: Uint8Array;  // 1 = zajęty piksel śladu, 0 = wolny
};

/* ==================================
 * 3) Utilsy do pracy z maską śladu
 * ================================== */
function createTrailMask(widthPixels: number, heightPixels: number): TrailMask {
    return {widthPixels, heightPixels, occupancy: new Uint8Array(widthPixels * heightPixels)};
}

function toIndex(trailMask: TrailMask, pixelX: number, pixelY: number): number {
    return pixelY * trailMask.widthPixels + pixelX;
}

function isInBounds(trailMask: TrailMask, pixelX: number, pixelY: number): boolean {
    return (
        pixelX >= 0 &&
        pixelY >= 0 &&
        pixelX < trailMask.widthPixels &&
        pixelY < trailMask.heightPixels
    );
}

/** Zaznacza w masce okrąg (promień `radiusPixels`) jako odwiedzony. */
function markVisitedCircle(
    trailMask: TrailMask,
    centerX: number,
    centerY: number,
    radiusPixels: number
): void {
    const minX = Math.max(0, Math.floor(centerX - radiusPixels));
    const maxX = Math.min(trailMask.widthPixels - 1, Math.ceil(centerX + radiusPixels));
    const minY = Math.max(0, Math.floor(centerY - radiusPixels));
    const maxY = Math.min(trailMask.heightPixels - 1, Math.ceil(centerY + radiusPixels));
    const radiusSquared = radiusPixels * radiusPixels;

    for (let pixelY = minY; pixelY <= maxY; pixelY++) {
        const deltaY = pixelY - centerY;
        const deltaYSquared = deltaY * deltaY;
        const rowOffset = pixelY * trailMask.widthPixels;

        for (let pixelX = minX; pixelX <= maxX; pixelX++) {
            const deltaX = pixelX - centerX;
            const distanceSquared = deltaX * deltaX + deltaYSquared;
            if (distanceSquared <= radiusSquared) {
                trailMask.occupancy[rowOffset + pixelX] = 1;
            }
        }
    }
}

/** Sprawdza kolizję okręgu z maską, ignorując świeże punkty z `recentPositions`. */
function collidesWithTrailExcludingRecent(
    trailMask: TrailMask,
    center: Vector2D,
    radiusPixels: number,
    recentPositions: Vector2D[],
    extraIgnoreMarginPixels: number
): boolean {
    const minX = Math.max(0, Math.floor(center.x - radiusPixels));
    const maxX = Math.min(trailMask.widthPixels - 1, Math.ceil(center.x + radiusPixels));
    const minY = Math.max(0, Math.floor(center.y - radiusPixels));
    const maxY = Math.min(trailMask.heightPixels - 1, Math.ceil(center.y + radiusPixels));

    const radiusSquared = radiusPixels * radiusPixels;
    const ignoreRadius = radiusPixels + extraIgnoreMarginPixels;
    const ignoreRadiusSquared = ignoreRadius * ignoreRadius;

    for (let pixelY = minY; pixelY <= maxY; pixelY++) {
        const deltaY = pixelY - center.y;
        const deltaYSquared = deltaY * deltaY;
        const rowOffset = pixelY * trailMask.widthPixels;

        for (let pixelX = minX; pixelX <= maxX; pixelX++) {
            const deltaX = pixelX - center.x;
            const distanceSquared = deltaX * deltaX + deltaYSquared;

            if (distanceSquared > radiusSquared) continue; // punkt spoza okręgu – pomiń

            if (trailMask.occupancy[rowOffset + pixelX] === 1) {
                // sprawdź, czy ten piksel należy do jednego z najnowszych „stempli”
                let belongsToRecent = false;
                for (let i = 0; i < recentPositions.length; i++) {
                    const recentPoint = recentPositions[i];
                    const deltaRecentX = pixelX - recentPoint.x;
                    const deltaRecentY = pixelY - recentPoint.y;
                    const distanceToRecentSquared = deltaRecentX * deltaRecentX + deltaRecentY * deltaRecentY;
                    if (distanceToRecentSquared <= ignoreRadiusSquared) {
                        belongsToRecent = true;
                        break;
                    }
                }
                if (!belongsToRecent) return true; // prawdziwa kolizja ze „starym” śladem
            }
        }
    }
    return false;
}

/* =========================
 * 4) Renderowanie kropki
 * ========================= */
function drawDot(
    ctx: CanvasRenderingContext2D,
    center: Vector2D,
    radiusPixels: number,
    colorHex: string
): void {
    ctx.beginPath();
    ctx.arc(center.x, center.y, radiusPixels, 0, Math.PI * 2);
    ctx.fillStyle = colorHex;
    ctx.fill();
}

/* =========================
 * 5) Główny komponent gry
 * ========================= */
export default function Moving() {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const animationFrameRef = useRef<number | null>(null);

    useEffect(() => {
        const canvasElement = canvasRef.current;
        if (!canvasElement) return;

        const canvasContext = canvasElement.getContext("2d");
        if (!canvasContext) return;

        // --- Stan gry ---
        let isMoving = false; // spacja przełącza
        let headingAngleRadians = 0; // 0 = w prawo
        let positionPixels: Vector2D = {
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
        };

        // Maska śladu + najnowsze punkty, których nie traktujemy jako kolizji
        let trailMask = createTrailMask(1, 1);
        const recentPositions: Vector2D[] = [];
        const pushRecentPosition = (point: Vector2D) => {
            recentPositions.push(point);
            const maxRecent = CONFIG.TRAIL.recentIgnoreFrameCount;
            if (recentPositions.length > maxRecent) recentPositions.shift();
        };

        // Sterowanie klawiaturą
        const pressedKeys = new Set<string>();
        const handleKeyDown = (event: KeyboardEvent) => {
            const key = event.key.toLowerCase();
            if (key === CONFIG.INPUT.toggleMovementKey) {
                event.preventDefault();
                isMoving = !isMoving;
                return;
            }
            pressedKeys.add(key);
        };
        const handleKeyUp = (event: KeyboardEvent) => {
            const key = event.key.toLowerCase();
            if (key === CONFIG.INPUT.toggleMovementKey) {
                event.preventDefault();
                return;
            }
            pressedKeys.delete(key);
        };

        // Rozmiar canvas + HiDPI
        const paintBackground = (widthCssPixels: number, heightCssPixels: number) => {
            canvasContext.fillStyle = CONFIG.COLORS.backgroundHex;
            canvasContext.fillRect(0, 0, widthCssPixels, heightCssPixels);
        };

        const setCanvasSizeForHiDPI = () => {
            const devicePixelRatioSafe = Math.max(1, window.devicePixelRatio || 1);
            const widthCssPixels = window.innerWidth;
            const heightCssPixels = window.innerHeight;

            canvasElement.width = Math.floor(widthCssPixels * devicePixelRatioSafe);
            canvasElement.height = Math.floor(heightCssPixels * devicePixelRatioSafe);
            canvasElement.style.width = `${widthCssPixels}px`;
            canvasElement.style.height = `${heightCssPixels}px`;

            // skala na DPR – rysujemy w jednostkach CSS
            canvasContext.setTransform(devicePixelRatioSafe, 0, 0, devicePixelRatioSafe, 0, 0);

            // tło i świeża maska śladu (w jednostkach CSS)
            paintBackground(widthCssPixels, heightCssPixels);
            trailMask = createTrailMask(widthCssPixels, heightCssPixels);
        };

        // Inicjalizacja sceny
        setCanvasSizeForHiDPI();
        window.addEventListener("resize", setCanvasSizeForHiDPI);
        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);

        // startowa kropka + pierwszy znacznik w masce
        drawDot(canvasContext, positionPixels, CONFIG.DOT.radiusPixels, CONFIG.COLORS.dotHex);
        markVisitedCircle(
            trailMask,
            Math.round(positionPixels.x),
            Math.round(positionPixels.y),
            CONFIG.DOT.radiusPixels
        );
        pushRecentPosition({x: Math.round(positionPixels.x), y: Math.round(positionPixels.y)});

        // Pętla gry
        let lastTimestampMs = performance.now();
        const step = (nowMs: number) => {
            const deltaTimeSeconds = (nowMs - lastTimestampMs) / 1000;
            lastTimestampMs = nowMs;

            // skręcanie A/D działa zawsze (również podczas postoju)
            if (pressedKeys.has(CONFIG.INPUT.turnLeftKey)) {
                headingAngleRadians -= CONFIG.PHYSICS.turnSpeedRadiansPerSecond * deltaTimeSeconds;
            }
            if (pressedKeys.has(CONFIG.INPUT.turnRightKey)) {
                headingAngleRadians += CONFIG.PHYSICS.turnSpeedRadiansPerSecond * deltaTimeSeconds;
            }

            if (isMoving) {
                // wylicz pozycję docelową
                const deltaX =
                    Math.cos(headingAngleRadians) *
                    CONFIG.PHYSICS.forwardSpeedPixelsPerSecond *
                    deltaTimeSeconds;
                const deltaY =
                    Math.sin(headingAngleRadians) *
                    CONFIG.PHYSICS.forwardSpeedPixelsPerSecond *
                    deltaTimeSeconds;

                let nextX = positionPixels.x + deltaX;
                let nextY = positionPixels.y + deltaY;

                // granice ekranu (w jednostkach CSS)
                const widthCssPixels = canvasElement.clientWidth;
                const heightCssPixels = canvasElement.clientHeight;
                const dotRadius = CONFIG.DOT.radiusPixels;

                nextX = Math.max(dotRadius, Math.min(widthCssPixels - dotRadius, nextX));
                nextY = Math.max(dotRadius, Math.min(heightCssPixels - dotRadius, nextY));

                // kolizja z wcześniejszym śladem (bez świeżego ogona)
                const collides =
                    collidesWithTrailExcludingRecent(
                        trailMask,
                        {x: Math.round(nextX), y: Math.round(nextY)},
                        CONFIG.DOT.radiusPixels,
                        recentPositions,
                        CONFIG.TRAIL.extraIgnoreMarginPixels
                    );

                if (!collides) {
                    positionPixels = {x: nextX, y: nextY};
                    markVisitedCircle(
                        trailMask,
                        Math.round(positionPixels.x),
                        Math.round(positionPixels.y),
                        CONFIG.DOT.radiusPixels
                    );
                    pushRecentPosition({
                        x: Math.round(positionPixels.x),
                        y: Math.round(positionPixels.y),
                    });
                } else {
                    // kolizja – zatrzymaj ruch
                    isMoving = false;
                }
            }

            // render śladu (nie czyścimy – rysujemy tylko kolejną kropkę)
            drawDot(canvasContext, positionPixels, CONFIG.DOT.radiusPixels, CONFIG.COLORS.dotHex);

            animationFrameRef.current = requestAnimationFrame(step);
        };

        animationFrameRef.current = requestAnimationFrame(step);

        // Sprzątanie
        return () => {
            window.removeEventListener("resize", setCanvasSizeForHiDPI);
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        };
    }, []);

    return <canvas ref={canvasRef} style={{position: "fixed", inset: 0}}/>;
}
