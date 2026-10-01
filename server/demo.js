import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const file = join(dirname(fileURLToPath(import.meta.url)), "../data/test-responses.json");
const data = JSON.parse(readFileSync(file, "utf8"));

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? Object.assign(new Error("aborted"), { name: "AbortError" }));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? Object.assign(new Error("aborted"), { name: "AbortError" }));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function demoUser() {
  return data.user;
}

export function findDemoBalance(fintechUseNum) {
  return data.balances.find((item) => item.body.fintech_use_num === fintechUseNum) || null;
}

export async function demoBalance(fintechUseNum, { stall, signal }) {
  const item = findDemoBalance(fintechUseNum);
  if (!item) {
    throw Object.assign(new Error("등록된 테스트 응답에 없는 계좌입니다."), { name: "NotFound" });
  }
  const delay = stall && item.slow ? 30_000 : item.delayMs;
  const started = Date.now();
  await sleep(delay, signal);
  return { body: item.body, elapsedMs: Date.now() - started };
}
