/**
 * 예약 확인 문자 (Bizgo / 인포뱅크 비즈고, LMS)
 *
 *  API: POST https://mars.ibapi.kr/api/comm/v1/send/omni
 *  인증: 콘솔(연동관리)에서 발급한 통합 API Key 를 Authorization 헤더에 그대로 넣는다.
 *  발신번호(from)는 비즈고에 사전 등록된 번호여야 한다 (미등록이면 A327).
 *
 *  .env
 *    Bizgo_KEY=통합 API Key
 *    BIZGO_FROM=발신번호 (숫자만, 예 0212345678)
 *    BIZGO_URL=(선택) 기본 https://mars.ibapi.kr/api/comm/v1/send/omni, 샌드박스는 https://sandbox-mars.ibapi.kr/api/comm/v1/send/omni
 *    SMS_ENABLED=(선택) false 로 두면 발송하지 않는다
 */
"use strict";

const DEFAULT_URL = "https://mars.ibapi.kr/api/comm/v1/send/omni";

function config() {
  const key = (process.env.Bizgo_KEY || process.env.BIZGO_KEY || "").trim();
  const from = (process.env.BIZGO_FROM || "").replace(/\D/g, "");
  const url = (process.env.BIZGO_URL || DEFAULT_URL).trim();
  const enabled = String(process.env.SMS_ENABLED || "true").toLowerCase() !== "false";
  return { key, from, url, enabled };
}

/** 문자 기능 사용 가능 여부와 이유 */
function status() {
  const c = config();
  if (!c.enabled) return { enabled: false, reason: "SMS_ENABLED=false" };
  if (!c.key) return { enabled: false, reason: "Bizgo_KEY 없음" };
  if (!c.from) return { enabled: false, reason: "BIZGO_FROM(발신번호) 없음" };
  return { enabled: true, reason: "" };
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
  const body = {
    destinations: [{ to: r.phone, ref: r.id || "" }],
    messageFlow: [{ mms: { from: c.from, title: msg.title, text: msg.text, ttl: "3600" } }],
    ref: "miso-reservation",
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(c.url, {
      method: "POST",
      headers: { "Authorization": c.key, "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => ({}));
    const data = json.data || {};
    const dest = ((data.data || {}).destinations || [])[0] || {};
    const code = dest.code || data.code || (json.common || {}).authCode || String(res.status);
    const ok = res.ok && code === "A000";
    return { ok, code, result: dest.result || data.result || (json.common || {}).authResult || "", msgKey: dest.msgKey, error: ok ? undefined : `${code} ${dest.result || data.result || res.statusText}` };
  } catch (e) {
    return { ok: false, code: "NET", error: e.name === "AbortError" ? "시간 초과" : e.message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { sendReservationSms, buildMessage, status };
