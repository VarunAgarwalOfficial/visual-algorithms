/**
 * The font families for text drawn on a canvas. They match --font and --mono in
 * style.css; the files are bundled in src/fonts so every machine draws the same.
 */
export const FONT = "'IBM Plex Sans', system-ui, sans-serif";
export const MONO = "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace";

/** A line of help in the middle of an otherwise empty canvas. */
export function drawHint(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  colour: string,
  text: string,
): void {
  ctx.save();
  ctx.font = `14px ${FONT}`;
  ctx.fillStyle = colour;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, height / 2, width - 32);
  ctx.restore();
}
