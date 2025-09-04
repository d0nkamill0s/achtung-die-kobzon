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
        borderHex: "#75D4E6", // kolor ramki
    },
    DOT: {
        radiusPixels: 2,
    },
    PHYSICS: {
        forwardSpeedPixelsPerSecond: 80,
        turnSpeedRadiansPerSecond: Math.PI / 2,
    },
    INPUT: {
        toggleMovementKey: " ", // SPACE
        playerOneTurnLeftKey: "a",
        playerOneTurnRightKey: "d",
        playerTwoTurnLeftKey: "j",
        playerTwoTurnRightKey: "k",
        restartKey: "r",
    },
    TRAIL: {
        recentIgnoreFrameCount: 10,
        extraIgnoreMarginPixels: 0.75, // promień „świeżego” ogona ignorowanego przy kolizji
    },
    SCORING: {
        hudRefreshIntervalMs: 100,
    },
    GAPS: {
        enabled: true,
        minIntervalSeconds: 1.2,
        maxIntervalSeconds: 3.0,
        minDurationSeconds: 0.18,
        maxDurationSeconds: 0.35,
        corridorExtraMarginPixels: 0.6,
        corridorMaxPoints: 600,
    },
    BORDER: {
        thicknessPixels: 4, // grubość ramki
        insetPixels: 4,     // odsunięcie ramki od krawędzi canvasa (żeby była w pełni widoczna)
    },
} as const;

/* =========================
 * 2) Typy
 * ========================= */
type Vector2D = { x: number; y: number };

type TrailMask = {
    widthPixels: number;
    heightPixels: number;
    occupancy: Uint8Array; // 1 = zajęty piksel śladu, 0 = wolny
};

type GapState = {
    isActive: boolean;
    timeUntilNextGap: number; // s
    remainingGapTime: number; // s
};

type PlayerState = {
    label: "Player 1" | "Player 2";
    colorHex: string;
    angleRadians: number;
    positionPixels: Vector2D;
    recentPositions: Vector2D[]; // świeży ogon (dla ignorowania kolizji)
    gapCorridor: Vector2D[];     // punkty korytarza w trakcie dziury (dla wszystkich)
    isAlive: boolean;
    scoreSeconds: number;
    gap: GapState;
    lastRenderedPosition?: Vector2D;
};

/* ==================================
 * 3) Utilsy: ślad, kolizje, losowanie, rysowanie
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

/**
 * Sprawdza kolizję okręgu z maską śladu, ignorując punkty z `ignoredPoints`
 * w promieniu `extraIgnoreMarginPixels`.
 */
function collidesWithTrailExcludingPoints(
    trailMask: TrailMask,
    center: Vector2D,
    radiusPixels: number,
    ignoredPoints: Vector2D[],
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
                // Czy piksel należy do jednego z ignorowanych punktów?
                let belongsToIgnored = false;
                for (let i = 0; i < ignoredPoints.length; i++) {
                    const p = ignoredPoints[i];
                    const dx = pixelX - p.x;
                    const dy = pixelY - p.y;
                    if (dx * dx + dy * dy <= ignoreRadiusSquared) {
                        belongsToIgnored = true;
                        break;
                    }
                }
                if (!belongsToIgnored) return true;
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

function drawHeadWithGap(
    ctx: CanvasRenderingContext2D,
    player: PlayerState,
    radiusPixels: number
): void {
    if (CONFIG.GAPS.enabled && player.gap.isActive && player.lastRenderedPosition) {
        ctx.beginPath();
        ctx.arc(
            player.lastRenderedPosition.x,
            player.lastRenderedPosition.y,
            radiusPixels,
            0,
            Math.PI * 2
        );
        ctx.fillStyle = CONFIG.COLORS.backgroundHex;
        ctx.fill();
    }
    drawDot(ctx, player.positionPixels, radiusPixels, player.colorHex);
    player.lastRenderedPosition = {x: player.positionPixels.x, y: player.positionPixels.y};
}

function randomInRange(min: number, max: number) {
    return min + Math.random() * (max - min);
}

function initGapState(): GapState {
    return {
        isActive: false,
        timeUntilNextGap: randomInRange(CONFIG.GAPS.minIntervalSeconds, CONFIG.GAPS.maxIntervalSeconds),
        remainingGapTime: 0,
    };
}

function updateGap(gap: GapState, deltaTimeSeconds: number) {
    if (!CONFIG.GAPS.enabled) return;
    if (gap.isActive) {
        gap.remainingGapTime -= deltaTimeSeconds;
        if (gap.remainingGapTime <= 0) {
            gap.isActive = false;
            gap.timeUntilNextGap = randomInRange(
                CONFIG.GAPS.minIntervalSeconds,
                CONFIG.GAPS.maxIntervalSeconds
            );
        }
    } else {
        gap.timeUntilNextGap -= deltaTimeSeconds;
        if (gap.timeUntilNextGap <= 0) {
            gap.isActive = true;
            gap.remainingGapTime = randomInRange(
                CONFIG.GAPS.minDurationSeconds,
                CONFIG.GAPS.maxDurationSeconds
            );
        }
    }
}

/** Rysuje ramkę na krawędziach pola gry. */
function drawBorder(ctx: CanvasRenderingContext2D, width: number, height: number) {
    const t = CONFIG.BORDER.thicknessPixels;
    const inset = CONFIG.BORDER.insetPixels;
    ctx.fillStyle = CONFIG.COLORS.borderHex;
    // top
    ctx.fillRect(inset, inset, width - 2 * inset, t);
    // bottom
    ctx.fillRect(inset, height - inset - t, width - 2 * inset, t);
    // left
    ctx.fillRect(inset, inset, t, height - 2 * inset);
    // right
    ctx.fillRect(width - inset - t, inset, t, height - 2 * inset);
}

/** Sprawdza, czy okrąg o środku (x,y) i promieniu r uderza w ramkę. */
function hitsBorder(x: number, y: number, width: number, height: number, radius: number): boolean {
    const t = CONFIG.BORDER.thicknessPixels;
    const inset = CONFIG.BORDER.insetPixels;

    // Wewnętrzny „bezpieczny” prostokąt, w którym może poruszać się środek kropki
    const minX = inset + t + radius;
    const maxX = width - inset - t - radius;
    const minY = inset + t + radius;
    const maxY = height - inset - t - radius;

    return x < minX || x > maxX || y < minY || y > maxY;
}

/* =========================
 * 4) Komponent + HUD + restart
 * ========================= */
export default function Moving() {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const animationFrameRef = useRef<number | null>(null);

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

        // --- Stan globalny rundy ---
        let isMoving = false;
        let hasRoundEnded = false;
        let trailMask: TrailMask = createTrailMask(1, 1);

        // --- Gracze ---
        const playerOne: PlayerState = {
            label: "Player 1",
            colorHex: CONFIG.COLORS.playerOneHex,
            angleRadians: 0,
            positionPixels: {x: 0, y: 0},
            recentPositions: [],
            gapCorridor: [],
            isAlive: true,
            scoreSeconds: 0,
            gap: initGapState(),
            lastRenderedPosition: undefined,
        };
        const playerTwo: PlayerState = {
            label: "Player 2",
            colorHex: CONFIG.COLORS.playerTwoHex,
            angleRadians: 0,
            positionPixels: {x: 0, y: 0},
            recentPositions: [],
            gapCorridor: [],
            isAlive: true,
            scoreSeconds: 0,
            gap: initGapState(),
            lastRenderedPosition: undefined,
        };

        const pushRecent = (player: PlayerState, point: Vector2D) => {
            player.recentPositions.push(point);
            if (player.recentPositions.length > CONFIG.TRAIL.recentIgnoreFrameCount) {
                player.recentPositions.shift();
            }
        };

        const pushGapCorridor = (player: PlayerState, point: Vector2D) => {
            player.gapCorridor.push(point);
            if (player.gapCorridor.length > CONFIG.GAPS.corridorMaxPoints) {
                player.gapCorridor.splice(0, player.gapCorridor.length - CONFIG.GAPS.corridorMaxPoints);
            }
        };

        // --- Tło + ramka ---
        const paintBackground = (widthCssPixels: number, heightCssPixels: number) => {
            canvasContext.fillStyle = CONFIG.COLORS.backgroundHex;
            canvasContext.fillRect(0, 0, widthCssPixels, heightCssPixels);
            drawBorder(canvasContext, widthCssPixels, heightCssPixels);
        };

        // --- Reset rundy (również na start i resize) ---
        const resetRound = () => {
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

            // Losowe starty w bezpiecznym obszarze (nie na ramce)
            const t = CONFIG.BORDER.thicknessPixels;
            const inset = CONFIG.BORDER.insetPixels;
            const minX = inset + t + radius;
            const maxX = widthCssPixels - inset - t - radius;
            const minY = inset + t + radius;
            const maxY = heightCssPixels - inset - t - radius;

            playerOne.positionPixels = {
                x: minX + Math.random() * (maxX - minX),
                y: minY + Math.random() * (maxY - minY),
            };
            playerTwo.positionPixels = {
                x: minX + Math.random() * (maxX - minX),
                y: minY + Math.random() * (maxY - minY),
            };

            // Reset stanów
            playerOne.angleRadians = 0;
            playerTwo.angleRadians = 0;
            playerOne.recentPositions.length = 0;
            playerTwo.recentPositions.length = 0;
            playerOne.gapCorridor.length = 0;
            playerTwo.gapCorridor.length = 0;
            playerOne.isAlive = true;
            playerTwo.isAlive = true;
            playerOne.scoreSeconds = 0;
            playerTwo.scoreSeconds = 0;
            playerOne.gap = initGapState();
            playerTwo.gap = initGapState();
            playerOne.lastRenderedPosition = undefined;
            playerTwo.lastRenderedPosition = undefined;

            isMoving = false;
            hasRoundEnded = false;

            // Zaznacz startowe punkty i narysuj głowy
            drawDot(canvasContext, playerOne.positionPixels, radius, playerOne.colorHex);
            drawDot(canvasContext, playerTwo.positionPixels, radius, playerTwo.colorHex);
            markVisitedCircle(
                trailMask,
                Math.round(playerOne.positionPixels.x),
                Math.round(playerOne.positionPixels.y),
                radius
            );
            markVisitedCircle(
                trailMask,
                Math.round(playerTwo.positionPixels.x),
                Math.round(playerTwo.positionPixels.y),
                radius
            );
            pushRecent(playerOne, {
                x: Math.round(playerOne.positionPixels.x),
                y: Math.round(playerOne.positionPixels.y),
            });
            pushRecent(playerTwo, {
                x: Math.round(playerTwo.positionPixels.x),
                y: Math.round(playerTwo.positionPixels.y),
            });

            setHud({
                playerOneScore: 0,
                playerTwoScore: 0,
                statusText: "Press SPACE to start",
                isRunning: false,
            });
        };

        // --- Input ---
        const pressedKeys = new Set<string>();

        const handleKeyDown = (event: KeyboardEvent) => {
            const key = event.key.toLowerCase();

            if (key === CONFIG.INPUT.toggleMovementKey) {
                event.preventDefault();
                if (hasRoundEnded) return; // po zakończeniu – tylko R
                isMoving = !isMoving;
                setHud((h) => ({...h, isRunning: isMoving, statusText: isMoving ? "" : "Paused (SPACE)"}));
                return;
            }

            if (key === CONFIG.INPUT.restartKey) {
                event.preventDefault();
                resetRound(); // zawsze restartuje rundę
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

        // Init + eventy
        resetRound();
        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        window.addEventListener("resize", resetRound);

        // --- Pętla gry ---
        let lastTimestampMs = performance.now();

        const step = (nowMs: number) => {
            const deltaTimeSeconds = (nowMs - lastTimestampMs) / 1000;
            lastTimestampMs = nowMs;

            // Obrót (działa zawsze)
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

            if (isMoving && !hasRoundEnded) {
                const radius = CONFIG.DOT.radiusPixels;
                const w = canvasElement.clientWidth;
                const h = canvasElement.clientHeight;

                // Zegary gapów (per żyjący gracz)
                if (playerOne.isAlive) updateGap(playerOne.gap, deltaTimeSeconds);
                if (playerTwo.isAlive) updateGap(playerTwo.gap, deltaTimeSeconds);

                const advance = (angle: number) => ({
                    dx: Math.cos(angle) * CONFIG.PHYSICS.forwardSpeedPixelsPerSecond * deltaTimeSeconds,
                    dy: Math.sin(angle) * CONFIG.PHYSICS.forwardSpeedPixelsPerSecond * deltaTimeSeconds,
                });

                // Gracz 1
                if (playerOne.isAlive) {
                    const a1 = advance(playerOne.angleRadians);
                    const nextX = playerOne.positionPixels.x + a1.dx;
                    const nextY = playerOne.positionPixels.y + a1.dy;

                    // 🔴 kolizja z ramką?
                    if (hitsBorder(nextX, nextY, w, h, radius)) {
                        playerOne.isAlive = false;
                    } else {
                        // kolizja ze śladem (ignorujemy świeży ogon i korytarze)
                        const ignorePointsP1 = playerOne.recentPositions
                            .concat(playerOne.gapCorridor)
                            .concat(playerTwo.gapCorridor);

                        const collides = collidesWithTrailExcludingPoints(
                            trailMask,
                            {x: Math.round(nextX), y: Math.round(nextY)},
                            radius,
                            ignorePointsP1,
                            Math.max(CONFIG.TRAIL.extraIgnoreMarginPixels, CONFIG.GAPS.corridorExtraMarginPixels)
                        );

                        if (collides) {
                            playerOne.isAlive = false;
                        } else {
                            playerOne.positionPixels = {x: nextX, y: nextY};

                            if (!playerOne.gap.isActive) {
                                markVisitedCircle(trailMask, Math.round(nextX), Math.round(nextY), radius);
                                pushRecent(playerOne, {x: Math.round(nextX), y: Math.round(nextY)});
                            } else {
                                pushGapCorridor(playerOne, {x: Math.round(nextX), y: Math.round(nextY)});
                            }

                            playerOne.scoreSeconds += deltaTimeSeconds;
                        }
                    }
                }

                // Gracz 2
                if (playerTwo.isAlive) {
                    const a2 = advance(playerTwo.angleRadians);
                    const nextX = playerTwo.positionPixels.x + a2.dx;
                    const nextY = playerTwo.positionPixels.y + a2.dy;

                    if (hitsBorder(nextX, nextY, w, h, radius)) {
                        playerTwo.isAlive = false;
                    } else {
                        const ignorePointsP2 = playerTwo.recentPositions
                            .concat(playerTwo.gapCorridor)
                            .concat(playerOne.gapCorridor);

                        const collides = collidesWithTrailExcludingPoints(
                            trailMask,
                            {x: Math.round(nextX), y: Math.round(nextY)},
                            radius,
                            ignorePointsP2,
                            Math.max(CONFIG.TRAIL.extraIgnoreMarginPixels, CONFIG.GAPS.corridorExtraMarginPixels)
                        );

                        if (collides) {
                            playerTwo.isAlive = false;
                        } else {
                            playerTwo.positionPixels = {x: nextX, y: nextY};

                            if (!playerTwo.gap.isActive) {
                                markVisitedCircle(trailMask, Math.round(nextX), Math.round(nextY), radius);
                                pushRecent(playerTwo, {x: Math.round(nextX), y: Math.round(nextY)});
                            } else {
                                pushGapCorridor(playerTwo, {x: Math.round(nextX), y: Math.round(nextY)});
                            }

                            playerTwo.scoreSeconds += deltaTimeSeconds;
                        }
                    }
                }

                // Koniec rundy jeśli obaj martwi
                if (!playerOne.isAlive && !playerTwo.isAlive) {
                    isMoving = false;
                    hasRoundEnded = true;
                    setHud((h) => ({
                        ...h,
                        isRunning: false,
                        statusText: `Both crashed • Press R to restart`,
                    }));
                }
            }

            // Rysowanie głów (w gapie wycieramy poprzednią kropkę, więc ślad się nie tworzy)
            const radius = CONFIG.DOT.radiusPixels;
            drawHeadWithGap(canvasContext, playerOne, radius);
            drawHeadWithGap(canvasContext, playerTwo, radius);

            // HUD
            setHud((h) => ({
                playerOneScore: playerOne.scoreSeconds,
                playerTwoScore: playerTwo.scoreSeconds,
                statusText: h.statusText,
                isRunning: isMoving && !hasRoundEnded,
            }));

            animationFrameRef.current = requestAnimationFrame(step);
        };

        animationFrameRef.current = requestAnimationFrame(step);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
            window.removeEventListener("resize", resetRound);
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        };
    }, []);

    // Canvas + HUD
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
                    <span style={{color: CONFIG.COLORS.playerOneHex, fontWeight: 600}}>Player 1</span>{" "}
                    • <span>{hud.playerOneScore.toFixed(1)}s</span>
                </div>
                <div>
                    <span style={{color: CONFIG.COLORS.playerTwoHex, fontWeight: 600}}>Player 2</span>{" "}
                    • <span>{hud.playerTwoScore.toFixed(1)}s</span>
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
                    <div>Controls: P1 A/D • P2 J/K • SPACE start/pause • R restart</div>
                )}
            </div>
        </>
    );
}
