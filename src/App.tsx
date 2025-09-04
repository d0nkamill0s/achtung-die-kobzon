// Moving.tsx
import React, {useEffect, useRef} from "react";

/* =========================================
 * 1) Konfiguracja i stałe (bez magic numbers)
 * ========================================= */
const CONFIG = {
    COLORS: {
        backgroundHex: "#0b1020",
        playerOneHex: "#66e3ff",
        playerTwoHex: "#ffd166",
    },
    DOT: {
        radiusPixels: 2,
    },
    PHYSICS: {
        forwardSpeedPixelsPerSecond: 80,
        turnSpeedRadiansPerSecond: Math.PI / 2,
    },
    INPUT: {
        toggleMovementKey: " ",
        playerOneTurnLeftKey: "a",
        playerOneTurnRightKey: "d",
        playerTwoTurnLeftKey: "j",
        playerTwoTurnRightKey: "k",
    },
    TRAIL: {
        recentIgnoreFrameCount: 10,
        extraIgnoreMarginPixels: 0.75,
    },
} as const;

/* =========================
 * 2) Typy pomocnicze
 * ========================= */
type Vector2D = { x: number; y: number };

type TrailMask = {
    widthPixels: number;
    heightPixels: number;
    occupancy: Uint8Array; // 1 = zajęte, 0 = wolne
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

/** Sprawdza kolizję okręgu z maską, ignorując świeże punkty z `recentPositionsToIgnore`. */
function collidesWithTrailExcludingRecent(
    trailMask: TrailMask,
    center: Vector2D,
    radiusPixels: number,
    recentPositionsToIgnore: Vector2D[],
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
            if (distanceSquared > radiusSquared) continue;

            if (trailMask.occupancy[rowOffset + pixelX] === 1) {
                // Czy piksel należy do świeżego ogona (który ignorujemy)? – tylko własnego!
                let belongsToIgnoredRecent = false;
                for (let i = 0; i < recentPositionsToIgnore.length; i++) {
                    const recentPoint = recentPositionsToIgnore[i];
                    const deltaRecentX = pixelX - recentPoint.x;
                    const deltaRecentY = pixelY - recentPoint.y;
                    const distanceToRecentSquared =
                        deltaRecentX * deltaRecentX + deltaRecentY * deltaRecentY;
                    if (distanceToRecentSquared <= ignoreRadiusSquared) {
                        belongsToIgnoredRecent = true;
                        break;
                    }
                }
                if (!belongsToIgnoredRecent) return true;
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

        // --- Stan gry (globalny start/stop) ---
        let isMoving = false;

        // --- Gracz 1 ---
        let playerOneAngleRadians = 0;
        let playerOnePositionPixels: Vector2D = {x: 0, y: 0};
        const playerOneRecentPositions: Vector2D[] = [];
        const pushPlayerOneRecent = (point: Vector2D) => {
            playerOneRecentPositions.push(point);
            if (playerOneRecentPositions.length > CONFIG.TRAIL.recentIgnoreFrameCount) {
                playerOneRecentPositions.shift();
            }
        };

        // --- Gracz 2 ---
        let playerTwoAngleRadians = 0;
        let playerTwoPositionPixels: Vector2D = {x: 0, y: 0};
        const playerTwoRecentPositions: Vector2D[] = [];
        const pushPlayerTwoRecent = (point: Vector2D) => {
            playerTwoRecentPositions.push(point);
            if (playerTwoRecentPositions.length > CONFIG.TRAIL.recentIgnoreFrameCount) {
                playerTwoRecentPositions.shift();
            }
        };

        // --- Maska śladu wspólna dla obu graczy ---
        let trailMask = createTrailMask(1, 1);

        // --- Wejście z klawiatury ---
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

        // --- Rozmiar canvas + HiDPI, tło, losowe starty ---
        const paintBackground = (widthCssPixels: number, heightCssPixels: number) => {
            canvasContext.fillStyle = CONFIG.COLORS.backgroundHex;
            canvasContext.fillRect(0, 0, widthCssPixels, heightCssPixels);
        };

        const setCanvasSizeForHiDPIAndInitPositions = () => {
            const devicePixelRatioSafe = Math.max(1, window.devicePixelRatio || 1);
            const widthCssPixels = window.innerWidth;
            const heightCssPixels = window.innerHeight;

            canvasElement.width = Math.floor(widthCssPixels * devicePixelRatioSafe);
            canvasElement.height = Math.floor(heightCssPixels * devicePixelRatioSafe);
            canvasElement.style.width = `${widthCssPixels}px`;
            canvasElement.style.height = `${heightCssPixels}px`;
            canvasContext.setTransform(devicePixelRatioSafe, 0, 0, devicePixelRatioSafe, 0, 0);

            paintBackground(widthCssPixels, heightCssPixels);
            trailMask = createTrailMask(widthCssPixels, heightCssPixels);

            const radius = CONFIG.DOT.radiusPixels;

            // Losowe pozycje startowe (z marginesem promienia)
            playerOnePositionPixels = {
                x: radius + Math.random() * (widthCssPixels - 2 * radius),
                y: radius + Math.random() * (heightCssPixels - 2 * radius),
            };
            playerTwoPositionPixels = {
                x: radius + Math.random() * (widthCssPixels - 2 * radius),
                y: radius + Math.random() * (heightCssPixels - 2 * radius),
            };

            // Wyzeruj świeże ogony
            playerOneRecentPositions.length = 0;
            playerTwoRecentPositions.length = 0;

            // Narysuj startowe kropki i zaznacz maskę śladu
            drawDot(canvasContext, playerOnePositionPixels, radius, CONFIG.COLORS.playerOneHex);
            drawDot(canvasContext, playerTwoPositionPixels, radius, CONFIG.COLORS.playerTwoHex);

            markVisitedCircle(trailMask, Math.round(playerOnePositionPixels.x), Math.round(playerOnePositionPixels.y), radius);
            markVisitedCircle(trailMask, Math.round(playerTwoPositionPixels.x), Math.round(playerTwoPositionPixels.y), radius);

            pushPlayerOneRecent({x: Math.round(playerOnePositionPixels.x), y: Math.round(playerOnePositionPixels.y)});
            pushPlayerTwoRecent({x: Math.round(playerTwoPositionPixels.x), y: Math.round(playerTwoPositionPixels.y)});
        };

        setCanvasSizeForHiDPIAndInitPositions();
        window.addEventListener("resize", setCanvasSizeForHiDPIAndInitPositions);
        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);

        // --- Pętla gry ---
        let lastTimestampMs = performance.now();
        const step = (nowMs: number) => {
            const deltaTimeSeconds = (nowMs - lastTimestampMs) / 1000;
            lastTimestampMs = nowMs;

            // Skręty (działają zawsze)
            if (pressedKeys.has(CONFIG.INPUT.playerOneTurnLeftKey)) {
                playerOneAngleRadians -= CONFIG.PHYSICS.turnSpeedRadiansPerSecond * deltaTimeSeconds;
            }
            if (pressedKeys.has(CONFIG.INPUT.playerOneTurnRightKey)) {
                playerOneAngleRadians += CONFIG.PHYSICS.turnSpeedRadiansPerSecond * deltaTimeSeconds;
            }
            if (pressedKeys.has(CONFIG.INPUT.playerTwoTurnLeftKey)) {
                playerTwoAngleRadians -= CONFIG.PHYSICS.turnSpeedRadiansPerSecond * deltaTimeSeconds;
            }
            if (pressedKeys.has(CONFIG.INPUT.playerTwoTurnRightKey)) {
                playerTwoAngleRadians += CONFIG.PHYSICS.turnSpeedRadiansPerSecond * deltaTimeSeconds;
            }

            if (isMoving) {
                const radius = CONFIG.DOT.radiusPixels;
                const widthCssPixels = canvasElement.clientWidth;
                const heightCssPixels = canvasElement.clientHeight;

                // 1) Wylicz proponowane pozycje (jeszcze bez rysowania i oznaczania)
                const playerOneDeltaX =
                    Math.cos(playerOneAngleRadians) *
                    CONFIG.PHYSICS.forwardSpeedPixelsPerSecond *
                    deltaTimeSeconds;
                const playerOneDeltaY =
                    Math.sin(playerOneAngleRadians) *
                    CONFIG.PHYSICS.forwardSpeedPixelsPerSecond *
                    deltaTimeSeconds;

                const playerTwoDeltaX =
                    Math.cos(playerTwoAngleRadians) *
                    CONFIG.PHYSICS.forwardSpeedPixelsPerSecond *
                    deltaTimeSeconds;
                const playerTwoDeltaY =
                    Math.sin(playerTwoAngleRadians) *
                    CONFIG.PHYSICS.forwardSpeedPixelsPerSecond *
                    deltaTimeSeconds;

                let playerOneNextX = Math.max(
                    radius,
                    Math.min(widthCssPixels - radius, playerOnePositionPixels.x + playerOneDeltaX)
                );
                let playerOneNextY = Math.max(
                    radius,
                    Math.min(heightCssPixels - radius, playerOnePositionPixels.y + playerOneDeltaY)
                );

                let playerTwoNextX = Math.max(
                    radius,
                    Math.min(widthCssPixels - radius, playerTwoPositionPixels.x + playerTwoDeltaX)
                );
                let playerTwoNextY = Math.max(
                    radius,
                    Math.min(heightCssPixels - radius, playerTwoPositionPixels.y + playerTwoDeltaY)
                );

                // 2) Sprawdź kolizje każdej kropki z aktualnym śladem
                const playerOneCollides = collidesWithTrailExcludingRecent(
                    trailMask,
                    {x: Math.round(playerOneNextX), y: Math.round(playerOneNextY)},
                    radius,
                    /* ignorujemy TYLKO własny świeży ogon: */ playerOneRecentPositions,
                    CONFIG.TRAIL.extraIgnoreMarginPixels
                );
                const playerTwoCollides = collidesWithTrailExcludingRecent(
                    trailMask,
                    {x: Math.round(playerTwoNextX), y: Math.round(playerTwoNextY)},
                    radius,
                    /* ignorujemy TYLKO własny świeży ogon: */ playerTwoRecentPositions,
                    CONFIG.TRAIL.extraIgnoreMarginPixels
                );

                // 3) Zatrzymaj poruszanie jeśli któraś uderzyła
                // (prosto: globalny stop; możesz to rozdzielić na osobne stany)
                if (playerOneCollides || playerTwoCollides) {
                    isMoving = false;
                } else {
                    // 4) Zastosuj ruch i dopiero teraz zaznacz ślad obu graczy
                    playerOnePositionPixels = {x: playerOneNextX, y: playerOneNextY};
                    playerTwoPositionPixels = {x: playerTwoNextX, y: playerTwoNextY};

                    markVisitedCircle(
                        trailMask,
                        Math.round(playerOnePositionPixels.x),
                        Math.round(playerOnePositionPixels.y),
                        radius
                    );
                    markVisitedCircle(
                        trailMask,
                        Math.round(playerTwoPositionPixels.x),
                        Math.round(playerTwoPositionPixels.y),
                        radius
                    );

                    pushPlayerOneRecent({
                        x: Math.round(playerOnePositionPixels.x),
                        y: Math.round(playerOnePositionPixels.y),
                    });
                    pushPlayerTwoRecent({
                        x: Math.round(playerTwoPositionPixels.x),
                        y: Math.round(playerTwoPositionPixels.y),
                    });
                }
            }

            // 5) Render (nie czyścimy tła – zostają ślady, dokładamy tylko kropki)
            drawDot(canvasContext, playerOnePositionPixels, CONFIG.DOT.radiusPixels, CONFIG.COLORS.playerOneHex);
            drawDot(canvasContext, playerTwoPositionPixels, CONFIG.DOT.radiusPixels, CONFIG.COLORS.playerTwoHex);

            animationFrameRef.current = requestAnimationFrame(step);
        };

        animationFrameRef.current = requestAnimationFrame(step);

        // Sprzątanie
        return () => {
            window.removeEventListener("resize", setCanvasSizeForHiDPIAndInitPositions);
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        };
    }, []);

    return <canvas ref={canvasRef} style={{position: "fixed", inset: 0}}/>;
}
