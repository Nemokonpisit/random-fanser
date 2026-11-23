import { randomBytes, randomInt } from 'node:crypto';
import { getStore } from '@netlify/blobs';

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
    storePromise = Promise.resolve().then(() => {
      const hasManualCredentials = process.env.NETLIFY_SITE_ID && process.env.NETLIFY_AUTH_TOKEN;

      if (process.env.LUCKY_DRAW_LOCAL_STORE === 'true' && !process.env.NETLIFY_BLOBS_CONTEXT && !hasManualCredentials) {
        localStore ||= createLocalStore();
        return localStore;
      }

      return getStore({ name: 'lucky-draw-rooms', consistency: 'strong' });
    }).catch(error => {
      storePromise = null;
      throw error;
    });
  }
  return storePromise;
}

function response(statusCode, payload) {
  const headers = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type'
  };
  if (statusCode === 204) return new Response(null, { status: statusCode, headers });
  return new Response(JSON.stringify(payload), { status: statusCode, headers });
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

function origin(request) {
  const url = new URL(request.url);
  const host = request.headers.get('host') || url.host;
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const proto = forwardedProto ? forwardedProto.split(',')[0].trim() : url.protocol.replace(':', '');
  return proto + '://' + host;
}

function parsePath(pathname) {
  return pathname.replace(/^\/\.netlify\/functions\/api/, '').replace(/^\/api/, '') || '/';
}

async function readBody(request) {
  if (!request.body) return {};
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body : {};
  } catch {
    return {};
  }
}

async function loadRoom(id) {
  const store = await getRoomStore();
  const room = await store.get(id, { type: 'json' });
  if (!room) return null;
  if (room.status === 'open' && Date.now() >= room.endsAt) {
    room.status = 'closed';
    room.closedReason = 'timeout';
    await store.setJSON(id, room);
  }
  return room;
}

export default async function handler(request) {
  const path = parsePath(new URL(request.url).pathname);
  const method = request.method || 'GET';

  if (method === 'OPTIONS') return response(204, {});

  try {
    const store = await getRoomStore();
    const parts = path.split('/').filter(Boolean);

    if (method === 'POST' && parts.length === 1 && parts[0] === 'rooms') {
      const body = await readBody(request);
      const requestedMinutes = Number(body.minutes);
      if (!Number.isFinite(requestedMinutes) || requestedMinutes < 1) {
        return response(400, { error: 'กรุณากรอกเวลาอย่างน้อย 1 นาที' });
      }
      const minutes = Math.min(180, requestedMinutes);
      const id = randomBytes(4).toString('hex');
      const now = Date.now();
      const room = {
        id,
        createdAt: now,
        endsAt: now + minutes * 60000,
        status: 'open',
        participants: [],
        winner: null
      };
      await store.setJSON(id, room);
      return response(201, { room: publicRoom(room), joinUrl: origin(request) + '/?join=' + id });
    }

    const id = parts[0] === 'rooms' ? parts[1] : null;
    const action = parts[2];
    if (!id) return response(404, { error: 'ไม่พบเส้นทางนี้' });

    const room = await loadRoom(id);
    if (!room) return response(404, { error: 'ไม่พบรอบนี้แล้ว' });
    if (method === 'GET' && !action) return response(200, { room: publicRoom(room) });

    if (method === 'POST' && action === 'participants') {
      if (room.status !== 'open') return response(409, { error: 'รอบนี้ปิดรับชื่อแล้ว', room: publicRoom(room) });
      const body = await readBody(request);
      const name = String(body.name || '').trim().replace(/\s+/g, ' ');
      const token = String(body.token || '').trim();
      if (name.length < 1 || name.length > 40) return response(400, { error: 'ชื่อควรมี 1–40 ตัวอักษร' });
      if (!token) return response(400, { error: 'ไม่พบรหัสอุปกรณ์ กรุณาลองใหม่' });
      const existing = room.participants.find(item => item.token === token);
      if (!existing) room.participants.push({ token, name, joinedAt: Date.now() });
      await store.setJSON(id, room);
      const participant = existing || room.participants[room.participants.length - 1];
      return response(existing ? 200 : 201, {
        participant: { name: participant.name, joinedAt: participant.joinedAt },
        room: publicRoom(room)
      });
    }

    if (method === 'POST' && action === 'close') {
      if (room.status !== 'open') return response(409, { error: 'รอบนี้ปิดไปแล้ว', room: publicRoom(room) });
      room.status = 'closed';
      room.closedReason = 'host';
      await store.setJSON(id, room);
      return response(200, { room: publicRoom(room) });
    }

    if (method === 'POST' && action === 'draw') {
      if (room.status === 'open') room.status = 'closed';
      if (room.status === 'drawn') return response(200, { room: publicRoom(room) });
      if (!room.participants.length) return response(409, { error: 'ยังไม่มีชื่อให้สุ่ม', room: publicRoom(room) });
      room.winner = room.participants[randomInt(room.participants.length)];
      room.status = 'drawn';
      await store.setJSON(id, room);
      return response(200, { room: publicRoom(room) });
    }

    return response(404, { error: 'ไม่พบเส้นทางนี้' });
  } catch (error) {
    console.error('Lucky Draw API error:', error);
    const missingBlobs = error?.name === 'MissingBlobsEnvironmentError' || /Netlify Blobs/i.test(error?.message || '');
    return response(missingBlobs ? 503 : 500, {
      error: missingBlobs
        ? 'ระบบเก็บข้อมูลของ Netlify ยังไม่พร้อม กรุณา deploy ฟังก์ชันแบบ Netlify Functions v2'
        : 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง',
      code: missingBlobs ? 'BLOBS_NOT_CONFIGURED' : 'API_ERROR'
    });
  }
}
