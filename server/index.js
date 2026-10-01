import "dotenv/config";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import session from "express-session";
import { demoBalance, demoUser, findDemoBalance } from "./demo.js";
import {
  API_BASE,
  authorizeUrl,
  getBalance,
  getUser,
  issueToken,
} from "./openbanking.js";
import { shellFromAccount, viewFromBalance, viewFromFailure } from "./present.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const callbackUrl = process.env.CALLBACK_URL || `http://localhost:${port}/callback`;
const clientId = (process.env.CLIENT_ID || "").trim();
const clientSecret = (process.env.CLIENT_SECRET || "").trim();
const clientUseCode = (process.env.CLIENT_USE_CODE || "").trim();
const useCodeOk = /^[A-Za-z0-9]{10}$/.test(clientUseCode);
const ready = Boolean(clientId && clientSecret && useCodeOk);

const BALANCE_TIMEOUT_MS = 8000;
const DEMO_STALL_TIMEOUT_MS = 2200;

const app = express();
app.disable("x-powered-by");
app.use(express.json());
app.use(
  session({
    name: "hannune.sid",
    secret: process.env.SESSION_SECRET || "dev-only-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 8,
    },
  }),
);

function maskedClientId() {
  if (!clientId) return null;
  if (clientId.length <= 8) return "등록됨";
  return `${clientId.slice(0, 4)}…${clientId.slice(-4)}`;
}

function missingKeys() {
  const missing = [];
  if (!clientId) missing.push("CLIENT_ID");
  if (!clientSecret) missing.push("CLIENT_SECRET");
  if (!useCodeOk) missing.push("CLIENT_USE_CODE");
  return missing;
}

function sessionMode(req) {
  if (req.session.mode === "demo") return "demo";
  if (req.session.ob?.accessToken) return "live";
  return null;
}

app.get("/api/status", (req, res) => {
  res.json({
    session: sessionMode(req),
    ready,
    missing: missingKeys(),
    callbackUrl,
    apiBase: API_BASE,
    clientIdMasked: maskedClientId(),
    userSeqNo: req.session.ob?.userSeqNo || null,
    scope: req.session.ob?.scope || null,
  });
});

app.get("/auth/start", (req, res) => {
  if (!ready) {
    const message = "Client ID, Client Secret, 이용기관코드 10자리를 .env에 넣은 뒤 서버를 다시 시작하세요.";
    return res.redirect(`/?error=${encodeURIComponent(message)}`);
  }
  const state = crypto.randomBytes(16).toString("hex");
  req.session.state = state;
  req.session.save((error) => {
    if (error) {
      return res.redirect(`/?error=${encodeURIComponent("세션을 저장하지 못했습니다.")}`);
    }
    res.redirect(authorizeUrl({ clientId, redirectUri: callbackUrl, state }));
  });
});

app.get("/callback", async (req, res) => {
  try {
    if (req.query.error) throw new Error("인증이 취소되었습니다.");
    if (!req.query.code || !req.session.state || req.query.state !== req.session.state) {
      throw new Error("인증 응답을 확인할 수 없습니다. 다시 연결해 주세요.");
    }
    const token = await issueToken({
      code: String(req.query.code),
      clientId,
      clientSecret,
      redirectUri: callbackUrl,
    });
    req.session.state = null;
    req.session.mode = "live";
    req.session.ob = {
      accessToken: token.access_token,
      refreshToken: token.refresh_token || null,
      userSeqNo: String(token.user_seq_no),
      scope: token.scope || "",
    };
    req.session.save(() => res.redirect("/?connected=1"));
  } catch (error) {
    console.error("token", error.payload?.error || error.payload?.rsp_code || error.message);
    const message = error.message || "토큰 발급에 실패했습니다.";
    res.redirect(`/?error=${encodeURIComponent(message)}`);
  }
});

app.post("/auth/demo", (req, res) => {
  req.session.mode = "demo";
  req.session.ob = null;
  req.session.save(() => res.json({ ok: true }));
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

function sendEvent(res, closed, event, data) {
  if (closed.current) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function isTimeout(error, clientSignal) {
  if (clientSignal.aborted) return false;
  return error?.name === "TimeoutError" || error?.name === "AbortError";
}

async function loadUser(req, clientSignal) {
  if (sessionMode(req) === "demo") {
    const started = Date.now();
    return { body: demoUser(), elapsedMs: Date.now() - started, mode: "demo" };
  }
  const ob = req.session.ob;
  const result = await getUser({
    accessToken: ob.accessToken,
    userSeqNo: ob.userSeqNo,
    signal: clientSignal,
  });
  return { ...result, mode: "live" };
}

async function loadBalance(req, fintechUseNum, { stall, signal }) {
  if (sessionMode(req) === "demo") {
    return demoBalance(fintechUseNum, { stall, signal });
  }
  return getBalance({
    accessToken: req.session.ob.accessToken,
    fintechUseNum,
    clientUseCode,
    signal,
  });
}

async function settleBalance(req, account, options) {
  const shell = shellFromAccount(account);
  if (!shell.inquiryAgreed) return viewFromFailure(shell, "skipped", shell.message, null);
  const { stall, clientSignal, timeoutMs } = options;
  const started = Date.now();
  try {
    const signal = AbortSignal.any([clientSignal, AbortSignal.timeout(timeoutMs)]);
    const result = await loadBalance(req, shell.fintechUseNum, { stall, signal });
    return viewFromBalance(shell, result.body, result.elapsedMs);
  } catch (error) {
    if (clientSignal.aborted) return null;
    const elapsedMs = Date.now() - started;
    if (isTimeout(error, clientSignal)) {
      return viewFromFailure(
        shell,
        "delayed",
        "이 기관만 응답이 늦습니다. 나머지 계좌는 이미 반영했습니다.",
        elapsedMs,
      );
    }
    console.error("balance", shell.bankName, error.payload?.rsp_code || error.message);
    return viewFromFailure(shell, "error", error.message || "잔액조회에 실패했습니다.", elapsedMs);
  }
}

app.get("/api/dashboard", async (req, res) => {
  if (!sessionMode(req)) {
    return res.status(401).json({ message: "먼저 오픈뱅킹에 연결하거나 테스트 데이터로 열어 주세요." });
  }
  const stall = sessionMode(req) === "demo" && req.query.stall === "1";
  const timeoutMs = stall ? DEMO_STALL_TIMEOUT_MS : BALANCE_TIMEOUT_MS;
  const abort = new AbortController();
  const closed = { current: false };
  const deadline = setTimeout(() => abort.abort(), 20_000);
  res.on("close", () => {
    closed.current = true;
    clearTimeout(deadline);
    abort.abort();
  });

  res.status(200);
  res.set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.flushHeaders();

  try {
    const userResult = await loadUser(req, abort.signal);
    if (closed.current) return res.end();
    const accounts = Array.isArray(userResult.body.res_list) ? userResult.body.res_list : [];
    sendEvent(res, closed, "user", {
      mode: userResult.mode,
      stall,
      userName: userResult.body.user_name || "사용자",
      userSeqNo: String(userResult.body.user_seq_no || req.session.ob?.userSeqNo || ""),
      elapsedMs: userResult.elapsedMs,
      accounts: accounts.map(shellFromAccount),
    });

    await Promise.all(
      accounts.map(async (account) => {
        const view = await settleBalance(req, account, { stall, clientSignal: abort.signal, timeoutMs });
        if (view) sendEvent(res, closed, "balance", view);
      }),
    );
    sendEvent(res, closed, "done", { stall });
  } catch (error) {
    if (!closed.current) {
      console.error("dashboard", error.payload?.rsp_code || error.message);
      sendEvent(res, closed, "fail", { message: error.message || "사용자정보조회에 실패했습니다." });
    }
  } finally {
    res.end();
  }
});

app.get("/api/balance", async (req, res) => {
  if (!sessionMode(req)) return res.status(401).json({ message: "연결이 없습니다." });
  const fintechUseNum = String(req.query.fintech_use_num || "");
  if (!/^[A-Za-z0-9]{24}$/.test(fintechUseNum)) {
    return res.status(400).json({ message: "핀테크이용번호 형식이 아닙니다." });
  }

  let account = null;
  try {
    if (sessionMode(req) === "demo") {
      const fixture = findDemoBalance(fintechUseNum);
      account = demoUser().res_list.find((item) => item.fintech_use_num === fintechUseNum) || null;
      if (!fixture || !account) return res.status(404).json({ message: "테스트 응답에 없는 계좌입니다." });
    } else {
      const userResult = await getUser({
        accessToken: req.session.ob.accessToken,
        userSeqNo: req.session.ob.userSeqNo,
      });
      account = (userResult.body.res_list || []).find((item) => item.fintech_use_num === fintechUseNum) || null;
      if (!account) return res.status(404).json({ message: "등록된 계좌에서 찾지 못했습니다." });
    }
    const view = await settleBalance(req, account, {
      stall: false,
      clientSignal: new AbortController().signal,
      timeoutMs: BALANCE_TIMEOUT_MS,
    });
    res.json(view);
  } catch (error) {
    console.error("retry", error.message);
    res.status(502).json({ message: error.message || "다시 조회하지 못했습니다." });
  }
});

app.use(express.static(path.join(__dirname, "../public")));

app.listen(port, () => {
  console.log(`한눈에  http://localhost:${port}`);
  console.log(`Callback  ${callbackUrl}`);
  console.log(ready ? "오픈뱅킹 테스트베드 연결 가능" : `키 없음 (${missingKeys().join(", ")}) — 테스트 데이터 모드만 가능`);
});
