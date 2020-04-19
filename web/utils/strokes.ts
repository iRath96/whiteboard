import { Vec2 } from '@core/geometry';
import { Point, CompressedStroke, Stroke } from '@core/stroke';


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
      pressure: Math.min(
        Math.max(
          stroke.data[i+0] / 8,
          0
        ),
        100
      ),
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
