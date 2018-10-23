const style = require('./main.css');

import { Point, Interpolator, Smoothener } from '../core/Interpolator';
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

  protected listener = () => this.resize();

  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');

    document.body.appendChild(this.canvas);
    window.addEventListener('resize', this.listener);

    this.resize();
  }

  destroy() {
    document.body.removeChild(this.canvas);
    window.removeEventListener('resize', this.listener);
  }

  protected resize() {
    // @todo redraw stuff

    const { offsetWidth, offsetHeight } = this.canvas;
    const scale = 2; // @todo

    this.canvas.width = offsetWidth * scale;
    this.canvas.height = offsetHeight * scale;
    
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

  layer = new Layer();

  destroy() {
    this.layer.destroy();
  }

  drawPoints(points: Point[]) {
    if (points.length === 0)
      return;
    
    this.layer.drawPoints(points, this.stroke.color, this.lastPoint);
    this.lastPoint = points[points.length - 1];
  }

  // @todo on resize?
}

class Application {
  layer = new Layer();
  intercept = document.createElement('div');

  gui = new dat.GUI();
  socket = io.connect();
  
  options = {
    pressure: 1,
    smoothing: 4,
    color: '#000000'
  };

  pressure = 1.0;

  intermediates = new Map<number, Intermediate>();
  intermediateId = 0;

  constructor() {
    this.setupGUI();
    this.setupSocket();
    this.setupIntercept();
  }

  protected setupGUI() {
    this.gui.add(this.options, 'pressure', 1, 100);
    this.gui.add(this.options, 'smoothing', 3, 50);
    this.gui.addColor(this.options, 'color');

    this.gui.domElement.parentElement.style.zIndex = '10000';
  }

  protected setupSocket() {
    this.socket.on('connect', () => {
      this.socket.emit('request');
    });

    this.socket.on('accept', id => {
      this.intermediates.get(id)!.destroy();
      this.intermediates.delete(id);
    });

    this.socket.on('strokes', strokes => {
      strokes.forEach(this.layer.drawStroke.bind(this.layer));
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

      this.socket.emit('stroke', this.intermediateId, intermediate().stroke);

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
