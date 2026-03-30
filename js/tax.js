/* =============================================================
  PlanTax — js/tax.js
   Thai personal income tax calculator & deduction optimizer
   Tax year 2568 (2025)
   ============================================================= */

"use strict";

/* ─────────────────────────────────────────────
   1. CONSTANTS
   ───────────────────────────────────────────── */

/** Progressive tax brackets (upper bound inclusive, Infinity for last) */
const TAX_BRACKETS = [
  { min: 0, max: 150_000, rate: 0, label: "0%" },
  { min: 150_001, max: 300_000, rate: 0.05, label: "5%" },
  { min: 300_001, max: 500_000, rate: 0.1, label: "10%" },
  { min: 500_001, max: 750_000, rate: 0.15, label: "15%" },
  { min: 750_001, max: 1_000_000, rate: 0.2, label: "20%" },
  { min: 1_000_001, max: 2_000_000, rate: 0.25, label: "25%" },
  { min: 2_000_001, max: 5_000_000, rate: 0.3, label: "30%" },
  { min: 5_000_001, max: Infinity, rate: 0.35, label: "35%" },
];

const PERSONAL_ALLOWANCE = 60_000;
const COMBINED_INVESTMENT_CAP = 500_000;
const SSF_MAX = 200_000;
const RMF_MAX = 500_000;
const ESG_MAX = 300_000;
const INVESTMENT_INCOME_PCT = 0.3; // 30% of income
const SS_MAX = 9_000;
const LIFE_INS_MAX = 100_000;
const HEALTH_INS_MAX = 25_000; // within life+health combined cap of 100k
const PARENTS_HEALTH_MAX = 15_000;
const MORTGAGE_MAX = 100_000;
const DONATION_CAP_PCT = 0.1; // 10% of net income

/** Ordered list of plannable deduction categories (default priority top → bottom) */
const PRIORITY_ITEMS = [
  { id: "ssf", label: "SSF — กองทุนรวมเพื่อการออม", shortLabel: "SSF", category: "invest" },
  { id: "rmf", label: "RMF — กองทุนรวมเพื่อการเลี้ยงชีพ", shortLabel: "RMF", category: "invest" },
  {
    id: "esg",
    label: "Thai ESG — กองทุนรวมไทยเพื่อความยั่งยืน",
    shortLabel: "ESG",
    category: "invest",
  },
  {
    id: "eduDon",
    label: "บริจาคเพื่อการศึกษา / กีฬา / สาธารณสุข (2×)",
    shortLabel: "บริจาคศึกษา (2×)",
    category: "donate",
  },
  {
    id: "lifeIns",
    label: "ประกันชีวิต / เงินฝากสะสมทรัพย์",
    shortLabel: "ประกันชีวิต",
    category: "insure",
  },
  { id: "healthIns", label: "ประกันสุขภาพ", shortLabel: "ประกันสุขภาพ", category: "insure" },
  { id: "parentHlth", label: "ประกันสุขภาพบิดา/มารดา", shortLabel: "ปกส.บิดา/มารดา", category: "insure" },
  { id: "regDon", label: "เงินบริจาคทั่วไป", shortLabel: "บริจาคทั่วไป", category: "donate" },
];

/** Lookup maps built from PRIORITY_ITEMS */
const ITEM_BY_ID = new Map(PRIORITY_ITEMS.map((p) => [p.id, p]));

/** Current user-selected priority order (array of PRIORITY_ITEMS ids) */
let currentPriorityOrder = PRIORITY_ITEMS.map((p) => p.id);

/** Cached permutations of priority IDs (computed once on first use) */
let cachedPermutations = null;

/* ── SVG Icon constants (replacing emoji) ────────────────── */
const ICON_PIN = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 1C5.24 1 3 3.24 3 6c0 3.75 5 9 5 9s5-5.25 5-9c0-2.76-2.24-5-5-5zm0 7a2 2 0 110-4 2 2 0 010 4z" fill="currentColor"/></svg>`;
const ICON_CELEBRATE = `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 18a8 8 0 100-16 8 8 0 000 16z" stroke="currentColor" stroke-width="1.5"/><path d="M6.5 10l2.5 2.5L13.5 7" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_BOLT = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8.5 1L3 9h4.5L6.5 15 13 7H8.5L9.5 1z" fill="currentColor"/></svg>`;
const ICON_CHECK = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M5 8l2 2 4-4" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_CROSS = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
const ICON_WARN = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 1.5L1 14h14L8 1.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6v4M8 12h.01" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

/* ─────────────────────────────────────────────
   2. TAX CALCULATION
   ───────────────────────────────────────────── */

/**
 * Calculate income tax using progressive brackets.
 * @param {number} taxableIncome
 * @returns {number} tax amount (rounded to nearest baht)
 */
function calcTax(taxableIncome) {
  if (taxableIncome <= 0) return 0;
  let tax = 0;
  let prev = 0;
  for (const b of TAX_BRACKETS) {
    const top =
      b.max === Infinity ? taxableIncome : Math.min(taxableIncome, b.max);
    if (top <= prev) break;
    tax += (top - prev) * b.rate;
    prev = b.max === Infinity ? taxableIncome : b.max;
    if (prev >= taxableIncome) break;
  }
  return Math.round(tax);
}

/**
 * Return the marginal bracket for a given taxable income.
 * @param {number} taxableIncome
 * @returns {object} bracket object
 */
function getMarginalBracket(taxableIncome) {
  if (taxableIncome <= 0) return TAX_BRACKETS[0];
  for (let i = TAX_BRACKETS.length - 1; i >= 0; i--) {
    if (taxableIncome >= TAX_BRACKETS[i].min) return TAX_BRACKETS[i];
  }
  return TAX_BRACKETS[0];
}

/**
 * Return the amount of taxable income that falls within a bracket.
 * @param {number} taxableIncome
 * @param {object} bracket  A TAX_BRACKETS entry
 * @param {number} prevMax  Upper bound of the preceding bracket (0 for the first)
 * @returns {number}
 */
function incomeInBracket(taxableIncome, bracket, prevMax) {
  if (taxableIncome < bracket.min) return 0;
  const top =
    bracket.max === Infinity
      ? taxableIncome
      : Math.min(taxableIncome, bracket.max);
  return Math.max(0, top - prevMax);
}

/**
 * Calculate expense deduction based on income type.
 * @param {number} income
 * @param {'salary'|'freelance'} incomeType
 * @returns {number}
 */
function calcExpenseDeduction(income, incomeType) {
  if (incomeType === "freelance") return Math.min(income * 0.6, 600_000);
  return Math.min(income * 0.5, 100_000);
}

/* ─────────────────────────────────────────────
   3. DEDUCTION AGGREGATION
   ───────────────────────────────────────────── */

/**
 * Gather all current deductions and return a detailed breakdown.
 * @param {number} income
 * @param {'salary'|'freelance'} incomeType
 * @param {object} d  Raw deduction inputs from the form
 * @returns {object}
 */
function buildDeductionSummary(income, incomeType, d) {
  // Standard
  const expenseDeduction = calcExpenseDeduction(income, incomeType);

  // Personal & family
  const spouseAllowance = d.hasSpouse ? 60_000 : 0;
  const childAllowance = Math.max(0, d.numChildren || 0) * 30_000;
  const parentAllowance = Math.min(Math.max(0, d.numParents || 0), 4) * 30_000;
  const disabilityAllowance = Math.max(0, d.numDisabled || 0) * 60_000;

  // Insurance (cap each individually, then apply combined life+health cap of 100k)
  const ss = Math.min(Math.max(0, d.socialSecurity || 0), SS_MAX);
  const lifeIns = Math.min(Math.max(0, d.lifeInsurance || 0), LIFE_INS_MAX);
  const healthRaw = Math.min(
    Math.max(0, d.healthInsurance || 0),
    HEALTH_INS_MAX,
  );
  // Combined life + health cap = 100k
  const healthIns = Math.min(healthRaw, Math.max(0, LIFE_INS_MAX - lifeIns));
  const parentsHealth = Math.min(
    Math.max(0, d.parentsHealthIns || 0),
    PARENTS_HEALTH_MAX,
  );

  // Investments (individual caps + combined cap)
  const pvf = Math.max(0, d.pvf || 0); // provident fund / GPF
  const ssfRaw = Math.min(
    Math.max(0, d.ssf || 0),
    Math.min(income * INVESTMENT_INCOME_PCT, SSF_MAX),
  );
  const rmfRaw = Math.min(
    Math.max(0, d.rmf || 0),
    Math.min(income * INVESTMENT_INCOME_PCT, RMF_MAX),
  );
  const esgRaw = Math.min(
    Math.max(0, d.esg || 0),
    Math.min(income * INVESTMENT_INCOME_PCT, ESG_MAX),
  );

  // Enforce combined cap (pvf + ssf + rmf + esg ≤ 500k)
  let investRemain = Math.max(0, COMBINED_INVESTMENT_CAP - pvf);
  const ssf = Math.min(ssfRaw, investRemain);
  investRemain -= ssf;
  const rmf = Math.min(rmfRaw, investRemain);
  investRemain -= rmf;
  const esg = Math.min(esgRaw, investRemain);

  // Other
  const mortgage = Math.min(Math.max(0, d.mortgageInterest || 0), MORTGAGE_MAX);

  const totalExistingAdditional =
    spouseAllowance +
    childAllowance +
    parentAllowance +
    disabilityAllowance +
    ss +
    lifeIns +
    healthIns +
    parentsHealth +
    Math.min(pvf + ssf + rmf + esg, COMBINED_INVESTMENT_CAP) +
    mortgage;

  const totalDeductions =
    expenseDeduction + PERSONAL_ALLOWANCE + totalExistingAdditional;
  const taxableIncome = Math.max(0, income - totalDeductions);
  const currentTax = calcTax(taxableIncome);
  const effectiveRate = income > 0 ? (currentTax / income) * 100 : 0;
  const marginalBracket = getMarginalBracket(taxableIncome);

  return {
    income,
    incomeType,
    // breakdown lines
    expenseDeduction,
    personalAllowance: PERSONAL_ALLOWANCE,
    spouseAllowance,
    childAllowance,
    parentAllowance,
    disabilityAllowance,
    ss,
    lifeIns,
    healthIns,
    parentsHealth,
    pvf,
    ssf,
    rmf,
    esg,
    mortgage,
    totalDeductions,
    taxableIncome,
    currentTax,
    effectiveRate,
    marginalBracket,
  };
}

/* ─────────────────────────────────────────────
   4. AVAILABLE CAPACITY (additional deductions)
   ───────────────────────────────────────────── */

/**
 * Calculate remaining capacity for each deductible category.
 * @param {number} income
 * @param {object} summary  output of buildDeductionSummary
 * @returns {object} capacity object
 */
function calcAvailableCapacity(income, summary) {
  // Investment remaining within combined cap
  const usedInvestment = summary.pvf + summary.ssf + summary.rmf + summary.esg;
  const investRemain = Math.max(0, COMBINED_INVESTMENT_CAP - usedInvestment);

  const ssfCap = Math.min(income * INVESTMENT_INCOME_PCT, SSF_MAX);
  const rmfCap = Math.min(income * INVESTMENT_INCOME_PCT, RMF_MAX);
  const esgCap = Math.min(income * INVESTMENT_INCOME_PCT, ESG_MAX);

  let remInv = investRemain;
  const availSSF = Math.min(Math.max(0, ssfCap - summary.ssf), remInv);
  remInv -= availSSF;
  const availRMF = Math.min(Math.max(0, rmfCap - summary.rmf), remInv);
  remInv -= availRMF;
  const availESG = Math.min(Math.max(0, esgCap - summary.esg), remInv);

  // Insurance remaining
  const usedCombinedIns = summary.lifeIns + summary.healthIns;
  const availLifeIns = Math.max(
    0,
    LIFE_INS_MAX -
      summary.lifeIns -
      Math.max(0, usedCombinedIns - summary.lifeIns),
  );
  // remaining health: max(0, 25k - used_health) but also within combined 100k
  const availHealthIns = Math.min(
    Math.max(0, HEALTH_INS_MAX - summary.healthIns),
    Math.max(0, LIFE_INS_MAX - usedCombinedIns),
  );
  const availParentsHealth = Math.max(
    0,
    PARENTS_HEALTH_MAX - summary.parentsHealth,
  );

  // Donation cap: 10% of net income before donations
  // "net income before donations" ≈ taxableIncome (donations aren't yet applied)
  const donationBase = summary.taxableIncome;
  const eduDonCap = Math.floor(donationBase * DONATION_CAP_PCT); // deduction cap for edu donation
  const regDonCap = Math.floor(donationBase * DONATION_CAP_PCT); // deduction cap for regular donation

  return {
    availSSF,
    availRMF,
    availESG,
    availLifeIns,
    availHealthIns,
    availParentsHealth,
    eduDonCap,
    regDonCap,
  };
}

/* ─────────────────────────────────────────────
   5. OPTIMIZATION — minimum-spend plan
   ───────────────────────────────────────────── */

/**
 * Generate all permutations of an array (recursive, returns full list).
 * @param {Array} arr
 * @returns {Array[]} array of all permutations
 */
function getPermutations(arr) {
  if (arr.length <= 1) return [arr];
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const perm of getPermutations(rest)) {
      result.push([arr[i], ...perm]);
    }
  }
  return result;
}

/**
 * Return cached permutations of all PRIORITY_ITEMS ids.
 * Computed once on first call and reused thereafter.
 * @returns {Array[]}
 */
function getAllPriorityPermutations() {
  if (!cachedPermutations) {
    cachedPermutations = getPermutations(PRIORITY_ITEMS.map((p) => p.id));
  }
  return cachedPermutations;
}

/**
 * Find the priority order that maximises netRealSaving for a given
 * neededDeduction / target bracket.
 *
 * It tries every permutation of the priority items and picks the one
 * that gives the highest netRealSaving (= taxSaving − totalSpend).
 *
 * @param {number}   neededDeduction  Additional deduction needed
 * @param {object}   cap              Available capacity (from calcAvailableCapacity)
 * @param {number}   marginalRate     Current marginal tax rate
 * @param {number}   taxSaving        Tax saved by hitting the target bracket
 * @returns {{ bestPlan: Array, bestOrder: string[], bestNetSaving: number,
 *             achievable: boolean, remainingShortfall: number }}
 */
function findBestPlan(neededDeduction, cap, marginalRate, taxSaving) {
  const allPerms = getAllPriorityPermutations();

  let bestNetSaving = -Infinity;
  let bestResult = null;
  let bestOrder = null;

  for (const perm of allPerms) {
    const result = buildOptimalPlan(neededDeduction, cap, marginalRate, perm);
    const totalSpend = result.plan.reduce((s, p) => s + p.spendAmt, 0);
    const netSaving = taxSaving - totalSpend;

    if (netSaving > bestNetSaving) {
      bestNetSaving = netSaving;
      bestResult = result;
      bestOrder = perm;
    }
  }

  return {
    bestPlan: bestResult.plan,
    bestOrder,
    bestNetSaving,
    achievable: bestResult.achievable,
    remainingShortfall: bestResult.remainingShortfall,
  };
}

/**
 * Build a recommendation plan to achieve `neededDeduction` of additional deduction
 * with minimum permanent cash outflow, respecting the user-defined priority order.
 *
 * @param {number}   neededDeduction  Additional taxable income reduction required
 * @param {object}   cap              Output of calcAvailableCapacity
 * @param {number}   marginalRate     Current marginal tax rate (decimal)
 * @param {string[]} priorityOrder    Ordered array of PRIORITY_ITEMS ids (first = highest priority)
 * @returns {{ plan: Array, achievable: boolean, remainingShortfall: number }}
 */
function buildOptimalPlan(neededDeduction, cap, marginalRate, priorityOrder) {
  const plan = [];
  let rem = neededDeduction;

  function addStep(id, type, category, deductionAmt, spendAmt, note) {
    if (deductionAmt <= 0) return;
    const taxSaved = Math.round(deductionAmt * marginalRate);
    plan.push({
      id,
      type,
      category,
      deductionAmt: Math.round(deductionAmt),
      spendAmt: Math.round(spendAmt),
      taxSaved,
      note,
    });
    rem -= deductionAmt;
  }

  for (const id of priorityOrder) {
    if (rem <= 0) break;
    switch (id) {
      case "ssf": {
        if (cap.availSSF > 0) {
          const use = Math.min(rem, cap.availSSF);
          addStep(
            "ssf",
            "SSF",
            "invest",
            use,
            use,
            "ลงทุน – ได้คืนเมื่อถอน (ถือครอง 10 ปี)",
          );
        }
        break;
      }
      case "rmf": {
        if (cap.availRMF > 0) {
          const use = Math.min(rem, cap.availRMF);
          addStep(
            "rmf",
            "RMF",
            "invest",
            use,
            use,
            "ลงทุน – ได้คืนเมื่ออายุ 55 ปี (ถือครอง 5 ปี)",
          );
        }
        break;
      }
      case "esg": {
        if (cap.availESG > 0) {
          const use = Math.min(rem, cap.availESG);
          addStep(
            "esg",
            "Thai ESG",
            "invest",
            use,
            use,
            "ลงทุน – ได้คืนหลังถือครอง 5 ปี",
          );
        }
        break;
      }
      case "eduDon": {
        if (cap.eduDonCap > 0) {
          const usableDeduction = Math.min(rem, cap.eduDonCap);
          // Education/sport/health donations get a 2× deduction: pay half, deduct full amount
          addStep(
            "eduDon",
            "บริจาคเพื่อการศึกษา / กีฬา / สาธารณสุข",
            "donate",
            usableDeduction,
            Math.ceil(usableDeduction / 2),
            "ลดหย่อนได้ 2 เท่าของเงินบริจาค (สูงสุด 10% ของเงินได้สุทธิ)",
          );
        }
        break;
      }
      case "lifeIns": {
        if (cap.availLifeIns > 0) {
          const use = Math.min(rem, cap.availLifeIns);
          addStep(
            "lifeIns",
            "ประกันชีวิต / เงินฝากสะสมทรัพย์",
            "insure",
            use,
            use,
            "ได้รับความคุ้มครองชีวิต",
          );
        }
        break;
      }
      case "healthIns": {
        if (cap.availHealthIns > 0) {
          const use = Math.min(rem, cap.availHealthIns);
          addStep(
            "healthIns",
            "ประกันสุขภาพ",
            "insure",
            use,
            use,
            "ได้รับความคุ้มครองสุขภาพ",
          );
        }
        break;
      }
      case "parentHlth": {
        if (cap.availParentsHealth > 0) {
          const use = Math.min(rem, cap.availParentsHealth);
          addStep(
            "parentHlth",
            "ประกันสุขภาพบิดา/มารดา",
            "insure",
            use,
            use,
            "ได้รับความคุ้มครองสุขภาพบิดามารดา",
          );
        }
        break;
      }
      case "regDon": {
        if (cap.regDonCap > 0) {
          const use = Math.min(rem, cap.regDonCap);
          addStep(
            "regDon",
            "เงินบริจาคทั่วไป",
            "donate",
            use,
            use,
            "บริจาคเพื่อสาธารณประโยชน์ (สูงสุด 10% ของเงินได้สุทธิ)",
          );
        }
        break;
      }
      default:
        break;
    }
  }

  return {
    plan,
    achievable: rem <= 0,
    remainingShortfall: Math.max(0, Math.round(rem)),
  };
}

/* ─────────────────────────────────────────────
   6. FORMATTING UTILITIES
   ───────────────────────────────────────────── */

const FMT = new Intl.NumberFormat("th-TH");
const fmtBaht = (n) => FMT.format(Math.round(n)) + " บาท";
const fmtNumber = (n) => FMT.format(Math.round(n));
const fmtPct = (n) => n.toFixed(2) + "%";

/* ─────────────────────────────────────────────
   7. RESULTS RENDERING
   ───────────────────────────────────────────── */

/**
 * Build and inject the results HTML into #results-container.
 * @param {object}   summary       from buildDeductionSummary
 * @param {string[]} priorityOrder ordered array of PRIORITY_ITEMS ids
 * @param {boolean}  [optimize=false] when true, try all priority permutations per bracket
 */
function renderResults(summary, priorityOrder, optimize) {
  const container = document.getElementById("results-container");
  const cap = calcAvailableCapacity(summary.income, summary);
  const marginalRate = summary.marginalBracket.rate;

  // ── Summary cards ──────────────────────────────────────
  const summaryHTML = `
    <div class="summary-grid">
      <div class="summary-card">
        <div class="sc-label">รายได้รวม</div>
        <div class="sc-value">${fmtNumber(summary.income)}</div>
        <div class="sc-sub">บาท</div>
      </div>
      <div class="summary-card">
        <div class="sc-label">ลดหย่อนรวม</div>
        <div class="sc-value">${fmtNumber(summary.totalDeductions)}</div>
        <div class="sc-sub">บาท</div>
      </div>
      <div class="summary-card">
        <div class="sc-label">เงินได้สุทธิ</div>
        <div class="sc-value">${fmtNumber(summary.taxableIncome)}</div>
        <div class="sc-sub">บาท</div>
      </div>
      <div class="summary-card highlight">
        <div class="sc-label">ภาษีที่ต้องชำระ</div>
        <div class="sc-value">${fmtNumber(summary.currentTax)}</div>
        <div class="sc-sub">บาท (${fmtPct(summary.effectiveRate)} ของรายได้)</div>
      </div>
    </div>`;

  // ── Deduction breakdown ────────────────────────────────
  const rows = [
    ["ค่าใช้จ่าย (หักอัตโนมัติ)", summary.expenseDeduction],
    ["ค่าลดหย่อนส่วนตัว", summary.personalAllowance],
    summary.spouseAllowance ? ["คู่สมรส", summary.spouseAllowance] : null,
    summary.childAllowance ? ["บุตร", summary.childAllowance] : null,
    summary.parentAllowance ? ["บิดามารดา", summary.parentAllowance] : null,
    summary.disabilityAllowance
      ? ["ผู้พิการ/ทุพพลภาพ", summary.disabilityAllowance]
      : null,
    summary.ss ? ["เงินประกันสังคม", summary.ss] : null,
    summary.lifeIns ? ["ประกันชีวิต", summary.lifeIns] : null,
    summary.healthIns ? ["ประกันสุขภาพ", summary.healthIns] : null,
    summary.parentsHealth
      ? ["ประกันสุขภาพบิดามารดา", summary.parentsHealth]
      : null,
    summary.pvf ? ["กองทุนสำรองเลี้ยงชีพ/กบข.", summary.pvf] : null,
    summary.ssf ? ["SSF", summary.ssf] : null,
    summary.rmf ? ["RMF", summary.rmf] : null,
    summary.esg ? ["Thai ESG", summary.esg] : null,
    summary.mortgage ? ["ดอกเบี้ยกู้ซื้อบ้าน", summary.mortgage] : null,
  ].filter(Boolean);

  const breakdownRows = rows
    .map(
      ([label, amt]) =>
        `<tr><td>${label}</td><td class="amt negative">− ${fmtNumber(amt)}</td></tr>`,
    )
    .join("");

  const breakdownHTML = `
    <p class="section-title">ค่าลดหย่อนและภาษีสุทธิ</p>
    <table class="breakdown-table">
      <thead><tr><th>รายการ</th><th class="amt">จำนวน (บาท)</th></tr></thead>
      <tbody>
        <tr><td>รายได้รวม</td><td class="amt">${fmtNumber(summary.income)}</td></tr>
        ${breakdownRows}
        <tr class="total-row">
          <td>เงินได้สุทธิ (ฐานภาษี)</td>
          <td class="amt total">${fmtNumber(summary.taxableIncome)}</td>
        </tr>
      </tbody>
    </table>`;

  // ── Tax bracket ladder ─────────────────────────────────
  const maxBarValue = Math.max(summary.taxableIncome, 1);
  const barColors = {
    0: ".bar-0",
    5: ".bar-5",
    10: ".bar-10",
    15: ".bar-15",
    20: ".bar-20",
    25: ".bar-25",
    30: ".bar-30",
    35: ".bar-35",
  };

  const ladderRows = TAX_BRACKETS.map((b) => {
    if (b.min > summary.taxableIncome + 1 && b.min > 150_000) return "";
    const incomeFalls = summary.taxableIncome >= b.min;
    const taxInBracket = incomeFalls
      ? calcTax(
          Math.min(
            summary.taxableIncome,
            b.max === Infinity ? summary.taxableIncome : b.max,
          ),
        ) - calcTax(Math.max(0, b.min - 1))
      : 0;
    const width = incomeFalls
      ? Math.round(
          Math.min(
            ((Math.min(
              summary.taxableIncome,
              b.max === Infinity ? summary.taxableIncome : b.max,
            ) -
              (b.min - 1)) /
              maxBarValue) *
              100,
            100,
          ),
        )
      : 0;
    const isCurrent = summary.marginalBracket.rate === b.rate && incomeFalls;
    const colorClass = (barColors[Math.round(b.rate * 100)] || ".bar-35").slice(
      1,
    );
    const label =
      b.max === Infinity
        ? `${fmtNumber(b.min)} บาทขึ้นไป`
        : `${fmtNumber(b.min)} – ${fmtNumber(b.max)} บาท`;

    return `
      <div class="bracket-row ${isCurrent ? "current-bracket" : ""}">
        <div class="br-label">${b.label}</div>
        <div class="br-bar-wrap">
          <div class="br-bar ${colorClass}" style="width:${width}%">
            ${width > 15 ? label : ""}
          </div>
        </div>
        <div class="br-tax-amt">${taxInBracket > 0 ? fmtNumber(taxInBracket) + " บ." : "–"}</div>
      </div>`;
  }).join("");

  // ── Detailed bracket table ──────────────────────────────
  const marginalBracketIndex = TAX_BRACKETS.indexOf(summary.marginalBracket);

  // Pre-compute cumulative max tax per bracket
  const cumulativeMaxTaxes = TAX_BRACKETS.reduce((acc, b, idx) => {
    const prevMax = idx === 0 ? 0 : TAX_BRACKETS[idx - 1].max;
    const ceiling = b.max === Infinity ? null : b.max - prevMax;
    const maxTax =
      b.rate === 0 ? 0 : ceiling === null ? null : Math.round(ceiling * b.rate);
    const prev = idx === 0 ? 0 : (acc[idx - 1] ?? 0);
    acc.push(b.max === Infinity ? null : prev + (maxTax ?? 0));
    return acc;
  }, []);

  const bracketTableRows = TAX_BRACKETS.map((b, idx) => {
    const prevMax = idx === 0 ? 0 : TAX_BRACKETS[idx - 1].max;
    const bracketCeiling = b.max === Infinity ? null : b.max - prevMax;
    const maxTaxInBracket =
      b.rate === 0
        ? 0
        : bracketCeiling === null
          ? null
          : Math.round(bracketCeiling * b.rate);
    const cumulativeMaxTax = cumulativeMaxTaxes[idx];

    const userInBracket = incomeInBracket(summary.taxableIncome, b, prevMax);
    const userTaxInBracket = Math.round(userInBracket * b.rate);
    const isCurrent = idx === marginalBracketIndex;

    const rangeLabel =
      b.max === Infinity
        ? `${fmtNumber(b.min)} ขึ้นไป`
        : `${fmtNumber(b.min)} – ${fmtNumber(b.max)}`;
    const ceilingLabel =
      bracketCeiling !== null ? fmtNumber(bracketCeiling) : "ไม่จำกัด";
    const rateLabel = b.rate === 0 ? "ยกเว้น" : b.label;
    const maxTaxLabel =
      maxTaxInBracket === null ? "ไม่จำกัด" : fmtNumber(maxTaxInBracket);
    const cumMaxLabel =
      cumulativeMaxTax === null ? "ไม่จำกัด" : fmtNumber(cumulativeMaxTax);
    const userInLabel = userInBracket > 0 ? fmtNumber(userInBracket) : "–";
    const userTaxLabel =
      userInBracket > 0
        ? userTaxInBracket > 0
          ? fmtNumber(userTaxInBracket)
          : "0"
        : "–";

    return `
      <tr class="${isCurrent ? "bdt-current" : ""}">
        <td class="bdt-num">${idx + 1}</td>
        <td>${rangeLabel}</td>
        <td class="bdt-num-col">${ceilingLabel}</td>
        <td class="bdt-rate ${isCurrent ? "bdt-rate-current" : ""}">${rateLabel}</td>
        <td class="bdt-num-col">${maxTaxLabel}</td>
        <td class="bdt-num-col">${cumMaxLabel}</td>
        <td class="bdt-num-col bdt-user">${userInLabel}</td>
        <td class="bdt-num-col bdt-user">${userTaxLabel}</td>
      </tr>`;
  }).join("");

  // User position summary
  const prevMaxForMarginal =
    marginalBracketIndex === 0 ? 0 : TAX_BRACKETS[marginalBracketIndex - 1].max;
  const userInMarginalBracket = incomeInBracket(
    summary.taxableIncome,
    summary.marginalBracket,
    prevMaxForMarginal,
  );

  const ladderHTML = `
    <div class="bracket-section">
      <p class="section-title">ขั้นบันไดภาษี</p>
      <div class="bracket-bar-wrap">
        <div class="bracket-ladder">${ladderRows}</div>
      </div>
      <p class="bracket-summary-note">
        อัตราปัจจุบัน: <strong>${summary.marginalBracket.label}</strong> &nbsp;|&nbsp;
        ภาษีรวม: <strong>${fmtBaht(summary.currentTax)}</strong>
      </p>
      <p class="section-title" style="margin-top:1.5rem">อัตราภาษีขั้นบันได</p>
      <div class="bdt-scroll">
        <table class="bracket-detail-table">
          <thead>
            <tr>
              <th>ขั้น</th>
              <th>ขั้นเงินได้สุทธิ (บาท)</th>
              <th>เพดานของแต่ละขั้น</th>
              <th>อัตราภาษี</th>
              <th>ภาษีสูงสุดของขั้น</th>
              <th>ภาษีสะสมสูงสุดของขั้น</th>
              <th>รายได้ของคุณในขั้นนี้</th>
              <th>ภาษีที่คุณจ่ายในขั้นนี้</th>
            </tr>
          </thead>
          <tbody>${bracketTableRows}</tbody>
        </table>
      </div>
      <div class="current-bracket-info">
        <span class="cbi-pin">${ICON_PIN}</span>
        <span>คุณอยู่ใน<strong>ขั้นที่ ${marginalBracketIndex + 1}</strong>
        (อัตรา <strong>${summary.marginalBracket.label}</strong>)
        &nbsp;·&nbsp;
        เงินได้สุทธิที่นำมาคำนวณในขั้นนี้ <strong class="cbi-amount">${fmtBaht(userInMarginalBracket)}</strong></span>
      </div>
    </div>`;

  // ── Target bracket recommendations ────────────────────
  const lowerBrackets = TAX_BRACKETS.filter(
    (b) => b.rate < marginalRate && b.max !== Infinity,
  );

  let targetsHTML = "";
  if (lowerBrackets.length === 0) {
    targetsHTML = `<div class="zero-tax-msg">
      <span class="ztm-icon">${ICON_CELEBRATE}</span>
      <span>คุณอยู่ในขั้นบันได 0% แล้ว ไม่ต้องเสียภาษีเงินได้บุคคลธรรมดา!</span>
    </div>`;
  } else {
    const chevronSVG = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3 5l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const cardItems = lowerBrackets
      .reverse()
      .map((target, idx) => {
        const targetTaxableIncome = target.max;
        const neededDeduction = Math.max(
          0,
          summary.taxableIncome - targetTaxableIncome,
        );
        if (neededDeduction === 0) return "";

        const targetTax = calcTax(targetTaxableIncome);
        const taxSaving = summary.currentTax - targetTax;

        // Choose plan based on optimize mode
        let plan, achievable, remainingShortfall, usedOrder;
        if (optimize) {
          const best = findBestPlan(neededDeduction, cap, marginalRate, taxSaving);
          plan = best.bestPlan;
          achievable = best.achievable;
          remainingShortfall = best.remainingShortfall;
          usedOrder = best.bestOrder;
        } else {
          const result = buildOptimalPlan(neededDeduction, cap, marginalRate, priorityOrder);
          plan = result.plan;
          achievable = result.achievable;
          remainingShortfall = result.remainingShortfall;
          usedOrder = priorityOrder;
        }

        const totalSpend = plan.reduce((s, p) => s + p.spendAmt, 0);
        const totalInvest = plan
          .filter((p) => p.category === "invest")
          .reduce((s, p) => s + p.spendAmt, 0);
        const totalPermanent = plan
          .filter((p) => p.category !== "invest")
          .reduce((s, p) => s + p.spendAmt, 0);
        const netRealSaving = taxSaving - totalSpend;

        const planRows = plan
          .map((p) => {
            const catMap = {
              invest: "type-invest",
              insure: "type-insure",
              donate: "type-donate",
            };
            const catLabel = {
              invest: "ลงทุน",
              insure: "ประกัน",
              donate: "บริจาค",
            };
            return `
          <tr>
            <td>${p.type}</td>
            <td class="amt">${fmtNumber(p.deductionAmt)}</td>
            <td class="amt">${fmtNumber(p.spendAmt)}</td>
            <td><span class="plan-type-badge ${catMap[p.category]}">${catLabel[p.category]}</span></td>
            <td class="plan-note">${p.note}</td>
          </tr>`;
          })
          .join("");

        // Show optimized order summary when optimize is on
        const orderChips = optimize
          ? usedOrder
              .filter((id) => plan.some((p) => p.id === id))
              .map((id, i) => {
                const item = ITEM_BY_ID.get(id);
                return `<span class="optimize-order-chip"><span class="chip-num">${i + 1}</span>${item.shortLabel}</span>`;
              })
              .join("")
          : "";

        const optimizeOrderHTML = optimize && orderChips
          ? `<div class="optimize-order-summary">
               <div class="optimize-order-title">${ICON_BOLT} ลำดับที่ดีที่สุดสำหรับขั้นนี้</div>
               <div class="optimize-order-list">${orderChips}</div>
             </div>`
          : "";

        const optimizeBadgeHTML = optimize
          ? `<span class="optimize-badge">${ICON_BOLT} Optimized</span>`
          : "";

        const achievableClass = achievable ? "achievable" : "not-achievable";
        const savingBadge = achievable
          ? `ประหยัดได้จริง ${fmtBaht(netRealSaving)}`
          : `ขาดลดหย่อน ${fmtBaht(remainingShortfall)}`;

        const bodyHTML = achievable
          ? `
        <div class="target-card-body">
          <p class="plan-intro">
            ลดหย่อนเพิ่มอีก <strong>${fmtBaht(neededDeduction)}</strong>
            เพื่อให้เงินได้สุทธิ ≤ ${fmtBaht(targetTaxableIncome)}
            และประหยัดภาษีได้ <strong class="saving">${fmtBaht(taxSaving)}</strong>
          </p>
          ${optimizeOrderHTML}
          <table class="plan-table">
            <thead>
              <tr>
                <th>รายการ</th><th class="amt">ลดหย่อน (บ.)</th>
                <th class="amt">จ่ายจริง (บ.)</th><th>ประเภท</th><th>หมายเหตุ</th>
              </tr>
            </thead>
            <tbody>${planRows}</tbody>
          </table>
          <div class="cost-summary">
            <div class="cost-item">
              <span class="ci-label">ลดหย่อนเพิ่มรวม</span>
              <span class="ci-value gold">${fmtBaht(neededDeduction)}</span>
            </div>
            <div class="cost-item">
              <span class="ci-label">เงินที่ต้องใช้ทันที</span>
              <span class="ci-value">${fmtBaht(totalSpend)}</span>
            </div>
            <div class="cost-item">
              <span class="ci-label">เป็นการลงทุน (ได้คืน)</span>
              <span class="ci-value blue">${fmtBaht(totalInvest)}</span>
            </div>
            <div class="cost-item">
              <span class="ci-label">จ่ายถาวร (ประกัน/บริจาค)</span>
              <span class="ci-value">${fmtBaht(totalPermanent)}</span>
            </div>
            <div class="cost-item">
              <span class="ci-label">ประหยัดภาษีสุทธิ</span>
              <span class="ci-value green">${fmtBaht(taxSaving)}</span>
            </div>
            <div class="cost-item">
              <span class="ci-label">ประหยัดได้จริง (หักเงินที่ต้องใช้ทันที)</span>
              <span class="ci-value ${netRealSaving >= 0 ? "green" : "red"}">${fmtBaht(netRealSaving)}</span>
            </div>
          </div>
        </div>`
          : `
        <div class="target-card-body">
          <p class="not-achievable-note">
            ${ICON_WARN} ช่องทางลดหย่อนที่เหลือรวมกัน (<strong>${fmtBaht(neededDeduction - remainingShortfall)}</strong>)
            ยังไม่เพียงพอ — ต้องการ <strong>${fmtBaht(neededDeduction)}</strong>
            แต่ขาดอีก <strong>${fmtBaht(remainingShortfall)}</strong>
          </p>
          ${optimizeOrderHTML}
          ${
            plan.length > 0
              ? `
          <p class="plan-intro">แผนที่ทำได้บางส่วน:</p>
          <table class="plan-table">
            <thead>
              <tr>
                <th>รายการ</th><th class="amt">ลดหย่อน (บ.)</th>
                <th class="amt">จ่ายจริง (บ.)</th><th>ประเภท</th><th>หมายเหตุ</th>
              </tr>
            </thead>
            <tbody>${planRows}</tbody>
          </table>`
              : ""
          }
        </div>`;

        return `
        <div class="target-card ${achievableClass}" id="target-${idx}">
          <div class="target-card-header" onclick="toggleTarget('target-${idx}')">
            <span class="target-bracket-label">
              ${achievable ? ICON_CHECK : ICON_CROSS} ลดเป็นขั้นบันได <strong>${target.label}</strong>
              &nbsp;— เงินได้สุทธิ ≤ ${fmtBaht(targetTaxableIncome)}
              ${optimizeBadgeHTML}
            </span>
            <span class="target-savings-badge" style="${achievable && netRealSaving < 0 ? "background:var(--danger);color:#fff;" : ""}">${savingBadge}</span>
            <span class="target-toggle-icon">${chevronSVG}</span>
          </div>
          ${bodyHTML}
        </div>`;
      })
      .join("");

    const optimizeNote = optimize
      ? `<p style="font-size:0.8rem;color:var(--primary);margin-top:0.2rem">${ICON_BOLT} โหมด Optimize: ระบบคำนวณทุก Scenario แล้วเลือกวิธีที่ประหยัดได้จริงมากที่สุดสำหรับแต่ละขั้น</p>`
      : `<p>คลิกที่แต่ละเป้าหมายเพื่อดูรายละเอียดแผนที่ใช้เงินน้อยที่สุด</p>`;

    targetsHTML = `
      <div class="targets-section">
        <p class="section-title">แผนลดหย่อนเพื่อลดขั้นบันไดภาษี</p>
        ${optimizeNote}
        ${cardItems}
      </div>`;
  }

  container.innerHTML = summaryHTML + breakdownHTML + ladderHTML + targetsHTML;
}

/* ─────────────────────────────────────────────
   8. UI HELPERS
   ───────────────────────────────────────────── */

/** Toggle a target card's expanded state */
function toggleTarget(id) {
  const card = document.getElementById(id);
  if (!card) return;
  card.classList.toggle("expanded");
}

/** Read a numeric input value (default to 0 if empty/invalid) */
function numVal(id) {
  const el = document.getElementById(id);
  if (!el) return 0;
  const v = parseFloat(el.value);
  return isNaN(v) || v < 0 ? 0 : v;
}

/** Show an error message below an input.
 * @param {string} msgId   - ID for the error element
 * @param {string} text    - Error message text
 * @param {Element} [afterEl] - Element after which to insert the error div.
 *                             Defaults to the parent of #annual-income.
 */
function showError(msgId, text, afterEl) {
  let el = document.getElementById(msgId);
  if (!el) {
    el = document.createElement("div");
    el.id = msgId;
    el.className = "error-msg";
    (afterEl || document.getElementById("annual-income").parentNode).after(el);
  }
  el.textContent = text;
  el.classList.add("show");
}

/** Validate that a capped numeric input doesn't exceed maxVal; show/clear error inline.
 * @param {string} inputId - ID of the input element
 * @param {number} maxVal  - Maximum allowed value
 * @returns {boolean} true if value is valid
 */
function validateMax(inputId, maxVal) {
  const input = document.getElementById(inputId);
  if (!input) return true;
  const v = parseFloat(input.value);
  const msgId = `${inputId}-error`;
  if (!isNaN(v) && v > maxVal) {
    showError(
      msgId,
      `กรอกได้สูงสุด ${fmtNumber(maxVal)} บาท`,
      input.parentNode,
    );
    input.classList.add("input-error");
    return false;
  }
  clearError(msgId);
  input.classList.remove("input-error");
  return true;
}

function clearError(msgId) {
  const el = document.getElementById(msgId);
  if (el) el.classList.remove("show");
}

/** Update step indicator */
function setStep(n) {
  [1, 2, 3].forEach((i) => {
    const ind = document.getElementById(`ind-${i}`);
    const line = ind ? ind.nextElementSibling : null;
    ind.classList.remove("active", "done");
    const circle = ind.querySelector(".step-circle");
    const span = circle ? circle.querySelector("span") : circle;
    if (i < n) {
      ind.classList.add("done");
      if (span) span.textContent = "✓";
      if (line && line.classList.contains("step-line"))
        line.classList.add("done");
    } else if (i === n) {
      ind.classList.add("active");
      if (span) span.textContent = String(i).padStart(2, "0");
      if (line && line.classList.contains("step-line"))
        line.classList.remove("done");
    } else {
      if (span) span.textContent = String(i).padStart(2, "0");
      if (line && line.classList.contains("step-line"))
        line.classList.remove("done");
    }
    document.getElementById(`step${i}`).classList.toggle("hidden", i !== n);
  });
}

/** Update the expense deduction hint under the income input */
function updateExpenseHint() {
  const income =
    parseFloat(document.getElementById("annual-income").value) || 0;
  const type = document.getElementById("income-type").value;
  const exp = calcExpenseDeduction(income, type);
  const hint = document.getElementById("expense-deduction-hint");
  if (income > 0) {
    hint.textContent = `ค่าใช้จ่ายที่หักได้อัตโนมัติ: ${fmtBaht(exp)}`;
  } else {
    hint.textContent = "";
  }
}

/* ─── Priority list helpers ─────────────────────────────── */

const GRIP_SVG = `<svg width="12" height="14" viewBox="0 0 12 14" fill="none" aria-hidden="true">
  <circle cx="3.5" cy="2"  r="1.5" fill="currentColor"/>
  <circle cx="8.5" cy="2"  r="1.5" fill="currentColor"/>
  <circle cx="3.5" cy="7"  r="1.5" fill="currentColor"/>
  <circle cx="8.5" cy="7"  r="1.5" fill="currentColor"/>
  <circle cx="3.5" cy="12" r="1.5" fill="currentColor"/>
  <circle cx="8.5" cy="12" r="1.5" fill="currentColor"/>
</svg>`;

/** Drag-and-drop source id (module-level to survive re-renders) */
let dragSourceId = null;

/** Render the priority list into #priority-list and bind interaction events */
function renderPriorityList() {
  const list = document.getElementById("priority-list");
  if (!list) return;

  const catLabel = { invest: "ลงทุน", insure: "ประกัน", donate: "บริจาค" };
  const catClass = {
    invest: "type-invest",
    insure: "type-insure",
    donate: "type-donate",
  };
  const last = currentPriorityOrder.length - 1;

  // Build a lookup map for O(1) access by id
  const itemsById = new Map(PRIORITY_ITEMS.map((p) => [p.id, p]));

  list.innerHTML = currentPriorityOrder
    .map((id, idx) => {
      const item = itemsById.get(id);
      if (!item) return "";
      return `
      <li class="priority-item" draggable="true" data-id="${id}">
        <span class="priority-drag-handle" aria-hidden="true">${GRIP_SVG}</span>
        <span class="priority-rank">${idx + 1}</span>
        <span class="priority-label">${item.label}</span>
        <span class="plan-type-badge ${catClass[item.category]}">${catLabel[item.category]}</span>
        <div class="priority-arrows">
          <button type="button" class="priority-arrow-btn" data-dir="up"
            aria-label="เลื่อนขึ้น" ${idx === 0 ? "disabled" : ""}>▲</button>
          <button type="button" class="priority-arrow-btn" data-dir="down"
            aria-label="เลื่อนลง" ${idx === last ? "disabled" : ""}>▼</button>
        </div>
      </li>`;
    })
    .join("");

  /* ── Up / Down buttons ── */
  list.querySelectorAll(".priority-arrow-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const li = btn.closest(".priority-item");
      const id = li.dataset.id;
      const idx = currentPriorityOrder.indexOf(id);
      const dir = btn.dataset.dir;
      if (dir === "up" && idx > 0) {
        [currentPriorityOrder[idx - 1], currentPriorityOrder[idx]] = [
          currentPriorityOrder[idx],
          currentPriorityOrder[idx - 1],
        ];
        renderPriorityList();
      } else if (dir === "down" && idx < currentPriorityOrder.length - 1) {
        [currentPriorityOrder[idx], currentPriorityOrder[idx + 1]] = [
          currentPriorityOrder[idx + 1],
          currentPriorityOrder[idx],
        ];
        renderPriorityList();
      }
    });
  });

  /* ── Drag-and-drop ── */
  list.querySelectorAll('.priority-item[draggable="true"]').forEach((item) => {
    item.addEventListener("dragstart", (e) => {
      dragSourceId = item.dataset.id;
      item.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });

    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      list
        .querySelectorAll(".priority-item")
        .forEach((i) => i.classList.remove("drag-over"));
      dragSourceId = null;
    });

    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      list
        .querySelectorAll(".priority-item")
        .forEach((i) => i.classList.remove("drag-over"));
      if (item.dataset.id !== dragSourceId) item.classList.add("drag-over");
    });

    item.addEventListener("drop", (e) => {
      e.preventDefault();
      const targetId = item.dataset.id;
      if (dragSourceId && targetId !== dragSourceId) {
        const srcIdx = currentPriorityOrder.indexOf(dragSourceId);
        const dstIdx = currentPriorityOrder.indexOf(targetId);
        currentPriorityOrder.splice(srcIdx, 1);
        currentPriorityOrder.splice(dstIdx, 0, dragSourceId);
        renderPriorityList();
      }
    });
  });
}

/* ─────────────────────────────────────────────
   9. EVENT HANDLERS
   ───────────────────────────────────────────── */

document.addEventListener("DOMContentLoaded", () => {
  /* ── Number steppers ── */
  document.querySelectorAll(".stepper-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;
      const delta = parseInt(btn.dataset.delta, 10);
      const input = document.getElementById(targetId);
      if (!input) return;
      const min = parseInt(input.min, 10) || 0;
      const max = parseInt(input.max, 10) || 999;
      const cur = parseInt(input.value, 10) || 0;
      input.value = Math.min(max, Math.max(min, cur + delta));
    });
  });

  /* ── Accordion toggles ── */
  document.querySelectorAll(".accordion-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const body = btn.nextElementSibling;
      const isOpen = body.classList.contains("open");
      body.classList.toggle("open", !isOpen);
      btn.classList.toggle("open", !isOpen);
    });
    // Open first accordion by default
  });
  // Open all accordions by default on step 2
  document.querySelectorAll(".accordion-body").forEach((b) => {
    b.classList.add("open");
  });
  document.querySelectorAll(".accordion-toggle").forEach((b) => {
    b.classList.add("open");
  });

  /* ── Priority list initialisation ── */
  renderPriorityList();

  /* ── Optimize toggle ── */
  const optimizeToggle = document.getElementById("optimize-toggle");
  const priorityManualSection = document.getElementById("priority-manual-section");
  optimizeToggle.addEventListener("change", () => {
    priorityManualSection.classList.toggle("dimmed", optimizeToggle.checked);
  });

  /* ── Salary Calculator Popup ── */
  const salaryCalcBtn = document.getElementById("salary-calc-btn");
  const salaryCalcPopup = document.getElementById("salary-calc-popup");
  const salaryCalcClose = document.getElementById("salary-calc-close");
  const scMonthly = document.getElementById("sc-monthly");
  const scMonths = document.getElementById("sc-months");
  const scBonus = document.getElementById("sc-bonus");
  const scResult = document.getElementById("sc-result");
  const scUseBtn = document.getElementById("sc-use-btn");

  function updateSalaryCalcResult() {
    const monthly = parseFloat(scMonthly.value) || 0;
    const months = parseInt(scMonths.value, 10) || 12;
    const bonus = parseFloat(scBonus.value) || 0;
    const total = monthly * months + bonus;
    scResult.textContent = FMT.format(Math.round(total));
    scUseBtn.dataset.value = total;
  }

  salaryCalcBtn.addEventListener("click", () => {
    const opening = salaryCalcPopup.classList.contains("hidden");
    salaryCalcPopup.classList.toggle("hidden");
    if (opening) scMonthly.focus();
  });

  salaryCalcClose.addEventListener("click", () => {
    salaryCalcPopup.classList.add("hidden");
  });

  [scMonthly, scMonths, scBonus].forEach((el) => {
    el.addEventListener("input", updateSalaryCalcResult);
  });

  scUseBtn.addEventListener("click", () => {
    const total = parseFloat(scUseBtn.dataset.value) || 0;
    if (total > 0) {
      document.getElementById("annual-income").value = total;
      updateExpenseHint();
      clearError("income-error");
    }
    salaryCalcPopup.classList.add("hidden");
  });

  document.addEventListener("click", (e) => {
    if (
      !salaryCalcPopup.classList.contains("hidden") &&
      !salaryCalcPopup.contains(e.target) &&
      e.target !== salaryCalcBtn &&
      !salaryCalcBtn.contains(e.target)
    ) {
      salaryCalcPopup.classList.add("hidden");
    }
  });

  /* Initialize salary calc result */
  updateSalaryCalcResult();

  /* ── Income hint ── */
  document
    .getElementById("annual-income")
    .addEventListener("input", updateExpenseHint);
  document
    .getElementById("income-type")
    .addEventListener("change", updateExpenseHint);

  /* ── Capped-field inline validation ── */
  const CAPPED_FIELDS = [
    { id: "social-security", max: SS_MAX },
    { id: "life-insurance", max: LIFE_INS_MAX },
    { id: "health-insurance", max: HEALTH_INS_MAX },
    { id: "parents-health-ins", max: PARENTS_HEALTH_MAX },
    { id: "mortgage-interest", max: MORTGAGE_MAX },
    { id: "existing-ssf", max: SSF_MAX },
    { id: "existing-rmf", max: RMF_MAX },
    { id: "existing-esg", max: ESG_MAX },
  ];
  CAPPED_FIELDS.forEach(({ id, max }) => {
    const input = document.getElementById(id);
    if (input) input.addEventListener("input", () => validateMax(id, max));
  });

  /* ── Step 1 → Step 2 ── */
  document.getElementById("step1-next").addEventListener("click", () => {
    const income = parseFloat(document.getElementById("annual-income").value);
    if (!income || income <= 0) {
      showError("income-error", "กรุณากรอกรายได้ที่ถูกต้อง (มากกว่า 0)");
      return;
    }
    clearError("income-error");
    setStep(2);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  /* ── Step 2 → Step 1 ── */
  document.getElementById("step2-back").addEventListener("click", () => {
    setStep(1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  /* ── Step 2 → Step 3 (Calculate) ── */
  document.getElementById("step2-calc").addEventListener("click", () => {
    const income =
      parseFloat(document.getElementById("annual-income").value) || 0;
    const incomeType = document.getElementById("income-type").value;

    const deductions = {
      hasSpouse: document.getElementById("has-spouse").checked,
      numChildren: numVal("num-children"),
      numParents: numVal("num-parents"),
      numDisabled: numVal("num-disabled"),
      socialSecurity: numVal("social-security"),
      lifeInsurance: numVal("life-insurance"),
      healthInsurance: numVal("health-insurance"),
      parentsHealthIns: numVal("parents-health-ins"),
      ssf: numVal("existing-ssf"),
      rmf: numVal("existing-rmf"),
      esg: numVal("existing-esg"),
      pvf: numVal("existing-pvf"),
      mortgageInterest: numVal("mortgage-interest"),
    };

    const summary = buildDeductionSummary(income, incomeType, deductions);
    const optimize = document.getElementById("optimize-toggle").checked;
    renderResults(summary, [...currentPriorityOrder], optimize);
    setStep(3);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  /* ── Step 3 → Step 2 ── */
  document.getElementById("step3-back").addEventListener("click", () => {
    setStep(2);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  /* Initialize on step 1 */
  setStep(1);
});
