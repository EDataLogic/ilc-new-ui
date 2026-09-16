/**
 * iLive Heart Screen — Cardiovascular Risk Engine  v1.0
 * =====================================================
 * Pure functions. No I/O, no DOM, no dependencies. Runs identically on device (offline)
 * and on server (audit / Command Centre). Use the golden vectors in test-vectors.json
 * to verify any port (Kotlin / Swift / Python) — outputs must match to 0.1 %.
 *
 * CLINICAL BASIS
 *   Framingham General Cardiovascular Risk Score — office-based (BMI) model.
 *   D'Agostino RB Sr, Vasan RS, Pencina MJ, et al. Circulation 2008;117:743-753.
 *   Validated for adults 30-74 without prior cardiovascular disease.
 *
 * iLive RULES (agreed with clinical lead, see SPEC.md)
 *   R1  Systolic BP is MANDATORY. No default. No BP → status "needs_bp", no score.
 *   R2  Age outside 30-74 → status "out_of_range", no numerical score; programme continues.
 *   R3  Equation set must be chosen explicitly: "male" | "female". Anything else →
 *       status "needs_equation_set", no score. Never default to male.
 *   R4  South Asian adjustment is an iLive clinical rule (JBS2 basis, ×1.4 for MEN only),
 *       tapered by iLive (see applySouthAsian). It is an explicit input `southAsian`.
 *   R5  Detailed-assessment overlay (optional) applies BEFORE the South Asian taper; band is
 *       recomputed after. "Not sure" = no adjustment + flagged `unknowns[]`.
 *   R6  Heart age = age at which a healthy-profile person of the same equation set reaches the
 *       same raw risk; solved by bisection on [20, 110]; reported capped at 85 ("85+").
 *   R7  Deterministic, side-effect free; identical on device and server.
 */


// ---------- 0. QUESTION BANK — the exact wording the app must show ----------
/**
 * Single source of truth for every question, its field, type and validation.
 * The app renders from this; it must not hard-code question text.
 * `layer`: 1 = core Framingham (mandatory) · 2 = detailed overlay (optional) · 3 = STOP-BANG (optional)
 */
const QUESTIONS = Object.freeze({
  layer1: Object.freeze([
    { field: 'age',          layer: 1, type: 'number', unit: 'years', q: 'Your age?',                          required: true,  min: 18, max: 120, note: 'Score computed only for 30–74.' },
    { field: 'equationSet',  layer: 1, type: 'choice', q: 'Which risk equations should we use?',               required: true,  options: [{ v: 'male', l: 'Male' }, { v: 'female', l: 'Female' }], note: 'The score has male and female equations only. Do not default.' },
    { field: 'heightCm',     layer: 1, type: 'number', unit: 'cm', q: 'Your height?',                          required: true,  min: 100, max: 250 },
    { field: 'weightKg',     layer: 1, type: 'number', unit: 'kg', q: 'Your weight?',                          required: true,  min: 25,  max: 300 },
    { field: 'sbp',          layer: 1, type: 'number', unit: 'mmHg', q: 'Your most recent blood pressure — upper number (systolic)?', required: true, min: 70, max: 260, note: 'MANDATORY. No default. If unknown, the user must measure first.' },
    { field: 'bpTreated',    layer: 1, type: 'bool',   q: 'Do you take medicine for blood pressure?',          required: true },
    { field: 'smoker',       layer: 1, type: 'choice', q: 'Do you smoke?',                                     required: true,  options: [{ v: false, l: 'Never' }, { v: false, l: 'In the past' }, { v: true, l: 'Currently' }] },
    { field: 'diabetes',     layer: 1, type: 'bool',   q: 'Have you been diagnosed with diabetes?',            required: true },
    { field: 'southAsian',   layer: 1, type: 'bool',   q: 'Are you of South Asian ethnicity?',                 required: true,  default: true, note: 'Explicit input. Drives the iLive JBS2 adjustment (men only).' },
    { field: 'highCholesterol',   layer: 1, type: 'bool', q: 'Have you been told you have high cholesterol?',  required: false, note: 'Routing only — not in the BMI equation.' },
    { field: 'knownHeartDisease', layer: 1, type: 'bool', q: 'Have you been diagnosed with heart disease?',    required: false, note: 'Routing only.' },
  ]),
  layer2: Object.freeze([
    { field: 'overlay.family_chd_lt60', q: 'Has a parent, brother or sister had a heart attack or angina before the age of 60?', why: 'First-degree family history is among the strongest factors a questionnaire can capture.' },
    { field: 'overlay.ckd',             q: 'Have you been told you have kidney disease?',                       why: 'Reduced kidney function raises cardiovascular risk independently of blood pressure.' },
    { field: 'overlay.atrial_fib',      q: 'Do you have an irregular heart rhythm, or atrial fibrillation?',    why: 'Atrial fibrillation substantially raises stroke risk.' },
    { field: 'overlay.migraine',        q: 'Do you get migraine headaches?',                                    why: 'Migraine, particularly with aura, is associated with higher stroke risk.' },
    { field: 'overlay.ra_sle',          q: 'Do you have rheumatoid arthritis or lupus?',                        why: 'Chronic inflammatory disease accelerates atherosclerosis.' },
    { field: 'overlay.corticosteroids', q: 'Do you take steroid tablets regularly?',                            why: 'Long-term corticosteroids raise blood pressure, sugar and lipids.' },
    { field: 'overlay.smi',             q: 'Are you treated for severe depression, bipolar disorder or schizophrenia?', why: 'Severe mental illness and some antipsychotics carry measurable cardiovascular risk.' },
    { field: 'overlay.erectile_dysf',   q: 'Do you have difficulty with erections?',                            why: 'Erectile dysfunction is an early sign of blood-vessel disease.', showIf: 'equationSet === "male"' },
    { field: 'overlay.heavy_smoker',    q: 'Do you smoke 20 or more cigarettes a day?',                         why: 'Risk rises with amount smoked, not only with smoking status.', showIf: 'smoker === true' },
    { field: 'overlay.waist_high',      q: 'Is your waist larger than 90 cm (men) or 80 cm (women)?',           why: 'In South Asians, waist predicts risk better than BMI alone.' },
  ]),
  layer3: Object.freeze([
    { field: 'stopbang.snore',    q: 'Do you snore loudly — louder than talking, or heard through a closed door?' },
    { field: 'stopbang.tired',    q: 'Do you often feel tired, fatigued or sleepy during the daytime?' },
    { field: 'stopbang.observed', q: 'Has anyone observed you stop breathing, choke or gasp during your sleep?' },
    { field: 'stopbang.pressure', q: 'Do you have, or are you treated for, high blood pressure?' },
    { field: 'stopbang.neck',     q: 'Is your neck circumference greater than 40 cm (16 inches)?' },
  ]),
  answerValues: Object.freeze({ yes: true, no: false, not_sure: 'not_sure' }),
});

// ---------- 1. Framingham coefficients (office-based / BMI model, Table 4, D'Agostino 2008) ----------
const FRS = Object.freeze({
  male:   Object.freeze({ lnAge: 3.11296, lnBMI: 0.79277, lnSBPu: 1.85508, lnSBPt: 1.92672, smoker: 0.70953, diabetes: 0.53160, mean: 23.9388, s10: 0.88431 }),
  female: Object.freeze({ lnAge: 2.72107, lnBMI: 0.51125, lnSBPu: 2.81291, lnSBPt: 2.88267, smoker: 0.61868, diabetes: 0.77763, mean: 26.0145, s10: 0.94833 }),
});

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Raw 10-year CVD risk (0-1). Assumes inputs already validated. */
function frsRaw({ age, equationSet, bmi, sbp, bpTreated, smoker, diabetes }) {
  const k = FRS[equationSet];
  const sum = k.lnAge * Math.log(age) + k.lnBMI * Math.log(clamp(bmi, 15, 50)) +
    (bpTreated ? k.lnSBPt : k.lnSBPu) * Math.log(clamp(sbp, 90, 200)) +
    (smoker ? k.smoker : 0) + (diabetes ? k.diabetes : 0);
  return clamp(1 - Math.pow(k.s10, Math.exp(sum - k.mean)), 0.0001, 0.95);
}

// ---------- 2. iLive South Asian rule (R4) ----------
/**
 * JBS2 (Heart 2005;91 Suppl V) recommends ×1.4 for South Asian MEN; no factor for women (evidence
 * base was men only). iLive TAPER: factor = 1 + 0.4·(1 − min(raw/0.40, 1)) — full ×1.4 at low raw risk,
 * fading linearly to ×1.0 as raw risk approaches 40 %, to avoid stacking multipliers into implausible
 * values. The taper is an iLive implementation choice, not externally validated — label it as such.
 */
function southAsianFactor(raw, equationSet, southAsian) {
  if (!southAsian || equationSet !== 'male') return 1;
  return 1 + 0.4 * (1 - clamp(raw / 0.40, 0, 1));
}

// ---------- 3. Detailed-assessment overlay (R5) ----------
/**
 * Optional. Each factor's HR is the iLive working approximation, sourced to QRISK3 (Hippisley-Cox J,
 * Coupland C, Brindle P. BMJ 2017;357:j2099, Table 2 adjusted HRs, sexes pooled/rounded by iLive).
 * Status: "iLive-derived approximation pending licensed QRISK3 coefficients". Waist circumference is
 * NOT in QRISK3 — it is an iLive rule (WHO Asian cut-offs) and is flagged as such.
 * Multiplicative, capped at 2.6 total. Answer "not_sure"/undefined → no change, recorded in `unknowns`.
 */
const OVERLAY = Object.freeze([
  { id: 'family_chd_lt60', hr: 1.45, source: 'QRISK3 family history of CHD in 1st-degree relative <60' },
  { id: 'ckd',             hr: 1.40, source: 'QRISK3 CKD stage 3-5 (midpoint)' },
  { id: 'atrial_fib',      hr: 1.65, source: 'QRISK3 atrial fibrillation' },
  { id: 'migraine',        hr: 1.25, source: 'QRISK3 migraine' },
  { id: 'ra_sle',          hr: 1.40, source: 'QRISK3 rheumatoid arthritis / SLE' },
  { id: 'corticosteroids', hr: 1.30, source: 'QRISK3 regular corticosteroids' },
  { id: 'smi',             hr: 1.22, source: 'QRISK3 severe mental illness / atypical antipsychotics' },
  { id: 'erectile_dysf',   hr: 1.30, source: 'QRISK3 erectile dysfunction (male equation set only)', maleOnly: true },
  { id: 'heavy_smoker',    hr: 1.35, source: 'QRISK3 heavy (20+/day) vs light smoker', smokerOnly: true },
  { id: 'waist_high',      hr: 1.25, source: 'iLive rule — WHO Asian waist cut-off (M ≥90 cm, F ≥80 cm); not in QRISK3' },
]);

function overlayMultiplier(answers, ctx) {
  let m = 1; const applied = [], unknowns = [];
  for (const f of OVERLAY) {
    if (f.maleOnly && ctx.equationSet !== 'male') continue;
    if (f.smokerOnly && !ctx.smoker) continue;
    const a = answers ? answers[f.id] : undefined;
    if (a === true || a === 'yes') { m *= f.hr; applied.push(f.id); }
    else if (a === undefined || a === null || a === 'not_sure') { if (answers && a === 'not_sure') unknowns.push(f.id); }
  }
  return { multiplier: clamp(m, 1, 2.6), applied, unknowns };
}


// ---------- 3b. STOP-BANG — obstructive sleep apnoea screen ----------
/**
 * Chung F, Yegneswaran B, Liao P, et al. Anesthesiology 2008;108:812-821 (STOP questionnaire /
 * STOP-Bang). Scoring: 8 yes/no items, 1 point each.
 *   0-2 = Low risk of moderate-to-severe OSA · 3-4 = Intermediate · 5-8 = High
 * Four items are ANSWERED by the user (S,T,O,P); four are DERIVED from the profile (B,A,N,G):
 *   B = BMI > 35 · A = age > 50 · N = neck circumference > 40 cm · G = male equation set
 * NOTE: STOP-BANG does NOT feed the cardiovascular risk score. It is reported separately and
 * flags the patient for a sleep review. Keep the two results separate in the UI and the record.
 */
const STOPBANG_ITEMS = Object.freeze([
  { id: 'S', key: 'snore',    q: 'Do you snore loudly — louder than talking, or loud enough to be heard through a closed door?', type: 'user' },
  { id: 'T', key: 'tired',    q: 'Do you often feel tired, fatigued or sleepy during the daytime?', type: 'user' },
  { id: 'O', key: 'observed', q: 'Has anyone observed you stop breathing, choke or gasp during your sleep?', type: 'user' },
  { id: 'P', key: 'pressure', q: 'Do you have, or are you being treated for, high blood pressure?', type: 'user' },
  { id: 'B', key: 'bmi',      q: 'BMI greater than 35 kg/m²', type: 'derived' },
  { id: 'A', key: 'age',      q: 'Age over 50 years', type: 'derived' },
  { id: 'N', key: 'neck',     q: 'Neck circumference greater than 40 cm (16 inches)?', type: 'user' },
  { id: 'G', key: 'gender',   q: 'Male', type: 'derived' },
]);

function stopBang(answers, profile) {
  const a = answers || {};
  const yes = (v) => v === true || v === 'yes';
  const items = {
    S: yes(a.snore), T: yes(a.tired), O: yes(a.observed), P: yes(a.pressure) || !!profile.bpTreated,
    B: profile.bmi > 35, A: profile.age > 50, N: yes(a.neck), G: profile.equationSet === 'male',
  };
  const score = Object.values(items).filter(Boolean).length;
  const level = score >= 5 ? 'High' : score >= 3 ? 'Intermediate' : 'Low';
  const unanswered = ['snore', 'tired', 'observed', 'neck'].filter(k => a[k] === undefined || a[k] === null || a[k] === 'not_sure');
  return { score, max: 8, level, items, unanswered,
    note: level === 'High' ? 'High probability of moderate-to-severe OSA. Untreated OSA drives resistant hypertension and nocturnal arrhythmia — recommend sleep study and flag to the Command Centre.'
        : level === 'Intermediate' ? 'Intermediate probability of OSA. Discuss at the next consultation.'
        : 'Low probability of OSA.',
    affectsCvdScore: false };
}

// ---------- 4. Band (R5: recomputed after every adjustment) ----------
function bandFor(pct) {
  if (pct >= 20) return 'High';
  if (pct >= 10) return 'Intermediate';
  return 'Low';
}

// ---------- 5. Heart age (R6) ----------
/** Age at which a healthy-profile person (BMI 22.5, SBP 125 untreated, non-smoker, non-diabetic) of
 *  the same equation set reaches `targetRaw`. Bisection on [20,110]; reported capped at 85. */
function heartAgeFor(targetRaw, equationSet) {
  const healthy = (a) => frsRaw({ age: a, equationSet, bmi: 22.5, sbp: 125, bpTreated: false, smoker: false, diabetes: false });
  let lo = 20, hi = 110;
  if (healthy(lo) >= targetRaw) return { value: 20, display: '20', capped: false };
  if (healthy(hi) <= targetRaw) return { value: 85, display: '85+', capped: true };
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (healthy(mid) < targetRaw) lo = mid; else hi = mid; }
  const exact = (lo + hi) / 2;
  const rounded = Math.round(exact);
  return rounded > 85 ? { value: 85, display: '85+', capped: true } : { value: rounded, display: String(rounded), capped: false };
}

// ---------- 6. Validation (R1, R2, R3) ----------
/**
 * input = {
 *   age (int, years), equationSet ('male'|'female'), heightCm, weightKg, sbp (int, mmHg),
 *   bpTreated (bool), smoker (bool), diabetes (bool), southAsian (bool, default true for India),
 *   overlay? ({ [id]: true|false|'not_sure' })
 * }
 */
function validate(input) {
  const e = [];
  if (!input || typeof input !== 'object') return ['input_missing'];
  if (!(input.age >= 18)) e.push('age_invalid');
  if (input.equationSet !== 'male' && input.equationSet !== 'female') e.push('needs_equation_set');
  if (!(input.heightCm > 100 && input.heightCm < 250)) e.push('height_invalid');
  if (!(input.weightKg > 25 && input.weightKg < 300)) e.push('weight_invalid');
  if (!(input.sbp >= 70 && input.sbp <= 260)) e.push('needs_bp');
  return e;
}

// ---------- 7. Main entry ----------
/**
 * Returns one of:
 *  { status:'needs_bp'|'needs_equation_set'|'invalid', errors:[...] }            — cannot compute
 *  { status:'out_of_range', ageBand:'under_30'|'over_74', message, recommendation } — no numeric score
 *  { status:'ok', riskPct, band, heartAge:{value,display,capped}, bmi, rawPct, overlay:{...},
 *    southAsianFactor, bestCasePct, levers:[...], recommendation, calc:{order:[...]} }
 */
function assess(input) {
  const errors = validate(input);
  if (errors.length) {
    const status = errors.includes('needs_bp') ? 'needs_bp' : errors.includes('needs_equation_set') ? 'needs_equation_set' : 'invalid';
    return { status, errors, engine: 'ilive-cvd-1.1' };
  }
  const age = Math.round(input.age);
  const bmi = input.weightKg / Math.pow(input.heightCm / 100, 2);
  const base = { age, equationSet: input.equationSet, bmi, sbp: input.sbp, bpTreated: !!input.bpTreated, smoker: !!input.smoker, diabetes: !!input.diabetes };
  const southAsian = input.southAsian !== false; // default true for India deployment

  if (age < 30 || age > 74) {
    const under = age < 30;
    return { status: 'out_of_range', ageBand: under ? 'under_30' : 'over_74', bmi: +bmi.toFixed(1), engine: 'ilive-cvd-1.1',
      message: under ? 'The risk score is validated for ages 30–74. Below 30 your risk is low by age — the habits you keep now decide the next decades.'
                     : 'The risk score is validated for ages 30–74. Above 74, a doctor assesses your heart directly rather than by formula.',
      recommendation: under ? (input.diabetes || input.bpTreated ? 'care' : 'prevent_or_free') : 'heart_screen' };
  }

  // Order of calculation (R5): raw → overlay → South Asian taper → percent → band
  const raw = frsRaw(base);
  const ov = overlayMultiplier(input.overlay, base);
  const adjRaw = clamp(raw * ov.multiplier, 0.0001, 0.95);
  const sa = southAsianFactor(adjRaw, base.equationSet, southAsian);
  const riskPct = clamp(adjRaw * 100 * sa, 0.1, 90);
  const band = bandFor(riskPct);

  // Heart age is computed on the RAW Framingham risk (validated part), not on iLive adjustments.
  const heartAge = heartAgeFor(raw, base.equationSet);

  // Levers — counterfactuals on the same full pipeline
  const pct = (over) => { const r2 = frsRaw({ ...base, ...over }); const a2 = clamp(r2 * ov.multiplier, 0.0001, 0.95); return clamp(a2 * 100 * southAsianFactor(a2, base.equationSet, southAsian), 0.1, 90); };
  const levers = [];
  if (base.smoker) levers.push({ id: 'smoking', label: 'Stop smoking', afterPct: +pct({ smoker: false }).toFixed(1) });
  if (base.sbp > 130) levers.push({ id: 'bp', label: 'Bring systolic BP to 125', afterPct: +pct({ sbp: 125 }).toFixed(1) });
  if (bmi >= 25) levers.push({ id: 'bmi', label: 'Reach a BMI of 23', afterPct: +pct({ bmi: 23 }).toFixed(1) });
  if (base.diabetes) levers.push({ id: 'diabetes', label: 'Well-controlled blood sugar', afterPct: null });
  const bestCasePct = +pct({ smoker: false, sbp: Math.min(base.sbp, 125), bmi: Math.min(bmi, 23) }).toFixed(1);

  const sb = input.stopbang ? stopBang(input.stopbang, base) : null;
  const hasCondition = !!(input.diabetes || input.bpTreated || input.knownHeartDisease || input.highCholesterol);
  const recommendation = hasCondition ? 'care_via_heart_screen' : riskPct >= 10 ? 'heart_screen' : 'prevent_or_free';

  return {
    status: 'ok', engine: 'ilive-cvd-1.1',
    riskPct: +riskPct.toFixed(1), band, heartAge, bmi: +bmi.toFixed(1),
    rawPct: +(raw * 100).toFixed(1),
    overlay: { multiplier: +ov.multiplier.toFixed(3), applied: ov.applied, unknowns: ov.unknowns },
    southAsianFactor: +sa.toFixed(3), southAsianApplied: sa > 1.0005,
    bestCasePct, levers, recommendation,
    stopBang: sb,
    calc: { order: ['framingham_raw', 'overlay_multiplier', 'south_asian_taper', 'percent', 'band'], heartAgeBasis: 'framingham_raw', stopBangSeparate: true },
  };
}

// ---------- exports (CommonJS + ESM + browser global) ----------
const ILiveRisk = { assess, validate, frsRaw, southAsianFactor, overlayMultiplier, bandFor, heartAgeFor, stopBang,
  FRS, OVERLAY, STOPBANG_ITEMS, QUESTIONS, version: '1.1' };
if (typeof module !== 'undefined' && module.exports) module.exports = ILiveRisk;
if (typeof window !== 'undefined') window.ILiveRisk = ILiveRisk;
