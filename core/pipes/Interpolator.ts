import Pipe from './Pipe';
import { Vec2, hypot } from '../geometry';
import { Point } from '../stroke';

export type Getter<T> = (p: Point) => T;
function interpolate(interp: (value: Getter<number>) => number): Point {
  return {
    time: interp(p => p.time),
    pressure: interp(p => p.pressure),
    position: [
      interp(p => p.position[0]),
      interp(p => p.position[1])
    ]
  };
}

/**
 * This pipeline interpolates a stream of points, i.e.
 * it adds points inbetween them so that the resulting curve is smoother.
 */
export default class Interpolator extends Pipe {
  public c = 0.0; // 0->quadratic, 1->linear interpolation
  public quality = 1.0;
  public pressureWeight = 30.0;
  public t0 = 0.070; // minimum timestep
  public t1 = 0.400; // maximum timestep
  public tX = 0.200; // first timestep (no differentials available at that point)

  protected getTangent(i: number, value: Getter<number>) {
    const n = this.points.length;

    if (i === 0 || i === n - 1) {
      // clamped boundary condition
      return 0;
    }

    return (1 - this.c) * (value(this.points[i+1]) - value(this.points[i-1])) / 2;
  }

  protected interpolateValue(t: number, p0: number, m0: number, p1: number, m1: number) {
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * m1;
  }

  protected interpolateDiff(t: number, p0: number, m0: number, p1: number, m1: number) {
    const t2 = t * t;
    return (6 * t2 - 6 * t) * p0 + (3 * t2 - 4 * t + 1) * m0 + (-6 * t2 + 6 * t) * p1 + (3 * t2 - 2 * t) * m1;
  }

  protected interpolateDiff2(t: number, p0: number, m0: number, p1: number, m1: number) {
    return (12 * t - 6) * p0 + (6 * t - 4) * m0 + (-12 * t + 6) * p1 + (6 * t - 2) * m1;
  }

  pipe(point: Point) {
    //return [ point ];

    this.points.push(point);
    if (this.points.length < 3)
      return [];
    
    const result: Point[] = [];

    const left = this.points.length - 3;
    const right = left + 1;
    const dist = Vec2.distance(this.points[left].position, this.points[right].position);

    for (let t = 0; t < 1.0;) {
      const getArgs = (value: Getter<number>): [number,number,number,number] => {
        const m0 = this.getTangent(left, value);
        const m1 = this.getTangent(right, value);
        const p0 = value(this.points[left]);
        const p1 = value(this.points[right]);

        return [ p0, m0, p1, m1 ];
      };

      const interp = (value: Getter<number>) => this.interpolateValue(t, ...getArgs(value));
      const diff1 = (value: Getter<number>) => this.interpolateDiff(t, ...getArgs(value));
      const diff2 = (value: Getter<number>) => this.interpolateDiff2(t, ...getArgs(value));

      const arg = Math.abs(Math.pow(diff1(p => p.pressure), 2) / (interp(p => p.pressure) + 32));
      result.push(interpolate(interp));
      
      const dx = diff1(p => p.position[0]);
      const dy = diff1(p => p.position[1]);
      const hyp = hypot(dx, dy);

      let speed = Math.abs(
        diff2(p => p.position[0]) * dy -
        diff2(p => p.position[1]) * dx
      ) / (hyp + 1e-8);

      //result[result.length-1].pressure = speed / 20;

      speed += this.pressureWeight * arg;

      const wantedPixels = this.quality * dist / (speed + 1e-5);
      
      t += Math.min(Math.max(wantedPixels / hyp, this.t0), t === 0 ? this.tX : this.t1);
    }
    
    return result;
  }

  flush() {
    const lastPoint = this.points[this.points.length - 1];
    if (!lastPoint)
      return [];
    
    return [ ...this.pipe(lastPoint), lastPoint ];
  }
}
