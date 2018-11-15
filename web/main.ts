const style = require('./main.css');

import { Point, Interpolator, Reducer, vec2, Vec2, Bounds2, bounds2, Smoothener } from '../core/Interpolator';
import * as dat from 'dat.gui';
import * as io from 'socket.io-client';

const TILE_SIZE: vec2 = [ 768, 768 ];
const TILE_MARGIN = 0.5;
const STROKE_QUALITY = 2; // higher numbers mean less quality
const DEBUG_STROKES = false;

interface CompressedStroke {
  color: string;
  data: number[];
}

interface Stroke {
  color: string;
  points: Point[];
}

function compressPoint(point: Point) {
  return {
    time: point.time,
    pressure: Math.floor(point.pressure * 8) / 8,
    position: Vec2.floor(point.position)
  }
}

function inflateStroke(stroke: CompressedStroke): Stroke {
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

function deflateStroke(stroke: Stroke): CompressedStroke {
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

    const scale = window.devicePixelRatio || 1;

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
      this.ctx.lineWidth = Math.max(point.pressure, 1);
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

    if (DEBUG_STROKES) {
      this.ctx.lineWidth = 1;
      this.ctx.strokeStyle = 'red';
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
    }
  };

  drawStroke(stroke: Stroke) {
    const interpolator = new Interpolator();
    interpolator.c = 0.0;
    interpolator.quality = STROKE_QUALITY; // @todo not elegant, not DRY with Intermediate

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

  reducer: Reducer;
  smoothener: Smoothener;
  interpolator: Interpolator;

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

const KEY_UP    = 38;
const KEY_DOWN  = 40;
const KEY_LEFT  = 37;
const KEY_RIGHT = 39;
const KEY_ESC   = 27;

class TileManager {
  protected scroll: vec2 = [ 0, 0 ];
  protected tiles = new Map<TileId, Tile>();

  constructor(
    protected app: Application
  ) {
    if (window.location.hash) {
      // read initial scroll position from hash fragment
      const fragment = window.location.hash.replace(/^#/, '');
      this.scroll = fragment.split('/').map(Number) as any;
    }

    this.updateTiles();
  }

  scrollRelative(offset: vec2) {
    this.setScroll(Vec2.add(this.scroll, offset))
  }

  setScroll(newScroll: vec2) {
    this.scroll = newScroll;
    window.location.replace(`#${this.scroll.join('/')}`);
    //window.location.hash = this.scroll.join('/');

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

type PressureMode = 'none' | 'default' | 'simulate';
type SmoothingMode = 'off' | 'gentle' | 'strong';

interface StrokeSettings {
  size: number;
  color: string;

  pressureMode: PressureMode;
  smoothingMode: SmoothingMode;
}

interface WhiteboardStorage {
  recentStyles: StrokeSettings[];
}

const DEFAULT_STORAGE: WhiteboardStorage = {
  recentStyles: []
};

class Application {
  tiles: TileManager;
  intercept = document.createElement('div');

  gui = new dat.GUI();
  vpControls: dat.GUIController[] = [];

  socket = io.connect();
  
  options = {
    size: 4,
    color: '#000000',

    pressureMode: 'default' as PressureMode,
    smoothingMode: 'gentle' as SmoothingMode,

    scrollX: 0,
    scrollY: 0
  };

  intermediates = new Map<number, Intermediate>();
  intermediateId = 0;

  storage: WhiteboardStorage;

  constructor() {
    this.setupGUI();
    this.setupSocket();
    this.setupIntercept();
    this.setupStorage();
  }

  protected setupStorage() {
    let data = JSON.parse(localStorage.getItem('whiteboard') || '{}');
    
    // extend with potentially newly implemented settings
    this.storage = Object.assign({}, DEFAULT_STORAGE, data);

    // load settings
    this.updateRecentStylePanel();
  }

  protected saveStorage() {
    localStorage.setItem('whiteboard', JSON.stringify(this.storage));
  }

  protected addRecentStyle(settings: StrokeSettings) {
    const serialize = (ss: StrokeSettings) =>
      [ ss.color, ss.size, ss.pressureMode, ss.smoothingMode ].join('/')
    ;

    const newSerialized = serialize(settings);
    this.storage.recentStyles = this.storage.recentStyles.filter(ss =>
      serialize(ss) !== newSerialized
    );

    // store the most recent 16 stroke styles
    this.storage.recentStyles.unshift(settings);
    this.storage.recentStyles = this.storage.recentStyles.slice(0, 16);

    this.saveStorage();
    this.updateRecentStylePanel();
  }

  protected updateRecentStylePanel() {
    let e = document.getElementById(style.recentStyles);
    if (!e) {
      e = document.createElement('div');
      e.id = style.recentStyles;

      this.gui.domElement.appendChild(e);
    }

    e.innerHTML = ''; // remove all children

    for (const ss of this.storage.recentStyles) {
      // not very efficient…

      const preview = document.createElement('div');
      preview.classList.add(style.preview);
      preview.addEventListener('click', e => {
        this.strokeSettings = ss;
      });

      const brush = document.createElement('div');

      brush.style.width =
      brush.style.height =
      brush.style.borderRadius = Math.floor(Math.sqrt(4 * ss.size + 16)) + 'px';
      brush.style.backgroundColor = ss.color;
      brush.style.transform = 'translate(-50%, -50%) translate(10px, 10px)';

      preview.appendChild(brush);

      e.appendChild(preview);
    }
  }

  /**
   * Returns all settings that define how a stroke is drawn.
   */
  get strokeSettings(): StrokeSettings {
    const { size, color, pressureMode, smoothingMode } = this.options;
    return { size, color, pressureMode, smoothingMode };
  }

  /**
   * Updates the all settings that define how a stroke is drawn.
   */
  set strokeSettings(settings: StrokeSettings) {
    Object.assign(this.options, settings);
    this.gui.updateDisplay();
  }

  /**
   * Returns whether a stroke is currently drawn.
   */
  get isActive() {
    return this.intermediates.has(this.intermediateId);
  }

  /**
   * Returns the stroke that is currently drawn.
   */
  get intermediate() {
    return this.intermediates.get(this.intermediateId)!;
  }

  /**
   * Aborts the stroke that is currently drawn.
   */
  protected abortIntermediates() {
    for (let i of this.intermediates.values())
      i.destroy();
    
    this.intermediates.clear();
  }

  protected setupTileManager() {
    if (this.tiles)
      return;
    
    const updateOptionsScroll = () => {
      [ this.options.scrollX, this.options.scrollY ] = this.tiles.getScroll();
      this.vpControls.forEach(vp =>
        vp.updateDisplay()
      );
    };

    this.tiles = new TileManager(this);
    updateOptionsScroll(); // TileManager may have shifted because of hash fragment

    const scroll = (x, y) => {
      this.tiles.scrollRelative([ x, y ]);
      updateOptionsScroll();
    };

    document.addEventListener('keydown', e => {
      switch (e.keyCode) {
        case KEY_UP:    scroll(0, -300); break;
        case KEY_DOWN:  scroll(0, +300); break;
        case KEY_LEFT:  scroll(-300, 0); break;
        case KEY_RIGHT: scroll(+300, 0); break;
        case KEY_ESC:
          this.abortIntermediates();
          break;
        
        default:
          return;
      }

      e.preventDefault();
    });

    {
      // scrolling on desktops

      document.addEventListener('wheel', e => {
        e.preventDefault();
        scroll(e.deltaX, e.deltaY);
      });
    }

    {
      // scrolling on mobile devices
      
      let [ scrollX, scrollY ] = [ 0, 0 ];
      let scrolling = false;
      this.intercept.addEventListener('touchstart', e => {
        e.preventDefault();
        scrolling = false;
      });

      this.intercept.addEventListener('touchmove', e => {
        if (e.touches.length > 1) {
          e.preventDefault();

          if (this.isActive)
            this.abortIntermediates();

          const [ x, y ] = Array.from(e.touches).reduce(([ x, y ], e) => [ x + e.clientX, y + e.clientY ], [ 0, 0 ]);
          const deltaX = Math.floor(x / e.touches.length - scrollX);
          const deltaY = Math.floor(y / e.touches.length - scrollY);

          if (scrolling)
            scroll(-deltaX, -deltaY);
          else
            scrolling = true;

          scrollX += deltaX;
          scrollY += deltaY;
        }
      });

      this.intercept.addEventListener('touchend', e => {
        e.preventDefault();

        // @todo momentum
      });
    }
  }

  protected setupGUI() {
    const scroll = () => {
      this.tiles.setScroll([ this.options.scrollX, this.options.scrollY ]);
    };

    const stroke = this.gui.addFolder('stroke');
    stroke.add(this.options, 'pressureMode', [ 'none', 'default', 'simulate' ]).name('pressure');
    stroke.add(this.options, 'smoothingMode', [ 'off', 'gentle', 'strong' ]).name('smoothing');
    stroke.add(this.options, 'size', 1, 100);
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

    this.socket.on('strokes', (tileId: TileId, strokes: CompressedStroke[]) => {
      strokes.forEach(stroke =>
        this.tiles.drawStroke(tileId, inflateStroke(stroke))
      );
    });
  }

  protected setupIntercept() {
    this.intercept.id = style.intercept;
    document.body.appendChild(this.intercept);

    let lastPosition: vec2;

    interface EventWithPressure {
      preventDefault(): void;
      clientX: number;
      clientY: number;
      pressure: number;
    }

    const addPoint = (e: EventWithPressure, first = false) => {
      e.preventDefault();

      const position: vec2 = [
        e.clientX,
        e.clientY
      ];

      if (first)
        lastPosition = position;

      let pressure: number;
      switch (this.options.pressureMode) {
        case 'none': pressure = 1.0; break;
        case 'default': pressure = e.pressure; break;
        case 'simulate': {
          const speed = Vec2.distance(position, lastPosition);
          lastPosition = position;

          pressure = speed / (speed + 20);
          break;
        }
      }

      const point: Point = {
        time: (new Date().getTime() - this.intermediate.startTime.getTime()) / 1000,
        pressure: pressure * this.options.size,
        position
      };
      
      const smoothened = this.intermediate.smoothener.pipe(point);
      const reduced = this.intermediate.reducer.pipeMultiple(smoothened).map(compressPoint)

      this.intermediate.stroke.points = [ ...this.intermediate.stroke.points, ...reduced ];
      this.intermediate.drawPoints(this.intermediate.interpolator.pipeMultiple(reduced));
    };

    const endStroke = (e: Event) => {
      e.preventDefault();

      if (!this.isActive)
        return;
      
      this.intermediate.drawPoints(
        // @todo this is pretty ugly.
        this.intermediate.interpolator.process(
          this.intermediate.reducer.process(
            this.intermediate.smoothener.flush()
          )
        )
      );

      const tiles: vec2[] = [];
      const bounds = Bounds2.floor(
        Bounds2.div(
          Bounds2.add(this.intermediate.bounds, this.tiles.getScroll()),
          TILE_SIZE
        )
      );

      Bounds2.forEach(bounds, pos => tiles.push(pos));

      const stroke = this.intermediate.stroke;
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

        this.socket.emit('stroke', this.intermediateId, tileId(pos), deflateStroke(strokeAdj));
      });
    };

    const startStroke = (e: EventWithPressure) => {
      ++this.intermediateId;

      this.addRecentStyle(this.strokeSettings);

      const int = new Intermediate();
      this.intermediates.set(this.intermediateId, int);
      
      int.startTime = new Date();
      int.stroke.color = this.options.color;

      int.smoothener = new Smoothener();
      int.reducer = new Reducer();

      switch (this.options.smoothingMode) {
        case 'off': {
          int.smoothener.position = 1.0;
          int.smoothener.pressure = 0.7;
          int.reducer.d = 3;

          break;
        }

        case 'gentle': {
          int.smoothener.position = 0.7;
          int.smoothener.pressure = 0.35;
          int.reducer.d = 5;
          
          break;
        }

        case 'strong': {
          int.smoothener.position = 0.3;
          int.smoothener.pressure = 0.25;
          int.reducer.d = 8;
          
          break;
        }
      }

      int.interpolator = new Interpolator();
      int.interpolator.c = 0.0;
      int.interpolator.quality = STROKE_QUALITY;

      addPoint(e, true);
    };

    const moveStroke = (e: EventWithPressure) => {
      if (!this.isActive)
        return;
      
      addPoint(e);
    };

    if ('PointerEvent' in window) {
      this.intercept.addEventListener('pointerdown', startStroke);
      this.intercept.addEventListener('pointermove', moveStroke);
      this.intercept.addEventListener('pointerup',   endStroke);
    } else {
      // fallback for Safari (*yuck*)

      const wrap = (fn: (e: EventWithPressure) => void): ((e: MouseEvent) => void) =>
        e => fn({
          preventDefault: () => e.preventDefault(),
          clientX: e.clientX,
          clientY: e.clientY,
          pressure: 1.0
        })
      ;

      this.intercept.addEventListener('mousedown', wrap(startStroke));
      this.intercept.addEventListener('mousemove', wrap(moveStroke));
      this.intercept.addEventListener('mouseup',   endStroke);
    }

    this.intercept.addEventListener('mouseleave', endStroke);
  }
}

new Application();
