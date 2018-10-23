import * as fs from 'fs';
import * as path from 'path';
import * as webpack from 'webpack';
import * as express from 'express';
import { Server } from 'http';
import * as webpackMiddleware from 'webpack-dev-middleware';
import * as webpackHotMiddleware from 'webpack-hot-middleware';
import * as io from 'socket.io';

const config = require('./webpack.config.ts');

const isDeveloping = process.env.NODE_ENV !== 'production';
const port = isDeveloping ? 3000 : Number(process.env.PORT);

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

class Tile {
  strokes: any[] = [];
  subscribers = new Set<io.Socket>();

  isDirty = false;

  constructor(
    public tileId: TileId
  ) {
    this.load();
  }

  protected get path() {
    return path.join(__dirname, `../data/${this.tileId.replace(/[^0-9\-]/g, '_')}.json`);
  }

  protected load() {
    this.isDirty = false;

    try {
      this.strokes = JSON.parse(fs.readFileSync(this.path, 'utf-8'));
    } catch (e) {
      this.strokes = [];
    }
  }

  save() {
    if (!this.isDirty)
      return;
    
    try {
      console.log('saving ', this.path);
      fs.writeFileSync(this.path, JSON.stringify(this.strokes));
      this.isDirty = false;
    } catch (e) {
      console.error(e);
    }
  }

  addStroke(stroke: any) {
    this.isDirty = true;
    this.strokes.push(stroke);
    this.subscribers.forEach(sub =>
      sub.emit('strokes', this.tileId, [ stroke ])
    );
  }

  destroy() {
    this.save();
  }
}

type TileId = string;
const tiles = new Map<TileId, Tile>();

setInterval(() => {
  for (let tile of tiles.values())
    tile.save();
}, 30 * 1000);

function getTile(tileId: TileId) {
  if (tiles.has(tileId))
    return tiles.get(tileId)!;
  
  const tile = new Tile(tileId);
  tiles.set(tileId, tile);
  return tile;
}

function unloadTile(tile: Tile) {
  tiles.delete(tile.tileId);
  tile.destroy();
}

sock.on('connection', client => {
  const loaded = new Set<Tile>();

  client.on('subscribe', (tileId: string) => {
    const tile = getTile(tileId);
    tile.subscribers.add(client);
    loaded.add(tile);

    client.emit('strokes', tileId, tile.strokes);
  });

  client.on('unsubscribe', (tileId: string) => {
    const tile = getTile(tileId);

    loaded.delete(tile);
    tile.subscribers.delete(client);
  });

  client.on('stroke', (id: string, tileId: TileId, stroke: any) => {
    client.emit('accept', id);

    const tile = getTile(tileId);
    tile.addStroke(stroke);
  });

  client.on('disconnect', () => {
    loaded.forEach(tile => {
      tile.subscribers.delete(client);
      if (tile.subscribers.size === 0)
        unloadTile(tile);
    });
  });
});

server.listen(port, '0.0.0.0', function onStart(err) {
  if (err) {
    console.log(err);
  }
  console.info('==> 🌎 Listening on port %s. Open up http://0.0.0.0:%s/ in your browser.', port, port);
});
