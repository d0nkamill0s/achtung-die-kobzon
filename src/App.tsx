// Moving.tsx
import React, {useEffect, useRef, useState} from "react";

/* =========================================
 * 1) Konfiguracja i stałe
 * ========================================= */
const CONFIG = {
    COLORS: {
        backgroundHex: "#0b1020",
        playerOneHex: "#66e3ff",
        playerTwoHex: "#ffd166",
        hudTextHex: "#d7e0f2",
        hudDimHex: "#9aa7bf",
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
        restartKey: "r",
    },
    TRAIL: {
        recentIgnoreFrameCount: 10,
        extraIgnoreMarginPixels: 0.75,
    },
    SCORING: {
        hudRefreshIntervalMs: 100, // jak często odświeżać HUD (mniejsze obciążenie niż co klatkę)
    },
} as const;

/* =========================
 * 2) Typy
 * ========================= */
type Vector2D = { x: number; y: number };
type TrailMask = { widthPixels: number; heightPixels: number; occupancy: Uint8Array };

type PlayerState = {
    label: "Player 1" | "Player 2";
    colorHex: string;
    angleRadians: number;
    positionPixels: Vector2D;
    recentPositions: Vector2D[];
    isAlive: boolean;
    scoreSeconds: number;
};

/* ==================================
 * 3) Utilsy: ślad, rysowanie
 * ================================== */
function createTrailMask(widthPixels: number, heightPixels: number): TrailMask {
    return {widthPixels, heightPixels, occupancy: new Uint8Array(widthPixels * heightPixels)};
}

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
                // ignoruj tylko własny świeży ogon
                let belongsToIgnoredRecent = false;
                for (let i = 0; i < recentPositionsToIgnore.length; i++) {
                    const rp = recentPositionsToIgnore[i];
                    const deltaRecentX = pixelX - rp.x;
                    const deltaRecentY = pixelY - rp.y;
                    const distanceToRecentSquared = deltaRecentX * deltaRecentX + deltaRecentY * deltaRecentY;
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
 * 4) Komponent
 * ========================= */
export default function Moving() {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const animationFrameRef = useRef<number | null>(null);

    // HUD (prosty stan do wyświetlania punktów i komunikatów)
    const [hud, setHud] = useState<{
        playerOneScore: number;
        playerTwoScore: number;
        statusText: string;
        isRunning: boolean;
    }>({playerOneScore: 0, playerTwoScore: 0, statusText: "Press SPACE to start", isRunning: false});

    useEffect(() => {
        const canvasElement = canvasRef.current;
        if (!canvasElement) return;

        const canvasContext = canvasElement.getContext("2d");
        if (!canvasContext) return;

        // --- Stan globalny gry ---
        let isMoving = false;
        let gameOverText = ""; // "Player 1 crashed", "Player 2 crashed", "Both crashed"
        let trailMask = createTrailMask(1, 1);

        // --- Stan graczy ---
        const playerOne: PlayerState = {
            label: "Player 1",
            colorHex: CONFIG.COLORS.playerOneHex,
            angleRadians: 0,
            positionPixels: {x: 0, y: 0},
            recentPositions: [],
            isAlive: true,
            scoreSeconds: 0,
        };
        const playerTwo: PlayerState = {
            label: "Player 2",
            colorHex: CONFIG.COLORS.playerTwoHex,
            angleRadians: 0,
            positionPixels: {x: 0, y: 0},
            recentPositions: [],
            isAlive: true,
            scoreSeconds: 0,
        };

        const pushRecent = (player: PlayerState, point: Vector2D) => {
            player.recentPositions.push(point);
            if (player.recentPositions.length > CONFIG.TRAIL.recentIgnoreFrameCount) {
                player.recentPositions.shift();
            }
        };

        // --- Wejście z klawiatury ---
        const pressedKeys = new Set<string>();

        const handleKeyDown = (event: KeyboardEvent) => {
            const key = event.key.toLowerCase();

            if (key === CONFIG.INPUT.toggleMovementKey) {
                event.preventDefault();
                // jeśli po śmierci – ignoruj SPACE; czekamy na restart
                if (gameOverText) return;
                isMoving = !isMoving;
                setHud((h) => ({...h, isRunning: isMoving, statusText: isMoving ? "" : "Paused (SPACE)"}));
                return;
            }

            if (key === CONFIG.INPUT.restartKey) {
                event.preventDefault();
                if (!gameOverText) return; // restart tylko po zakończeniu
                restartGame();
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

        // --- Canvas, tło, losowe starty ---
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

            // Losowe pozycje początkowe
            playerOne.positionPixels = {
                x: radius + Math.random() * (widthCssPixels - 2 * radius),
                y: radius + Math.random() * (heightCssPixels - 2 * radius),
            };
            playerTwo.positionPixels = {
                x: radius + Math.random() * (widthCssPixels - 2 * radius),
                y: radius + Math.random() * (heightCssPixels - 2 * radius),
            };

            // Zerowanie stanów
            playerOne.angleRadians = 0;
            playerTwo.angleRadians = 0;
            playerOne.recentPositions.length = 0;
            playerTwo.recentPositions.length = 0;
            playerOne.isAlive = true;
            playerTwo.isAlive = true;
            playerOne.scoreSeconds = 0;
            playerTwo.scoreSeconds = 0;
            isMoving = false;
            gameOverText = "";

            // Narysuj punkty startowe i zaznacz maskę
            drawDot(canvasContext, playerOne.positionPixels, radius, playerOne.colorHex);
            drawDot(canvasContext, playerTwo.positionPixels, radius, playerTwo.colorHex);
            markVisitedCircle(trailMask, Math.round(playerOne.positionPixels.x), Math.round(playerOne.positionPixels.y), radius);
            markVisitedCircle(trailMask, Math.round(playerTwo.positionPixels.x), Math.round(playerTwo.positionPixels.y), radius);
            pushRecent(playerOne, {
                x: Math.round(playerOne.positionPixels.x),
                y: Math.round(playerOne.positionPixels.y)
            });
            pushRecent(playerTwo, {
                x: Math.round(playerTwo.positionPixels.x),
                y: Math.round(playerTwo.positionPixels.y)
            });

            setHud({
                playerOneScore: 0,
                playerTwoScore: 0,
                statusText: "Press SPACE to start",
                isRunning: false,
            });
        };

        // Restart po śmierci (R)
        const restartGame = () => {
            setCanvasSizeForHiDPIAndInitPositions();
        };

        setCanvasSizeForHiDPIAndInitPositions();
        window.addEventListener("resize", setCanvasSizeForHiDPIAndInitPositions);
        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);

        // --- Pętla gry ---
        let lastTimestampMs = performance.now();
        let hudAccumulatedMs = 0;

        const step = (nowMs: number) => {
            const deltaTimeSeconds = (nowMs - lastTimestampMs) / 1000;
            lastTimestampMs = nowMs;

            // Sterowanie kątami
            if (pressedKeys.has(CONFIG.INPUT.playerOneTurnLeftKey)) {
                playerOne.angleRadians -= CONFIG.PHYSICS.turnSpeedRadiansPerSecond * deltaTimeSeconds;
            }
            if (pressedKeys.has(CONFIG.INPUT.playerOneTurnRightKey)) {
                playerOne.angleRadians += CONFIG.PHYSICS.turnSpeedRadiansPerSecond * deltaTimeSeconds;
            }
            if (pressedKeys.has(CONFIG.INPUT.playerTwoTurnLeftKey)) {
                playerTwo.angleRadians -= CONFIG.PHYSICS.turnSpeedRadiansPerSecond * deltaTimeSeconds;
            }
            if (pressedKeys.has(CONFIG.INPUT.playerTwoTurnRightKey)) {
                playerTwo.angleRadians += CONFIG.PHYSICS.turnSpeedRadiansPerSecond * deltaTimeSeconds;
            }

            if (isMoving) {
                const radius = CONFIG.DOT.radiusPixels;
                const widthCssPixels = canvasElement.clientWidth;
                const heightCssPixels = canvasElement.clientHeight;

                const advance = (angle: number) => ({
                    dx: Math.cos(angle) * CONFIG.PHYSICS.forwardSpeedPixelsPerSecond * deltaTimeSeconds,
                    dy: Math.sin(angle) * CONFIG.PHYSICS.forwardSpeedPixelsPerSecond * deltaTimeSeconds,
                });

                // Ruch gracza 1 (tylko jeśli żyje)
                if (playerOne.isAlive) {
                    const a1 = advance(playerOne.angleRadians);
                    let nextX = Math.max(radius, Math.min(widthCssPixels - radius, playerOne.positionPixels.x + a1.dx));
                    let nextY = Math.max(radius, Math.min(heightCssPixels - radius, playerOne.positionPixels.y + a1.dy));

                    const collides = collidesWithTrailExcludingRecent(
                        trailMask,
                        {x: Math.round(nextX), y: Math.round(nextY)},
                        radius,
                        playerOne.recentPositions,
                        CONFIG.TRAIL.extraIgnoreMarginPixels
                    );

                    if (collides) {
                        playerOne.isAlive = false;
                    } else {
                        playerOne.positionPixels = {x: nextX, y: nextY};
                        markVisitedCircle(trailMask, Math.round(nextX), Math.round(nextY), radius);
                        pushRecent(playerOne, {x: Math.round(nextX), y: Math.round(nextY)});
                        playerOne.scoreSeconds += deltaTimeSeconds; // <── naliczamy czas indywidualnie
                    }
                }

                // Ruch gracza 2 (tylko jeśli żyje)
                if (playerTwo.isAlive) {
                    const a2 = advance(playerTwo.angleRadians);
                    let nextX = Math.max(radius, Math.min(widthCssPixels - radius, playerTwo.positionPixels.x + a2.dx));
                    let nextY = Math.max(radius, Math.min(heightCssPixels - radius, playerTwo.positionPixels.y + a2.dy));

                    const collides = collidesWithTrailExcludingRecent(
                        trailMask,
                        {x: Math.round(nextX), y: Math.round(nextY)},
                        radius,
                        playerTwo.recentPositions,
                        CONFIG.TRAIL.extraIgnoreMarginPixels
                    );

                    if (collides) {
                        playerTwo.isAlive = false;
                    } else {
                        playerTwo.positionPixels = {x: nextX, y: nextY};
                        markVisitedCircle(trailMask, Math.round(nextX), Math.round(nextY), radius);
                        pushRecent(playerTwo, {x: Math.round(nextX), y: Math.round(nextY)});
                        playerTwo.scoreSeconds += deltaTimeSeconds; // <── naliczamy czas indywidualnie
                    }
                }

                // Jeśli obaj martwi → koniec rundy
                if (!playerOne.isAlive && !playerTwo.isAlive) {
                    isMoving = false;
                    setHud((h) => ({
                        ...h,
                        isRunning: false,
                        statusText: `Both crashed • Press R to restart`,
                    }));
                }
            }

            // Rysowanie kropek
            drawDot(canvasContext, playerOne.positionPixels, CONFIG.DOT.radiusPixels, playerOne.colorHex);
            drawDot(canvasContext, playerTwo.positionPixels, CONFIG.DOT.radiusPixels, playerTwo.colorHex);

            // Odświeżenie HUD
            setHud((h) => ({
                playerOneScore: playerOne.scoreSeconds,
                playerTwoScore: playerTwo.scoreSeconds,
                statusText: h.statusText,
                isRunning: isMoving,
            }));

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

    /* =========================
     * 5) Canvas + HUD
     * ========================= */
    return (
        <>
            <canvas ref={canvasRef} style={{position: "fixed", inset: 0}}/>
            <div
                style={{
                    position: "fixed",
                    left: 12,
                    top: 12,
                    color: CONFIG.COLORS.hudTextHex,
                    fontFamily: "system-ui, ui-sans-serif, Segoe UI, Roboto, Helvetica, Arial",
                    fontSize: 14,
                    lineHeight: 1.3,
                    userSelect: "none",
                    pointerEvents: "none",
                }}
            >
                <div style={{marginBottom: 4}}>
                    <span style={{color: CONFIG.COLORS.playerOneHex, fontWeight: 600}}>Player 1</span>
                    {" • "}
                    <span>{hud.playerOneScore.toFixed(1)}s</span>
                </div>
                <div>
                    <span style={{color: CONFIG.COLORS.playerTwoHex, fontWeight: 600}}>Player 2</span>
                    {" • "}
                    <span>{hud.playerTwoScore.toFixed(1)}s</span>
                </div>
            </div>

            <div
                style={{
                    position: "fixed",
                    bottom: 14,
                    left: 12,
                    color: CONFIG.COLORS.hudDimHex,
                    fontFamily: "system-ui, ui-sans-serif, Segoe UI, Roboto, Helvetica, Arial",
                    fontSize: 13,
                    userSelect: "none",
                    pointerEvents: "none",
                }}
            >
                {hud.statusText ? (
                    <div style={{color: CONFIG.COLORS.hudTextHex}}>{hud.statusText}</div>
                ) : (
                    <div>Controls: Player1 A/D • Player2 J/K • SPACE start/pause • R restart</div>
                )}
            </div>
        </>
    );
}
