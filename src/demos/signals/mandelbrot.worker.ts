import { renderRows, type EscapeView } from '../../core/fractals/escape';

/** A horizontal band of one image to compute. */
export interface BandRequest {
  job: number;
  view: EscapeView;
  y0: number;
  y1: number;
}

export interface BandResult {
  job: number;
  y0: number;
  y1: number;
  /** Escape times, row-major, for rows y0..y1-1. */
  data: Float32Array;
}

self.onmessage = (event: MessageEvent<BandRequest>) => {
  const { job, view, y0, y1 } = event.data;
  const data = new Float32Array(view.width * (y1 - y0));
  renderRows(view, y0, y1, data);
  const result: BandResult = { job, y0, y1, data };
  self.postMessage(result, { transfer: [data.buffer] });
};
