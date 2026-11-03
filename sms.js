/**
 * 예약 확인 문자 (인포뱅크 비즈고 / OMNI API, LMS)
 *
 * 두 가지 인증 방식을 지원한다. .env 에 있는 값에 따라 자동으로 고른다.
 *
 *  (A) 통합 API Key  — 비즈고 v2 (mars.ibapi.kr)
 *      Bizgo_KEY=콘솔(연동관리)에서 발급한 통합 API Key
 *      → Authorization: {API Key}
 *      → POST https://mars.ibapi.kr/api/comm/v1/send/omni
 *
 *  (B) ID + 비밀번호 — OMNI API v1 (omni.ibapi.kr)
 *      BIZGO_CLIENT_ID=OMNI API ID
 *      BIZGO_CLIENT_PASSWD=OMNI API 비밀번호
 *      → POST https://omni.ibapi.kr/v1/auth/token (X-IB-Client-Id / X-IB-Client-Passwd) 로 토큰 발급 (24시간 유효, 캐시)
 *      → Authorization: Bearer {token}
 *      → POST https://omni.ibapi.kr/v1/send/omni
 *
 *  공통
 *      BIZGO_FROM=비즈고에 사전 등록된 발신번호 (숫자만)
 *      BIZGO_URL=(선택) 발송 주소 덮어쓰기. 샌드박스: https://sandbox-mars.ibapi.kr/api/comm/v1/send/omni (A) / https://sandbox-omni.ibapi.kr/v1/send/omni (B)
 *      BIZGO_TOKEN_URL=(선택) 토큰 발급 주소 덮어쓰기 (B)
 *      SMS_ENABLED=(선택) false 로 두면 발송하지 않는다
 */
"use strict";

const V2_SEND_URL = "https://mars.ibapi.kr/api/comm/v1/send/omni";
const V1_SEND_URL = "https://omni.ibapi.kr/v1/send/omni";
const V1_TOKEN_URL = "https://omni.ibapi.kr/v1/auth/token";
const TIMEOUT_MS = 10000;

function env(k) { return (process.env[k] || "").trim(); }

function config() {
  const clientId = env("BIZGO_CLIENT_ID");
  const clientPasswd = env("BIZGO_CLIENT_PASSWD");
  const apiKey = env("Bizgo_KEY") || env("BIZGO_KEY") || env("BIZGO_API_KEY");
  const mode = clientId && clientPasswd ? "idpw" : apiKey ? "apikey" : "none";
  return {
    mode, apiKey, clientId, clientPasswd,
    from: env("BIZGO_FROM").replace(/\D/g, ""),
    sendUrl: env("BIZGO_URL") || (mode === "idpw" ? V1_SEND_URL : V2_SEND_URL),
    tokenUrl: env("BIZGO_TOKEN_URL") || V1_TOKEN_URL,
    enabled: env("SMS_ENABLED").toLowerCase() !== "false",
  };
}

/** 문자 기능 사용 가능 여부와 이유 */
function status() {
  const c = config();
  if (!c.enabled) return { enabled: false, reason: "SMS_ENABLED=false" };
  if (c.mode === "none") return { enabled: false, reason: "Bizgo_KEY 또는 BIZGO_CLIENT_ID/BIZGO_CLIENT_PASSWD 없음" };
  if (!c.from) return { enabled: false, reason: "BIZGO_FROM(발신번호) 없음" };
  return { enabled: true, reason: "", mode: c.mode === "idpw" ? "OMNI v1 (ID/PW 토큰)" : "비즈고 v2 (API Key)" };
}

function minutesText(min) {
  min = Number(min) || 0;
  const h = Math.floor(min / 60), m = min % 60;
  if (h && m) return `${h}시간 ${m}분`;
  if (h) return `${h}시간`;
  return `${m}분`;
}

/** 예약 확인 문자 본문 (LMS, 2,000 bytes 이내) */
function buildMessage(r) {
  const [, mm, dd] = r.date.split("-").map(Number);
  const booth = r.boothName || "체험 부스";
  return {
    title: `${booth} 예약 완료`,
    text:
`[${booth}] 예약되었습니다.

■ 예약 시간 : ${mm}월 ${dd}일 ${r.time}
■ 예약자 : ${r.name}

예약 시간에 맞춰 부스로 와주세요.
늦으시면 다음 분께 순서가 넘어갈 수 있어요.
체험 전에 담당자가 연락드릴 수 있어요.

입력하신 이름과 휴대폰 번호는 체험 후 ${minutesText(r.retainMinutes || 120)} 뒤 자동 삭제됩니다.`,
  };
}

async function fetchJson(url, opts) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const json = await res.json().catch(() => ({}));
    return { res, json };
  } finally { clearTimeout(timer); }
}

// ---- (B) ID/PW 토큰 (24시간 유효, 만료 10분 전에 재발급)
let tokenCache = { token: "", expiresAt: 0, key: "" };
async function getToken(c, force) {
  const cacheKey = c.clientId + "|" + c.tokenUrl;
  if (!force && tokenCache.token && tokenCache.key === cacheKey && Date.now() < tokenCache.expiresAt - 10 * 60000) return tokenCache.token;
  const { res, json } = await fetchJson(c.tokenUrl, { method: "POST", headers: { "X-IB-Client-Id": c.clientId, "X-IB-Client-Passwd": c.clientPasswd, "Accept": "application/json" } });
  const data = json.data || {};
  if (!res.ok || json.code !== "A000" || !data.token) {
    const err = new Error(`토큰 발급 실패: ${json.code || res.status} ${json.result || res.statusText}`); err.code = json.code || String(res.status); throw err;
  }
  const exp = Date.parse(data.expired || "") || (Date.now() + 23 * 3600000);
  tokenCache = { token: data.token, expiresAt: exp, key: cacheKey };
  return data.token;
}

/** 응답(v1: code/result/data, v2: common/data) 에서 결과를 뽑는다 */
function parseResult(res, json) {
  const common = json.common || {};
  const data = json.data && json.data.destinations ? json : (json.data || {});   // v1 은 최상위, v2 는 data 안
  const dest = (((data.data || data).destinations) || [])[0] || {};
  const code = dest.code || data.code || json.code || common.authCode || String(res.status);
  const result = dest.result || data.result || json.result || common.authResult || res.statusText;
  const ok = res.ok && code === "A000";
  return { ok, code, result, msgKey: dest.msgKey, error: ok ? undefined : `${code} ${result}` };
}

/**
 * 예약 확인 문자 발송
 * @param {{name:string, phone:string(숫자만), date:string, time:string, boothName?:string, retainMinutes?:number, id?:string}} r
 * @returns {Promise<{ok:boolean, skipped?:boolean, code?:string, result?:string, msgKey?:string, error?:string}>}
 */
async function sendReservationSms(r) {
  const st = status();
  if (!st.enabled) return { ok: false, skipped: true, error: st.reason };
  const c = config();
  const msg = buildMessage(r);
  const body = JSON.stringify({
    destinations: [{ to: r.phone, ref: r.id || "" }],
    messageFlow: [{ mms: { from: c.from, title: msg.title, text: msg.text, ttl: "3600" } }],
    ref: "miso-reservation",
  });
  const headers = { "Content-Type": "application/json", "Accept": "application/json" };
  try {
    if (c.mode === "idpw") {
      headers.Authorization = "Bearer " + await getToken(c, false);
      let { res, json } = await fetchJson(c.sendUrl, { method: "POST", headers, body });
      if (res.status === 401 || (json && (json.code === "A001" || json.code === "A100"))) {   // 토큰 만료 등 → 한 번 재발급 후 재시도
        headers.Authorization = "Bearer " + await getToken(c, true);
        ({ res, json } = await fetchJson(c.sendUrl, { method: "POST", headers, body }));
      }
      return parseResult(res, json);
    }
    headers.Authorization = c.apiKey;
    const { res, json } = await fetchJson(c.sendUrl, { method: "POST", headers, body });
    return parseResult(res, json);
  } catch (e) {
    return { ok: false, code: e.code || "NET", error: e.name === "AbortError" ? "시간 초과" : e.message };
  }
}

module.exports = { sendReservationSms, buildMessage, status };
