// openachievements in the browser: the Rust core (openachievements.wasm) keeps the player's
// stats and achievements; this file saves them in localStorage, reports them to the platform the
// game runs on (Wavedash, Steam through a desktop wrapper, Newgrounds, Game Jolt) and, if the
// player opts in, pins them as badges on Badge Collector, and shows a toast for each unlock and a
// list on request. A plain script, so module and classic pages alike
// can use it:
//
//   <script src="openachievements.js"></script>
//   OpenAchievements.start({ manifest: 'achievements.json', wasm: 'openachievements.wasm' });
//
//   window.openachievements?.add('monsters_defeated', 1)   // a `total` stat counts up
//   window.openachievements?.set('deepest_floor', 7)       // a `best` stat keeps its highest
//   window.openachievements?.unlock('HIDDEN_DOOR')
//   window.openachievements?.showList()
//
// Calls made before loading finishes are kept and replayed. Nothing here can break the game:
// errors go to the console (and to `on('error', fn)`), never up to the caller.
(function () {
  'use strict';

  var PLATFORM_TIMEOUT = 15000;
  var SYNC_EVERY = 60000;

  function now() {
    return Math.floor(Date.now() / 1000);
  }

  function param(name) {
    try {
      return new URLSearchParams(window.location.search).get(name);
    } catch (e) {
      return null;
    }
  }

  function withTimeout(p, what) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error(what + ': no answer')); }, PLATFORM_TIMEOUT);
      Promise.resolve(p).then(
        function (v) { clearTimeout(t); resolve(v); },
        function (e) { clearTimeout(t); reject(e); }
      );
    });
  }

  // ---- The core, through three raw exports (see crates/openachievements-web). ----

  function Core(instance) {
    this.wasm = instance.exports;
    this.enc = new TextEncoder();
    this.dec = new TextDecoder();
  }
  Core.prototype.call = function (req) {
    var w = this.wasm;
    var bytes = this.enc.encode(JSON.stringify(req));
    var ptr = w.oa_alloc(bytes.length);
    new Uint8Array(w.memory.buffer, ptr, bytes.length).set(bytes);
    var out = w.oa_call(ptr, bytes.length);
    var answer = JSON.parse(this.dec.decode(new Uint8Array(w.memory.buffer, out, w.oa_out_len())));
    if (answer && typeof answer === 'object' && !Array.isArray(answer) && typeof answer.error === 'string') {
      throw new Error(answer.error);
    }
    return answer;
  };

  // ---- Platforms. Each: name, account(), read() → {stats, unlocked}, write(op) → bool, flush(). ----

  // Wavedash (wavedash.com): the page has a global `Wavedash` (an object, or a promise of one).
  // Stats are read only once the game has called Wavedash.init() (which shows the game): this
  // script wraps init as soon as it loads, so load it before the game's own scripts. If init was
  // called earlier, or cannot be wrapped, reading starts after INIT_WAIT anyway.
  var INIT_WAIT = 20000;
  var wavedashInit = (function () {
    var w = window.Wavedash;
    if (!w) return null;
    return new Promise(function (resolve) {
      setTimeout(resolve, INIT_WAIT);
      (typeof w.then === 'function' ? w : Promise.resolve(w)).then(function (s) {
        try {
          var init = s && s.init;
          if (typeof init !== 'function') return resolve();
          s.init = function () {
            resolve();
            return init.apply(this, arguments);
          };
        } catch (e) { /* a frozen SDK: wait for the timeout */ }
      }, resolve);
    });
  })();

  function wavedash() {
    var w = window.Wavedash;
    if (!w) return null;
    var sdkP = (typeof w.then === 'function' ? w : Promise.resolve(w)).then(function (s) {
      return (wavedashInit || Promise.resolve()).then(function () { return s; });
    });
    var sdk = null;
    var requested = null;
    return {
      name: 'wavedash',
      account: function () { return 'wavedash'; },
      read: function (manifest) {
        return sdkP.then(function (s) {
          sdk = s;
          if (!requested) requested = Promise.resolve(s.requestStats());
          return requested;
        }).then(function (r) {
          if (r && r.success === false) { requested = null; throw new Error('wavedash: stats did not load'); }
          var remote = { stats: {}, unlocked: [] };
          manifest.stats.forEach(function (st) {
            var v = Number(sdk.getStat(st.id));
            if (isFinite(v)) remote.stats[st.id] = v;
          });
          manifest.achievements.forEach(function (a) {
            if (sdk.getAchievement(a.id) === true) remote.unlocked.push(a.id);
          });
          return remote;
        });
      },
      // Wavedash drops writes (and answers false) until its stats have loaded: the op stays
      // pending and goes again on the next sync.
      write: function (op) {
        if (op.op === 'unlock') return sdk.setAchievement(op.id, false) !== false;
        return sdk.setStat(op.id, op.value, false) !== false;
      },
      flush: function () { return sdk.storeStats(); },
    };
  }

  // Steam, inside a desktop wrapper (Tauri, Electron) that exposes the bridge
  // `window.openachievementsSteam` = { account(), read() → {stats, unlocked}, write(op) → bool,
  // flush() }, each possibly async; openachievements-native's SteamBackend is its other side.
  function steam() {
    var b = window.openachievementsSteam;
    if (!b) return null;
    return {
      name: 'steam',
      shows: true, // the Steam overlay shows its own unlocks
      account: function () { return b.account(); },
      read: function () { return b.read(); },
      write: function (op) { return b.write(op); },
      flush: function () { return b.flush && b.flush(); },
    };
  }

  function httpPlatform(name, core, prefix, args, accountOf) {
    function send(req) {
      return withTimeout(fetch(req.url, {
        method: req.method,
        headers: (req.headers || []).reduce(function (h, kv) { h[kv[0]] = kv[1]; return h; }, {}),
        body: req.body || undefined,
      }).then(function (r) { return r.text(); }), name);
    }
    var account = null;
    return {
      name: name,
      account: function () { return account; },
      read: function () {
        return send(core.call(Object.assign({ op: prefix + '_read' }, args))).then(function (body) {
          var r = core.call({ op: prefix + '_parse_read', body: body });
          account = accountOf(r);
          return r.remote;
        });
      },
      write: function (op) {
        if (op.op !== 'unlock' || op.key == null) return true;
        var key = prefix === 'ng' ? { medal: op.key } : { trophy: op.key };
        return send(core.call(Object.assign({ op: prefix + '_unlock' }, args, key))).then(function (body) {
          core.call({ op: prefix + '_parse_unlock', body: body });
          return true;
        });
      },
      flush: function () {},
    };
  }

  // Newgrounds: the game's iframe URL carries `ngio_session_id`.
  function newgrounds(core, manifest) {
    var session = param('ngio_session_id');
    if (!session || !manifest.platforms || !manifest.platforms.newgrounds) return null;
    return httpPlatform('newgrounds', core, 'ng', { session: session }, function (r) { return 'newgrounds:' + r.user; });
  }

  // Game Jolt: the game's URL carries `gjapi_username` and `gjapi_token`.
  function gamejolt(core, manifest) {
    var user = param('gjapi_username');
    var token = param('gjapi_token');
    if (!user || !token || !manifest.platforms || !manifest.platforms.gamejolt) return null;
    return httpPlatform('gamejolt', core, 'gj', { user: user, token: token }, function () { return 'gamejolt:' + user; });
  }

  // Badge Collector (badgecollector.org), when the manifest has `badgecollector` and the player
  // opted in from the list: the player's email is hashed here (sha256 of the trimmed, lowercased,
  // NFC email) and only the hash is kept and sent. Write-only: nothing is read back, so every
  // unlock is sent once; a duplicate (or 409) counts as sent, a failure goes again next sync.
  function badgeCollector(core, emailHash) {
    var account = 'badgecollector:' + emailHash;
    // The page, without its query or fragment (they may carry a portal's session or token).
    var evidence = window.location.origin + window.location.pathname;
    if (!/^https?:/.test(evidence)) evidence = undefined;
    return {
      name: 'badgecollector',
      hash: emailHash,
      account: function () { return account; },
      read: function () { return { stats: {}, unlocked: [] }; },
      // Each award on its own: one refused badge (not on Badge Collector yet) does not hold up the
      // others; the failures come back as one error at the end, and go again next sync.
      stopped: false,
      writeAll: function (ops, done) {
        var self = this;
        var failed = [];
        return ops.reduce(function (p, op) {
          return p.then(function () {
            // The player stopped collecting meanwhile: send nothing more, record nothing.
            if (op.op !== 'unlock' || self.stopped) return;
            var req = core.call({ op: 'bc_award', id: op.id, email_hash: emailHash, evidence: evidence });
            return withTimeout(fetch(req.url, {
              method: req.method,
              headers: (req.headers || []).reduce(function (h, kv) { h[kv[0]] = kv[1]; return h; }, {}),
              body: req.body,
            }).then(function (r) {
              return r.text().then(function (body) {
                core.call({ op: 'bc_parse_award', status: r.status, body: body });
                if (!self.stopped) done(op);
              });
            }), 'badgecollector').catch(function (e) {
              failed.push(op.id + ': ' + (e && e.message ? e.message : e));
              // Slowed down: the rest waits for the next sync.
              if (/\b429\b/.test(String(e && e.message))) throw e;
            });
          });
        }, Promise.resolve()).then(function () {
          if (failed.length) throw new Error('badgecollector: ' + failed.length + ' not sent yet (' + failed[0] + ')');
        });
      },
      write: function () { return true; },
      flush: function () {},
    };
  }

  function sha256Hex(text) {
    if (!window.crypto || !window.crypto.subtle) return Promise.reject(new Error('no SubtleCrypto here (an https page is needed)'));
    return window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)).then(function (d) {
      return Array.prototype.map.call(new Uint8Array(d), function (b) { return (b < 16 ? '0' : '') + b.toString(16); }).join('');
    });
  }

  /** Badge Collector's email hash: sha256(lowercase(nfc(email))), as its SDKs compute it. */
  function hashEmail(email) {
    return sha256Hex(String(email).trim().toLowerCase().normalize('NFC'));
  }

  var BADGE_SITE = 'https://badgecollector.org';

  // ---- Toasts and the list. ----

  var CSS = [
    '.oa-toasts{position:fixed;right:16px;bottom:16px;z-index:2147483000;display:flex;flex-direction:column;gap:8px;pointer-events:none;font:14px/1.3 system-ui,sans-serif}',
    '.oa-toasts.oa-top{bottom:auto;top:16px}',
    '.oa-toasts.oa-left{right:auto;left:16px}',
    '.oa-toasts.oa-center{right:auto;left:50%;transform:translateX(-50%)}',
    '.oa-toast{display:flex;align-items:center;gap:10px;min-width:220px;max-width:320px;padding:10px 12px;border-radius:10px;background:rgba(20,22,28,.94);color:#f4f1e8;box-shadow:0 6px 24px rgba(0,0,0,.35);transform:translateY(12px);opacity:0;transition:transform .25s,opacity .25s}',
    '.oa-toast.oa-in{transform:none;opacity:1}',
    '.oa-toast img,.oa-item img,.oa-badge{width:40px;height:40px;border-radius:8px;flex:none;object-fit:cover}',
    '.oa-badge{display:grid;place-items:center;background:#d9a43a;color:#20160a;font-weight:700;font-size:20px}',
    '.oa-kicker{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#d9a43a}',
    '.oa-title{font-weight:700}',
    '.oa-desc{color:#c9c4b8;font-size:13px}',
    '.oa-shade{position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.55);display:grid;place-items:center;font:14px/1.35 system-ui,sans-serif}',
    '.oa-panel{width:min(520px,92vw);max-height:84vh;overflow:auto;background:#16181e;color:#f4f1e8;border-radius:14px;padding:18px 18px 8px;box-shadow:0 12px 48px rgba(0,0,0,.5)}',
    '.oa-head{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:12px}',
    '.oa-head h2{margin:0;font-size:18px}',
    '.oa-close{background:none;border:0;color:#c9c4b8;font-size:22px;cursor:pointer;line-height:1}',
    '.oa-item{display:flex;gap:12px;align-items:center;padding:10px 0;border-top:1px solid #2a2d36}',
    '.oa-item.oa-locked img,.oa-item.oa-locked .oa-badge{filter:grayscale(1);opacity:.45}',
    '.oa-item.oa-locked .oa-title{color:#a7a294}',
    '.oa-bar{height:5px;border-radius:3px;background:#2a2d36;margin-top:5px;overflow:hidden}',
    '.oa-bar i{display:block;height:100%;background:#d9a43a}',
    '.oa-count{color:#c9c4b8}',
    '.oa-bc{margin:4px 0 10px;padding:12px;border-radius:10px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1)}',
    '.oa-bc p{margin:0 0 8px;opacity:.8;font-size:13px}',
    '.oa-bc p.oa-bc-state{opacity:1;font-size:14px}',
    '.oa-bc form{display:flex;flex-wrap:wrap;gap:8px}',
    '.oa-bc input{flex:1 1 200px;min-width:0;padding:8px 10px;border-radius:8px;border:1px solid #3a3e4a;background:rgba(0,0,0,.3);color:inherit;font:inherit}',
    '.oa-bc button{padding:8px 12px;border-radius:8px;border:0;background:#d9a43a;color:#20160a;font:inherit;font-weight:700;cursor:pointer}',
    '.oa-bc button.oa-quiet{background:none;color:inherit;opacity:.8;font-weight:400;text-decoration:underline;padding:8px 4px}',
    '.oa-bc a{color:#d9a43a}',
    '.oa-bc-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px}',
    '.oa-bc-error{color:#ff8a7a}',
  ].join('\n');

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function badge(v, base) {
    if (v.icon) {
      var img = el('img');
      img.alt = '';
      img.src = new URL(v.icon, base).href;
      return img;
    }
    return el('div', 'oa-badge', '★');
  }

  // ---- The tracker. ----

  function OpenAchievements(opts) {
    this.opts = opts || {};
    this.core = null;
    this.manifest = null;
    this.queue = [];
    this.handlers = { unlock: [], error: [], ready: [], listopen: [], listclose: [] };
    this.platforms = [];
    this.syncing = null;
    this.syncTimer = null;
    var self = this;
    this.ready = this._load().then(
      function () { self._emit('ready', self.view()); return self; },
      function (e) { self._error(e); return self; }
    );
  }

  OpenAchievements.prototype._load = function () {
    var self = this;
    var o = this.opts;
    var manifestUrl = typeof o.manifest === 'string' ? new URL(o.manifest, document.baseURI).href : document.baseURI;
    this.base = manifestUrl;
    var manifestP = typeof o.manifest === 'string'
      ? fetch(manifestUrl).then(function (r) { if (!r.ok) throw new Error('manifest: HTTP ' + r.status); return r.json(); })
      : Promise.resolve(o.manifest);
    var wasmUrl = new URL(o.wasm || 'openachievements.wasm', document.baseURI).href;
    var wasmP = fetch(wasmUrl)
      .then(function (r) { if (!r.ok) throw new Error('wasm: HTTP ' + r.status); return r.arrayBuffer(); })
      .then(function (b) { return WebAssembly.instantiate(b, {}); });
    return Promise.all([manifestP, wasmP]).then(function (got) {
      var manifest = got[0];
      self.core = new Core(got[1].instance);
      self.key = 'openachievements:' + manifest.game;
      var saved = null;
      try { self.saved = window.localStorage.getItem(self.key); saved = JSON.parse(self.saved || 'null'); } catch (e) { saved = null; }
      var r = self.core.call({ op: 'new', manifest: manifest, progress: saved, now: now() });
      self.manifest = manifest;
      self.platforms = [wavedash(), steam(), newgrounds(self.core, manifest), gamejolt(self.core, manifest)]
        .filter(Boolean)
        .filter(function (p) { return o.platforms == null || o.platforms.indexOf(p.name) >= 0; });
      self._badgeCollectorStart();
      var queued = self.queue;
      self.queue = null;
      queued.forEach(function (q) { self[q[0]].apply(self, q[1]); });
      self._changed(r.unlocked);
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'hidden') { self._save(true); self.sync(); }
      });
      window.addEventListener('pagehide', function () { self._save(true); });
      setInterval(function () { self.sync(); }, SYNC_EVERY);
      self.sync();
    });
  };

  OpenAchievements.prototype._emit = function (ev, arg) {
    (this.handlers[ev] || []).forEach(function (f) { try { f(arg); } catch (e) { console.error(e); } });
  };

  OpenAchievements.prototype._error = function (e) {
    console.warn('openachievements:', e && e.message ? e.message : e);
    this._emit('error', e);
  };

  OpenAchievements.prototype._do = function (name, args, req) {
    if (this.queue) { this.queue.push([name, args]); return []; }
    if (!this.core) return [];
    try {
      var r = this.core.call(req);
      this._changed(r.unlocked || []);
      return r.unlocked || [];
    } catch (e) {
      this._error(e);
      return [];
    }
  };

  // Saves the progress when it changed: at once with `now`, else at most once a second.
  OpenAchievements.prototype._save = function (now) {
    var self = this;
    if (!this.core) return;
    if (!now) {
      if (!this.saveTimer) this.saveTimer = setTimeout(function () { self._save(true); }, 1000);
      return;
    }
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    try {
      var text = JSON.stringify(this.core.call({ op: 'progress' }));
      if (text !== this.saved) {
        window.localStorage.setItem(this.key, text);
        this.saved = text;
      }
    } catch (e) { /* private mode, or full */ }
  };

  OpenAchievements.prototype._changed = function (unlocked) {
    // An unlock is saved at once; counts can wait a second.
    this._save(unlocked.length > 0);
    if (!unlocked.length) return;
    var self = this;
    var views = this.view();
    unlocked.forEach(function (id) {
      var v = views.filter(function (x) { return x.id === id; })[0];
      if (!v) return;
      self._emit('unlock', v);
      self._toast(v);
    });
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(function () { self.sync(); }, 1500);
  };

  // ---- Badge Collector: the player's opt-in, kept as the email's hash only. ----

  OpenAchievements.prototype._badgeCollectorOffered = function () {
    var o = this.opts;
    return !!(this.manifest && this.manifest.platforms && this.manifest.platforms.badgecollector) &&
      (o.platforms == null || o.platforms.indexOf('badgecollector') >= 0);
  };

  OpenAchievements.prototype._badgeCollectorKey = function () {
    return this.key + ':badgecollector';
  };

  OpenAchievements.prototype._badgeCollectorStart = function () {
    if (!this._badgeCollectorOffered()) return;
    var hash = null;
    try { hash = window.localStorage.getItem(this._badgeCollectorKey()); } catch (e) { hash = null; }
    if (hash && /^[0-9a-f]{64}$/.test(hash)) this.platforms.push(badgeCollector(this.core, hash));
  };

  /** The Badge Collector wall the player's badges go to, or null when they have not opted in. */
  OpenAchievements.prototype.badgeCollectorWall = function () {
    var p = this._badgeCollector();
    return p ? BADGE_SITE + '/m/' + p.hash + '/' : null;
  };

  OpenAchievements.prototype._badgeCollector = function () {
    return this.platforms.filter(function (p) { return p.name === 'badgecollector'; })[0] || null;
  };

  /**
   * Starts collecting the achievements as badges on Badge Collector for this email: only its hash
   * is kept (in localStorage) and sent. Every achievement unlocked so far goes too. Resolves to
   * the player's wall.
   */
  OpenAchievements.prototype.collectBadges = function (email) {
    var self = this;
    if (!this.core || !this._badgeCollectorOffered()) return Promise.reject(new Error('badgecollector: not offered by this game'));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim())) return Promise.reject(new Error('That does not look like an email address.'));
    return hashEmail(email).then(function (hash) {
      self.stopCollectingBadges();
      try { window.localStorage.setItem(self._badgeCollectorKey(), hash); } catch (e) { /* kept for this visit only */ }
      self.platforms.push(badgeCollector(self.core, hash));
      // After a sync already running (it started without this platform).
      Promise.resolve(self.syncing).then(function () { return self.sync(); });
      return BADGE_SITE + '/m/' + hash + '/';
    });
  };

  /**
   * Stops collecting badges and forgets the email's hash, with the record of what was sent for it
   * (badges already pinned stay pinned; opting in again sends them again, as duplicates).
   */
  OpenAchievements.prototype.stopCollectingBadges = function () {
    var self = this;
    try { window.localStorage.removeItem(this._badgeCollectorKey()); } catch (e) { /* nothing kept */ }
    this.platforms.forEach(function (p) {
      if (p.name !== 'badgecollector' || !self.core) return;
      p.stopped = true;
      try { self.core.call({ op: 'forget', account: p.account() }); } catch (e) { self._error(e); }
    });
    this.platforms = this.platforms.filter(function (p) { return p.name !== 'badgecollector'; });
    this._save(true);
  };

  /** How many unlocked achievements reached Badge Collector, and how many wait: {sent, waiting}. */
  OpenAchievements.prototype._badgeCollectorCounts = function () {
    var p = this._badgeCollector();
    if (!p) return null;
    try {
      var progress = this.core.call({ op: 'progress' });
      var synced = (progress.synced || {})[p.account()];
      // Before the first sync every unlock waits.
      if (!synced) return { sent: 0, waiting: Object.keys(progress.unlocked || {}).length };
      var pending = this.core.call({ op: 'pending', platform: 'badgecollector', account: p.account() });
      return { sent: (synced.unlocked || []).length, waiting: pending.length };
    } catch (e) { return null; }
  };

  // The panel's Badge Collector box: an offer, the email form, or the state and a way out.
  OpenAchievements.prototype._badgeCollectorBox = function (opened) {
    var self = this;
    var o = this.opts;
    var box = el('div', 'oa-bc');
    function render(mode, message) {
      box.textContent = '';
      var p = self._badgeCollector();
      if (p) {
        var c = self._badgeCollectorCounts() || { sent: 0, waiting: 0 };
        box.appendChild(el('p', 'oa-bc-state', o.badgeLinkedText || 'Collecting these as badges on Badge Collector.'));
        box.appendChild(el('p', null, c.waiting
          ? c.sent + ' sent, ' + c.waiting + ' on the way. Badges show on your wall a few minutes after they are sent.'
          : (c.sent ? c.sent + ' sent. ' : '') + 'New ones are sent as you unlock them and show on your wall a few minutes later.'));
        var row = el('div', 'oa-bc-row');
        var wall = el('a', null, 'Your badge wall ↗');
        wall.href = BADGE_SITE + '/m/' + p.hash + '/';
        wall.target = '_blank';
        wall.rel = 'noopener';
        var stop = el('button', 'oa-quiet', 'Stop collecting');
        stop.type = 'button';
        stop.addEventListener('click', function () { self.stopCollectingBadges(); render('offer'); });
        row.appendChild(wall);
        row.appendChild(stop);
        box.appendChild(row);
        return;
      }
      if (mode === 'form') {
        box.appendChild(el('p', null, o.badgeExplainText ||
          'Your email is hashed on this device and only the hash is sent: your achievements become badges on a public wall at badgecollector.org, a few minutes after each unlock.'));
        var form = el('form');
        form.noValidate = true; // our message, not the browser's bubble (hidden in some frames)
        var input = el('input');
        input.type = 'email';
        input.required = true;
        input.autocomplete = 'email';
        input.placeholder = 'you@example.com';
        input.setAttribute('aria-label', 'Email');
        var go = el('button', null, 'Collect');
        go.type = 'submit';
        var cancel = el('button', 'oa-quiet', 'Cancel');
        cancel.type = 'button';
        cancel.addEventListener('click', function () { render('offer'); });
        form.appendChild(input);
        form.appendChild(go);
        form.appendChild(cancel);
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          go.disabled = true;
          self.collectBadges(input.value).then(function () { render(); }, function (err) {
            go.disabled = false;
            render('form', err && err.message ? err.message : String(err));
          });
        });
        box.appendChild(form);
        if (message) box.appendChild(el('p', 'oa-bc-error', message));
        setTimeout(function () { (box.querySelector('input') || {}).focus && box.querySelector('input').focus(); }, 0);
        return;
      }
      var offer = el('button', null, o.badgeOfferText || 'Collect these as badges on Badge Collector');
      offer.type = 'button';
      offer.addEventListener('click', function () { render('form'); });
      box.appendChild(offer);
    }
    render(opened ? 'form' : 'offer');
    // The counts change as awards go out: refreshed while the panel is open.
    var timer = setInterval(function () {
      if (!box.isConnected) { clearInterval(timer); return; }
      if (self._badgeCollector() && !box.querySelector('form')) render();
    }, 2000);
    return box;
  };

  OpenAchievements.prototype._toast = function (v) {
    var o = this.opts;
    if (o.toasts === false) return;
    if (o.toasts !== true && this.platforms.some(function (p) { return p.shows; })) return;
    this._css();
    var box = document.querySelector('.oa-toasts');
    if (!box) {
      // toastPosition: 'bottom-right' (default), 'bottom-left', 'bottom', 'top-right', 'top-left', 'top'.
      var pos = String(o.toastPosition || 'bottom-right');
      var cls = 'oa-toasts';
      if (pos.indexOf('top') === 0) cls += ' oa-top';
      if (/left$/.test(pos)) cls += ' oa-left';
      else if (!/right$/.test(pos)) cls += ' oa-center';
      box = el('div', cls);
      document.body.appendChild(box);
    }
    var t = el('div', 'oa-toast');
    t.setAttribute('role', 'status');
    var text = el('div');
    text.appendChild(el('div', 'oa-kicker', o.unlockedText || 'Achievement unlocked'));
    text.appendChild(el('div', 'oa-title', v.title));
    text.appendChild(el('div', 'oa-desc', v.description));
    t.appendChild(badge(v, this.base));
    t.appendChild(text);
    box.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('oa-in'); });
    setTimeout(function () {
      t.classList.remove('oa-in');
      setTimeout(function () { t.remove(); }, 300);
    }, 4500);
  };

  OpenAchievements.prototype._css = function () {
    if (document.getElementById('oa-css')) return;
    var s = el('style');
    s.id = 'oa-css';
    s.textContent = CSS;
    // First in <head>, so the game's own rules for .oa-* win at equal specificity.
    document.head.insertBefore(s, document.head.firstChild);
  };

  /** Adds to a `total` stat. Returns the achievements this unlocked (none while loading). */
  OpenAchievements.prototype.add = function (stat, by) {
    return this._do('add', arguments, { op: 'add', stat: stat, by: by == null ? 1 : by, now: now() });
  };

  /** Raises a stat to at least `value` (a `best`, or a count the game keeps itself). */
  OpenAchievements.prototype.set = function (stat, value) {
    return this._do('set', arguments, { op: 'set', stat: stat, value: value, now: now() });
  };

  /** Unlocks an achievement. */
  OpenAchievements.prototype.unlock = function (id) {
    return this._do('unlock', arguments, { op: 'unlock', id: id, now: now() });
  };

  /** Every achievement: {id, title, description, secret, icon, unlocked, progress: [value, threshold]}. */
  OpenAchievements.prototype.view = function () {
    if (!this.core) return [];
    try { return this.core.call({ op: 'view' }); } catch (e) { this._error(e); return []; }
  };

  /** on('unlock' | 'error' | 'ready' | 'listopen' | 'listclose', fn) */
  OpenAchievements.prototype.on = function (ev, fn) {
    (this.handlers[ev] = this.handlers[ev] || []).push(fn);
    return this;
  };

  /** Reads every platform, merges, and tells each what it lacks. Resolves when done. */
  OpenAchievements.prototype.sync = function () {
    var self = this;
    if (!this.core || this.syncing) return this.syncing || Promise.resolve();
    this.syncing = this.platforms.reduce(function (p, platform) {
      return p.then(function () { return self._syncOne(platform); }).catch(function (e) { self._error(e); });
    }, Promise.resolve()).then(function () { self.syncing = null; });
    return this.syncing;
  };

  OpenAchievements.prototype._syncOne = function (platform) {
    var self = this;
    var core = this.core;
    return withTimeout(platform.read(this.manifest), platform.name).then(function (remote) {
      return Promise.resolve(platform.account()).then(function (account) {
        var r = core.call({ op: 'merge', account: account, remote: remote, now: now() });
        // Earned elsewhere: saved here too, without a toast.
        self._save(true);
        if (r.unlocked.length) r.unlocked.forEach(function (id) { self._emit('unlock', self.view().filter(function (v) { return v.id === id; })[0]); });
        var ops = core.call({ op: 'pending', platform: platform.name, account: account });
        var wrote = false;
        if (platform.writeAll) {
          return platform.writeAll(ops, function (op) {
            core.call({ op: 'done', account: account, done: op });
            self._save(true);
          });
        }
        return ops.reduce(function (p, op) {
          return p.then(function () {
            return Promise.resolve(platform.write(op)).then(function (ok) {
              if (ok) { core.call({ op: 'done', account: account, done: op }); wrote = true; }
            });
          });
        }, Promise.resolve()).then(function () {
          self._save(true);
          if (wrote) return platform.flush();
        });
      });
    });
  };

  /** Shows every achievement in a panel over the game (Esc or a click outside closes it). */
  OpenAchievements.prototype.showList = function () {
    var self = this;
    if (!this.core) {
      if (!this.listWanted) {
        this.listWanted = true;
        this.ready.then(function () { if (self.listWanted) { self.listWanted = false; self.showList(); } });
      }
      return;
    }
    if (this.isListOpen()) return;
    this._css();
    var o = this.opts;
    var views = this.view();
    var got = views.filter(function (v) { return v.unlocked != null; }).length;
    var shade = el('div', 'oa-shade');
    var panel = el('div', 'oa-panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', o.listTitle || 'Achievements');
    var head = el('div', 'oa-head');
    var h = el('h2', null, o.listTitle || 'Achievements');
    var count = el('span', 'oa-count', ' ' + got + ' / ' + views.length);
    h.appendChild(count);
    var close = el('button', 'oa-close', '×');
    close.setAttribute('aria-label', 'Close');
    head.appendChild(h);
    head.appendChild(close);
    panel.appendChild(head);
    if (this._badgeCollectorOffered()) panel.appendChild(this._badgeCollectorBox());
    var base = this.base;
    views.forEach(function (v) {
      var hidden = v.secret && v.unlocked == null;
      var item = el('div', 'oa-item' + (v.unlocked == null ? ' oa-locked' : ''));
      item.appendChild(hidden ? el('div', 'oa-badge', '?') : badge(v, base));
      var text = el('div');
      text.style.flex = '1';
      text.appendChild(el('div', 'oa-title', hidden ? (o.secretTitle || 'Secret achievement') : v.title));
      text.appendChild(el('div', 'oa-desc', hidden ? (o.secretText || 'Keep playing to find it.') : v.description));
      if (!hidden && v.unlocked == null && v.progress && v.progress[1] > 1) {
        var bar = el('div', 'oa-bar');
        var fill = el('i');
        fill.style.width = Math.round(100 * v.progress[0] / v.progress[1]) + '%';
        bar.appendChild(fill);
        bar.title = v.progress[0] + ' / ' + v.progress[1];
        text.appendChild(bar);
      }
      item.appendChild(text);
      panel.appendChild(item);
    });
    shade.appendChild(panel);
    function done() {
      shade.remove();
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      self.closeList = null;
      self._emit('listclose');
    }
    // While the panel is open the game hears no keys; Esc closes it. Tab and Enter still move and
    // press inside the panel (only the game's listeners are skipped).
    function onKey(e) {
      if (!shade.contains(e.target)) e.stopImmediatePropagation();
      else e.stopPropagation();
      if (e.type === 'keydown' && e.key === 'Escape') { e.preventDefault(); done(); }
    }
    shade.addEventListener('click', function (e) { if (e.target === shade) done(); });
    close.addEventListener('click', done);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    document.body.appendChild(shade);
    this.closeList = done;
    this._emit('listopen');
    close.focus();
  };

  /** Closes the list, if open. */
  OpenAchievements.prototype.hideList = function () {
    this.listWanted = false;
    if (this.closeList) this.closeList();
  };

  /** Whether the list is open. */
  OpenAchievements.prototype.isListOpen = function () {
    return !!this.closeList;
  };

  /** Opens the list, or closes it if open (for a toolbar button or a key). */
  OpenAchievements.prototype.toggleList = function () {
    if (this.isListOpen() || this.listWanted) this.hideList();
    else this.showList();
  };

  window.OpenAchievements = {
    /**
     * Starts tracking. Options: manifest (URL or object), wasm (URL of openachievements.wasm),
     * toasts (true / false / unset: shown unless the platform shows its own), toastPosition
     * ('bottom-right' by default, 'bottom-left', 'bottom', 'top-right', 'top-left', 'top'), platforms (names
     * to report to; all that are present by default), unlockedText, listTitle, secretTitle,
     * secretText, badgeOfferText, badgeExplainText, badgeLinkedText (for translations). Also sets
     * `window.openachievements`.
     */
    start: function (opts) {
      var t = new OpenAchievements(opts);
      window.openachievements = t;
      return t;
    },
  };
})();
