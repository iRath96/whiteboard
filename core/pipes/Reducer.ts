import Pipe from './Pipe';
import { Vec2 } from '../geometry';
import { Point } from '../stroke';

/**
 * This pipeline reduces an incoming stream of points, throwing
 * away points that are close to each other so that the resulting
 * points are spread out with a given minimum distance.
 * This is useful for compressing strokes (especially when they are drawn
 * slowly), but also helps the interpolator make lines even smoother.
 */
export default class Reducer extends Pipe {
  /**
   * The minimum distance between points.
   */
  public d = 3.0;
  /**
   * Whether to accumulate distances (false), meaning that points
   * could still have less than 'd' distance if there was some movement
   * in between, or to enforce the minimum distance (true) no matter what
   * happened between two points.
   */
  public hard = false;

  protected r = 0.0;

  pipe(point: Point) {
    if (this.points.length === 0) {
      this.points.push(point);
      return [ point ];
    }
    
    const lastPoint = this.points[this.points.length - 1];
    if (this.hard)
      this.r = 0;
    
    this.r += Vec2.distance(lastPoint.position, point.position);

    if (this.r > this.d) {
      this.r = 0;
      this.points.push(point);
      return [ point ];
    } else {
      if (!this.hard)
        this.points.push(point);
      
      return [];
    }
  }

  flush() {
    // Make sure that the stroke ends up at the same point that the
    // original stroke ended at.
    if (this.r > 0)
      return [ this.points[this.points.length - 1] ];
    else
      return [];
  }
}
