import { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';

/**
 * Onda da gravação, como num osciloscópio. Com o microfone (modo servidor), mostra o som de
 * verdade pelo AnalyserNode; sem ele (ditado do navegador) ou se o áudio não liga, uma onda
 * sintética que só indica que está ouvindo.
 */
export function Waveform({
  stream,
  className,
}: {
  stream: MediaStream | null;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext('2d');
    if (!element || !context) return;

    let audio: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    if (stream && typeof AudioContext !== 'undefined') {
      try {
        audio = new AudioContext();
        analyser = audio.createAnalyser();
        analyser.fftSize = 1024;
        audio.createMediaStreamSource(stream).connect(analyser);
        void audio.resume().catch(() => undefined);
      } catch {
        analyser = null;
      }
    }
    const samples = new Uint8Array(analyser?.fftSize ?? 0);
    // A cor vem do `text-tint` do próprio canvas.
    const color = getComputedStyle(element).color;
    const grid =
      getComputedStyle(element).getPropertyValue('--separator') || 'rgb(128 128 128 / .2)';

    let frame = 0;
    const draw = (now: number) => {
      const ratio = window.devicePixelRatio || 1;
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (element.width !== width * ratio || element.height !== height * ratio) {
        element.width = width * ratio;
        element.height = height * ratio;
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      // Grade fina, como a tela de um instrumento.
      context.strokeStyle = grid;
      context.lineWidth = 0.5;
      context.beginPath();
      for (let x = 24; x < width; x += 24) {
        context.moveTo(x, 0);
        context.lineTo(x, height);
      }
      for (let y = height / 4; y < height; y += height / 4) {
        context.moveTo(0, y);
        context.lineTo(width, y);
      }
      context.stroke();

      const mid = height / 2;
      const live = analyser && audio?.state === 'running';
      if (live) analyser!.getByteTimeDomainData(samples);

      const line = (amplitude: number, phase: number, alpha: number, lineWidth: number) => {
        context.globalAlpha = alpha;
        context.strokeStyle = color;
        context.lineWidth = lineWidth;
        context.shadowColor = color;
        context.shadowBlur = lineWidth > 1.5 ? 6 : 0;
        context.beginPath();
        for (let x = 0; x <= width; x += 2) {
          const t = x / width;
          let y: number;
          if (live) {
            const sample = samples[Math.floor(t * (samples.length - 1))] / 128 - 1;
            y = mid + sample * mid * 0.95 * amplitude;
          } else {
            const envelope = Math.sin(t * Math.PI) * (0.55 + 0.45 * Math.sin(now / 420 + t * 6));
            y = mid + Math.sin(t * 38 + now / 140 + phase) * mid * 0.6 * envelope * amplitude;
          }
          if (x === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();
      };
      if (!live) line(0.45, 1.7, 0.35, 1);
      line(1, 0, 1, 2);
      context.globalAlpha = 1;
      context.shadowBlur = 0;

      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      void audio?.close().catch(() => undefined);
    };
  }, [stream]);

  return (
    <canvas
      ref={canvas}
      aria-hidden
      className={cn('bg-background text-tint block rounded-[12px]', className)}
    />
  );
}
