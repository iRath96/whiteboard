const style = require('./main.css');

import * as dat from 'dat.gui';
import * as io from 'socket.io-client';

import { Bounds2, Vec2, vec2 } from '@core/geometry';
import { Point, Stroke, CompressedStroke, StrokesByTile } from '@core/stroke';

import { TileId, tileId } from './utils/Tile';
import TileManager from './utils/TileManager';
import Intermediate from './utils/Intermediate';
import {
  inflateStroke, deflateStroke,
  compressPoint
} from './utils/strokes';
import {
  TILE_SIZE, STROKE_QUALITY, DEBUG_STROKES,
  KEY_UP, KEY_DOWN, KEY_LEFT, KEY_RIGHT, KEY_ESC
} from './utils/constants';
import { Smoothener, Reducer, Interpolator } from '@core/pipes';


type PressureMode = 'none' | 'default' | 'simulate';
type SmoothingMode = 'off' | 'gentle' | 'strong';

/**
 * Note that interpolation is not a part of the settings, it uses fixed parameters.
 * Interpolation always happens on the client side (i.e. the server stores fewer points
 * to reduce network bandwidth and disk storage).
 */
interface StrokeSettings {
  size: number;
  color: string;

  pressureMode: PressureMode;
  smoothingMode: SmoothingMode;
}

interface WhiteboardStorage {
  recentStyles: StrokeSettings[];
  ipadMode: boolean;
}

const DEFAULT_STORAGE: WhiteboardStorage = {
  recentStyles: [],
  ipadMode: false
};

export default class Application {
  tiles: TileManager;

  // the element that is notified when touch/pen/mouse events happen
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
    scrollY: 0,

    randomScroll: () => {
      this.tiles.setRandomScroll(Math.random() > 0.5 ? 5000 : 100);
      this.updateOptionsScroll();
    }
  };

  intermediates = new Map<number, Intermediate>();
  intermediateId = 0;

  storage: WhiteboardStorage;

  constructor() {
    this.setupStorage();
    this.setupGUI();
    this.setupSocket();
    this.setupIntercept();
  }

  protected setupStorage() {
    let data = JSON.parse(localStorage.getItem('whiteboard') || '{}');
    
    // extend with potentially newly implemented settings
    this.storage = Object.assign({}, DEFAULT_STORAGE, data);

    // load settings
    this.updateRecentStylePanel();

    // load recent style
    if (this.storage.recentStyles.length > 0)
      this.strokeSettings = this.storage.recentStyles[0];
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

  protected updateOptionsScroll() {
    [ this.options.scrollX, this.options.scrollY ] = this.tiles.getScroll();
    this.vpControls.forEach(vp =>
      vp.updateDisplay()
    );
  };

  protected setupTileManager() {
    if (this.tiles)
      return;

    this.tiles = new TileManager({
      subscribe: id => this.socket.emit('subscribe', id),
      unsubscribe: id => this.socket.emit('unsubscribe', id)
    });
    this.updateOptionsScroll(); // TileManager may have shifted because of hash fragment

    const scroll = (x, y) => {
      this.tiles.scrollRelative([ x, y ]);
      this.updateOptionsScroll();
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
        if (
          // never scroll when using a stylus
          e.touches[0].touchType !== 'stylus'
          && (
            // scroll if more than one touch...
            e.touches.length > 1
            // ...or single touch in case of iPad mode
            || this.storage.ipadMode
          )
         ) {
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
    viewport.add(this.options, 'randomScroll').name('Random');
    viewport.add(this.storage, 'ipadMode').name('Touch Scrolling').onChange(() => this.saveStorage());
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
      const strokesByTiles: StrokesByTile = tiles.map(pos => {
        const isPointInTile = (point: Point) => {
          const pos = point.position;
          const r = point.pressure / 2;
          return (
            (pos[0] > -r) && (pos[0]-TILE_SIZE[0] < +r) &&
            (pos[1] > -r) && (pos[1]-TILE_SIZE[1] < +r)
          )
        };

        const clipStrokeToTile = (points: Point[]) => {
          // old behavior, sends way more points than necessary
          //return [ points ];

          const interp = new Interpolator();
          const supportRegion = interp.supportRegion;
          const important = points.map(_ => false);

          for (let i = 0; i <= points.length; ++i) {
            const output = i === points.length ?
              interp.flush() :
              interp.pipe(points[i])
            ;

            if (output.some(isPointInTile)) {
              for (let off = 0; off < supportRegion; ++off)
                // mark the keypoints as important
                important[i-off] = true;
            }
          }

          const segments: Point[][] = [[]];
          points.forEach((point, index) => {
            if (important[index])
              segments[segments.length-1].push(point);
            else
              // need to start a new stroke to break this
              // one up in segments
              segments.push([]);
          });

          // don't submit empty segments
          return segments.filter(segment => segment.length > 0);
        };

        const segments = clipStrokeToTile(
          stroke.points
            .map(point =>
              // make point relative to tile
              Object.assign({}, point, {
                position: Vec2.sub(
                  Vec2.add(point.position, this.tiles.getScroll()),
                  Vec2.mul(pos, TILE_SIZE)
                )
              })
            )
        );

        const deflatedStrokes = segments.map(points => deflateStroke(Object.assign({}, stroke, { points })));
        return { tileId: tileId(pos), strokes: deflatedStrokes };
      });

      this.socket.emit('strokes', this.intermediateId, strokesByTiles);

      // get ready for the next stroke
      ++this.intermediateId;
    };

    const startStroke = (e: EventWithPressure) => {
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
