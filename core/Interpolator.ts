export type vec2 = [ number, number ];
export type bounds2 = [ vec2, vec2 ];

function hypot(x: number, y: number) {
  return Math.sqrt(x * x + y * y);
}

export class Vec2 {
  static minus(a: vec2): vec2 { return [ -a[0], -a[1] ]; }
  static add(a: vec2, b: vec2): vec2 { return [ a[0] + b[0], a[1] + b[1] ]; }
  static sub(a: vec2, b: vec2): vec2 { return [ a[0] - b[0], a[1] - b[1] ]; }
  static mul(a: vec2, b: vec2): vec2 { return [ a[0] * b[0], a[1] * b[1] ]; }
  static mulS(a: vec2, s: number): vec2 { return [ a[0] * s, a[1] * s ]; }
  static div(a: vec2, b: vec2): vec2 { return [ a[0] / b[0], a[1] / b[1] ]; }
  static distance(a: vec2, b: vec2) { return hypot(b[0] - a[0], b[1] - a[1]); }
  static floor(a: vec2): vec2 { return [ Math.floor(a[0]), Math.floor(a[1]) ]; }
  static ceil(a: vec2): vec2 { return [ Math.ceil(a[0]), Math.ceil(a[1]) ]; }
  static min(a: vec2, b: vec2): vec2 { return [ Math.min(a[0], b[0]), Math.min(a[1], b[1]) ]; }
  static max(a: vec2, b: vec2): vec2 { return [ Math.max(a[0], b[0]), Math.max(a[1], b[1]) ]; }
  static mix(a: vec2, b: vec2, t: number): vec2 {
    return this.add(
      this.mulS(a, 1 - t),
      this.mulS(b, t)
    );
  }
}

export class Bounds2 {
  static div(a: bounds2, b: vec2): bounds2 { return [ Vec2.div(a[0], b), Vec2.div(a[1], b) ]; }
  static add(a: bounds2, b: vec2): bounds2 { return [ Vec2.add(a[0], b), Vec2.add(a[1], b) ]; }
  static sub(a: bounds2, b: vec2): bounds2 { return [ Vec2.sub(a[0], b), Vec2.sub(a[1], b) ]; }
  static floor(a: bounds2): bounds2 { return [ Vec2.floor(a[0]), Vec2.floor(a[1]) ]; }

  static inside(a: vec2, bounds: bounds2) {
    return a[0] >= bounds[0][0] && a[0] <= bounds[1][0] && a[1] >= bounds[0][1] && a[1] <= bounds[1][1];
  }

  static forEach(bounds: bounds2, callback: (position: vec2) => any) {
    for (let y = bounds[0][1]; y <= bounds[1][1]; ++y) {
      for (let x = bounds[0][0]; x <= bounds[1][0]; ++x) {
        callback([ x, y ]);
      }
    }
  }

  static empty(): bounds2 {
    return [
      [  Infinity,  Infinity ],
      [ -Infinity, -Infinity ]
    ]
  }

  static extend(bounds: bounds2, a: vec2): bounds2 {
    return [
      Vec2.min(bounds[0], a),
      Vec2.max(bounds[1], a)
    ];
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
  public bias = 1e-2;
  public pressureWeight = 8.0;

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
      
      let speed = hypot(
        diff2(p => p.position[0]),
        diff2(p => p.position[1])
      );

      speed += this.pressureWeight * arg;

      t += this.quality / (speed + this.bias) + this.bias;
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

export class Reducer extends Pipe {
  public d = 3.0;
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
    if (this.r > 0)
      return [ this.points[this.points.length - 1] ];
    else
      return [];
  }
}

export class Smoothener extends Pipe {
  public position = 0.9;
  public pressure = 0.5;

  protected mean: Point;
  protected lastPoint: Point;

  pipe(point: Point) {
    this.lastPoint = point;

    if (!this.mean)
      this.mean = point;
    
    this.mean.pressure = (1 - this.pressure) * this.mean.pressure + this.pressure * point.pressure;
    this.mean.position = Vec2.mix(this.mean.position,point.position, this.position);

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
