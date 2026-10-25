const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

/**
 * Console logging with a coloured prefix, filtered by level. The last entries are kept in memory
 * (`logger.history`) so a "copy debug info" button can include them.
 */
export class Logger {
  constructor({ name = 'client', level = 'info', color = '#7c5cff', sink = console, history } = {}) {
    this.name = name;
    this.level = level;
    this.color = color;
    this.sink = sink;
    this.history = history ?? { entries: [], limit: 300 };
  }

  enabled(level) {
    return LEVELS[level] >= (LEVELS[this.level] ?? LEVELS.info);
  }

  child(name) {
    return new Logger({ name: `${this.name}/${name}`, level: this.level, color: this.color, sink: this.sink, history: this.history });
  }

  #write(level, method, args) {
    const { entries, limit } = this.history;
    entries.push({ time: Date.now(), level, name: this.name, message: args.map(describe).join(' ') });
    if (entries.length > limit) entries.splice(0, entries.length - limit);
    if (!this.enabled(level)) return;
    this.sink[method]?.(`%c${this.name}`, `color:${this.color};font-weight:600`, ...args);
  }

  debug(...args) {
    this.#write('debug', 'debug', args);
  }

  info(...args) {
    this.#write('info', 'log', args);
  }

  warn(...args) {
    this.#write('warn', 'warn', args);
  }

  error(...args) {
    this.#write('error', 'error', args);
  }
}

function describe(value) {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
