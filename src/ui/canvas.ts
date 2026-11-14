export interface Stage {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Size in CSS pixels. Drawing code works in these units. */
  width: number;
  height: number;
  dispose(): void;
}

/**
 * Keeps a canvas's backing store matched to its CSS size and the device pixel
 * ratio, and scales the context so drawing code can use CSS pixels.
 * `onResize` runs after every later size change, with the previous size.
 */
export function createStage(
  canvas: HTMLCanvasElement,
  onResize: (previousWidth: number, previousHeight: number) => void,
): Stage {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');

  const stage: Stage = { canvas, ctx, width: 0, height: 0, dispose: () => observer.disconnect() };

  // `exact` is the canvas size in device pixels when the browser reports it. Using it
  // keeps one backing pixel per screen pixel even when the CSS size is fractional.
  const resize = (notify: boolean, exact?: ResizeObserverSize) => {
    const width = Math.max(1, Math.round(canvas.clientWidth));
    const height = Math.max(1, Math.round(canvas.clientHeight));
    const ratio = window.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, exact?.inlineSize ?? Math.round(width * ratio));
    const pixelHeight = Math.max(1, exact?.blockSize ?? Math.round(height * ratio));
    if (canvas.width === pixelWidth && canvas.height === pixelHeight && stage.width === width) {
      return;
    }
    const previous = [stage.width, stage.height] as const;
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    ctx.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0);
    stage.width = width;
    stage.height = height;
    if (notify) onResize(previous[0], previous[1]);
  };

  const observer = new ResizeObserver((entries) =>
    resize(true, entries.at(-1)?.devicePixelContentBoxSize?.[0]),
  );
  try {
    observer.observe(canvas, { box: 'device-pixel-content-box' });
  } catch {
    observer.observe(canvas); // Safari: no device-pixel box, CSS size times the ratio is used
  }
  // Size once up front, silently: the caller is still being constructed.
  resize(false);
  return stage;
}

export interface Loop {
  start(): void;
  stop(): void;
  readonly running: boolean;
}

/** A requestAnimationFrame loop. `frame` receives the elapsed seconds, capped to avoid jumps. */
export function createLoop(frame: (dt: number) => void): Loop {
  let handle = 0;
  let last = 0;
  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    handle = requestAnimationFrame(tick);
    frame(dt);
  };
  return {
    start() {
      if (handle) return;
      last = performance.now();
      handle = requestAnimationFrame(tick);
    },
    stop() {
      cancelAnimationFrame(handle);
      handle = 0;
    },
    get running() {
      return handle !== 0;
    },
  };
}
