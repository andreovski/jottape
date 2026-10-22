/* eslint-disable no-param-reassign -- desenhar no canvas é mudar o contexto recebido (cor, alpha). */
import { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';

import { rand, runScene, type Scene } from './canvas-loop';
import type { SkyKind } from './sky';

// Animações sutis dos céus sem chuva (a chuva é a rain-canvas.tsx). Tudo sorteado e com períodos
// sem múltiplo comum, para não se notar repetição:
// - noite limpa: estrelas piscando devagar e, de vez em quando, uma estrela cadente;
// - fim de tarde e amanhecer: luz do horizonte que respira e desliza; no fim de tarde, as
//   primeiras estrelas no alto;
// - dia limpo: raios de sol girando devagar e pontos de luz subindo;
// - nublado e neblina: nuvens (ou faixas de névoa) passando; à noite, poucas estrelas atrás;
// - neve: flocos caindo e balançando.

type Ambient = Exclude<SkyKind, 'rain-day' | 'rain-night' | 'storm'>;

interface Star {
  x: number;
  y: number;
  r: number;
  base: number;
  speed: number;
  phase: number;
}

interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  length: number;
  life: number;
  age: number;
}

interface Puff {
  x: number;
  y: number;
  /** Círculos da nuvem, relativos ao centro. */
  parts: { dx: number; dy: number; r: number }[];
  speed: number;
  alpha: number;
}

interface Flake {
  x: number;
  y: number;
  r: number;
  speed: number;
  sway: number;
  phase: number;
}

interface Mote {
  x: number;
  y: number;
  r: number;
  speed: number;
  phase: number;
}

/** Estrelas por 10.000 px² e até que altura (fração) elas vão. */
const STARS: Partial<Record<Ambient, { density: number; reach: number }>> = {
  'clear-night': { density: 3.4, reach: 1 },
  'cloudy-night': { density: 1, reach: 0.7 },
  dusk: { density: 1.4, reach: 0.4 },
};

const CLOUDS: Partial<Record<Ambient, { count: number; alpha: number; fog?: boolean }>> = {
  'cloudy-day': { count: 6, alpha: 0.16 },
  'cloudy-night': { count: 5, alpha: 0.08 },
  fog: { count: 7, alpha: 0.14, fog: true },
};

function sceneFor(kind: Ambient, big: boolean): Scene {
  let width = 0;
  let height = 0;
  let time = rand(0, 100);
  let stars: Star[] = [];
  let meteors: Meteor[] = [];
  let nextMeteor = rand(2, 6);
  let puffs: Puff[] = [];
  let flakes: Flake[] = [];
  let motes: Mote[] = [];
  const starCfg = STARS[kind];
  const cloudCfg = CLOUDS[kind];

  const spawnStar = (reach: number): Star => {
    const bright = Math.random() < 0.12;
    return {
      x: rand(0, width),
      // Mais estrelas no alto: o sorteio ao quadrado puxa para cima.
      y: Math.random() ** 1.6 * height * reach,
      r: bright ? rand(1.3, 2) : rand(0.6, 1.2),
      base: bright ? rand(0.85, 1) : rand(0.4, 0.75),
      speed: rand(0.4, 1.6),
      phase: rand(0, Math.PI * 2),
    };
  };

  const spawnMeteor = (): Meteor => {
    const angle = rand(18, 34) * (Math.PI / 180);
    const speed = rand(650, 950) * (big ? 1 : 0.6);
    const fromRight = Math.random() < 0.7;
    return {
      x: fromRight ? rand(width * 0.35, width * 1.05) : rand(-0.05 * width, width * 0.6),
      y: rand(-10, height * 0.3),
      vx: Math.cos(angle) * speed * (fromRight ? -1 : 1),
      vy: Math.sin(angle) * speed,
      length: rand(70, 140) * (big ? 1 : 0.6),
      life: rand(0.6, 1.1),
      age: 0,
    };
  };

  const spawnPuff = (anywhere: boolean): Puff => {
    const fog = cloudCfg?.fog;
    const size = fog ? rand(0.5, 0.9) * width : rand(0.18, 0.32) * Math.max(width, 260);
    const parts = fog
      ? [{ dx: 0, dy: 0, r: size }]
      : Array.from({ length: 5 }, (_, i) => ({
          dx: (i - 2) * size * 0.42 + rand(-8, 8),
          dy: -Math.sin((i / 4) * Math.PI) * size * 0.35 + rand(-6, 6),
          r: size * rand(0.38, 0.6),
        }));
    return {
      x: anywhere ? rand(-size, width + size) : -size * 1.6,
      y: fog ? rand(height * 0.35, height * 1.05) : rand(height * 0.05, height * 0.75),
      parts,
      speed: rand(5, 14) * (big ? 1 : 0.7),
      alpha: (cloudCfg?.alpha ?? 0.12) * rand(0.6, 1.2),
    };
  };

  const spawnFlake = (anywhere: boolean): Flake => {
    const r = rand(0.8, 2.6);
    return {
      x: rand(-10, width + 10),
      y: anywhere ? rand(-10, height) : rand(-40, -6),
      r,
      speed: 18 + r * 16,
      sway: rand(6, 18),
      phase: rand(0, Math.PI * 2),
    };
  };

  const spawnMote = (anywhere: boolean): Mote => ({
    x: rand(0, width),
    y: anywhere ? rand(0, height) : height + 10,
    r: rand(1.2, 3.2),
    speed: rand(4, 12),
    phase: rand(0, Math.PI * 2),
  });

  /** Luz do horizonte: fim de tarde quente embaixo; amanhecer dourado subindo. */
  function drawHorizon(ctx: CanvasRenderingContext2D) {
    const dusk = kind === 'dusk';
    const breathe = 0.5 + 0.3 * Math.sin(time * 0.21) + 0.2 * Math.sin(time * 0.083 + 1.3);
    const cx = width * (0.62 + 0.18 * Math.sin(time * 0.045));
    const cy = height * (dusk ? 1.02 : 0.98 - 0.04 * Math.sin(time * 0.06));
    const radius = Math.max(width, height) * (0.85 + 0.12 * breathe);
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    const [r, g, b] = dusk ? [255, 150, 90] : [255, 196, 120];
    glow.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${0.34 + 0.14 * breathe})`);
    glow.addColorStop(0.45, `rgba(${r}, ${g - 40}, ${b + 20}, ${0.12 + 0.06 * breathe})`);
    glow.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
    // Faixa fina e mais clara bem no horizonte, que desliza para o outro lado.
    const band = ctx.createLinearGradient(0, height * 0.7, 0, height);
    const shift = 0.5 + 0.5 * Math.sin(time * 0.07 + 2);
    band.addColorStop(0, 'rgba(255, 210, 160, 0)');
    band.addColorStop(1, `rgba(255, ${dusk ? 180 : 215}, 150, ${0.1 + 0.1 * shift})`);
    ctx.fillStyle = band;
    ctx.fillRect(0, height * 0.7, width, height * 0.3);
  }

  /** Raios de sol saindo do canto de cima, girando devagar. */
  function drawRays(ctx: CanvasRenderingContext2D) {
    const ox = width + 30;
    const oy = -40;
    const reach = Math.hypot(width, height) * 1.1;
    const turn = Math.sin(time * 0.05) * 0.12 + Math.sin(time * 0.017 + 0.7) * 0.06;
    for (let i = 0; i < 7; i++) {
      const center = Math.PI * 0.55 + i * 0.13 + turn;
      const spread = 0.025 + (i % 3) * 0.012;
      const alpha = 0.05 + 0.035 * Math.sin(time * (0.3 + i * 0.07) + i * 1.9);
      const gradient = ctx.createRadialGradient(ox, oy, 0, ox, oy, reach);
      gradient.addColorStop(0, `rgba(255, 245, 210, ${Math.max(0, alpha) * 1.6})`);
      gradient.addColorStop(1, 'rgba(255, 245, 210, 0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.arc(ox, oy, reach, center - spread, center + spread);
      ctx.closePath();
      ctx.fill();
    }
  }

  return {
    resize(w, h) {
      width = w;
      height = h;
      const area = (w * h) / 10_000;
      stars = starCfg
        ? Array.from({ length: Math.min(320, Math.round(area * starCfg.density)) }, () =>
            spawnStar(starCfg.reach)
          )
        : [];
      meteors = [];
      puffs = cloudCfg ? Array.from({ length: cloudCfg.count }, () => spawnPuff(true)) : [];
      flakes =
        kind === 'snow'
          ? Array.from({ length: Math.min(260, Math.round(area * 2.4)) }, () => spawnFlake(true))
          : [];
      motes =
        kind === 'clear-day'
          ? Array.from({ length: Math.max(6, Math.round(area * 0.35)) }, () => spawnMote(true))
          : [];
    },

    step(dt) {
      time += dt;
      if (kind === 'clear-night') {
        nextMeteor -= dt;
        if (nextMeteor <= 0) {
          meteors.push(spawnMeteor());
          nextMeteor = rand(5, 12);
        }
      }
      meteors = meteors.filter((meteor) => {
        meteor.age += dt;
        meteor.x += meteor.vx * dt;
        meteor.y += meteor.vy * dt;
        return meteor.age < meteor.life;
      });
      for (let i = 0; i < puffs.length; i++) {
        const puff = puffs[i];
        puff.x += puff.speed * dt;
        const reach = Math.max(...puff.parts.map((part) => part.dx + part.r));
        if (puff.x - reach > width) puffs[i] = spawnPuff(false);
      }
      for (let i = 0; i < flakes.length; i++) {
        const flake = flakes[i];
        flake.y += flake.speed * dt;
        flake.x += Math.sin(time * 0.8 + flake.phase) * flake.sway * dt - 6 * dt;
        if (flake.y > height + 6 || flake.x < -12) flakes[i] = spawnFlake(false);
      }
      for (let i = 0; i < motes.length; i++) {
        const mote = motes[i];
        mote.y -= mote.speed * dt;
        mote.x += Math.sin(time * 0.4 + mote.phase) * 4 * dt;
        if (mote.y < -10) motes[i] = spawnMote(false);
      }
    },

    draw(ctx) {
      ctx.clearRect(0, 0, width, height);
      if (kind === 'dusk' || kind === 'dawn') drawHorizon(ctx);
      if (kind === 'clear-day') drawRays(ctx);

      for (const star of stars) {
        const twinkle = 0.55 + 0.45 * Math.sin(time * star.speed + star.phase);
        // No fim de tarde as estrelas somem perto do horizonte.
        const fade = kind === 'dusk' ? Math.max(0, 1 - star.y / (height * 0.4)) : 1;
        ctx.globalAlpha = star.base * twinkle * fade;
        ctx.fillStyle = '#F4F6FF';
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      for (const meteor of meteors) {
        const t = meteor.age / meteor.life;
        const alpha = Math.sin(Math.PI * t) * 0.9;
        const speed = Math.hypot(meteor.vx, meteor.vy);
        const tailX = meteor.x - (meteor.vx / speed) * meteor.length;
        const tailY = meteor.y - (meteor.vy / speed) * meteor.length;
        const trail = ctx.createLinearGradient(meteor.x, meteor.y, tailX, tailY);
        trail.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
        trail.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.strokeStyle = trail;
        ctx.lineWidth = 1.4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(meteor.x, meteor.y);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();
      }

      for (const puff of puffs) {
        for (const part of puff.parts) {
          const x = puff.x + part.dx;
          const y = puff.y + part.dy;
          const gradient = ctx.createRadialGradient(x, y, 0, x, y, part.r);
          gradient.addColorStop(0, `rgba(255, 255, 255, ${puff.alpha})`);
          gradient.addColorStop(0.6, `rgba(255, 255, 255, ${puff.alpha * 0.5})`);
          gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
          ctx.fillStyle = gradient;
          if (cloudCfg?.fog) {
            // Névoa: a mesma mancha achatada numa faixa larga.
            ctx.save();
            ctx.translate(x, y);
            ctx.scale(1.6, 0.35);
            ctx.translate(-x, -y);
            ctx.fillRect(x - part.r, y - part.r, part.r * 2, part.r * 2);
            ctx.restore();
          } else {
            ctx.fillRect(x - part.r, y - part.r, part.r * 2, part.r * 2);
          }
        }
      }

      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      for (const flake of flakes) {
        ctx.globalAlpha = 0.35 + flake.r / 4;
        ctx.beginPath();
        ctx.arc(flake.x, flake.y, flake.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      for (const mote of motes) {
        const alpha = 0.12 + 0.1 * Math.sin(time * 0.9 + mote.phase);
        const gradient = ctx.createRadialGradient(mote.x, mote.y, 0, mote.x, mote.y, mote.r * 2);
        gradient.addColorStop(0, `rgba(255, 250, 225, ${alpha})`);
        gradient.addColorStop(1, 'rgba(255, 250, 225, 0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(mote.x - mote.r * 2, mote.y - mote.r * 2, mote.r * 4, mote.r * 4);
      }
    },
  };
}

export function AmbientCanvas({
  kind,
  big = false,
  className,
}: {
  kind: Ambient;
  /** Tela cheia: estrelas cadentes maiores e mais rápidas. */
  big?: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return runScene(canvas, sceneFor(kind, big));
  }, [kind, big]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 size-full', className)}
    />
  );
}

export function isAmbient(kind: SkyKind): kind is Ambient {
  return kind !== 'rain-day' && kind !== 'rain-night' && kind !== 'storm';
}
