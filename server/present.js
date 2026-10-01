import { accountTypeLabel, enrich } from "./catalog.js";

function amount(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function shellFromAccount(account) {
  return {
    fintechUseNum: account.fintech_use_num,
    bankName: account.savings_bank_name || account.bank_name || "기관 미상",
    accountAlias: account.account_alias || "",
    accountNumMasked: account.account_num_masked || "",
    holderName: account.account_holder_name || "",
    accountType: account.account_type || "",
    accountTypeLabel: accountTypeLabel(account.account_type),
    inquiryAgreed: account.inquiry_agree_yn !== "N",
    productName: null,
    balanceAmt: null,
    availableAmt: null,
    issueDate: null,
    maturityDate: null,
    lastTranDate: null,
    elapsedMs: null,
    status: account.inquiry_agree_yn === "N" ? "skipped" : "loading",
    message: account.inquiry_agree_yn === "N" ? "조회에 동의하지 않은 계좌입니다." : "이 기관 응답을 기다리는 중",
    offer: null,
  };
}

export function viewFromBalance(shell, body, elapsedMs) {
  const productName = body.product_name || "";
  const accountType = body.account_type || shell.accountType;
  return {
    ...shell,
    bankName: body.savings_bank_name || body.bank_name || shell.bankName,
    accountType,
    accountTypeLabel: accountTypeLabel(accountType),
    productName: productName || "상품명 없음",
    balanceAmt: amount(body.balance_amt),
    availableAmt: amount(body.available_amt),
    issueDate: body.account_issue_date || null,
    maturityDate: body.maturity_date || null,
    lastTranDate: body.last_tran_date || null,
    elapsedMs,
    status: "ok",
    message: "",
    offer: enrich(productName, accountType),
  };
}

export function viewFromFailure(shell, status, message, elapsedMs) {
  return {
    ...shell,
    elapsedMs,
    status,
    message,
    offer: null,
  };
}
