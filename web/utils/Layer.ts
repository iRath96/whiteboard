import { Point, vec2 } from '@core/geometry';
import { Interpolator } from '@core/pipes';
import { DEBUG_STROKES, STROKE_QUALITY } from './constants';
import { Stroke } from './strokes';


/**
 * Used by Intermediate and Tile to draw strokes.
 * This class performs all the dirty work of drawing a stroke,
 * but not interpolating it.
 */
export default class Layer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;

  protected listener = null;

  constructor(
    className: string = '',
    size?: vec2
  ) {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');

    this.canvas.className = className;

    document.body.appendChild(this.canvas);

    if (!size) {
      // full-screen

      this.listener = () => this.resize();
      window.addEventListener('resize', this.listener);
    }

    this.resize(size);
  }

  destroy() {
    document.body.removeChild(this.canvas);

    if (this.listener)
      window.removeEventListener('resize', this.listener);
  }

  protected resize(size?: vec2) {
    // @todo redraw stuff

    const sizeFQ = size || [
      this.canvas.offsetWidth,
      this.canvas.offsetHeight
    ];

    const scale = window.devicePixelRatio || 1;

    this.canvas.width = sizeFQ[0] * scale;
    this.canvas.height = sizeFQ[1] * scale;

    if (size) {
      this.canvas.style.width = `${size[0]}px`;
      this.canvas.style.height = `${size[1]}px`;
    }
    
    this.ctx.resetTransform();
    this.ctx.scale(scale, scale);
  }

  drawPoints(points: Point[], color: string, previous?: Point) {
    if (points.length === 0)
      return;
    
    let lastPoint = previous ? previous : points[0];
    points.forEach(point => {
      this.ctx.beginPath();
      this.ctx.lineWidth = Math.max(point.pressure, 0.1);
      this.ctx.strokeStyle = color;
      this.ctx.lineCap = 'round';

      const p = lastPoint.position;
      const q = point.position;

      this.ctx.moveTo(p[0], p[1]);
      this.ctx.lineTo(q[0], q[1]);

      this.ctx.stroke();
      this.ctx.closePath();

      lastPoint = point;
    });

    if (DEBUG_STROKES) {
      this.ctx.lineWidth = 1;
      this.ctx.strokeStyle = 'red';
      points.forEach(point => {
        const p = point.position;

        this.ctx.beginPath();

        this.ctx.moveTo(p[0] - 2, p[1] - 2);
        this.ctx.lineTo(p[0] + 2, p[1] + 2);
        this.ctx.moveTo(p[0] + 2, p[1] - 2);
        this.ctx.lineTo(p[0] - 2, p[1] + 2);
        this.ctx.stroke();

        this.ctx.closePath();
      });
    }
  };

  drawStroke(stroke: Stroke) {
    const interpolator = new Interpolator();
    interpolator.c = 0.0;
    interpolator.quality = STROKE_QUALITY; // @todo not elegant, not DRY with Intermediate

    this.drawPoints(interpolator.process(stroke.points), stroke.color);
  }
}
