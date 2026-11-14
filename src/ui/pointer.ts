import type { Point } from '../core/point';

export interface DragHandlers {
  /** Pointer pressed. Return false to ignore this press. */
  down?(point: Point, event: PointerEvent): boolean | undefined;
  /** Pointer moved while pressed. */
  move?(point: Point, event: PointerEvent): void;
  up?(point: Point, event: PointerEvent): void;
  /** Pointer moved while not pressed (mouse only). */
  hover?(point: Point, event: PointerEvent): void;
}

/** Position of a pointer event in the canvas's CSS pixels. */
export function canvasPoint(canvas: HTMLCanvasElement, event: PointerEvent | MouseEvent): Point {
  const box = canvas.getBoundingClientRect();
  return { x: event.clientX - box.left, y: event.clientY - box.top };
}

/**
 * Mouse, pen and touch dragging on a canvas, in CSS pixels. Marks the canvas as
 * interactive so a finger drags the demo instead of scrolling the page.
 * Returns a function that removes the listeners.
 */
export function onDrag(canvas: HTMLCanvasElement, handlers: DragHandlers): () => void {
  let active = false;
  canvas.classList.add('interactive');

  const down = (event: PointerEvent) => {
    if (!event.isPrimary || event.button > 0) return;
    if (handlers.down?.(canvasPoint(canvas, event), event) === false) return;
    active = true;
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const move = (event: PointerEvent) => {
    if (active) handlers.move?.(canvasPoint(canvas, event), event);
    else handlers.hover?.(canvasPoint(canvas, event), event);
  };
  const up = (event: PointerEvent) => {
    if (!active) return;
    active = false;
    handlers.up?.(canvasPoint(canvas, event), event);
  };

  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  return () => {
    canvas.classList.remove('interactive');
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', up);
  };
}
