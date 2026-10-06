(function (root) {
  'use strict';
  // HTTPS message transport; classroom content is encrypted before publication.
  // The free service applies request and daily limits: https://docs.ntfy.sh/publish/
  function createTransport(deps = {}) {
    const crypt = deps.crypto || root.crypto;
    const fetcher = deps.fetch || root.fetch?.bind(root);
    const Source = deps.EventSource || root.EventSource;
    const encoder = new TextEncoder(), decoder = new TextDecoder();
    const base = deps.base || 'https://ntfy.sh';
    const encode = bytes => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
    const decode = text => Uint8Array.from(atob(text), char => char.charCodeAt(0));
    class Events {
      constructor() { this.handlers = new Map(); }
      on(name, handler) { if (!this.handlers.has(name)) this.handlers.set(name, []); this.handlers.get(name).push(handler); return this; }
      emit(name, value) { for (const handler of this.handlers.get(name) || []) handler(value); }
    }
    class Connection extends Events {
      constructor(peer, remote, outgoing) {
        super(); this.owner = peer; this.peer = remote; this.open = true; this.closed = false;
        if (outgoing) queueMicrotask(() => this.emit('open'));
      }
      send(message) {
        let data = message;
        if (this.owner.host && message.type === 'closed') { this.owner.endRoom(); return; }
        if (this.owner.host && message.type === 'accepted') { const { quiz, ...rest } = message; data = rest; }
        // Send the result once; individual answers do not consume the free message allowance.
        if (message.type === 'progress') return;
        this.owner.publish({ kind: 'data', from: this.owner.id, to: this.peer, data }).catch(error => this.emit('error', error));
      }
      close() {
        if (this.closed) return; this.closed = true; this.open = false;
        this.owner.publish({ kind: 'close', from: this.owner.id, to: this.peer }).catch(() => {});
        this.emit('close');
      }
    }
    return class Peer extends Events {
      constructor(id, options) {
        super(); if (typeof id === 'object') { options = id; id = undefined; }
        const settings = options?.relay || {};
        this.id = id || crypt.randomUUID(); this.room = settings.room; this.secret = settings.key;
        this.host = this.id === this.room; this.quiz = settings.quiz; this.destroyed = false;
        this.connections = new Map(); this.parts = new Map(); this.seen = new Set(); this.pending = []; this.opened = false;
        this.init().catch(error => this.emit('error', { type: 'network', message: error.message }));
      }
      async init() {
        if (!Source || !fetcher || !crypt?.subtle) throw new Error('Die Live-Verbindung wird von diesem Browser nicht unterstützt.');
        const hash = await crypt.subtle.digest('SHA-256', encoder.encode(this.secret));
        this.key = await crypt.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
        if (this.destroyed) return;
        const source = new Source(base + '/herr-raza-' + this.room + '/sse?since=all');
        this.source = source;
        source.onmessage = event => this.receive(event.data).catch(() => {});
        source.onerror = () => { if (!this.destroyed) this.emit('disconnected'); };
        source.onopen = async () => {
          if (this.destroyed || this.opened) return;
          this.opened = true;
          try { if (this.host) await this.publish({ kind: 'quiz', from: this.id, quiz: this.quiz }); this.ready(); }
          catch (error) { this.emit('error', { type: 'network', message: error.message }); }
        };
      }
      ready() {
        if (this.destroyed || this.readySent || (!this.host && !this.quiz)) return;
        this.readySent = true; this.emit('open', this.id);
      }
      async publish(frame) {
        if (!this.key) return;
        let bytes = encoder.encode(JSON.stringify(frame)), gzip = false;
        if (bytes.length > 1500 && root.CompressionStream) {
          const compressed = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
          if (compressed.byteLength < bytes.length) { bytes = new Uint8Array(compressed); gzip = true; }
        }
        const iv = crypt.getRandomValues(new Uint8Array(12));
        const encrypted = new Uint8Array(await crypt.subtle.encrypt({ name: 'AES-GCM', iv }, this.key, bytes));
        const text = encode(encrypted), messageId = crypt.randomUUID(), total = Math.ceil(text.length / 2800);
        if (total > 60) throw new Error('Das Klassenquiz ist zu groß. Bitte weniger Fragen wählen.');
        for (let part = 0; part < total; part++) {
          const body = JSON.stringify({ v: 1, id: messageId, part, total, iv: encode(iv), gzip, payload: text.slice(part * 2800, (part + 1) * 2800) });
          const response = await fetcher(base + '/herr-raza-' + this.room, { method: 'POST', body, headers: { 'Content-Type': 'text/plain' }, signal: AbortSignal.timeout(8000) });
          if (!response.ok) throw new Error(response.status === 429 ? 'Der kostenlose Klassenserver hat seine Anfragengrenze erreicht. Bitte später erneut versuchen.' : 'Der Klassenserver antwortet gerade nicht.');
        }
      }
      async receive(raw) {
        const event = JSON.parse(raw); if (event.event !== 'message' || typeof event.message !== 'string') return;
        const packet = JSON.parse(event.message);
        if (packet.v !== 1 || typeof packet.id !== 'string' || packet.id.length > 80 || this.seen.has(packet.id)
          || !Number.isInteger(packet.total) || packet.total < 1 || packet.total > 60 || !Number.isInteger(packet.part)
          || packet.part < 0 || packet.part >= packet.total || typeof packet.payload !== 'string' || packet.payload.length > 2800) return;
        if (!this.parts.has(packet.id)) {
          if (this.parts.size >= 100) this.parts.delete(this.parts.keys().next().value);
          this.parts.set(packet.id, { chunks: new Map(), total: packet.total, iv: packet.iv, gzip: packet.gzip });
        }
        const group = this.parts.get(packet.id); if (group.total !== packet.total || group.iv !== packet.iv) return;
        group.chunks.set(packet.part, packet.payload); if (group.chunks.size !== group.total) return;
        this.parts.delete(packet.id); this.seen.add(packet.id); if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value);
        let bytes = new Uint8Array(await crypt.subtle.decrypt({ name: 'AES-GCM', iv: decode(group.iv) }, this.key,
          decode(Array.from({ length: group.total }, (_, i) => group.chunks.get(i)).join(''))));
        if (group.gzip) {
          if (!root.DecompressionStream) return;
          bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
        }
        if (bytes.length > 180000) return;
        const frame = JSON.parse(decoder.decode(bytes));
        if (frame.kind === 'ended' && frame.from === this.room && !this.host) { this.ended = true; this.emit('error', { type: 'peer-unavailable', message: 'Diese Klasse ist beendet. Bitte den aktuellen QR-Code verwenden.' }); return; }
        if (frame.kind === 'quiz' && frame.from === this.room && !this.host && !this.ended) { this.quiz = frame.quiz; this.ready(); return; }
        if (frame.to !== this.id || frame.from === this.id || typeof frame.from !== 'string') return;
        let conn = this.connections.get(frame.from);
        if (frame.kind === 'close') { if (conn) { conn.closed = true; conn.open = false; conn.emit('close'); } return; }
        if (frame.kind !== 'data' || !frame.data) return;
        if (!conn) { if (!this.host || this.connections.size >= 100) return; conn = new Connection(this, frame.from, false); this.connections.set(frame.from, conn); this.emit('connection', conn); }
        if (conn.closed) return;
        const message = frame.data.type === 'accepted' ? { ...frame.data, quiz: this.quiz } : frame.data;
        conn.emit('data', message);
        // Students need only the join acknowledgement; their quiz then works without a stream.
        if (!this.host && message.type === 'accepted') this.source?.close();
      }
      connect(id) { const conn = new Connection(this, id, true); this.connections.set(id, conn); return conn; }
      reconnect() { /* EventSource reconnects automatically and replays missed encrypted messages. */ }
      endRoom() { if (this.closingSent) return; this.closingSent = true; this.publish({ kind: 'ended', from: this.id }).catch(() => {}); }
      destroy() { if (this.destroyed) return; this.destroyed = true; this.source?.close(); if (this.host) { this.endRoom(); for (const conn of this.connections.values()) { conn.closed = true; conn.open = false; conn.emit('close'); } } else for (const conn of this.connections.values()) conn.close(); }
    };
  }
  const api = { createTransport, Peer: createTransport() };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RazaRelay = api;
})(typeof globalThis === 'object' ? globalThis : this);
