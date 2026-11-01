/**
 * 체험 부스 예약 서버 (의존성 없음, Node 18+)
 *
 *  - 127.0.0.1 에 바인딩, nginx 가 /r/<PORT>/ 로 외부 노출
 *  - 경로 앞의 /r/<PORT> 접두사는 떼어내고 처리한다 (X-Forwarded-Prefix 도 참고)
 *  - 저장소: data/db.json (설정 + 예약 목록)
 *  - 시간 기준: 한국 표준시(KST, UTC+9, 서머타임 없음)
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 5500);
const HOST = process.env.HOST || "127.0.0.1";
const ADMIN_KEY = process.env.ADMIN_KEY || "miso1234";
const DB_PATH = path.join(__dirname, "data", "db.json");
const PUBLIC_DIR = path.join(__dirname, "public");

const KST_OFFSET = 9 * 60 * 60 * 1000;

const DEFAULT_SETTINGS = {
  openTime: "09:00",      // 예약 시작 시각
  closeTime: "18:00",     // 예약 종료 시각 (이 시각 전까지 시작하는 슬롯만)
  slotMinutes: 10,        // 예약 단위(분)
  windowMinutes: 120,     // 지금부터 몇 분 이내만 예약 가능
  retainMinutes: 120,     // 체험 시각이 지나고 몇 분 뒤 자동 삭제
  boothName: "체험 부스",
};

// ---------------------------------------------------------------- 저장소
let db = { settings: { ...DEFAULT_SETTINGS }, reservations: [] };
function loadDb() {
  try {
    const raw = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
    db.settings = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) };
    delete db.settings.capacity; // 예전 설정 정리
    db.reservations = Array.isArray(raw.reservations) ? raw.reservations : [];
  } catch (e) {
    /* 파일이 없으면 기본값으로 시작 */
  }
}
function saveDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const tmp = DB_PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_PATH);
}

// ---------------------------------------------------------------- 시간 유틸 (KST)
function nowKst() { return new Date(Date.now() + KST_OFFSET); } // UTC 필드를 KST 로 읽는다
function pad(n) { return String(n).padStart(2, "0"); }
function kstDateStr(d) { return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
function kstTimeStr(d) { return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; }
function hmToMin(hm) { const [h, m] = String(hm).split(":").map(Number); return h * 60 + m; }
function minToHm(min) { return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`; }
/** "YYYY-MM-DD" + "HH:MM" (KST) → epoch ms */
function slotToMs(date, hm) { return Date.parse(`${date}T${hm}:00+09:00`); }

/** 체험 시각이 지나고 retainMinutes 가 넘은 예약을 지운다 (개인정보 자동 삭제) */
function purgeExpired() {
  const now = Date.now();
  const keep = db.reservations.filter(r => slotToMs(r.date, r.time) + db.settings.retainMinutes * 60000 > now);
  if (keep.length !== db.reservations.length) { db.reservations = keep; saveDb(); }
}

/** 지금 예약 가능한 슬롯 목록 */
function buildSlots() {
  const s = db.settings;
  const now = nowKst();
  const date = kstDateStr(now);
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const open = hmToMin(s.openTime), close = hmToMin(s.closeTime);
  const step = Math.max(5, Number(s.slotMinutes) || 10);
  const firstAllowed = Math.ceil(nowMin / step) * step;            // 다음 10분 단위부터
  const lastAllowed = nowMin + Number(s.windowMinutes);             // 2시간 이내
  // 한 시간대에 한 명만 — 이미 예약된 시간은 마감(available:false)으로 내려 다른 사람이 고르지 못하게 한다
  const taken = new Set(db.reservations.filter(r => r.date === date).map(r => r.time));
  const slots = [];
  for (let m = open; m < close; m += step) {
    if (m < firstAllowed || m > lastAllowed) continue;
    const time = minToHm(m);
    slots.push({ time, available: !taken.has(time) });
  }
  return {
    date, now: kstTimeStr(now), slots,
    settings: { openTime: s.openTime, closeTime: s.closeTime, slotMinutes: step, windowMinutes: s.windowMinutes, retainMinutes: s.retainMinutes, boothName: s.boothName },
    status: nowMin >= close ? "closed" : (lastAllowed < open ? "before-open" : "open"),
  };
}

// ---------------------------------------------------------------- HTTP 유틸
function sendJson(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => { data += c; if (data.length > 1e5) { reject(new Error("too large")); req.destroy(); } });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
function serveStatic(res, rel) {
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Not Found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(buf);
  });
}
function isAdmin(req) { return (req.headers["x-admin-key"] || "") === ADMIN_KEY; }

function validName(v) { return typeof v === "string" && v.trim().length >= 1 && v.trim().length <= 20; }
function normPhone(v) { return String(v || "").replace(/\D/g, ""); }
function validPhone(d) { return /^01[016789]\d{7,8}$/.test(d); }
function fmtPhone(d) { return d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`; }

// ---------------------------------------------------------------- 라우팅
async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  let p = url.pathname;

  // base path /r/<port> 접두사 제거 (nginx 가 그대로 넘기든 떼고 넘기든 둘 다 동작)
  const fwdPrefix = (req.headers["x-forwarded-prefix"] || "").replace(/\/$/, "");
  const m = p.match(/^\/r\/\d+/);
  const prefix = m ? m[0] : fwdPrefix;
  if (m) p = p.slice(m[0].length);
  if (p === "") { // /r/5500 → /r/5500/ (상대 경로 링크가 깨지지 않게)
    res.writeHead(302, { Location: (prefix || "") + "/" }); return res.end();
  }

  purgeExpired();

  // ---- 공개 API
  if (p === "/api/slots" && req.method === "GET") return sendJson(res, 200, buildSlots());

  if (p === "/api/reserve" && req.method === "POST") {
    let body; try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: "잘못된 요청입니다." }); }
    const name = String(body.name || "").trim();
    const phone = normPhone(body.phone);
    const time = String(body.time || "");
    if (!validName(name)) return sendJson(res, 400, { error: "이름을 1~20자로 입력해 주세요." });
    if (!validPhone(phone)) return sendJson(res, 400, { error: "휴대폰 번호를 정확히 입력해 주세요." });
    if (!body.consent) return sendJson(res, 400, { error: "개인정보 수집·이용에 동의해 주세요." });

    const info = buildSlots();
    const slot = info.slots.find(s => s.time === time);
    if (!slot) return sendJson(res, 400, { error: "선택한 시간은 예약할 수 없어요. 시간을 다시 선택해 주세요.", refresh: true });
    if (!slot.available) return sendJson(res, 409, { error: "방금 다른 분이 예약한 시간이에요.\n다른 시간을 선택해 주세요.", refresh: true });

    // 휴대폰 번호 중복 검사 (보관 시간이 지나 자동 삭제되기 전까지는 같은 번호로 다시 예약 불가)
    const dup = db.reservations.find(r => r.phone === phone);
    if (dup) return sendJson(res, 409, { error: `이 번호로 이미 ${dup.time} 에 예약이 있어요.\n부스에서 확인해 주세요.` });

    const r = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), name, phone, date: info.date, time, createdAt: new Date().toISOString() };
    db.reservations.push(r);
    saveDb();
    return sendJson(res, 200, { ok: true, reservation: { id: r.id, name: r.name, phone: fmtPhone(r.phone), date: r.date, time: r.time }, retainMinutes: db.settings.retainMinutes });
  }

  // ---- 관리자 API
  if (p.startsWith("/api/admin/")) {
    if (!isAdmin(req)) return sendJson(res, 401, { error: "관리자 비밀번호가 올바르지 않습니다." });

    if (p === "/api/admin/login") return sendJson(res, 200, { ok: true });

    if (p === "/api/admin/settings" && req.method === "GET") return sendJson(res, 200, db.settings);
    if (p === "/api/admin/settings" && req.method === "PUT") {
      let b; try { b = await readBody(req); } catch (e) { return sendJson(res, 400, { error: "잘못된 요청입니다." }); }
      const hm = /^([01]\d|2[0-3]):[0-5]\d$/;
      const n = { ...db.settings };
      if (b.openTime !== undefined) { if (!hm.test(b.openTime)) return sendJson(res, 400, { error: "시작 시각 형식이 올바르지 않아요." }); n.openTime = b.openTime; }
      if (b.closeTime !== undefined) { if (!hm.test(b.closeTime)) return sendJson(res, 400, { error: "종료 시각 형식이 올바르지 않아요." }); n.closeTime = b.closeTime; }
      if (hmToMin(n.openTime) >= hmToMin(n.closeTime)) return sendJson(res, 400, { error: "종료 시각은 시작 시각보다 늦어야 해요." });
      const num = (k, min, max) => { if (b[k] === undefined) return true; const v = Number(b[k]); if (!Number.isInteger(v) || v < min || v > max) return false; n[k] = v; return true; };
      if (!num("slotMinutes", 5, 120)) return sendJson(res, 400, { error: "예약 단위는 5~120분 사이여야 해요." });
      if (!num("windowMinutes", 10, 720)) return sendJson(res, 400, { error: "예약 가능 범위는 10~720분 사이여야 해요." });
      if (!num("retainMinutes", 0, 1440)) return sendJson(res, 400, { error: "보관 시간은 0~1440분 사이여야 해요." });
      if (b.boothName !== undefined) n.boothName = String(b.boothName).trim().slice(0, 30) || DEFAULT_SETTINGS.boothName;
      db.settings = n; saveDb();
      return sendJson(res, 200, db.settings);
    }

    if (p === "/api/admin/reservations" && req.method === "GET") {
      const now = nowKst();
      const list = [...db.reservations]
        .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time) || a.createdAt.localeCompare(b.createdAt))
        .map(r => ({ id: r.id, name: r.name, phone: fmtPhone(r.phone), date: r.date, time: r.time, createdAt: r.createdAt, past: slotToMs(r.date, r.time) < Date.now() }));
      return sendJson(res, 200, { now: `${kstDateStr(now)} ${kstTimeStr(now)}`, reservations: list });
    }
    const del = p.match(/^\/api\/admin\/reservations\/([\w-]+)$/);
    if (del && req.method === "DELETE") {
      const before = db.reservations.length;
      db.reservations = db.reservations.filter(r => r.id !== del[1]);
      if (db.reservations.length !== before) saveDb();
      return sendJson(res, 200, { ok: true });
    }
    if (p === "/api/admin/reservations" && req.method === "DELETE") { // 전체 삭제
      db.reservations = []; saveDb();
      return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 404, { error: "Not Found" });
  }

  if (p.startsWith("/api/")) return sendJson(res, 404, { error: "Not Found" });

  // ---- 정적 파일
  if (p === "/" || p === "/index.html") return serveStatic(res, "index.html");
  return serveStatic(res, p.replace(/^\/+/, ""));
}

loadDb();
http.createServer((req, res) => {
  handle(req, res).catch(err => { console.error(err); try { sendJson(res, 500, { error: "서버 오류" }); } catch (e) { /* ignore */ } });
}).listen(PORT, HOST, () => {
  console.log(`[miso-reservation] http://${HOST}:${PORT}  (base path /r/${PORT}/)  admin key: ${ADMIN_KEY === "miso1234" ? "(default)" : "(custom)"}`);
});
