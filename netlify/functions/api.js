const crypto = require('crypto');
let storePromise;
let localStore;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createLocalStore() {
  const records = new Map();
  return {
    async get(key, options = {}) {
      const value = records.get(key);
      if (value == null) return null;
      return options.type === 'json' ? clone(value) : JSON.stringify(value);
    },
    async setJSON(key, value) {
      records.set(key, clone(value));
    }
  };
}

async function getRoomStore() {
  if (!storePromise) {
    storePromise = import('@netlify/blobs').then(({ getStore }) => {
      const hasManualCredentials = process.env.NETLIFY_SITE_ID && process.env.NETLIFY_AUTH_TOKEN;

      // Netlify Dev does not always inject the Blobs context when a project is
      // not linked to a site. Keep local testing usable without weakening the
      // production path, which still requires Netlify Blobs for persistence.
      if (process.env.LUCKY_DRAW_LOCAL_STORE === 'true' && !process.env.NETLIFY_BLOBS_CONTEXT && !hasManualCredentials) {
        localStore ||= createLocalStore();
        return localStore;
      }

      const options = { name: 'lucky-draw-rooms', consistency: 'strong' };
      if (hasManualCredentials) {
        options.siteID = process.env.NETLIFY_SITE_ID;
        options.token = process.env.NETLIFY_AUTH_TOKEN;
      }
      return getStore(options);
    }).catch(error => {
      storePromise = null;
      throw error;
    });
  }
  return storePromise;
}

function response(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*'
    },
    body: JSON.stringify(payload)
  };
}

function publicRoom(room) {
  return {
    id: room.id,
    status: room.status,
    createdAt: room.createdAt,
    endsAt: room.endsAt,
    participants: room.participants.map(({ token, ...participant }) => participant),
    participantCount: room.participants.length,
    winner: room.winner ? { name: room.winner.name, joinedAt: room.winner.joinedAt } : null
  };
}

function origin(event) {
  const headers = event.headers || {};
  const host = headers.host || headers.Host || 'localhost';
  const proto = headers['x-forwarded-proto'] || headers['X-Forwarded-Proto'] || 'https';
  return `${proto}://${host}`;
}

function parsePath(event) {
  const raw = event.path || new URL(event.rawUrl || 'https://localhost/').pathname;
  return raw.replace(/^\/\.netlify\/functions\/api/, '').replace(/^\/api/, '') || '/';
}

function readBody(event) {
  if (!event.body) return {};
  try { return JSON.parse(event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body); } catch { return {}; }
}

async function loadRoom(id) {
  const store = await getRoomStore();
  const room = await store.get(id, { type: 'json' });
  if (!room) return null;
  if (room.status === 'open' && Date.now() >= room.endsAt) { room.status = 'closed'; room.closedReason = 'timeout'; await store.setJSON(id, room); }
  return room;
}

exports.handler = async event => {
  const path = parsePath(event), method = event.httpMethod || 'GET';
  if (method === 'OPTIONS') return response(204, {});

  try {
    const store = await getRoomStore();
    const parts = path.split('/').filter(Boolean);

    if (method === 'POST' && parts.length === 1 && parts[0] === 'rooms') {
      const body = readBody(event), requestedMinutes = Number(body.minutes);
      if (!Number.isFinite(requestedMinutes) || requestedMinutes < 1) return response(400, { error: 'กรุณากรอกเวลาอย่างน้อย 1 นาที' });
      const minutes = Math.min(180, requestedMinutes);
      const id = crypto.randomBytes(4).toString('hex'), now = Date.now();
      const room = { id, createdAt: now, endsAt: now + minutes * 60000, status: 'open', participants: [], winner: null };
      await store.setJSON(id, room);
      return response(201, { room: publicRoom(room), joinUrl: `${origin(event)}/?join=${id}` });
    }

    const id = parts[0] === 'rooms' ? parts[1] : null, action = parts[2];
    if (!id) return response(404, { error: 'ไม่พบเส้นทางนี้' });
    const room = await loadRoom(id);
    if (!room) return response(404, { error: 'ไม่พบรอบนี้แล้ว' });
    if (method === 'GET' && !action) return response(200, { room: publicRoom(room) });

    if (method === 'POST' && action === 'participants') {
      if (room.status !== 'open') return response(409, { error: 'รอบนี้ปิดรับชื่อแล้ว', room: publicRoom(room) });
      const body = readBody(event), name = String(body.name || '').trim().replace(/\s+/g, ' '), token = String(body.token || '').trim();
      if (name.length < 1 || name.length > 40) return response(400, { error: 'ชื่อควรมี 1–40 ตัวอักษร' });
      if (!token) return response(400, { error: 'ไม่พบรหัสอุปกรณ์ กรุณาลองใหม่' });
      const existing = room.participants.find(item => item.token === token);
      if (!existing) room.participants.push({ token, name, joinedAt: Date.now() });
      await store.setJSON(id, room);
      const participant = existing || room.participants[room.participants.length - 1];
      return response(existing ? 200 : 201, { participant: { name: participant.name, joinedAt: participant.joinedAt }, room: publicRoom(room) });
    }

    if (method === 'POST' && action === 'close') {
      if (room.status !== 'open') return response(409, { error: 'รอบนี้ปิดไปแล้ว', room: publicRoom(room) });
      room.status = 'closed'; room.closedReason = 'host'; await store.setJSON(id, room); return response(200, { room: publicRoom(room) });
    }

    if (method === 'POST' && action === 'draw') {
      if (room.status === 'open') room.status = 'closed';
      if (room.status === 'drawn') return response(200, { room: publicRoom(room) });
      if (!room.participants.length) return response(409, { error: 'ยังไม่มีชื่อให้สุ่ม', room: publicRoom(room) });
      room.winner = room.participants[crypto.randomInt(room.participants.length)]; room.status = 'drawn'; await store.setJSON(id, room); return response(200, { room: publicRoom(room) });
    }

    return response(404, { error: 'ไม่พบเส้นทางนี้' });
  } catch (error) {
    console.error('Lucky Draw API error:', error);
    const missingBlobs = error?.name === 'MissingBlobsEnvironmentError' || /Netlify Blobs/i.test(error?.message || '');
    return response(missingBlobs ? 503 : 500, {
      error: missingBlobs
        ? 'ระบบเก็บข้อมูลของ Netlify ยังไม่พร้อม กรุณา deploy ทั้ง repository ที่มีโฟลเดอร์ netlify/functions'
        : 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง',
      code: missingBlobs ? 'BLOBS_NOT_CONFIGURED' : 'API_ERROR'
    });
  }
};
