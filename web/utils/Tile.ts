const style = require('@web/main.css');

import { Vec2, vec2 } from '@core/geometry';
import { TILE_SIZE, DEBUG_STROKES } from './constants';
import Layer from './Layer';


export type TileId = string;

export function tileId(position: vec2): TileId {
  return position.join('/');
}

/**
 * A tile corresponds to a rectangular patch of the infinite drawing area.
 * These will be loaded on demand as the user scrolls around and unloaded when
 * they are off-screen.
 * (think "chunks" in Minecraft ;-) )
 */
export class Tile {
  layer = new Layer(style.tile, TILE_SIZE);

  constructor(
    public position: vec2
  ) {
    if (DEBUG_STROKES) {
      // display the tile id as text
      setTimeout(() => {
        this.layer.ctx.fillText(tileId(position), 10, 10);
      }, Math.random() * 1000);
    }
  }

  destroy() {
    this.layer.destroy();
  }

  scroll(scroll: vec2) {
    const pos = Vec2.sub(Vec2.mul(this.position, TILE_SIZE), scroll);

    const s = this.layer.canvas.style;
    s.left = `${pos[0]}px`;
    s.top = `${pos[1]}px`;
  }
}
