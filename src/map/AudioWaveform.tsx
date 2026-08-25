import { useEffect, useRef } from "react";

// Draws a fixed peaks array (see audioStore.ts's computePeaks) as vertical
// bars across the full canvas width. A plain <canvas>, not SVG/DOM bars --
// PEAK_COUNT (800) bars would be a lot of DOM churn for what's just pixels.
// The playhead itself is drawn once in Timeline.tsx, as a single line shared
// across the scene track and this waveform, not per-component here.
interface AudioWaveformProps {
  peaks: number[];
  width: number;
  height: number;
}

const BAR_COLOR = "#5b8def";

export function AudioWaveform({ peaks, width, height }: AudioWaveformProps) {
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
  }, [peaks, width, height]);

  return <canvas ref={canvasRef} width={width} height={height} className="audio-waveform-canvas" />;
}
