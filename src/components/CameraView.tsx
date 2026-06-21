import type { RefObject } from "react";
import type { TrackingStatus } from "../hooks/useHandTracking";

interface Props {
  videoRef: RefObject<HTMLVideoElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
  status: TrackingStatus;
  error: string | null;
}

export function CameraView({ videoRef, canvasRef, status, error }: Props) {
  return (
    <div className="camera-view">
      {/* Mirrored for a natural "looking in a mirror" feel. */}
      <video ref={videoRef} className="mirror" playsInline muted />
      <canvas ref={canvasRef} className="mirror overlay" />
      {status !== "running" && (
        <div className="camera-status">
          {status === "loading" && "Loading camera & hand model…"}
          {status === "idle" && "Press Start to enable the camera."}
          {status === "error" && `Camera error: ${error}`}
        </div>
      )}
      <div className="legend">
        <span className="legend-right">● right hand</span>
        <span className="legend-left">● left hand</span>
      </div>
    </div>
  );
}
