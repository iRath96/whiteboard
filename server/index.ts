import * as fs from 'fs';
import * as path from 'path';
import * as webpack from 'webpack';
import * as express from 'express';
import { Server } from 'http';
import * as webpackMiddleware from 'webpack-dev-middleware';
import * as webpackHotMiddleware from 'webpack-hot-middleware';
import * as io from 'socket.io';

import { CompressedStroke, StrokesByTile } from '@core/stroke';
import * as metrics from './metrics';

const config = require('./webpack.config.ts');


const isDeveloping = process.env.NODE_ENV !== 'production';
const port = isDeveloping ? 3000 : Number(process.env.PORT);
const metricsPort = Number(process.env.METRICS_PORT || 9100);

const app = express();
const server = new Server(app);
const sock = io(server);

const compiler = webpack(config);
const middleware = webpackMiddleware(compiler, {
  publicPath: config.output.publicPath,
  stats: {
    colors: true,
    hash: false,
    timings: true,
    chunks: false,
    chunkModules: false,
    modules: false
  }
});

app.use(middleware);
app.use(webpackHotMiddleware(compiler));
app.get('*', function response(req, res) {
  res.write(middleware.fileSystem.readFileSync(path.join(__dirname, 'dist/index.html')));
  res.end();
});

//
// SOCKET STUFF
//

function countPoints(strokes: CompressedStroke[]) {
  return strokes.reduce((sum, stroke) => sum + stroke.data.length/3, 0);
}

type TileId = string;
class Tile {
  private static loadedTiles = new Map<TileId, Tile>();

  static get(tileId: TileId) {
    if (this.loadedTiles.has(tileId))
      return this.loadedTiles.get(tileId)!;
    
    const tile = new Tile(tileId);
    this.loadedTiles.set(tileId, tile);
    metrics.numTilesLoaded.inc();
    return tile;
  }
  
  private static unload(tile: Tile) {
    this.loadedTiles.delete(tile.tileId);
    metrics.numTilesLoaded.dec();
    tile.destroy();
  }

  static saveAll() {
    for (let tile of this.loadedTiles.values())
      tile.save();
  }

  private strokes: CompressedStroke[] = [];
  private subscribers = new Set<io.Socket>();

  private isDirty = false;

  private constructor(
    public tileId: TileId
  ) {
    this.load();
  }

  private get path() {
    return path.join(__dirname, `../data/${this.tileId.replace(/[^0-9\-]/g, '_')}.json`);
  }

  private load() {
    this.isDirty = false;

    try {
      this.strokes = JSON.parse(fs.readFileSync(this.path, 'utf-8'));
    } catch (e) {
      this.strokes = [];
    }
  }

  private save() {
    if (!this.isDirty)
      return;
    
    try {
      fs.writeFileSync(this.path, JSON.stringify(this.strokes));
      this.isDirty = false;
    } catch (e) {
      console.error(e);
    }
  }

  addStrokes(strokes: CompressedStroke[]) {
    this.isDirty = true;

    this.strokes.push(...strokes);
    this.subscribers.forEach(sub =>
      sub.emit('strokes', this.tileId, strokes)
    );

    metrics.numStrokesReceived.labels('segments').inc(strokes.length);
    metrics.numStrokesReceived.labels('points').inc(countPoints(strokes));

    metrics.numStrokesSent.labels('segments','forwarded').inc(this.subscribers.size);
    metrics.numStrokesSent.labels('points','forwarded').inc(this.subscribers.size * countPoints(strokes));
  }

  private destroy() {
    this.save();
  }

  subscribe(client: io.Socket) {
    this.subscribers.add(client);

    client.emit('strokes', this.tileId, this.strokes);
    metrics.numStrokesSent.labels('segments','cached').inc(this.strokes.length);
    metrics.numStrokesSent.labels('points','cached').inc(countPoints(this.strokes));
    metrics.numSubscriptions.inc();
  }

  unsubscribe(client: io.Socket) {
    this.subscribers.delete(client);
    metrics.numSubscriptions.dec();

    if (this.subscribers.size === 0)
      Tile.unload(this);
  }
}

setInterval(() => {
  // @todo also at process exit
  Tile.saveAll();
}, 30 * 1000);

sock.on('connection', client => {
  metrics.numConnections.inc();

  const loaded = new Set<Tile>();

  client.on('subscribe', (tileId: string) => {
    const tile = Tile.get(tileId);
    tile.subscribe(client);
    loaded.add(tile);
  });

  client.on('unsubscribe', (tileId: string) => {
    const tile = Tile.get(tileId);
    loaded.delete(tile);
    tile.unsubscribe(client);
  });

  client.on('strokes', (id: string, sbt: StrokesByTile) => {
    if (!Array.isArray(sbt)) return;
    metrics.numStrokesReceived.labels('strokes').inc();

    sbt.forEach(({ tileId, strokes }) => {
      if (typeof tileId !== 'string') return;
      if (!Array.isArray(strokes)) return;

      strokes = strokes.reduce((strokes, strokeRaw) => {
        // verify that the stroke is well formatted
        if (typeof strokeRaw !== 'object') return strokes;
        if (typeof strokeRaw.color !== 'string') return strokes;
        if (!Array.isArray(strokeRaw.data)) return strokes;
        if (strokeRaw.data.length % 3 !== 0) return strokes;
        if (!strokeRaw.data.every(e => typeof e === 'number')) return strokes;
  
        // accept stroke
        return [ ...strokes, { color: strokeRaw.color, data: strokeRaw.data } ];
      }, [] as CompressedStroke[]);
  
      const tile = Tile.get(tileId);
      tile.addStrokes(strokes);
    });

    client.emit('accept', id);
  });

  client.on('disconnect', () => {
    metrics.numConnections.dec();
    loaded.forEach(tile => tile.unsubscribe(client));
  });
});

server.listen(port, '0.0.0.0', err => {
  if (err)
    console.log(err);
  else
    console.info('==> 🌎 Listening on port %d. Open up http://127.0.0.1:%d/ in your browser.', port, port);
});

const metricsApp = express();
metricsApp.get('/metrics', (_, res) => {
  res.send(metrics.getMetrics());
});

const metricsServer = new Server(metricsApp);
metricsServer.listen(metricsPort, '0.0.0.0');
