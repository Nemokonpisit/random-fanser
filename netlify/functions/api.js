const crypto = require('crypto');
const { getStore } = require('@netlify/blobs');

const store = getStore({ name: 'lucky-draw-rooms', consistency: 'strong' });

function response(statusCode, payload) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
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
  const room = await store.get(id, { type: 'json' });
  if (!room) return null;
  if (room.status === 'open' && Date.now() >= room.endsAt) { room.status = 'closed'; room.closedReason = 'timeout'; await store.setJSON(id, room); }
  return room;
}

exports.handler = async event => {
  const path = parsePath(event), method = event.httpMethod || 'GET';
  if (method === 'OPTIONS') return { statusCode: 204, headers: { 'access-control-allow-origin': '*' } };
  const parts = path.split('/').filter(Boolean);

  if (method === 'POST' && parts.length === 1 && parts[0] === 'rooms') {
    const body = readBody(event), minutes = Math.max(1, Math.min(180, Number(body.minutes) || 0));
    if (!minutes) return response(400, { error: 'กรุณากรอกเวลาอย่างน้อย 1 นาที' });
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
};
