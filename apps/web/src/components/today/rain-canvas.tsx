import { useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';

import type { RainIntensity } from './sky';

// Chuva desenhada gota a gota num canvas. Cada gota nasce num lugar e numa velocidade sorteados e
// renasce sorteada de novo ao sair da tela, então nada se repete. Três camadas de profundidade
// (longe: curtas, finas, lentas e apagadas; perto: longas e claras), vento que muda devagar, gotas
// paradas no "vidro" na tela cheia e relâmpagos na tempestade.

interface Profile {
  /** Gotas por 10.000 px². */
  density: number;
  /** Velocidade em px/s da camada de perto; as de trás são mais lentas. */
  speed: [number, number];
  /** Rastro (o "borrão" da gota caindo) em segundos de queda. */
  streak: number;
  alpha: number;
  /** Inclinação média do vento, em graus. */
  wind: number;
  glass: number;
  lightning: boolean;
}

const PROFILES: Record<RainIntensity, Profile> = {
  drizzle: {
    density: 6,
    speed: [380, 520],
    streak: 0.03,
    alpha: 0.55,
    wind: 6,
    glass: 6,
    lightning: false,
  },
  rain: {
    density: 4.2,
    speed: [900, 1250],
    streak: 0.045,
    alpha: 0.62,
    wind: 9,
    glass: 10,
    lightning: false,
  },
  heavy: {
    density: 6,
    speed: [1100, 1500],
    streak: 0.042,
    alpha: 0.6,
    wind: 13,
    glass: 16,
    lightning: false,
  },
  storm: {
    density: 6.5,
    speed: [1150, 1600],
    streak: 0.036,
    alpha: 0.58,
    wind: 17,
    glass: 16,
    lightning: true,
  },
};

const LAYERS = [
  { share: 0.45, speed: 0.55, width: 0.6, alpha: 0.4, length: 0.55 },
  { share: 0.35, speed: 0.78, width: 0.9, alpha: 0.7, length: 0.8 },
  { share: 0.2, speed: 1, width: 1.3, alpha: 1, length: 1 },
];

interface Drop {
  x: number;
  y: number;
  layer: number;
  speed: number;
  /** Desvio próprio do vento, em radianos. */
  tilt: number;
  length: number;
}

interface Bead {
  x: number;
  y: number;
  r: number;
  /** Velocidade de escorrer (px/s); a maioria fica parada. */
  slide: number;
  life: number;
  age: number;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const DEG = Math.PI / 180;

export function RainCanvas({
  intensity,
  glass = false,
  className,
}: {
  intensity: RainIntensity;
  /** Gotas paradas no vidro (só na tela cheia). */
  glass?: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !parent || !ctx) return;

    const profile = PROFILES[intensity];
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let width = 0;
    let height = 0;
    let drops: Drop[] = [];
    let beads: Bead[] = [];
    let frame = 0;
    let last = 0;
    let time = rand(0, 100);
    let visible = true;
    let flash = 0;
    let nextFlash = rand(3, 9);

    const spawnDrop = (anywhere: boolean): Drop => {
      const r = Math.random();
      const layer = r < LAYERS[0].share ? 0 : r < LAYERS[0].share + LAYERS[1].share ? 1 : 2;
      const speed = rand(...profile.speed) * LAYERS[layer].speed;
      const length = speed * profile.streak * LAYERS[layer].length * rand(0.8, 1.25);
      // O vento empurra para a esquerda: nasce um pouco além da borda direita para cobrir tudo.
      const drift = Math.tan((profile.wind + 6) * DEG) * height;
      return {
        x: rand(-20, width + drift),
        y: anywhere ? rand(-length, height) : rand(-height * 0.25, -length),
        layer,
        speed,
        tilt: rand(-2, 2) * DEG,
        length,
      };
    };

    const spawnBead = (): Bead => ({
      x: rand(0, width),
      y: rand(0, height),
      r: Math.random() < 0.8 ? rand(1.2, 2.6) : rand(2.6, 4.2),
      slide: Math.random() < 0.25 ? rand(8, 40) : 0,
      life: rand(4, 14),
      age: 0,
    });

    function resize() {
      const rect = parent!.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.min(420, Math.round(((width * height) / 10_000) * profile.density));
      drops = Array.from({ length: count }, () => spawnDrop(true));
      beads = glass ? Array.from({ length: profile.glass }, spawnBead) : [];
    }

    /** Vento com rajadas: soma de senos de períodos sem múltiplo comum, então não "volta". */
    const windAngle = () =>
      (profile.wind + Math.sin(time * 0.37) * 3 + Math.sin(time * 0.113 + 1.7) * 2.2) * DEG;

    function step(dt: number) {
      time += dt;
      const wind = windAngle();
      for (let i = 0; i < drops.length; i++) {
        const drop = drops[i];
        const angle = wind + drop.tilt;
        drop.y += drop.speed * dt;
        drop.x -= Math.tan(angle) * drop.speed * dt;
        if (drop.y - drop.length > height || drop.x < -40) drops[i] = spawnDrop(false);
      }
      for (let i = 0; i < beads.length; i++) {
        const bead = beads[i];
        bead.age += dt;
        bead.y += bead.slide * dt;
        if (bead.age > bead.life || bead.y > height + 8) beads[i] = spawnBead();
      }
      if (profile.lightning) {
        nextFlash -= dt;
        if (nextFlash <= 0) {
          flash = 1;
          nextFlash = rand(5, 14);
        }
        flash = Math.max(0, flash - dt * 3.2);
      }
    }

    function draw() {
      ctx!.clearRect(0, 0, width, height);
      const wind = windAngle();

      // Uma passada por camada: o rastro mais apagado e a "cabeça" da gota mais clara.
      LAYERS.forEach((layer, index) => {
        const alpha = profile.alpha * layer.alpha;
        ctx!.lineWidth = layer.width;
        ctx!.lineCap = 'round';
        for (const [from, to, a] of [
          [1, 0.45, alpha * 0.35],
          [0.45, 0, alpha],
        ] as const) {
          ctx!.strokeStyle = `rgba(235, 242, 255, ${a})`;
          ctx!.beginPath();
          for (const drop of drops) {
            if (drop.layer !== index) continue;
            const dx = Math.tan(wind + drop.tilt) * drop.length;
            ctx!.moveTo(drop.x + dx * from, drop.y - drop.length * from);
            ctx!.lineTo(drop.x + dx * to, drop.y - drop.length * to);
          }
          ctx!.stroke();
        }
      });

      // Gotas no vidro: um ponto claro com borda escura, como uma lente pequena.
      for (const bead of beads) {
        const fade = Math.min(1, bead.age / 0.6, (bead.life - bead.age) / 1.2);
        if (fade <= 0) continue;
        const gradient = ctx!.createRadialGradient(
          bead.x - bead.r * 0.35,
          bead.y - bead.r * 0.4,
          0,
          bead.x,
          bead.y,
          bead.r
        );
        gradient.addColorStop(0, `rgba(255, 255, 255, ${0.55 * fade})`);
        gradient.addColorStop(0.55, `rgba(255, 255, 255, ${0.12 * fade})`);
        gradient.addColorStop(1, `rgba(0, 10, 30, ${0.22 * fade})`);
        ctx!.fillStyle = gradient;
        ctx!.beginPath();
        ctx!.arc(bead.x, bead.y, bead.r, 0, Math.PI * 2);
        ctx!.fill();
      }

      // Relâmpago: dois clarões rápidos, o segundo mais fraco.
      if (flash > 0) {
        const pulse = flash > 0.6 ? flash : flash * (0.6 + 0.4 * Math.sin(flash * 40));
        ctx!.fillStyle = `rgba(225, 230, 255, ${0.32 * pulse})`;
        ctx!.fillRect(0, 0, width, height);
      }
    }

    function loop(now: number) {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      step(dt);
      draw();
      frame = requestAnimationFrame(loop);
    }

    function start() {
      if (frame || reduced || !visible || document.hidden) return;
      last = 0;
      frame = requestAnimationFrame(loop);
    }

    function stop() {
      cancelAnimationFrame(frame);
      frame = 0;
    }

    resize();
    draw();

    const resizeObserver = new ResizeObserver(() => {
      resize();
      draw();
    });
    resizeObserver.observe(parent);

    // Fora da tela ou com o app em segundo plano, a chuva para (e não gasta bateria).
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start();
      else stop();
    });
    intersection.observe(canvas);
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVisibility);
    start();

    return () => {
      stop();
      resizeObserver.disconnect();
      intersection.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intensity, glass]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={cn('pointer-events-none absolute inset-0 size-full', className)}
    />
  );
}
