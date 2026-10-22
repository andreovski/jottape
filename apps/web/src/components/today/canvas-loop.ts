/* eslint-disable no-param-reassign -- o laço ajusta o tamanho do canvas que recebe. */
// Laço comum das animações do céu: ajusta o canvas ao tamanho do pai (DPR até 2), anda quadro a
// quadro e pausa fora da tela ou com o app em segundo plano. Com "reduzir movimento", fica um
// quadro parado.

export interface Scene {
  /** Recebe o tamanho em px CSS; recria o que depende dele. */
  resize(width: number, height: number): void;
  step(dt: number): void;
  draw(ctx: CanvasRenderingContext2D): void;
}

export const rand = (min: number, max: number) => min + Math.random() * (max - min);

export function runScene(canvas: HTMLCanvasElement, scene: Scene): () => void {
  const parent = canvas.parentElement;
  const ctx = canvas.getContext('2d');
  if (!parent || !ctx) return () => {};

  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  let frame = 0;
  let last = 0;
  let visible = true;

  function resize() {
    const rect = parent!.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    scene.resize(rect.width, rect.height);
    scene.draw(ctx!);
  }

  function loop(now: number) {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
    last = now;
    scene.step(dt);
    scene.draw(ctx!);
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
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(parent);
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
}
