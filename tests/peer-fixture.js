'use strict';
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
function fakePeers() {
  const peers = new Map();
  class Connection extends EventEmitter {
    constructor() { super(); this.open = false; this.closed = false; }
    send(data) { if (!this.open) throw new Error('Connection is closed'); const copy = JSON.parse(JSON.stringify(data)); queueMicrotask(() => { if (!this.other.closed) this.other.emit('data', copy); }); }
    close() { if (this.closed) return; this.closed = true; this.open = false; this.emit('close'); this.other?.close(); }
  }
  return class Peer extends EventEmitter {
    constructor(id) { super(); this.id = typeof id === 'string' ? id : randomUUID(); this.destroyed = false; this.connections = []; peers.set(this.id, this); queueMicrotask(() => this.emit('open', this.id)); }
    connect(id) { const conn = new Connection(), other = new Connection(); conn.other = other; other.other = conn; this.connections.push(conn);
      queueMicrotask(() => { const target = peers.get(id); if (!target) { this.emit('error', { type: 'peer-unavailable' }); return; }
        target.connections.push(other); target.emit('connection', other); conn.open = true; other.open = true; other.emit('open'); conn.emit('open'); });
      return conn;
    }
    reconnect() {}
    destroy() { this.destroyed = true; peers.delete(this.id); for (const conn of this.connections) conn.close(); }
  };
}
module.exports = { fakePeers };
