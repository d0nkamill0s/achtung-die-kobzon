// Moving.tsx
import React, {useEffect, useRef} from "react";

const CONFIG = {
    COLORS: {
        backgroundHex: "#0b1020",
        dotHex: "#66e3ff",
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
        turnLeftKey: "a",
        turnRightKey: "d",
        restartKey: "r",
    },
    TRAIL: {
        recentIgnoreFrameCount: 10,
        extraIgnoreMarginPixels: 0.75,
    },
} as const;

type Vector2D = { x: number; y: number };
type TrailMask = { widthPixels: number; heightPixels: number; occupancy: Uint8Array };

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
        const deltaY = pixelY - centerX;
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
            if (distanceSquared > radiusSquared) continue;

            if (trailMask.occupancy[rowOffset + pixelX] === 1) {
                let belongsToRecent = false;
                for (let i = 0; i < recentPositions.length; i++) {
                    const recentPoint = recentPositions[i];
                    const deltaRecentX = pixelX - recentPoint.x;
                    const deltaRecentY = pixelY - recentPoint.y;
                    const distanceToRecentSquared =
                        deltaRecentX * deltaRecentX + deltaRecentY * deltaRecentY;
                    if (distanceToRecentSquared <= ignoreRadiusSquared) {
                        belongsToRecent = true;
                        break;
                    }
                }
                if (!belongsToRecent) return true;
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

export default function Moving() {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const animationFrameRef = useRef<number | null>(null);

    useEffect(() => {
        const canvasElement = canvasRef.current;
        if (!canvasElement) return;
        const canvasContext = canvasElement.getContext("2d");
        if (!canvasContext) return;

        let isMoving = false;
        let headingAngleRadians = 0;
        let trailMask = createTrailMask(1, 1);
        const recentPositions: Vector2D[] = [];
        const pushRecentPosition = (point: Vector2D) => {
            recentPositions.push(point);
            const maxRecent = CONFIG.TRAIL.recentIgnoreFrameCount;
            if (recentPositions.length > maxRecent) recentPositions.shift();
        };

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

            canvasContext.setTransform(devicePixelRatioSafe, 0, 0, devicePixelRatioSafe, 0, 0);

            paintBackground(widthCssPixels, heightCssPixels);
            trailMask = createTrailMask(widthCssPixels, heightCssPixels);

            // 🔹 losowa pozycja startowa w obrębie ekranu
            const radius = CONFIG.DOT.radiusPixels;
            positionPixels = {
                x: radius + Math.random() * (widthCssPixels - 2 * radius),
                y: radius + Math.random() * (heightCssPixels - 2 * radius),
            };

            // narysuj kropkę startową
            drawDot(canvasContext, positionPixels, CONFIG.DOT.radiusPixels, CONFIG.COLORS.dotHex);
            markVisitedCircle(
                trailMask,
                Math.round(positionPixels.x),
                Math.round(positionPixels.y),
                CONFIG.DOT.radiusPixels
            );
            pushRecentPosition({x: Math.round(positionPixels.x), y: Math.round(positionPixels.y)});
        };

        // 🔹 pozycja startowa (ustawiana w setCanvasSizeForHiDPI)
        let positionPixels: Vector2D = {x: 0, y: 0};

        setCanvasSizeForHiDPI();
        window.addEventListener("resize", setCanvasSizeForHiDPI);
        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);

        let lastTimestampMs = performance.now();
        const step = (nowMs: number) => {
            const deltaTimeSeconds = (nowMs - lastTimestampMs) / 1000;
            lastTimestampMs = nowMs;

            if (pressedKeys.has(CONFIG.INPUT.turnLeftKey)) {
                headingAngleRadians -= CONFIG.PHYSICS.turnSpeedRadiansPerSecond * deltaTimeSeconds;
            }
            if (pressedKeys.has(CONFIG.INPUT.turnRightKey)) {
                headingAngleRadians += CONFIG.PHYSICS.turnSpeedRadiansPerSecond * deltaTimeSeconds;
            }

            if (isMoving) {
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

                const widthCssPixels = canvasElement.clientWidth;
                const heightCssPixels = canvasElement.clientHeight;
                const dotRadius = CONFIG.DOT.radiusPixels;

                nextX = Math.max(dotRadius, Math.min(widthCssPixels - dotRadius, nextX));
                nextY = Math.max(dotRadius, Math.min(heightCssPixels - dotRadius, nextY));

                const collides = collidesWithTrailExcludingRecent(
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
                    isMoving = false;
                }
            }

            drawDot(canvasContext, positionPixels, CONFIG.DOT.radiusPixels, CONFIG.COLORS.dotHex);
            animationFrameRef.current = requestAnimationFrame(step);
        };

        animationFrameRef.current = requestAnimationFrame(step);

        return () => {
            window.removeEventListener("resize", setCanvasSizeForHiDPI);
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        };
    }, []);

    return <canvas ref={canvasRef} style={{position: "fixed", inset: 0}}/>;
}
