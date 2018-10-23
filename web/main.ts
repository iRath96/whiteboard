const style = require('./main.css');

import { Point, Interpolator, Smoothener, vec2, Vec2, Bounds2, bounds2 } from '../core/Interpolator';
import * as dat from 'dat.gui';
import * as io from 'socket.io-client';

const Pressure = require('pressure');

interface Stroke {
  color: string;
  points: Point[];
}

class Layer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;

  protected listener = null;

  constructor(
    className: string = '',
    size?: vec2
  ) {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');

    this.canvas.className = className;

    document.body.appendChild(this.canvas);

    if (!size) {
      // full-screen

      this.listener = () => this.resize();
      window.addEventListener('resize', this.listener);
    }

    this.resize(size);
  }

  destroy() {
    document.body.removeChild(this.canvas);

    if (this.listener)
      window.removeEventListener('resize', this.listener);
  }

  protected resize(size?: vec2) {
    // @todo redraw stuff

    const sizeFQ = size || [
      this.canvas.offsetWidth,
      this.canvas.offsetHeight
    ];

    const scale = 2; // @todo

    this.canvas.width = sizeFQ[0] * scale;
    this.canvas.height = sizeFQ[1] * scale;

    if (size) {
      this.canvas.style.width = `${size[0]}px`;
      this.canvas.style.height = `${size[1]}px`;
    }
    
    this.ctx.resetTransform();
    this.ctx.scale(scale, scale);
  }

  drawPoints(points: Point[], color: string, previous?: Point) {
    if (points.length === 0)
      return;
    
    let lastPoint = previous ? previous : points[0];
    points.forEach(point => {
      this.ctx.beginPath();
      this.ctx.lineWidth = lastPoint.pressure;
      this.ctx.strokeStyle = color;
      this.ctx.lineCap = 'round';

      const p = lastPoint.position;
      const q = point.position;

      this.ctx.moveTo(p[0], p[1]);
      this.ctx.lineTo(q[0], q[1]);

      this.ctx.stroke();
      this.ctx.closePath();

      lastPoint = point;
    });

    /*
    points.forEach(point => {
      const p = point.position;

      this.ctx.beginPath();

      this.ctx.moveTo(p[0] - 2, p[1] - 2);
      this.ctx.lineTo(p[0] + 2, p[1] + 2);
      this.ctx.moveTo(p[0] + 2, p[1] - 2);
      this.ctx.lineTo(p[0] - 2, p[1] + 2);
      this.ctx.stroke();

      this.ctx.closePath();
    });
    */
  };

  drawStroke(stroke: Stroke) {
    const interpolator = new Interpolator();
    interpolator.c = 0.0;
    interpolator.quality = 2; // @todo not elegant, not DRY with Intermediate

    this.drawPoints(interpolator.process(stroke.points), stroke.color);
  }
}

class Intermediate {
  startTime = new Date();
  
  stroke: Stroke = {
    color: '#000000',
    points: []
  };

  lastPoint: Point;

  sampler = new Smoothener();
  interpolator = new Interpolator();

  layer = new Layer(style.intermediate);

  bounds: bounds2 = Bounds2.empty();

  destroy() {
    this.layer.destroy();
  }

  drawPoints(points: Point[]) {
    if (points.length === 0)
      return;
    
    this.layer.drawPoints(points, this.stroke.color, this.lastPoint);
    this.lastPoint = points[points.length - 1];

    this.bounds = points.reduce((b, point) => {
      // @todo immediate operations would be more efficient

      const size: vec2 = [ point.pressure, point.pressure ];
      b = Bounds2.extend(b, Vec2.sub(point.position, size));
      b = Bounds2.extend(b, Vec2.add(point.position, size));
      return b;
    }, this.bounds);
  }

  // @todo on resize?
}

const TILE_SIZE: vec2 = [ 768, 768 ];
const TILE_MARGIN = 1;

class Tile {
  layer = new Layer(style.tile, TILE_SIZE);

  constructor(
    public position: vec2
  ) {
    /*setTimeout(() => {
      this.layer.ctx.fillText(tileId(position), 10, 10);
    }, Math.random() * 1000);*/
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

type TileId = string;

function tileId(position: vec2): TileId {
  return position.join('/');
}

const KEY_UP = 38;
const KEY_DOWN = 40;
const KEY_LEFT = 37;
const KEY_RIGHT= 39;

class TileManager {
  protected scroll: vec2 = [ 0, 0 ];
  protected tiles = new Map<TileId, Tile>();

  constructor(
    protected app: Application
  ) {
    this.updateTiles();
  }

  scrollRelative(offset: vec2) {
    this.setScroll(Vec2.add(this.scroll, offset))
  }

  setScroll(newScroll: vec2) {
    this.scroll = newScroll;
    this.updateTiles();
  }

  getScroll() {
    return this.scroll;
  }

  protected updateTiles() {
    const margin = TILE_MARGIN;

    const min = Vec2.add(
      Vec2.floor(Vec2.div(this.scroll, TILE_SIZE)),
      [ -margin, -margin ]
    );

    const max = Vec2.add(
      Vec2.floor(Vec2.div(Vec2.add(this.scroll, [ window.innerWidth, window.innerHeight ]), TILE_SIZE)),
      [ +margin, +margin ]
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

    this.app.socket.emit('subscribe', id);
  }

  protected unloadTile(tile: Tile) {
    const id = tileId(tile.position);
    this.app.socket.emit('unsubscribe', id);

    tile.destroy();
    this.tiles.delete(id);
  }

  drawStroke(tileId: TileId, stroke: Stroke) {
    const tile = this.tiles.get(tileId);
    tile && tile.layer.drawStroke(stroke);
  }
}

class Application {
  tiles: TileManager;
  intercept = document.createElement('div');

  gui = new dat.GUI();
  vpControls: dat.GUIController[] = [];

  socket = io.connect();
  
  options = {
    pressure: 1,
    smoothing: 4,
    color: '#000000',

    scrollX: 0,
    scrollY: 0
  };

  pressure = 1.0;

  intermediates = new Map<number, Intermediate>();
  intermediateId = 0;

  constructor() {
    this.setupGUI();
    this.setupSocket();
    this.setupIntercept();
  }

  protected setupTileManager() {
    if (this.tiles)
      return;
    
    this.tiles = new TileManager(this);

    const scroll = (x, y) => {
      this.tiles.scrollRelative([ x, y ]);
      [ this.options.scrollX, this.options.scrollY ] = this.tiles.getScroll();

      this.vpControls.forEach(vp =>
        vp.updateDisplay()
      );
    }

    document.addEventListener('keydown', e => {
      switch (e.keyCode) {
        case KEY_UP:    scroll(0, -300); break;
        case KEY_DOWN:  scroll(0, +300); break;
        case KEY_LEFT:  scroll(-300, 0); break;
        case KEY_RIGHT: scroll(+300, 0); break;
      }
    });
  }

  protected setupGUI() {
    const scroll = () => {
      this.tiles.setScroll([ this.options.scrollX, this.options.scrollY ]);
    };

    const stroke = this.gui.addFolder('stroke');
    stroke.add(this.options, 'pressure', 1, 100);
    stroke.add(this.options, 'smoothing', 3, 50);
    stroke.addColor(this.options, 'color');
    stroke.open();

    const viewport = this.gui.addFolder('viewport');
    this.vpControls.push(viewport.add(this.options, 'scrollX').onChange(scroll).step(1).name('x'));
    this.vpControls.push(viewport.add(this.options, 'scrollY').onChange(scroll).step(1).name('y'));
    viewport.open();

    this.gui.domElement.parentElement.style.zIndex = '10000';
  }

  protected setupSocket() {
    this.socket.on('connect', () => {
      this.setupTileManager();
    });

    this.socket.on('accept', id => {
      const int = this.intermediates.get(id);

      int && int.destroy();
      this.intermediates.delete(id);
    });

    this.socket.on('strokes', (tileId: TileId, strokes: Stroke[]) => {
      console.log(tileId, strokes.length);
      strokes.forEach(stroke =>
        this.tiles.drawStroke(tileId, stroke)
      );
    });
  }

  protected setupIntercept() {
    this.intercept.id = style.intercept;
    document.body.appendChild(this.intercept);

    Pressure.set(this.intercept, {
      change: (force: number) => {
        this.pressure = force;
      }
    });

    const isActive = () =>
      this.intermediates.has(this.intermediateId)
    ;

    const intermediate = () =>
      this.intermediates.get(this.intermediateId)!
    ;

    const addPoint = (e: MouseEvent) => {
      const point: Point = {
        time: (new Date().getTime() - intermediate().startTime.getTime()) / 1000,
        pressure: this.pressure * this.options.pressure,
        position: [
          e.clientX,
          e.clientY
        ]
      };

      const sampled = intermediate().sampler.pipe(point);

      intermediate().stroke.points = [ ...intermediate().stroke.points, ...sampled ];
      intermediate().drawPoints(intermediate().interpolator.pipeMultiple(sampled));
    };

    const flush = () => {
      if (!isActive())
        return;
      
      intermediate().interpolator.pipeMultiple(intermediate().sampler.flush());
      intermediate().drawPoints(intermediate().interpolator.flush());

      const tiles: vec2[] = [];
      const bounds = Bounds2.floor(
        Bounds2.div(
          Bounds2.add(intermediate().bounds, this.tiles.getScroll()),
          TILE_SIZE
        )
      );

      Bounds2.forEach(bounds, pos => tiles.push(pos));

      const stroke = intermediate().stroke;
      tiles.forEach(pos => {
        // @todo clip stroke to tile

        const strokeAdj: Stroke = Object.assign({}, stroke, {
          points: stroke.points.map(point =>
            Object.assign({}, point, {
              position: Vec2.sub(
                Vec2.add(point.position, this.tiles.getScroll()),
                Vec2.mul(pos, TILE_SIZE)
              )
            })
          )
        });

        this.socket.emit('stroke', this.intermediateId, tileId(pos), strokeAdj);
      });

      ++this.intermediateId;
    };

    this.intercept.addEventListener('mousedown', e => {
      const int = new Intermediate();
      this.intermediates.set(this.intermediateId, int);
      
      int.startTime = new Date();
      int.stroke.color = this.options.color;

      int.interpolator = new Interpolator();
      int.interpolator.c = 0.0;
      int.interpolator.quality = 2;

      int.sampler = new Smoothener();
      int.sampler.d = this.options.smoothing;

      addPoint(e);
    });

    this.intercept.addEventListener('mousemove', e => {
      if (!isActive())
        return;
      
      addPoint(e);
    });

    this.intercept.addEventListener('mouseup', flush);
    this.intercept.addEventListener('mouseleave', flush);
  }
}

new Application();
