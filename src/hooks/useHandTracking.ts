// Owns the webcam stream + the MediaPipe detection loop, draws a landmark
// overlay, and reports the per-frame hand poses through a callback.

import { useEffect, useRef, useState } from "react";
import { getHandLandmarker } from "../lib/handLandmarker";
import { normalizePose } from "../lib/handShape";
import type { HandPose, Handedness } from "../types";

export type TrackingStatus = "idle" | "loading" | "running" | "error";

// Minimal hand skeleton connections for the overlay.
const CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], // thumb
  [0, 5], [5, 6], [6, 7], [7, 8], // index
  [5, 9], [9, 10], [10, 11], [11, 12], // middle
  [9, 13], [13, 14], [14, 15], [15, 16], // ring
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17], // pinky + palm
];

/** Andrew's monotone-chain convex hull, returns boundary points in order. */
function convexHull(pts: Array<{ x: number; y: number }>) {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: typeof p[0], a: typeof p[0], b: typeof p[0]) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: typeof p = [];
  for (const pt of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0)
      lower.pop();
    lower.push(pt);
  }
  const upper: typeof p = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const pt = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0)
      upper.pop();
    upper.push(pt);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

interface Options {
  videoRef: React.RefObject<HTMLVideoElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  enabled: boolean;
  onPoses: (poses: HandPose[]) => void;
}

export function useHandTracking({
  videoRef,
  canvasRef,
  enabled,
  onPoses,
}: Options): { status: TrackingStatus; error: string | null } {
  const [status, setStatus] = useState<TrackingStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const onPosesRef = useRef(onPoses);
  onPosesRef.current = onPoses;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let raf = 0;
    let lastTs = -1;

    const draw = (poses: HandPose[]) => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video) return;
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const pose of poses) {
        const color = pose.handedness === "Right" ? "#4ade80" : "#60a5fa";

        // Hand outline: a translucent hull around the landmarks.
        const hull = convexHull(
          pose.landmarks.map((p) => ({
            x: p.x * canvas.width,
            y: p.y * canvas.height,
          })),
        );
        if (hull.length >= 3) {
          ctx.beginPath();
          ctx.moveTo(hull[0].x, hull[0].y);
          for (const h of hull.slice(1)) ctx.lineTo(h.x, h.y);
          ctx.closePath();
          ctx.fillStyle = `${color}22`;
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.fill();
          ctx.stroke();
        }

        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 3;
        for (const [a, b] of CONNECTIONS) {
          ctx.beginPath();
          ctx.moveTo(pose.landmarks[a].x * canvas.width, pose.landmarks[a].y * canvas.height);
          ctx.lineTo(pose.landmarks[b].x * canvas.width, pose.landmarks[b].y * canvas.height);
          ctx.stroke();
        }
        for (const p of pose.landmarks) {
          ctx.beginPath();
          ctx.arc(p.x * canvas.width, p.y * canvas.height, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    const loop = () => {
      if (cancelled) return;
      const video = videoRef.current;
      const landmarker = landmarkerRef.current;
      if (video && landmarker && video.readyState >= 2) {
        const ts = performance.now();
        if (ts !== lastTs) {
          lastTs = ts;
          const result = landmarker.detectForVideo(video, ts);
          const poses: HandPose[] = result.landmarks.map((lm, i) => {
            const handedness = (result.handednesses[i]?.[0]?.categoryName ??
              "Right") as Handedness;
            return {
              handedness,
              pose: normalizePose(lm, handedness),
              landmarks: lm,
            };
          });
          draw(poses);
          onPosesRef.current(poses);
        }
      }
      raf = requestAnimationFrame(loop);
    };

    const landmarkerRef = { current: null as Awaited<
      ReturnType<typeof getHandLandmarker>
    > | null };

    (async () => {
      try {
        setStatus("loading");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: "user" },
          audio: false,
        });
        if (cancelled) return;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        landmarkerRef.current = await getHandLandmarker();
        if (cancelled) return;
        setStatus("running");
        raf = requestAnimationFrame(loop);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return { status, error };
}
