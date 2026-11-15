/**
 * The font families and sizes for text drawn on a canvas. They are the site's
 * tokens (--site-font-body, --site-font-mono, --site-step--1); the files are in
 * public/fonts so every machine draws the same. Newsreader's figures are
 * lining, so numbers on a canvas are set in it rather than in the mono face,
 * whose zero is slashed.
 */
export const FONT = "'Newsreader', 'CM Web Serif', Georgia, serif";
export const MONO = "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace";

/** The small text size (17px): no label in a picture is set smaller. */
export const SMALL = 17;

/** A label size: the size asked for, but never under the small text size. */
export const labelSize = (size: number): number => Math.max(SMALL, size);

/** A line of help in the middle of an otherwise empty canvas. */
export function drawHint(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  colour: string,
  text: string,
): void {
  ctx.save();
  ctx.font = `${SMALL}px ${FONT}`;
  ctx.fillStyle = colour;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, width / 2, height / 2, width - 32);
  ctx.restore();
}

/** Splits `text` into lines no wider than `width` in the context's current font. */
export function wrapLines(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
