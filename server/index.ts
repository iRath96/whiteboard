import * as path from 'path';
import * as webpack from 'webpack';
import * as express from 'express';
import { Server } from 'http';
import * as webpackMiddleware from 'webpack-dev-middleware';
import * as webpackHotMiddleware from 'webpack-hot-middleware';
import * as io from 'socket.io';

const strokes = [];

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

sock.on('connection', client => {
  client.on('request', e => {
    client.emit('strokes', strokes);
  });

  client.on('stroke', (id: string, stroke: any) => {
    client.emit('accept', id);
    sock.emit('strokes', [ stroke ]);
    
    strokes.push(stroke);
  });
});

server.listen(port, '0.0.0.0', function onStart(err) {
  if (err) {
    console.log(err);
  }
  console.info('==> 🌎 Listening on port %s. Open up http://0.0.0.0:%s/ in your browser.', port, port);
});
