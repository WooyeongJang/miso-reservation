/**
 * .env 로더 (의존성 없음)
 *  - KEY=VALUE 한 줄씩 읽는다. # 주석과 빈 줄은 무시, 값 양쪽의 따옴표는 벗긴다.
 *  - 이미 process.env 에 있는 값은 덮어쓰지 않는다 (실행 시 환경변수가 우선).
 */
"use strict";
const fs = require("fs");
const path = require("path");

function loadEnv(file) {
  file = file || path.join(__dirname, ".env");
  let raw;
  try { raw = fs.readFileSync(file, "utf8"); } catch (e) { return {}; }
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[key] = val;
    if (process.env[key] === undefined) process.env[key] = val;
  }
  return out;
}
module.exports = { loadEnv };
