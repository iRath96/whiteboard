export type vec2 = [ number, number ];
export type bounds2 = [ vec2, vec2 ];

export function hypot(x: number, y: number) {
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
