import { Point } from '../geometry';

/**
 * Represents a processing pipeline for points.
 */
export default abstract class Pipe {
  protected points: Point[] = [];

  /**
   * Processes a single point.
   * Subclasses can discard points, replace points or even add additional points.
   * Depending on the functionality of the pipe, this can also modify the
   * pipelines state.
   * @param point The point to be processed.
   */
  abstract pipe(point: Point): Point[];
  /**
   * Flushes the pipeline, signaling that no further points will be processed and
   * the pipeline should emit any remaining points.
   */
  abstract flush(): Point[];

  /**
   * Processes a batch of points and flushes the pipeline for you.
   * @param points The points to be processed.
   */
  process(points: Point[]) {
    const result = points.reduce((acc, p) => [ ...acc, ...this.pipe(p) ], [] as Point[]);
    return [ ...result, ...this.flush() ];
  }

  /**
   * Processes a bath of points, but does not flush the pipeline.
   * Call this as many times as you wish, but remember to call flush when you're done.
   * @param points 
   */
  pipeMultiple(points: Point[]) {
    return points.reduce((acc, p) => [ ...acc, ...this.pipe(p) ], [] as Point[]);
  }
}
