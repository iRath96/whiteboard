export type vec2 = [ number, number ];

function hypot(x: number, y: number) {
  return Math.sqrt(x * x + y * y);
}

export class Vec2 {
  static distance(a: vec2, b: vec2) {
    return hypot(b[0] - a[0], b[1] - a[1]);
  }
}

export interface Point {
  time: number;
  pressure: number;
  position: vec2;
}

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

export type Getter<T> = (p: Point) => T;

abstract class Pipe {
  protected points: Point[] = [];

  abstract pipe(point: Point): Point[];
  abstract flush(): Point[];

  process(points: Point[]) {
    const result = points.reduce((acc, p) => [ ...acc, ...this.pipe(p) ], [] as Point[]);
    return [ ...result, ...this.flush() ];
  }

  pipeMultiple(points: Point[]) {
    return points.reduce((acc, p) => [ ...acc, ...this.pipe(p) ], [] as Point[]);
  }
}

export class Interpolator extends Pipe {
  public c = 0.0;
  public quality = 4.0;
  public bias = 1e-3;

  protected getTangent(i: number, value: Getter<number>) {
    const n = this.points.length;

    const left  = i <= 0 ? 0 : i - 1;
    const right = i >= n - 1 ? n - 1 : i + 1;

    return (1 - this.c) * (value(this.points[right]) - value(this.points[left])) / (right - left);
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

    for (let t = 0; t < 1.0;) {
      const interp = (value: Getter<number>) => {
        const m0 = this.getTangent(left, value);
        const m1 = this.getTangent(right, value);
        const p0 = value(this.points[left]);
        const p1 = value(this.points[right]);

        return this.interpolateValue(t, p0, m0, p1, m1);
      };

      const diff2 = (value: Getter<number>) => {
        const m0 = this.getTangent(left, value);
        const m1 = this.getTangent(right, value);
        const p0 = value(this.points[left]);
        const p1 = value(this.points[right]);

        return this.interpolateDiff2(t, p0, m0, p1, m1);
      };

      result.push(interpolate(interp));

      const speed = hypot(
        diff2(p => p.position[0]),
        diff2(p => p.position[1])
      );

      t += this.quality / (speed + 1e-3) + this.bias;
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

export class Smoothener extends Pipe {
  public d = 10.0;
  public hard = true;

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
    if (this.r > 0)
      return [ this.points[this.points.length - 1] ];
    else
      return [];
  }
}

export class Sampler extends Pipe {
  public d = 4.0;
  protected r = 0.0;

  pipe(point: Point) {
    this.points.push(point);
    if (this.points.length === 1)
      return [];
    
    const result: Point[] = [];

    const left = this.points.length - 2;
    const right = left + 1;

    const d = Vec2.distance(this.points[left].position, this.points[right].position);

    let u = this.r;
    for (; u < d; u += this.d) {
      let t = u / d;

      const interp = (value: Getter<number>) => {
        const p0 = value(this.points[left]);
        const p1 = value(this.points[right]);

        return (1 - t) * p0 + t * p1;
      };

      result.push(interpolate(interp));
    }

    this.r = u - d;

    return result;
  }

  flush() {
    return [];
  }
}
