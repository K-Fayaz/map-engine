import { useEffect, useRef } from "react";

// Draws a fixed peaks array (see audioStore.ts's computePeaks) as vertical
// bars across the full canvas width, plus a thin playhead line at whatever
// fraction of the clip is currently playing. A plain <canvas>, not SVG/DOM
// bars -- PEAK_COUNT (800) bars redrawn on every playhead tick would be a
// lot of DOM churn for what's just pixels.
interface AudioWaveformProps {
  peaks: number[];
  width: number;
  height: number;
  playheadFraction: number | null;
}

const BAR_COLOR = "#5b8def";
const PLAYHEAD_COLOR = "#f2f4ff";

export function AudioWaveform({ peaks, width, height, playheadFraction }: AudioWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    const barWidth = width / peaks.length;
    const midY = height / 2;
    ctx.fillStyle = BAR_COLOR;
    for (let i = 0; i < peaks.length; i++) {
      const barHeight = Math.max(1, peaks[i] * height);
      ctx.fillRect(i * barWidth, midY - barHeight / 2, Math.max(1, barWidth - 0.5), barHeight);
    }

    if (playheadFraction !== null) {
      const x = playheadFraction * width;
      ctx.fillStyle = PLAYHEAD_COLOR;
      ctx.fillRect(x, 0, 1.5, height);
    }
  }, [peaks, width, height, playheadFraction]);

  return <canvas ref={canvasRef} width={width} height={height} className="audio-waveform-canvas" />;
}
