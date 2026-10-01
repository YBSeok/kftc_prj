const banner = document.querySelector("#banner");
const gate = document.querySelector("#gate");
const gateActions = document.querySelector("#gate-actions");
const setup = document.querySelector("#setup");
const workspace = document.querySelector("#workspace");
const summary = document.querySelector("#summary");
const cards = document.querySelector("#cards");
const insight = document.querySelector("#insight");
const compare = document.querySelector("#compare");
const trace = document.querySelector("#trace");

const state = {
  status: null,
  mode: null,
  stall: false,
  userName: "",
  userElapsed: null,
  accounts: [],
  stream: null,
};

const won = (value) =>
  value === null || value === undefined ? "—" : `${new Intl.NumberFormat("ko-KR").format(value)}원`;

const ymd = (value) =>
  value && String(value).length === 8
    ? `${value.slice(0, 4)}.${value.slice(4, 6)}.${value.slice(6, 8)}`
    : null;

const ms = (value) => (value === null || value === undefined ? "" : `${value}ms`);

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "hidden") node.hidden = true;
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child?.nodeType ? child : document.createTextNode(child ?? ""));
  return node;
}

function showBanner(text, kind) {
  if (!text) {
    banner.hidden = true;
    banner.textContent = "";
    return;
  }
  banner.hidden = false;
  banner.dataset.kind = kind || "warn";
  banner.textContent = text;
}

function renderSetup(status) {
  setup.replaceChildren();
  const items = [
    ["개발자사이트 회원가입", "developers.kftc.or.kr"],
    ["앱 등록 후 Client ID / Client Secret", status.clientIdMasked ? `Client ID ${status.clientIdMasked}` : ".env의 CLIENT_ID, CLIENT_SECRET"],
    ["Callback URL 등록", status.callbackUrl],
    ["테스트용 응답 데이터", "가상 계좌 잔액을 잔액조회 응답으로 등록"],
    ["REST API 테스트 도구", "토큰 발급 → 사용자정보조회 → 잔액조회"],
  ];
  setup.append(
    el("h2", {}, ["연결 전에 개발자사이트에서"]),
    el("p", {}, [
      status.ready
        ? "키가 준비되어 있습니다. 테스트 도구에서 한 번 호출해 본 뒤 테스트베드로 연결하면 됩니다."
        : `아직 ${status.missing.join(", ")} 값이 비어 있습니다. 없어도 등록해 둔 테스트 응답과 같은 형식의 데이터로 화면은 볼 수 있습니다.`,
    ]),
    el(
      "ol",
      {},
      items.map(([title, meta]) => el("li", {}, [title, el("span", { class: "meta mono" }, [meta])])),
    ),
  );
}

function renderGate(status) {
  gateActions.replaceChildren();
  const connect = el("button", { class: "primary", type: "button" }, ["오픈뱅킹 테스트베드 연결"]);
  connect.disabled = !status.ready;
  connect.addEventListener("click", () => {
    window.location.href = "/auth/start";
  });
  const demo = el("button", { class: "ghost", type: "button" }, ["테스트 데이터로 보기"]);
  demo.addEventListener("click", async () => {
    demo.disabled = true;
    await fetch("/auth/demo", { method: "POST" });
    await openWorkspace({ stall: false });
  });
  gateActions.append(connect, demo);
  if (!status.ready) {
    gateActions.append(el("p", { class: "hint" }, ["키를 넣기 전에는 테스트베드 연결이 잠겨 있습니다."]));
  }
  renderSetup(status);
}

function spendingScore(account) {
  const offer = account.offer;
  if (!offer || offer.source !== "catalog" || offer.category !== "수시입출금") return -1;
  return offer.feeScore * 10 + offer.benefits.length;
}

function buildInsight(accounts) {
  const ready = accounts.filter((account) => account.status === "ok");
  const waiting = accounts.filter((account) => account.status === "loading" || account.status === "delayed");
  const spending = ready.filter((account) => account.offer?.category === "수시입출금");
  const lines = [];

  if (spending.length >= 2) {
    const richest = [...spending].sort((a, b) => (b.balanceAmt || 0) - (a.balanceAmt || 0))[0];
    const better = [...spending].sort((a, b) => spendingScore(b) - spendingScore(a))[0];
    if (richest.fintechUseNum !== better.fintechUseNum) {
      lines.push(
        `잔액만 보면 ${richest.bankName} ${richest.productName}에 더 많은 돈이 있습니다. 수수료와 혜택까지 나란히 보면 ${better.bankName} ${better.productName}의 입출금 조건이 더 낫습니다. 오픈뱅킹 잔액조회만으로는 이 비교가 되지 않습니다.`,
      );
    } else {
      lines.push(`${better.bankName} ${better.productName}이 잔액과 혜택을 함께 봐도 입출금 계좌 중 앞에 있습니다.`);
    }
  } else if (ready.length === 0) {
    lines.push("먼저 도착하는 계좌부터 비교에 넣습니다.");
  }

  const savings = ready.filter((account) => account.offer?.category === "예적금" && account.offer.rateLabel);
  if (savings.length) {
    const best = [...savings].sort((a, b) => (b.offer.rateValue || 0) - (a.offer.rateValue || 0))[0];
    lines.push(`예적금은 잔액이 아니라 금리로 봅니다. ${best.bankName} ${best.productName}은 ${best.offer.rateLabel}로 정리되어 있습니다.`);
  }

  const unknown = ready.filter((account) => account.offer?.source === "openbanking-only");
  if (unknown.length) {
    lines.push(`${unknown.map((account) => account.productName).join(", ")}은 오픈뱅킹이 준 상품명만 있습니다. 혜택 정보가 없어 비교 줄이 비어 있습니다.`);
  }

  return { lines, waiting };
}

function renderSummary() {
  const done = state.accounts.filter((account) => account.status === "ok");
  const pending = state.accounts.filter((account) => account.status === "loading" || account.status === "delayed");
  const total = done.reduce((sum, account) => sum + (account.balanceAmt || 0), 0);
  const timed = state.accounts.filter((account) => account.elapsedMs);
  const slowest = timed.reduce(
    (best, account) => ((account.elapsedMs || 0) > (best?.elapsedMs || 0) ? account : best),
    null,
  );
  const bits = [];
  bits.push(el("div", {}, [
    el("p", { class: "label" }, ["확인된 잔액"]),
    el("strong", {}, [state.accounts.length ? won(total) : "조회 중"]),
    el("p", { class: "hint" }, [
      state.accounts.length === 0
        ? "조회를 시작하는 중"
        : done.length === 0
          ? "먼저 도착하는 기관부터 잔액에 넣습니다"
          : pending.length
            ? `${pending.map((account) => account.bankName).join(", ")} 제외 · ${done.length}개 기관 반영`
            : `${done.length}개 계좌 모두 반영`,
    ]),
  ]));
  bits.push(el("div", {}, [
    el("p", { class: "label" }, ["응답"]),
    el("strong", {}, [`${done.length}/${state.accounts.length || "—"}`]),
    el("p", { class: "hint" }, [state.userName ? `${state.userName}` : ""]),
  ]));
  bits.push(el("div", {}, [
    el("p", { class: "label" }, ["가장 오래 걸린 기관"]),
    el("strong", {}, [slowest ? slowest.bankName : "—"]),
    el("p", { class: "hint" }, [slowest ? ms(slowest.elapsedMs) : "아직 없음"]),
  ]));
  const tools = el("div", { class: "actions" });
  if (state.mode === "demo") {
    const stall = el("button", { class: "ghost", type: "button" }, [
      state.stall ? "보통 속도로 다시 보기" : "한 기관이 멈추는 상황",
    ]);
    stall.addEventListener("click", () => openWorkspace({ stall: !state.stall }));
    tools.append(stall);
  }
  const logout = el("button", { class: "text-btn", type: "button" }, ["연결 해제"]);
  logout.addEventListener("click", async () => {
    state.stream?.abort();
    await fetch("/auth/logout", { method: "POST" });
    state.accounts = [];
    workspace.hidden = true;
    gate.hidden = false;
    showBanner("");
    const status = await loadStatus();
    renderGate(status);
  });
  tools.append(logout);
  bits.push(tools);
  summary.replaceChildren(...bits);
}

function renderCards() {
  cards.replaceChildren(
    ...state.accounts.map((account) => {
      const statusClass =
        account.status === "ok" ? "is-ok" : account.status === "delayed" || account.status === "error" ? `is-${account.status}` : "is-loading";
      const chip =
        account.status === "ok"
          ? ms(account.elapsedMs)
          : account.status === "delayed"
            ? "이 기관만 지연"
            : account.status === "error"
              ? "실패"
              : account.status === "skipped"
                ? "조회 동의 없음"
                : "조회 중";
      const foot = [account.accountNumMasked, account.accountAlias].filter(Boolean).join(" · ");
      const children = [
        el("div", { class: "card-top" }, [el("span", { class: "bank" }, [account.bankName]), el("span", { class: "chip" }, [chip])]),
        el("p", { class: "product" }, [account.productName || account.accountTypeLabel || "계좌"]),
        el("p", { class: "balance" }, [
          account.status === "ok" ? won(account.balanceAmt) : account.message || "응답을 기다리는 중",
        ]),
      ];
      if (account.status === "ok") {
        const meta = [
          account.offer?.rateLabel,
          ymd(account.maturityDate) ? `만기 ${ymd(account.maturityDate)}` : null,
          ymd(account.lastTranDate) ? `최근 거래 ${ymd(account.lastTranDate)}` : null,
        ]
          .filter(Boolean)
          .join(" · ");
        children.push(el("p", { class: "muted" }, [meta || account.offer?.gap || ""]));
      }
      if (account.status === "delayed" || account.status === "error") {
        const retry = el("button", { class: "text-btn", type: "button" }, ["이 기관만 다시 조회"]);
        retry.addEventListener("click", () => retryOne(account.fintechUseNum, retry));
        children.push(retry);
      }
      children.push(el("div", { class: "card-foot" }, [foot || account.holderName || ""]));
      return el("article", { class: `card ${statusClass}` }, children);
    }),
  );
}

function renderCompare() {
  const { lines, waiting } = buildInsight(state.accounts);
  insight.replaceChildren(
    ...lines.map((line) => el("p", {}, [line])),
    waiting.length ? el("p", { class: "wait" }, [`아직 ${waiting.map((account) => account.bankName).join(", ")} 응답 전입니다. 비교는 먼저 온 계좌로 시작합니다.`]) : "",
  );
  const head = el("tr", {}, ["은행", "상품", "구분", "잔액", "금리", "수수료", "혜택"].map((name) => el("th", {}, [name])));
  const rows = state.accounts.map((account) => {
    const benefits = account.offer?.benefits?.length
      ? el("ul", {}, account.offer.benefits.map((benefit) => el("li", {}, [benefit])))
      : account.offer?.gap || (account.status === "loading" ? "도착하면 채움" : "—");
    return el("tr", {}, [
      el("td", {}, [account.bankName]),
      el("td", {}, [account.productName || "—"]),
      el("td", {}, [account.offer?.category || account.accountTypeLabel || "—"]),
      el("td", {}, [account.status === "ok" ? won(account.balanceAmt) : account.status === "delayed" ? "지연" : "—"]),
      el("td", {}, [account.offer?.rateLabel || "—"]),
      el("td", {}, [account.offer?.feeLabel || "—"]),
      el("td", {}, [benefits]),
    ]);
  });
  compare.replaceChildren(el("table", {}, [el("thead", {}, [head]), el("tbody", {}, rows)]));
}

function renderTrace() {
  const items = [
    `사용자정보조회 GET /v2.0/user/me${state.userElapsed !== null ? ` · ${ms(state.userElapsed)}` : ""}`,
    ...state.accounts.map((account) => {
      const tail =
        account.status === "ok"
          ? ms(account.elapsedMs)
          : account.status === "delayed"
            ? "시간 초과, 전체 조회는 계속"
            : account.status === "loading"
              ? "진행 중"
              : account.message || account.status;
      return `잔액조회 GET /v2.0/account/balance/fin_num · ${account.bankName} · ${tail}`;
    }),
  ];
  trace.replaceChildren(...items.map((item) => el("li", {}, [item])));
}

function renderAll() {
  renderSummary();
  renderCards();
  renderCompare();
  renderTrace();
}

function upsertAccount(view) {
  const index = state.accounts.findIndex((account) => account.fintechUseNum === view.fintechUseNum);
  if (index >= 0) state.accounts[index] = view;
  else state.accounts.push(view);
}

async function readEvents(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let splitAt = buffer.indexOf("\n\n");
    while (splitAt >= 0) {
      const raw = buffer.slice(0, splitAt);
      buffer = buffer.slice(splitAt + 2);
      let event = "message";
      const dataLines = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length) onEvent(event, JSON.parse(dataLines.join("\n")));
      splitAt = buffer.indexOf("\n\n");
    }
  }
}

async function openWorkspace({ stall }) {
  state.stream?.abort();
  const controller = new AbortController();
  state.stream = controller;
  state.stall = stall;
  state.accounts = [];
  gate.hidden = true;
  workspace.hidden = false;
  renderAll();

  try {
    const response = await fetch(`/api/dashboard${stall ? "?stall=1" : ""}`, {
      headers: { Accept: "text/event-stream" },
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || "조회를 시작하지 못했습니다.");
    }
    await readEvents(response, (event, data) => {
      if (controller.signal.aborted) return;
      if (event === "user") {
        state.mode = data.mode;
        state.userName = data.userName;
        state.userElapsed = data.elapsedMs;
        state.accounts = data.accounts;
        showBanner(
          data.mode === "demo"
            ? "개발자사이트에 등록하는 테스트 응답과 같은 형식의 가상 데이터입니다. 느린저축은행은 일부러 늦게 도착합니다."
            : "금융결제원 테스트베드에서 사용자정보와 잔액을 가져오는 중입니다.",
          data.mode === "demo" ? "warn" : "ok",
        );
      } else if (event === "balance") {
        upsertAccount(data);
      } else if (event === "fail") {
        showBanner(data.message, "warn");
      }
      renderAll();
    });
  } catch (error) {
    if (error.name === "AbortError") return;
    showBanner(error.message, "warn");
  }
}

async function retryOne(fintechUseNum, button) {
  button.disabled = true;
  const current = state.accounts.find((account) => account.fintechUseNum === fintechUseNum);
  if (current) upsertAccount({ ...current, status: "loading", message: "이 기관만 다시 조회하는 중" });
  renderAll();
  const response = await fetch(`/api/balance?fintech_use_num=${encodeURIComponent(fintechUseNum)}`);
  const data = await response.json();
  if (!response.ok) {
    if (current) upsertAccount({ ...current, status: "error", message: data.message || "다시 조회하지 못했습니다." });
  } else {
    upsertAccount(data);
  }
  renderAll();
}

async function loadStatus() {
  const response = await fetch("/api/status");
  state.status = await response.json();
  return state.status;
}

const params = new URLSearchParams(window.location.search);
if (params.get("error")) showBanner(params.get("error"), "warn");
if (params.get("connected")) showBanner("테스트베드 인증이 끝났습니다. 계좌를 불러옵니다.", "ok");
if (params.get("error") || params.get("connected")) history.replaceState({}, "", "/");

loadStatus()
  .then((status) => {
    renderGate(status);
    if (status.session) return openWorkspace({ stall: false });
    return null;
  })
  .catch((error) => showBanner(error.message, "warn"));
