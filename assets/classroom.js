(function (root) {
  'use strict';
  const VERSION = 1;
  const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{16,80}$/.test(value);
  const cleanName = value => typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 24) : '';
  function validQuiz(quiz) {
    return quiz && typeof quiz.topic === 'string' && quiz.topic.length <= 100 && Array.isArray(quiz.questions)
      && quiz.questions.length > 0 && quiz.questions.length <= 15 && quiz.questions.every(q =>
        q && typeof q.q === 'string' && q.q.length <= 4000 && Array.isArray(q.options) && q.options.length === 4
        && q.options.every(o => typeof o === 'string' && o.length <= 2000)
        && Number.isInteger(q.correct) && q.correct >= 0 && q.correct < 4 && typeof q.explanation === 'string');
  }
  function connectionError(error) {
    if (error?.type === 'peer-unavailable') return 'Die Lehrerseite ist nicht erreichbar. Sie muss geöffnet bleiben. Bitte erneut verbinden.';
    if (error?.type === 'browser-incompatible') return 'Dieser Browser unterstützt den Live-Klassenmodus nicht. Bitte Chrome, Firefox oder Safari verwenden.';
    return 'Die Live-Verbindung ist unterbrochen. Bitte Internetzugang prüfen und erneut verbinden.';
  }
  function openPeer(Peer, id, onStatus) {
    if (typeof Peer !== 'function') throw new Error('Die Klassenverbindung konnte nicht geladen werden. Bitte die Seite neu laden.');
    const peer = id ? new Peer(id, { debug: 0 }) : new Peer({ debug: 0 });
    const opened = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { peer.destroy(); reject(new Error('Die Klassenverbindung antwortet nicht. Bitte erneut versuchen.')); }, 12000);
      peer.on('open', () => { clearTimeout(timer); resolve(peer); });
      peer.on('error', error => { clearTimeout(timer); reject(new Error(connectionError(error))); onStatus?.(connectionError(error)); });
    });
    peer.on('disconnected', () => { onStatus?.('Die Verbindung wird wiederhergestellt …'); if (!peer.destroyed) peer.reconnect(); });
    return { peer, opened };
  }
  class Host {
    constructor(Peer, options = {}) { this.Peer = Peer; this.options = options; this.members = new Map(); this.connections = new Map(); this.closed = false; }
    async open(quiz, settings, key, roomId) {
      if (!validQuiz(quiz) || !validId(key) || !validId(roomId)) throw new Error('Ungültiger Klassenraum.');
      this.quiz = quiz; this.settings = settings; this.key = key;
      const { peer, opened } = openPeer(this.Peer, roomId, this.options.onStatus);
      this.peer = peer;
      peer.on('connection', conn => this.accept(conn));
      await opened;
      this.options.onStatus?.('Klasse bereit. Die Lehrerseite bitte geöffnet lassen.');
      return peer.id;
    }
    roster() { return [...this.members.values()].map(member => ({ ...member })); }
    changed() { this.options.onRoster?.(this.roster()); }
    accept(conn) {
      let memberId = null;
      const timer = setTimeout(() => { if (!memberId) conn.close(); }, 10000);
      const disconnect = () => {
        clearTimeout(timer);
        if (memberId && this.connections.get(memberId) === conn) {
          this.connections.delete(memberId);
          this.members.get(memberId).connected = false;
          this.changed();
        }
      };
      conn.on('close', disconnect);
      conn.on('error', disconnect);
      conn.on('data', message => {
        if (!message || typeof message !== 'object' || message.v !== VERSION || this.closed) return;
        if (message.type === 'join' && !memberId) {
          const name = cleanName(message.name);
          if (message.key !== this.key || !validId(message.id) || !name || (!this.members.has(message.id) && this.members.size >= 100)) {
            clearTimeout(timer);
            conn.send({ v: VERSION, type: 'rejected', error: 'Beitritt nicht möglich. Bitte den aktuellen QR-Code scannen und einen Namen eingeben.' });
            setTimeout(() => conn.close(), 200); return;
          }
          clearTimeout(timer);
          memberId = message.id;
          const previous = this.connections.get(memberId);
          const member = this.members.get(memberId) || { id: memberId, name, joinedAt: new Date().toISOString(), progress: 0, finished: false };
          member.name = name;
          member.connected = true;
          this.members.set(memberId, member);
          this.connections.set(memberId, conn);
          if (previous && previous !== conn) previous.close();
          conn.send({ v: VERSION, type: 'accepted', quiz: this.quiz, settings: this.settings });
          this.changed();
        } else if (memberId && this.connections.get(memberId) === conn && (message.type === 'progress' || message.type === 'finished')) {
          const member = this.members.get(memberId);
          const total = this.quiz.questions.length;
          if (member.finished || !Number.isInteger(message.progress) || message.progress < member.progress || message.progress > total) return;
          member.progress = message.progress;
          if (message.type === 'finished' && message.progress === total && Number.isInteger(message.right) && message.right >= 0 && message.right <= total
            && Number.isInteger(message.score) && message.score >= 0 && message.score <= total * 250) {
            member.finished = true; member.right = message.right; member.score = message.score;
          }
          this.changed();
        }
      });
    }
    close() {
      if (this.closed) return;
      this.closed = true;
      for (const conn of this.connections.values()) {
        try { conn.send({ v: VERSION, type: 'closed' }); } catch {}
      }
      const peer = this.peer;
      setTimeout(() => peer?.destroy(), 200);
      this.connections.clear();
      for (const member of this.members.values()) member.connected = false;
      this.changed();
      this.options.onStatus?.('Klasse beendet. Die Teilnehmerliste kannst du weiterhin speichern.');
    }
  }
  class Guest {
    constructor(Peer, options = {}) { this.Peer = Peer; this.options = options; this.connected = false; this.closed = false; this.finished = false; this.lastProgress = null; }
    async join({ room, key, name, id }) {
      if (!validId(room) || !validId(key) || !validId(id) || !cleanName(name)) throw new Error('Bitte einen Namen eingeben und den aktuellen Klassenlink verwenden.');
      this.closed = false;
      this.connection?.close();
      if (this.peer) this.peer.destroy();
      const { peer, opened } = openPeer(this.Peer, undefined, this.options.onStatus);
      this.peer = peer;
      await opened;
      return new Promise((resolve, reject) => {
        let accepted = false;
        const conn = peer.connect(room, { reliable: true, serialization: 'json' });
        this.connection = conn;
        const timer = setTimeout(() => { conn.close(); reject(new Error('Kein Beitritt bestätigt. Die Lehrerseite muss geöffnet bleiben. Bitte erneut versuchen.')); }, 15000);
        const failed = message => { clearTimeout(timer); this.connected = false; this.options.onStatus?.(message, false); if (!accepted) reject(new Error(message)); };
        peer.on('error', error => failed(connectionError(error)));
        conn.on('open', () => conn.send({ v: VERSION, type: 'join', key, name: cleanName(name), id }));
        conn.on('data', message => {
          if (!message || message.v !== VERSION) return;
          if (message.type === 'accepted' && validQuiz(message.quiz)) {
            clearTimeout(timer); accepted = true; this.connected = true;
            this.options.onStatus?.('Beigetreten als ' + cleanName(name) + '. Deine Lehrkraft sieht dich in der Teilnehmerliste.', true);
            if (this.lastProgress) this.send(this.lastProgress);
            resolve({ quiz: message.quiz, settings: message.settings || {} });
          } else if (message.type === 'rejected') { failed(message.error || 'Beitritt abgelehnt.'); conn.close(); }
          else if (message.type === 'closed') { this.closed = true; failed('Die Lehrkraft hat die Klasse beendet. Dein geladenes Quiz bleibt spielbar.'); }
        });
        conn.on('close', () => failed(this.closed ? 'Die Klasse ist beendet.' : 'Verbindung zur Lehrkraft unterbrochen. Bitte auf „Erneut verbinden“ tippen.'));
        conn.on('error', error => failed(connectionError(error)));
      });
    }
    send(message) { if (this.connected && this.connection?.open) this.connection.send({ v: VERSION, ...message }); }
    progress(progress) { if (this.finished) return; this.lastProgress = { type: 'progress', progress }; this.send(this.lastProgress); }
    finish(progress, right, score) { if (this.finished) return; this.finished = true; this.lastProgress = { type: 'finished', progress, right, score }; this.send(this.lastProgress); }
    close() { this.closed = true; this.connection?.close(); this.peer?.destroy(); this.connected = false; }
  }
  function csv(roster) {
    const cell = value => '"' + String(value ?? '').replace(/^[=+@-]/, "'$&").replace(/"/g, '""') + '"';
    const rows = [['Name', 'Beigetreten', 'Verbindung', 'Status', 'Richtige Antworten', 'Punkte'], ...roster.map(member => [
      member.name, member.joinedAt, member.connected ? 'Verbunden' : 'Getrennt', member.finished ? 'Fertig' : 'Im Quiz', member.right ?? '', member.score ?? ''
    ])];
    return '\ufeff' + rows.map(row => row.map(cell).join(';')).join('\r\n');
  }
  const api = { Host, Guest, validQuiz, cleanName, csv };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RazaClassroom = api;
})(typeof globalThis === 'object' ? globalThis : this);
