/* =============================================================
   Thai Tax Planner — js/tax.js
   Thai personal income tax calculator & deduction optimizer
   Tax year 2568 (2025)
   ============================================================= */

'use strict';

/* ─────────────────────────────────────────────
   1. CONSTANTS
   ───────────────────────────────────────────── */

/** Progressive tax brackets (upper bound inclusive, Infinity for last) */
const TAX_BRACKETS = [
  { min: 0,        max: 150_000,   rate: 0,    label: '0%' },
  { min: 150_001,  max: 300_000,   rate: 0.05, label: '5%' },
  { min: 300_001,  max: 500_000,   rate: 0.10, label: '10%' },
  { min: 500_001,  max: 750_000,   rate: 0.15, label: '15%' },
  { min: 750_001,  max: 1_000_000, rate: 0.20, label: '20%' },
  { min: 1_000_001,max: 2_000_000, rate: 0.25, label: '25%' },
  { min: 2_000_001,max: 5_000_000, rate: 0.30, label: '30%' },
  { min: 5_000_001,max: Infinity,  rate: 0.35, label: '35%' },
];

const PERSONAL_ALLOWANCE      = 60_000;
const COMBINED_INVESTMENT_CAP = 500_000;
const SSF_MAX                 = 200_000;
const RMF_MAX                 = 500_000;
const ESG_MAX                 = 300_000;
const INVESTMENT_INCOME_PCT   = 0.30;    // 30% of income
const SS_MAX                  = 9_000;
const LIFE_INS_MAX            = 100_000;
const HEALTH_INS_MAX          = 25_000;  // within life+health combined cap of 100k
const PARENTS_HEALTH_MAX      = 15_000;
const MORTGAGE_MAX            = 100_000;
const DONATION_CAP_PCT        = 0.10;    // 10% of net income

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
    const top = b.max === Infinity ? taxableIncome : Math.min(taxableIncome, b.max);
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
 * Calculate expense deduction based on income type.
 * @param {number} income
 * @param {'salary'|'freelance'} incomeType
 * @returns {number}
 */
function calcExpenseDeduction(income, incomeType) {
  if (incomeType === 'freelance') return Math.min(income * 0.60, 600_000);
  return Math.min(income * 0.50, 100_000);
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
  const spouseAllowance    = d.hasSpouse ? 60_000 : 0;
  const childAllowance     = Math.max(0, d.numChildren || 0) * 30_000;
  const parentAllowance    = Math.min(Math.max(0, d.numParents || 0), 4) * 30_000;
  const disabilityAllowance= Math.max(0, d.numDisabled || 0) * 60_000;

  // Insurance (cap each individually, then apply combined life+health cap of 100k)
  const ss           = Math.min(Math.max(0, d.socialSecurity || 0), SS_MAX);
  const lifeIns      = Math.min(Math.max(0, d.lifeInsurance  || 0), LIFE_INS_MAX);
  const healthRaw    = Math.min(Math.max(0, d.healthInsurance || 0), HEALTH_INS_MAX);
  // Combined life + health cap = 100k
  const healthIns    = Math.min(healthRaw, Math.max(0, LIFE_INS_MAX - lifeIns));
  const parentsHealth= Math.min(Math.max(0, d.parentsHealthIns || 0), PARENTS_HEALTH_MAX);

  // Investments (individual caps + combined cap)
  const pvf          = Math.max(0, d.pvf || 0);  // provident fund / GPF
  const ssfRaw       = Math.min(Math.max(0, d.ssf || 0), Math.min(income * INVESTMENT_INCOME_PCT, SSF_MAX));
  const rmfRaw       = Math.min(Math.max(0, d.rmf || 0), Math.min(income * INVESTMENT_INCOME_PCT, RMF_MAX));
  const esgRaw       = Math.min(Math.max(0, d.esg || 0), Math.min(income * INVESTMENT_INCOME_PCT, ESG_MAX));

  // Enforce combined cap (pvf + ssf + rmf + esg ≤ 500k)
  let investRemain = Math.max(0, COMBINED_INVESTMENT_CAP - pvf);
  const ssf  = Math.min(ssfRaw, investRemain);  investRemain -= ssf;
  const rmf  = Math.min(rmfRaw, investRemain);  investRemain -= rmf;
  const esg  = Math.min(esgRaw, investRemain);

  // Other
  const mortgage = Math.min(Math.max(0, d.mortgageInterest || 0), MORTGAGE_MAX);

  const totalExistingAdditional = spouseAllowance + childAllowance + parentAllowance +
    disabilityAllowance + ss + lifeIns + healthIns + parentsHealth +
    Math.min(pvf + ssf + rmf + esg, COMBINED_INVESTMENT_CAP) + mortgage;

  const totalDeductions = expenseDeduction + PERSONAL_ALLOWANCE + totalExistingAdditional;
  const taxableIncome   = Math.max(0, income - totalDeductions);
  const currentTax      = calcTax(taxableIncome);
  const effectiveRate   = income > 0 ? (currentTax / income) * 100 : 0;
  const marginalBracket = getMarginalBracket(taxableIncome);

  return {
    income, incomeType,
    // breakdown lines
    expenseDeduction,
    personalAllowance: PERSONAL_ALLOWANCE,
    spouseAllowance, childAllowance, parentAllowance, disabilityAllowance,
    ss, lifeIns, healthIns, parentsHealth,
    pvf, ssf, rmf, esg,
    mortgage,
    totalDeductions, taxableIncome, currentTax, effectiveRate, marginalBracket,
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
  const investRemain   = Math.max(0, COMBINED_INVESTMENT_CAP - usedInvestment);

  const ssfCap = Math.min(income * INVESTMENT_INCOME_PCT, SSF_MAX);
  const rmfCap = Math.min(income * INVESTMENT_INCOME_PCT, RMF_MAX);
  const esgCap = Math.min(income * INVESTMENT_INCOME_PCT, ESG_MAX);

  let remInv = investRemain;
  const availSSF = Math.min(Math.max(0, ssfCap - summary.ssf), remInv); remInv -= availSSF;
  const availRMF = Math.min(Math.max(0, rmfCap - summary.rmf), remInv); remInv -= availRMF;
  const availESG = Math.min(Math.max(0, esgCap - summary.esg), remInv);

  // Insurance remaining
  const usedCombinedIns = summary.lifeIns + summary.healthIns;
  const availLifeIns    = Math.max(0, LIFE_INS_MAX - summary.lifeIns -
    Math.max(0, usedCombinedIns - summary.lifeIns));
  // remaining health: max(0, 25k - used_health) but also within combined 100k
  const availHealthIns  = Math.min(
    Math.max(0, HEALTH_INS_MAX - summary.healthIns),
    Math.max(0, LIFE_INS_MAX - usedCombinedIns)
  );
  const availParentsHealth = Math.max(0, PARENTS_HEALTH_MAX - summary.parentsHealth);

  // Donation cap: 10% of net income before donations
  // "net income before donations" ≈ taxableIncome (donations aren't yet applied)
  const donationBase  = summary.taxableIncome;
  const eduDonCap     = Math.floor(donationBase * DONATION_CAP_PCT); // deduction cap for edu donation
  const regDonCap     = Math.floor(donationBase * DONATION_CAP_PCT); // deduction cap for regular donation

  return { availSSF, availRMF, availESG, availLifeIns, availHealthIns, availParentsHealth,
           eduDonCap, regDonCap };
}

/* ─────────────────────────────────────────────
   5. OPTIMIZATION — minimum-spend plan
   ───────────────────────────────────────────── */

/**
 * Build a recommendation plan to achieve `neededDeduction` of additional deduction
 * with minimum permanent cash outflow.
 *
 * Priority:
 *   1. SSF  (investment – money returned after lock-up)
 *   2. RMF  (investment – money returned at retirement)
 *   3. Thai ESG (investment – money returned)
 *   4. Education donation (2× deduction, spend half, permanent)
 *   5. Life insurance (spend = deduction, but get coverage)
 *   6. Health insurance
 *   7. Parents' health insurance
 *   8. Regular donation (1× deduction, permanent)
 *
 * @param {number} neededDeduction  Additional taxable income reduction required
 * @param {object} cap              Output of calcAvailableCapacity
 * @param {number} marginalRate     Current marginal tax rate (decimal)
 * @returns {{ plan: Array, achievable: boolean, remainingShortfall: number }}
 */
function buildOptimalPlan(neededDeduction, cap, marginalRate) {
  const plan = [];
  let rem = neededDeduction;

  function addStep(type, category, deductionAmt, spendAmt, note) {
    if (deductionAmt <= 0) return;
    const taxSaved = Math.round(deductionAmt * marginalRate);
    plan.push({ type, category, deductionAmt: Math.round(deductionAmt),
                spendAmt: Math.round(spendAmt), taxSaved, note });
    rem -= deductionAmt;
  }

  // 1. SSF
  if (rem > 0 && cap.availSSF > 0) {
    const use = Math.min(rem, cap.availSSF);
    addStep('SSF', 'invest', use, use, 'ลงทุน – ได้คืนเมื่อถอน (ถือครอง 10 ปี)');
  }

  // 2. RMF
  if (rem > 0 && cap.availRMF > 0) {
    const use = Math.min(rem, cap.availRMF);
    addStep('RMF', 'invest', use, use, 'ลงทุน – ได้คืนเมื่ออายุ 55 ปี (ถือครอง 5 ปี)');
  }

  // 3. Thai ESG
  if (rem > 0 && cap.availESG > 0) {
    const use = Math.min(rem, cap.availESG);
    addStep('Thai ESG', 'invest', use, use, 'ลงทุน – ได้คืนหลังถือครอง 5 ปี');
  }

  // 4. Education donation (2× deduction → spend only half)
  if (rem > 0 && cap.eduDonCap > 0) {
    const usableDeduction = Math.min(rem, cap.eduDonCap);
    const spend = Math.ceil(usableDeduction / 2);  // donate half, get 2× deduction
    addStep('บริจาคเพื่อการศึกษา / กีฬา / สาธารณสุข', 'donate',
      usableDeduction, spend, 'ลดหย่อนได้ 2 เท่าของเงินบริจาค (สูงสุด 10% ของเงินได้สุทธิ)');
  }

  // 5. Life insurance (remaining capacity)
  if (rem > 0 && cap.availLifeIns > 0) {
    const use = Math.min(rem, cap.availLifeIns);
    addStep('ประกันชีวิต / เงินฝากสะสมทรัพย์', 'insure', use, use, 'ได้รับความคุ้มครองชีวิต');
  }

  // 6. Health insurance
  if (rem > 0 && cap.availHealthIns > 0) {
    const use = Math.min(rem, cap.availHealthIns);
    addStep('ประกันสุขภาพ', 'insure', use, use, 'ได้รับความคุ้มครองสุขภาพ');
  }

  // 7. Parents' health insurance
  if (rem > 0 && cap.availParentsHealth > 0) {
    const use = Math.min(rem, cap.availParentsHealth);
    addStep('ประกันสุขภาพบิดา/มารดา', 'insure', use, use, 'ได้รับความคุ้มครองสุขภาพบิดามารดา');
  }

  // 8. Regular donation (cap same as edu donation – shared 10% limit here simplified)
  if (rem > 0 && cap.regDonCap > 0) {
    const use = Math.min(rem, cap.regDonCap);
    addStep('เงินบริจาคทั่วไป', 'donate', use, use, 'บริจาคเพื่อสาธารณประโยชน์ (สูงสุด 10% ของเงินได้สุทธิ)');
  }

  return { plan, achievable: rem <= 0, remainingShortfall: Math.max(0, Math.round(rem)) };
}

/* ─────────────────────────────────────────────
   6. FORMATTING UTILITIES
   ───────────────────────────────────────────── */

const FMT = new Intl.NumberFormat('th-TH');
const fmtBaht   = (n) => FMT.format(Math.round(n)) + ' บาท';
const fmtNumber = (n) => FMT.format(Math.round(n));
const fmtPct    = (n) => n.toFixed(2) + '%';

/* ─────────────────────────────────────────────
   7. RESULTS RENDERING
   ───────────────────────────────────────────── */

/**
 * Build and inject the results HTML into #results-container.
 * @param {object} summary  from buildDeductionSummary
 */
function renderResults(summary) {
  const container = document.getElementById('results-container');
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
    ['ค่าใช้จ่าย (หักอัตโนมัติ)',   summary.expenseDeduction],
    ['ค่าลดหย่อนส่วนตัว',           summary.personalAllowance],
    summary.spouseAllowance   ? ['คู่สมรส',                   summary.spouseAllowance]   : null,
    summary.childAllowance    ? ['บุตร',                      summary.childAllowance]    : null,
    summary.parentAllowance   ? ['บิดามารดา',                 summary.parentAllowance]   : null,
    summary.disabilityAllowance?['ผู้พิการ/ทุพพลภาพ',         summary.disabilityAllowance]:null,
    summary.ss                ? ['เงินประกันสังคม',            summary.ss]                : null,
    summary.lifeIns           ? ['ประกันชีวิต',               summary.lifeIns]           : null,
    summary.healthIns         ? ['ประกันสุขภาพ',              summary.healthIns]         : null,
    summary.parentsHealth     ? ['ประกันสุขภาพบิดามารดา',     summary.parentsHealth]     : null,
    summary.pvf               ? ['กองทุนสำรองเลี้ยงชีพ/กบข.',  summary.pvf]               : null,
    summary.ssf               ? ['SSF',                      summary.ssf]               : null,
    summary.rmf               ? ['RMF',                      summary.rmf]               : null,
    summary.esg               ? ['Thai ESG',                 summary.esg]               : null,
    summary.mortgage          ? ['ดอกเบี้ยกู้ซื้อบ้าน',       summary.mortgage]          : null,
  ].filter(Boolean);

  const breakdownRows = rows.map(([label, amt]) =>
    `<tr><td>${label}</td><td class="amt negative">− ${fmtNumber(amt)}</td></tr>`
  ).join('');

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
  const barColors   = { 0:'.bar-0', 5:'.bar-5', 10:'.bar-10', 15:'.bar-15',
                        20:'.bar-20', 25:'.bar-25', 30:'.bar-30', 35:'.bar-35' };

  const ladderRows = TAX_BRACKETS.map((b) => {
    if (b.min > summary.taxableIncome + 1 && b.min > 150_000) return '';
    const incomeFalls = summary.taxableIncome >= b.min;
    const taxInBracket = incomeFalls
      ? calcTax(Math.min(summary.taxableIncome, b.max === Infinity ? summary.taxableIncome : b.max))
        - calcTax(Math.max(0, b.min - 1))
      : 0;
    const width = incomeFalls
      ? Math.round(Math.min(
          (Math.min(summary.taxableIncome, b.max === Infinity ? summary.taxableIncome : b.max)
           - (b.min - 1)) / maxBarValue * 100, 100))
      : 0;
    const isCurrent = summary.marginalBracket.rate === b.rate && incomeFalls;
    const colorClass = (barColors[Math.round(b.rate * 100)] || '.bar-35').slice(1);
    const label = b.max === Infinity
      ? `${fmtNumber(b.min)} บาทขึ้นไป`
      : `${fmtNumber(b.min)} – ${fmtNumber(b.max)} บาท`;

    return `
      <div class="bracket-row ${isCurrent ? 'current-bracket' : ''}">
        <div class="br-label">${b.label}</div>
        <div class="br-bar-wrap">
          <div class="br-bar ${colorClass}" style="width:${width}%">
            ${width > 15 ? label : ''}
          </div>
        </div>
        <div class="br-tax-amt">${taxInBracket > 0 ? fmtNumber(taxInBracket) + ' บ.' : '–'}</div>
      </div>`;
  }).join('');

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
    </div>`;

  // ── Target bracket recommendations ────────────────────
  const lowerBrackets = TAX_BRACKETS.filter(
    (b) => b.rate < marginalRate && b.max !== Infinity
  );

  let targetsHTML = '';
  if (lowerBrackets.length === 0) {
    targetsHTML = `<div class="zero-tax-msg">
      <span class="ztm-icon">🎉</span>
      <span>คุณอยู่ในขั้นบันได 0% แล้ว ไม่ต้องเสียภาษีเงินได้บุคคลธรรมดา!</span>
    </div>`;
  } else {
    const chevronSVG = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3 5l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const cardItems = lowerBrackets.reverse().map((target, idx) => {
      const targetTaxableIncome = target.max;
      const neededDeduction     = Math.max(0, summary.taxableIncome - targetTaxableIncome);
      if (neededDeduction === 0) return '';

      const targetTax   = calcTax(targetTaxableIncome);
      const taxSaving   = summary.currentTax - targetTax;
      const { plan, achievable, remainingShortfall } =
        buildOptimalPlan(neededDeduction, cap, marginalRate);

      const totalSpend     = plan.reduce((s, p) => s + p.spendAmt, 0);
      const totalInvest    = plan.filter((p) => p.category === 'invest')
                                 .reduce((s, p) => s + p.spendAmt, 0);
      const totalPermanent = plan.filter((p) => p.category !== 'invest')
                                 .reduce((s, p) => s + p.spendAmt, 0);

      const planRows = plan.map((p) => {
        const catMap   = { invest: 'type-invest', insure: 'type-insure', donate: 'type-donate' };
        const catLabel = { invest: 'ลงทุน', insure: 'ประกัน', donate: 'บริจาค' };
        return `
          <tr>
            <td>${p.type}</td>
            <td class="amt">${fmtNumber(p.deductionAmt)}</td>
            <td class="amt">${fmtNumber(p.spendAmt)}</td>
            <td><span class="plan-type-badge ${catMap[p.category]}">${catLabel[p.category]}</span></td>
            <td class="plan-note">${p.note}</td>
          </tr>`;
      }).join('');

      const achievableClass = achievable ? 'achievable' : 'not-achievable';
      const savingBadge     = achievable
        ? `ประหยัดภาษีได้ ${fmtBaht(taxSaving)}`
        : `ขาดลดหย่อน ${fmtBaht(remainingShortfall)}`;

      const bodyHTML = achievable ? `
        <div class="target-card-body">
          <p class="plan-intro">
            ลดหย่อนเพิ่มอีก <strong>${fmtBaht(neededDeduction)}</strong>
            เพื่อให้เงินได้สุทธิ ≤ ${fmtBaht(targetTaxableIncome)}
            และประหยัดภาษีได้ <strong class="saving">${fmtBaht(taxSaving)}</strong>
          </p>
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
          </div>
        </div>` : `
        <div class="target-card-body">
          <p class="not-achievable-note">
            ⚠️ ช่องทางลดหย่อนที่เหลือรวมกัน (<strong>${fmtBaht(neededDeduction - remainingShortfall)}</strong>)
            ยังไม่เพียงพอ — ต้องการ <strong>${fmtBaht(neededDeduction)}</strong>
            แต่ขาดอีก <strong>${fmtBaht(remainingShortfall)}</strong>
          </p>
          ${plan.length > 0 ? `
          <p class="plan-intro">แผนที่ทำได้บางส่วน:</p>
          <table class="plan-table">
            <thead>
              <tr>
                <th>รายการ</th><th class="amt">ลดหย่อน (บ.)</th>
                <th class="amt">จ่ายจริง (บ.)</th><th>ประเภท</th><th>หมายเหตุ</th>
              </tr>
            </thead>
            <tbody>${planRows}</tbody>
          </table>` : ''}
        </div>`;

      return `
        <div class="target-card ${achievableClass}" id="target-${idx}">
          <div class="target-card-header" onclick="toggleTarget('target-${idx}')">
            <span class="target-bracket-label">
              ${achievable ? '✅' : '❌'} ลดเป็นขั้นบันได <strong>${target.label}</strong>
              &nbsp;— เงินได้สุทธิ ≤ ${fmtBaht(targetTaxableIncome)}
            </span>
            <span class="target-savings-badge">${savingBadge}</span>
            <span class="target-toggle-icon">${chevronSVG}</span>
          </div>
          ${bodyHTML}
        </div>`;
    }).join('');

    targetsHTML = `
      <div class="targets-section">
        <p class="section-title">แผนลดหย่อนเพื่อลดขั้นบันไดภาษี</p>
        <p>คลิกที่แต่ละเป้าหมายเพื่อดูรายละเอียดแผนที่ใช้เงินน้อยที่สุด</p>
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
  card.classList.toggle('expanded');
}

/** Read a numeric input value (default to 0 if empty/invalid) */
function numVal(id) {
  const el = document.getElementById(id);
  if (!el) return 0;
  const v = parseFloat(el.value);
  return isNaN(v) || v < 0 ? 0 : v;
}

/** Show an error message below an input */
function showError(msgId, text) {
  let el = document.getElementById(msgId);
  if (!el) {
    el = document.createElement('div');
    el.id = msgId;
    el.className = 'error-msg';
    document.getElementById('annual-income').parentNode.after(el);
  }
  el.textContent = text;
  el.classList.add('show');
}

function clearError(msgId) {
  const el = document.getElementById(msgId);
  if (el) el.classList.remove('show');
}

/** Update step indicator */
function setStep(n) {
  [1, 2, 3].forEach((i) => {
    const ind = document.getElementById(`ind-${i}`);
    const line = ind ? ind.nextElementSibling : null;
    ind.classList.remove('active', 'done');
    const circle = ind.querySelector('.step-circle');
    const span   = circle ? circle.querySelector('span') : circle;
    if (i < n) {
      ind.classList.add('done');
      if (span) span.textContent = '✓';
      if (line && line.classList.contains('step-line')) line.classList.add('done');
    } else if (i === n) {
      ind.classList.add('active');
      if (span) span.textContent = String(i).padStart(2, '0');
      if (line && line.classList.contains('step-line')) line.classList.remove('done');
    } else {
      if (span) span.textContent = String(i).padStart(2, '0');
      if (line && line.classList.contains('step-line')) line.classList.remove('done');
    }
    document.getElementById(`step${i}`).classList.toggle('hidden', i !== n);
  });
}

/** Update the expense deduction hint under the income input */
function updateExpenseHint() {
  const income = parseFloat(document.getElementById('annual-income').value) || 0;
  const type   = document.getElementById('income-type').value;
  const exp    = calcExpenseDeduction(income, type);
  const hint   = document.getElementById('expense-deduction-hint');
  if (income > 0) {
    hint.textContent = `ค่าใช้จ่ายที่หักได้อัตโนมัติ: ${fmtBaht(exp)}`;
  } else {
    hint.textContent = '';
  }
}

/* ─────────────────────────────────────────────
   9. EVENT HANDLERS
   ───────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {

  /* ── Number steppers ── */
  document.querySelectorAll('.stepper-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const delta    = parseInt(btn.dataset.delta, 10);
      const input    = document.getElementById(targetId);
      if (!input) return;
      const min = parseInt(input.min, 10) || 0;
      const max = parseInt(input.max, 10) || 999;
      const cur = parseInt(input.value, 10) || 0;
      input.value = Math.min(max, Math.max(min, cur + delta));
    });
  });

  /* ── Accordion toggles ── */
  document.querySelectorAll('.accordion-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const body = btn.nextElementSibling;
      const isOpen = body.classList.contains('open');
      body.classList.toggle('open', !isOpen);
      btn.classList.toggle('open', !isOpen);
    });
    // Open first accordion by default
  });
  // Open all accordions by default on step 2
  document.querySelectorAll('.accordion-body').forEach((b) => {
    b.classList.add('open');
  });
  document.querySelectorAll('.accordion-toggle').forEach((b) => {
    b.classList.add('open');
  });

  /* ── Salary Calculator Popup ── */
  const salaryCalcBtn   = document.getElementById('salary-calc-btn');
  const salaryCalcPopup = document.getElementById('salary-calc-popup');
  const salaryCalcClose = document.getElementById('salary-calc-close');
  const scMonthly       = document.getElementById('sc-monthly');
  const scMonths        = document.getElementById('sc-months');
  const scBonus         = document.getElementById('sc-bonus');
  const scResult        = document.getElementById('sc-result');
  const scUseBtn        = document.getElementById('sc-use-btn');

  function updateSalaryCalcResult() {
    const monthly = parseFloat(scMonthly.value) || 0;
    const months  = parseInt(scMonths.value, 10) || 12;
    const bonus   = parseFloat(scBonus.value) || 0;
    const total   = monthly * months + bonus;
    scResult.textContent = FMT.format(Math.round(total));
    scUseBtn.dataset.value = total;
  }

  salaryCalcBtn.addEventListener('click', () => {
    const opening = salaryCalcPopup.classList.contains('hidden');
    salaryCalcPopup.classList.toggle('hidden');
    if (opening) scMonthly.focus();
  });

  salaryCalcClose.addEventListener('click', () => {
    salaryCalcPopup.classList.add('hidden');
  });

  [scMonthly, scMonths, scBonus].forEach((el) => {
    el.addEventListener('input', updateSalaryCalcResult);
  });

  scUseBtn.addEventListener('click', () => {
    const total = parseFloat(scUseBtn.dataset.value) || 0;
    if (total > 0) {
      document.getElementById('annual-income').value = total;
      updateExpenseHint();
      clearError('income-error');
    }
    salaryCalcPopup.classList.add('hidden');
  });

  document.addEventListener('click', (e) => {
    if (
      !salaryCalcPopup.classList.contains('hidden') &&
      !salaryCalcPopup.contains(e.target) &&
      e.target !== salaryCalcBtn &&
      !salaryCalcBtn.contains(e.target)
    ) {
      salaryCalcPopup.classList.add('hidden');
    }
  });

  /* Initialize salary calc result */
  updateSalaryCalcResult();

  /* ── Income hint ── */
  document.getElementById('annual-income').addEventListener('input', updateExpenseHint);
  document.getElementById('income-type').addEventListener('change', updateExpenseHint);

  /* ── Step 1 → Step 2 ── */
  document.getElementById('step1-next').addEventListener('click', () => {
    const income = parseFloat(document.getElementById('annual-income').value);
    if (!income || income <= 0) {
      showError('income-error', 'กรุณากรอกรายได้ที่ถูกต้อง (มากกว่า 0)');
      return;
    }
    clearError('income-error');
    setStep(2);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  /* ── Step 2 → Step 1 ── */
  document.getElementById('step2-back').addEventListener('click', () => {
    setStep(1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  /* ── Step 2 → Step 3 (Calculate) ── */
  document.getElementById('step2-calc').addEventListener('click', () => {
    const income     = parseFloat(document.getElementById('annual-income').value) || 0;
    const incomeType = document.getElementById('income-type').value;

    const deductions = {
      hasSpouse:        document.getElementById('has-spouse').checked,
      numChildren:      numVal('num-children'),
      numParents:       numVal('num-parents'),
      numDisabled:      numVal('num-disabled'),
      socialSecurity:   numVal('social-security'),
      lifeInsurance:    numVal('life-insurance'),
      healthInsurance:  numVal('health-insurance'),
      parentsHealthIns: numVal('parents-health-ins'),
      ssf:              numVal('existing-ssf'),
      rmf:              numVal('existing-rmf'),
      esg:              numVal('existing-esg'),
      pvf:              numVal('existing-pvf'),
      mortgageInterest: numVal('mortgage-interest'),
    };

    const summary = buildDeductionSummary(income, incomeType, deductions);
    renderResults(summary);
    setStep(3);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  /* ── Step 3 → Step 2 ── */
  document.getElementById('step3-back').addEventListener('click', () => {
    setStep(2);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  /* Initialize on step 1 */
  setStep(1);
});
