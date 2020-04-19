import { Vec2, vec2, Bounds2, bounds2 } from '@core/geometry';
import { TileId, Tile, tileId } from './Tile';
import { TILE_SIZE, TILE_MARGIN } from './constants';
import { Stroke } from '@core/stroke';

export interface Callbacks {
  subscribe(id: TileId);
  unsubscribe(id: TileId);
}

/**
 * Manages all the tiles and makes sure the entire screen is covered.
 * Loads and unloads tiles dynamically as the user scrolls the viewport.
 */
export default class TileManager {
  protected scroll: vec2 = [ 0, 0 ];
  protected tiles = new Map<TileId, Tile>();

  constructor(
    protected callbacks: Callbacks
  ) {
    if (window.location.hash) {
      // read initial scroll position from hash fragment
      const fragment = window.location.hash.replace(/^#/, '');
      this.scroll = fragment.split('/').map(Number) as any;

      this.updateTiles();
    } else {
      // choose a random starting point
      this.setRandomScroll();
    }
  }

  setRandomScroll(distance = 100) {
    this.setScroll([
      Math.floor(Math.random() * 40 - 20) * distance,
      Math.floor(Math.random() * 40 - 20) * distance
    ]);
  }

  scrollRelative(offset: vec2) {
    this.setScroll(Vec2.add(this.scroll, offset))
  }

  setScroll(newScroll: vec2) {
    this.scroll = newScroll;
    window.location.replace(`#${this.scroll.join('/')}`);

    this.updateTiles();
  }

  getScroll() {
    return this.scroll;
  }

  protected updateTiles() {
    const margin = TILE_MARGIN;

    const min = Vec2.floor(
      Vec2.add(
        Vec2.div(this.scroll, TILE_SIZE),
        [ -margin, -margin ]
      )
    );

    const max = Vec2.floor(
      Vec2.add(
        Vec2.div(Vec2.add(this.scroll, [ window.innerWidth, window.innerHeight ]), TILE_SIZE),
        [ +margin, +margin ]
      )
    );
    
    const bounds: bounds2 = [ min, max ];

    for (let tile of this.tiles.values()) {
      if (!Bounds2.inside(tile.position, bounds))
        this.unloadTile(tile);
    }

    Bounds2.forEach(bounds, position => {
      if (!this.hasTile(position))
        this.loadTile(position);
    });

    for (let tile of this.tiles.values())
      tile.scroll(this.scroll);
  }

  protected hasTile(position: vec2) {
    return this.tiles.has(tileId(position));
  }

  protected loadTile(position: vec2) {
    const id = tileId(position);

    const tile = new Tile(position);
    this.tiles.set(id, tile);

    this.callbacks.subscribe(id);
  }

  protected unloadTile(tile: Tile) {
    const id = tileId(tile.position);
    this.callbacks.unsubscribe(id);

    tile.destroy();
    this.tiles.delete(id);
  }

  drawStroke(tileId: TileId, stroke: Stroke) {
    const tile = this.tiles.get(tileId);
    tile && tile.layer.drawStroke(stroke);
  }
}
