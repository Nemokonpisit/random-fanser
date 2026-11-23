(() => {
  const app = document.getElementById('app');
  const state = { room: null, joinUrl: '', source: null, polling: null, countdown: null, token: null, submitted: false, announcementWinner: '' };
  const params = new URLSearchParams(location.search);
  const joinId = params.get('join');

  const icons = {
    ticket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v3a3 3 0 0 0 0 6v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a3 3 0 0 0 0-6V6a2 2 0 0 1 2-2Z"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z"/><path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z"/></svg>'
  };

  const escapeHtml = value => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const formatTime = ms => {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const minutes = String(Math.floor(total / 60)).padStart(2, '0');
    const seconds = String(total % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
  };
  const formatJoined = timestamp => new Date(timestamp).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  const statusText = status => ({ open: 'กำลังรับชื่อ', closed: 'ปิดรับชื่อแล้ว', drawn: 'ได้ผู้โชคดีแล้ว' }[status] || 'กำลังโหลด');
  const statusClass = status => status === 'drawn' ? 'drawn' : status === 'closed' ? 'closed' : '';

  function showWinnerAnnouncement(name, audience) {
    document.querySelector('.winner-modal-backdrop')?.remove();
    const message = audience === 'host' ? 'ปิดรับชื่อและสุ่มเรียบร้อยแล้ว' : 'ผลประกาศจาก host มาแล้ว';
    const previousFocus = document.activeElement;
    const modal = document.createElement('div');
    modal.className = 'winner-modal-backdrop';
    modal.innerHTML = `<section class="winner-modal" role="dialog" aria-modal="true" aria-labelledby="winnerAnnouncementTitle" aria-describedby="winnerAnnouncementDescription">
      <div class="winner-modal-mark">${icons.spark}</div>
      <p class="winner-modal-kicker">ประกาศผลรอบนี้</p>
      <h2 id="winnerAnnouncementTitle">ผู้โชคดีมาแล้ว!</h2>
      <p id="winnerAnnouncementDescription" class="winner-modal-description">${message}</p>
      <div class="winner-modal-name">${escapeHtml(name)}</div>
      <button type="button" class="primary-button full winner-modal-close">ปิดประกาศ</button>
    </section>`;
    document.body.appendChild(modal);
    const closeButton = modal.querySelector('.winner-modal-close');
    const close = () => {
      modal.remove();
      document.removeEventListener('keydown', onKeyDown);
      if (previousFocus && typeof previousFocus.focus === 'function' && document.contains(previousFocus)) previousFocus.focus({ preventScroll: true });
    };
    const onKeyDown = event => { if (event.key === 'Escape') close(); };
    closeButton.addEventListener('click', close);
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    document.addEventListener('keydown', onKeyDown);
    closeButton.focus({ preventScroll: true });
  }

  async function request(url, options = {}) {
    let response;
    try {
      response = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
    } catch {
      throw new Error('เชื่อมต่อระบบสุ่มไม่ได้ กรุณาตรวจสอบว่า deploy ทั้ง repository แล้วลองรีเฟรช');
    }
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json().catch(() => ({})) : {};
    if (!response.ok) {
      if (data.code === 'BLOBS_NOT_CONFIGURED') {
        throw new Error('ระบบเก็บข้อมูลยังไม่พร้อม กรุณา deploy ทั้ง repository ที่มีโฟลเดอร์ netlify/functions');
      }
      if (response.status === 404) throw new Error('ไม่พบ API ของเว็บ กรุณา deploy จากโฟลเดอร์หลักของโปรเจกต์ ไม่ใช่เฉพาะ public');
      throw new Error(data.error || 'เชื่อมต่อไม่สำเร็จ กรุณาลองใหม่');
    }
    return data;
  }

  function shell(content, className = '') {
    return `<div class="page ${className}"><div class="shell">${content}</div></div>`;
  }

  function topbar(note = 'สุ่มชื่อจาก QR') {
    return `<div class="topbar"><a class="brand" href="/"><span class="brand-mark">${icons.ticket}</span><span>LUCKY DRAW</span></a><div class="top-note">${note}</div></div>`;
  }

  function renderSetup() {
    stopStream();
    app.innerHTML = shell(`${topbar('เริ่มรอบใหม่ได้ทุกเมื่อ')}
      <section class="paper">
        <div class="intro"><h1>สุ่มชื่อให้แฟร์<br>ด้วย QR เดียว</h1><p>กำหนดเวลา เปิดรับชื่อจากมือถือทุกคน แล้วปิดรอบเพื่อสุ่มผู้โชคดีหนึ่งคน</p><span class="ink-line"></span></div>
        <div class="setup-grid">
          <div class="form-block">
            <div class="section-label"><span>รอบนี้รับชื่อกี่นาที?</span><small>สูงสุด 180 นาที</small></div>
            <div class="duration-row"><input id="minutes" class="duration-input" type="number" min="1" max="180" value="10" inputmode="numeric" aria-label="จำนวนนาที"><span class="duration-unit">นาที</span></div>
            <div class="presets" aria-label="เวลาแนะนำ"><button class="preset" data-minutes="5">5 นาที</button><button class="preset" data-minutes="10">10 นาที</button><button class="preset" data-minutes="15">15 นาที</button><button class="preset" data-minutes="30">30 นาที</button></div>
            <button id="start" class="primary-button full" style="margin-top:18px">สร้าง QR และเริ่มรอบ</button>
            <p class="footer-note">เปิดหน้านี้ผ่านเครื่องที่อยู่ Wi‑Fi เดียวกับมือถือผู้ร่วมกิจกรรม เพื่อให้สแกน QR ได้</p>
          </div>
          <aside class="setup-side"><div class="section-label"><span>ลำดับการใช้งาน</span></div><p class="footer-note" style="text-align:left;margin-top:0">1. กรอกเวลา<br>2. เปิด QR ให้ทุกคนสแกน<br>3. ปิดรับชื่อ แล้วกดสุ่มผู้โชคดี</p></aside>
        </div>
      </section>`, 'setup-page');
    document.querySelectorAll('[data-minutes]').forEach(button => button.addEventListener('click', () => { document.getElementById('minutes').value = button.dataset.minutes; }));
    document.getElementById('start').addEventListener('click', startRound);
  }

  async function startRound() {
    const minutes = Number(document.getElementById('minutes').value);
    const button = document.getElementById('start');
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 180) return toast('กรุณากรอกเวลา 1–180 นาที');
    button.disabled = true; button.textContent = 'กำลังสร้างรอบ…';
    try {
      const data = await request('/api/rooms', { method: 'POST', body: JSON.stringify({ minutes }) });
      state.room = data.room; state.joinUrl = data.joinUrl; renderHost();
    } catch (error) { toast(error.message); button.disabled = false; button.textContent = 'สร้าง QR และเริ่มรอบ'; }
  }

  function renderHost() {
    if (!state.room) return renderSetup();
    const room = state.room;
    const isDrawn = room.status === 'drawn';
    const action = room.status === 'open'
      ? '<button id="close" class="danger-button full">ปิดรับชื่อ</button>'
      : isDrawn ? '<a class="primary-button full" href="/">เริ่มรอบใหม่</a>'
      : '<button id="draw" class="primary-button full">สุ่มผู้โชคดี 1 คน</button>';
    app.innerHTML = shell(`${topbar(`รหัสรอบ ${room.id.toUpperCase()}`)}
      <section class="paper">
        <header class="round-header"><div><h1>ชื่อในรอบนี้</h1><p>ให้ผู้ร่วมกิจกรรมสแกน QR แล้วกรอกชื่อของตัวเอง</p></div><span class="status ${statusClass(room.status)}">${statusText(room.status)}</span></header>
        <div class="round-grid">
          <div class="control-column">
            <div class="timer-box" id="timerBox"><span class="timer-label">เวลาที่เหลือ</span><div id="timer" class="timer">--:--</div></div>
            <div class="qr-box"><h2>สแกนเพื่อเข้าร่วม</h2><div id="qrcode" class="qr-frame" aria-label="คิวอาร์โค้ดสำหรับเข้าร่วม"></div><p class="qr-help">เปิดกล้องมือถือ แล้วสแกนคิวอาร์นี้</p><div class="join-link"><span>${escapeHtml(state.joinUrl)}</span><button id="copy" class="link-button" aria-label="คัดลอกลิงก์">${icons.copy}</button></div></div>
            <div class="action-row">${action}</div>
          </div>
          <section class="ledger"><div class="ledger-head"><h2>รายชื่อผู้ร่วมกิจกรรม</h2><span id="count" class="count">${room.participantCount} คน</span></div><div id="participants"></div></section>
        </div>
        ${isDrawn && room.winner ? `<div style="padding:0 20px 22px"><div class="winner"><div class="winner-label">ผู้โชคดีที่สุดของรอบนี้</div><div class="winner-name">${escapeHtml(room.winner.name)}</div></div></div>` : ''}
      </section>`, 'host-page');
    drawQr(); renderParticipants(); startCountdown(); connectStream();
    document.getElementById('copy').addEventListener('click', copyJoinUrl);
    if (room.status === 'open') document.getElementById('close').addEventListener('click', closeRound);
    if (room.status === 'closed') document.getElementById('draw').addEventListener('click', drawWinner);
    if (isDrawn && room.winner && state.announcementWinner !== room.winner.name) {
      state.announcementWinner = room.winner.name;
      showWinnerAnnouncement(room.winner.name, 'host');
    }
  }

  function drawQr() {
    const target = document.getElementById('qrcode');
    if (!target || !state.joinUrl) return;
    if (window.QRCode) new QRCode(target, { text: state.joinUrl, width: 208, height: 208, colorDark: '#10233f', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    else target.innerHTML = `<p class="qr-help">โหลดตัวสร้าง QR ไม่สำเร็จ<br><a href="${escapeHtml(state.joinUrl)}">เปิดลิงก์เข้าร่วม</a></p>`;
  }

  function renderParticipants() {
    const target = document.getElementById('participants');
    const count = document.getElementById('count');
    if (!target || !state.room) return;
    if (count) count.textContent = `${state.room.participantCount} คน`;
    target.innerHTML = state.room.participants.length ? `<ol class="participant-list">${state.room.participants.map((person, index) => `<li class="participant"><span class="participant-index">${index + 1}</span><span class="participant-name">${escapeHtml(person.name)}</span><span class="participant-time">${formatJoined(person.joinedAt)}</span></li>`).join('')}</ol>` : '<div class="empty">ยังไม่มีชื่อ<br>เมื่อมีคนสแกน QR รายชื่อจะขึ้นตรงนี้</div>';
  }

  function startCountdown() {
    clearInterval(state.countdown);
    const tick = () => { const timer = document.getElementById('timer'); if (!timer || !state.room) return; const remaining = state.room.endsAt - Date.now(); timer.textContent = formatTime(remaining); document.getElementById('timerBox')?.classList.toggle('is-ending', remaining < 60000 && state.room.status === 'open'); };
    tick(); state.countdown = setInterval(tick, 250);
  }

  function connectStream() {
    stopStream();
    if (!state.room) return;
    const sync = async () => {
      try {
        const data = await request(`/api/rooms/${state.room.id}`), next = data.room;
        const changed = JSON.stringify(next) !== JSON.stringify(state.room);
        state.room = next;
        if (changed) { if (state.room.status !== 'open' || state.room.winner) renderHost(); else { renderParticipants(); startCountdown(); } }
      } catch {}
    };
    sync(); state.polling = setInterval(sync, 1500);
  }

  function stopStream() { if (state.source) { state.source.close(); state.source = null; } if (state.polling) { clearInterval(state.polling); state.polling = null; } clearInterval(state.countdown); }
  async function closeRound() { const button = document.getElementById('close'); if (!button || !state.room) return; if (!confirm('ปิดรับชื่อรอบนี้เลยไหม? หลังจากปิดแล้วจะเพิ่มชื่อไม่ได้')) return; button.disabled = true; try { const data = await request(`/api/rooms/${state.room.id}/close`, { method: 'POST' }); state.room = data.room; renderHost(); } catch (error) { toast(error.message); button.disabled = false; } }
  async function drawWinner() { const button = document.getElementById('draw'); if (!button || !state.room) return; button.disabled = true; button.textContent = 'กำลังสุ่ม…'; try { const data = await request(`/api/rooms/${state.room.id}/draw`, { method: 'POST' }); state.room = data.room; renderHost(); } catch (error) { toast(error.message); button.disabled = false; button.textContent = 'สุ่มผู้โชคดี 1 คน'; } }
  async function copyJoinUrl() { try { await navigator.clipboard.writeText(state.joinUrl); toast('คัดลอกลิงก์แล้ว'); } catch { toast('คัดลอกไม่ได้ ลองกดค้างที่ลิงก์'); } }

  async function renderGuest() {
    try { const data = await request(`/api/rooms/${joinId}`); state.room = data.room; state.token = localStorage.getItem(`lucky-draw:${joinId}`) || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`); renderGuestView(); connectGuestStream(); }
    catch (error) { app.innerHTML = shell(`${topbar('เข้าร่วมรอบ')}<section class="paper guest-paper"><div class="guest-main"><h1>เข้ารอบนี้ไม่ได้</h1><p>${escapeHtml(error.message)}</p><a class="secondary-button" href="/" style="margin-top:20px">กลับหน้าหลัก</a></div></section>`, 'guest-page'); }
  }

  function renderGuestView() {
    const room = state.room;
    const submitted = state.submitted || Boolean(localStorage.getItem(`lucky-draw:${joinId}:submitted`));
    const body = room.status === 'open' && !submitted
      ? `<form id="nameForm" class="name-form"><label class="section-label" for="name">ชื่อที่ใช้ร่วมสนุก</label><input id="name" class="name-input" maxlength="40" autocomplete="nickname" placeholder="เช่น มินท์" required><button class="primary-button full" type="submit">ส่งชื่อเข้าร่วม</button><div id="message" class="message" role="alert"></div></form>`
      : submitted && room.status === 'open'
      ? '<div class="success-note"><strong>ส่งชื่อแล้ว</strong><br>รอลุ้นผลได้เลย ถ้าปิดรอบแล้ว host จะกดสุ่มผู้โชคดี</div>'
      : room.status === 'drawn' && room.winner
      ? `<div class="winner" style="margin-top:20px"><div class="winner-label">ผู้โชคดีของรอบนี้คือ</div><div class="winner-name">${escapeHtml(room.winner.name)}</div></div>`
      : '<div class="closed-note"><strong>ปิดรับชื่อแล้ว</strong><br>รอบนี้ไม่รับชื่อเพิ่มแล้ว รอ host ประกาศผลได้เลย</div>';
    app.innerHTML = shell(`${topbar(`รอบ ${room.id.toUpperCase()}`)}<section class="paper guest-paper"><div class="guest-main"><span class="status ${statusClass(room.status)}">${statusText(room.status)}</span><h1 style="margin-top:18px">ร่วมลุ้นไปด้วยกัน</h1><p>กรอกชื่อสั้น ๆ หนึ่งครั้ง แล้วรอดูผลสุ่มจาก host</p><div class="guest-timer"><span class="timer-label">เวลาที่เหลือ</span><strong id="guestTimer">--:--</strong></div>${body}<p class="footer-note">หนึ่งเครื่องส่งชื่อได้หนึ่งครั้งต่อรอบ</p></div></section>`, 'guest-page');
    startGuestCountdown();
    const form = document.getElementById('nameForm'); if (form) form.addEventListener('submit', submitName);
    if (room.status === 'drawn' && room.winner && state.announcementWinner !== room.winner.name) {
      state.announcementWinner = room.winner.name;
      showWinnerAnnouncement(room.winner.name, 'guest');
    }
  }

  function startGuestCountdown() { clearInterval(state.countdown); const tick = () => { const timer = document.getElementById('guestTimer'); if (timer) timer.textContent = formatTime(state.room.endsAt - Date.now()); }; tick(); state.countdown = setInterval(tick, 250); }
  function connectGuestStream() { stopStream(); const sync = async () => { try { const data = await request(`/api/rooms/${joinId}`), next = data.room; if (JSON.stringify(next) !== JSON.stringify(state.room)) { state.room = next; renderGuestView(); } } catch {} }; sync(); state.polling = setInterval(sync, 1500); }
  async function submitName(event) { event.preventDefault(); const input = document.getElementById('name'); const message = document.getElementById('message'); const button = event.submitter; const name = input.value.trim(); if (!name) return; button.disabled = true; button.textContent = 'กำลังส่ง…'; try { await request(`/api/rooms/${joinId}/participants`, { method: 'POST', body: JSON.stringify({ name, token: state.token }) }); localStorage.setItem(`lucky-draw:${joinId}`, state.token); localStorage.setItem(`lucky-draw:${joinId}:submitted`, 'yes'); state.submitted = true; renderGuestView(); } catch (error) { message.textContent = error.message; button.disabled = false; button.textContent = 'ส่งชื่อเข้าร่วม'; } }
  function toast(message) { const existing = document.querySelector('.toast'); existing?.remove(); const node = document.createElement('div'); node.className = 'toast'; node.textContent = message; document.body.appendChild(node); setTimeout(() => node.remove(), 2600); }

  if (joinId) renderGuest(); else renderSetup();
})();
