const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const EVENTS_FILE = path.join(__dirname, 'talkey_events.ndjson');

// ── 이벤트 저장 (NDJSON: 한 줄에 하나의 JSON) ──────────────
// 읽기는 메모리, 쓰기는 파일에 append — 재시작 시 파일에서 복원

let events = [];

function loadFromFile() {
  try {
    const raw = fs.readFileSync(EVENTS_FILE, 'utf8');
    events = raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    console.log(`  저장된 이벤트 ${events.length}건 로드`);
  } catch {
    events = [];
  }
}

function appendToFile(event) {
  fs.appendFile(EVENTS_FILE, JSON.stringify(event) + '\n', () => {});
}

loadFromFile();

// ── Middleware ──────────────────────────────────────────────
app.use(express.json());
app.use(express.static(__dirname, { index: 'index.html' }));

// ── 이벤트 수집 ────────────────────────────────────────────
app.post('/api/track', (req, res) => {
  const { event, page, data, session_id } = req.body;
  if (!event) return res.status(400).json({ error: 'event required' });

  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
    .split(',')[0].trim();
  const ua = req.headers['user-agent'] || '';

  const record = {
    id:         events.length + 1,
    event_name: event,
    page:       page || null,
    data:       JSON.stringify(data || {}),
    session_id: session_id || null,
    ip,
    ua,
    created_at: new Date().toLocaleString('ko-KR', { hour12: false }),
  };

  events.push(record);
  appendToFile(record);
  res.json({ ok: true });
});

// ── 통계 API ───────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const count = (fn) => events.filter(fn).length;
  const pct   = (a, b) => b > 0 ? +(a / b * 100).toFixed(1) : null;

  const landing     = count(e => e.event_name === 'page_view'         && e.page === 'index');
  const payPage     = count(e => e.event_name === 'page_view'         && e.page === 'payment');
  const waitPage    = count(e => e.event_name === 'page_view'         && e.page === 'waiting');
  const ctaClick    = count(e => e.event_name === 'cta_click');
  const payBtnClick = count(e => e.event_name === 'payment_btn_click');
  const formSubmit  = count(e => e.event_name === 'form_submit');

  // 유니크 세션 수 (랜딩 기준)
  const uniqueSessions = new Set(
    events.filter(e => e.event_name === 'page_view' && e.page === 'index' && e.session_id)
          .map(e => e.session_id)
  ).size;

  // 일별 추이
  const dayMap = {};
  for (const e of events) {
    const day = e.created_at?.split(' ')[0] || '?';
    if (!dayMap[day]) dayMap[day] = {};
    dayMap[day][e.event_name] = (dayMap[day][e.event_name] || 0) + 1;
  }
  const daily = Object.entries(dayMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, counts]) => ({ day, ...counts }));

  res.json({
    raw:   { landing, payPage, waitPage, ctaClick, payBtnClick, formSubmit, uniqueSessions },
    rates: {
      cta_click_rate:    pct(ctaClick,    landing),
      payment_btn_rate:  pct(payBtnClick, landing),
      form_vs_landing:   pct(formSubmit,  landing),
      form_vs_pay_page:  pct(formSubmit,  payPage),
      form_vs_pay_click: pct(formSubmit,  payBtnClick),
    },
    daily,
  });
});

// ── 대시보드 ───────────────────────────────────────────────
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// ── 최근 이벤트 로그 ───────────────────────────────────────
app.get('/api/events', (req, res) => {
  res.json([...events].reverse().slice(0, 200));
});

// ── 서버 시작 ──────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\ntalkey 서버 실행 중`);
  console.log(`  랜딩페이지 → http://localhost:${PORT}`);
  console.log(`  대시보드   → http://localhost:${PORT}/dashboard\n`);
});
