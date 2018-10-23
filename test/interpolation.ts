import * as fs from 'fs';
const { createCanvas } = require('canvas');

import { Interpolator, Sampler, Point } from '../core/Interpolator';

function test() {
  const canvas: HTMLCanvasElement = createCanvas(1600, 1200);
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);

  const interpolator = new Interpolator();
  interpolator.c = 0.0;

  const sampler = new Sampler();
  sampler.d = 20;

  const points: Point[] = [
    { time: 0.0, pressure: 1.0, position: [ 100, 200 ] },
    { time: 0.5, pressure: 1.0, position: [ 200, 100 ] },
    { time: 1.5, pressure: 1.0, position: [ 250, 300 ] },
    { time: 2.5, pressure: 1.0, position: [ 150, 500 ] },
    { time: 2.8, pressure: 1.0, position: [ 200, 500 ] },
    { time: 4.0, pressure: 1.0, position: [ 400, 450 ] },
    { time: 5.0, pressure: 1.0, position: [ 600, 100 ] },
  ];

  const pointsInterp = interpolator.process(points);
  const pointsSample = sampler.process(pointsInterp);

  // draw all sets
  [{
    points,
    color: 'red',
    offset: 0,
    markers: false
  }, {
    points: pointsInterp,
    color: 'green',
    offset: 0,
    markers: false
  }, {
    points: pointsSample,
    color: 'blue',
    offset: 0,
    markers: true
  }].forEach(({ points, color, offset, markers }) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.5;

    if (markers) {
      for (let i = 0; i < points.length; ++i) {
        const p = points[i].position;
  
        ctx.beginPath();
  
        ctx.moveTo(p[0] - 2 + offset, p[1] - 2);
        ctx.lineTo(p[0] + 2 + offset, p[1] + 2);
        ctx.moveTo(p[0] + 2 + offset, p[1] - 2);
        ctx.lineTo(p[0] - 2 + offset, p[1] + 2);
        ctx.stroke();
  
        ctx.closePath();
      }
    } else {
      ctx.beginPath();

      for (let i = 0; i < points.length; ++i) {
        const p = points[i].position;
        ctx[i === 0 ? 'moveTo' : 'lineTo'](p[0] + offset, p[1]);
      }

      ctx.stroke();
      ctx.closePath();
    }
  });

  const buffer: Buffer = (canvas as any).toBuffer();
  fs.writeFileSync('test.png', buffer);
}

test();
