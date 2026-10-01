import crypto from "node:crypto";

/** 금융결제원 오픈뱅킹 테스트베드. 실거래 호스트는 쓰지 않습니다. */
export const API_BASE = "https://testapi.openbanking.or.kr";

const ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function tranDtime(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type).value;
  return `${pick("year")}${pick("month")}${pick("day")}${pick("hour")}${pick("minute")}${pick("second")}`;
}

/** 이용기관코드 10자리 + U + 고유 9자리 = 20자리. */
export function bankTranId(clientUseCode) {
  if (!/^[A-Za-z0-9]{10}$/.test(clientUseCode || "")) {
    throw new Error("이용기관코드는 영문과 숫자 10자리여야 합니다.");
  }
  const bytes = crypto.randomBytes(9);
  let unique = "";
  for (const byte of bytes) unique += ID_ALPHABET[byte % ID_ALPHABET.length];
  return `${clientUseCode}U${unique}`;
}

export function authorizeUrl({ clientId, redirectUri, state }) {
  const url = new URL(`${API_BASE}/oauth/2.0/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "login inquiry");
  url.searchParams.set("state", state);
  url.searchParams.set("auth_type", "0");
  return url.toString();
}

async function readJson(res) {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("오픈뱅킹 응답을 해석하지 못했습니다.");
  }
}

function assertApiOk(data, fallback) {
  if (data.error) {
    throw Object.assign(new Error(data.error_description || data.error || fallback), { payload: data });
  }
  if (data.rsp_code && data.rsp_code !== "A0000") {
    throw Object.assign(new Error(data.rsp_message || fallback), { payload: data });
  }
}

export async function issueToken({ code, clientId, clientSecret, redirectUri }) {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch(`${API_BASE}/oauth/2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body,
  });
  const data = await readJson(res);
  if (!res.ok) assertApiOk(data, "토큰 발급에 실패했습니다.");
  assertApiOk(data, "토큰 발급에 실패했습니다.");
  if (!data.access_token || data.user_seq_no === undefined) {
    throw new Error("토큰 응답에 access_token 또는 user_seq_no가 없습니다.");
  }
  return data;
}

export async function getUser({ accessToken, userSeqNo, signal }) {
  const url = new URL(`${API_BASE}/v2.0/user/me`);
  url.searchParams.set("user_seq_no", String(userSeqNo));
  const started = Date.now();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  });
  const data = await readJson(res);
  if (!res.ok) assertApiOk(data, "사용자정보조회에 실패했습니다.");
  assertApiOk(data, "사용자정보조회에 실패했습니다.");
  return { body: data, elapsedMs: Date.now() - started };
}

export async function getBalance({ accessToken, fintechUseNum, clientUseCode, signal }) {
  const url = new URL(`${API_BASE}/v2.0/account/balance/fin_num`);
  url.searchParams.set("fintech_use_num", fintechUseNum);
  url.searchParams.set("bank_tran_id", bankTranId(clientUseCode));
  url.searchParams.set("tran_dtime", tranDtime());
  const started = Date.now();
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  });
  const data = await readJson(res);
  const elapsedMs = Date.now() - started;
  if (!res.ok) assertApiOk(data, "잔액조회에 실패했습니다.");
  assertApiOk(data, "잔액조회에 실패했습니다.");
  return { body: data, elapsedMs };
}
