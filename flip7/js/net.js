/*
 * Netwerklaag: WebRTC via PeerJS.
 * Eén telefoon is de host (die heeft de echte spelstand), de rest verbindt
 * met een kamercode. Er is dus geen eigen server nodig - alleen de publieke
 * PeerJS-signaalserver om de telefoons aan elkaar te knopen.
 */

// Eerst de meegeleverde kopie, daarna een CDN als die om wat voor reden
// dan ook niet geladen kan worden.
const SOURCES = [
  new URL('../vendor/peerjs-1.5.4.min.js', import.meta.url).href,
  'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js',
  'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js',
];

const PREFIX = 'flip7-r-';

/**
 * Standaard loopt het koppelen via de gratis PeerJS-server. Wie een eigen
 * signaalserver draait, kan die meegeven met ?peer=host:poort in de URL
 * (voeg :onveilig toe voor http in plaats van https).
 */
function peerOptions() {
  const raw = new URLSearchParams(location.search).get('peer');
  if (!raw) return undefined;
  const [host, port, insecure] = raw.split(':');
  return {
    host,
    port: Number(port) || 9000,
    path: '/',
    secure: insecure !== 'onveilig',
  };
}
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // zonder I/O/0/1

export function randomCode(len = 4) {
  let out = '';
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  for (const b of buf) out += ALPHABET[b % ALPHABET.length];
  return out;
}

let peerLib = null;

export async function loadPeerLib() {
  if (peerLib) return peerLib;
  if (window.Peer) return (peerLib = window.Peer);
  let lastErr;
  for (const src of SOURCES) {
    try {
      await new Promise((res, rej) => {
        const el = document.createElement('script');
        el.src = src;
        el.onload = res;
        el.onerror = () => rej(new Error('kon ' + src + ' niet laden'));
        document.head.appendChild(el);
      });
      if (window.Peer) return (peerLib = window.Peer);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    'De verbindingsbibliotheek kon niet geladen worden. Ben je online? ' + (lastErr?.message || ''),
  );
}

function newPeer(Peer, id) {
  return new Promise((resolve, reject) => {
    const opts = peerOptions();
    const peer = id ? new Peer(id, opts) : new Peer(opts);
    const done = (fn, arg) => {
      peer.off('open', onOpen);
      peer.off('error', onErr);
      fn(arg);
    };
    const onOpen = () => done(resolve, peer);
    const onErr = (err) => {
      done(reject, err);
      try {
        peer.destroy();
      } catch {}
    };
    peer.on('open', onOpen);
    peer.on('error', onErr);
  });
}

/* -------------------------------------------------------------------- host */

/**
 * Opent een kamer. `onMessage(fromToken, msg)` en `onLeave(token)` worden
 * aangeroepen voor gasten; `send`/`broadcast` gaan de andere kant op.
 */
export async function startHost({ onJoin, onMessage, onLeave, onStatus }) {
  const Peer = await loadPeerLib();
  let peer = null;
  let code = null;

  for (let attempt = 0; attempt < 6 && !peer; attempt++) {
    const candidate = randomCode();
    try {
      peer = await newPeer(Peer, PREFIX + candidate);
      code = candidate;
    } catch (err) {
      if (err?.type !== 'unavailable-id') throw asFriendly(err);
    }
  }
  if (!peer) throw new Error('Geen vrije kamercode gevonden. Probeer het nog eens.');

  const conns = new Map(); // token -> DataConnection

  peer.on('connection', (conn) => {
    let token = null;
    conn.on('data', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'hello') {
        token = String(msg.token || '').slice(0, 64);
        if (!token) return conn.send({ t: 'denied', reason: 'Ongeldige aanmelding.' });
        const old = conns.get(token);
        if (old && old !== conn) {
          try {
            old.close();
          } catch {}
        }
        conns.set(token, conn);
        onJoin(token, String(msg.name || 'Speler').slice(0, 16), conn);
        return;
      }
      if (token) onMessage(token, msg);
    });
    conn.on('close', () => {
      if (token && conns.get(token) === conn) {
        conns.delete(token);
        onLeave(token);
      }
    });
    conn.on('error', () => {});
  });

  peer.on('disconnected', () => {
    onStatus?.('reconnecting');
    try {
      peer.reconnect();
    } catch {}
  });
  peer.on('open', () => onStatus?.('online'));
  peer.on('error', (err) => onStatus?.('error', asFriendly(err).message));
  onStatus?.('online'); // 'open' is al gebeurd voordat we meelazen

  return {
    code,
    isHost: true,
    send(token, msg) {
      const conn = conns.get(token);
      if (conn?.open) conn.send(msg);
    },
    broadcast(msg) {
      for (const conn of conns.values()) if (conn.open) conn.send(msg);
    },
    close() {
      for (const conn of conns.values()) {
        try {
          conn.close();
        } catch {}
      }
      try {
        peer.destroy();
      } catch {}
    },
  };
}

/* -------------------------------------------------------------------- gast */

export async function joinRoom({ code, token, name, onMessage, onStatus }) {
  const Peer = await loadPeerLib();
  const peer = await newPeer(Peer).catch((err) => {
    throw asFriendly(err);
  });

  const connect = () =>
    new Promise((resolve, reject) => {
      const conn = peer.connect(PREFIX + code.toUpperCase(), { reliable: true });
      const timer = setTimeout(
        () => reject(new Error('Geen antwoord van de kamer. Klopt de code, en is het spel nog open?')),
        15000,
      );
      conn.on('open', () => {
        clearTimeout(timer);
        conn.send({ t: 'hello', token, name });
        resolve(conn);
      });
      conn.on('error', (err) => {
        clearTimeout(timer);
        reject(asFriendly(err));
      });
    });

  let conn = await connect();
  let closed = false;

  const wire = (c) => {
    c.on('data', (msg) => msg && typeof msg === 'object' && onMessage(msg));
    c.on('close', async () => {
      if (closed) return;
      onStatus?.('reconnecting');
      for (let i = 0; i < 5 && !closed; i++) {
        await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
        try {
          conn = await connect();
          wire(conn);
          onStatus?.('online');
          return;
        } catch {}
      }
      if (!closed) onStatus?.('offline');
    });
  };
  wire(conn);
  peer.on('error', (err) => onStatus?.('error', asFriendly(err).message));
  onStatus?.('online');

  return {
    code: code.toUpperCase(),
    isHost: false,
    send(msg) {
      if (conn?.open) conn.send(msg);
    },
    close() {
      closed = true;
      try {
        peer.destroy();
      } catch {}
    },
  };
}

function asFriendly(err) {
  const map = {
    'peer-unavailable': 'Die kamer bestaat niet (meer). Controleer de code.',
    'network': 'Geen verbinding met de signaalserver. Check je internet.',
    'server-error': 'De signaalserver antwoordt niet. Probeer het straks nog eens.',
    'browser-incompatible': 'Deze browser ondersteunt WebRTC niet.',
    'webrtc': 'De verbinding tussen de telefoons mislukte.',
    'unavailable-id': 'Die kamercode is al in gebruik.',
  };
  const msg = map[err?.type] || err?.message || 'Onbekende verbindingsfout.';
  const out = new Error(msg);
  out.type = err?.type;
  return out;
}
