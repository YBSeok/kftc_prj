const ACCOUNT_TYPES = {
  1: "수시입출금",
  2: "예적금",
  6: "수익증권",
};

/**
 * 오픈뱅킹 잔액조회는 상품명과 금액까지만 줍니다.
 * 금리·수수료·혜택은 상품명에 맞춰 이 앱이 붙이는 참고 정보입니다.
 */
const PRODUCTS = [
  {
    productName: "내맘대로통장",
    category: "수시입출금",
    rateLabel: "연 0.10%",
    rateValue: 0.1,
    feeLabel: "타행이체 월 10회 면제",
    feeScore: 2,
    benefits: ["공과금 자동이체 우대", "첫 달 출금수수료 면제"],
  },
  {
    productName: "월급통장",
    category: "수시입출금",
    rateLabel: "연 0.10%",
    rateValue: 0.1,
    feeLabel: "타행이체 횟수 제한 없이 면제",
    feeScore: 3,
    benefits: ["급여이체 시 이체수수료 면제", "월 2회 커피 제휴 할인", "ATM 출금수수료 면제"],
  },
  {
    productName: "청년도약적금",
    category: "예적금",
    rateLabel: "연 4.50% (우대 포함)",
    rateValue: 4.5,
    feeLabel: "해당 없음",
    feeScore: 0,
    benefits: ["만기 유지 시 우대금리", "중도해지 시 약정금리보다 낮은 기본금리"],
  },
];

export function accountTypeLabel(code) {
  return ACCOUNT_TYPES[String(code)] || "기타";
}

export function enrich(productName, accountType) {
  const found = PRODUCTS.find((item) => item.productName === productName);
  if (found) {
    return {
      source: "catalog",
      sourceLabel: "한눈에 정리",
      category: found.category,
      rateLabel: found.rateLabel,
      rateValue: found.rateValue,
      feeLabel: found.feeLabel,
      feeScore: found.feeScore,
      benefits: found.benefits,
      gap: null,
    };
  }
  return {
    source: "openbanking-only",
    sourceLabel: "오픈뱅킹만",
    category: accountTypeLabel(accountType),
    rateLabel: null,
    rateValue: null,
    feeLabel: null,
    feeScore: 0,
    benefits: [],
    gap: "잔액조회는 상품명과 잔액까지만 돌려줍니다. 금리·수수료·혜택은 이 상품에 아직 연결되어 있지 않습니다.",
  };
}
