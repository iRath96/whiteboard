import Pipe from './Pipe';
import { Vec2 } from '../geometry';
import { Point } from '../stroke';

/**
 * This class implements replaces points with a running average,
 * making strokes appear smoother.
 */
export default class Smoothener extends Pipe {
  public position = 0.9;
  public pressure = 0.5;

  protected mean: Point;
  protected lastPoint: Point;

  pipe(point: Point) {
    this.lastPoint = point;

    if (!this.mean)
      this.mean = point;
    
    this.mean.pressure = (1 - this.pressure) * this.mean.pressure + this.pressure * point.pressure;
    this.mean.position = Vec2.mix(this.mean.position, point.position, this.position);

    return [{
      time: point.time,
      pressure: this.mean.pressure,
      position: this.mean.position
    }];
  }

  flush() {
    return this.lastPoint ? [ this.lastPoint ] : [];
  }
}
