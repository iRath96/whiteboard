import { Counter, Gauge, collectDefaultMetrics, register } from 'prom-client';

class CurrentCounter {
  total: Counter<string>;
  current: Gauge<string>;

  constructor(config: {
    name: string,
    help: string
  }) {
    this.total = new Counter({
      name: `num_total_${config.name}`,
      help: `Total number of ${config.help}`
    });

    this.current = new Gauge({
      name: `num_current_${config.name}`,
      help: `Current number of ${config.help}`
    });
  }

  inc() {
    this.total.inc();
    this.current.inc();
  }

  dec() {
    this.current.dec();
  }
}

export const numConnections = new CurrentCounter({  
  name: 'connections',
  help: 'connected clients'
});

export const numTilesLoaded = new CurrentCounter({  
  name: 'tiles_loaded',
  help: 'tiles loaded from disk'
});

export const numSubscriptions = new CurrentCounter({  
  name: 'subscriptions',
  help: 'tiles being observed by clients'
});

export const numStrokesReceived = new Counter({  
  name: 'num_strokes_received',
  help: 'Number of strokes that clients requested to be drawn',
  labelNames: ['metric']
});

export const numStrokesSent = new Counter({  
  name: 'num_strokes_sent',
  help: 'Number of strokes that were sent to clients',
  labelNames: ['metric','origin']
});

export const getMetrics = () => register.metrics();

collectDefaultMetrics();
