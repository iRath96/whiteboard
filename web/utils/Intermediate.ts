const style = require('@web/main.css');

import { Reducer, Smoothener, Interpolator } from '@core/pipes';
import { Point, Vec2, vec2, Bounds2, bounds2 } from '@core/geometry';
import { Stroke } from './strokes';
import Layer from './Layer';


/**
 * Interactively displays strokes that are drawn by the user currently.
 * These will disappear onces the server sends an "accept" packet.
 * Its important to keep these strokes in a separate buffer so that
 * concurrent drawing over the network still ends up with the same image
 * on all screens (i.e. the correct order in which strokes are overlaid on top
 * of each other).
 */
export default class Intermediate {
  startTime = new Date();
  
  stroke: Stroke = {
    color: '#000000',
    points: []
  };

  lastPoint: Point;

  reducer: Reducer;
  smoothener: Smoothener;
  interpolator: Interpolator;

  layer = new Layer(style.intermediate);

  bounds: bounds2 = Bounds2.empty();

  destroy() {
    this.layer.destroy();
  }

  drawPoints(points: Point[]) {
    if (points.length === 0)
      return;
    
    this.layer.drawPoints(points, this.stroke.color, this.lastPoint);
    this.lastPoint = points[points.length - 1];

    this.bounds = points.reduce((b, point) => {
      // @todo immediate operations would be more efficient

      const size: vec2 = [ point.pressure, point.pressure ];
      b = Bounds2.extend(b, Vec2.sub(point.position, size));
      b = Bounds2.extend(b, Vec2.add(point.position, size));
      return b;
    }, this.bounds);
  }

  // @todo on resize?
}