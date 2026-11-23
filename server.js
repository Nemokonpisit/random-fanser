const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3125);
const PUBLIC_DIR = path.join(__dirname, 'public');
const rooms = new Map();

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

function noContent(res, status = 204) {
  res.writeHead(status, { 'Access-Control-Allow-Origin': '*' });
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 32 * 1024) reject(new Error('payload too large'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

function lanAddress() {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const item of entries || []) {
      if (item.family === 'IPv4' && !item.internal) return item.address;
    }
  }
  return 'localhost';
}

function publicOrigin(req) {
  const forwarded = req.headers['x-forwarded-proto'];
  const proto = forwarded ? String(forwarded).split(',')[0].trim() : 'http';
  let host = req.headers.host || `localhost:${PORT}`;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)) host = `${lanAddress()}:${PORT}`;
  return `${proto}://${host}`;
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

function emit(room, type = 'room') {
  const message = `event: ${type}\ndata: ${JSON.stringify(publicRoom(room))}\n\n`;
  for (const client of room.clients) {
    try { client.write(message); } catch { room.clients.delete(client); }
  }
}

function closeRoom(room, reason = 'host') {
  if (room.status !== 'open') return false;
  room.status = 'closed';
  room.closedReason = reason;
  clearTimeout(room.timer);
  emit(room, 'room');
  return true;
}

function getRoom(id) {
  const room = rooms.get(id);
  if (!room) return null;
  if (room.status === 'open' && Date.now() >= room.endsAt) closeRoom(room, 'timeout');
  return room;
}

function routeId(pathname, suffix = '') {
  const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = pathname.match(new RegExp(`^/api/rooms/([a-z0-9]+)${escaped}$`, 'i'));
  return match && match[1];
}

async function handleApi(req, res, pathname) {
  if (req.method === 'OPTIONS') return noContent(res);

  if (req.method === 'POST' && pathname === '/api/rooms') {
    try {
      const body = await readBody(req);
      const minutes = Math.max(1, Math.min(180, Number(body.minutes) || 0));
      if (!minutes) return json(res, 400, { error: 'กรุณากรอกเวลาอย่างน้อย 1 นาที' });
      const id = crypto.randomBytes(4).toString('hex');
      const now = Date.now();
      const room = {
        id,
        createdAt: now,
        endsAt: now + minutes * 60 * 1000,
        status: 'open',
        participants: [],
        winner: null,
        clients: new Set(),
        timer: null
      };
      room.timer = setTimeout(() => closeRoom(room, 'timeout'), minutes * 60 * 1000 + 250);
      rooms.set(id, room);
      return json(res, 201, {
        room: publicRoom(room),
        joinUrl: `${publicOrigin(req)}/?join=${id}`
      });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  const eventsId = routeId(pathname, '/events');
  if (req.method === 'GET' && eventsId) {
    const room = getRoom(eventsId);
    if (!room) return json(res, 404, { error: 'ไม่พบรอบนี้แล้ว' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    room.clients.add(res);
    res.write(`event: room\ndata: ${JSON.stringify(publicRoom(room))}\n\n`);
    const heartbeat = setInterval(() => { try { res.write(': keep-alive\n\n'); } catch {} }, 15000);
    req.on('close', () => { clearInterval(heartbeat); room.clients.delete(res); });
    return;
  }

  const id = routeId(pathname) || routeId(pathname, '/participants') || routeId(pathname, '/close') || routeId(pathname, '/draw');
  const room = id ? getRoom(id) : null;
  if (id && !room) return json(res, 404, { error: 'ไม่พบรอบนี้แล้ว' });
  if (req.method === 'GET' && room) return json(res, 200, { room: publicRoom(room) });

  if (req.method === 'POST' && room && pathname === `/api/rooms/${id}/participants`) {
    try {
      const body = await readBody(req);
      if (room.status !== 'open') return json(res, 409, { error: 'รอบนี้ปิดรับชื่อแล้ว', room: publicRoom(room) });
      const name = String(body.name || '').trim().replace(/\s+/g, ' ');
      const token = String(body.token || '').trim();
      if (name.length < 1 || name.length > 40) return json(res, 400, { error: 'ชื่อควรมี 1–40 ตัวอักษร' });
      if (!token) return json(res, 400, { error: 'ไม่พบรหัสอุปกรณ์ กรุณาลองใหม่' });
      const existing = room.participants.find(item => item.token === token);
      if (existing) return json(res, 200, { participant: { name: existing.name, joinedAt: existing.joinedAt }, room: publicRoom(room) });
      const participant = { token, name, joinedAt: Date.now() };
      room.participants.push(participant);
      emit(room, 'room');
      return json(res, 201, { participant: { name, joinedAt: participant.joinedAt }, room: publicRoom(room) });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  if (req.method === 'POST' && room && pathname === `/api/rooms/${id}/close`) {
    if (!closeRoom(room, 'host')) return json(res, 409, { error: 'รอบนี้ปิดไปแล้ว', room: publicRoom(room) });
    return json(res, 200, { room: publicRoom(room) });
  }

  if (req.method === 'POST' && room && pathname === `/api/rooms/${id}/draw`) {
    if (room.status === 'open') closeRoom(room, 'host');
    if (room.status === 'drawn') return json(res, 200, { room: publicRoom(room) });
    if (!room.participants.length) return json(res, 409, { error: 'ยังไม่มีชื่อให้สุ่ม', room: publicRoom(room) });
    const index = crypto.randomInt(room.participants.length);
    room.winner = room.participants[index];
    room.status = 'drawn';
    emit(room, 'room');
    return json(res, 200, { room: publicRoom(room) });
  }

  return json(res, 404, { error: 'ไม่พบเส้นทางนี้' });
}

function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  const safe = path.normalize(requested).replace(/^([.][.][\\/])+/, '');
  const filePath = path.join(PUBLIC_DIR, safe);
  if (!filePath.startsWith(PUBLIC_DIR)) return json(res, 403, { error: 'forbidden' });
  fs.readFile(filePath, (error, data) => {
    if (error) return json(res, 404, { error: 'not found' });
    const ext = path.extname(filePath);
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (parsed.pathname.startsWith('/api/')) return handleApi(req, res, parsed.pathname);
  if (req.method !== 'GET') return json(res, 405, { error: 'method not allowed' });
  serveStatic(req, res, parsed.pathname);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Lucky Draw running at http://localhost:${PORT}`);
  console.log(`Phone access: http://${lanAddress()}:${PORT}`);
});
