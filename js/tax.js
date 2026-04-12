/* =============================================================
   PlanTax — js/tax.js
   Thai personal income tax calculator & deduction planner
   Tax year 2568 (2025)
   ============================================================= */

"use strict";

/* ─────────────────────────────────────────────
   1. CONSTANTS
   ───────────────────────────────────────────── */

const TAX_BRACKETS = [
  { min: 0,         max: 150_000,  rate: 0,    label: "0%"  },
  { min: 150_001,   max: 300_000,  rate: 0.05, label: "5%"  },
  { min: 300_001,   max: 500_000,  rate: 0.1,  label: "10%" },
  { min: 500_001,   max: 750_000,  rate: 0.15, label: "15%" },
  { min: 750_001,   max: 1_000_000,rate: 0.2,  label: "20%" },
  { min: 1_000_001, max: 2_000_000,rate: 0.25, label: "25%" },
  { min: 2_000_001, max: 5_000_000,rate: 0.3,  label: "30%" },
  { min: 5_000_001, max: Infinity, rate: 0.35, label: "35%" },
];

const PERSONAL_ALLOWANCE    = 60_000;
const COMBINED_INVESTMENT_CAP = 500_000;
const SSF_MAX               = 200_000;
const RMF_MAX               = 500_000;
const ESG_MAX               = 300_000;
const INVESTMENT_INCOME_PCT = 0.3;
const SS_MAX                = 9_000;
const LIFE_INS_MAX          = 100_000;
const HEALTH_INS_MAX        = 25_000;
const PARENTS_HEALTH_MAX    = 15_000;
const MORTGAGE_MAX          = 100_000;
const DONATION_CAP_PCT      = 0.1;

/* ─────────────────────────────────────────────
   2. TAX CALCULATION
   ───────────────────────────────────────────── */

function calcTax(taxableIncome) {
  if (taxableIncome <= 0) return 0;
  let tax = 0;
  let prev = 0;
  for (const b of TAX_BRACKETS) {
    const top = b.max === Infinity ? taxableIncome : Math.min(taxableIncome, b.max);
    if (top <= prev) break;
    tax += (top - prev) * b.rate;
    prev = b.max === Infinity ? taxableIncome : b.max;
    if (prev >= taxableIncome) break;
  }
  return Math.round(tax);
}

function getMarginalBracket(taxableIncome) {
  if (taxableIncome <= 0) return TAX_BRACKETS[0];
  for (let i = TAX_BRACKETS.length - 1; i >= 0; i--) {
    if (taxableIncome >= TAX_BRACKETS[i].min) return TAX_BRACKETS[i];
  }
  return TAX_BRACKETS[0];
}

function calcTaxBreakdown(taxableIncome) {
  const rows = [];
  let prev = 0;
  for (const b of TAX_BRACKETS) {
    const top = b.max === Infinity ? taxableIncome : Math.min(taxableIncome, b.max);
    const incomeInBracket = Math.max(0, top - prev);
    const taxInBracket = Math.round(incomeInBracket * b.rate);
    const isActive = taxableIncome >= b.min;
    const isCurrent = taxableIncome >= b.min && (b.max === Infinity || taxableIncome <= b.max);
    rows.push({
      label: b.label,
      min: b.min,
      max: b.max,
      rate: b.rate,
      incomeInBracket: isActive ? incomeInBracket : 0,
      taxInBracket: isActive ? taxInBracket : 0,
      isActive,
      isCurrent,
    });
    if (b.max !== Infinity) prev = b.max;
    if (prev >= taxableIncome) break;
  }
  return rows;
}

function calcExpenseDeduction(income, incomeType) {
  if (incomeType === "freelance") return Math.min(income * 0.6, 600_000);
  return Math.min(income * 0.5, 100_000);
}

/* ─────────────────────────────────────────────
   3. DEDUCTION AGGREGATION
   ───────────────────────────────────────────── */

function buildDeductionSummary(income, incomeType, d) {
  const expenseDeduction = calcExpenseDeduction(income, incomeType);

  const spouseAllowance    = d.hasSpouse ? 60_000 : 0;
  const childAllowance     = Math.max(0, d.numChildren || 0) * 30_000;
  const parentAllowance    = Math.min(Math.max(0, d.numParents || 0), 4) * 30_000;
  const disabilityAllowance = Math.max(0, d.numDisabled || 0) * 60_000;

  const ss       = Math.min(Math.max(0, d.socialSecurity  || 0), SS_MAX);
  const lifeIns  = Math.min(Math.max(0, d.lifeInsurance   || 0), LIFE_INS_MAX);
  const healthRaw = Math.min(Math.max(0, d.healthInsurance || 0), HEALTH_INS_MAX);
  const healthIns = Math.min(healthRaw, Math.max(0, LIFE_INS_MAX - lifeIns));
  const parentsHealth = Math.min(Math.max(0, d.parentsHealthIns || 0), PARENTS_HEALTH_MAX);

  const pvf    = Math.max(0, d.pvf || 0);
  const ssfRaw = Math.min(Math.max(0, d.ssf || 0), Math.min(income * INVESTMENT_INCOME_PCT, SSF_MAX));
  const rmfRaw = Math.min(Math.max(0, d.rmf || 0), Math.min(income * INVESTMENT_INCOME_PCT, RMF_MAX));
  const esgRaw = Math.min(Math.max(0, d.esg || 0), Math.min(income * INVESTMENT_INCOME_PCT, ESG_MAX));

  let investRemain = Math.max(0, COMBINED_INVESTMENT_CAP - pvf);
  const ssf = Math.min(ssfRaw, investRemain); investRemain -= ssf;
  const rmf = Math.min(rmfRaw, investRemain); investRemain -= rmf;
  const esg = Math.min(esgRaw, investRemain);

  const mortgage = Math.min(Math.max(0, d.mortgageInterest || 0), MORTGAGE_MAX);

  const totalDeductions =
    expenseDeduction + PERSONAL_ALLOWANCE +
    spouseAllowance + childAllowance + parentAllowance + disabilityAllowance +
    ss + lifeIns + healthIns + parentsHealth +
    Math.min(pvf + ssf + rmf + esg, COMBINED_INVESTMENT_CAP) +
    mortgage;

  const taxableIncome  = Math.max(0, income - totalDeductions);
  const currentTax     = calcTax(taxableIncome);
  const effectiveRate  = income > 0 ? (currentTax / income) * 100 : 0;
  const marginalBracket = getMarginalBracket(taxableIncome);

  return {
    income, incomeType,
    expenseDeduction, personalAllowance: PERSONAL_ALLOWANCE,
    spouseAllowance, childAllowance, parentAllowance, disabilityAllowance,
    ss, lifeIns, healthIns, parentsHealth,
    pvf, ssf, rmf, esg, mortgage,
    totalDeductions, taxableIncome, currentTax, effectiveRate, marginalBracket,
  };
}

/* ─────────────────────────────────────────────
   4. AVAILABLE CAPACITY
   ───────────────────────────────────────────── */

function calcAvailableCapacity(income, summary) {
  const usedInvestment = summary.pvf + summary.ssf + summary.rmf + summary.esg;
  const investRemain   = Math.max(0, COMBINED_INVESTMENT_CAP - usedInvestment);

  const ssfCap = Math.min(income * INVESTMENT_INCOME_PCT, SSF_MAX);
  const rmfCap = Math.min(income * INVESTMENT_INCOME_PCT, RMF_MAX);
  const esgCap = Math.min(income * INVESTMENT_INCOME_PCT, ESG_MAX);

  let remInv = investRemain;
  const availSSF = Math.min(Math.max(0, ssfCap - summary.ssf), remInv); remInv -= availSSF;
  const availRMF = Math.min(Math.max(0, rmfCap - summary.rmf), remInv); remInv -= availRMF;
  const availESG = Math.min(Math.max(0, esgCap - summary.esg), remInv);

  const usedCombinedIns = summary.lifeIns + summary.healthIns;
  const availLifeIns    = Math.max(0, LIFE_INS_MAX - summary.lifeIns - Math.max(0, usedCombinedIns - summary.lifeIns));
  const availHealthIns  = Math.min(
    Math.max(0, HEALTH_INS_MAX - summary.healthIns),
    Math.max(0, LIFE_INS_MAX - usedCombinedIns),
  );
  const availParentsHealth = Math.max(0, PARENTS_HEALTH_MAX - summary.parentsHealth);

  const donationBase = summary.taxableIncome;
  const eduDonCap    = Math.floor(donationBase * DONATION_CAP_PCT);
  const regDonCap    = Math.floor(donationBase * DONATION_CAP_PCT);

  return { availSSF, availRMF, availESG, availLifeIns, availHealthIns, availParentsHealth, eduDonCap, regDonCap };
}

/* ─────────────────────────────────────────────
   5. FORMATTING UTILITIES
   ───────────────────────────────────────────── */

const FMT     = new Intl.NumberFormat("th-TH");
const fmtBaht   = (n) => FMT.format(Math.round(n)) + " บาท";
const fmtNumber = (n) => FMT.format(Math.round(n));
const fmtPct    = (n) => n.toFixed(2) + "%";

/* ─────────────────────────────────────────────
   6. PRODUCT CATALOG (prototype data)
   ───────────────────────────────────────────── */

const PRODUCTS = {
  insure: [
    {
      id: "life-a",
      name: "สะสมทรัพย์ 10/5",
      company: "เมืองไทยประกันชีวิต",
      type: "ประกันชีวิต",
      minBudget: 5_000,
      maxDeductible: 100_000,
      note: "รับเงินคืนทุกปี คุ้มครองชีวิต 10 ปี เบี้ยคงที่ตลอดสัญญา",
      tag: "ยอดนิยม",
    },
    {
      id: "life-b",
      name: "AIA เก็บออม 10 ปี",
      company: "AIA",
      type: "ประกันชีวิต",
      minBudget: 12_000,
      maxDeductible: 100_000,
      note: "ผลตอบแทนสูง เหมาะสะสมระยะยาว",
      tag: "แนะนำ",
    },
    {
      id: "life-c",
      name: "Thai Life Super Save 15",
      company: "ไทยประกันชีวิต",
      type: "ประกันชีวิต",
      minBudget: 8_000,
      maxDeductible: 100_000,
      note: "เบี้ยคงที่ คุ้มครอง 15 ปี",
      tag: null,
    },
    {
      id: "health-a",
      name: "Health Happy Plus",
      company: "AIA",
      type: "ประกันสุขภาพ",
      minBudget: 8_000,
      maxDeductible: 25_000,
      note: "ผู้ป่วยใน-นอก คุ้มครองโรคร้ายแรง",
      tag: "แนะนำ",
    },
    {
      id: "health-b",
      name: "iHealthy Ultra",
      company: "กรุงไทย-AXA",
      type: "ประกันสุขภาพ",
      minBudget: 6_000,
      maxDeductible: 25_000,
      note: "ไม่ต้องสำรองจ่าย เคลมง่าย",
      tag: null,
    },
    {
      id: "health-c",
      name: "MedCare Plus",
      company: "เมืองไทยประกันชีวิต",
      type: "ประกันสุขภาพ",
      minBudget: 5_000,
      maxDeductible: 25_000,
      note: "ราคาประหยัด คุ้มครองผู้ป่วยใน",
      tag: null,
    },
  ],
  invest: [
    {
      id: "ssf-a",
      name: "KFSSFPLUS",
      company: "กสิกรไทย (KAsset)",
      type: "SSF",
      minBudget: 1_000,
      maxDeductible: 200_000,
      note: "หุ้นผสม ความเสี่ยงปานกลาง ถือครอง 10 ปี",
      tag: null,
    },
    {
      id: "ssf-b",
      name: "SCBSSFPLUS",
      company: "ไทยพาณิชย์ (SCBAM)",
      type: "SSF",
      minBudget: 1_000,
      maxDeductible: 200_000,
      note: "หุ้นไทย ผลตอบแทนสูง ถือครอง 10 ปี",
      tag: "ยอดนิยม",
    },
    {
      id: "rmf-a",
      name: "SCBRMFPLUS",
      company: "ไทยพาณิชย์ (SCBAM)",
      type: "RMF",
      minBudget: 500,
      maxDeductible: 500_000,
      note: "หุ้นผสม บริหารเชิงรุก ถือครองถึงอายุ 55 ปี",
      tag: "แนะนำ",
    },
    {
      id: "rmf-b",
      name: "KFLTFDIV",
      company: "กสิกรไทย (KAsset)",
      type: "RMF",
      minBudget: 500,
      maxDeductible: 500_000,
      note: "หุ้นปันผล มั่นคง ถือครองถึงอายุ 55 ปี",
      tag: null,
    },
    {
      id: "esg-a",
      name: "B-THAIESG",
      company: "บัวหลวง (BBLAM)",
      type: "Thai ESG",
      minBudget: 1_000,
      maxDeductible: 300_000,
      note: "หุ้น ESG ไทย ถือครอง 5 ปี",
      tag: "ยอดนิยม",
    },
    {
      id: "esg-b",
      name: "KTHAIESG",
      company: "กรุงไทย (KTAM)",
      type: "Thai ESG",
      minBudget: 1_000,
      maxDeductible: 300_000,
      note: "ค่าธรรมเนียมต่ำ ถือครอง 5 ปี",
      tag: null,
    },
  ],
  donate: [
    {
      id: "edu-don",
      name: "มูลนิธิการศึกษาไทย",
      company: "กรมสรรพากรรับรอง",
      type: "บริจาคเพื่อการศึกษา (ลดหย่อน 2×)",
      minBudget: 100,
      maxDeductible: null,
      note: "จ่าย 1 บาท ลดหย่อนได้ 2 บาท สูงสุด 10% ของเงินได้สุทธิ",
      tag: "คุ้มค่า",
    },
    {
      id: "don-redcross",
      name: "สภากาชาดไทย",
      company: "กรมสรรพากรรับรอง",
      type: "บริจาคทั่วไป",
      minBudget: 100,
      maxDeductible: null,
      note: "ลดหย่อน 1 เท่า สูงสุด 10% ของเงินได้สุทธิ",
      tag: null,
    },
    {
      id: "don-temple",
      name: "วัด / มูลนิธิที่ได้รับการรับรอง",
      company: "กรมสรรพากรรับรอง",
      type: "บริจาคทั่วไป",
      minBudget: 100,
      maxDeductible: null,
      note: "ลดหย่อน 1 เท่า สูงสุด 10% ของเงินได้สุทธิ",
      tag: null,
    },
  ],
};

/* ─────────────────────────────────────────────
   7. RESULTS RENDERING (simplified)
   ───────────────────────────────────────────── */

/** Module-level cache for modal access */
let _cap = null;

function renderResults(summary) {
  _cap = calcAvailableCapacity(summary.income, summary);

  const container    = document.getElementById("results-container");
  const marginalRate = summary.marginalBracket.rate;

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
        <div class="sc-sub">บาท · ${fmtPct(summary.effectiveRate)} ของรายได้</div>
      </div>
    </div>`;

  const bracketBadgeHTML = `
    <div class="current-bracket-badge">
      <span class="cbb-label">ขั้นบันไดปัจจุบัน</span>
      <span class="cbb-rate">${summary.marginalBracket.label}</span>
      <span class="cbb-sep">·</span>
      <span class="cbb-income">เงินได้สุทธิ ${fmtBaht(summary.taxableIncome)}</span>
    </div>`;

  // ── Tax bracket breakdown table ──
  const breakdown = calcTaxBreakdown(summary.taxableIncome);
  let cumTax = 0;
  const bracketRows = TAX_BRACKETS.map((b) => {
    const row = breakdown.find((r) => r.min === b.min);
    const incomeInBracket = row ? row.incomeInBracket : 0;
    const taxInBracket = row ? row.taxInBracket : 0;
    cumTax += taxInBracket;
    const isActive = row && row.isActive;
    const isCurrent = row && row.isCurrent;
    const maxLabel = b.max === Infinity ? "ขึ้นไป" : fmtNumber(b.max);
    const rangeLabel = b.max === Infinity
      ? `${fmtNumber(b.min)} ${maxLabel}`
      : `${fmtNumber(b.min)} – ${maxLabel}`;
    return `
      <tr class="${isCurrent ? "bracket-current" : ""} ${!isActive ? "bracket-inactive" : ""}">
        <td class="bt-rate">${b.label}</td>
        <td class="bt-range">${rangeLabel}</td>
        <td class="bt-amount">${isActive ? fmtNumber(incomeInBracket) : "—"}</td>
        <td class="bt-tax">${isActive ? fmtNumber(taxInBracket) : "—"}</td>
      </tr>`;
  }).join("");

  const bracketTableHTML = `
    <div class="bracket-table-wrap">
      <p class="section-title" style="margin-top:1.25rem;margin-bottom:0.6rem">รายละเอียดขั้นบันไดภาษี</p>
      <div class="bracket-table-scroll">
        <table class="bracket-table">
          <thead>
            <tr>
              <th>อัตราภาษี</th>
              <th>ช่วงเงินได้สุทธิ</th>
              <th>เงินได้ในขั้น</th>
              <th>ภาษีในขั้น</th>
            </tr>
          </thead>
          <tbody>
            ${bracketRows}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="3" class="bt-total-label">ภาษีรวม</td>
              <td class="bt-total-value">${fmtNumber(summary.currentTax)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>`;

  const lowerBrackets = TAX_BRACKETS.filter(
    (b) => b.rate < marginalRate && b.max !== Infinity
  ).reverse();

  let targetsHTML = "";
  if (marginalRate === 0) {
    targetsHTML = `<div class="zero-tax-msg" style="margin-top:1.25rem">
      <span class="ztm-icon">🎉</span>
      <span>คุณอยู่ในขั้นบันได 0% แล้ว ไม่ต้องเสียภาษีเงินได้!</span>
    </div>`;
  } else {
    const totalAvailCap =
      _cap.availSSF + _cap.availRMF + _cap.availESG +
      _cap.availLifeIns + _cap.availHealthIns + _cap.availParentsHealth +
      _cap.eduDonCap + _cap.regDonCap;

    const rows = lowerBrackets.map((target) => {
      const needed  = Math.max(0, summary.taxableIncome - target.max);
      if (needed === 0) return "";
      const saving     = summary.currentTax - calcTax(target.max);
      const achievable = totalAvailCap >= needed;

      return `
        <div class="target-row ${achievable ? "" : "not-achievable"}">
          <div class="target-row-info">
            <div class="target-row-bracket">
              ${achievable ? "✅" : "❌"} ลดเป็นขั้น <strong>${target.label}</strong>
            </div>
            <div class="target-row-numbers">
              <span>ลดหย่อนเพิ่ม <strong>${fmtBaht(needed)}</strong></span>
              <span class="tr-sep">·</span>
              <span class="tr-saving">ประหยัดภาษี <strong>${fmtBaht(saving)}</strong></span>
            </div>
          </div>
          <button class="btn btn-sm ${achievable ? "btn-primary" : "btn-ghost"}"
            onclick="openPlanModal(${target.max}, ${needed}, ${saving})">
            วางแผน
          </button>
        </div>`;
    }).filter(Boolean).join("");

    targetsHTML = `
      <p class="section-title" style="margin-top:1.5rem">ลดขั้นบันไดภาษี</p>
      <div class="target-list">
        ${rows || `<p style="color:var(--text-dim);font-size:0.85rem;padding:0.5rem 0">ไม่มีขั้นบันไดที่ต่ำกว่าที่สามารถลดได้</p>`}
      </div>`;
  }

  container.innerHTML = summaryHTML + bracketBadgeHTML + bracketTableHTML + targetsHTML;
}

/* ─────────────────────────────────────────────
   8. PLAN MODAL
   ───────────────────────────────────────────── */

let _modalCtx = null;

function openPlanModal(targetMax, neededDeduction, taxSaving) {
  if (!_cap) return;
  _modalCtx = { targetMax, neededDeduction, taxSaving };

  document.getElementById("modal-target-title").textContent =
    `วางแผน — เงินได้สุทธิ ≤ ${fmtNumber(targetMax)} บาท`;
  document.getElementById("modal-needed").textContent = fmtBaht(neededDeduction);
  document.getElementById("modal-saving").textContent  = fmtBaht(taxSaving);

  document.getElementById("modal-insure-cap").textContent =
    fmtNumber(_cap.availLifeIns + _cap.availHealthIns + _cap.availParentsHealth);
  document.getElementById("modal-invest-cap").textContent =
    fmtNumber(_cap.availSSF + _cap.availRMF + _cap.availESG);
  document.getElementById("modal-donate-cap").textContent =
    fmtNumber(_cap.eduDonCap + _cap.regDonCap);

  ["modal-insure-budget", "modal-invest-budget", "modal-donate-budget"].forEach(
    (id) => { document.getElementById(id).value = ""; }
  );
  document.getElementById("modal-products").innerHTML = "";
  updateModalProgress();

  document.getElementById("plan-modal").classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closePlanModal() {
  document.getElementById("plan-modal").classList.add("hidden");
  document.body.style.overflow = "";
}

function updateModalProgress() {
  if (!_modalCtx) return;

  const insure  = parseFloat(document.getElementById("modal-insure-budget").value)  || 0;
  const invest  = parseFloat(document.getElementById("modal-invest-budget").value)  || 0;
  const donate  = parseFloat(document.getElementById("modal-donate-budget").value)  || 0;

  // Education donations give 2× deduction; treat all donation budget as edu-type (best case)
  const totalDeduction = insure + invest + donate * 2;
  const needed = _modalCtx.neededDeduction;
  const pct    = needed > 0 ? Math.min(100, Math.round((totalDeduction / needed) * 100)) : 0;

  const fill = document.getElementById("modal-progress-fill");
  const text = document.getElementById("modal-progress-text");

  fill.style.width  = pct + "%";
  fill.className    = "modal-progress-fill" + (pct >= 100 ? " full" : pct >= 60 ? " good" : "");
  text.textContent  = `จัดสรรได้ ${fmtNumber(totalDeduction)} / ${fmtNumber(needed)} บาท (${pct}%)`;

  renderProductSuggestions(insure, invest, donate);
}

function renderProductSuggestions(insureBudget, investBudget, donateBudget) {
  const container = document.getElementById("modal-products");
  if (!container) return;

  const sections = [];

  if (insureBudget > 0) {
    const matches = PRODUCTS.insure.filter((p) => p.minBudget <= insureBudget);
    sections.push(buildProductSection("ประกัน", "type-insure", matches, insureBudget));
  }
  if (investBudget > 0) {
    const matches = PRODUCTS.invest.filter((p) => p.minBudget <= investBudget);
    sections.push(buildProductSection("ลงทุน (SSF / RMF / Thai ESG)", "type-invest", matches, investBudget));
  }
  if (donateBudget > 0) {
    const matches = PRODUCTS.donate.filter((p) => p.minBudget <= donateBudget);
    sections.push(buildProductSection("บริจาค", "type-donate", matches, donateBudget));
  }

  container.innerHTML = sections.join("");
}

function buildProductSection(title, badgeClass, products, budget) {
  if (products.length === 0) {
    return `
      <div class="product-section">
        <div class="product-section-header">
          <span class="product-section-title">${title}</span>
        </div>
        <p class="product-empty">ไม่มีตัวเลือกที่ตรงกับงบ ${fmtBaht(budget)}</p>
      </div>`;
  }

  const cards = products.map((p) => `
    <div class="product-card">
      <div class="product-card-top">
        <div>
          <div class="product-name">
            ${p.name}
            ${p.tag ? `<span class="product-tag">${p.tag}</span>` : ""}
          </div>
          <div class="product-company">${p.company}</div>
        </div>
        <span class="plan-type-badge ${badgeClass}">${p.type}</span>
      </div>
      <div class="product-note">${p.note}</div>
      ${p.maxDeductible
        ? `<div class="product-deduct-limit">ลดหย่อนได้สูงสุด ${fmtNumber(p.maxDeductible)} บาท/ปี</div>`
        : ""}
      <button class="product-cta-btn">ดูรายละเอียด →</button>
    </div>`).join("");

  return `
    <div class="product-section">
      <div class="product-section-header">
        <span class="product-section-title">${title}</span>
        <span class="product-count">${products.length} ตัวเลือก</span>
      </div>
      <div class="product-cards">${cards}</div>
    </div>`;
}

/* ─────────────────────────────────────────────
   9. UI HELPERS
   ───────────────────────────────────────────── */

function numVal(id) {
  const el = document.getElementById(id);
  if (!el) return 0;
  const v = parseFloat(el.value);
  return isNaN(v) || v < 0 ? 0 : v;
}

function showError(msgId, text, afterEl) {
  let el = document.getElementById(msgId);
  if (!el) {
    el = document.createElement("div");
    el.id        = msgId;
    el.className = "error-msg";
    (afterEl || document.getElementById("annual-income").parentNode).after(el);
  }
  el.textContent = text;
  el.classList.add("show");
}

function validateMax(inputId, maxVal) {
  const input = document.getElementById(inputId);
  if (!input) return true;
  const v     = parseFloat(input.value);
  const msgId = `${inputId}-error`;
  if (!isNaN(v) && v > maxVal) {
    showError(msgId, `กรอกได้สูงสุด ${fmtNumber(maxVal)} บาท`, input.parentNode);
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

function setStep(n) {
  [1, 2, 3].forEach((i) => {
    const ind  = document.getElementById(`ind-${i}`);
    const line = ind ? ind.nextElementSibling : null;
    ind.classList.remove("active", "done");
    const span = ind.querySelector(".step-circle span");
    if (i < n) {
      ind.classList.add("done");
      if (span) span.textContent = "✓";
      if (line && line.classList.contains("step-line")) line.classList.add("done");
    } else if (i === n) {
      ind.classList.add("active");
      if (span) span.textContent = String(i).padStart(2, "0");
      if (line && line.classList.contains("step-line")) line.classList.remove("done");
    } else {
      if (span) span.textContent = String(i).padStart(2, "0");
      if (line && line.classList.contains("step-line")) line.classList.remove("done");
    }
    document.getElementById(`step${i}`).classList.toggle("hidden", i !== n);
  });
}

function updateExpenseHint() {
  const income = parseFloat(document.getElementById("annual-income").value) || 0;
  const type   = document.getElementById("income-type").value;
  const exp    = calcExpenseDeduction(income, type);
  const hint   = document.getElementById("expense-deduction-hint");
  hint.textContent = income > 0 ? `ค่าใช้จ่ายที่หักได้อัตโนมัติ: ${fmtBaht(exp)}` : "";
}

/* ─────────────────────────────────────────────
   10. EVENT HANDLERS
   ───────────────────────────────────────────── */

document.addEventListener("DOMContentLoaded", () => {
  /* ── Number steppers ── */
  document.querySelectorAll(".stepper-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      const min = parseInt(input.min, 10) || 0;
      const max = parseInt(input.max, 10) || 999;
      const cur = parseInt(input.value, 10) || 0;
      input.value = Math.min(max, Math.max(min, cur + parseInt(btn.dataset.delta, 10)));
    });
  });

  /* ── Accordions (all open by default) ── */
  document.querySelectorAll(".accordion-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const body  = btn.nextElementSibling;
      const isOpen = body.classList.contains("open");
      body.classList.toggle("open", !isOpen);
      btn.classList.toggle("open", !isOpen);
    });
  });
  document.querySelectorAll(".accordion-body").forEach((b) => b.classList.add("open"));
  document.querySelectorAll(".accordion-toggle").forEach((b) => b.classList.add("open"));

  /* ── Salary Calculator Popup ── */
  const salaryCalcBtn   = document.getElementById("salary-calc-btn");
  const salaryCalcPopup = document.getElementById("salary-calc-popup");
  const scMonthly       = document.getElementById("sc-monthly");
  const scMonths        = document.getElementById("sc-months");
  const scBonus         = document.getElementById("sc-bonus");
  const scResult        = document.getElementById("sc-result");
  const scUseBtn        = document.getElementById("sc-use-btn");

  function updateSalaryCalcResult() {
    const total = (parseFloat(scMonthly.value) || 0) * (parseInt(scMonths.value, 10) || 12)
      + (parseFloat(scBonus.value) || 0);
    scResult.textContent  = FMT.format(Math.round(total));
    scUseBtn.dataset.value = total;
  }

  salaryCalcBtn.addEventListener("click", () => {
    const opening = salaryCalcPopup.classList.contains("hidden");
    salaryCalcPopup.classList.toggle("hidden");
    if (opening) scMonthly.focus();
  });

  document.getElementById("salary-calc-close").addEventListener("click", () => {
    salaryCalcPopup.classList.add("hidden");
  });

  [scMonthly, scMonths, scBonus].forEach((el) => el.addEventListener("input", updateSalaryCalcResult));

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

  updateSalaryCalcResult();

  /* ── Income hint ── */
  document.getElementById("annual-income").addEventListener("input", updateExpenseHint);
  document.getElementById("income-type").addEventListener("change", updateExpenseHint);

  /* ── Capped-field validation ── */
  const CAPPED_FIELDS = [
    { id: "social-security",   max: SS_MAX            },
    { id: "life-insurance",    max: LIFE_INS_MAX      },
    { id: "health-insurance",  max: HEALTH_INS_MAX    },
    { id: "parents-health-ins",max: PARENTS_HEALTH_MAX},
    { id: "mortgage-interest", max: MORTGAGE_MAX      },
    { id: "existing-ssf",      max: SSF_MAX           },
    { id: "existing-rmf",      max: RMF_MAX           },
    { id: "existing-esg",      max: ESG_MAX           },
  ];
  CAPPED_FIELDS.forEach(({ id, max }) => {
    const input = document.getElementById(id);
    if (input) input.addEventListener("input", () => validateMax(id, max));
  });

  /* ── Step navigation ── */
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

  document.getElementById("step2-back").addEventListener("click", () => {
    setStep(1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  document.getElementById("step2-calc").addEventListener("click", () => {
    const income     = parseFloat(document.getElementById("annual-income").value) || 0;
    const incomeType = document.getElementById("income-type").value;

    const deductions = {
      hasSpouse:      document.getElementById("has-spouse").checked,
      numChildren:    numVal("num-children"),
      numParents:     numVal("num-parents"),
      numDisabled:    numVal("num-disabled"),
      socialSecurity: numVal("social-security"),
      lifeInsurance:  numVal("life-insurance"),
      healthInsurance:numVal("health-insurance"),
      parentsHealthIns:numVal("parents-health-ins"),
      ssf:            numVal("existing-ssf"),
      rmf:            numVal("existing-rmf"),
      esg:            numVal("existing-esg"),
      pvf:            numVal("existing-pvf"),
      mortgageInterest:numVal("mortgage-interest"),
    };

    const summary = buildDeductionSummary(income, incomeType, deductions);
    renderResults(summary);
    setStep(3);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  document.getElementById("step3-back").addEventListener("click", () => {
    setStep(2);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  /* ── Modal ── */
  document.getElementById("modal-close-btn").addEventListener("click", closePlanModal);

  document.getElementById("plan-modal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closePlanModal();
  });

  ["modal-insure-budget", "modal-invest-budget", "modal-donate-budget"].forEach((id) => {
    document.getElementById(id).addEventListener("input", updateModalProgress);
  });

  setStep(1);
});
