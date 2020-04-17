import { Point, Vec2 } from '@core/geometry';


export interface CompressedStroke {
  color: string;
  data: number[];
}

export interface Stroke {
  color: string;
  points: Point[];
}

export function compressPoint(point: Point) {
  return {
    time: point.time,
    pressure: Math.floor(point.pressure * 8) / 8,
    position: Vec2.floor(point.position)
  }
}

export function inflateStroke(stroke: CompressedStroke): Stroke {
  const points: Point[] = [];
  for (let i = 0; i < stroke.data.length; i += 3) {
    points.push({
      time: 0,
      pressure: stroke.data[i+0] / 8,
      position: [
        stroke.data[i+1],
        stroke.data[i+2]
      ]
    });
  }

  return {
    color: stroke.color,
    points
  };
}

export function deflateStroke(stroke: Stroke): CompressedStroke {
  const data = new Array(stroke.points.length * 3);
  stroke.points.forEach((point, i) => {
    data[i*3+0] = point.pressure * 8;
    data[i*3+1] = point.position[0];
    data[i*3+2] = point.position[1];
  });

  return {
    color: stroke.color,
    data
  };
}