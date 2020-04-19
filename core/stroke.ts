import { vec2 } from './geometry';


export interface Point {
  /**
   * The creation time of this point in seconds.
   * A time of zero corresponds to the first point in a stroke.
   */
  time: number;
  /**
   * The diameter of the brush at this point.
   */
  pressure: number;
  /**
   * The position of this point in [0, TILE_SIZE]^2.
   */
  position: vec2;
}

/**
 * How strokes are transfered over the network and stored on the server.
 */
export interface CompressedStroke {
  color: string;
  data: number[];
}

/**
 * What CompressedStrokes are deflated into by the client.
 */
export interface Stroke {
  color: string;
  points: Point[];
}

export type StrokesByTile = {
  tileId: string;
  strokes: CompressedStroke[];
}[];
