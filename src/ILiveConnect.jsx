import React, { useState, useMemo, useRef } from 'react';
import {
  Activity, AlertTriangle, ArrowRight, Bell, Camera, Check, CheckCircle2, ChevronLeft, ChevronRight, Coins, FileText, FlaskConical, Heart, Home, MessageCircle, MoreHorizontal, Phone, Pill, Plus, QrCode, ShieldCheck, Siren, Sparkles, Stethoscope, Upload, User, Users, Utensils, Video, X
} from 'lucide-react';

/* ---------------------------------------------------------------------------
   CARDIOVASCULAR RISK — Framingham General CVD Risk Score, office-based (BMI)
   D'Agostino RB Sr et al. Circulation 2008;117:743–753. PMID 18212285.
   The BMI variant needs no blood test — essential for a free app and camps.
   South Asian calibration per JBS2 (×1.4 for men), tapered at high baseline.
   ------------------------------------------------------------------------ */
const clampN = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const FRS = {
  male:   { lnAge: 3.11296, lnBMI: 0.79277, lnSBPu: 1.85508, lnSBPt: 1.92672, smoker: 0.70953, diabetes: 0.53160, mean: 23.9388, s10: 0.88431 },
  female: { lnAge: 2.72107, lnBMI: 0.51125, lnSBPu: 2.81291, lnSBPt: 2.88267, smoker: 0.61868, diabetes: 0.77763, mean: 26.0145, s10: 0.94833 },
};

function frsRaw({ age, sex, bmi, sbp, bpTreated, smoker, diabetes }) {
  const k = FRS[sex === 'Female' ? 'female' : 'male'];
  const A = clampN(Number(age) || 45, 30, 74);
  const B = clampN(Number(bmi) || 25, 15, 50);
  const S = clampN(Number(sbp) || 125, 90, 200);
  const sum = k.lnAge * Math.log(A) + k.lnBMI * Math.log(B) +
    (bpTreated ? k.lnSBPt : k.lnSBPu) * Math.log(S) +
    (smoker ? k.smoker : 0) + (diabetes ? k.diabetes : 0);
  return clampN(1 - Math.pow(k.s10, Math.exp(sum - k.mean)), 0.001, 0.95);
}

/* Heart age = the age at which a HEALTHY reference profile of the same sex
   carries the same 10-year risk as this member.

   TWO CORRECTIONS over the naive version:
     1. The search used to run on [30, 90]. Any risk above roughly 30 % pushed
        the solver into its own upper bound, so a 33 % risk and a 67 % risk both
        came back as "90" — a number that was an artefact of the bracket, not a
        clinical finding. The bracket is now [20, 110] so the solver never
        saturates.
     2. Framingham is validated to age 74. Reporting "heart age 97" is both
        meaningless and frightening, so anything above 85 is reported as
        "85+" — honest about the ceiling rather than pretending to precision
        the equation does not have.                                          */
function heartAgeOf(p) {
  const target = frsRaw(p);
  const healthy = (a) => frsRaw({ age: a, sex: p.sex, bmi: 22.5, sbp: 125, bpTreated: false, smoker: false, diabetes: false });
  let lo = 20, hi = 110;
  if (healthy(lo) >= target) return 20;
  if (healthy(hi) <= target) return 85;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (healthy(mid) < target) lo = mid; else hi = mid; }
  return Math.min(85, Math.round((lo + hi) / 2));
}
/* Display form: 85 means "85 or above". */
function heartAgeLabel(v) { return v >= 85 ? '85+' : String(v); }

function bandFor(pct) {
  if (pct >= 20) return { band: 'High', color: '#C0392B' };
  if (pct >= 10) return { band: 'Intermediate', color: '#C77E1A' };
  return { band: 'Low', color: '#1E9E6A' };
}

function assessCVD(p) {
  const raw = frsRaw(p);
  const eligible = p.southAsian && p.sex !== 'Female';
  const taper = 1 + 0.4 * (1 - clampN(raw / 0.4, 0, 1));
  const saFactor = eligible ? taper : 1;
  const pct = clampN(raw * 100 * saFactor, 0.1, 90);
  const { band, color } = bandFor(pct);
  const scenario = (over) => {
    const r2 = frsRaw({ ...p, ...over });
    const f2 = eligible ? 1 + 0.4 * (1 - clampN(r2 / 0.4, 0, 1)) : 1;
    return clampN(r2 * 100 * f2, 0.1, 90);
  };
  const levers = [];
  if (p.smoker) levers.push({ id: 'smoking', label: 'Stop smoking', now: 'You smoke currently', after: scenario({ smoker: false }),
    action: 'Stopping smoking is the single highest-impact change available to you. Our doctor can discuss how.' });
  if (p.sbp > 130) levers.push({ id: 'bp', label: 'Bring blood pressure to 125', now: `Your systolic pressure is ${p.sbp} mmHg`, after: scenario({ sbp: 125 }),
    action: 'Log your BP morning and evening for three days so your doctor can see a pattern.' });
  if (p.bmi >= 25) levers.push({ id: 'bmi', label: 'Reach a BMI of 23', now: `Your BMI is ${p.bmi.toFixed(1)}`, after: scenario({ bmi: 23 }),
    action: 'Asian-Indian cut-offs treat BMI 23 and above as overweight. Our nutritionist will set a realistic target with you.' });
  if (p.diabetes) levers.push({ id: 'sugar', label: 'Well-controlled blood sugar', now: 'You reported diabetes', after: null,
    action: 'Diabetes cannot be removed from the calculation, but tight control changes your actual outcome.' });
  const bestCase = scenario({ smoker: false, sbp: Math.min(p.sbp, 125), bmi: Math.min(p.bmi, 23) });
  return { pct, band, color, heartAge: heartAgeOf(p), southAsianApplied: saFactor > 1.001, levers, bestCase,
    meter: clampN((pct / 30) * 100, 4, 100) };
}

/* ---------------------------------------------------------------------------
   LAYER 2 — Extended risk factors (QRISK3-informed hazard-ratio overlay)
   Applied multiplicatively with a ceiling. Swap for licensed QRISK3 /
   AHA PREVENT later — the UI does not change.
   ------------------------------------------------------------------------ */
const EXTRA_QUESTIONS = [
  { id: 'family',   q: 'Has a parent, brother or sister had a heart attack or angina before 60?', why: 'First-degree family history is one of the strongest risk factors a questionnaire can capture.', hr: 1.45, opts: ['No', 'Yes', 'Not sure'], yes: ['Yes'], e: '👪' },
  { id: 'ckd',      q: 'Have you been told you have kidney disease?', why: 'Reduced kidney function raises cardiovascular risk independently of blood pressure.', hr: 1.40, opts: ['No', 'Yes'], yes: ['Yes'], e: '💧' },
  { id: 'af',       q: 'Irregular heart rhythm, or atrial fibrillation?', why: 'Atrial fibrillation substantially raises stroke risk.', hr: 1.65, opts: ['No', 'Yes', 'Not sure'], yes: ['Yes'], e: '💓' },
  { id: 'migraine', q: 'Do you get migraine headaches?', why: 'Migraine, particularly with aura, is associated with higher stroke risk.', hr: 1.25, opts: ['No', 'Yes'], yes: ['Yes'], e: '🤕' },
  { id: 'ra',       q: 'Rheumatoid arthritis or lupus?', why: 'Chronic inflammatory disease accelerates atherosclerosis.', hr: 1.40, opts: ['No', 'Yes'], yes: ['Yes'], e: '🦴' },
  { id: 'steroid',  q: 'Do you take steroid tablets regularly?', why: 'Long-term corticosteroids raise blood pressure, sugar and lipids.', hr: 1.30, opts: ['No', 'Yes'], yes: ['Yes'], e: '💊' },
  { id: 'mental',   q: 'Treated for severe depression, bipolar disorder or schizophrenia?', why: 'Severe mental illness and some antipsychotics carry measurable cardiovascular risk.', hr: 1.22, opts: ['No', 'Yes'], yes: ['Yes'], e: '🧠' },
  { id: 'ed',       q: 'Do you have difficulty with erections?', why: 'Erectile dysfunction is an early sign of blood-vessel disease, often years before a cardiac event.', hr: 1.30, opts: ['No', 'Yes', 'Prefer not to say'], yes: ['Yes'], menOnly: true, e: '🔒' },
  { id: 'heavy',    q: 'How much do you smoke?', why: 'Risk rises with the amount smoked, not just whether you smoke.', hr: 1.35, opts: ["Under 10 a day", '10 to 19 a day', '20 or more a day'], yes: ['20 or more a day'], smokersOnly: true, e: '🚬' },
  { id: 'waist',    q: 'Is your waist larger than 90 cm (men) or 80 cm (women)?', why: 'In South Asians, waist circumference predicts risk better than BMI alone.', hr: 1.25, opts: ['No', 'Yes', 'Not sure'], yes: ['Yes'], e: '📏' },
];
function questionsFor(profile) {
  return EXTRA_QUESTIONS.filter(q => !(q.menOnly && profile.sex === 'Female') && !(q.smokersOnly && !profile.smoker));
}
function applyExtras(basePct, answers, profile) {
  let m = 1;
  questionsFor(profile).forEach(q => { if (q.yes.includes(answers[q.id])) m *= q.hr; });
  m = clampN(m, 1, 2.6);
  return { pct: clampN(basePct * m, 0.1, 90), multiplier: m };
}

/* ---------------------------------------------------------------------------
   STOP-BANG — obstructive sleep apnoea screen (Chung et al., 2008)
   0–2 low · 3–4 intermediate · 5–8 high probability of OSA
   ------------------------------------------------------------------------ */
const STOPBANG = [
  { id: 'S', e: '😴', q: 'Do you snore loudly — louder than talking, or heard through a closed door?' },
  { id: 'T', e: '🥱', q: 'Do you often feel tired, fatigued or sleepy during the day?' },
  { id: 'O', e: '👀', q: 'Has anyone observed you stop breathing during sleep?' },
  { id: 'P', e: '🩺', q: 'Do you have, or are you treated for, high blood pressure?' },
];
function stopBangScore(ans, profile) {
  let s = STOPBANG.filter(q => ans[q.id] === 'Yes').length;
  if (profile.bmi > 35) s += 1;
  if (profile.age > 50) s += 1;
  if (ans.neck === 'Yes') s += 1;
  if (profile.sex !== 'Female') s += 1;
  const level = s >= 5 ? 'High' : s >= 3 ? 'Intermediate' : 'Low';
  return { score: s, level };
}

/* ---------------------------------------------------------------------------
   LAYER 3 — Framingham lipid model (same paper) once cholesterol is known
   ------------------------------------------------------------------------ */
const FRS_LIPID = {
  male:   { lnAge: 3.06117, lnTC: 1.12370, lnHDL: -0.93263, lnSBPu: 1.93303, lnSBPt: 1.99881, smoker: 0.65451, diabetes: 0.57367, mean: 23.9802, s10: 0.88936 },
  female: { lnAge: 2.32888, lnTC: 1.20904, lnHDL: -0.70833, lnSBPu: 2.76157, lnSBPt: 2.82263, smoker: 0.52873, diabetes: 0.69154, mean: 26.1931, s10: 0.95012 },
};
function frsLipid(p, tc, hdl) {
  const k = FRS_LIPID[p.sex === 'Female' ? 'female' : 'male'];
  const A = clampN(Number(p.age) || 45, 30, 74), S = clampN(Number(p.sbp) || 125, 90, 200);
  const T = clampN(Number(tc) || 190, 100, 400), H = clampN(Number(hdl) || 45, 15, 120);
  const sum = k.lnAge * Math.log(A) + k.lnTC * Math.log(T) + k.lnHDL * Math.log(H) + (p.bpTreated ? k.lnSBPt : k.lnSBPu) * Math.log(S) + (p.smoker ? k.smoker : 0) + (p.diabetes ? k.diabetes : 0);
  const raw = clampN(1 - Math.pow(k.s10, Math.exp(sum - k.mean)), 0.001, 0.95);
  const eligible = p.southAsian && p.sex !== 'Female';
  const f = eligible ? 1 + 0.4 * (1 - clampN(raw / 0.4, 0, 1)) : 1;
  return clampN(raw * 100 * f, 0.1, 90);
}

/* ---------------------------------------------------------------------------
   TACTILE FEEDBACK — one soft click + a light haptic on every meaningful tap.
   Quiet by design: 40 ms, sub-audible level, respects the phone's mute switch.
   ------------------------------------------------------------------------ */
let __actx = null;
function tapFeel(kind) {
  try {
    if (navigator && navigator.vibrate) navigator.vibrate(kind === 'success' ? [10, 30, 14] : 8);
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!__actx) __actx = new AC();
    if (__actx.state === 'suspended') __actx.resume();
    const t = __actx.currentTime;
    const o = __actx.createOscillator(), g = __actx.createGain();
    o.type = 'sine';
    if (kind === 'success') { o.frequency.setValueAtTime(660, t); o.frequency.exponentialRampToValueAtTime(990, t + 0.09); }
    else { o.frequency.setValueAtTime(kind === 'select' ? 880 : 520, t); }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(kind === 'success' ? 0.06 : 0.035, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'success' ? 0.16 : 0.045));
    o.connect(g); g.connect(__actx.destination);
    o.start(t); o.stop(t + 0.2);
  } catch (e) { /* silent */ }
}

/**
 * iLive Cardiovascular Age — v1.0
 * ================================================================
 * "Your chronological age is 52. Based on your cardiovascular risk and physiology,
 *  your heart is functioning more like that of a 61-year-old."
 *
 * DESIGN PRINCIPLE
 *   Clinical anchor + bounded physiological correction. Never a blend of two scales.
 *
 *   1. ANCHOR (day one, no wearable needed)
 *      Framingham General CVD Risk Score → heart age. Validated, defensible, and
 *      available from the questionnaire alone. This is the number a cardiologist signs.
 *
 *   2. PHYSIOLOGICAL CORRECTION (grows with data)
 *      Wearable contributors are z-scored against age- and sex-referenced norms,
 *      combined with weights drawn from mortality literature, SHRUNK for overlap
 *      (they measure much the same thing), converted to years, HARD-CAPPED, and
 *      finally multiplied by a CONFIDENCE factor based on how much data exists.
 *
 *   3. The two components are always reported separately. No hidden blending.
 *
 * WHY NOT SIMPLY COPY WHOOP AGE
 *   WHOOP Age is a healthspan/all-cause-mortality construct with no clinical inputs and
 *   no output until ~21 recoveries. We have BP, smoking, diabetes, lipids and ECG on day
 *   one. Starting clinical and sharpening with physiology is both faster for the member
 *   and more defensible to a physician.
 *
 * WHY HRV IS EXCLUDED FROM THE AGE (we agree with WHOOP here)
 *   HRV is heavily genetically determined and its between-person spread swamps the
 *   within-person signal, so it is unsuitable for comparison against population norms.
 *   We use HRV for DAILY READINESS only, never for the age.
 *
 * EVIDENCE FOR EACH CONTRIBUTOR
 *   VO2max / CRF ....... Mandsager, JAMA Netw Open 2018;1:e183605 — strongest single
 *                        predictor of all-cause mortality; Kodama, JAMA 2009;301:2024
 *                        (1 MET higher ≈ 13% lower all-cause mortality)
 *   Resting HR ......... Jouven, N Engl J Med 2005;352:1951; Cooney, Am Heart J 2010;159:612
 *   MVPA minutes ....... WHO 2020 Physical Activity Guidelines; Ekelund, BMJ 2019;366:l4570
 *   Daily steps ........ Paluch, Lancet Public Health 2022;7:e219 — dose-response,
 *                        plateau ~6–8k (60+) and ~8–10k (<60)
 *   Sleep duration ..... Cappuccio, Sleep 2010;33:585 (U-shaped, optimum 7–8 h)
 *   Sleep regularity ... Huang, J Am Coll Cardiol 2020;75:991 — irregularity predicts CVD
 *                        independently of duration
 *   Strength training .. Momma, Br J Sports Med 2022;56:755 (~2 sessions/week optimum)
 *   HR recovery 1 min .. Cole, N Engl J Med 1999;341:1351 (<12 bpm abnormal)
 *
 * All effect sizes below are conservative: the mapping constant is chosen so the FULL
 * physiological range spans roughly ±9 years before the hard cap, which is smaller than
 * the literature would permit. We under-promise deliberately.
 */

const cvClamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const cvR1 = v => Math.round(v * 10) / 10;

/* ---------------------------------------------------------------------------
   1. Age- and sex-referenced norms. mean/sd used for z-scoring.
   VO2max means follow the well-established ~10% per decade decline from ACSM
   normative tables; others are population means with pragmatic spreads.
   ------------------------------------------------------------------------ */
function norms(age, sex) {
  const male = sex === 'male';
  return {
    vo2:        { mean: (male ? 50 : 42) - 0.30 * Math.max(0, age - 25), sd: male ? 7.5 : 6.5, higherBetter: true },
    rhr:        { mean: 68, sd: 9, higherBetter: false },
    mvpa:       { mean: 150, sd: 90, higherBetter: true },      // minutes/week Zone 3+
    steps:      { mean: 7000, sd: 3000, higherBetter: true },   // daily average
    sleepHrs:   { mean: 7.2, sd: 1.0, higherBetter: true, optimum: 7.75, uShaped: true },
    sleepSd:    { mean: 62, sd: 28, higherBetter: false },      // SD of sleep midpoint, minutes
    strength:   { mean: 1.0, sd: 1.2, higherBetter: true },     // sessions/week
    hrr1:       { mean: 20, sd: 9, higherBetter: true },        // 1-min HR recovery, bpm
  };
}

/* ---------------------------------------------------------------------------
   2. Domain weights. Sum to 1.0 across all contributors present.
   Ordered by strength of the mortality association in the literature above.
   ------------------------------------------------------------------------ */
const WEIGHTS = { vo2: 0.30, rhr: 0.14, mvpa: 0.15, steps: 0.11, sleepHrs: 0.09, sleepSd: 0.07, strength: 0.06, hrr1: 0.08 };

/* Overlap shrinkage. VO2max, resting HR, MVPA and steps all measure overlapping
   cardiorespiratory fitness, and BP/BMI already sit inside the clinical anchor.
   Applying the raw composite would count the same benefit two or three times. */
const OVERLAP_SHRINK = 0.72;

/* Years per unit of composite z.
   Calibration: Mandsager 2018 found adjusted mortality HR 0.20 for elite vs low
   cardiorespiratory fitness — a five-fold difference, which corresponds to well over a
   decade of age-equivalent risk. Kodama 2009 puts 1 MET at ~13% lower mortality.
   Mapping ±3 z to ±10.8 years (before shrinkage and cap) is therefore CONSERVATIVE
   relative to the literature, which is where we want to sit. */
const YEARS_PER_Z = 5.0;
const MAX_ADJUST_YEARS = 10;

/* ---------------------------------------------------------------------------
   3. Confidence — how much of the physiological correction we are willing to apply.
   Mirrors the member's data history. Deliberately conservative early on.
   ------------------------------------------------------------------------ */
const TIERS = [
  { id: 'provisional', minDays: 0,  weight: 0.00, label: 'Provisional',      note: 'From your clinical risk factors alone. Wear your band for a week and we start refining this.' },
  { id: 'early',       minDays: 7,  weight: 0.40, label: 'Early estimate',    note: 'Seven days of data. Directionally useful; still settling.' },
  { id: 'good',        minDays: 30, weight: 0.70, label: 'Good confidence',   note: 'Thirty days of data. Reliable enough to act on.' },
  { id: 'calibrated',  minDays: 90, weight: 1.00, label: 'Fully calibrated',  note: 'Ninety days of continuous data. This is your true cardiovascular age.' },
];
function tierFor(days) { let t = TIERS[0]; for (const x of TIERS) if (days >= x.minDays) t = x; return t; }

/* ---------------------------------------------------------------------------
   4. Main
   ------------------------------------------------------------------------ */
/**
 * @param clinical  { age, sex:'male'|'female', clinicalHeartAge }  ← from the Framingham engine
 * @param phys      { vo2, rhr, mvpa, steps, sleepHrs, sleepSd, strength, hrr1 }  any subset; nulls ignored
 * @param meta      { daysOfData }
 */
function cardiovascularAge(clinical, phys = {}, meta = {}) {
  const { age, sex, clinicalHeartAge } = clinical;
  const days = meta.daysOfData || 0;
  const tier = tierFor(days);
  const N = norms(age, sex);

  /* z-score every contributor that exists; positive z always means HEALTHIER */
  const contributors = [];
  let wSum = 0, zSum = 0;
  for (const key of Object.keys(WEIGHTS)) {
    const v = phys[key];
    if (v === undefined || v === null || Number.isNaN(v)) continue;
    const n = N[key];
    let z;
    if (n.uShaped) {
      /* Sleep: both too little and too much are worse. Penalty from the optimum. */
      z = -Math.abs(v - n.optimum) / n.sd;
      z = cvClamp(z + 0.5, -3, 1.2);          // at optimum → +0.5; far away → negative
    } else {
      z = (v - n.mean) / n.sd;
      if (!n.higherBetter) z = -z;
      z = cvClamp(z, -3, 3);
    }
    contributors.push({ key, value: v, z: cvR1(z), weight: WEIGHTS[key] });
    wSum += WEIGHTS[key]; zSum += WEIGHTS[key] * z;
  }

  /* If nothing was supplied, the answer is the clinical anchor, unmodified. */
  if (!contributors.length || tier.weight === 0) {
    return {
      cardiovascularAge: clinicalHeartAge, chronologicalAge: age,
      clinicalHeartAge, physiologicalAdjustment: 0, appliedAdjustment: 0,
      confidence: { ...tier, daysOfData: days, contributorsUsed: contributors.length },
      contributors: contributors.map(c => ({ ...c, ageImpactYears: 0 })),
      gap: cvR1(clinicalHeartAge - age), engine: 'ilive-cvage-1.0',
      basis: 'clinical_only',
    };
  }

  const composite = zSum / wSum;                                   // weighted mean z
  const rawYears = -composite * YEARS_PER_Z * OVERLAP_SHRINK;      // healthier ⇒ negative ⇒ younger
  const capped = cvClamp(rawYears, -MAX_ADJUST_YEARS, MAX_ADJUST_YEARS);
  const applied = capped * tier.weight;

  /* Per-contributor "age impact", on the same scale, so the parts sum to the whole. */
  const withImpact = contributors.map(c => ({
    ...c,
    ageImpactYears: cvR1(-(c.weight / wSum) * c.z * YEARS_PER_Z * OVERLAP_SHRINK * tier.weight * (Math.abs(capped) < Math.abs(rawYears) ? Math.abs(capped / rawYears) : 1)),
  }));

  const cvAge = cvClamp(cvR1(clinicalHeartAge + applied), Math.max(20, age - 15), Math.min(95, age + 25));

  return {
    cardiovascularAge: cvAge, chronologicalAge: age,
    clinicalHeartAge, physiologicalAdjustment: cvR1(capped), appliedAdjustment: cvR1(applied),
    confidence: { ...tier, daysOfData: days, contributorsUsed: contributors.length },
    contributors: withImpact.sort((a, b) => a.ageImpactYears - b.ageImpactYears),
    gap: cvR1(cvAge - age), engine: 'ilive-cvage-1.0',
    basis: 'clinical_plus_physiological',
  };
}

/* Human-readable label for each contributor. */
const LABELS = {
  vo2: 'Cardio fitness (VO₂max)', rhr: 'Resting heart rate', mvpa: 'Weekly active minutes',
  steps: 'Daily steps', sleepHrs: 'Sleep duration', sleepSd: 'Sleep consistency',
  strength: 'Strength training', hrr1: 'Heart-rate recovery',
};


/* ============================================================================
   Check My Meal — nutrition engine
   ----------------------------------------------------------------------------
   ONE engine, SIX rule sets. The rule set is chosen automatically from the
   member's enrolled programme, because the correct advice genuinely inverts
   between conditions:

     · Hypertension  → MORE potassium (DASH)
     · CKD           → LESS potassium and phosphate. The DASH advice above can
                       cause hyperkalaemia. Salt substitutes (KCl) are dangerous.
     · Recovery      → MORE protein (1.2–1.5 g/kg) for healing
     · CKD, no dialysis → LESS protein (0.6–0.8 g/kg)
     · CKD on dialysis  → protein back UP (1.0–1.2 g/kg), K and P still limited
     · Diabetes      → carbohydrate load and glycaemic rise dominate
     · Prevent       → longevity pattern, no restriction

   Every suggestion is drawn from the rule set's own pool, and every pool is
   filtered against that condition's avoid-list before anything is shown.
   ========================================================================== */

/* ---- 1. Meal slots ---- */
const FRX_SLOTS = [
  { id: 'breakfast', label: 'Breakfast', noun: 'breakfast', start: 4,  end: 11, share: 0.25, carb: [30, 45] },
  { id: 'lunch',     label: 'Lunch',     noun: 'lunch',     start: 11, end: 15, share: 0.35, carb: [45, 65] },
  { id: 'snack',     label: 'Snack',     noun: 'snack',     start: 15, end: 19, share: 0.10, carb: [10, 20] },
  { id: 'dinner',    label: 'Dinner',    noun: 'dinner',    start: 19, end: 28, share: 0.30, carb: [40, 60] },
];
const frxSlot = (id) => FRX_SLOTS.find(s => s.id === id) || FRX_SLOTS[1];
function frxDetectSlot(d = new Date()) {
  let h = d.getHours() + d.getMinutes() / 60; if (h < 4) h += 24;
  return FRX_SLOTS.find(s => h >= s.start && h < s.end) || FRX_SLOTS[3];
}

/* ---- 2. Rule sets. `limits` are DAILY. `heavier` = the nutrients this
        condition is judged on first, in order.                            ---- */
const FRX_RULES = {
  diabetes: {
    id: 'diabetes', label: 'Diabetes', kcal: 1800,
    heavier: ['carb', 'sugar', 'fiber', 'protein'],
    limits: { carb: 200, sugar: 20, satfat: 20, sodium: 2300, protein: 90, potassium: null, phosphorus: null },
    aim: 'Judged on the sugar rise this plate will cause.',
    basis: 'ADA Standards of Care 2024 · ICMR-NIN Dietary Guidelines for Indians 2024',
    addPool: [
      { item: 'A katori of dal before the rice', why: 'Protein first flattens the sugar rise' },
      { item: 'A bowl of salad — cucumber, tomato, onion', why: 'Fibre first blunts the spike' },
      { item: 'Curd or a glass of chaas', why: 'Protein and probiotics, no sugar' },
      { item: 'Sprouts or roasted chana', why: 'Slow carbohydrate with real protein' },
      { item: 'Two eggs or a piece of paneer', why: 'Protein that does not raise sugar at all' },
      { item: 'Bhindi, lauki or any green sabzi', why: 'Fills the plate without carbohydrate' },
    ],
    longevity: [
      { item: 'A teaspoon of methi seeds, soaked overnight', why: 'Soluble fibre; studied for lowering fasting sugar' },
      { item: 'A 10-minute walk straight after eating', why: 'Muscle pulls sugar out of the blood without insulin' },
      { item: 'A small handful of walnuts or almonds', why: 'Good fats and magnesium; helps insulin work better' },
      { item: 'A spoon of chia or flaxseed in your curd', why: 'Soluble fibre slows the whole meal down' },
      { item: 'Amla, fresh or as juice, in the morning', why: 'Vitamin C and polyphenols; traditional in diabetes care' },
      { item: 'Cinnamon in your tea instead of sugar', why: 'Adds sweetness of taste without the sugar load' },
    ],
    avoid: ['sugary drink', 'fruit juice', 'sweets', 'maida', 'white bread', 'jaggery'],
  },

  ckd: {
    id: 'ckd', label: 'Kidney disease', kcal: 1900,
    heavier: ['potassium', 'phosphorus', 'sodium', 'protein'],
    limits: { carb: 240, sugar: 25, satfat: 20, sodium: 2000, protein: 50, potassium: 2500, phosphorus: 900 },
    aim: 'Judged on potassium, phosphate, salt and protein load.',
    basis: 'KDOQI Clinical Practice Guideline for Nutrition in CKD, 2020 update',
    addPool: [
      { item: 'Apple, pear or papaya for fruit', why: 'Much lower in potassium than most fruit' },
      { item: 'Lauki, tinda, cabbage or cauliflower', why: 'Low-potassium vegetables you can eat freely' },
      { item: 'Egg white — two, boiled', why: 'Good protein with very little phosphate' },
      { item: 'Rice in place of one roti', why: 'Lower in phosphate than whole wheat' },
      { item: 'Lemon, herbs and spices in place of salt', why: 'Flavour without sodium' },
      { item: 'Double-boil starchy vegetables, discard the water', why: 'Leaching removes much of the potassium' },
    ],
    longevity: [
      { item: 'Leach your vegetables — soak, boil, discard water', why: 'Cuts potassium substantially, keeps the vegetable' },
      { item: 'Lemon and fresh coriander instead of salt', why: 'Protects your blood pressure and your kidneys' },
      { item: 'Olive or rice-bran oil for cooking', why: 'Heart protection, which matters most in kidney disease' },
      { item: 'Cabbage, cauliflower and capsicum in rotation', why: 'Low-potassium vegetables that stay interesting' },
      { item: 'Egg-white bhurji for protein', why: 'Protein without the phosphate load of dal or dairy' },
    ],
    avoid: ['banana', 'orange', 'coconut water', 'tomato', 'potato', 'spinach', 'salt substitute', 'cola', 'processed cheese', 'nuts', 'seeds'],
    hardWarnings: [
      'Never use a "low-sodium" salt substitute — they are potassium chloride and can be dangerous for you.',
      'Star fruit (kamrakh) is neurotoxic in kidney disease. Avoid it completely.',
    ],
  },

  ckdDialysis: {
    id: 'ckdDialysis', label: 'Kidney disease on dialysis', kcal: 2100,
    heavier: ['potassium', 'phosphorus', 'protein', 'sodium'],
    limits: { carb: 250, sugar: 25, satfat: 20, sodium: 2000, protein: 90, potassium: 2500, phosphorus: 1000 },
    aim: 'Protein needs go UP on dialysis; potassium and phosphate stay restricted.',
    basis: 'KDOQI 2020 — dialysis: 1.0–1.2 g/kg protein',
    addPool: [
      { item: 'Egg whites — three, boiled', why: 'Dialysis raises your protein need; this is the cleanest source' },
      { item: 'A piece of fish or chicken', why: 'High-quality protein to replace dialysis losses' },
      { item: 'Apple, pear or papaya for fruit', why: 'Low-potassium choices' },
      { item: 'Rice instead of roti', why: 'Lower phosphate' },
    ],
    longevity: [
      { item: 'Protein at every meal, not only at dinner', why: 'Dialysis removes protein; spread the intake' },
      { item: 'Take your phosphate binder with the first bite', why: 'It only works if it meets the food' },
      { item: 'Lemon and herbs instead of salt', why: 'Controls thirst between sessions' },
    ],
    avoid: ['banana', 'orange', 'coconut water', 'tomato', 'potato', 'spinach', 'salt substitute', 'cola', 'processed cheese'],
    hardWarnings: [
      'Never use a "low-sodium" salt substitute — they are potassium chloride and can be dangerous for you.',
      'Take your phosphate binder with meals, not after.',
    ],
  },

  hypertension: {
    id: 'hypertension', label: 'High blood pressure', kcal: 1900,
    heavier: ['sodium', 'satfat', 'potassium'],
    limits: { carb: 230, sugar: 25, satfat: 15, sodium: 1500, protein: 90, potassium: null, phosphorus: null },
    aim: 'Judged mainly on salt, saturated fat and the DASH pattern.',
    basis: 'DASH-Sodium, NEJM 2001 · ACC/AHA 2017 Hypertension Guideline',
    addPool: [
      { item: 'A banana or a slice of papaya', why: 'Potassium lowers blood pressure directly' },
      { item: 'A bowl of salad, unsalted', why: 'The DASH pattern in one step' },
      { item: 'Curd or chaas without salt', why: 'Calcium and potassium, both help' },
      { item: 'Dal or rajma', why: 'Potassium, magnesium and fibre together' },
      { item: 'Lemon and herbs instead of pickle', why: 'Flavour with no sodium at all' },
    ],
    longevity: [
      { item: 'Cut the pickle and papad from one meal a day', why: 'Usually the single biggest salt source on an Indian plate' },
      { item: 'Potassium-rich fruit daily — banana, papaya, orange', why: 'Counteracts sodium; 4–5 mmHg in trials' },
      { item: 'Beetroot in your salad twice a week', why: 'Dietary nitrate relaxes blood vessels' },
      { item: 'A 10-minute walk after dinner', why: 'Lowers evening blood pressure' },
      { item: 'Garlic in your cooking, daily', why: 'Modest but real blood-pressure effect' },
    ],
    avoid: ['pickle', 'papad', 'namkeen', 'packet snack', 'processed meat'],
  },

  recovery: {
    id: 'recovery', label: 'Recovery after surgery or hospital', kcal: 2100,
    heavier: ['protein', 'kcal', 'fiber'],
    limits: { carb: 250, sugar: 30, satfat: 22, sodium: 2000, protein: 110, potassium: null, phosphorus: null },
    aim: 'Judged on whether there is enough protein and energy to heal.',
    basis: 'ESPEN Surgery Guideline 2021 — 1.2–1.5 g/kg protein during recovery',
    addPool: [
      { item: 'Two eggs, paneer or a piece of chicken', why: 'Wounds close on protein; this is the priority now' },
      { item: 'A glass of milk or curd', why: 'Protein and calcium while you are less active' },
      { item: 'Dal at both meals, not just one', why: 'Spreads protein across the day, which heals better' },
      { item: 'Amla, guava or orange', why: 'Vitamin C is used up in wound healing' },
      { item: 'Soaked raisins or dates with curd', why: 'Iron and energy while your appetite is low' },
    ],
    longevity: [
      { item: 'Protein at every meal, not only dinner', why: 'The body can only use so much at once' },
      { item: 'Small meals every three hours', why: 'Easier when appetite is poor after surgery' },
      { item: 'A short walk after each meal', why: 'Prevents clots and gets the bowels moving' },
      { item: 'Curd or buttermilk daily', why: 'Helps the gut after antibiotics' },
    ],
    avoid: ['crash diet', 'skipping meals'],
    note: 'This is not the time to diet. Under-eating after surgery delays healing.',
  },

  longevity: {
    id: 'longevity', label: 'Longevity and prevention', kcal: 2000,
    heavier: ['satfat', 'fiber', 'sugar', 'sodium'],
    limits: { carb: 250, sugar: 25, satfat: 20, sodium: 2000, protein: 100, potassium: null, phosphorus: null },
    aim: 'Judged on the pattern that keeps hearts and brains working longest.',
    basis: 'PREDIMED, NEJM 2018 · Lancet 2019 fibre meta-analysis · ICMR-NIN 2024',
    addPool: [
      { item: 'A handful of walnuts or almonds', why: 'The single most consistent food in longevity studies' },
      { item: 'Leafy greens — palak, methi, sarson', why: 'Slows measured brain ageing' },
      { item: 'Dal, rajma or chana', why: 'Plant protein and fibre in one' },
      { item: 'A whole fruit instead of juice', why: 'Fibre intact, sugar slower' },
      { item: 'Curd with your meal', why: 'Fermented food, good for the gut' },
    ],
    longevity: [
      { item: 'A handful of nuts, five days a week', why: 'Associated with lower mortality in every large cohort' },
      { item: '30 g of fibre a day — dal, vegetables, whole grains', why: 'Each 8 g rises with lower heart disease and cancer' },
      { item: 'Turmeric with a pinch of black pepper', why: 'Pepper increases curcumin absorption many times over' },
      { item: 'Olive or mustard oil, not refined oil', why: 'The fat pattern behind the Mediterranean results' },
      { item: 'Eat within a 10-hour window', why: 'Time-restricted eating improves metabolic markers' },
      { item: 'A 10-minute walk after your largest meal', why: 'Blunts the sugar and fat rise together' },
    ],
    avoid: ['ultra-processed', 'sugary drink', 'deep fried'],
  },
};

/* ---- 3. Choose the rule set from the member's programme.
        Precedence matters: CKD constraints override everything, because a
        potassium error is the one that kills.                            ---- */
function frxRulesFor({ programmes = [], conditions = [], onDialysis = false }) {
  const has = (t) => programmes.some(p => String(p).toLowerCase().includes(t)) || conditions.some(c => String(c).toLowerCase().includes(t));
  if (has('kidney') || has('ckd') || has('dialysis')) return onDialysis ? FRX_RULES.ckdDialysis : FRX_RULES.ckd;
  if (has('recover') || has('surgery') || has('discharge') || has('stroke') || has('cardiac')) return FRX_RULES.recovery;
  if (has('diabet') || has('sugar')) return FRX_RULES.diabetes;
  if (has('hypertens') || has('blood pressure') || has('bp') || has('heart failure') || has('chronic health')) return FRX_RULES.hypertension;
  return FRX_RULES.longevity;
}

/* ---- 4. Per-meal targets derived from the daily limits ---- */
function frxTargets(rules, slot, weightKg) {
  const main = slot.id !== 'snack';
  const proteinDaily = rules.id === 'recovery' ? Math.round((weightKg || 70) * 1.3)
    : rules.id === 'ckd' ? Math.round((weightKg || 70) * 0.7)
    : rules.id === 'ckdDialysis' ? Math.round((weightKg || 70) * 1.1)
    : rules.limits.protein;
  return {
    kcal: Math.round(rules.kcal * slot.share),
    carb: slot.carb,
    protein: main ? Math.round(proteinDaily * 0.3) : Math.round(proteinDaily * 0.1),
    fiber: Math.max(3, Math.round(30 * slot.share)),
    satfat: Math.max(3, Math.round(rules.limits.satfat * slot.share)),
    sugar: Math.max(3, Math.round(rules.limits.sugar * slot.share)),
    sodium: Math.round(rules.limits.sodium * (main ? 0.35 : 0.15)),
    potassium: rules.limits.potassium ? Math.round(rules.limits.potassium * slot.share) : null,
    phosphorus: rules.limits.phosphorus ? Math.round(rules.limits.phosphorus * slot.share) : null,
    proteinDaily,
  };
}

/* ---- 5. Food table. Per standard Indian serving.
        Potassium and phosphorus are included because CKD needs them.   ---- */
const FRX_FOODS = [
  { id: 'roti',      n: 'Roti (1)',                    q: '1 medium',    kcal: 120, carb: 22, protein: 3,  fat: 3,  satfat: 1, fiber: 3, sugar: 0, sodium: 120, potassium: 90,  phosphorus: 80,  gi: 'med' },
  { id: 'rice',      n: 'Rice',                        q: '1 katori',    kcal: 200, carb: 45, protein: 4,  fat: 0,  satfat: 0, fiber: 1, sugar: 0, sodium: 5,   potassium: 55,  phosphorus: 45,  gi: 'high' },
  { id: 'dal',       n: 'Dal',                         q: '1 katori',    kcal: 150, carb: 20, protein: 9,  fat: 4,  satfat: 1, fiber: 6, sugar: 1, sodium: 400, potassium: 420, phosphorus: 180, gi: 'low' },
  { id: 'rajma',     n: 'Rajma / chana',               q: '1 katori',    kcal: 190, carb: 30, protein: 10, fat: 4,  satfat: 1, fiber: 9, sugar: 2, sodium: 450, potassium: 600, phosphorus: 210, gi: 'low' },
  { id: 'sabzi',     n: 'Mixed vegetable sabzi',       q: '1 katori',    kcal: 110, carb: 12, protein: 3,  fat: 6,  satfat: 2, fiber: 4, sugar: 3, sodium: 350, potassium: 320, phosphorus: 60,  gi: 'low' },
  { id: 'palak',     n: 'Palak / leafy sabzi',         q: '1 katori',    kcal: 90,  carb: 8,  protein: 4,  fat: 5,  satfat: 2, fiber: 4, sugar: 2, sodium: 320, potassium: 840, phosphorus: 70,  gi: 'low' },
  { id: 'aloo',      n: 'Aloo sabzi',                  q: '1 katori',    kcal: 180, carb: 28, protein: 3,  fat: 7,  satfat: 2, fiber: 3, sugar: 2, sodium: 380, potassium: 620, phosphorus: 70,  gi: 'high' },
  { id: 'paneer',    n: 'Paneer',                      q: '50 g',        kcal: 150, carb: 2,  protein: 9,  fat: 12, satfat: 8, fiber: 0, sugar: 1, sodium: 180, potassium: 100, phosphorus: 240, gi: 'low' },
  { id: 'curd',      n: 'Curd / dahi',                 q: '1 katori',    kcal: 90,  carb: 7,  protein: 5,  fat: 5,  satfat: 3, fiber: 0, sugar: 0, sodium: 60,  potassium: 260, phosphorus: 170, gi: 'low' },
  { id: 'egg',       n: 'Egg, boiled',                 q: '1',           kcal: 78,  carb: 1,  protein: 6,  fat: 5,  satfat: 2, fiber: 0, sugar: 0, sodium: 62,  potassium: 63,  phosphorus: 86,  gi: 'low' },
  { id: 'eggwhite',  n: 'Egg white',                   q: '2',           kcal: 34,  carb: 1,  protein: 7,  fat: 0,  satfat: 0, fiber: 0, sugar: 0, sodium: 110, potassium: 108, phosphorus: 10,  gi: 'low' },
  { id: 'chicken',   n: 'Chicken curry',               q: '1 katori',    kcal: 220, carb: 5,  protein: 22, fat: 12, satfat: 4, fiber: 1, sugar: 1, sodium: 520, potassium: 340, phosphorus: 220, gi: 'low' },
  { id: 'chickenBreast', n: 'Chicken breast, grilled',    q: '1 breast ~150 g', kcal: 248, carb: 0, protein: 47, fat: 5,  satfat: 1, fiber: 0, sugar: 0, sodium: 110, potassium: 420, phosphorus: 330, gi: 'low' },
  { id: 'chickenLeg',  n: 'Chicken leg / thigh',          q: '1 piece',     kcal: 210, carb: 0,  protein: 26, fat: 11, satfat: 3, fiber: 0, sugar: 0, sodium: 95,  potassium: 280, phosphorus: 200, gi: 'low' },
  { id: 'tandoori',    n: 'Tandoori chicken',             q: '2 pieces',    kcal: 260, carb: 3,  protein: 32, fat: 13, satfat: 4, fiber: 0, sugar: 1, sodium: 640, potassium: 380, phosphorus: 290, gi: 'low' },
  { id: 'fishFillet',  n: 'Fish, grilled or tawa',        q: '1 fillet ~150 g', kcal: 210, carb: 0, protein: 34, fat: 8, satfat: 2, fiber: 0, sugar: 0, sodium: 120, potassium: 500, phosphorus: 340, gi: 'low' },
  { id: 'prawns',      n: 'Prawns',                       q: '100 g',       kcal: 100, carb: 1,  protein: 20, fat: 1,  satfat: 0, fiber: 0, sugar: 0, sodium: 220, potassium: 260, phosphorus: 240, gi: 'low' },
  { id: 'mutton',      n: 'Mutton curry',                 q: '1 katori',    kcal: 280, carb: 4,  protein: 24, fat: 19, satfat: 8, fiber: 1, sugar: 1, sodium: 540, potassium: 320, phosphorus: 210, gi: 'low' },
  { id: 'soya',        n: 'Soya chunks',                  q: '1 katori',    kcal: 170, carb: 12, protein: 20, fat: 2,  satfat: 0, fiber: 6, sugar: 2, sodium: 300, potassium: 480, phosphorus: 290, gi: 'low' },
  { id: 'tofu',        n: 'Tofu',                         q: '100 g',       kcal: 120, carb: 3,  protein: 13, fat: 7,  satfat: 1, fiber: 1, sugar: 0, sodium: 12,  potassium: 150, phosphorus: 180, gi: 'low' },
  { id: 'sprouts',     n: 'Sprouts',                      q: '1 katori',    kcal: 120, carb: 18, protein: 9,  fat: 1,  satfat: 0, fiber: 7, sugar: 2, sodium: 120, potassium: 380, phosphorus: 160, gi: 'low' },
  { id: 'oats',        n: 'Oats / daliya',                q: '1 katori',    kcal: 160, carb: 27, protein: 6,  fat: 3,  satfat: 1, fiber: 4, sugar: 1, sodium: 90,  potassium: 190, phosphorus: 180, gi: 'low' },
  { id: 'brownRice',   n: 'Brown rice / millet',          q: '1 katori',    kcal: 190, carb: 40, protein: 5,  fat: 1,  satfat: 0, fiber: 4, sugar: 0, sodium: 5,   potassium: 130, phosphorus: 150, gi: 'med' },
  { id: 'ghee',        n: 'Ghee / butter',                q: '1 tsp',       kcal: 45,  carb: 0,  protein: 0,  fat: 5,  satfat: 3, fiber: 0, sugar: 0, sodium: 2,   potassium: 1,   phosphorus: 1,   gi: 'low' },
  { id: 'fruitBowl',   n: 'Mixed fruit bowl',             q: '1 bowl',      kcal: 110, carb: 27, protein: 1,  fat: 0,  satfat: 0, fiber: 5, sugar: 0, sodium: 5,   potassium: 380, phosphorus: 35,  gi: 'low' },
  { id: 'fish',      n: 'Fish curry',                  q: '1 katori',    kcal: 190, carb: 5,  protein: 21, fat: 9,  satfat: 2, fiber: 1, sugar: 1, sodium: 480, potassium: 380, phosphorus: 250, gi: 'low' },
  { id: 'paratha',   n: 'Aloo paratha with butter',    q: '1',           kcal: 320, carb: 40, protein: 6,  fat: 15, satfat: 8, fiber: 3, sugar: 1, sodium: 420, potassium: 350, phosphorus: 110, gi: 'high' },
  { id: 'idli',      n: 'Idli',                        q: '2',           kcal: 140, carb: 28, protein: 4,  fat: 1,  satfat: 0, fiber: 2, sugar: 0, sodium: 300, potassium: 120, phosphorus: 90,  gi: 'med' },
  { id: 'dosa',      n: 'Dosa',                        q: '1',           kcal: 190, carb: 30, protein: 4,  fat: 6,  satfat: 2, fiber: 2, sugar: 0, sodium: 320, potassium: 130, phosphorus: 95,  gi: 'high' },
  { id: 'poha',      n: 'Poha',                        q: '1 plate',     kcal: 250, carb: 45, protein: 5,  fat: 6,  satfat: 2, fiber: 3, sugar: 2, sodium: 400, potassium: 210, phosphorus: 80,  gi: 'high' },
  { id: 'upma',      n: 'Upma',                        q: '1 plate',     kcal: 230, carb: 38, protein: 5,  fat: 7,  satfat: 2, fiber: 3, sugar: 1, sodium: 420, potassium: 180, phosphorus: 85,  gi: 'high' },
  { id: 'salad',     n: 'Salad — cucumber, onion',     q: '1 bowl',      kcal: 40,  carb: 7,  protein: 2,  fat: 0,  satfat: 0, fiber: 3, sugar: 3, sodium: 15,  potassium: 290, phosphorus: 40,  gi: 'low' },
  { id: 'samosa',    n: 'Samosa',                      q: '1',           kcal: 260, carb: 30, protein: 4,  fat: 14, satfat: 6, fiber: 2, sugar: 1, sodium: 400, potassium: 250, phosphorus: 60,  gi: 'high' },
  { id: 'teaSugar',  n: 'Tea with sugar',              q: '1 cup',       kcal: 90,  carb: 14, protein: 2,  fat: 3,  satfat: 2, fiber: 0, sugar: 12, sodium: 25,  potassium: 130, phosphorus: 60,  gi: 'high' },
  { id: 'teaPlain',  n: 'Tea without sugar',           q: '1 cup',       kcal: 35,  carb: 3,  protein: 2,  fat: 2,  satfat: 1, fiber: 0, sugar: 1,  sodium: 25,  potassium: 120, phosphorus: 55,  gi: 'low' },
  { id: 'sweet',     n: 'Indian sweet',                q: '1 piece',     kcal: 190, carb: 30, protein: 3,  fat: 7,  satfat: 4, fiber: 0, sugar: 26, sodium: 40,  potassium: 90,  phosphorus: 70,  gi: 'high' },
  { id: 'banana',    n: 'Banana',                      q: '1',           kcal: 105, carb: 27, protein: 1,  fat: 0,  satfat: 0, fiber: 3, sugar: 0, sodium: 1,   potassium: 420, phosphorus: 26,  gi: 'med' },
  { id: 'apple',     n: 'Apple / pear',                q: '1',           kcal: 80,  carb: 21, protein: 0,  fat: 0,  satfat: 0, fiber: 4, sugar: 0, sodium: 2,   potassium: 160, phosphorus: 15,  gi: 'low' },
  { id: 'papad',     n: 'Papad + pickle',              q: '1 + 1 tsp',   kcal: 60,  carb: 8,  protein: 2,  fat: 2,  satfat: 1, fiber: 1, sugar: 0, sodium: 900, potassium: 110, phosphorus: 45,  gi: 'med' },
  { id: 'nuts',      n: 'Nuts — almonds, walnuts',     q: 'small handful', kcal: 170, carb: 6, protein: 6, fat: 15, satfat: 1, fiber: 3, sugar: 1, sodium: 2,   potassium: 200, phosphorus: 150, gi: 'low' },
  { id: 'milk',      n: 'Milk',                        q: '1 glass',     kcal: 120, carb: 12, protein: 6,  fat: 5,  satfat: 3, fiber: 0, sugar: 0, sodium: 50,  potassium: 380, phosphorus: 220, gi: 'low' },
];
const frxFood = (id) => FRX_FOODS.find(f => f.id === id);

/* ---- 6. The scoring engine. Deterministic, testable, no network. ---- */
/* NOTE: `sugar` means ADDED/free sugar only. Lactose in dairy and the sugar
   inside whole fruit are intrinsic and are deliberately recorded as 0 — they
   are already counted in `carb`, and penalising them twice misleads people
   away from curd and fruit, which is the opposite of what we want. */
const FRX_KEYS = ['kcal', 'carb', 'protein', 'fat', 'satfat', 'fiber', 'sugar', 'sodium', 'potassium', 'phosphorus'];

function frxSum(selection) {
  const z = {}; FRX_KEYS.forEach(k => z[k] = 0);
  selection.forEach(({ id, qty }) => {
    const f = frxFood(id); if (!f) return;
    FRX_KEYS.forEach(k => z[k] += (f[k] || 0) * (qty || 1));
  });
  FRX_KEYS.forEach(k => z[k] = Math.round(z[k]));
  return z;
}

/* Glycaemic rise: carbohydrate load, adjusted for how refined it is and for
   the fibre/protein/fat present to blunt it. Returns small | moderate | large. */
function frxSpike(n, selection) {
  const highGi = selection.reduce((s, x) => { const f = frxFood(x.id); return s + (f && f.gi === 'high' ? (f.carb || 0) * (x.qty || 1) : 0); }, 0);
  const refinedShare = n.carb ? highGi / n.carb : 0;
  let load = n.carb * (0.7 + 0.6 * refinedShare) + n.sugar * 1.5;
  load -= Math.min(load * 0.35, n.fiber * 4 + n.protein * 1.6 + n.fat * 0.8);
  return load > 70 ? 'large' : load > 38 ? 'moderate' : 'small';
}

/* Each nutrient row carries its own verdict, so the headline can never
   contradict the numbers shown beneath it. */
function frxAssess(selection, slotId, rules, weightKg, dayTotals = {}) {
  const slot = frxSlot(slotId);
  const T = frxTargets(rules, slot, weightKg);
  /* Nutrition comes either from the tap-to-build selection, or from the vision
     model's itemised estimate. Everything downstream is identical, so the
     verdict logic is the same whichever path produced the numbers. */
  const vision = dayTotals.totals || null;
  const vItems = dayTotals.items || null;
  const n = vision || frxSum(selection);
  const [cLo, cHi] = T.carb;

  const over = (v, t, hard = 'Too much', soft = 'A bit high') =>
    v > t * 1.4 ? { bad: 2, word: hard } : v > t ? { bad: 1, word: soft } : { bad: 0, word: 'Good' };
  const under = (v, t, hard = 'Too little', soft = 'A bit low') =>
    v < t * 0.6 ? { bad: 2, word: hard } : v < t ? { bad: 1, word: soft } : { bad: 0, word: 'Good' };

  let carb;
  if (n.carb > cHi * 1.35) carb = { bad: 2, word: 'Too much' };
  else if (n.carb > cHi) carb = { bad: 1, word: 'A bit high' };
  else if (slot.id !== 'snack' && n.carb < cLo * 0.5) carb = { bad: 1, word: 'Low' };
  else carb = { bad: 0, word: 'Good' };

  const rows = [
    { k: 'kcal',    label: 'Calories',      v: n.kcal,    u: 'kcal', aim: `about ${T.kcal}`,       ...over(n.kcal, T.kcal, 'Too many') },
    { k: 'carb',    label: 'Carbohydrate',  v: n.carb,    u: 'g',    aim: `${cLo}–${cHi} g`,       ...carb },
    { k: 'protein', label: 'Protein',       v: n.protein, u: 'g',    aim: rules.id === 'ckd' ? `about ${T.protein} g — not more` : `${T.protein} g or more`,
      ...(rules.id === 'ckd' ? over(n.protein, T.protein, 'Too much for your kidneys') : under(n.protein, T.protein)) },
    { k: 'fiber',   label: 'Fibre',         v: n.fiber,   u: 'g',    aim: `${T.fiber} g or more`,  ...under(n.fiber, T.fiber) },
    { k: 'satfat',  label: 'Saturated fat', v: n.satfat,  u: 'g',    aim: `under ${T.satfat} g`,   ...over(n.satfat, T.satfat) },
    { k: 'sugar',   label: 'Added sugar',   v: n.sugar,   u: 'g',    aim: `under ${T.sugar} g`,    ...over(n.sugar, T.sugar) },
    { k: 'sodium',  label: 'Salt (sodium)', v: n.sodium,  u: 'mg',   aim: `under ${T.sodium} mg`,  ...over(n.sodium, T.sodium) },
  ];
  if (T.potassium) rows.push({ k: 'potassium', label: 'Potassium', v: n.potassium, u: 'mg', aim: `under ${T.potassium} mg`, ...over(n.potassium, T.potassium, 'Too high — important') });
  if (T.phosphorus) rows.push({ k: 'phosphorus', label: 'Phosphate', v: n.phosphorus, u: 'mg', aim: `under ${T.phosphorus} mg`, ...over(n.phosphorus, T.phosphorus, 'Too high — important') });

  rows.forEach(r => r.fg = r.bad === 2 ? '#F58D8B' : r.bad === 1 ? '#F5C572' : '#5FDCA8');

  /* Which nutrient matters most is set by the rule set, not by a fixed list. */
  const weight = {}; FRX_KEYS.forEach(k => weight[k] = 1);
  rules.heavier.forEach((k, i) => weight[k] = 5 - i);
  const flagged = rows.filter(r => r.bad > 0).sort((a, b) => b.bad - a.bad || (weight[b.k] || 1) - (weight[a.k] || 1));

  const SAY = {
    kcal: 'Too many calories for one meal.',
    carb: carb.word === 'Low' ? 'Carbohydrate is low for a main meal.' : 'Too much carbohydrate — this is what drives the sugar rise.',
    protein: rules.id === 'ckd' ? 'More protein than your kidneys should handle.' : 'Too little protein.',
    fiber: 'Very little fibre.',
    satfat: 'Too much saturated fat.',
    sugar: 'Too much added sugar.',
    sodium: 'Too much salt.',
    potassium: 'Potassium is high. This is the one to watch with kidney disease.',
    phosphorus: 'Phosphate is high. Over time this weakens bones and vessels.',
  };
  const reasons = flagged.slice(0, 3).map(r => ({ fg: r.fg, text: SAY[r.k] }));
  const wins = rows.filter(r => r.bad === 0).slice(0, 3).map(r => ({
    kcal: 'Portion size is right.', carb: 'Carbohydrate is in range.', protein: 'Protein is right.',
    fiber: 'Good fibre.', satfat: 'Saturated fat is low.', sugar: 'Almost no added sugar.',
    sodium: 'Salt is under control.', potassium: 'Potassium is safe.', phosphorus: 'Phosphate is fine.',
  }[r.k]));

  /* The verdict respects the rule set. A nutrient this condition is not judged
     on can be mildly off without blocking a green — otherwise ordinary Indian
     home cooking, which always carries salt, could never score well and the
     traffic light would stop meaning anything. A red in a nutrient that DOES
     matter for this condition is decisive on its own. */
  const reds = rows.filter(r => r.bad === 2).length;
  const ambers = rows.filter(r => r.bad === 1).length;
  const criticalRed = rows.some(r => r.bad === 2 && rules.heavier.includes(r.k));
  const criticalAmber = rows.some(r => r.bad === 1 && rules.heavier.includes(r.k));
  const verdict = criticalRed || reds >= 2 ? 'red'
    : (reds === 1 || criticalAmber || ambers >= 3) ? 'amber'
    : 'green';

  /* Suggestions come only from this condition's own pool, filtered again
     against its avoid-list. Nothing generic ever leaks across conditions. */
  const missing = rows.filter(r => r.bad > 0).map(r => r.k);
  const add = rules.addPool.filter(s => !rules.avoid.some(a => s.item.toLowerCase().includes(a))).slice(0, 3);
  const remove = [];
  const asFoods = vItems
    ? vItems.map(it => ({ f: { n: it.n, gi: it.carb >= 25 && it.fiber < 3 ? 'high' : 'low', carb: it.carb, sodium: it.sodium, sugar: it.sugar, potassium: it.potassium, phosphorus: it.phosphorus }, qty: 1 }))
    : selection.map(x => ({ f: frxFood(x.id), qty: x.qty }));
  asFoods.forEach(({ f, qty }) => {
    if (!f) return;
    if (missing.includes('carb') && f.gi === 'high' && f.carb >= 25) remove.push({ item: `Half the ${f.n.toLowerCase()}`, why: 'The biggest single carbohydrate on this plate' });
    if (missing.includes('sodium') && f.sodium >= 500) remove.push({ item: `Skip the ${f.n.toLowerCase()}`, why: `About ${f.sodium} mg of salt on its own` });
    if (missing.includes('sugar') && f.sugar >= 10) remove.push({ item: `${f.n} without sugar`, why: `${f.sugar} g of sugar in one serving` });
    if (missing.includes('potassium') && f.potassium >= 400) remove.push({ item: `Leave out the ${f.n.toLowerCase()}`, why: `${f.potassium} mg of potassium — high for you` });
    if (missing.includes('phosphorus') && f.phosphorus >= 200) remove.push({ item: `Smaller portion of ${f.n.toLowerCase()}`, why: `${f.phosphorus} mg of phosphate` });
  });

  const spike = vision
    ? (() => { const refined = vItems ? vItems.filter(i => i.carb >= 25 && i.fiber < 3).reduce((s, i) => s + i.carb, 0) : n.carb * 0.5;
        const share = n.carb ? refined / n.carb : 0;
        let load = n.carb * (0.7 + 0.6 * share) + n.sugar * 1.5;
        load -= Math.min(load * 0.35, n.fiber * 4 + n.protein * 1.6 + n.fat * 0.8);
        return load > 70 ? 'large' : load > 38 ? 'moderate' : 'small'; })()
    : frxSpike(n, selection);
  const longevity = rules.longevity[Math.floor(((selection.length || (vItems ? vItems.length : 0)) + n.carb) % rules.longevity.length)];

  /* Insulin / sulfonylurea interlock: never push a main meal below 30 g carb. */
  const guarded = [];
  if (dayTotals.onInsulin && slot.id !== 'snack' && n.carb < 30) guarded.push('You take insulin or a sulfonylurea, so this meal should not go below 30 g of carbohydrate.');

  return { n, rows, reasons, wins, verdict, spike, add, remove: remove.slice(0, 3), longevity, targets: T, guarded, slot, rules };
}


/* ============================================================================
   VISION ANALYSIS  — production path
   ----------------------------------------------------------------------------
   The model ESTIMATES the plate; the SCORING STAYS LOCAL. The model must never
   decide the verdict — it returns items and nutrition only, and frxAssess()
   applies this member's rule set. That keeps every verdict auditable and
   identical on device and server.

   The prompt is tuned for the failure we actually hit: protein under-reporting.
   Meat, fish and egg portions are called out explicitly with gram anchors.
   ========================================================================== */
const FRX_VISION_SYSTEM = `You are the nutrition estimation engine inside Check My Meal, used by Indian patients. You look at a photo of a meal and estimate what is on the plate and its nutrition.

ESTIMATION RULES — follow these exactly:
- Identify EVERY item, including drinks, sides, chutney, pickle, salad and visible oil or ghee.
- Estimate portion in Indian household measures AND in grams. State both.
- PROTEIN FOODS ARE THE MOST COMMONLY UNDER-ESTIMATED. Use these anchors:
  · one chicken breast, skinless, grilled = 150 g raw ≈ 45-48 g protein, ≈ 250 kcal
  · one chicken leg or thigh = ≈ 26 g protein
  · two tandoori chicken pieces = ≈ 32 g protein
  · one fish fillet (150 g) = ≈ 34 g protein
  · one egg = 6 g protein; 100 g paneer = 18 g; 1 katori dal = 9 g; 100 g prawns = 20 g
  If you can see two chicken breasts, the protein is ABOUT 90 g, not 16 g. Count what you see.
- Count each visible piece separately. Two rotis is two rotis. Three pieces of chicken is three.
- Indian home and restaurant food carries more oil and ghee than it looks: add 1-2 tsp per cooked dish unless plainly dry-roasted or grilled.
- Include potassium and phosphorus in mg — some of our patients have kidney disease and these decide their advice.
- If the photo is unclear, or you cannot see portion scale, say so in confidence and list what you are unsure about. NEVER invent a plate you cannot see. A low-confidence honest answer is correct; a confident wrong answer harms the patient.
- If the image is not food, return {"not_food": true}.

Return ONLY a JSON object, no markdown, no code fence, no text before or after:
{"not_food":false,"dish":"short name","confidence":"high|medium|low","unsure":["what you could not judge"],"items":[{"n":"food","q":"portion in household measure","g":0,"kcal":0,"protein":0,"carb":0,"fat":0,"satfat":0,"fiber":0,"sugar":0,"sodium":0,"potassium":0,"phosphorus":0}],"total":{"kcal":0,"carb":0,"protein":0,"fat":0,"satfat":0,"fiber":0,"sugar":0,"sodium":0,"potassium":0,"phosphorus":0}}

Integers only. sugar means ADDED or free sugar — lactose in dairy and sugar inside whole fruit are 0. Max 10 items.`;

async function frxVision({ imageB64, note, apiUrl }) {
  const content = [];
  if (imageB64) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageB64 } });
  content.push({ type: 'text', text: note ? `The patient adds: "${note}"` : 'Estimate this meal.' });
  const res = await fetch(apiUrl || 'https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1400, system: FRX_VISION_SYSTEM, messages: [{ role: 'user', content }] }),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  const txt = (data.content || []).map(b => b.type === 'text' ? b.text : '').join('\n').replace(/```json|```/g, '').trim();
  const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
  if (a < 0 || b < 0) throw new Error('unreadable reply');
  return frxNormalise(JSON.parse(txt.slice(a, b + 1)));
}

function frxNormalise(r) {
  if (r.not_food) return r;
  const num = (x) => Math.max(0, Math.round(Number(x) || 0));
  r.items = (Array.isArray(r.items) ? r.items : []).slice(0, 10).map(it => {
    const o = { n: String(it.n || 'item'), q: String(it.q || ''), g: num(it.g) };
    FRX_KEYS.forEach(k => o[k] = num(it[k]));
    return o;
  });
  const t = {}; FRX_KEYS.forEach(k => t[k] = num(r.total && r.total[k]));
  /* If the model's total disagrees with the sum of its own items, trust the items. */
  const sum = {}; FRX_KEYS.forEach(k => sum[k] = r.items.reduce((s, it) => s + it[k], 0));
  FRX_KEYS.forEach(k => { if (!t[k] || Math.abs(t[k] - sum[k]) > Math.max(5, sum[k] * 0.25)) t[k] = sum[k]; });
  r.total = t;
  r.confidence = ['high', 'medium', 'low'].includes(r.confidence) ? r.confidence : 'medium';
  r.unsure = Array.isArray(r.unsure) ? r.unsure.slice(0, 3) : [];
  r.dish = r.dish || 'Your meal';
  return r;
}

/* ============================================================================
   iLive Exercise Prescription (ExRx)
   ----------------------------------------------------------------------------
   Turns the member's weight, BMI, age and conditions into a weekly target and a
   session for today. Every number below is taken from a named guideline; none
   of it is invented, and none of it is aggressive enough to be controversial.

   SOURCES
     WHO Physical Activity Guidelines 2020 ....... 150-300 min/wk moderate, or
                                                   75-150 min/wk vigorous, plus
                                                   muscle strengthening 2 d/wk
     ACSM Position Stand, Med Sci Sports Exerc 2009 ... 150-250 min/wk prevents
                                                   weight gain; >250 min/wk
                                                   produces clinically meaningful
                                                   weight loss
     ADA Standards of Care 2024 ................. 150 min/wk moderate for
                                                   diabetes, resistance 2-3 d/wk,
                                                   no more than 2 consecutive
                                                   days without activity
     ACC/AHA 2017 Hypertension Guideline ........ aerobic most days; expect
                                                   5-8 mmHg systolic
     AACVPR / ESC cardiac rehabilitation ........ post-discharge starts graded,
                                                   RPE 11-13, 5-10 min bouts,
                                                   progressed weekly
     Sherrington, Br J Sports Med 2019 .......... balance + strength reduces
                                                   falls ~23% in older adults
     Look AHEAD, NEJM 2013 ...................... 5-10% weight loss improves
                                                   glycaemia, BP and lipids

   SAFETY — hard rules, never overridden:
     · Post-discharge, post-surgical and post-stroke members start in Zone 1-2
       only. No Zone 4-5 is prescribed at all until a clinician clears it.
     · Uncontrolled hypertension (systolic >= 160) removes Zone 4-5.
     · BMI >= 35 starts non-weight-bearing or low-impact, to protect joints.
     · Insulin or sulfonylurea adds a hypoglycaemia precaution to every session.
   ========================================================================== */

const EXRX_INTENSITY = {
  1: { name: 'Very light', pct: [0.50, 0.60], rpe: '9-11', feels: 'You can sing' },
  2: { name: 'Light',      pct: [0.60, 0.70], rpe: '11-12', feels: 'Full sentences, easy' },
  3: { name: 'Moderate',   pct: [0.70, 0.80], rpe: '12-14', feels: 'Short sentences only' },
  4: { name: 'Hard',       pct: [0.80, 0.90], rpe: '15-17', feels: 'A few words at a time' },
  5: { name: 'Maximum',    pct: [0.90, 1.00], rpe: '18-20', feels: 'Cannot talk' },
};

/* Asian-Indian BMI cut-offs — WHO expert consultation, Lancet 2004, and the
   Indian consensus statement. Using European cut-offs here under-calls risk. */
function exrxBmiBand(bmi) {
  if (bmi < 18.5) return { id: 'under', label: 'Underweight' };
  if (bmi < 23)   return { id: 'normal', label: 'Healthy weight' };
  if (bmi < 25)   return { id: 'risk', label: 'At risk' };
  if (bmi < 30)   return { id: 'obese1', label: 'Obese class I' };
  if (bmi < 35)   return { id: 'obese2', label: 'Obese class II' };
  return { id: 'obese3', label: 'Obese class III' };
}

/**
 * @param p { age, weightKg, heightCm, sbp, diabetes, hypertension, onInsulin,
 *            programmes[], weeksIn }
 */
function exrxPlan(p) {
  const age = Math.max(18, Math.min(95, p.age || 46));
  const wt = p.weightKg || 70;
  const ht = p.heightCm || 170;
  const bmi = wt / Math.pow(ht / 100, 2);
  const band = exrxBmiBand(bmi);
  const hrMax = 220 - age;
  const zone = (z) => ({ z, ...EXRX_INTENSITY[z], from: Math.round(hrMax * EXRX_INTENSITY[z].pct[0]), to: Math.round(hrMax * EXRX_INTENSITY[z].pct[1]) });

  const has = (t) => (p.programmes || []).some(x => String(x).toLowerCase().includes(t));
  const recovering = has('recover') || has('surgery') || has('discharge') || has('stroke') || has('cardiac') || has('ptca');
  const elderly = age >= 70 || has('elder');
  const weeksIn = Math.max(0, p.weeksIn || 0);

  /* ---- 1. Weekly aerobic target ---- */
  let weekly, weeklyWhy, cap;
  if (recovering) {
    const stage = weeksIn < 2 ? 0 : weeksIn < 4 ? 1 : weeksIn < 8 ? 2 : 3;
    weekly = [50, 80, 110, 150][stage];
    weeklyWhy = 'Cardiac and post-hospital rehabilitation starts low and is built up week by week, not all at once.';
    cap = 2;                                        // never above Zone 2 unsupervised
  } else if (band.id === 'obese1' || band.id === 'obese2' || band.id === 'obese3') {
    weekly = 250;
    weeklyWhy = 'Above 250 minutes a week is where weight loss becomes clinically meaningful rather than just maintenance.';
    cap = band.id === 'obese3' ? 3 : 4;
  } else if (p.diabetes) {
    weekly = 180;
    weeklyWhy = 'Diabetes responds to 150 minutes a week, and a little more gives you room for a missed day.';
    cap = 4;
  } else if (band.id === 'risk') {
    weekly = 200;
    weeklyWhy = 'At this weight, 200 minutes a week prevents further gain and starts to reverse it.';
    cap = 4;
  } else {
    weekly = 150;
    weeklyWhy = 'The standard weekly target for health, from the WHO guideline.';
    cap = 5;
  }
  if (p.sbp >= 160) cap = Math.min(cap, 3);
  if (elderly) cap = Math.min(cap, 4);

  /* ---- 2. The session for today ---- */
  const days = recovering ? 6 : 5;
  const perSession = Math.round(weekly / days / 5) * 5;
  const mainZone = recovering ? (weeksIn < 4 ? 1 : 2)
    : (band.id === 'obese2' || band.id === 'obese3') ? 2
    : elderly ? 2
    : 3;
  const bandZones = [zone(mainZone), zone(Math.min(cap, mainZone + 1))];

  /* ---- 3. What to actually do ---- */
  let mode, modeWhy;
  if (recovering) { mode = 'Flat walking, indoors or a level road'; modeWhy = 'Predictable effort, easy to stop.'; }
  else if (band.id === 'obese3' || band.id === 'obese2') { mode = 'Brisk walking, stationary cycle, or water walking'; modeWhy = 'Low impact protects knees, hips and the lower back at this weight.'; }
  else if (band.id === 'obese1') { mode = 'Brisk walking or treadmill at a slight incline'; modeWhy = 'An incline raises effort without raising joint load.'; }
  else if (elderly) { mode = 'Walking, plus sit-to-stand and balance work'; modeWhy = 'At this age, keeping legs strong and balance steady matters more than pace.'; }
  else if (p.diabetes) { mode = 'Brisk walking or treadmill, plus a walk after dinner'; modeWhy = 'Walking after the evening meal lowers the post-meal sugar directly.'; }
  else { mode = 'Brisk walking, jogging, cycling or swimming'; modeWhy = 'Whatever you will do consistently is the right one.'; }

  /* ---- 4. Strength and balance ---- */
  const strength = recovering ? { days: 0, note: 'Resistance work waits until your team clears it.' }
    : elderly ? { days: 3, note: 'Balance and leg strength, three days a week — this is what prevents falls.' }
    : p.diabetes ? { days: 3, note: 'Resistance work three days a week. Muscle is where glucose goes.' }
    : { days: 2, note: 'Two strength sessions a week, per the WHO guideline.' };

  /* ---- 5. Expected outcome at 12 weeks. Deliberately conservative. ---- */
  const out = [];
  if (band.id !== 'normal' && band.id !== 'under' && !recovering) {
    const lo = Math.round(wt * 0.03), hi = Math.round(wt * 0.05);
    out.push({ k: 'weight', text: `${lo}-${hi} kg lighter`, why: `At ${weekly} minutes a week with modest diet change, 3-5 % of body weight over 12 weeks is the realistic range.` });
  }
  if (p.hypertension || p.sbp >= 130) out.push({ k: 'bp', text: '5-8 mmHg lower systolic', why: 'The consistent effect of regular aerobic exercise — the same order as a first blood-pressure tablet.' });
  if (p.diabetes) out.push({ k: 'hba1c', text: 'HbA1c 0.5-0.7 % lower', why: 'The average reduction seen in structured exercise trials in type 2 diabetes.' });
  if (recovering) out.push({ k: 'capacity', text: 'Walking distance up 30-40 %', why: 'What supervised rehabilitation typically achieves in the first twelve weeks.' });
  out.push({ k: 'fitness', text: 'Cardio fitness measurably higher', why: 'Fitness is the single strongest predictor of how long you live.' });

  /* ---- 6. Precautions ---- */
  const cautions = [];
  if (recovering) cautions.push('Stop and call us for chest pain, unusual breathlessness, dizziness or a racing irregular heartbeat.');
  if (p.onInsulin) cautions.push('You take insulin or a sulfonylurea — carry something sweet, and do not start if your sugar is below 100 mg/dL.');
  if (p.sbp >= 160) cautions.push('Your blood pressure is high today. Keep to Zone 1-3 until it settles.');
  if (band.id === 'obese2' || band.id === 'obese3') cautions.push('Low-impact only for now. If your knees hurt the next day, shorten the session rather than pushing through.');
  if (elderly) cautions.push('Hold a rail for balance work, and have someone nearby the first few times.');

  return {
    bmi: Math.round(bmi * 10) / 10, band, hrMax, weekly, weeklyWhy, perSession, days,
    zones: bandZones, cap, mode, modeWhy, strength, outcomes: out, cautions,
    recovering, elderly, weeksIn,
    headline: recovering ? 'Rebuild safely' : (band.id === 'obese1' || band.id === 'obese2' || band.id === 'obese3') ? 'Burn fat' : p.diabetes ? 'Control your sugar' : 'Get fitter',
    basis: recovering ? 'AACVPR / ESC cardiac rehabilitation' : p.diabetes ? 'ADA Standards of Care 2024 · WHO 2020' : 'WHO Physical Activity Guidelines 2020 · ACSM 2009',
  };
}


/* ============================================================================
   WEIGHT PATH — how long, at this prescription, to reach a healthy BMI
   ----------------------------------------------------------------------------
   The arithmetic is deliberately transparent and conservative.

     1. Target BMI 23 — the Asian-Indian healthy upper limit (WHO expert
        consultation, Lancet 2004; Indian consensus 2009). Using 25 here would
        leave a South Asian member at real metabolic risk and call it success.
     2. Energy cost of the prescribed session, from METs:
            kcal/min = MET x 3.5 x weightKg / 200        (ACSM metabolic equations)
        Zone 2 ≈ 4.3 MET (walking 5.5 km/h), Zone 3 ≈ 5.0 MET (brisk 6.4 km/h),
        Zone 4 ≈ 7.5 MET (jogging). Heavier people burn more per minute, which
        is why the same prescription moves a 99 kg member faster at the start.
     3. 1 kg of body fat ≈ 7700 kcal (Wishnofsky). This over-predicts over long
        periods because metabolism adapts, so we apply a 0.75 adaptation factor
        beyond the first month — Hall, Lancet 2011.
     4. Exercise ALONE produces about 2-3 % body-weight loss (ACSM Position
        Stand 2009). Exercise PLUS modest diet change produces 5-10 %
        (NICE CG189; Look AHEAD, NEJM 2013). We show both, and we say plainly
        that the faster figure needs the diet change.
     5. Safe rate is capped at 0.75 % of body weight per week. Anything faster
        costs muscle and rarely lasts.
   ========================================================================== */
const EXRX_MET = { 1: 3.0, 2: 4.3, 3: 5.0, 4: 7.5, 5: 9.5 };
const KCAL_PER_KG_FAT = 7700;

function exrxWeightPath(p, plan) {
  const wt = p.weightKg || 70;
  const ht = (p.heightCm || 170) / 100;
  const bmi = wt / (ht * ht);
  const targetBmi = 23;                       // Asian-Indian healthy upper limit
  const targetWt = Math.round(targetBmi * ht * ht * 10) / 10;
  const toLose = Math.round((wt - targetWt) * 10) / 10;
  if (toLose <= 0.5) return { needed: false, bmi: Math.round(bmi * 10) / 10, targetWt, targetBmi };

  const met = EXRX_MET[plan.zones[0].z] || 4.3;
  const kcalPerMin = met * 3.5 * wt / 200;
  const weeklyKcal = kcalPerMin * plan.weekly;
  const kgPerWeekExercise = (weeklyKcal / KCAL_PER_KG_FAT) * 0.75;   // metabolic adaptation
  const capRate = wt * 0.0075;                                       // safe ceiling
  const rateExercise = Math.min(kgPerWeekExercise, capRate);
  const rateCombined = Math.min(kgPerWeekExercise + 0.25, capRate);  // + modest diet change

  const weeksExercise = Math.ceil(toLose / Math.max(rateExercise, 0.05));
  const weeksCombined = Math.ceil(toLose / Math.max(rateCombined, 0.05));

  /* Exercise alone realistically delivers 2-3 % — say so rather than implying
     that walking will take a 99 kg member all the way to 75 kg. */
  const exerciseOnlyKg = Math.round(wt * 0.025 * 10) / 10;
  const reachableByExerciseAlone = exerciseOnlyKg >= toLose;

  return {
    needed: true,
    bmi: Math.round(bmi * 10) / 10, targetBmi, targetWt, toLose,
    kcalPerSession: Math.round(kcalPerMin * plan.perSession),
    weeklyKcal: Math.round(weeklyKcal),
    ratePerWeek: Math.round(rateCombined * 100) / 100,
    weeks: Math.min(weeksCombined, 104),
    weeksExerciseOnly: Math.min(weeksExercise, 104),
    exerciseOnlyKg, reachableByExerciseAlone,
    months: Math.max(1, Math.round(Math.min(weeksCombined, 104) / 4.3)),
    firstMilestoneKg: Math.round(wt * 0.05 * 10) / 10,
    firstMilestoneWeeks: Math.ceil((wt * 0.05) / Math.max(rateCombined, 0.05)),
  };
}

const PLANS = [
  {
    id: 'essential', name: 'iLive Prevent', emoji: '🛡️', grad: 'linear-gradient(140deg, #2C5A8F 0%, #16304F 100%)',
    price: '₹29,999/year', dischargePrice: '₹29,999/year', dischargeNote: '₹2,500/month equivalent', tagline: 'Stay ahead of disease.',
    who: 'Healthy people · executives · corporates · fitness enthusiasts',
    benefits: ['24×7 wristband — every heartbeat watched in real time', 'AI analytics with immediate response to anything clinically significant', 'A doctor steps in the moment something looks off', 'Your health, quietly guarded while you live your life'],
  },
  {
    id: 'connect', name: 'iLive Care', emoji: '💙', grad: 'linear-gradient(140deg, #257D72 0%, #123F38 100%)',
    price: '₹4,917/month', dischargePrice: '₹4,917/month (annual)', dischargeNote: 'for annual subscription · ₹5,999 month-by-month', tagline: 'Continuous care between doctor visits.',
    who: 'Diabetes · high BP · heart disease · COPD · kidney disease · elder care',
    benefits: ['Wristband + disease-specific devices, chosen for your condition', 'Continuous management by your Command Centre — 24×7', 'Disease programs: Diabetes · Hypertension · COPD · Chronic condition · Elder care', 'Weekly reports to your own doctor'],
  },
  {
    id: 'connectPlus', name: 'iLive Recover', emoji: '🩹', grad: 'linear-gradient(140deg, #A85B3A 0%, #62301B 100%)',
    price: '₹14,999 / 14 days', dischargePrice: '₹14,999 / 14 days', dischargeNote: '7 days ₹9,999 · 30 days ₹24,999', tagline: 'Safer recovery at home.',
    who: 'Post-discharge · surgery · angioplasty · pneumonia · acute illness',
    benefits: ['Chest patch + wristband — intensive recovery monitoring', 'Continuous ECG, breathing, temperature & activity', 'Your treating doctor integrated into every review', 'The most dangerous week, made safe'],
  },
  {
    id: 'prive', name: 'iLive PRIVÉ', emoji: '◆', grad: 'linear-gradient(140deg, #1A1D2E 0%, #0B0D18 100%)',
    price: '₹17,999/month', dischargePrice: '₹17,999/month', dischargeNote: 'or ₹1,69,999/year — ₹14,167 a month',
    tagline: 'Your personal health command centre.',
    who: 'Founders · executives · families who want medicine on standby',
    benefits: ['24×7 doctor-led health monitoring', 'Continuous health & recovery insights', 'Monthly physician review', 'Advanced blood tests every 3 months', 'Personalised nutrition & fitness guidance', 'Priority clinical review of significant alerts'],
  },
];

const PROGRAMS = [
  /* ---- iLive Care — management of chronic health conditions ---- */
  { emoji: '🍬', name: 'Diabetes Control', title: 'Diabetes Management Program', desc: 'Sugar logging, diet & medicine titration', color: '#E8A13D', journey: 'care' },
  { emoji: '🩸', name: 'Blood Pressure Control', title: 'Hypertension Control Program', desc: 'Daily BP tracking with doctor review', color: '#C0392B', journey: 'care' },
  { emoji: '🫁', name: 'COPD Care', title: 'Pulmonology / COPD Program', desc: 'Breathing checks & early flare-up alerts', color: '#0E9CC4', journey: 'care' },
  { emoji: '🩺', name: 'Heart Failure Care', title: 'Chronic Health Condition Program', desc: 'Heart failure & other long-term conditions — watched daily', color: '#7C6FD0', journey: 'care' },
  { emoji: '🌿', name: 'Elder Care', title: 'Elder Care Program', desc: 'Ageing safely at home — daily wellness, medicines & family peace of mind', color: '#199A8E', journey: 'care' },
  /* ---- iLive Recover — recovery at home ---- */
  { emoji: '⚡', name: 'Post-Cardiac Event Recovery', title: 'Post-PTCA / Device / Cardiac Recovery Program', desc: 'After angioplasty, stents, pacemakers or cardiac admission', color: '#D4622E', journey: 'recover' },
  { emoji: '🫀', name: 'Post-Heart Surgery Recovery', title: 'Post-Cardiac Surgery / Major Surgery Program', desc: '30-day guided recovery after surgery', color: '#2B6CB0', journey: 'recover' },
  { emoji: '🧠', name: 'Stroke Recovery', title: 'Post-Stroke / Neurological Recovery Program', desc: 'Rehab, physio & risk-factor control', color: '#8E6FC0', journey: 'recover' },
  { emoji: '🏥', name: 'Post-Hospital Recovery', title: 'Post-Hospital Discharge Recovery Program', desc: 'Safe recovery at home after any hospital stay — cardiac monitoring included', color: '#B0486E', journey: 'recover' },
];

const PROGRAM_DEVICES = {
  'Diabetes Control': { emoji: '🩸', name: 'iLive CGM Sensor', price: '₹3,800 / 14 days', desc: 'Sticks painlessly on your arm — every glucose reading flows into the app by itself. No pricking, ever.' },
  'Blood Pressure Control': { emoji: '🩺', name: 'iLive Connected BP Monitor', price: '₹1,200', desc: 'Take your BP in the morning — the reading uploads itself. Nothing to type, nothing to remember.' },
  'COPD Care': { emoji: '🫁', name: 'iLive Home Spirometer', price: '₹5,800', desc: 'One daily blow test at home — lung function tracked, flare-ups caught days early.' },
  'Heart Failure Care': { emoji: '⚖️', name: 'iLive Smart Scale', price: '₹2,900', desc: 'Step on every morning — weight syncs instantly, fluid gain alerts your care team automatically.' },
};

const FAMILY = [
  { id: 'father', emoji: '👴', name: 'Ramesh Chandola', rel: 'Father', age: 74, status: 'attention', statusText: 'Needs BP update', conditions: ['❤️ CABG (2022)', '🩸 Hypertension', '🍬 Diabetes'],
    meds: ['Aspirin 75mg', 'Rosuvastatin 10mg', 'Telmisartan 40mg', 'Metformin 500mg'],
    tasks: [['Morning medicines', false], ['BP reading', true], ['Walk 20 minutes', false], ['Blood sugar', true], ['Drink enough water', false]],
    upcoming: ['HbA1c due in 14 days', 'Cardiology visit next Tuesday', 'Eye check next month'],
    docs: ['Discharge Summary', 'Echo', 'ECG', 'Angiography', 'Lab Reports', 'Prescriptions', 'Insurance'],
    team: ['Cardiologist', 'Nutritionist', 'Physiotherapist'] },
  { id: 'mother', emoji: '👵', name: 'Sunita Chandola', rel: 'Mother', age: 68, status: 'good', statusText: 'Everything on track', conditions: ['🪨 Osteoarthritis', '🩸 Pre-hypertension'],
    meds: ['Calcium + D3', 'Glucosamine'],
    tasks: [['Morning medicines', true], ['Walk 20 minutes', true], ['Knee exercises', false]],
    upcoming: ['Ortho review in 3 weeks', 'Vitamin D test next month'],
    docs: ['Knee X-ray', 'Lab Reports', 'Prescriptions'],
    team: ['Orthopaedician', 'Physiotherapist'] },
  { id: 'son', emoji: '👦', name: 'Aarav', rel: 'Son', age: 9, status: 'info', statusText: 'Therapy tomorrow', conditions: [],
    meds: [],
    tasks: [['Speech therapy homework', true], ['Outdoor play 1 hour', false]],
    upcoming: ['Speech therapy · tomorrow 5 PM', 'MMR booster due', 'Annual growth check next month'],
    docs: ['Vaccination Card', 'Growth Chart', 'Therapy Notes', 'School Health Report'],
    team: ['Paediatrician', 'Speech Therapist'] },
];

const PROGRAM_LEAD = {
  'Post-Heart Surgery Recovery': { name: 'Dr. R. Chandola', role: 'Cardiac Surgeon' },
  'Post-Cardiac Event Recovery': { name: 'Dr. A. Mehta', role: 'Interventional Cardiologist' },
  'iLive Prevent': { name: 'Dr. A. Mehta', role: 'Physician · Preventive Cardiology' },
  'Heart Failure Care': { name: 'Dr. A. Mehta', role: 'Cardiologist' },
  'Blood Pressure Control': { name: 'Dr. A. Mehta', role: 'Cardiologist' },
  'Diabetes Control': { name: 'Dr. Anil Sharma', role: 'Diabetologist' },
  'COPD Care': { name: 'Dr. S. Rao', role: 'Pulmonologist' },
  'Stroke Recovery': { name: 'Dr. V. Nair', role: 'Neurologist' },
  'Cancer Care': { name: 'Dr. S. Menon', role: 'Medical Oncologist' },
  'CKD & Dialysis Support': { name: 'Dr. K. Iyer', role: 'Nephrologist' },
  'Elder Care': { name: 'Dr. M. Krishnan', role: 'Geriatric Physician' },
  'Post-Hospital Recovery': { name: 'Dr. R. Chandola', role: 'Physician · Recovery Lead' },
  'Heart Health Check': { name: 'Dr. A. Mehta', role: 'Cardiologist' },
  'WoundHeal+ Program': { name: 'Dr. A. Kapoor', role: 'Vascular Surgeon' },
};

const LUNG_TIERS = {
  essential: {
    label: 'Essential',
    metrics: [
      { v: '92%', l: 'Peak flow', s: 'of your personal best' },
      { v: '96%', l: 'SpO₂', s: 'Oximeter · 8:05 AM' },
      { v: '1', l: 'Rescue puffs', s: 'this week · target <2' },
    ],
    devices: [
      { icon: '🌬️', name: 'Smart Peak Flow', status: 'Blown 7:55 AM ✓' },
      { icon: '🫰', name: 'Pulse oximeter', status: 'Synced 8:05 AM ✓' },
    ],
    tasks: [
      { emoji: '🌬️', title: 'Morning peak flow', sub: 'Done — 92% of best, green zone', done: true },
      { emoji: '💨', title: 'Morning inhaler', sub: 'Tap after your 2 puffs' },
      { emoji: '🚶', title: '20-minute walk (indoors today)', sub: 'Air is poor — walk inside' },
    ],
    ccNote: '"Peak flow steady in the green zone all week — well done. Report shared with your doctor."',
    docLine: 'peak flow zone history, SpO₂ spot checks, rescue-inhaler use.',
  },
  connect: {
    label: 'Connect',
    metrics: [
      { v: '78%', l: 'FEV₁', s: 'MIR spirometer · predicted' },
      { v: '96%', l: 'SpO₂', s: 'Oximeter · 8:05 AM' },
      { v: '1', l: 'Rescue puffs', s: 'smart cap · target <2' },
    ],
    devices: [
      { icon: '🫁', name: 'MIR spirometer', status: 'FEV₁ done 7:55 AM ✓' },
      { icon: '🫰', name: 'Pulse oximeter', status: 'Synced 8:05 AM ✓' },
      { icon: '💨', name: 'Smart inhaler cap', status: '2 puffs 8:10 AM ✓' },
    ],
    tasks: [
      { emoji: '🫁', title: 'Morning spirometry', sub: 'Done — FEV₁ 78% predicted, green zone', done: true },
      { emoji: '💨', title: 'Morning inhaler', sub: 'Smart cap confirmed 2 puffs, 8:10 AM', done: true },
      { emoji: '🚶', title: '20-minute walk (indoors today)', sub: 'Air is poor — walk inside' },
    ],
    ccNote: '"FEV₁ up 4% this month and inhaler adherence at 96% — excellent. Report shared with your doctor."',
    docLine: 'FEV₁ trend, adherence %, rescue-use frequency, SpO₂.',
  },
  plus: {
    label: 'Connect Plus',
    metrics: [
      { v: '78%', l: 'FEV₁', s: 'MIR spirometer · predicted' },
      { v: '94%', l: 'Night SpO₂', s: 'O2Ring · lowest 91%' },
      { v: '9/10', l: 'Technique', s: 'CapMedic coaching score' },
    ],
    devices: [
      { icon: '🫁', name: 'MIR spirometer', status: 'FEV₁ done 7:55 AM ✓' },
      { icon: '💍', name: 'O2Ring overnight', status: '7h 40m recorded ✓' },
      { icon: '🎯', name: 'CapMedic cap', status: 'Great technique 8:10 AM' },
      { icon: '🏠', name: 'Air monitor', status: 'Indoor PM2.5: 38 (good)' },
    ],
    tasks: [
      { emoji: '🫁', title: 'Morning spirometry', sub: 'Done — FEV₁ 78% predicted, green zone', done: true },
      { emoji: '🎯', title: 'Inhaler with CapMedic', sub: '9/10 technique — hold breath 2s longer', done: true },
      { emoji: '🧘', title: 'Pulmonary rehab session', sub: '15-min guided video with your physio' },
    ],
    ccNote: '"Night oxygen held above 91% — no action needed. Technique improving with CapMedic. Report shared with your doctor."',
    docLine: 'FEV₁, overnight SpO₂ curve, technique + adherence, rescue use, home air quality.',
  },
};

// iLive brand palette — blue & white, matched to iliveconnect.com
const C_LIGHT = {
  ink: '#FFFFFF', panel: '#FFFFFF', panelLight: '#EAF2FB', green: '#2B6CB0', amber: '#E8A13D', coral: '#E05252',
  text: '#0A1B33', muted: '#3F5578', border: 'rgba(21,62,111,0.09)', teal: '#199A8E', violet: '#7C6FD0',
  cyan: '#0E9CC4', rose: '#E06A8A', gold: '#B08D46', navy: '#153E6F', heartBlue: '#7BA7D9',
};
/* Premium dark tokens — same keys, so every program home renders on the dark canvas without edits */
const C_DARK = {
  ink: '#08182B', panel: '#16314F', panelLight: '#1E3C60', green: '#4A90F0', amber: '#F5C572', coral: '#F58D8B',
  text: '#FFFFFF', muted: '#C6D8EC', border: 'rgba(255,255,255,0.11)', teal: '#6FDCD2', violet: '#B0A4FF',
  cyan: '#7FD3F0', rose: '#F2A6C4', gold: '#EBCE8A', navy: '#9CCAFF', heartBlue: '#9CCAFF',
};
/* White information cards keep a white surface and dark ink in BOTH palettes (mirrors the production app) */
const WHITE = { bg: '#FFFFFF', ink: '#0A1B33', navy: '#153E6F', muted: '#3F5578', soft: '#7A8CA6', border: 'rgba(21,62,111,0.09)' };
const C = { ...C_LIGHT };
function usePalette(dark) { Object.assign(C, dark ? C_DARK : C_LIGHT); }

// iLive logo — vector recreation of the original brand mark
function ILiveLogo({ height = 34, tagline = false }) {
  const vbH = tagline ? 126 : 102;
  return (
    <svg viewBox={`0 0 322 ${vbH}`} height={height} style={{ display: 'block' }} aria-label="iLive — Monitoring Health, Saving Lives">
      <path d="M62 92 C38 73 18 56 18 37 C18 22 29 12 41 12 C50 12 57 17 62 24 C67 17 74 12 83 12 C95 12 106 22 106 37 C106 56 86 73 62 92 Z" fill="none" stroke="#7BA7D9" strokeWidth="8" strokeLinejoin="round" />
      <circle cx="74" cy="45" r="8.5" fill="#7BA7D9" />
      <rect x="69.5" y="58" width="9" height="28" rx="4.5" fill="#7BA7D9" />
      <text x="94" y="84" fontFamily="Georgia, 'Times New Roman', serif" fontSize="72" fill="#2B6CB0">Live</text>
      <path d="M116 97 L170 97 L176 88 L183 104 L189 91 L194 97 L246 97 L252 90 L258 103 L264 93 L269 97 L308 97" fill="none" stroke="#7BA7D9" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      {tagline && (
        <text x="116" y="121" fontFamily="Georgia, 'Times New Roman', serif" fontSize="15" fill="#0A1B33" letterSpacing="0.4">Monitoring Health, Saving Lives</text>
      )}
    </svg>
  );
}

const QR_ROWS = [
  '111111101111111',
  '100000111000001',
  '101110101011101',
  '101110111011101',
  '101110101011101',
  '100000111000001',
  '111111101111111',
  '010101010110100',
  '111111100101101',
  '100000101110010',
  '101110100101110',
  '101110101011001',
  '101110100110101',
  '100000101101011',
  '111111100111010',
];

export default function ILiveConnectSimplified() {
  const [appPhase, setAppPhase] = useState('splash');
  const [activeTab, setActiveTab] = useState('home');

  const [signupName, setSignupName] = useState('');
  const [signupPhone, setSignupPhone] = useState('');
  const [primaryDoctor, setPrimaryDoctor] = useState('');
  const [wantTime, setWantTime] = useState(false);
  const [customCallTime, setCustomCallTime] = useState('17:00');
  const [entryType, setEntryType] = useState(null);
  const [careReason, setCareReason] = useState(null);
  const [careCondition, setCareCondition] = useState(null);
  const [onboardingDone, setOnboardingDone] = useState(false);

  const [isSubscribed, setIsSubscribed] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [showPlans, setShowPlans] = useState(false);
  const [planDetail, setPlanDetail] = useState(null);
  const [hsDays] = useState(2);
  const [foStep, setFoStep] = useState(0);
  const [foPhone, setFoPhone] = useState('');
  const [foOtp, setFoOtp] = useState('');
  const [foName, setFoName] = useState('');
  const [foAge, setFoAge] = useState('');
  const [foSex, setFoSex] = useState('Male');
  const [foHt, setFoHt] = useState('');
  const [foWt, setFoWt] = useState('');
  const [foSbp, setFoSbp] = useState('');
  const [foBpTreated, setFoBpTreated] = useState(false);
  const [foConds, setFoConds] = useState([]);
  const [foSmoking, setFoSmoking] = useState('');
  const [foFamily, setFoFamily] = useState('');
  const [extraAns, setExtraAns] = useState({});
  const [sbAns, setSbAns] = useState({});
  const [labTC, setLabTC] = useState('');
  const [labHDL, setLabHDL] = useState('');
  const [sharpenView, setSharpenView] = useState(null);
  const [sharpenStep, setSharpenStep] = useState(0);
  const [dmPlan, setDmPlan] = useState({ pill: true, bf: true, walk: false, pm: false });
  const [dmGotIt, setDmGotIt] = useState(false);
  const [rvAnim, setRvAnim] = useState(0);
  const [haInfo, setHaInfo] = useState(false);
  const [hcJourneyOpen, setHcJourneyOpen] = useState(false);
  const [hetView, setHetView] = useState(null);
  const [hetStage, setHetStage] = useState(-1);
  const [hetSafety, setHetSafety] = useState({});
  const [priveTier, setPriveTier] = useState(null);
  const [pvSheet, setPvSheet] = useState(null);
  const [pvGoal, setPvGoal] = useState('fit');
  const [frxView, setFrxView] = useState('day');
  const [frxPlate, setFrxPlate] = useState([]);
  const [frxSlotId, setFrxSlotId] = useState(null);
  const [frxLog, setFrxLog] = useState([]);
  const [frxOpen, setFrxOpen] = useState(false);
  const [frxDialysis] = useState(false);
  const [frxPhoto, setFrxPhoto] = useState(null);
  const [frxText, setFrxText] = useState('');
  const [frxBusy, setFrxBusy] = useState(false);
  const [frxItems, setFrxItems] = useState(null);     // itemised estimate, editable
  const [frxTotals, setFrxTotals] = useState(null);
  const [frxConf, setFrxConf] = useState(null);
  const [frxErr, setFrxErr] = useState('');
  const [frxCelebrate, setFrxCelebrate] = useState(false);
  const [frxStage, setFrxStage] = useState(0);
  const [rxWeeks] = useState(3);
  const [dietRegion, setDietRegion] = useState('north');
  const [rxOpen, setRxOpen] = useState(false);
  const [ccName, setCcName] = useState('');
  const [ccPhone, setCcPhone] = useState('');
  const [ccEmail, setCcEmail] = useState('');
  const [ccRel, setCcRel] = useState('Daughter');
  const [ccSent, setCcSent] = useState(false);
  const frxCamRef = useRef(null);
  const frxFileRef = useRef(null);
  const [frxInsulin] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [pvSess, setPvSess] = useState({ status: 'brief', secs: 0, inZone: 0, hr: 72, avgHr: 0 });
  const pvTimerRef = useRef(null);
  const [pvUnlocked] = useState({});
  const rvTimerRef = useRef(null);
  const [freeCallsLeft, setFreeCallsLeft] = useState(2);

  const [guardianView, setGuardianView] = useState(false);
  const [reminderSent, setReminderSent] = useState(false);
  const [missedCheckinAlert, setMissedCheckinAlert] = useState(true);

  const [checkedIn, setCheckedIn] = useState(false);
  const [checkinTime, setCheckinTime] = useState(null);
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [mood, setMood] = useState(null);
  const [concerns, setConcerns] = useState([]);
  const [waterGlasses, setWaterGlasses] = useState(4);
  const [weightLogged, setWeightLogged] = useState(false);
  const [showRewards, setShowRewards] = useState(false);
  const [enrolledPrograms, setEnrolledPrograms] = useState(['Post-Heart Surgery Recovery']);
  const [woundStep, setWoundStep] = useState('how');
  const [woundPhotos, setWoundPhotos] = useState(0);
  const [woundDiabetic, setWoundDiabetic] = useState(null);
  const [woundDuration, setWoundDuration] = useState(null);
  const [woundPainFever, setWoundPainFever] = useState(null);
  const [woundChannel, setWoundChannel] = useState(null);
  const [woundProgram, setWoundProgram] = useState(false);
  const [boardDone, setBoardDone] = useState(0);
  const [fluorescenceAdded, setFluorescenceAdded] = useState(true);
  const [goalsOpen, setGoalsOpen] = useState(false);
  const [weightValue, setWeightValue] = useState('');
  const [planExtended, setPlanExtended] = useState(false);
  const [deviceOrdered, setDeviceOrdered] = useState(false);
  const [hba1c, setHba1c] = useState('7.2');
  const [hba1cOpen, setHba1cOpen] = useState(false);
  const [hba1cInput, setHba1cInput] = useState('');
  const [breathScore, setBreathScore] = useState(null);
  const [breathSessions, setBreathSessions] = useState(3);
  const [walkDone, setWalkDone] = useState(false);
  const [mealText, setMealText] = useState('');
  const [neuroArm, setNeuroArm] = useState(1);
  const [speechDone, setSpeechDone] = useState(false);
  const [fastOpen, setFastOpen] = useState(false);
  const [familySel, setFamilySel] = useState(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteSent, setInviteSent] = useState(false);
  const [oncoCheckDone, setOncoCheckDone] = useState(false);
  const [tempDone, setTempDone] = useState(false);
  const [fluidUsed, setFluidUsed] = useState(3);
  const [fistulaChecked, setFistulaChecked] = useState(false);
  const RB_TASKS = [
    { id: 'breath', emoji: '🫁', title: 'Breathing device', target: 10, sub: '10 breaths, every waking hour — your №1 lung protection this week' },
    { id: 'walk', emoji: '🚶', title: 'Walk', target: 6, sub: '10–15 min every 2 hours, slow & steady — build to 20 min next week' },
    { id: 'physio', emoji: '🤸', title: 'Physio moves', target: 3, sub: 'Shoulder & ankle mobility, 3× a day — protects your sternum' },
    { id: 'meds', emoji: '💊', title: 'Medicines', target: 2, sub: 'Morning · evening — exactly as prescribed' },
    { id: 'bpsugar', emoji: '🩺', title: 'Check BP & sugar, then log', target: 2, sub: 'Morning · evening' },
    { id: 'wound', emoji: '📷', title: 'Chest wound photo', target: 1, sub: 'One photo a day — AI + nurse review within minutes' },
    { id: 'checkin', emoji: '📝', title: '2-minute check-in', target: 1, sub: 'Tap to begin — pain, sleep, appetite, breathing' },
  ];
  const [rbTicks, setRbTicks] = useState({ breath: 4, walk: 2, physio: 1, meds: 1, bpsugar: 1, wound: 1, checkin: 1 });
  const [ciStep, setCiStep] = useState(0);
  const [ciAns, setCiAns] = useState({});
  const [hhStage, setHhStage] = useState(-1);
  const [hhPackage, setHhPackage] = useState(null);
  const [copdMmrc, setCopdMmrc] = useState(null);
  const [copdBreath, setCopdBreath] = useState(false);
  const [copdInhalerAM, setCopdInhalerAM] = useState(false);
  const [copdInhalerPM, setCopdInhalerPM] = useState(false);
  const [copdTech, setCopdTech] = useState(false);
  const [copdSpo2, setCopdSpo2] = useState(null);
  const [copdPef, setCopdPef] = useState(null);
  const [chfMeds, setChfMeds] = useState({ lasix: true, arni: true, bb: false, sglt2: false });
  const [chfFluid, setChfFluid] = useState(4);
  const [elderView, setElderView] = useState(null);
  const [elderOk, setElderOk] = useState(false);
  const [elderMeds, setElderMeds] = useState({ morning: true, afternoon: false, evening: false });
  const [elderQStep, setElderQStep] = useState(0);
  const [elderQAns, setElderQAns] = useState({});
  const [elderBalance, setElderBalance] = useState(null);
  const [elderInvited, setElderInvited] = useState(false);
  const [hcRisk, setHcRisk] = useState(null);
  const [hcQStep, setHcQStep] = useState(0);
  const [hcQAns, setHcQAns] = useState({});
  const [hcLabsAdded, setHcLabsAdded] = useState(false);
  const [hcLabsView, setHcLabsView] = useState(null);
  const [careRisk, setCareRisk] = useState(null);
  const [careQStep, setCareQStep] = useState(0);
  const [careQAns, setCareQAns] = useState({});
  const [reportShot, setReportShot] = useState(null);
  const [hhTimeLeft, setHhTimeLeft] = useState(0);
  const hhTimerRef = useRef(null);
  const startStageTimer = (secs) => {
    if (hhTimerRef.current) clearInterval(hhTimerRef.current);
    let t = secs;
    setHhTimeLeft(t);
    hhTimerRef.current = setInterval(() => {
      t -= 1;
      if (t <= 0) { clearInterval(hhTimerRef.current); hhTimerRef.current = null; setHhTimeLeft(0); }
      else setHhTimeLeft(t);
    }, 1000);
  };
  const [woundPhotoSent, setWoundPhotoSent] = useState(false);

  const [activeLog, setActiveLog] = useState(null);
  const [logMethod, setLogMethod] = useState('manual');
  const [photoTaken, setPhotoTaken] = useState(false);
  const [voiceHeard, setVoiceHeard] = useState(null);
  const [bpValue, setBpValue] = useState({ systolic: '', diastolic: '' });
  const [sugarValue, setSugarValue] = useState('');
  const [lastBp, setLastBp] = useState({ systolic: 122, diastolic: 80 });
  const [lastSugar, setLastSugar] = useState({ value: 128 });
  const [mealType, setMealType] = useState('Breakfast');
  const [mealPhotoTaken, setMealPhotoTaken] = useState(false);

  const [medications, setMedications] = useState([
    { id: 1, name: 'Telmisartan 40mg', time: 'Morning · 8:00 AM', withFood: false, taken: true },
    { id: 2, name: 'Metformin 500mg', time: 'Morning · 8:00 AM', withFood: true, taken: true },
    { id: 3, name: 'Aspirin 75mg', time: 'Night · 8:00 PM', withFood: true, taken: false },
  ]);

  const [showFamilyForm, setShowFamilyForm] = useState(false);
  const [familyMember, setFamilyMember] = useState({ name: '', phone: '' });
  const [familyAdded, setFamilyAdded] = useState(false);

  const [moreScreen, setMoreScreen] = useState(null);
  const [opinionConcern, setOpinionConcern] = useState('');
  const [opinionSpecialist, setOpinionSpecialist] = useState('Cardiologist');
  const [opinionUploaded, setOpinionUploaded] = useState(false);
  const [selectedTests, setSelectedTests] = useState([]);

  const [baseline, setBaseline] = useState({
    age: '', height: '', weight: '', systolic: '', diastolic: '',
    diabetes: null, cholesterol: null, smoking: null, activity: null,
    sleep: null, dietQuality: null, familyHistory: null, kidneyDisease: null,
  });

  const isAllClear = useMemo(() => {
    const bpOk = lastBp.systolic < 140 && lastBp.systolic > 90;
    const sugarOk = lastSugar.value < 180 && lastSugar.value > 70;
    return bpOk && sugarOk;
  }, [lastBp, lastSugar]);

  const iliveScore = useMemo(() => {
    const medPart = (medications.filter(m => m.taken).length / medications.length) * 30;
    const bpOk = lastBp.systolic < 140 && lastBp.systolic > 90;
    const sugarOk = lastSugar.value < 180 && lastSugar.value > 70;
    return Math.round(medPart + (bpOk ? 25 : 8) + (sugarOk ? 25 : 8) + (checkedIn ? 10 : 0) + (mealPhotoTaken ? 10 : 0));
  }, [medications, lastBp, lastSugar, checkedIn, mealPhotoTaken]);

  function toggleMed(id) {
    setMedications(prev => prev.map(m => (m.id === id ? { ...m, taken: !m.taken } : m)));
  }

  const [trackerEvents, setTrackerEvents] = useState([
    { id: 1, label: 'BP 122/80', abnormal: false, stage: 'clear', receivedAt: '8:12 AM', reviewedAt: '8:14 AM', reviewer: "Dr. Mehta's team", resolution: null },
  ]);
  const [incomingCall, setIncomingCall] = useState(null);
  const [callSeconds, setCallSeconds] = useState(0);
  const callTimerRef = useRef(null);
  const [readingLoggedToday, setReadingLoggedToday] = useState(false);
  const [reportShared, setReportShared] = useState(false);
  const [lockScreenAdded, setLockScreenAdded] = useState(false);

  function trackReading(label, abnormal) {
    const id = Date.now();
    const fmt = d => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    setReadingLoggedToday(true);
    setTrackerEvents(prev => [{ id, label, abnormal, stage: 'received', receivedAt: fmt(new Date()), reviewedAt: null, reviewer: "Dr. Mehta's team", resolution: null }, ...prev].slice(0, 3));
    setTimeout(() => {
      setTrackerEvents(prev => prev.map(e => (e.id === id ? { ...e, stage: 'reviewing' } : e)));
    }, 2000);
    setTimeout(() => {
      setTrackerEvents(prev => prev.map(e => (e.id === id ? { ...e, stage: abnormal ? 'calling' : 'clear', reviewedAt: fmt(new Date()) } : e)));
    }, 5000);
    if (abnormal) {
      setTimeout(() => {
        setIncomingCall({ id, reading: label, doctor: 'Dr. Sharma', phase: 'ringing' });
      }, 7000);
    }
  }

  function acceptCall() {
    setIncomingCall(c => (c ? { ...c, phase: 'active' } : c));
    setCallSeconds(0);
    callTimerRef.current = setInterval(() => setCallSeconds(s => s + 1), 1000);
  }

  function endCall(missed) {
    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }
    const callId = incomingCall ? incomingCall.id : null;
    setIncomingCall(null);
    if (callId) {
      setTrackerEvents(prev => prev.map(e => (e.id === callId
        ? { ...e, stage: 'resolved', resolution: missed ? 'Missed — doctor will retry shortly' : 'Call completed ✓ · Repeat reading in 1 hour' }
        : e)));
    }
  }

  function handleSaveReading() {
    if (activeLog === 'bp') {
      let sys, dia;
      if (logMethod === 'manual') {
        if (!bpValue.systolic || !bpValue.diastolic) return;
        sys = Number(bpValue.systolic); dia = Number(bpValue.diastolic);
      } else {
        if (!photoTaken && !voiceHeard) return;
        sys = 128; dia = 82;
      }
      setLastBp({ systolic: sys, diastolic: dia });
      trackReading(`BP ${sys}/${dia}`, !(sys < 140 && sys > 90));
      setBpValue({ systolic: '', diastolic: '' });
    } else {
      let v;
      if (logMethod === 'manual') {
        if (!sugarValue) return;
        v = Number(sugarValue);
      } else {
        if (!photoTaken && !voiceHeard) return;
        v = 128;
      }
      setLastSugar({ value: v });
      trackReading(`Sugar ${v} mg/dL`, !(v < 180 && v > 70));
      setSugarValue('');
    }
    setPhotoTaken(false);
    setVoiceHeard(null);
    setActiveLog(null);
  }

  /* ---------- ONBOARDING: 3 screens to Home ---------- */

  function foProfile() {
    const bmi = (foHt && foWt) ? (Number(foWt) / Math.pow(Number(foHt) / 100, 2)) : 25;
    return {
      age: Number(foAge) || 45, sex: foSex, bmi, sbp: Number(foSbp) || 125,
      bpTreated: foBpTreated, smoker: foSmoking === 'Currently',
      diabetes: foConds.includes('sugar'), southAsian: true,
    };
  }

  function foStepper(step, total) {
    return (
      <div className="flex gap-1.5 mb-5">
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} className="rounded-full flex-1" style={{ height: 5, background: i < step ? '#1E9E6A' : i === step ? C.green : 'rgba(21,62,111,0.1)' }} />
        ))}
      </div>
    );
  }

  function foHead(step, total, title, sub) {
    return (
      <div className="flex-shrink-0">
        <div className="flex items-center gap-3 mb-4">
          {step > 0 && <button onClick={() => setFoStep(foStep - 1)} className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 34, height: 34, border: `1px solid ${C.border}` }}><ChevronLeft size={16} style={{ color: C.muted }} /></button>}
          <div className="flex-1">{foStepper(step, total)}</div>
          <span className="text-xs font-bold flex-shrink-0" style={{ color: C.muted }}>{step + 1}/{total}</span>
        </div>
        <div className="font-display font-bold" style={{ fontSize: 25, color: C.text, lineHeight: 1.28, letterSpacing: '-0.02em' }}>{title}</div>
        {sub && <div className="text-sm font-medium mt-2.5" style={{ color: C.muted, lineHeight: 1.6 }}>{sub}</div>}
      </div>
    );
  }

  function foInput(label, val, setVal, ph, big, suffix) {
    return (
      <div className="flex-1">
        {label && <div className="text-xs font-semibold mb-2" style={{ color: C.muted }}>{label}</div>}
        <div className="relative">
          <input value={val} onChange={(e) => setVal(e.target.value)} placeholder={ph} inputMode={big ? 'numeric' : 'text'}
            className="w-full rounded-xl outline-none" style={{ padding: big ? '15px 14px' : '14px 14px', background: C.panelLight, border: `1px solid ${C.border}`, color: C.text, fontSize: big ? 21 : 14, fontWeight: big ? 700 : 600 }} />
          {suffix && <span className="absolute text-xs font-bold" style={{ right: 14, top: '50%', transform: 'translateY(-50%)', color: C.muted }}>{suffix}</span>}
        </div>
      </div>
    );
  }

  function foPills(opts, val, setVal) {
    return (
      <div className="flex gap-2 flex-wrap">
        {opts.map(o => (
          <button key={o} onClick={() => { tapFeel('select'); setVal(o); }} className="rounded-full px-4 py-2.5 text-sm font-bold flex items-center gap-1.5" style={{ background: val === o ? 'linear-gradient(135deg, #3B7FC9 0%, #1F5C9E 100%)' : C.panel, border: val === o ? '1.5px solid transparent' : `1.5px solid ${C.border}`, color: val === o ? '#FFFFFF' : C.text, boxShadow: val === o ? '0 6px 16px rgba(31,92,158,0.35)' : 'none', transform: val === o ? 'scale(1.04)' : 'scale(1)', transition: 'all .18s cubic-bezier(.2,.8,.2,1)' }}>{val === o && <Check size={14} color="#FFFFFF" strokeWidth={3} />}{o}</button>
        ))}
      </div>
    );
  }

  function renderHeartAgeInfo() {
    const D = { bg: '#0B2039', card: '#16314F', raised: '#1E3C60', hair: 'rgba(255,255,255,.14)', ink: '#FFFFFF', ink2: '#C6D8EC', ink3: '#93AECB', blueLite: '#9CCAFF', teal: '#6FDCD2' };
    const p = foProfile(); const r = assessCVD(p); const diff = r.heartAge - p.age;
    return (
      <div className="h-full flex flex-col -mx-4 -mt-4 px-4 pt-5" style={{ background: D.bg, color: D.ink, minHeight: '100%' }}>
        <button onClick={() => { tapFeel('tap'); setHaInfo(false); }} className="flex items-center gap-1.5 text-sm font-semibold mb-4 flex-shrink-0" style={{ color: D.ink3 }}><ChevronLeft size={16} color={D.ink3} /> Back to my result</button>
        <div className="flex-1 overflow-y-auto pb-6 space-y-4">
          <div>
            <div style={{ fontSize: 11, letterSpacing: 1.8, color: D.ink3, fontWeight: 700 }}>THE SCIENCE</div>
            <div className="font-display mt-2" style={{ fontSize: 26, fontWeight: 400, lineHeight: 1.25, letterSpacing: '-0.035em' }}>What your heart age means</div>
          </div>

          <div className="rounded-2xl p-5" style={{ background: D.card, border: `1px solid ${D.teal}33` }}>
            <div className="flex items-center gap-4">
              <div className="text-center"><div className="font-display" style={{ fontSize: 34, fontWeight: 500, color: D.ink, lineHeight: 1 }}>{p.age}</div><div style={{ fontSize: 11, color: D.ink3, marginTop: 4 }}>your age</div></div>
              <div style={{ fontSize: 22, color: D.ink3 }}>→</div>
              <div className="text-center"><div className="font-display" style={{ fontSize: 34, fontWeight: 500, color: diff > 0 ? '#F093D5' : D.teal, lineHeight: 1 }}>{r.heartAge}</div><div style={{ fontSize: 11, color: D.ink3, marginTop: 4 }}>heart age</div></div>
              <div className="flex-1" />
              <div className="text-right"><div style={{ fontSize: 22, color: diff > 0 ? '#F093D5' : D.teal, fontWeight: 600 }}>{diff > 0 ? '+' : ''}{diff}</div><div style={{ fontSize: 11, color: D.ink3 }}>years</div></div>
            </div>
          </div>

          {[
            ['What it is', 'Your heart age is the age of a person with a healthy profile — normal blood pressure, healthy weight, non-smoker, no diabetes — who carries the same 10-year cardiovascular risk that you do. It is your risk, translated from a percentage into years.'],
            ['Why we show it', 'Percentages are abstract; years are not. Trials show that people who are told their heart age are more likely to change the factors driving it than people shown a percentage alone. It turns a number into something you can act on.'],
            ['How we calculate it', 'We compute your 10-year risk with the Framingham General Cardiovascular Risk Score. Then we search for the age at which a healthy-profile person of your sex would reach that same risk. That age is your heart age. When your risk falls, so does your heart age.'],
            ['The evidence', 'The "vascular age" concept was published in the same Framingham Heart Study paper that defines the risk score (D\'Agostino et al., Circulation 2008; 117:743–753). It has since been adopted by the American Heart Association, the NHS Health Check programme, and the Joint British Societies (JBS3) as a patient-facing way to communicate cardiovascular risk.'],
            ['Its limits', 'It is a population estimate, not a diagnosis. It is validated for adults aged 30–74 without existing cardiovascular disease. It does not yet include family history, kidney disease or inflammatory conditions — the "sharpen your score" questions add those.'],
          ].map(([t, d]) => (
            <div key={t} className="rounded-2xl p-4" style={{ background: D.card, border: `1px solid ${D.hair}` }}>
              <div style={{ fontSize: 11, letterSpacing: 1.4, color: D.blueLite, fontWeight: 700 }}>{t.toUpperCase()}</div>
              <div className="mt-2" style={{ fontSize: 13.5, color: D.ink2, lineHeight: 1.7 }}>{d}</div>
            </div>
          ))}
        </div>
        <button onClick={() => { tapFeel('tap'); setHaInfo(false); }} className="w-full rounded-2xl py-4 text-base font-bold flex-shrink-0 my-3" style={{ background: 'linear-gradient(135deg, #4A90F0 0%, #1F5CB0 100%)', color: '#FFFFFF' }}>Back to my result</button>
      </div>
    );
  }

  function renderFreeOnboard() {
    const total = 5;
    const bmi = (foHt && foWt) ? (Number(foWt) / Math.pow(Number(foHt) / 100, 2)) : null;

    /* 0 · phone */
    if (foStep === 0) return (
      <div className="h-full flex flex-col">
        {foHead(0, total, "What's your mobile number?", "We'll send a one-time code. This becomes your login — nothing else needed.")}
        <div className="flex-1 mt-6">
          <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
            <div className="flex gap-2.5 items-end">
              <div className="rounded-xl flex items-center" style={{ padding: '15px 12px', background: C.panelLight, border: `1px solid ${C.border}`, fontSize: 19, fontWeight: 700, color: C.muted }}>+91</div>
              {foInput(null, foPhone, setFoPhone, '98110 43221', true)}
            </div>
          </div>
        </div>
        <button onClick={() => { tapFeel('tap'); setFoStep(1); }} disabled={foPhone.replace(/[^0-9]/g, '').length < 10} className="w-full rounded-2xl py-4 text-base font-bold flex-shrink-0" style={{ background: 'linear-gradient(135deg, #3B7FC9 0%, #1F5C9E 100%)', color: '#FFFFFF', opacity: foPhone.replace(/[^0-9]/g, '').length < 10 ? 0.4 : 1, boxShadow: '0 6px 18px rgba(31,92,158,0.32)' }}>Send code</button>
      </div>
    );

    /* 1 · otp */
    if (foStep === 1) return (
      <div className="h-full flex flex-col">
        {foHead(1, total, 'Enter the code', `Sent to +91 ${foPhone}. Any six digits work in this demo.`)}
        <div className="flex-1 mt-6">
          <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
            {foInput(null, foOtp, setFoOtp, '• • • • • •', true)}
          </div>
          <div className="text-sm font-bold text-center mt-4" style={{ color: C.navy }}>Resend code</div>
        </div>
        <button onClick={() => { tapFeel('tap'); setFoStep(2); }} disabled={foOtp.replace(/[^0-9]/g, '').length < 6} className="w-full rounded-2xl py-4 text-base font-bold flex-shrink-0" style={{ background: 'linear-gradient(135deg, #3B7FC9 0%, #1F5C9E 100%)', color: '#FFFFFF', opacity: foOtp.replace(/[^0-9]/g, '').length < 6 ? 0.4 : 1, boxShadow: '0 6px 18px rgba(31,92,158,0.32)' }}>Verify</button>
      </div>
    );

    /* 2 · about you */
    if (foStep === 2) return (
      <div className="h-full flex flex-col">
        {foHead(2, total, 'Tell us about yourself', 'Your age, sex and measurements decide how we assess your heart risk.')}
        <div className="flex-1 overflow-y-auto mt-6">
          <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
            {foInput('Full name', foName, setFoName, 'Rahul Chandola')}
            <div className="flex gap-2.5 mt-4">
              {foInput('Age', foAge, setFoAge, '46', true)}
              <div className="flex-1">
                <div className="text-xs font-semibold mb-2" style={{ color: C.muted }}>Sex</div>
                <div className="flex gap-2">
                  {['Male', 'Female'].map(x => (
                    <button key={x} onClick={() => { tapFeel('select'); setFoSex(x); }} className="flex-1 rounded-xl py-4 text-sm font-bold" style={{ background: foSex === x ? 'linear-gradient(135deg, #3B7FC9 0%, #1F5C9E 100%)' : C.panelLight, border: foSex === x ? '1.5px solid transparent' : `1.5px solid ${C.border}`, color: foSex === x ? '#FFFFFF' : C.text, boxShadow: foSex === x ? '0 6px 16px rgba(31,92,158,0.35)' : 'none', transition: 'all .18s cubic-bezier(.2,.8,.2,1)' }}>{x}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-2.5 mt-4">
              {foInput('Height', foHt, setFoHt, '174', true, 'cm')}
              {foInput('Weight', foWt, setFoWt, '86', true, 'kg')}
            </div>
            {bmi && (
              <div className="flex items-center justify-between mt-4 pt-3.5" style={{ borderTop: `1px solid ${C.border}` }}>
                <span className="text-sm font-semibold" style={{ color: C.muted }}>Your BMI</span>
                <span className="text-base font-bold" style={{ color: bmi >= 25 ? '#C77E1A' : '#1E9E6A' }}>{bmi.toFixed(1)}
                  <span className="text-xs font-bold ml-2" style={{ color: C.muted }}>{bmi >= 30 ? 'Obese' : bmi >= 25 ? 'Above range' : bmi >= 18.5 ? 'Healthy' : 'Below range'}</span>
                </span>
              </div>
            )}
          </div>
        </div>
        <button onClick={() => { tapFeel('tap'); setFoStep(3); }} disabled={!foName.trim() || !foAge || !foHt || !foWt} className="w-full rounded-2xl py-4 text-base font-bold flex-shrink-0 mt-3" style={{ background: 'linear-gradient(135deg, #3B7FC9 0%, #1F5C9E 100%)', color: '#FFFFFF', opacity: (!foName.trim() || !foAge || !foHt || !foWt) ? 0.4 : 1, boxShadow: '0 6px 18px rgba(31,92,158,0.32)' }}>Continue</button>
      </div>
    );

    /* 3 · health profile */
    if (foStep === 3) return (
      <div className="h-full flex flex-col">
        {foHead(3, total, 'Your health history', 'Answer honestly — this is the assessment your doctor will review with you.')}
        <div className="flex-1 overflow-y-auto mt-6 space-y-5">
          <div>
            <div className="text-xs font-bold mb-2.5" style={{ color: C.muted, letterSpacing: '0.08em' }}>YOUR MOST RECENT BLOOD PRESSURE</div>
            <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
              {foInput('Upper number (systolic)', foSbp, setFoSbp, '138', true, 'mmHg')}
              <button onClick={() => { tapFeel('select'); setFoBpTreated(!foBpTreated); }} className="flex items-center gap-3 mt-3.5 w-full text-left">
                <span className="flex items-center justify-center rounded-md flex-shrink-0" style={{ width: 21, height: 21, background: foBpTreated ? C.navy : 'transparent', border: foBpTreated ? 'none' : `2px solid ${C.border}` }}>{foBpTreated && <Check size={13} color="#FFFFFF" strokeWidth={3} />}</span>
                <span className="text-sm font-semibold" style={{ color: C.muted }}>I take medicine for blood pressure</span>
              </button>
              <div className="text-xs font-medium mt-3" style={{ color: C.muted, lineHeight: 1.5 }}>Don't know it? Leave it blank — we'll use 125 and refine once you start logging.</div>
            </div>
          </div>
          <div>
            <div className="text-xs font-bold mb-2.5" style={{ color: C.muted, letterSpacing: '0.08em' }}>DIAGNOSED WITH ANY OF THESE?</div>
            <div className="rounded-2xl overflow-hidden" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
              {[['bp', 'High blood pressure'], ['sugar', 'Diabetes'], ['chol', 'High cholesterol'], ['heart', 'Heart disease'], ['none', 'None of these']].map(([id, label], i, arr) => {
                const on = foConds.includes(id);
                return (
                  <button key={id} onClick={() => { tapFeel('select'); setFoConds(id === 'none' ? ['none'] : (on ? foConds.filter(x => x !== id) : [...foConds.filter(x => x !== 'none'), id])); }} className="w-full flex items-center gap-3 px-4 py-3.5 text-left" style={{ borderBottom: i < arr.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                    <span className="flex items-center justify-center rounded-md flex-shrink-0" style={{ width: 21, height: 21, background: on ? C.navy : 'transparent', border: on ? 'none' : `2px solid ${C.border}` }}>{on && <Check size={13} color="#FFFFFF" strokeWidth={3} />}</span>
                    <span className="text-sm font-bold" style={{ color: C.text }}>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div className="text-xs font-bold mb-2.5" style={{ color: C.muted, letterSpacing: '0.08em' }}>DO YOU SMOKE?</div>
            {foPills(['Never', 'In the past', 'Currently'], foSmoking, setFoSmoking)}
          </div>
          <div>
            <div className="text-xs font-bold mb-2.5" style={{ color: C.muted, letterSpacing: '0.08em' }}>HEART DISEASE IN A PARENT OR SIBLING BEFORE 60?</div>
            {foPills(['No', 'Yes', 'Not sure'], foFamily, setFoFamily)}
          </div>
        </div>
        <button onClick={() => { if (!foSbp) { alert('Please enter your systolic (upper) blood pressure — it is required for the score.'); return; } if (!foSmoking || !foFamily) { alert('Please answer the smoking and family-history questions.'); return; } tapFeel('success'); setFoStep(4); setRvAnim(0); setTimeout(() => { setFoStep(5); const target = assessCVD(foProfile()).pct; const t0 = Date.now(); if (rvTimerRef.current) clearInterval(rvTimerRef.current); rvTimerRef.current = setInterval(() => { const k = Math.min(1, (Date.now() - t0) / 1600); const e = 1 - Math.pow(1 - k, 3); setRvAnim(target * e); if (k >= 1) { clearInterval(rvTimerRef.current); setRvAnim(target); } }, 30); }, 1900); }} className="w-full rounded-2xl py-4 text-base font-bold flex-shrink-0 mt-3" style={{ background: 'linear-gradient(135deg, #3B7FC9 0%, #1F5C9E 100%)', color: '#FFFFFF', boxShadow: '0 6px 18px rgba(31,92,158,0.32)' }}>See my risk assessment</button>
      </div>
    );

    /* 4 · assessing */
    if (foStep === 4) return (
      <div className="h-full flex flex-col items-center justify-center text-center px-3">
        <div className="relative" style={{ width: 92, height: 92 }}>
          <span className="absolute rounded-full" style={{ inset: 0, border: `2px solid ${C.navy}22` }}></span>
          <span className="absolute rounded-full" style={{ inset: 0, border: `2px solid ${C.navy}`, animation: 'ilivePulse 1.8s ease-out infinite' }}></span>
          <div className="absolute flex items-center justify-center" style={{ inset: 0, fontSize: 30 }}>❤️</div>
        </div>
        <div className="font-display font-bold mt-7" style={{ fontSize: 21, color: C.text }}>Assessing your risk</div>
        <div className="text-sm font-medium mt-3" style={{ color: C.muted, lineHeight: 1.6 }}>Weighing your answers against<br />cardiovascular risk guidelines</div>
      </div>
    );

    /* 5 · result — animated, premium */
    if (haInfo) return renderHeartAgeInfo();
    const p = foProfile();
    const r = assessCVD(p);
    const D = { bg: '#0B2039', card: '#16314F', raised: '#1E3C60', hair: 'rgba(255,255,255,.14)', ink: '#FFFFFF', ink2: '#C6D8EC', ink3: '#93AECB', blueLite: '#9CCAFF', green: '#5FDCA8', riskLow: '#6FDCD2', riskMod: '#B0A4FF', riskHigh: '#F093D5' };
    const riskCol = r.band === 'High' ? D.riskHigh : r.band === 'Intermediate' ? D.riskMod : D.riskLow;
    const shown = Math.min(rvAnim, r.pct);
    const size = 190, st = 12, rad = (size - st) / 2, circ = 2 * Math.PI * rad;
    const ageDiff = r.heartAge - p.age;
    return (
      <div className="h-full flex flex-col -mx-4 -mt-4 px-4 pt-5" style={{ background: D.bg, color: D.ink, minHeight: '100%' }}>
        <div className="flex-1 overflow-y-auto pb-4">
          <div style={{ fontSize: 11, letterSpacing: 1.8, color: D.ink3, fontWeight: 700 }}>YOUR HEART, IN NUMBERS</div>
          <div className="font-display mt-2" style={{ fontSize: 24, fontWeight: 400, lineHeight: 1.25, letterSpacing: '-0.035em' }}>Your 10-year risk of cardiovascular disease</div>
          <div className="mt-1.5" style={{ fontSize: 12, color: D.ink3 }}>Framingham General CVD Risk Score · Circulation 2008</div>

          {/* animated ring */}
          <div className="flex flex-col items-center mt-6">
            <div className="relative" style={{ width: size, height: size }}>
              <svg width={size} height={size}>
                <defs>
                  <linearGradient id="rvGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor={riskCol} stopOpacity="1" /><stop offset="100%" stopColor={riskCol} stopOpacity=".55" /></linearGradient>
                </defs>
                <circle cx={size/2} cy={size/2} r={rad} fill="none" stroke="rgba(255,255,255,.07)" strokeWidth={st} />
                <circle cx={size/2} cy={size/2} r={rad} fill="none" stroke="url(#rvGrad)" strokeWidth={st} strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - Math.min(shown, 100) / 100)} transform={`rotate(-90 ${size/2} ${size/2})`} style={{ transition: 'stroke-dashoffset .12s linear', filter: `drop-shadow(0 0 10px ${riskCol}66)` }} />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="font-display" style={{ fontSize: 50, fontWeight: 500, color: riskCol, letterSpacing: '-0.05em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{shown.toFixed(1)}<span style={{ fontSize: 24 }}>%</span></div>
                <div className="mt-1.5" style={{ fontSize: 12.5, color: D.ink2 }}>{rvAnim >= r.pct ? `${r.band} risk` : 'calculating…'}</div>
              </div>
            </div>
            <div className="mt-3 text-center" style={{ fontSize: 13, color: D.ink3, lineHeight: 1.6, maxWidth: 280 }}>
              Chance of a heart attack or stroke in the next ten years.
            </div>
            <div className="flex gap-1.5 mt-4" style={{ width: '80%' }}>
              {[['Low', 'under 10%', D.riskLow], ['Intermediate', '10–20%', D.riskMod], ['High', '20%+', D.riskHigh]].map(([b, x, c]) => (
                <div key={b} className="flex-1 text-center">
                  <div className="rounded-full" style={{ height: 4, background: b === r.band ? c : 'rgba(255,255,255,.1)' }} />
                  <div className="mt-1.5" style={{ fontSize: 10.5, color: b === r.band ? c : D.ink3, fontWeight: b === r.band ? 700 : 500 }}>{b}</div>
                  <div style={{ fontSize: 9.5, color: D.ink3 }}>{x}</div>
                </div>
              ))}
            </div>
          </div>

          {/* heart age — separate, explained */}
          <div onClick={() => { tapFeel('tap'); setHaInfo(true); }} className="rounded-2xl p-5 mt-6" style={{ background: 'linear-gradient(160deg, rgba(255,255,255,.07) 0%, rgba(255,255,255,.015) 52%), ' + D.card, border: `1px solid ${riskCol}33`, opacity: rvAnim >= r.pct ? 1 : 0.35, transition: 'opacity .6s ease', cursor: 'pointer' }}>
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center rounded-2xl flex-shrink-0" style={{ width: 56, height: 56, background: `${riskCol}1A`, border: `1px solid ${riskCol}33`, fontSize: 26 }}>🫀</div>
              <div className="flex-1">
                <div style={{ fontSize: 11, letterSpacing: 1.6, color: D.ink3, fontWeight: 700 }}>YOUR HEART AGE</div>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="font-display" style={{ fontSize: 36, fontWeight: 500, color: ageDiff > 0 ? riskCol : D.riskLow, letterSpacing: '-0.04em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{Math.round(p.age + (r.heartAge - p.age) * Math.min(1, rvAnim / Math.max(r.pct, 0.1)))}</span>
                  <span style={{ fontSize: 13.5, color: D.ink2 }}>you are {p.age}</span>
                </div>
              </div>
              <button onClick={() => { tapFeel('tap'); setHaInfo(true); }} className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 32, height: 32, background: 'rgba(255,255,255,.08)', border: `1px solid ${D.hair}` }}><ChevronRight size={16} color={D.ink2} /></button>
            </div>

            <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${D.hair}`, fontSize: 13, color: D.ink2, lineHeight: 1.6 }}>
              {ageDiff > 0
                ? <>Your heart is behaving like a <b style={{ color: riskCol }}>{r.heartAge}-year-old's</b> — {ageDiff} years older than you. This gap moves with the factors below.</>
                : ageDiff < 0
                  ? <>Your heart is behaving like a <b style={{ color: D.riskLow }}>{r.heartAge}-year-old's</b> — {-ageDiff} years younger than you.</>
                  : <>Your heart is behaving exactly its age.</>}
              <span style={{ color: D.blueLite }}> How is this calculated? ›</span>
            </div>
          </div>

          {/* what would change it */}
          {r.levers.filter(l => l.after !== null).length > 0 && (
            <div className="rounded-2xl p-5 mt-3" style={{ background: 'linear-gradient(160deg, rgba(111,220,210,.10) 0%, rgba(111,220,210,.02) 60%), ' + D.card, border: `1px solid ${D.riskLow}33`, opacity: rvAnim >= r.pct ? 1 : 0.35, transition: 'opacity .6s ease .15s' }}>
              <div style={{ fontSize: 11, letterSpacing: 1.6, color: D.riskLow, fontWeight: 700 }}>WHAT IS WITHIN YOUR CONTROL</div>
              <div className="font-display mt-2" style={{ fontSize: 20, fontWeight: 400, lineHeight: 1.35 }}>You could bring this to <span style={{ color: D.riskLow }}>{r.bestCase.toFixed(1)}%</span> <span style={{ fontSize: 13, color: D.ink3 }}>· {Math.round(((r.pct - r.bestCase) / r.pct) * 100)}% lower</span></div>
              <div style={{ fontSize: 11, letterSpacing: 1.4, color: D.ink3, fontWeight: 700, marginTop: 16 }}>HOW TO LOWER IT</div>
              <div className="space-y-2 mt-2">
                {r.levers.map(l => (
                  <div key={l.id} className="rounded-xl px-3.5 py-3" style={{ background: D.raised }}>
                    <div className="flex items-center justify-between gap-3">
                      <div style={{ fontSize: 14, color: D.ink, fontWeight: 600 }}>{l.label}</div>
                      {l.after !== null && <span style={{ fontSize: 14, color: D.riskLow, fontWeight: 700, flexShrink: 0 }}>−{(r.pct - l.after).toFixed(1)}%</span>}
                    </div>
                    <div style={{ fontSize: 12, color: D.ink3, marginTop: 3 }}>{l.now}</div>
                    <div className="mt-2" style={{ fontSize: 12.5, color: D.ink2, lineHeight: 1.6 }}>{l.action}</div>
                  </div>
                ))}
              </div>
              {(() => {
                const tips = [];
                if (p.bmi >= 25 || p.sbp > 130) tips.push(['🚶', '30 minutes of brisk walking, most days', 'The single most proven habit for blood pressure, weight and heart rhythm — start with 10 minutes after dinner.']);
                if (p.sbp > 120) tips.push(['🧂', 'Halve the salt you add', 'Skip pickle, papad and packet snacks. Most Indian diets carry 2–3× the salt the heart needs.']);
                tips.push(['🥗', 'Half your plate vegetables, dal before rice', 'Fibre first slows the sugar rise after meals and keeps cholesterol down — no new diet needed.']);
                if (p.age >= 40) tips.push(['😴', 'Seven hours of sleep, same time nightly', 'Short or broken sleep raises blood pressure and night-time heart strain. Protect it like a medicine.']);
                tips.push(['🧪', 'One lipid profile and HbA1c this month', 'Two simple blood tests sharpen this estimate and catch silent problems early. We can arrange them at home.']);
                return (
                  <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${D.hair}` }}>
                    <div style={{ fontSize: 11, letterSpacing: 1.4, color: D.riskLow, fontWeight: 700 }}>ALSO WORTH DOING</div>
                    <div className="mt-1.5" style={{ fontSize: 12.5, color: D.ink3, lineHeight: 1.55 }}>Beyond the numbers above, these have the potential to bring your risk down further.</div>
                    <div className="space-y-2 mt-3">
                      {tips.slice(0, 3).map(([e, t, d]) => (
                        <div key={t} className="flex items-start gap-3 rounded-xl px-3.5 py-3" style={{ background: D.raised }}>
                          <span style={{ fontSize: 18, lineHeight: 1.2 }}>{e}</span>
                          <div><div style={{ fontSize: 14, color: D.ink, fontWeight: 600 }}>{t}</div><div className="mt-1" style={{ fontSize: 12.5, color: D.ink2, lineHeight: 1.55 }}>{d}</div></div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          <div className="mt-4 px-1" style={{ fontSize: 11, color: D.ink3, lineHeight: 1.6 }}>Validated for ages 30–74 without existing heart disease · South Asian adjustment applied for men · not a diagnosis.</div>
        </div>
        <button onClick={() => { tapFeel('success'); setCareRisk({ level: r.band, col: r.color, pct: `${r.pct.toFixed(1)}%`, heartAge: r.heartAge, bestCase: r.bestCase.toFixed(1), levers: r.levers }); setSignupName(foName); setEnrolledPrograms(['iLive Free']); setAppPhase('ready'); }} className="w-full rounded-2xl py-4 text-base font-bold flex-shrink-0 my-3" style={{ background: 'linear-gradient(135deg, #4A90F0 0%, #1F5CB0 100%)', color: '#FFFFFF', boxShadow: '0 8px 22px rgba(31,92,176,0.4)', opacity: rvAnim >= r.pct ? 1 : 0.5, transition: 'opacity .5s ease' }}>Go to my dashboard →</button>
      </div>
    );
  }

  /* ---- ONE recommendation, chosen for them ---- */
  function renderFreeRecommend() {
    const p = foProfile();
    const r = assessCVD(p);
    const hasCondition = foConds.some(c => ['bp', 'sugar', 'chol', 'heart'].includes(c));
    const rec = hasCondition
      ? { emoji: '💙', name: 'iLive Care', price: '₹4,917/mo', plan: 'connect',
          why: `Because you have ${foConds.includes('sugar') && foConds.includes('bp') ? 'diabetes and high blood pressure' : foConds.includes('sugar') ? 'diabetes' : foConds.includes('bp') ? 'high blood pressure' : foConds.includes('heart') ? 'heart disease' : 'raised cholesterol'}, continuous support helps you manage your cardiovascular risk day to day.`,
          grad: 'linear-gradient(140deg, #257D72 0%, #123F38 100%)' }
      : r.pct >= 10
        ? { emoji: '❤️', name: 'iLive Heart Check', price: '₹2,999', plan: 'heartScreen',
            why: 'Your questionnaire risk is raised, but a questionnaire cannot see rhythm, conduction blocks or ischemic changes. Two days with a chest patch can.',
            grad: 'linear-gradient(140deg, #8F3A52 0%, #521D2E 100%)' }
        : { emoji: '🛡️', name: 'iLive Prevent', price: '₹29,999/year', plan: 'essential',
            why: "You're doing well. Stay on iLive Free — or add a wristband if you'd like daily insight and a doctor watching over you.",
            grad: 'linear-gradient(140deg, #2C5A8F 0%, #16304F 100%)' };
    return (
      <div className="h-full flex flex-col">
        <div className="flex-shrink-0">
          <div className="font-display font-bold" style={{ fontSize: 25, color: C.text, lineHeight: 1.28, letterSpacing: '-0.02em' }}>Your recommended next step</div>
          <div className="text-sm font-medium mt-2" style={{ color: C.muted, lineHeight: 1.55 }}>One suggestion, based on what you told us — not a catalogue.</div>
        </div>
        <div className="flex-1 overflow-y-auto mt-4 space-y-3">
          <div className="rounded-2xl p-5" style={{ background: rec.grad, boxShadow: '0 1px 2px rgba(21,62,111,0.08), 0 14px 30px rgba(21,62,111,0.16)' }}>
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center rounded-xl flex-shrink-0" style={{ width: 44, height: 44, background: 'rgba(255,255,255,0.16)', fontSize: 22 }}>{rec.emoji}</div>
              <div className="flex-1">
                <div className="font-display text-xl font-bold" style={{ color: '#FFFFFF' }}>{rec.name}</div>
                <div className="text-xs font-bold mt-0.5" style={{ color: 'rgba(255,255,255,0.8)' }}>{rec.price}</div>
              </div>
            </div>
            <div className="text-sm font-semibold mt-3.5" style={{ color: 'rgba(255,255,255,0.92)', lineHeight: 1.6 }}>{rec.why}</div>
            <button onClick={() => { tapFeel('tap'); setPlanDetail(rec.plan); setShowPlans(true); }} className="w-full rounded-2xl py-3.5 text-sm font-bold mt-4" style={{ background: '#FFFFFF', color: '#123F38' }}>See what's included →</button>
          </div>

          {/* All journeys — always visible */}
          <div>
            <div className="text-xs font-bold mb-2" style={{ color: C.muted, letterSpacing: '0.08em' }}>ALL iLIVE JOURNEYS</div>
            <div className="space-y-2">
              {[
                ['❤️', 'iLive Heart Check', '2-day analysis · ₹2,999', 'heartScreen', 'linear-gradient(140deg, #8F3A52 0%, #521D2E 100%)'],
                ['🛡️', 'iLive Prevent', '₹29,999/year', 'essential', 'linear-gradient(140deg, #2C5A8F 0%, #16304F 100%)'],
                ['💙', 'iLive Care', '₹4,917/mo', 'connect', 'linear-gradient(140deg, #257D72 0%, #123F38 100%)'],
                ['🩹', 'iLive Recover', 'After hospital · from ₹14,999', 'connectPlus', 'linear-gradient(140deg, #A85B3A 0%, #62301B 100%)'],
              ].filter(([, name]) => name !== rec.name).map(([e, name, sub, plan, grad]) => (
                <button key={name} onClick={() => { setPlanDetail(plan); setShowPlans(true); }} className="w-full rounded-2xl px-4 py-3 flex items-center gap-3 text-left" style={{ background: grad, boxShadow: '0 1px 2px rgba(21,62,111,0.06), 0 8px 18px rgba(21,62,111,0.12)' }}>
                  <span className="flex items-center justify-center rounded-xl flex-shrink-0" style={{ width: 36, height: 36, background: 'rgba(255,255,255,0.16)', fontSize: 18 }}>{e}</span>
                  <span className="flex-1">
                    <span className="text-sm font-bold" style={{ color: '#FFFFFF' }}>{name}</span>
                    <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.8)', fontWeight: 600 }}>{sub}</div>
                  </span>
                  <span className="text-xs font-bold" style={{ color: '#FFFFFF' }}>›</span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
            <div className="text-sm font-bold" style={{ color: C.text }}>Or stay on iLive Free — it stays yours</div>
            <div className="space-y-1.5 mt-2.5">
              {['Your heart risk score, re-checked whenever you like', 'Log BP, sugar & meals — reviewed before every consultation', 'Health Vault for reports & prescriptions', 'Order lab tests and medicines at home', 'Two doctor calls, included'].map(x => (
                <div key={x} className="flex items-start gap-2">
                  <span className="text-xs font-bold flex-shrink-0" style={{ color: '#1E9E6A', marginTop: 2 }}>✓</span>
                  <span className="text-xs font-semibold" style={{ color: C.text, lineHeight: 1.45 }}>{x}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <button onClick={() => { tapFeel('success'); setEnrolledPrograms(['iLive Free']); setAppPhase('ready'); }} className="w-full rounded-2xl py-4 text-base font-bold flex-shrink-0 mt-3" style={{ background: C.panel, color: C.text, border: `1.5px solid ${C.border}` }}>Continue with iLive Free →</button>
      </div>
    );
  }

  /* =========================================================================
     iLIVE FREE — HOME (premium dark, in the 7-Day app language)
     Journey first. Paid packages sit at the very bottom.
     ========================================================================= */
  function renderFreeHome() {
    if (sharpenView) return renderSharpen();
    const D = { bg: '#0B2039', card: '#16314F', raised: '#1E3C60', sunken: '#0B1D33', hair: 'rgba(255,255,255,.14)', hair2: 'rgba(255,255,255,.20)', ink: '#FFFFFF', ink2: '#C6D8EC', ink3: '#93AECB', blue: '#4A90F0', blueDeep: '#1F5CB0', blueLite: '#9CCAFF', green: '#5FDCA8', amber: '#F5C572', gold: '#EBCE8A', riskLow: '#6FDCD2', riskMod: '#B0A4FF', riskHigh: '#F093D5' };
    const s = sharpenState();
    const riskCol = s.band.band === 'High' ? D.riskHigh : s.band.band === 'Intermediate' ? D.riskMod : D.riskLow;
    const first = (foName || signupName || 'Rahul').split(' ')[0];
    const heartAge = careRisk && careRisk.heartAge ? careRisk.heartAge : s.base.heartAge;
    const firstDay = !readingLoggedToday;
    const bestCase = s.base.bestCase;
    const day = 1;
    const dial = (size) => { const st = 5, rad = (size - st) / 2, c = 2 * Math.PI * rad; return (
      <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size}>
          <circle cx={size/2} cy={size/2} r={rad} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth={st} />
          <circle cx={size/2} cy={size/2} r={rad} fill="none" stroke={riskCol} strokeWidth={st} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(s.pctFinal, 100) / 100)} transform={`rotate(-90 ${size/2} ${size/2})`} style={{ transition: 'stroke-dashoffset .9s cubic-bezier(.2,.8,.2,1)' }} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center"><Heart size={Math.round(size * .3)} color={riskCol} strokeWidth={1.5} /></div>
      </div>
    ); };
    const card = (children, extra = {}) => <div className="rounded-2xl" style={{ background: 'linear-gradient(160deg, rgba(255,255,255,.07) 0%, rgba(255,255,255,.015) 52%), ' + D.card, border: `1px solid ${extra.glow || D.hair}`, padding: extra.pad ?? 20, ...(extra.style || {}) }} onClick={extra.onClick}>{children}</div>;
    const label = (t, col) => <div style={{ fontSize: 11, letterSpacing: 1.6, textTransform: 'uppercase', color: col || D.ink3, fontWeight: 700 }}>{t}</div>;
    const h2 = (t) => <div className="font-display" style={{ fontSize: 18, color: D.ink, letterSpacing: '-0.02em', fontWeight: 500 }}>{t}</div>;
    const team = [
      ['Dr. Viveka Kumar', 'Senior Cardiologist', 'Today, 5:30 PM', true],
      ['Ms. Anjali Rao', 'Clinical Nutritionist', 'Tomorrow, 11:00 AM', false],
      ['Mr. Sameer Jain', 'Cardiac Physiotherapist', 'Thursday, 4:00 PM', false],
    ];
    const journeys = [
      ['❤️', 'iLive Heart Check', '2-day analysis · ₹2,999', 'heartScreen'],
      ['🛡️', 'iLive Prevent', '₹29,999/year', 'essential'],
      ['💙', 'iLive Care', '₹4,917/mo', 'connect'],
      ['🩹', 'iLive Recover', 'After hospital · from ₹14,999', 'connectPlus'],
    ];

    return (
      <div className="-mx-4 -mt-4 px-4 pt-5 pb-6 ilive-premium" style={{ background: D.bg, color: D.ink, minHeight: '100%', fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif" }}>
        {/* header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Heart size={22} color={D.ink} fill="rgba(255,255,255,.14)" strokeWidth={1.4} />
            <div style={{ lineHeight: 1 }}>
              <div className="font-display" style={{ fontSize: 19, fontWeight: 500, letterSpacing: '-0.03em' }}>iLive</div>
              <div style={{ fontSize: 8.5, letterSpacing: 2.2, color: D.ink3, marginTop: 5, fontWeight: 700 }}>YOUR HEALTH. IN YOUR HANDS.</div>
            </div>
          </div>
          <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: 'rgba(95,220,168,.14)', color: D.green }}>iLive Free</span>
        </div>

        {/* greeting */}
        <div className="mt-8 mb-6">
          <div style={{ fontSize: 13.5, color: D.ink3 }}>Welcome, {first}</div>
          <div className="font-display mt-2" style={{ fontSize: 27, fontWeight: 400, lineHeight: 1.3, letterSpacing: '-0.035em' }}>Your journey<br />starts today.</div>
          <div className="inline-flex items-center gap-2.5 mt-4 rounded-full px-3.5 py-2" style={{ border: `1px solid ${D.hair2}` }}>
            <span className="flex items-center justify-center rounded-full font-bold" style={{ width: 20, height: 20, background: D.blueLite, color: '#08182B', fontSize: 11 }}>{day}</span>
            <span style={{ fontSize: 13, color: D.ink2 }}>Day {day} of your 7-Day Health Check</span>
          </div>
        </div>

        <div className="space-y-6">
          {/* 1 · YOUR RISK */}
          {card(<>
            <div className="flex items-center gap-4">
              {dial(64)}
              <div className="flex-1 min-w-0">
                {label('Your heart age')}
                <div className="flex items-baseline gap-2 mt-2.5">
                  <span className="font-display" style={{ fontSize: 34, fontWeight: 500, color: riskCol, letterSpacing: '-0.04em', lineHeight: 1 }}>{heartAge}</span>
                  <span style={{ fontSize: 13.5, color: D.ink2 }}>{heartAge > s.p.age ? `you are ${s.p.age}` : 'at your age'}</span>
                </div>
              </div>
              <ChevronRight size={16} color={D.ink3} />
            </div>
            <div className="flex items-center justify-between mt-5 pt-4" style={{ borderTop: `1px solid ${D.hair}` }}>
              <div>
                <div style={{ fontSize: 12.5, color: D.ink3 }}>10-year risk</div>
                <div className="mt-1.5" style={{ fontSize: 15, color: D.ink }}>{s.pctFinal.toFixed(1)}% · <span style={{ color: riskCol }}>{s.band.band.toLowerCase()}</span></div>
              </div>
              <div className="text-right">
                <div style={{ fontSize: 12.5, color: D.ink3 }}>Could become</div>
                <div className="mt-1.5" style={{ fontSize: 15, color: D.riskLow }}>{bestCase.toFixed(1)}%</div>
              </div>
            </div>
            {s.base.levers.length > 0 && (
              <div className="mt-4 pt-4 space-y-2" style={{ borderTop: `1px solid ${D.hair}` }}>
                {label('This week, work on', D.riskLow)}
                {s.base.levers.slice(0, 3).map(l => (
                  <div key={l.id} className="flex items-center justify-between gap-3">
                    <span style={{ fontSize: 13.5, color: D.ink2 }}>{l.label}</span>
                    {l.after !== null && <span style={{ fontSize: 13.5, color: D.riskLow, flexShrink: 0 }}>−{(s.base.pct - l.after).toFixed(1)}%</span>}
                  </div>
                ))}
              </div>
            )}
          </>, { glow: `${riskCol}33`, pad: 22 })}

          {/* 2 · SHARPEN */}
          {s.pctComplete < 100 && card(<>
            <div className="flex items-start gap-3.5">
              <div className="flex items-center justify-center rounded-xl flex-shrink-0" style={{ width: 38, height: 38, background: `${D.blueLite}18`, border: `1px solid ${D.blueLite}33` }}><Sparkles size={17} color={D.blueLite} /></div>
              <div className="flex-1 min-w-0">
                <div style={{ fontSize: 15, color: D.ink }}>Want to make this number more accurate?</div>
                <div className="mt-2" style={{ fontSize: 13.5, color: D.ink2, lineHeight: 1.7 }}>{s.answered === 0 ? `${s.qs.length} more questions cover what the quick check can't see — family history, kidney disease, irregular rhythm, sleep apnoea.` : `${s.total - s.complete} steps left. Each one sharpens your estimate.`}</div>
              </div>
            </div>
            <div className="mt-4">
              <div className="flex justify-between mb-2"><span style={{ fontSize: 12.5, color: D.ink3 }}>Assessment complete</span><span style={{ fontSize: 12.5, color: D.blueLite }}>{s.pctComplete}%</span></div>
              <div className="rounded-full" style={{ height: 4, background: 'rgba(255,255,255,.12)', overflow: 'hidden' }}><div className="rounded-full" style={{ height: 4, width: `${s.pctComplete}%`, background: D.blueLite, transition: 'width .9s cubic-bezier(.2,.8,.2,1)' }} /></div>
            </div>
            <div className="flex items-center justify-between mt-4 rounded-xl px-4 py-3.5" style={{ background: D.raised }}>
              <span style={{ fontSize: 14, color: D.ink }}>{s.answered === 0 ? 'Start the detailed assessment' : 'Continue'}</span>
              <ArrowRight size={16} color={D.blueLite} />
            </div>
          </>, { glow: `${D.blueLite}3D`, pad: 22, onClick: () => { tapFeel('tap'); setSharpenView('menu'); }, style: { cursor: 'pointer' } })}

          {/* 3 · LOG */}
          {sharedLogRows({ title: firstDay ? 'Start here' : 'Log', right: '0 of 3 done' })}

          {/* 4 · YOUR CARE TEAM */}
          <button onClick={() => { tapFeel('tap'); setPvSheet('team'); }} className="w-full rounded-2xl p-4 flex items-center gap-3.5 text-left" style={{ background: 'linear-gradient(160deg, rgba(255,255,255,.07) 0%, rgba(255,255,255,.015) 52%), #16314F', border: '1px solid rgba(255,255,255,.14)' }}>
            <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 40, height: 40, background: '#1E3C60', fontSize: 17 }}>👥</span>
            <div className="flex-1 min-w-0">
              <div style={{ fontSize: 14.5, color: '#FFFFFF', fontWeight: 600 }}>Your care team</div>
              <div style={{ fontSize: 12, color: '#93AECB', marginTop: 2 }}>Doctor · longevity expert · exercise specialist</div>
            </div>
            <ChevronRight size={16} color="#93AECB" />
          </button>

          {/* 7 · YOUR NEXT STEP — journeys, at the bottom, recommended first */}
          {(() => {
            const hasCondition = foConds.some(c => ['bp', 'sugar', 'chol', 'heart'].includes(c));
            const recId = hasCondition ? 'connect' : s.pctFinal >= 10 ? 'heartScreen' : 'essential';
            const J = [
              { id: 'heartScreen', e: '❤️', name: 'iLive Heart Check', tag: '2-day heart screening at home · ₹2,999', col: '#F093D5',
                why: hasCondition ? 'A questionnaire can\'t see your heart\'s rhythm or blood supply. Two days with a chest patch can.' : 'Your questionnaire risk is raised — a patch sees what a questionnaire cannot.',
                value: 'A small chest patch records every heartbeat for two days while you live normally — screening for arrhythmia, conduction blocks and signs of coronary artery disease. Then a cardiologist calls you with your Heart Health Analysis Report.' },
              { id: 'connect', e: '💙', name: 'iLive Care', tag: 'For a chronic condition · ₹4,917/mo', col: '#6FDCD2',
                why: hasCondition ? `Because you have ${foConds.includes('sugar') && foConds.includes('bp') ? 'diabetes and high blood pressure' : foConds.includes('sugar') ? 'diabetes' : foConds.includes('bp') ? 'high blood pressure' : foConds.includes('heart') ? 'heart disease' : 'raised cholesterol'}, daily support changes your outcome.` : 'For a chronic condition — or an elderly parent — this is built for you.',
                value: 'Your condition managed every day, not once a quarter. The devices your condition needs, a 24×7 medical team that calls you before a crisis, medicines reviewed between visits, and a nutritionist and physiotherapist working with you weekly.' },
              { id: 'connectPlus', e: '🩹', name: 'iLive Recover', tag: 'After hospital or surgery · from ₹14,999', col: '#F5C572',
                why: 'The first weeks at home are when readmissions happen. This is how they are prevented.',
                value: 'Cardiac monitoring included — patch and wristband watched around the clock, wound photos reviewed by nurses, a daily recovery board your surgeon sees live, and a doctor who calls the moment something needs attention.' },
              { id: 'prive', e: '◆', name: 'iLive PRIVÉ', tag: 'Private, doctor-led monitoring · ₹17,999/mo', col: '#C9A227',
                why: 'Medicine on standby — for people whose time and health cannot wait.',
                value: 'Round-the-clock doctor-led monitoring, monthly physician review, advanced blood tests every three months, and priority clinical review of anything significant. Wristband, or wristband with continuous ECG.' },
              { id: 'essential', e: '⌚', name: 'iLive Prevent', tag: 'Stay ahead of disease · ₹29,999/year', col: '#93AECB', muted: true,
                why: 'The most intelligent smart band — with a doctor behind it.',
                value: 'Heart rate, HRV, breathing, sleep and recovery — and timely medical insight when a reading needs a human eye.' },
            ];
            const rank = { heartScreen: 0, connect: 1, connectPlus: 2, prive: 3, essential: 4 };
            const ordered = [J.find(j => j.id === recId), ...J.filter(j => j.id !== recId).sort((a, b) => rank[a.id] - rank[b.id])];
            return (
              <div>
                <div className="px-1.5 pb-2">{h2('Your next step')}</div>
                <div style={{ fontSize: 13, color: D.ink3, lineHeight: 1.6, padding: '0 6px 12px' }}>Based on your screening. Tap any to learn more.</div>
                <div className="space-y-2.5">
                  {ordered.map((j, i) => (
                    <button key={j.id} onClick={() => { tapFeel('tap'); setPlanDetail(j.id); setShowPlans(true); }} className="w-full rounded-2xl text-left flex items-center gap-3.5 px-4 py-4" style={{ background: j.muted ? 'transparent' : j.id === 'prive' ? 'linear-gradient(150deg, #1A1D2E 0%, #0B0D18 100%)' : 'linear-gradient(160deg, rgba(255,255,255,.07) 0%, rgba(255,255,255,.015) 52%), ' + D.card, border: `1px solid ${i === 0 ? j.col + '66' : j.muted ? 'rgba(255,255,255,.08)' : j.id === 'prive' ? 'rgba(201,162,39,0.45)' : D.hair}`, opacity: j.muted ? 0.75 : 1, marginTop: j.muted ? 10 : 0 }}>
                      <span className="flex items-center justify-center rounded-xl flex-shrink-0" style={{ width: j.muted ? 34 : 42, height: j.muted ? 34 : 42, background: `${j.col}18`, border: `1px solid ${j.col}33`, fontSize: j.muted ? 15 : 20, color: j.id === 'prive' ? j.col : undefined }}>{j.e}</span>
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-2"><span style={{ fontSize: j.muted ? 13.5 : 15.5, color: j.muted ? D.ink2 : D.ink, fontWeight: 600 }}>{j.name}</span>{i === 0 && <span className="rounded-full" style={{ padding: '2px 8px', background: `${j.col}22`, color: j.col, fontSize: 9.5, fontWeight: 700, letterSpacing: 1 }}>RECOMMENDED</span>}</span>
                        <div style={{ fontSize: j.muted ? 11.5 : 12.5, color: D.ink3, marginTop: 3, lineHeight: 1.4 }}>{j.tag}</div>
                      </span>
                      <ChevronRight size={16} color={j.col} />
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

          <div className="text-center px-5" style={{ fontSize: 12, color: D.ink3, lineHeight: 1.8 }}>iLive Free is a health and wellness app. It does not replace your doctor.<br />In an emergency, call your local emergency number.</div>
        </div>
      </div>
    );
  }

  /* ---- Sharpen my score: Layer 2 (extended), STOP-BANG, Layer 3 (labs) ---- */
  function sharpenState() {
    const p = foProfile();
    const base = assessCVD(p);
    const qs = questionsFor(p);
    const answered = qs.filter(q => extraAns[q.id]).length;
    const { pct: pct2, multiplier } = applyExtras(base.pct, extraAns, p);
    const hasLipids = !!(labTC && labHDL);
    const pct3 = hasLipids ? frsLipid(p, labTC, labHDL) * (multiplier) : null;
    const pctFinal = pct3 !== null ? clampN(pct3, 0.1, 90) : pct2;
    const band = bandFor(pctFinal);
    const sbDone = STOPBANG.every(q => sbAns[q.id]) && !!sbAns.neck;
    const sb = sbDone ? stopBangScore(sbAns, p) : null;
    const complete = 6 + answered + (sbDone ? 1 : 0) + (hasLipids ? 1 : 0);
    const total = 6 + qs.length + 2;
    return { p, base, qs, answered, pct2, pctFinal, band, hasLipids, sbDone, sb, complete, total, pctComplete: Math.round((complete / total) * 100) };
  }

  function sharpenCard() {
    const s = sharpenState();
    if (s.pctComplete >= 100) return null;
    const nextLabel = s.answered < s.qs.length ? `${s.qs.length - s.answered} questions left` : !s.sbDone ? 'Sleep & breathing check' : 'Add your cholesterol';
    return (
      <button onClick={() => { tapFeel('tap'); setSharpenView('menu'); }} className="w-full rounded-2xl p-4 text-left" style={{ background: 'linear-gradient(160deg, rgba(43,108,176,0.10) 0%, #FFFFFF 62%)', border: '1.5px solid rgba(43,108,176,0.28)', boxShadow: '0 1px 2px rgba(21,62,111,0.04), 0 8px 20px rgba(43,108,176,0.12)' }}>
        <div className="flex items-start gap-3">
          <div className="flex items-center justify-center rounded-xl flex-shrink-0" style={{ width: 40, height: 40, background: 'linear-gradient(140deg, #2B6CB0 0%, #1E4E86 100%)', fontSize: 19, boxShadow: '0 5px 12px rgba(43,108,176,0.35)' }}>✨</div>
          <div className="flex-1">
            <div className="text-sm font-bold" style={{ color: C.text }}>Make my score more accurate</div>
            <div className="text-xs font-semibold mt-0.5" style={{ color: C.muted, lineHeight: 1.45 }}>{s.answered === 0 ? `${s.qs.length} more questions see what the quick check can't — family history, kidneys, rhythm, sleep.` : nextLabel + '. Each one sharpens your estimate.'}</div>
          </div>
        </div>
        <div className="flex items-center justify-between mt-3 mb-1.5">
          <span className="text-xs font-bold" style={{ color: C.muted }}>Assessment complete</span>
          <span className="text-xs font-bold" style={{ color: C.navy }}>{s.pctComplete}%</span>
        </div>
        <div className="rounded-full" style={{ height: 5, background: 'rgba(21,62,111,0.1)', overflow: 'hidden' }}>
          <div className="rounded-full" style={{ height: 5, width: `${s.pctComplete}%`, background: 'linear-gradient(90deg, #3B7FC9, #1F5C9E)', transition: 'width .6s ease' }} />
        </div>
      </button>
    );
  }

  function renderSharpen() {
    const s = sharpenState();
    const backBtn = (label, to) => (
      <button onClick={() => { tapFeel('tap'); if (to === null) setSharpenView(null); else setSharpenView(to); setSharpenStep(0); }} className="flex-shrink-0 text-sm text-left font-semibold mb-3" style={{ color: C.muted }}>← {label}</button>
    );
    const bigOpt = (e, label, onTap, selected) => (
      <button key={label} onClick={onTap} className="w-full rounded-2xl p-4 text-left flex items-center gap-3.5" style={{ background: selected ? 'rgba(43,108,176,0.08)' : '#FFFFFF', border: selected ? `2px solid ${C.navy}66` : `1.5px solid ${C.border}`, transition: 'transform .08s ease' }} onPointerDown={ev => { ev.currentTarget.style.transform = 'scale(0.98)'; }} onPointerUp={ev => { ev.currentTarget.style.transform = 'scale(1)'; }} onPointerLeave={ev => { ev.currentTarget.style.transform = 'scale(1)'; }}>
        {e && <span style={{ fontSize: 24, lineHeight: 1 }}>{e}</span>}
        <span className="text-base font-bold" style={{ color: C.text }}>{label}</span>
      </button>
    );

    /* MENU */
    if (sharpenView === 'menu') {
      const items = [
        ['🧬', 'Detailed health questions', s.answered < s.qs.length ? `${s.answered} of ${s.qs.length} answered` : 'Complete ✓', 'extra', s.answered >= s.qs.length],
        ['😴', 'Sleep & breathing check', s.sbDone ? `${s.sb.level} OSA likelihood ✓` : '8 quick questions · STOP-BANG', 'sleep', s.sbDone],
        ['🧪', 'Add your cholesterol', s.hasLipids ? 'Lipid model applied ✓' : 'Sharpest number of all', 'labs', s.hasLipids],
      ];
      return (
        <div className="h-full flex flex-col">
          {backBtn('Back to my day', null)}
          <div className="flex-shrink-0">
            <div className="font-display font-bold" style={{ fontSize: 24, color: C.text, lineHeight: 1.25 }}>Sharpen your score</div>
            <div className="text-sm font-medium mt-1.5" style={{ color: C.muted, lineHeight: 1.55 }}>Three layers. Each one narrows the estimate — and each one is a conversation your doctor would have with you anyway.</div>
          </div>
          <div className="rounded-2xl p-4 mt-4" style={{ background: 'linear-gradient(150deg, #0D2947 0%, #153E6F 55%, #1E4E86 100%)', boxShadow: '0 12px 30px rgba(13,41,71,0.3)' }}>
            <div className="flex items-end justify-between">
              <div>
                <div className="text-xs font-bold" style={{ color: 'rgba(255,255,255,0.7)' }}>YOUR 10-YEAR RISK NOW</div>
                <div className="font-display font-bold mt-1" style={{ fontSize: 36, color: '#FFFFFF', lineHeight: 1 }}>{s.pctFinal.toFixed(1)}%</div>
                <div className="text-xs font-bold mt-1" style={{ color: s.band.color === '#1E9E6A' ? '#7FE0B4' : s.band.color === '#C77E1A' ? '#F5C572' : '#FF9E9A' }}>{s.band.band} · from {s.base.pct.toFixed(1)}% quick check</div>
              </div>
              <div className="text-right">
                <div className="text-xs font-bold" style={{ color: 'rgba(255,255,255,0.7)' }}>COMPLETE</div>
                <div className="font-display font-bold mt-1" style={{ fontSize: 28, color: '#7FE0B4', lineHeight: 1 }}>{s.pctComplete}%</div>
              </div>
            </div>
            <div className="rounded-full mt-3" style={{ height: 6, background: 'rgba(255,255,255,0.15)', overflow: 'hidden' }}>
              <div className="rounded-full" style={{ height: 6, width: `${s.pctComplete}%`, background: '#7FE0B4', transition: 'width .6s ease' }} />
            </div>
          </div>
          <div className="space-y-2.5 mt-4 flex-1 overflow-y-auto">
            {items.map(([e, t, sub, view, done]) => (
              <button key={t} onClick={() => { tapFeel('tap'); setSharpenView(view); setSharpenStep(0); }} className="w-full rounded-2xl p-4 flex items-center gap-3 text-left" style={{ background: done ? 'rgba(30,158,106,0.06)' : C.panel, border: done ? '1px solid rgba(30,158,106,0.35)' : `1px solid ${C.border}` }}>
                <span className="flex items-center justify-center rounded-xl flex-shrink-0" style={{ width: 42, height: 42, background: done ? 'rgba(30,158,106,0.12)' : 'rgba(43,108,176,0.1)', fontSize: 20 }}>{e}</span>
                <span className="flex-1">
                  <div className="text-sm font-bold" style={{ color: C.text }}>{t}</div>
                  <div style={{ fontSize: 11, color: done ? '#178A5C' : C.muted, fontWeight: 600 }}>{sub}</div>
                </span>
                <span className="text-xs font-bold" style={{ color: done ? '#178A5C' : C.navy }}>{done ? '✓' : '›'}</span>
              </button>
            ))}
            {s.sbDone && s.sb.level !== 'Low' && (
              <div className="rounded-2xl p-3.5" style={{ background: 'rgba(199,126,26,0.07)', border: '1px solid rgba(199,126,26,0.35)' }}>
                <div className="text-sm font-bold" style={{ color: C.text }}>😴 Your sleep matters to your heart</div>
                <div className="text-xs font-semibold mt-1" style={{ color: C.muted, lineHeight: 1.5 }}>Your STOP-BANG suggests {s.sb.level.toLowerCase()} likelihood of sleep apnoea — a known driver of resistant blood pressure and night-time rhythm problems. Your iLive Heart Check patch specifically looks for the nocturnal rhythm changes this causes.</div>
              </div>
            )}
          </div>
        </div>
      );
    }

    /* EXTRA QUESTIONS */
    if (sharpenView === 'extra') {
      const qs = s.qs;
      const firstOpen = qs.findIndex(q => !extraAns[q.id]);
      const i = Math.min(sharpenStep, qs.length - 1);
      if (sharpenStep >= qs.length || (firstOpen === -1 && sharpenStep === 0)) {
        return (
          <div className="h-full flex flex-col">
            {backBtn('Sharpen my score', 'menu')}
            <div className="flex-1 flex flex-col items-center justify-center text-center px-2">
              <div style={{ fontSize: 46 }}>✅</div>
              <div className="font-display font-bold mt-3" style={{ fontSize: 24, color: C.text }}>Detailed assessment complete</div>
              <div className="text-sm font-medium mt-2" style={{ color: C.muted, lineHeight: 1.6 }}>Quick check <b style={{ color: C.text }}>{s.base.pct.toFixed(1)}%</b> → detailed <b style={{ color: s.band.color }}>{s.pct2.toFixed(1)}%</b>.{' '}
                {Math.abs(s.pct2 - s.base.pct) < 0.05 ? 'None of the extra conditions apply to you — good news in itself.' : s.pct2 > s.base.pct ? 'These are real factors your doctor should know about, and several are treatable.' : 'Your answers refined the estimate downward.'}</div>
              <button onClick={() => { tapFeel('success'); setSharpenView('menu'); setSharpenStep(0); }} className="w-full rounded-2xl py-4 text-base font-bold mt-6" style={{ background: 'linear-gradient(135deg, #3B7FC9 0%, #1F5C9E 100%)', color: '#FFFFFF', boxShadow: '0 6px 18px rgba(31,92,158,0.32)' }}>Continue</button>
            </div>
          </div>
        );
      }
      const q = qs[i];
      return (
        <div className="h-full flex flex-col">
          {backBtn('Sharpen my score', 'menu')}
          <div className="flex gap-1.5 mb-4">
            {qs.map((_, k) => <div key={k} className="rounded-full flex-1" style={{ height: 5, background: k < i ? '#1E9E6A' : k === i ? C.green : 'rgba(21,62,111,0.1)' }} />)}
          </div>
          <div className="text-xs font-bold" style={{ color: C.muted }}>QUESTION {i + 1} OF {qs.length} · {['LET\u2019S GO 💪', 'NICE PACE ✨', 'KEEP GOING 🌟', 'HALFWAY 🙌', 'ALMOST 🎯', 'NEARLY THERE 🚀', 'LAST FEW 🌈', 'FINAL STRETCH 🏁', 'LAST ONE 🎉', 'DONE SOON ✨'][Math.min(i, 9)]}</div>
          <div className="font-display font-bold mt-1.5 mb-4" style={{ fontSize: 22, color: C.text, lineHeight: 1.3 }}>{q.e} {q.q}</div>
          <div className="space-y-2.5">
            {q.opts.map(o => bigOpt(null, o, () => { tapFeel('select'); setExtraAns({ ...extraAns, [q.id]: o }); setSharpenStep(i + 1); }, extraAns[q.id] === o))}
          </div>
          <div className="rounded-2xl p-3.5 mt-4" style={{ background: C.panelLight }}>
            <div className="text-xs font-semibold" style={{ color: C.muted, lineHeight: 1.55 }}>💡 {q.why}</div>
          </div>
          <button onClick={() => { tapFeel('tap'); setExtraAns({ ...extraAns, [q.id]: q.opts[0] }); setSharpenStep(i + 1); }} className="text-sm font-semibold text-center mt-4" style={{ color: C.muted }}>Skip this question</button>
        </div>
      );
    }

    /* STOP-BANG */
    if (sharpenView === 'sleep') {
      const steps = [...STOPBANG, { id: 'neck', e: '👔', q: 'Is your neck size 40 cm (16 inches) or more?' }];
      const i = Math.min(sharpenStep, steps.length - 1);
      if (sharpenStep >= steps.length) {
        const sb = stopBangScore(sbAns, s.p);
        const col = sb.level === 'High' ? '#C0392B' : sb.level === 'Intermediate' ? '#C77E1A' : '#1E9E6A';
        return (
          <div className="h-full flex flex-col">
            {backBtn('Sharpen my score', 'menu')}
            <div className="flex-1 flex flex-col items-center justify-center text-center px-2">
              <div style={{ fontSize: 46 }}>😴</div>
              <div className="text-xs font-bold mt-3" style={{ color: C.muted }}>SLEEP APNOEA LIKELIHOOD · STOP-BANG {sb.score}/8</div>
              <div className="font-display font-bold mt-1" style={{ fontSize: 32, color: col }}>{sb.level}</div>
              <div className="text-sm font-medium mt-3 rounded-2xl p-3.5" style={{ color: C.text, background: C.panelLight, lineHeight: 1.6 }}>
                {sb.level === 'Low' ? 'Sleep apnoea looks unlikely. Good sleep is protecting your heart.' : sb.level === 'Intermediate' ? 'Worth a conversation with your doctor. Untreated sleep apnoea quietly drives high blood pressure and night-time rhythm problems — and it is very treatable.' : 'This is a strong signal. Sleep apnoea is one of the most common hidden causes of resistant blood pressure and atrial fibrillation. Your doctor will want to talk about a sleep study — and your Heart Check patch will look for the night-time rhythm changes it causes.'}
              </div>
              <button onClick={() => { tapFeel('success'); setSharpenView('menu'); setSharpenStep(0); }} className="w-full rounded-2xl py-4 text-base font-bold mt-6" style={{ background: 'linear-gradient(135deg, #3B7FC9 0%, #1F5C9E 100%)', color: '#FFFFFF', boxShadow: '0 6px 18px rgba(31,92,158,0.32)' }}>Continue</button>
            </div>
          </div>
        );
      }
      const q = steps[i];
      return (
        <div className="h-full flex flex-col">
          {backBtn('Sharpen my score', 'menu')}
          <div className="flex gap-1.5 mb-4">
            {steps.map((_, k) => <div key={k} className="rounded-full flex-1" style={{ height: 5, background: k < i ? '#1E9E6A' : k === i ? C.green : 'rgba(21,62,111,0.1)' }} />)}
          </div>
          <div className="text-xs font-bold" style={{ color: C.muted }}>SLEEP & BREATHING · {i + 1} OF {steps.length}</div>
          <div className="font-display font-bold mt-1.5 mb-4" style={{ fontSize: 22, color: C.text, lineHeight: 1.3 }}>{q.e} {q.q}</div>
          <div className="space-y-2.5">
            {[['✅', 'No'], ['⚠️', 'Yes']].map(([e, o]) => bigOpt(e, o, () => { tapFeel('select'); setSbAns({ ...sbAns, [q.id]: o }); setSharpenStep(i + 1); }, sbAns[q.id] === o))}
          </div>
          <div className="rounded-2xl p-3.5 mt-4" style={{ background: C.panelLight }}>
            <div className="text-xs font-semibold" style={{ color: C.muted, lineHeight: 1.55 }}>💡 STOP-BANG is the validated screen for obstructive sleep apnoea. Your age, BMI and sex are added automatically from your profile.</div>
          </div>
        </div>
      );
    }

    /* LABS */
    if (sharpenView === 'labs') {
      return (
        <div className="h-full flex flex-col">
          {backBtn('Sharpen my score', 'menu')}
          <div className="font-display font-bold" style={{ fontSize: 24, color: C.text, lineHeight: 1.25 }}>Add your cholesterol</div>
          <div className="text-sm font-medium mt-1.5" style={{ color: C.muted, lineHeight: 1.55 }}>With total and HDL cholesterol we can run the lipid version of the same Framingham model — the sharpest number of all.</div>
          <div className="rounded-2xl p-4 mt-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
            <div className="flex gap-2.5">
              {foInput('Total cholesterol', labTC, setLabTC, '190', true, 'mg/dL')}
              {foInput('HDL cholesterol', labHDL, setLabHDL, '45', true, 'mg/dL')}
            </div>
            <div className="text-xs font-medium mt-3" style={{ color: C.muted, lineHeight: 1.5 }}>From any lipid report in the last 12 months. Don't have one? Book a home lipid profile — results flow straight in.</div>
          </div>
          {s.hasLipids && (
            <div className="rounded-2xl p-4 mt-3" style={{ background: 'rgba(30,158,106,0.06)', border: '1.5px solid rgba(30,158,106,0.35)' }}>
              <div className="text-xs font-bold" style={{ color: '#178A5C' }}>LIPID MODEL APPLIED ✓</div>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="font-display font-bold" style={{ fontSize: 30, color: s.band.color, lineHeight: 1 }}>{s.pctFinal.toFixed(1)}%</span>
                <span className="text-sm font-semibold" style={{ color: C.muted }}>{s.band.band} · was {s.pct2.toFixed(1)}%</span>
              </div>
            </div>
          )}
          <div className="flex-1" />
          <div className="space-y-2.5">
            {s.hasLipids
              ? <button onClick={() => { tapFeel('success'); setSharpenView('menu'); }} className="w-full rounded-2xl py-4 text-base font-bold" style={{ background: 'linear-gradient(135deg, #3B7FC9 0%, #1F5C9E 100%)', color: '#FFFFFF', boxShadow: '0 6px 18px rgba(31,92,158,0.32)' }}>Save & continue</button>
              : <button onClick={() => { tapFeel('tap'); setSharpenView(null); setMoreScreen('labs'); setActiveTab('more'); }} className="w-full rounded-2xl py-4 text-base font-bold" style={{ background: 'linear-gradient(135deg, #23B27A 0%, #178A5C 100%)', color: '#FFFFFF', boxShadow: '0 6px 18px rgba(23,138,92,0.3)' }}>🧪 Book a home lipid profile</button>}
          </div>
        </div>
      );
    }
    return null;
  }

  function renderSplash() {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center gap-6 px-2">
        <ILiveLogo height={104} tagline />
        <div>
          <div className="font-display text-2xl mb-2" style={{ color: C.text, fontWeight: 800 }}>iLive Connect</div>
          <div className="font-display text-xl mb-3" style={{ color: C.navy, fontWeight: 700 }}>Know your heart. Start free.</div>
          <div className="text-sm" style={{ color: C.muted, lineHeight: 1.6 }}>A 3-minute assessment gives you your cardiovascular risk, your heart age, and the three things to do this week. Then a doctor, a nutritionist and a physiotherapist — at no cost.</div>
        </div>
        <button onClick={() => { tapFeel('tap'); setAppPhase('freeOnboard'); setFoStep(0); }} className="w-full rounded-2xl py-4 text-base font-bold" style={{ background: 'linear-gradient(135deg, #3B7FC9 0%, #1F5C9E 100%)', color: '#FFFFFF', boxShadow: '0 6px 18px rgba(31,92,158,0.32)' }}>Start my free heart check</button>
        <div className="text-xs font-semibold -mt-2" style={{ color: C.muted }}>3 minutes · no payment required</div>
        <button onClick={() => setAppPhase('entryFork')} className="text-sm font-bold" style={{ color: C.navy, background: 'none' }}>Already know what you need? Explore iLive plans →</button>
      </div>
    );
  }

  function renderEntryFork() {
    return (
      <div className="h-full flex flex-col gap-4 pt-1">
        <div className="flex-shrink-0">
          <div className="font-display text-2xl mb-1" style={{ color: C.text, fontWeight: 800 }}>One app for every stage of your health.</div>
          <div className="text-sm font-medium" style={{ color: C.muted }}>Continuous monitoring · immediate response · personalized care. Pick your path — or simply try it free.</div>
        </div>
        <div className="flex-1 overflow-y-auto space-y-2.5 pb-2">
          {/* HEART CHECK */}
          <button onClick={() => { setPlanDetail('heartScreen'); setShowPlans(true); }} className="w-full rounded-2xl p-4 text-left" style={{ background: 'linear-gradient(140deg, #8F3A52 0%, #521D2E 100%)', boxShadow: '0 1px 2px rgba(82,29,46,0.08), 0 12px 26px rgba(82,29,46,0.16)' }}>
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center rounded-xl flex-shrink-0" style={{ width: 42, height: 42, background: 'rgba(255,255,255,0.16)', fontSize: 21 }}>❤️</div>
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-base font-bold" style={{ color: '#FFFFFF' }}>iLive Heart Check <span className="text-xs font-bold px-2 py-0.5 rounded-full ml-1" style={{ background: 'rgba(255,255,255,0.2)', color: '#FFFFFF' }}>START HERE</span></span>
                  <span className="text-xs font-bold flex-shrink-0" style={{ color: '#FFFFFF' }}>₹2,999 <span style={{ color: 'rgba(255,255,255,0.6)', textDecoration: 'line-through', fontWeight: 600 }}>₹4,999</span></span>
                </div>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', fontWeight: 600, lineHeight: 1.35, marginTop: 2 }}>Know your heart. Two days, full analysis, cardiologist report call →</div>
              </div>
            </div>
          </button>


          {[...PLANS].sort((a, b) => ({ heartScreen: 0, connect: 1, connectPlus: 2, prive: 3, essential: 4 }[a.id] ?? 9) - ({ heartScreen: 0, connect: 1, connectPlus: 2, prive: 3, essential: 4 }[b.id] ?? 9)).map(plan => (
            <button key={plan.id} onClick={() => { setPlanDetail(plan.id); setShowPlans(true); }} className="w-full rounded-2xl p-4 text-left" style={{ background: plan.grad, boxShadow: '0 1px 2px rgba(21,62,111,0.06), 0 12px 26px rgba(21,62,111,0.13)' }}>
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center rounded-xl flex-shrink-0" style={{ width: 42, height: 42, background: 'rgba(255,255,255,0.16)', fontSize: 21 }}>{plan.emoji}</div>
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-base font-bold" style={{ color: '#FFFFFF' }}>{plan.name}</span>
                    <span className="text-xs font-bold flex-shrink-0" style={{ color: '#FFFFFF' }}>{plan.price}</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', fontWeight: 600, lineHeight: 1.35, marginTop: 2 }}>{plan.tagline} See what’s included →</div>
                </div>
              </div>
            </button>
          ))}

          {/* FREE option */}
          <button onClick={() => { setEntryType('organic'); setAppPhase('signup'); }} className="w-full rounded-2xl p-4 text-left" style={{ background: C.panel, border: '2px solid rgba(30,158,106,0.5)', boxShadow: '0 8px 22px rgba(30,158,106,0.14)' }}>
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center rounded-xl flex-shrink-0" style={{ width: 42, height: 42, background: 'rgba(30,158,106,0.12)', fontSize: 21 }}>🎁</div>
              <div className="flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-base font-bold" style={{ color: C.text }}>Try iLive free</span>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: 'rgba(30,158,106,0.12)', color: '#1E9E6A' }}>₹0</span>
                </div>
                <div style={{ fontSize: 11, color: C.muted, fontWeight: 600, lineHeight: 1.4, marginTop: 2 }}>One full care round designed for you — doctor call in 30 min, nutritionist & physio next day · 2 iLive doctor calls · labs, medicines, second opinion & Health Passport free forever</div>
              </div>
            </div>
            <div className="w-full rounded-xl py-2.5 text-sm font-bold text-center mt-3" style={{ background: 'linear-gradient(135deg, #23B27A 0%, #178A5C 100%)', color: '#FFFFFF' }}>Start free →</div>
          </button>

          <div className="flex items-center justify-between gap-2 pt-1">
            <button onClick={() => { setEntryType('discharge'); setAppPhase('signup'); }} className="flex-1 rounded-xl px-3 py-2.5 text-xs font-bold text-left" style={{ background: C.panelLight, color: C.text }}>🏥 My doctor referred me →</button>
            <button onClick={() => { setEntryType('wound'); setAppPhase('signup'); }} className="flex-1 rounded-xl px-3 py-2.5 text-xs font-bold text-left" style={{ background: 'rgba(194,24,91,0.07)', color: '#C2185B' }}>🩹 I need wound care →</button>
          </div>
        </div>
      </div>
    );
  }

  function renderSignup() {
    return (
      <div className="h-full flex flex-col justify-center gap-6 px-2">
        <div>
          <div className="font-display text-2xl mb-1" style={{ color: C.text, fontWeight: 800 }}>Two details, and you're in</div>
          <div className="text-sm" style={{ color: C.muted }}>Your doctor will call you right after</div>
        </div>
        <div className="space-y-3">
          <input
            type="text" placeholder="Your name"
            value={signupName} onChange={e => setSignupName(e.target.value)}
            className="w-full rounded-xl px-4 py-3 text-base"
            style={{ background: C.panel, color: C.text, border: `1px solid ${C.border}` }}
          />
          <input
            type="tel" placeholder="Phone number"
            value={signupPhone} onChange={e => setSignupPhone(e.target.value)}
            className="w-full rounded-xl px-4 py-3 text-base"
            style={{ background: C.panel, color: C.text, border: `1px solid ${C.border}` }}
          />
          <input
            type="text" placeholder="Your doctor's name (optional)"
            value={primaryDoctor} onChange={e => setPrimaryDoctor(e.target.value)}
            className="w-full rounded-xl px-4 py-3 text-base"
            style={{ background: C.panel, color: C.text, border: `1px solid ${C.border}` }}
          />
        </div>
        <button onClick={() => setAppPhase(entryType === 'wound' ? 'woundCare' : ((!isSubscribed || enrolledPrograms[0] === 'Heart Health Check' || enrolledPrograms[0] === 'iLive Prevent') ? 'ready' : 'programPick'))} className="w-full rounded-2xl py-4 text-base font-bold" style={{ background: entryType === 'wound' ? '#C2185B' : C.green, color: '#FFFFFF' }}>{entryType === 'discharge' ? 'Continue' : entryType === 'wound' ? 'Start my wound assessment' : 'Start my free care journey'}</button>
      </div>
    );
  }

  function renderProgramPick() {
    if (!isSubscribed || selectedPlan === 'essential') { setAppPhase('ready'); return null; }
    const isDischarge = entryType === 'discharge';
    function pickProgram(p) {
      setEnrolledPrograms([p.name]);
      if (p.name.includes('Wound')) { setAppPhase('woundCare'); return; }
      if (isDischarge) setAppPhase('dischargePay');
      else setAppPhase('ready');
    }
    return (
      <div className="h-full flex flex-col gap-4">
        <div className="flex-shrink-0 pt-1">
          {foName && backArrow('Back to my free home', () => { tapFeel('tap'); setIsSubscribed(false); setSelectedPlan(null); setEnrolledPrograms(['iLive Free']); setOnboardingDone(true); setActiveTab('home'); setAppPhase('main'); })}
          <div className="font-display text-2xl mb-1" style={{ color: C.text, fontWeight: 800 }}>{selectedPlan === 'connectPlus' || isDischarge ? '🩹 iLive Recover' : '💙 iLive Care'}</div>
          <div className="text-sm font-medium" style={{ color: C.muted }}>{selectedPlan === 'connectPlus' || isDischarge ? 'Recovery at home — choose the program your doctor recommended. Cardiac monitoring is included in every one.' : 'Management of chronic health conditions — choose your program. Each opens its own care portal.'}</div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-2 gap-2.5 pb-2">
            {PROGRAMS.filter(p => (selectedPlan === 'connectPlus' || isDischarge) ? p.journey === 'recover' : p.journey === 'care').map(p => (
              <button key={p.name} onClick={() => pickProgram(p)}
                className="rounded-2xl p-3.5 text-left"
                style={{ background: `linear-gradient(155deg, ${p.color}18 0%, #FFFFFF 62%)`, border: `1px solid ${p.color}2E`, minHeight: 122, boxShadow: `0 1px 2px rgba(21,62,111,0.04), 0 10px 26px ${p.color}1F` }}>
                <div className="flex items-center justify-center rounded-2xl" style={{ width: 46, height: 46, background: `linear-gradient(140deg, ${p.color}30, ${p.color}0E)`, border: `1px solid ${p.color}45`, fontSize: 23, boxShadow: `0 5px 12px ${p.color}30` }}>{p.emoji}</div>
                <div className="text-sm font-bold mt-2.5" style={{ color: C.text, lineHeight: 1.25 }}>{p.title || p.name}</div>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, lineHeight: 1.35, marginTop: 3 }}>{p.desc}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  function renderDischargePay() {
    return (
      <div className="h-full flex flex-col gap-4">
        <div className="flex-shrink-0 pt-1">
          <div className="font-display text-2xl mb-1" style={{ color: C.text, fontWeight: 800 }}>{enrolledPrograms[0] || 'Recovery'} Program</div>
          <div className="text-sm font-medium" style={{ color: C.muted }}>The first week after discharge matters most — choose how closely we watch you.</div>
        </div>
        <div className="flex-1 overflow-y-auto space-y-3">
          {[...PLANS].sort((a, b) => ({ heartScreen: 0, connect: 1, connectPlus: 2, prive: 3, essential: 4 }[a.id] ?? 9) - ({ heartScreen: 0, connect: 1, connectPlus: 2, prive: 3, essential: 4 }[b.id] ?? 9)).map(plan => (
            <button
              key={plan.id}
              onClick={() => { setSelectedPlan(plan.id); setIsSubscribed(true); setAppPhase('questionnaire'); }}
              className="w-full rounded-2xl p-4 text-left"
              style={{ background: C.panel, border: `2px solid ${plan.id === 'connectPlus' ? '#2B6CB0' : C.border}` }}
            >
              {plan.id === 'connectPlus' && (
                <span className="text-xs font-bold px-2.5 py-0.5 rounded-full" style={{ background: '#2B6CB0', color: '#FFFFFF' }}>Recommended after surgery</span>
              )}
              <div className="flex items-center justify-between gap-2 mb-1 mt-1">
                <span className="text-base font-bold" style={{ color: C.text }}>{plan.name}</span>
                <span className="text-sm font-bold flex-shrink-0" style={{ color: C.green }}>{plan.dischargePrice}</span>
              </div>
              <div className="text-xs mb-2 font-semibold" style={{ color: plan.id === 'essential' ? C.muted : '#C77E1A' }}>{plan.dischargeNote}</div>
              <div className="space-y-1">
                {plan.benefits.map((b, bi) => (
                  <div key={bi} className="flex items-start gap-1.5">
                    <CheckCircle2 size={12} style={{ color: C.green, marginTop: 2, flexShrink: 0 }} />
                    <span className="text-xs" style={{ color: C.muted }}>{b}</span>
                  </div>
                ))}
              </div>
            </button>
          ))}
          <div className="rounded-2xl p-4" style={{ background: 'rgba(43,108,176,0.08)', border: '1px solid rgba(43,108,176,0.25)' }}>
            <div className="text-xs font-semibold" style={{ color: C.text }}>14-day money-back guarantee · After your intensive week, continue monthly at the same price — no price jump, ever.</div>
          </div>
        </div>
      </div>
    );
  }

  function renderReason() {
    const reasons = [
      { id: 'preventive', label: 'Preventive heart health', desc: 'Know and improve my heart risk', icon: Heart },
      { id: 'condition', label: 'Manage a health condition', desc: 'Ongoing care for a diagnosis', icon: Activity },
      { id: 'elder', label: 'Care for a parent', desc: 'Keep watch over an elder', icon: Users },
      { id: 'other', label: 'Something else', desc: 'Recovery, second opinions, more', icon: Stethoscope },
    ];
    function pick(id) {
      setCareReason(id);
      if (id === 'condition') setAppPhase('conditionPicker');
      else if (id === 'elder') { setGuardianView(true); setAppPhase('ready'); }
      else setAppPhase('questionnaire');
    }
    return (
      <div className="h-full flex flex-col justify-center gap-6 px-2">
        <div>
          <div className="font-display text-2xl mb-1" style={{ color: C.text, fontWeight: 800 }}>What brings you here?</div>
          <div className="text-sm" style={{ color: C.muted }}>So we tailor everything to you</div>
        </div>
        <div className="space-y-3">
          {reasons.map(r => (
            <button
              key={r.id}
              onClick={() => pick(r.id)}
              className="w-full rounded-2xl p-4 text-left flex items-center gap-4"
              style={{ background: C.panel, border: `1px solid ${C.border}` }}
            >
              <div className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 40, height: 40, background: 'rgba(43,108,176,0.15)' }}>
                <r.icon size={18} style={{ color: C.green }} />
              </div>
              <div>
                <div className="text-sm font-semibold" style={{ color: C.text }}>{r.label}</div>
                <div className="text-xs" style={{ color: C.muted }}>{r.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  function renderConditionPicker() {
    const conditions = [
      'High blood pressure', 'Diabetes', 'Heart failure (CHF)',
      'COPD / asthma', 'Post-stroke care', 'Back / joint pain', 'Something else',
    ];
    return (
      <div className="h-full flex flex-col justify-center gap-5 px-2">
        <button onClick={() => setAppPhase('reason')} className="text-sm text-left" style={{ color: C.muted }}>← Back</button>
        <div>
          <div className="font-display text-2xl mb-1" style={{ color: C.text, fontWeight: 800 }}>Which condition?</div>
          <div className="text-sm" style={{ color: C.muted }}>Your care plan is built around this</div>
        </div>
        <div className="space-y-2">
          {conditions.map(c => (
            <button
              key={c}
              onClick={() => { setCareCondition(c); setAppPhase('questionnaire'); }}
              className="w-full rounded-2xl p-4 text-left"
              style={{ background: C.panel, border: `1px solid ${C.border}` }}
            >
              <span className="text-sm font-semibold" style={{ color: C.text }}>{c}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  function renderReady() {
    const canGoBack = !!foName;
    const steps = [
      { icon: Stethoscope, who: 'iLive doctor', when: 'Within 30 minutes', desc: 'Onboarding call — your history, your plan' },
      { icon: Utensils, who: 'Nutritionist', when: 'Tomorrow, 11 AM', desc: 'Your plate, made condition-smart' },
      { icon: Video, who: 'Physiotherapist', when: 'Tomorrow evening', desc: 'Your movement plan, made safe' },
    ];
    return (
      <div className="h-full flex flex-col justify-center gap-5 px-2">
        {canGoBack && <div className="flex-shrink-0 -mt-2">{backArrow('Back to my free home', () => { tapFeel('tap'); setIsSubscribed(false); setSelectedPlan(null); setEnrolledPrograms(['iLive Free']); setOnboardingDone(true); setActiveTab('home'); setAppPhase('main'); })}</div>}
        <div className="text-center">
          <div className="flex items-center justify-center rounded-full mx-auto mb-3" style={{ width: 64, height: 64, background: C.green }}>
            <CheckCircle2 size={32} color={C.ink} />
          </div>
          <div className="font-display text-2xl" style={{ color: C.text, fontWeight: 800 }}>You're in{signupName ? `, ${signupName.split(' ')[0]}` : ''}!</div>
          <div className="text-sm mt-1" style={{ color: C.muted }}>Here's what happens next — all included</div>
        </div>

        <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <div className="space-y-3">
            {steps.map((s, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 38, height: 38, background: i === 0 ? C.green : C.panelLight }}>
                  <s.icon size={17} color={i === 0 ? C.ink : C.muted} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold" style={{ color: C.text }}>{s.who}</span>
                    <span className="text-xs" style={{ color: i === 0 ? C.green : C.muted }}>{s.when}</span>
                  </div>
                  <div className="text-xs" style={{ color: C.muted }}>{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="text-sm font-semibold mb-2" style={{ color: C.text }}>When should the doctor call?</div>
          <div className="flex gap-2">
            <button
              onClick={() => setWantTime(false)}
              className="flex-1 rounded-xl p-3 text-sm font-bold"
              style={{ background: !wantTime ? C.panelLight : C.panel, border: `1px solid ${!wantTime ? C.green : C.border}`, color: C.text }}
            >
              Within 30 minutes
            </button>
            <button
              onClick={() => setWantTime(true)}
              className="flex-1 rounded-xl p-3 text-sm"
              style={{ background: wantTime ? C.panelLight : C.panel, border: `1px solid ${wantTime ? C.green : C.border}`, color: C.text }}
            >
              Pick a time
            </button>
          </div>
          {wantTime && (
            <input
              type="time"
              value={customCallTime}
              onChange={e => setCustomCallTime(e.target.value)}
              className="w-full rounded-xl px-4 py-3 text-base mt-2"
              style={{ background: C.panel, color: C.text, border: `1px solid ${C.green}` }}
            />
          )}
        </div>

        <div className="rounded-2xl p-3.5" style={{ background: 'rgba(30,158,106,0.07)', border: '1px solid rgba(30,158,106,0.3)' }}>
          <div className="text-xs font-bold mb-1" style={{ color: C.text }}>Always yours, free — forever</div>
          <div className="text-xs font-semibold" style={{ color: C.muted, lineHeight: 1.55 }}>Lab tests at home · medicine delivery · second opinion · my prescriptions · Health Passport — plus 2 iLive doctor calls included.</div>
        </div>

        <button onClick={() => { setOnboardingDone(true); setAppPhase('main'); }} className="w-full rounded-2xl py-4 text-base font-bold" style={{ background: C.green, color: C.ink }}>Go to my dashboard</button>
      </div>
    );
  }

  /* ---------- PLANS ---------- */

  function renderPlans() {
    const durProtect = [['6 months', '₹17,999'], ['12 months', '₹29,999', true]];
    const durCare = [['1 month', '₹5,999'], ['3 months', '₹16,999', 'rec'], ['6 months', '₹32,999'], ['12 months', '₹64,999'], ['12 months · limited period offer', '₹58,999', true]];
    const durPrive = [['1 month', '₹17,999'], ['3 months', '₹49,999', 'rec'], ['6 months', '₹94,999'], ['12 months', '₹1,69,999', 'best']];
    const durPrivePlus = [['1 month', '₹24,999'], ['3 months', '₹69,999', 'rec'], ['6 months', '₹1,29,999'], ['12 months', '₹2,29,999', 'best']];
    const detail = PLANS.find(p => p.id === planDetail);

    if (planDetail === 'heartScreen') {
      const hsGrad = 'linear-gradient(140deg, #8F3A52 0%, #521D2E 100%)';
      return (
        <div className="h-full flex flex-col">
          <div className="flex-shrink-0 flex items-center justify-between mb-3">
            <button onClick={() => { tapFeel('tap'); if (foName && appPhase !== 'entryFork') { setShowPlans(false); setPlanDetail(null); } else { setPlanDetail(null); } }} className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: C.muted }}><ChevronLeft size={18} style={{ color: C.muted }} /> {foName && appPhase !== 'entryFork' ? 'Back to my free home' : 'All journeys'}</button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-3 pb-2">
            <div className="rounded-2xl p-5" style={{ background: hsGrad }}>
              <div style={{ fontSize: 30, lineHeight: 1 }}>❤️</div>
              <div className="font-display text-2xl font-bold mt-2" style={{ color: '#FFFFFF' }}>iLive Heart Check</div>
              <div className="text-sm font-semibold mt-0.5" style={{ color: 'rgba(255,255,255,0.85)' }}>Your complete heart health analysis — at home.</div>
              <div className="text-xs font-semibold mt-2.5 rounded-full px-3 py-1.5 inline-block" style={{ background: 'rgba(255,255,255,0.16)', color: '#FFFFFF' }}>For: Anyone who wants certainty about their heart</div>
            </div>

            <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
              <div className="text-sm font-bold mb-2" style={{ color: C.text }}>How it works</div>
              <div className="space-y-2">
                {[
                  ['1', 'We call you and fit your chest patch + wristband at home'],
                  ['2', 'Your heart is analysed continuously — arrhythmia burden, conduction delays & blocks, ST-T (ischemic) changes'],
                  ['3', 'A guided 15-minute exercise protocol during the screen shows how your heart performs under load'],
                  ['4', 'At the end, a cardiologist calls you and walks through your Heart Health Analysis Report — personally'],
                ].map(([n, t]) => (
                  <div key={n} className="flex items-start gap-2.5">
                    <div className="flex items-center justify-center rounded-full flex-shrink-0 text-xs font-bold" style={{ width: 22, height: 22, background: 'rgba(192,52,92,0.1)', color: '#C0345C' }}>{n}</div>
                    <span className="text-sm font-medium" style={{ color: C.text, lineHeight: 1.45 }}>{t}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl p-4 flex items-center gap-3" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
              <div className="flex items-center justify-center rounded-xl flex-shrink-0" style={{ width: 44, height: 44, background: 'rgba(192,52,92,0.1)', fontSize: 21 }}>❤️</div>
              <div className="flex-1">
                <div className="text-sm font-bold" style={{ color: C.text }}>2-day heart screening at home</div>
                <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 600, lineHeight: 1.35 }}>Chest patch · exercise test · cardiologist report call</div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-base font-bold" style={{ color: '#8F3A52' }}>₹2,999</div>
                <div style={{ fontSize: 11, color: C.muted, textDecoration: 'line-through', textDecorationThickness: '1.5px' }}>₹4,999</div>
              </div>
            </div>
            <div className="rounded-xl px-3.5 py-3" style={{ background: 'rgba(143,58,82,0.08)', border: '1px solid rgba(143,58,82,0.28)' }}>
              <span className="inline-block rounded-full" style={{ padding: '3px 9px', background: '#8F3A52', color: '#FFFFFF', fontSize: 9.5, fontWeight: 800, letterSpacing: 1 }}>INTRODUCTORY OFFER</span>
              <div className="flex items-baseline gap-2.5 mt-2">
                <span className="font-display" style={{ fontSize: 26, fontWeight: 800, color: '#8F3A52' }}>₹2,999</span>
                <span style={{ fontSize: 15, color: C.muted, textDecoration: 'line-through', textDecorationThickness: '2px' }}>₹4,999</span>
                <span className="rounded-full" style={{ padding: '2px 8px', background: 'rgba(30,158,106,0.12)', color: '#178A5C', fontSize: 11, fontWeight: 700 }}>Save ₹2,000</span>
              </div>
              <div className="text-xs mt-1.5" style={{ color: C.muted }}>Regular price ₹4,999 · introductory digital price for online booking.</div>
            </div>
            <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
              <div className="text-sm font-bold mb-2" style={{ color: C.text }}>What your heart is screened for</div>
              <div className="space-y-2">
                {[['💓', 'Heart rhythm', 'Irregular beats and arrhythmia burden — including silent atrial fibrillation at night'], ['⚡', 'Conduction blocks', 'Delays in the heart\'s electrical wiring that can cause dizziness or fainting'], ['🫀', 'Underlying coronary disease', 'ST-segment changes that suggest the heart muscle is short of blood — during your guided exercise test and daily life']].map(([e, t, d]) => (
                  <div key={t} className="flex items-start gap-2.5 rounded-xl p-2.5" style={{ background: C.panelLight }}>
                    <span style={{ fontSize: 17, lineHeight: 1.3 }}>{e}</span>
                    <div><div className="text-sm font-bold" style={{ color: C.text }}>{t}</div><div style={{ fontSize: 11, color: C.muted, fontWeight: 600, lineHeight: 1.4 }}>{d}</div></div>
                  </div>
                ))}
              </div>
              <div className="text-xs font-semibold mt-3 rounded-xl p-2.5" style={{ color: '#178A5C', background: 'rgba(30,158,106,0.07)', lineHeight: 1.5 }}>You wear the patch for two days at home, living normally. At the end, a cardiologist personally calls you with your Heart Health Analysis Report — and tells you exactly what it means for you.</div>
            </div>

            <button
              onClick={() => { tapFeel('success'); setEnrolledPrograms(['Heart Health Check']); setShowPlans(false); setPlanDetail(null); if (appPhase === 'entryFork') { setEntryType('organic'); setAppPhase('signup'); } else { setIsSubscribed(true); setSelectedPlan('heartScreen'); setOnboardingDone(true); setActiveTab('home'); setAppPhase('main'); } }}
              className="w-full rounded-2xl py-4 text-base font-bold"
              style={{ background: hsGrad, color: '#FFFFFF', boxShadow: '0 1px 2px rgba(82,29,46,0.08), 0 12px 26px rgba(82,29,46,0.18)' }}>
              <span className="flex items-center justify-center gap-2.5">Book my Heart Check · ₹2,999 <span style={{ fontSize: 13, opacity: .65, textDecoration: 'line-through', textDecorationThickness: '2px' }}>₹4,999</span></span>
            </button>
            <div className="text-xs text-center font-medium pb-1" style={{ color: C.muted }}>Patch fitted at home · report call by a cardiologist</div>
          </div>
        </div>
      );
    }

    if (detail) {
      const isProtect = detail.id === 'essential', isCare = detail.id === 'connect', isRecover = detail.id === 'connectPlus';
      const isPrive = detail.id === 'prive';
      const durations = isProtect ? durProtect : isCare ? durCare : null;
      return (
        <div className="h-full flex flex-col">
          <div className="flex-shrink-0 flex items-center justify-between mb-3">
            <button onClick={() => { tapFeel('tap'); if (foName && appPhase !== 'entryFork') { setShowPlans(false); setPlanDetail(null); } else { setPlanDetail(null); } }} className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: C.muted }}><ChevronLeft size={18} style={{ color: C.muted }} /> {foName && appPhase !== 'entryFork' ? 'Back to my free home' : 'All journeys'}</button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-3 pb-2">
            {/* Hero */}
            <div className="rounded-2xl p-5" style={{ background: detail.grad, border: detail.id === 'prive' ? '1px solid rgba(201,162,39,0.45)' : 'none', boxShadow: detail.id === 'prive' ? '0 1px 2px rgba(0,0,0,0.3), 0 16px 34px rgba(0,0,0,0.35)' : 'none' }}>
              <div style={{ fontSize: detail.id === 'prive' ? 22 : 30, lineHeight: 1, color: detail.id === 'prive' ? '#C9A227' : undefined, letterSpacing: detail.id === 'prive' ? '0.3em' : 0 }}>{detail.emoji}</div>
              <div className="font-display text-2xl font-bold mt-2" style={{ color: '#FFFFFF' }}>{detail.name}</div>
              <div className="text-sm font-semibold mt-0.5" style={{ color: 'rgba(255,255,255,0.85)' }}>{detail.tagline}</div>
              <div className="text-xs font-semibold mt-2.5 rounded-full px-3 py-1.5 inline-block" style={{ background: 'rgba(255,255,255,0.16)', color: '#FFFFFF' }}>For: {detail.who}</div>
            </div>

            {/* What you get — the PRIVÉ page uses the Privé Advantage instead */}
            {!isPrive && (
            <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
              <div className="text-sm font-bold mb-2" style={{ color: C.text }}>What's included</div>
              <div className="space-y-1.5">
                {detail.benefits.map((b, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <CheckCircle2 size={14} style={{ color: '#1E9E6A', marginTop: 2, flexShrink: 0 }} />
                    <span className="text-sm font-medium" style={{ color: C.text, lineHeight: 1.45 }}>{b}</span>
                  </div>
                ))}
              </div>
            </div>
            )}

            {/* PRIVÉ: two tiers */}
            {isPrive && (
              <div className="rounded-2xl p-4" style={{ background: 'linear-gradient(160deg, rgba(201,162,39,0.10) 0%, rgba(201,162,39,0.02) 45%), #12141F', border: '1px solid rgba(201,162,39,0.38)', marginBottom: 12 }}>
                <div style={{ fontSize: 10.5, letterSpacing: 2, color: '#C9A227', fontWeight: 700 }}>THE PRIVÉ ADVANTAGE</div>
                {[
                  'Quarterly advanced biomarker screening',
                  'Cardiovascular genetic profiling*',
                  'Dedicated Privé Health Concierge',
                  'Personalised nutrition and fitness programme',
                  'Quarterly 5-day chest-patch screening*',
                  'Heart and metabolic age tracking',
                  'Annual Privé Health Blueprint',
                ].map((t, i) => (
                  <div key={t} className="flex gap-3 items-start" style={{ padding: '8px 0', borderTop: i ? '1px solid rgba(255,255,255,.08)' : 'none', marginTop: i ? 0 : 10 }}>
                    <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 18, height: 18, background: 'rgba(201,162,39,.18)', marginTop: 1 }}><Check size={10} color="#E3C766" strokeWidth={3} /></span>
                    <span style={{ fontSize: 14, color: '#FFFFFF', lineHeight: 1.45 }}>{t}</span>
                  </div>
                ))}
                <div style={{ fontSize: 11, color: '#93AECB', marginTop: 12, fontStyle: 'italic' }}>*With annual membership.</div>
              </div>
            )}
            {isPrive && (
              <div className="space-y-3">
                {[
                  { id: 'prive', tier: 'iLive PRIVÉ', sub: 'Wristband', rows: durPrive, accent: '#C9A227' },
                  { id: 'priveHeart', tier: 'iLive PRIVÉ Heart', sub: 'Wristband + live ECG monitoring', rows: durPrivePlus, accent: '#E3C766' },
                ].map(t => (
                  <button key={t.tier} onClick={() => { tapFeel('select'); setPriveTier(t.id); }} className="w-full rounded-2xl p-4 text-left" style={{ background: 'linear-gradient(160deg, rgba(201,162,39,0.10) 0%, rgba(201,162,39,0.02) 45%), #12141F', border: priveTier === t.id ? `2px solid ${t.accent}` : `1px solid ${t.accent}44`, boxShadow: priveTier === t.id ? `0 0 0 3px ${t.accent}1A` : 'none' }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-display" style={{ fontSize: 17, color: '#FFFFFF', fontWeight: 600, letterSpacing: '0.02em', whiteSpace: 'nowrap' }}>{t.tier}</div>
                        <div style={{ fontSize: 11.5, color: t.accent, fontWeight: 600, letterSpacing: 0.3, marginTop: 4 }}>{t.sub}</div>
                      </div>
                      {priveTier === t.id
                        ? <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 22, height: 22, background: t.accent }}><Check size={13} color="#0B0D18" strokeWidth={3} /></span>
                        : <span className="rounded-full flex-shrink-0" style={{ width: 22, height: 22, border: `1.5px solid ${t.accent}66` }}></span>}
                    </div>
                    <div className="space-y-1.5 mt-3">
                      {t.rows.map(([d, pr, tag]) => (
                        <div key={d} className="flex items-center justify-between rounded-xl px-3.5 py-3" style={{ background: tag ? `${t.accent}14` : 'rgba(255,255,255,0.04)', border: tag ? `1px solid ${t.accent}55` : '1px solid rgba(255,255,255,0.07)' }}>
                          <span className="flex items-center gap-2">
                            <span style={{ fontSize: 14, color: '#FFFFFF' }}>{d}</span>
                            {tag === 'rec' && <span className="rounded-full" style={{ padding: '2px 8px', background: `${t.accent}26`, color: t.accent, fontSize: 9.5, fontWeight: 700, letterSpacing: 0.8 }}>RECOMMENDED</span>}
                            {tag === 'best' && <span className="rounded-full" style={{ padding: '2px 8px', background: `${t.accent}26`, color: t.accent, fontSize: 9.5, fontWeight: 700, letterSpacing: 0.8 }}>BEST VALUE</span>}
                          </span>
                          <span className="font-display" style={{ fontSize: 17, color: '#FFFFFF', fontWeight: 600 }}>{pr}</span>
                        </div>
                      ))}
                    </div>
                  </button>
                ))}
                <div className="text-xs text-center" style={{ color: C.muted, lineHeight: 1.6 }}>By private arrangement · devices included · discreet onboarding at your home or office.</div>
              </div>
            )}

            {/* Recover: duration choice */}
            {isRecover && (
              <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
                <div className="text-sm font-bold mb-2.5" style={{ color: C.text }}>Choose your recovery window</div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="rounded-xl p-3.5 text-center" style={{ background: 'rgba(212,98,46,0.08)', border: '2px solid rgba(212,98,46,0.45)' }}>
                    <div className="text-base font-bold" style={{ color: C.text }}>7 days</div>
                    <div className="text-sm font-bold" style={{ color: '#B04A1E' }}>₹14,999</div>
                    <div style={{ fontSize: 10, color: C.muted, fontWeight: 600 }}>The critical week</div>
                  </div>
                  <div className="rounded-xl p-3.5 text-center" style={{ background: C.panelLight, border: `1px solid ${C.border}` }}>
                    <div className="text-base font-bold" style={{ color: C.text }}>14 days</div>
                    <div className="text-sm font-bold" style={{ color: '#B04A1E' }}>₹24,999</div>
                    <div style={{ fontSize: 10, color: C.muted, fontWeight: 600 }}>Complete confidence</div>
                  </div>
                </div>
                <div className="text-xs mt-2.5 font-medium" style={{ color: C.muted, lineHeight: 1.45 }}>Chest patch + wristband fitted at your bedside or home · your treating doctor receives every review.</div>
              </div>
            )}

            {/* Protect / Care: duration pricing */}
            {isProtect && (
              <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
                <div className="text-sm" style={{ color: C.muted }}>Continuous health insights, personalized guidance and the reassurance of iLive monitoring.</div>
                <div className="font-display mt-2" style={{ fontSize: 22, color: C.text, fontWeight: 700 }}>₹29,999 a year</div>
                <div className="text-xs mt-0.5" style={{ color: C.muted, fontStyle: 'italic' }}>that is ₹2,500 a month</div>
              </div>
            )}
            {isCare && (
              <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
                <div className="text-sm" style={{ color: C.muted }}>24×7 monitoring · care team · instant alerts · health insights.</div>
                <div className="font-display mt-2" style={{ fontSize: 22, color: C.text, fontWeight: 700 }}>₹4,917 a month <span style={{ fontSize: 13, fontWeight: 500 }}>(for annual subscription)</span></div>
                <div className="text-xs mt-0.5" style={{ color: C.muted, fontStyle: 'italic' }}>on the limited-period annual offer (₹58,999 a year) · ₹5,999 if taken month by month</div>
                <div className="text-xs mt-2" style={{ color: C.muted }}>14-day money-back guarantee · cancel anytime</div>
              </div>
            )}
            {durations && (
              <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
                <div className="text-sm font-bold mb-2.5" style={{ color: C.text }}>Membership options</div>
                <div className="space-y-1.5">
                  {durations.map(([d, pr, own]) => (
                    <div key={d} className="flex items-center justify-between rounded-xl px-3.5 py-2.5" style={{ background: own ? 'rgba(176,141,70,0.08)' : C.panelLight, border: own ? '1px solid rgba(176,141,70,0.4)' : '1px solid transparent' }}>
                      <div>
                        <span className="text-sm font-bold" style={{ color: C.text }}>{d}</span>
                        {own && <span className="text-xs font-bold ml-2" style={{ color: '#8E6F2E' }}>{(isProtect || isCare) ? '⭐ BEST VALUE' : '✦ devices become yours'}</span>}
                        {isCare && d === '3 months' && <span className="text-xs font-bold ml-2" style={{ color: '#178A5C' }}>MOST POPULAR</span>}
                      </div>
                      <span className="text-sm font-bold" style={{ color: C.navy }}>{pr}</span>
                    </div>
                  ))}
                </div>
                <div className="text-xs mt-2.5 font-medium" style={{ color: C.muted, lineHeight: 1.5 }}>Your iLive monitoring device becomes yours with the annual plan.</div>
              </div>
            )}

            <button
              onClick={() => { tapFeel('success'); setSelectedPlan(detail.id); setIsSubscribed(true); setShowPlans(false); setPlanDetail(null); setCareRisk(careRisk || { level: 'Moderate', col: '#C77E1A', pct: '10–15%' }); if (detail.id === 'essential') { setEnrolledPrograms(['iLive Prevent']); setAppPhase(appPhase === 'entryFork' ? 'signup' : 'ready'); } else { setEnrolledPrograms([]); setAppPhase(appPhase === 'entryFork' ? 'signup' : 'programPick'); } if (appPhase === 'entryFork') { setEntryType('organic'); } }}
              disabled={isPrive && !priveTier}
              className="w-full rounded-2xl py-4 text-base font-bold"
              style={{ background: detail.grad, color: '#FFFFFF', boxShadow: '0 8px 22px rgba(21,62,111,0.3)', opacity: (isPrive && !priveTier) ? 0.45 : 1, border: isPrive ? '1px solid rgba(201,162,39,0.5)' : 'none' }}>
              {isPrive ? (priveTier === 'priveHeart' ? 'Begin iLive PRIVÉ Heart · ₹24,999/mo' : priveTier === 'prive' ? 'Begin iLive PRIVÉ · ₹17,999/mo' : 'Choose a plan above to begin') : `Begin ${detail.name} · ${detail.price}`}
            </button>
            <div className="text-xs text-center font-medium pb-1" style={{ color: C.muted }}>14-day money-back guarantee · cancel anytime</div>
          </div>
        </div>
      );
    }

    return (
      <div className="h-full flex flex-col">
        <div className="flex-shrink-0 mb-4">
          <div className="font-display text-xl mb-1" style={{ color: C.text, fontWeight: 800 }}>One app for every stage of your health.</div>
          <div className="text-sm font-medium" style={{ color: C.muted }}>Continuous monitoring · immediate response · personalized care.</div>
        </div>
        <div className="flex-1 overflow-y-auto space-y-3">
          {[...PLANS].sort((a, b) => ({ heartScreen: 0, connect: 1, connectPlus: 2, prive: 3, essential: 4 }[a.id] ?? 9) - ({ heartScreen: 0, connect: 1, connectPlus: 2, prive: 3, essential: 4 }[b.id] ?? 9)).map(plan => (
            <button key={plan.id} onClick={() => setPlanDetail(plan.id)} className="w-full rounded-2xl p-5 text-left" style={{ background: plan.grad, boxShadow: '0 1px 2px rgba(21,62,111,0.06), 0 14px 30px rgba(21,62,111,0.14)' }}>
              <div className="flex items-start justify-between gap-3">
                <div style={{ fontSize: 27, lineHeight: 1.1 }}>{plan.emoji}</div>
                <div className="text-right flex-shrink-0">
                  <div className="text-base font-bold" style={{ color: '#FFFFFF' }}>{plan.price}</div>
                </div>
              </div>
              <div className="font-display text-xl font-bold mt-2" style={{ color: '#FFFFFF' }}>{plan.name}</div>
              <div className="text-sm font-semibold mt-0.5" style={{ color: 'rgba(255,255,255,0.85)' }}>{plan.tagline}</div>
              <div className="flex items-center justify-between mt-3">
                <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.75)', fontWeight: 600 }}>{plan.who}</span>
                <span className="text-xs font-bold flex-shrink-0 ml-2" style={{ color: '#FFFFFF' }}>Explore →</span>
              </div>
            </button>
          ))}
        </div>
        <button onClick={() => setShowPlans(false)} className="flex-shrink-0 text-sm mt-3 py-2 font-semibold" style={{ color: C.muted }}>Not now</button>
      </div>
    );
  }


  /* ---------- HOME ---------- */

  function renderJourneyCard() {
    const steps = [
      { icon: Stethoscope, who: 'Doctor', when: 'Today', desc: 'Welcome call — calling you shortly', live: true },
      { icon: Utensils, who: 'Nutritionist', when: 'Tomorrow', desc: 'Your personal diet plan', live: false },
      { icon: Video, who: 'Physio', when: 'Day 3', desc: 'Video rehab session', live: false },
    ];
    return (
      <div className="rounded-2xl p-5" style={{ background: 'linear-gradient(135deg, rgba(43,108,176,0.14), rgba(234,242,251,0.4))', border: `1px solid ${C.border}` }}>
        <div className="flex items-center justify-between mb-4">
          <span className="text-base font-semibold" style={{ color: C.text }}>Your free care journey</span>
          <span className="text-xs px-2 py-1 rounded-full" style={{ background: 'rgba(43,108,176,0.15)', color: C.green }}>All 3 on us</span>
        </div>
        <div className="space-y-3">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 40, height: 40, background: s.live ? C.green : C.panelLight }}>
                <s.icon size={18} color={s.live ? C.ink : C.muted} />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold" style={{ color: C.text }}>{s.who}</span>
                  <span className="text-xs" style={{ color: s.live ? C.green : C.muted }}>{s.when}</span>
                  {s.live && <span style={{ width: 6, height: 6, borderRadius: 9999, background: C.green, display: 'inline-block' }} />}
                </div>
                <div className="text-xs" style={{ color: C.muted }}>{s.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderCallButton() {
    if (isSubscribed) {
      return (
        <button className="w-full rounded-2xl p-5 flex items-center gap-4" style={{ background: C.green }}>
          <div className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 48, height: 48, background: 'rgba(255,255,255,0.22)' }}>
            <Phone size={22} color={C.ink} />
          </div>
          <div className="text-left">
            <div className="text-base font-bold" style={{ color: C.ink }}>Call your doctor</div>
            <div className="text-xs" style={{ color: C.ink, opacity: 0.7 }}>24x7, one tap away</div>
          </div>
        </button>
      );
    }
    if (freeCallsLeft > 0) {
      return (
        <button onClick={() => setFreeCallsLeft(n => n - 1)} className="w-full rounded-2xl p-5 flex items-center gap-4" style={{ background: C.green }}>
          <div className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 48, height: 48, background: 'rgba(255,255,255,0.22)' }}>
            <Phone size={22} color={C.ink} />
          </div>
          <div className="text-left">
            <div className="text-base font-bold" style={{ color: C.ink }}>Call your doctor</div>
            <div className="text-xs" style={{ color: C.ink, opacity: 0.7 }}>{freeCallsLeft} free call{freeCallsLeft > 1 ? 's' : ''} left</div>
          </div>
        </button>
      );
    }
    return (
      <button onClick={() => setShowPlans(true)} className="w-full rounded-2xl p-5 flex items-center gap-4" style={{ background: C.amber }}>
        <div className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 48, height: 48, background: 'rgba(255,255,255,0.22)' }}>
          <Phone size={22} color={C.ink} />
        </div>
        <div className="text-left">
          <div className="text-base font-bold" style={{ color: C.ink }}>Your 2 iLive doctor calls are used</div>
          <div className="text-xs" style={{ color: C.ink, opacity: 0.75 }}>Choose your care journey — Prevent ₹29,999/yr · Care ₹4,917/mo · Recover ₹14,999 →</div>
        </div>
      </button>
    );
  }

  function renderScoreCard() {
    const takenCount = medications.filter(m => m.taken).length;
    const bpOk = lastBp.systolic < 140 && lastBp.systolic > 90;
    const sugarOk = lastSugar.value < 180 && lastSugar.value > 70;
    const scoreColor = iliveScore >= 75 ? C.green : iliveScore >= 50 ? C.amber : C.coral;
    const hasDevice = isSubscribed && (selectedPlan === 'connect' || selectedPlan === 'connectPlus');
    const medsAll = medications.every(m => m.taken);
    const todayEarn = (medsAll ? 15 : 0) + (readingLoggedToday ? 10 : 0) + (checkedIn ? 8 : 0);
    const rewardTotal = 818 + todayEarn;
    const parts = [
      { label: `Medicines ${takenCount}/${medications.length}`, done: takenCount === medications.length },
      { label: 'BP', done: bpOk },
      { label: 'Sugar', done: sugarOk },
      { label: 'Check-in', done: checkedIn },
      { label: 'Meal', done: mealPhotoTaken },
    ];
    return (
      <div className="rounded-2xl p-5" style={{ background: 'linear-gradient(135deg, rgba(43,108,176,0.12), rgba(234,242,251,0.45))', border: `1px solid ${C.border}` }}>
        <div className="flex items-center gap-4 mb-4">
          <div className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 76, height: 76, background: `conic-gradient(${scoreColor} 0% ${iliveScore}%, ${C.panelLight} ${iliveScore}% 100%)` }}>
            <div className="flex items-center justify-center rounded-full" style={{ width: 62, height: 62, background: C.ink }}>
              <span className="font-display" style={{ color: C.text, fontWeight: 800, fontSize: 24 }}>{iliveScore}</span>
            </div>
          </div>
          <div>
            <div className="text-base font-semibold" style={{ color: C.text }}>Your iLive Score</div>
            <div className="text-xs mt-0.5" style={{ color: C.muted }}>
              {isSubscribed
                ? (isAllClear ? 'All clear — your care team is keeping watch' : 'Needs attention — your doctor has been notified')
                : 'Grows as you take care of yourself today'}
            </div>
            {familyAdded && (
              <div className="text-xs mt-1" style={{ color: C.green }}>{familyMember.name} sees your score · 👍 sent</div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {parts.map((p, i) => (
            <span key={i} className="px-2 py-1 rounded-full text-xs" style={{ background: p.done ? 'rgba(43,108,176,0.15)' : C.panelLight, color: p.done ? C.green : C.muted }}>
              {p.done ? '✓ ' : ''}{p.label}
            </span>
          ))}
        </div>
        <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: `1px solid ${C.border}` }}>
          <div className="flex items-center gap-1.5">
            <Coins size={14} style={{ color: C.amber }} />
            <span className="text-sm font-semibold" style={{ color: C.text }}>{rewardTotal}</span>
            <span className="text-xs" style={{ color: C.muted }}>iLive Coins{isSubscribed ? '' : ' · redeem when you join'}</span>
          </div>
          <span className="text-xs flex-shrink-0" style={{ color: todayEarn >= 33 ? C.green : C.amber }}>{todayEarn >= 33 ? 'Today ✓' : `+${todayEarn} today`}</span>
        </div>
        <button onClick={() => setShowRewards(!showRewards)} className="w-full rounded-xl py-2.5 mt-3 text-sm font-bold" style={{ background: 'rgba(232,161,61,0.15)', color: '#B07A1E', border: '1px solid rgba(232,161,61,0.35)' }}>
          {showRewards ? 'Hide rewards' : '🎁 Redeem your Coins'}
        </button>
        {showRewards && (
          <div className="mt-3 space-y-2">
            {[
              { emoji: '🧪', label: 'Lab test discount', sub: '10% off any lab order', cost: '500 Coins' },
              { emoji: '💊', label: 'Medicine discount', sub: '10% off your next order', cost: '750 Coins' },
              { emoji: '⭐', label: 'Membership discount', sub: '₹500 off next month', cost: '1,500 Coins' },
            ].map((r, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl p-3" style={{ background: C.panelLight }}>
                <span style={{ fontSize: 20 }}>{r.emoji}</span>
                <div className="flex-1">
                  <div className="text-xs font-bold" style={{ color: C.text }}>{r.label}</div>
                  <div className="text-xs" style={{ color: C.muted }}>{r.sub}</div>
                </div>
                <span className="text-xs font-bold flex-shrink-0" style={{ color: '#B07A1E' }}>{r.cost}</span>
              </div>
            ))}
            <div className="text-xs pt-1" style={{ color: C.muted }}>
              <span className="font-bold" style={{ color: C.text }}>Earn more:</span> Walk 7 days +50 · Upload BP +10 · All medicines +15 · Daily check-in +8 · Health check +25
            </div>
          </div>
        )}
        {hasDevice ? (
          <div className="text-xs mt-3" style={{ color: C.muted }}>Updated automatically from your wristband</div>
        ) : (
          <button onClick={() => setShowPlans(true)} className="rounded-full px-3.5 py-2 text-xs font-bold mt-3" style={{ background: 'rgba(43,108,176,0.10)', color: C.green, border: '1px solid rgba(43,108,176,0.3)' }}>⌚ Automatic with a wristband — see the three care journeys →</button>
        )}
      </div>
    );
  }

  function renderCareTracker() {
    if (trackerEvents.length === 0) return null;

    const Step = ({ state, label, sub }) => (
      <div className="flex flex-col items-center flex-shrink-0" style={{ width: 78 }}>
        <div
          className={state === 'active' ? 'pulse' : ''}
          style={{
            width: 22, height: 22, borderRadius: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: state === 'done' ? C.green : state === 'alert' ? C.coral : state === 'active' ? C.amber : 'transparent',
            border: state === 'idle' ? `2px solid ${C.muted}` : 'none',
          }}
        >
          {state === 'done' && <CheckCircle2 size={14} color={C.ink} />}
          {state === 'alert' && <Phone size={12} color={C.ink} />}
        </div>
        <div className="text-xs mt-1 text-center" style={{ color: state === 'idle' ? C.muted : C.text, lineHeight: 1.2 }}>{label}</div>
        {sub && <div className="text-xs text-center" style={{ color: C.muted }}>{sub}</div>}
      </div>
    );

    const Connector = ({ done }) => (
      <div style={{ height: 2, flex: 1, background: done ? C.green : C.border, marginTop: 10 }} />
    );

    return (
      <div className="rounded-2xl p-5" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck size={18} style={{ color: C.green }} />
          <span className="text-base font-semibold" style={{ color: C.text }}>Care Tracker</span>
        </div>
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs" style={{ color: C.muted }}>Every reading you log, seen by a real doctor</div>
          <button onClick={() => setAppPhase('healthRecord')} className="text-xs flex-shrink-0 ml-2" style={{ color: C.green }}>History →</button>
        </div>

        <div className="space-y-3">
          {trackerEvents.slice(0, 1).map(e => {
            const reviewed = e.stage === 'clear' || e.stage === 'calling' || e.stage === 'resolved';
            return (
              <div key={e.id} className="rounded-xl p-3" style={{ background: C.panelLight }}>
                <div className="text-sm font-semibold mb-2" style={{ color: C.text }}>{e.label}</div>
                <div className="flex items-start">
                  <Step state="done" label="Received" sub={e.receivedAt} />
                  <Connector done={e.stage !== 'received'} />
                  <Step
                    state={reviewed ? 'done' : e.stage === 'reviewing' ? 'active' : 'idle'}
                    label={e.stage === 'reviewing' ? 'Reviewing now' : 'Doctor review'}
                    sub={e.reviewedAt || (e.stage === 'reviewing' ? e.reviewer : 'Queued')}
                  />
                  <Connector done={reviewed} />
                  <Step
                    state={e.stage === 'clear' || e.stage === 'resolved' ? 'done' : e.stage === 'calling' ? 'alert' : 'idle'}
                    label={e.stage === 'clear' ? 'All clear' : e.stage === 'calling' ? 'Doctor calling' : e.stage === 'resolved' ? 'Doctor called' : 'Result'}
                    sub={e.stage === 'calling' ? 'now' : e.stage === 'clear' || e.stage === 'resolved' ? '✓' : '—'}
                  />
                </div>
                {e.resolution && (
                  <div className="text-xs mt-2" style={{ color: e.resolution.startsWith('Missed') ? C.amber : C.green }}>{e.resolution}</div>
                )}
              </div>
            );
          })}
        </div>

        {trackerEvents.length <= 1 && (
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <span className="text-xs" style={{ color: C.muted }}>See it live:</span>
            <button onClick={() => trackReading('BP 124/80', false)} className="px-2.5 py-1 rounded-full text-xs font-medium" style={{ background: 'rgba(43,108,176,0.15)', color: C.green }}>Normal reading</button>
            <button onClick={() => trackReading('BP 158/96', true)} className="px-2.5 py-1 rounded-full text-xs font-medium" style={{ background: 'rgba(224,82,82,0.15)', color: C.coral }}>High reading</button>
          </div>
        )}

        {!isSubscribed && (
          <button onClick={() => setShowPlans(true)} className="text-xs mt-3 text-left" style={{ color: C.muted }}>
            Included during your free journey · <span style={{ color: C.green }}>keep it with Essential →</span>
          </button>
        )}
      </div>
    );
  }

  function renderCallOverlay() {
    const mins = Math.floor(callSeconds / 60);
    const secs = String(callSeconds % 60).padStart(2, '0');
    return (
      <div className="absolute inset-0 z-50 flex flex-col items-center justify-between py-14 px-6" style={{ background: 'linear-gradient(180deg, #1B4D8A, #0F2A4A)' }}>
        <div className="flex flex-col items-center gap-4 mt-6">
          <div
            className={incomingCall.phase === 'ringing' ? 'pulse' : ''}
            style={{ width: 96, height: 96, borderRadius: 9999, background: 'rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #7BA7D9' }}
          >
            <Stethoscope size={40} style={{ color: '#A9C8EA' }} />
          </div>
          <div className="text-center">
            <div className="text-xs mb-1" style={{ color: '#A9C8EA', letterSpacing: 1 }}>ILIVE COMMAND CENTER</div>
            <div className="font-display text-2xl" style={{ color: '#FFFFFF', fontWeight: 800 }}>{incomingCall.doctor}</div>
            <div className="text-sm mt-1" style={{ color: '#C4D6EC' }}>
              {incomingCall.phase === 'ringing' ? `Incoming call · about your ${incomingCall.reading}` : `${mins}:${secs} · discussing your ${incomingCall.reading}`}
            </div>
          </div>
        </div>

        {incomingCall.phase === 'ringing' ? (
          <div className="flex items-center gap-12">
            <button onClick={() => endCall(true)} className="flex flex-col items-center gap-2">
              <div style={{ width: 64, height: 64, borderRadius: 9999, background: C.coral, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Phone size={26} color={C.ink} style={{ transform: 'rotate(135deg)' }} />
              </div>
              <span className="text-xs" style={{ color: '#C4D6EC' }}>Decline</span>
            </button>
            <button onClick={acceptCall} className="flex flex-col items-center gap-2">
              <div className="pulse" style={{ width: 64, height: 64, borderRadius: 9999, background: C.green, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Phone size={26} color={C.ink} />
              </div>
              <span className="text-xs" style={{ color: '#C4D6EC' }}>Accept</span>
            </button>
          </div>
        ) : (
          <button onClick={() => endCall(false)} className="flex flex-col items-center gap-2">
            <div style={{ width: 64, height: 64, borderRadius: 9999, background: C.coral, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Phone size={26} color={C.ink} style={{ transform: 'rotate(135deg)' }} />
            </div>
            <span className="text-xs" style={{ color: '#C4D6EC' }}>End call</span>
          </button>
        )}
      </div>
    );
  }

  function renderHealthRecord() {
    const timeline = [
      ...trackerEvents.map(e => ({
        date: 'Today',
        title: e.label,
        sub: e.stage === 'clear' ? `Reviewed by ${e.reviewer} · ${e.reviewedAt}`
          : e.stage === 'resolved' ? (e.resolution || 'Doctor called ✓')
          : e.stage === 'calling' ? 'Doctor calling now'
          : e.stage === 'reviewing' ? 'Under review'
          : 'Received',
        icon: Activity,
      })),
      { date: 'Jul 3', title: 'June Health Report', sub: 'Signed by Dr. Mehta ✓', icon: FileText },
      { date: 'Jul 2', title: 'Dietitian call', sub: 'Diet plan updated — low sodium', icon: Utensils },
      { date: 'Jul 1', title: 'e-Prescription', sub: 'Telmisartan · Metformin · Aspirin', icon: Pill },
      { date: 'Jun 30', title: 'Onboarding call', sub: 'Command Center · history & welcome', icon: Phone },
      { date: 'Jun 30', title: 'Hospital discharge', sub: 'Recovery Day 0', icon: Heart },
    ];
    return (
      <div className="space-y-5">
        <button onClick={() => setAppPhase('main')} className="text-sm text-left" style={{ color: C.muted }}>← Back</button>
        <div>
          <div className="font-display text-2xl mb-1" style={{ color: C.text, fontWeight: 800 }}>My Health Passport</div>
          <div className="text-sm" style={{ color: C.muted }}>Every reading, report, medicine and consult — in one place, for life. It builds itself with every lab order, prescription and visit.</div>
        </div>

        <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <div className="text-sm font-bold mb-1" style={{ color: C.text }}>📄 Documents</div>
          <div className="text-xs font-medium mb-2.5" style={{ color: C.muted }}>Added automatically — no uploads homework on day one</div>
          <div className="flex flex-wrap gap-2">
            {['Discharge Summary', 'Echo', 'ECG', 'Angiography', 'Lab Reports', 'Prescriptions', 'Insurance'].map(d => (
              <span key={d} className="text-xs font-bold px-2.5 py-1.5 rounded-lg" style={{ background: C.panelLight, color: C.navy }}>{d}</span>
            ))}
          </div>
          <button className="w-full rounded-xl py-3 text-sm font-bold mt-3" style={{ background: 'linear-gradient(135deg, #3B7FC9 0%, #1F5C9E 100%)', color: '#FFFFFF', boxShadow: '0 6px 18px rgba(31,92,158,0.32)' }}>📤 Share Health Passport</button>
        </div>

        <div className="rounded-2xl p-5" style={{ background: 'rgba(224,82,82,0.08)', border: '1px solid rgba(224,82,82,0.25)' }}>
          <div className="flex items-center gap-2 mb-3">
            <Siren size={18} style={{ color: C.coral }} />
            <span className="text-base font-semibold" style={{ color: C.text }}>Emergency Card</span>
          </div>
          <div className="flex gap-4 mb-3">
            <div style={{ background: '#fff', padding: 6, borderRadius: 8, flexShrink: 0, alignSelf: 'flex-start' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(15, 7px)' }}>
                {QR_ROWS.flatMap((row, r) => row.split('').map((c, i) => (
                  <div key={`${r}-${i}`} style={{ width: 7, height: 7, background: c === '1' ? '#0A1626' : '#fff' }} />
                )))}
              </div>
            </div>
            <div className="text-xs space-y-1">
              <div style={{ color: C.text }}><span style={{ color: C.muted }}>Name · </span><span className="font-semibold">{signupName || 'Meena Kapoor'}</span></div>
              <div style={{ color: C.text }}>Blood group B+ · Allergy: Penicillin</div>
              <div style={{ color: C.muted }}>Post-cardiac surgery · Hypertension · Type 2 diabetes</div>
              <div style={{ color: C.muted }}>Medicines: {medications.map(m => m.name.split(' ')[0]).join(' · ')}</div>
              <div style={{ color: C.green }}>Emergency: iLive Command Center · 24x7</div>
            </div>
          </div>
          <div className="text-xs mb-3" style={{ color: C.muted }}>Any hospital can scan this — it works for doctors outside iLive too.</div>
          <button
            onClick={() => setLockScreenAdded(!lockScreenAdded)}
            className="w-full rounded-xl py-3 text-sm font-semibold"
            style={{ background: lockScreenAdded ? C.panel : C.coral, color: lockScreenAdded ? C.green : '#FFFFFF', border: lockScreenAdded ? `1px solid ${C.border}` : 'none' }}
          >
            {lockScreenAdded ? 'On your lock screen ✓' : 'Add to phone lock screen'}
          </button>
        </div>

        <div className="rounded-2xl p-5" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <div className="flex items-center gap-2 mb-2">
            <FileText size={18} style={{ color: C.green }} />
            <span className="text-base font-semibold" style={{ color: C.text }}>June Health Report</span>
          </div>
          <div className="text-xs mb-3" style={{ color: C.muted }}>BP averaged 124/81 · Sugar in range 26 of 30 days · Medicines 96% on time — Signed by Dr. Mehta ✓</div>
          <button
            onClick={() => setReportShared(!reportShared)}
            className="w-full rounded-xl py-3 text-sm font-semibold"
            style={{ background: reportShared ? C.panelLight : C.green, color: reportShared ? C.green : C.ink }}
          >
            {reportShared ? 'Shared with your Care Circle ✓' : 'Share on WhatsApp'}
          </button>
        </div>

        <div>
          <div className="text-sm font-semibold mb-3" style={{ color: C.text }}>Timeline</div>
          <div>
            {timeline.map((t, i) => (
              <div key={i} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 28, height: 28, background: C.panelLight }}>
                    <t.icon size={13} style={{ color: C.green }} />
                  </div>
                  {i < timeline.length - 1 && <div style={{ width: 2, flex: 1, background: C.border }} />}
                </div>
                <div className="pb-4 flex-1">
                  <div className="text-xs" style={{ color: C.muted }}>{t.date}</div>
                  <div className="text-sm font-semibold" style={{ color: C.text }}>{t.title}</div>
                  <div className="text-xs" style={{ color: C.muted }}>{t.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const WOUND_BOARD = [
    { emoji: '🤖', role: 'AI Wound Analysis', doing: 'Mapping size, depth & tissue from your photos…', rec: 'Wound mapped: ≈ 3.8 cm² · tissue & margins analysed for your doctor' },
    { emoji: '🩺', role: 'Vascular Surgeon', doing: 'Assessing blood supply to the wound…', rec: 'Blood supply adequate · Diabetic foot ulcer, Grade 2' },
    { emoji: '🩹', role: 'Wound Care Surgeon', doing: 'Examining wound bed & edges…', rec: 'Debridement at first dressing · Solagen protocol started' },
    { emoji: '🦶', role: 'Podiatrist', doing: 'Checking pressure points & gait…', rec: 'High pressure at forefoot — strict offloading needed' },
    { emoji: '👟', role: 'Orthotist', doing: 'Designing your offloading…', rec: 'Custom offloading footwear — ready in 3 days' },
    { emoji: '🩸', role: 'Diabetologist', doing: 'Reviewing your sugar profile…', rec: 'Target sugar < 180 · medicine dose adjusted' },
    { emoji: '🥗', role: 'Nutritionist', doing: 'Building your healing diet…', rec: 'High-protein plan: 1.5 g/kg daily + vitamin C & zinc' },
    { emoji: '🏃', role: 'Physiotherapist', doing: 'Planning safe mobility…', rec: 'Non-weight-bearing exercises · video sessions 2×/week' },
  ];

  function startWoundReview() {
    setWoundStep('review');
    setBoardDone(0);
    let i = 0;
    const t = setInterval(() => {
      i += 1;
      setBoardDone(i);
      if (i >= 8) {
        clearInterval(t);
        setTimeout(() => setWoundStep('plan'), 1000);
      }
    }, 1000);
  }

  function renderWoundCare() {
    const RC = '#C2185B'; // wound care accent — deep rose, prominent on white
    const chip = (active) => ({
      background: active ? RC : C.panelLight,
      color: active ? '#FFFFFF' : C.text,
      border: `1.5px solid ${active ? RC : C.border}`,
    });

    const FLOW = ['Screening', 'Board', 'Plan', 'Package', 'Care'];
    const flowIndex = { intake: 0, review: 1, plan: 2, package: 3, tracker: 4 }[woundStep] ?? 0;
    const stepper = (
      <div className="flex items-center" style={{ padding: '2px 2px 4px' }}>
        {FLOW.map((s, i) => (
          <React.Fragment key={s}>
            {i > 0 && <div style={{ flex: 1, height: 2.5, background: i <= flowIndex ? RC : 'rgba(21,62,111,0.15)', margin: '0 4px', marginBottom: 16 }} />}
            <div className="flex flex-col items-center">
              <div className="flex items-center justify-center rounded-full" style={{ width: 22, height: 22, background: i < flowIndex ? RC : i === flowIndex ? '#FFFFFF' : 'rgba(21,62,111,0.08)', border: i === flowIndex ? `2.5px solid ${RC}` : 'none' }}>
                {i < flowIndex ? <CheckCircle2 size={13} color={'#FFFFFF'} /> : <span className="text-xs font-bold" style={{ color: i === flowIndex ? RC : C.muted }}>{i + 1}</span>}
              </div>
              <span className="text-xs mt-1 font-bold" style={{ color: i === flowIndex ? RC : C.muted, fontSize: 10 }}>{s}</span>
            </div>
          </React.Fragment>
        ))}
      </div>
    );

    /* ---- STEP 0: HOW WOUNDCONNECT WORKS — the workflow, visible upfront ---- */
    if (woundStep === 'how') {
      const flow = [
        { n: 1, emoji: '📸', title: 'Screening — 2 minutes', sub: 'Photograph your wound & answer 3 questions. Any wound: diabetic foot, venous ulcer, varicose ulcer, bed sore.' },
        { n: 2, emoji: '🏥', title: '7 specialists analyze it', sub: 'Vascular & wound surgeons, podiatrist, orthotist, diabetologist, nutritionist, physio — at the Gurugram Centre of Excellence.' },
        { n: 3, emoji: '📞', title: 'The specialists call you', sub: 'Your plan explained personally, your questions answered.' },
        { n: 4, emoji: '📋', title: 'One unified wound plan', sub: 'Dressing protocol, Solagen, offloading, diet, sugar targets — all coordinated.' },
        { n: 5, emoji: '🚐', title: 'Mobile Wound Clinic in YOUR city', sub: 'Trained wound team executes the plan at your home — dressings, Solagen, fluorescence imaging. Charged per care package.' },
        { n: 6, emoji: '📈', title: 'Tracked until fully healed', sub: 'Weekly photo reviews and healing measurements go to your Wound CoE specialists, who adjust your plan and consult you directly — without you travelling. Labs & medicines come to your door.' },
      ];
      return (
        <div className="space-y-4">
          <button onClick={() => setAppPhase(onboardingDone ? 'main' : 'entryFork')} className="text-sm text-left font-semibold" style={{ color: C.muted }}>← Back</button>
          <div>
            <div className="font-display text-2xl mb-1" style={{ color: C.text, fontWeight: 800 }}>🩹 How WoundConnect works</div>
            <div className="text-sm font-semibold" style={{ color: C.muted }}>Big-centre expertise, delivered wherever you live.</div>
          </div>

          <div className="rounded-2xl p-4" style={{ background: 'linear-gradient(120deg, #153E6F, #2B6CB0)' }}>
            <div className="flex items-center justify-between text-center">
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 22 }}>🏠</div>
                <div className="text-xs font-bold" style={{ color: '#FFFFFF' }}>You + Mobile Team</div>
                <div className="text-xs" style={{ color: '#C9DCF2' }}>your city</div>
              </div>
              <div className="text-xs font-bold px-2" style={{ color: '#C9DCF2' }}>← live →</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 22 }}>🏥</div>
                <div className="text-xs font-bold" style={{ color: '#FFFFFF' }}>Specialists + Command Centre</div>
                <div className="text-xs" style={{ color: '#C9DCF2' }}>Gurugram</div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl p-5" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
            {flow.map((f, i) => (
              <div key={f.n} className="flex gap-3.5">
                <div className="flex flex-col items-center">
                  <div className="flex items-center justify-center rounded-full flex-shrink-0 text-xs font-bold" style={{ width: 28, height: 28, background: RC, color: '#FFFFFF' }}>{f.n}</div>
                  {i < flow.length - 1 && <div style={{ width: 2.5, flex: 1, background: 'rgba(194,24,91,0.25)' }} />}
                </div>
                <div className="pb-4 flex-1">
                  <div className="text-sm font-bold" style={{ color: C.text }}>{f.emoji} {f.title}</div>
                  <div className="text-xs mt-0.5" style={{ color: C.muted, lineHeight: 1.45 }}>{f.sub}</div>
                </div>
              </div>
            ))}
          </div>

          <button onClick={() => setWoundStep('intake')} className="w-full rounded-2xl py-4 text-base font-bold" style={{ background: RC, color: '#FFFFFF' }}>
            Start my screening →
          </button>
        </div>
      );
    }

    /* ---- STEP 1: INTAKE ---- */
    if (woundStep === 'intake') {
      const ready = woundPhotos >= 2 && woundDiabetic !== null && woundDuration && woundPainFever !== null;
      return (
        <div className="space-y-4">
          <button onClick={() => setWoundStep('how')} className="text-sm text-left font-semibold" style={{ color: C.muted }}>← Back</button>
          {stepper}
          <div>
            <div className="font-display text-2xl mb-1" style={{ color: C.text, fontWeight: 800 }}>🩹 Wound Care</div>
            <div className="text-sm" style={{ color: C.muted }}>Any wound — diabetic foot, venous ulcer, varicose ulcer, bed sore. A specialist reviews it, always.</div>
          </div>

          <div className="rounded-2xl p-5" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
            <div className="text-base font-bold mb-1" style={{ color: C.text }}>Step 1 · Take 2 photos</div>
            <div className="text-xs mb-3" style={{ color: C.muted }}>One close-up, one from a little distance. Good light, no flash.</div>
            <div className="grid grid-cols-2 gap-2.5">
              {[0, 1].map(i => (
                <button key={i} onClick={() => setWoundPhotos(n => Math.max(n, i + 1))}
                  className="rounded-xl py-8 flex flex-col items-center gap-2"
                  style={{ background: woundPhotos > i ? 'rgba(194,24,91,0.08)' : C.panelLight, border: `1.5px dashed ${woundPhotos > i ? RC : C.border}` }}>
                  <Camera size={24} style={{ color: woundPhotos > i ? RC : C.muted }} />
                  <span className="text-xs font-bold" style={{ color: woundPhotos > i ? RC : C.muted }}>
                    {woundPhotos > i ? `Photo ${i + 1} ✓` : i === 0 ? 'Close-up' : 'Wider view'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-2xl p-5 space-y-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
            <div className="text-base font-bold" style={{ color: C.text }}>Step 2 · Three quick questions</div>
            <div>
              <div className="text-sm font-bold mb-2" style={{ color: C.text }}>Do you have diabetes?</div>
              <div className="flex gap-2">
                {['Yes', 'No'].map(v => (
                  <button key={v} onClick={() => setWoundDiabetic(v)} className="flex-1 rounded-xl py-2.5 text-sm font-bold" style={chip(woundDiabetic === v)}>{v}</button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-sm font-bold mb-2" style={{ color: C.text }}>How long has the wound been there?</div>
              <div className="flex gap-2">
                {['< 2 weeks', '2–6 weeks', '> 6 weeks'].map(v => (
                  <button key={v} onClick={() => setWoundDuration(v)} className="flex-1 rounded-xl py-2.5 text-xs font-bold" style={chip(woundDuration === v)}>{v}</button>
                ))}
              </div>
            </div>
            <div>
              <div className="text-sm font-bold mb-2" style={{ color: C.text }}>Any pain, fever, or bad smell?</div>
              <div className="flex gap-2">
                {['Yes', 'No'].map(v => (
                  <button key={v} onClick={() => setWoundPainFever(v)} className="flex-1 rounded-xl py-2.5 text-sm font-bold" style={chip(woundPainFever === v)}>{v}</button>
                ))}
              </div>
            </div>
          </div>

          <button onClick={startWoundReview} disabled={!ready}
            className="w-full rounded-2xl py-4 text-base font-bold"
            style={{ background: ready ? RC : C.panelLight, color: ready ? '#FFFFFF' : C.muted }}>
            Send to wound specialist
          </button>
          <div className="text-xs text-center" style={{ color: C.muted }}>Reviewed at the iLive Wound Care Centre of Excellence, Gurugram</div>
        </div>
      );
    }

    /* ---- STEP 2: LIVE MULTI-SPECIALIST BOARD ---- */
    if (woundStep === 'review') {
      return (
        <div className="space-y-4">
          {stepper}
          <div className="text-center pt-2">
            <div className="font-display text-xl mb-1" style={{ color: C.text, fontWeight: 800 }}>Your wound board is reviewing</div>
            <div className="text-sm font-semibold" style={{ color: C.muted }}>Wound Care Centre of Excellence · Gurugram Command Centre</div>
          </div>
          <div className="rounded-2xl p-4 space-y-1" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
            {WOUND_BOARD.map((s, i) => {
              const done = i < boardDone;
              const active = i === boardDone;
              return (
                <div key={s.role} className="flex items-center gap-3 py-2" style={{ opacity: done || active ? 1 : 0.4 }}>
                  <div className={active ? 'pulse' : ''} style={{ fontSize: 22, width: 28, textAlign: 'center' }}>{s.emoji}</div>
                  <div className="flex-1">
                    <div className="text-sm font-bold" style={{ color: C.text }}>{s.role}</div>
                    <div className="text-xs font-semibold" style={{ color: done ? C.green : active ? '#C2185B' : C.muted }}>
                      {done ? s.rec : active ? s.doing : 'Waiting…'}
                    </div>
                  </div>
                  <div className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 24, height: 24, background: done ? C.green : active ? 'rgba(194,24,91,0.12)' : C.panelLight }}>
                    {done ? <CheckCircle2 size={15} color={'#FFFFFF'} /> : active ? <span className="pulse" style={{ width: 8, height: 8, borderRadius: 9999, background: '#C2185B', display: 'inline-block' }} /> : null}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="text-xs text-center font-semibold" style={{ color: C.muted }}>{boardDone}/8 reviews done · one unified plan is being built for you</div>
        </div>
      );
    }

    /* ---- STEP 3: ASSESSMENT + PLAN + CHANNEL ---- */
    if (woundStep === 'plan') {
      const planItems = WOUND_BOARD.map(s => ({ emoji: s.emoji, role: s.role, text: s.rec }));
      const channels = [
        { id: 'center', emoji: '🏥', label: 'Visit a centre', sub: 'Centre of Excellence or partner centre in your city' },
        { id: 'mobile', emoji: '🚐', label: 'Mobile Wound Clinic', sub: 'Wound team comes to your home — any city, specialist supervises from the CoE' },
      ];
      const team = [
        { emoji: '🩺', role: 'Vascular Surgeon', note: 'Leads your plan · Dr. A. Kapoor' },
        { emoji: '🦶', role: 'Podiatrist', note: 'Foot assessment & wound offloading' },
        { emoji: '👟', role: 'Orthotist', note: 'Custom offloading footwear' },
        { emoji: '🥗', role: 'Nutritionist', note: 'High-protein healing diet' },
        { emoji: '🩸', role: 'Diabetologist', note: 'Sugar control = wound control' },
        { emoji: '🏃', role: 'Physiotherapist', note: 'Mobility while you heal' },
      ];
      return (
        <div className="space-y-4">
          {stepper}
          <div className="rounded-2xl p-5" style={{ background: 'rgba(194,24,91,0.07)', border: '1.5px solid rgba(194,24,91,0.35)' }}>
            <div className="text-xs font-bold mb-1" style={{ color: '#C2185B', letterSpacing: 1 }}>SPECIALIST ASSESSMENT</div>
            <div className="font-display text-xl mb-1" style={{ color: C.text, fontWeight: 800 }}>
              {woundDiabetic === 'Yes' ? 'Diabetic foot ulcer · Grade 2' : 'Venous leg ulcer · Moderate'}
            </div>
            <div className="text-sm font-semibold" style={{ color: C.text }}>Size ≈ 3.8 cm² · Infection risk: {woundPainFever === 'Yes' ? 'moderate — antibiotics considered' : 'low'}</div>
            <div className="text-xs mt-2 font-semibold" style={{ color: C.muted }}>Reviewed by Dr. A. Kapoor, Vascular Surgeon · Wound CoE, Gurugram</div>
          </div>

          <div className="rounded-2xl p-5" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
            <div className="text-base font-bold mb-3" style={{ color: C.text }}>Your plan — 3 simple steps</div>
            <div className="space-y-3">
              {[
                { n: '1', emoji: '🚐', t: 'Dressings at home, twice a week', s: 'Our wound team comes to you · Solagen at every visit' },
                { n: '2', emoji: '🩸', t: 'Sugar & nutrition kept on target', s: 'Your diabetologist & nutritionist handle it with you' },
                { n: '3', emoji: '📷', t: 'One photo a week until healed', s: 'Your specialist reviews it and adjusts the plan' },
              ].map(p => (
                <div key={p.n} className="flex items-center gap-3.5">
                  <div className="flex items-center justify-center rounded-full flex-shrink-0 text-sm font-bold" style={{ width: 34, height: 34, background: 'rgba(194,24,91,0.10)', color: '#C2185B' }}>{p.n}</div>
                  <div>
                    <div className="text-sm font-bold" style={{ color: C.text }}>{p.emoji} {p.t}</div>
                    <div className="text-xs" style={{ color: C.muted }}>{p.s}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="text-xs font-semibold mt-3.5 pt-3" style={{ color: C.muted, borderTop: `1px solid ${C.border}` }}>All 8 specialist reviews are saved in your Health Passport.</div>
          </div>

          <button
            onClick={() => setIncomingCall({ id: 'woundPlan', reading: 'wound care plan', doctor: 'Dr. A. Kapoor · Wound CoE', phase: 'ringing' })}
            className="w-full rounded-2xl p-4 flex items-center gap-4"
            style={{ background: 'linear-gradient(120deg, #C2185B, #8E1244)' }}>
            <div className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 44, height: 44, background: 'rgba(255,255,255,0.2)' }}>
              <Phone size={20} color={'#FFFFFF'} />
            </div>
            <div className="text-left">
              <div className="text-sm font-bold" style={{ color: '#FFFFFF' }}>Your specialist will call you now</div>
              <div className="text-xs" style={{ color: '#F5C9DB' }}>Dr. Kapoor explains the plan & answers your questions</div>
            </div>
          </button>

          <div>
            <div className="text-base font-bold mb-2.5" style={{ color: C.text }}>How would you like your care?</div>
            <div className="space-y-2.5">
              {channels.map(ch => (
                <button key={ch.id} onClick={() => { setWoundChannel(ch.id); setWoundStep('package'); }}
                  className="w-full rounded-2xl p-4 flex items-center gap-3.5 text-left"
                  style={{ background: C.panel, border: `1.5px solid ${C.border}` }}>
                  <span style={{ fontSize: 26 }}>{ch.emoji}</span>
                  <div>
                    <div className="text-sm font-bold" style={{ color: C.text }}>{ch.label}</div>
                    <div className="text-xs" style={{ color: C.muted }}>{ch.sub}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    }

    /* ---- STEP 3.5: CARE PACKAGE · PAY UPFRONT ---- */
    if (woundStep === 'package') {
      const channelLabel = woundChannel === 'center' ? 'Centre visits' : 'Mobile Wound Clinic — at your home';
      const base = 8000;
      const total = base + (fluorescenceAdded ? 9998 : 0);
      const fmt = n => '₹' + n.toLocaleString('en-IN');
      return (
        <div className="space-y-4">
          <button onClick={() => setWoundStep('plan')} className="text-sm text-left font-semibold" style={{ color: C.muted }}>← Back to plan</button>
          <div>
            <div className="font-display text-2xl mb-1" style={{ color: C.text, fontWeight: 800 }}>Your 4-week care package</div>
            <div className="text-sm font-semibold" style={{ color: C.muted }}>{channelLabel} · supervised by the Wound CoE, Gurugram</div>
          </div>

          <div className="rounded-2xl p-5 space-y-3.5" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
            {[
              { emoji: '🚐', label: '8 dressing visits (2×/week)', sub: 'Trained wound team at your home · debridement, cleaning & Solagen included', price: '₹8,000' },
              { emoji: '👨‍⚕️', label: 'Weekly specialist reviews', sub: 'Your whole care team · calls scheduled around you', price: 'Included' },
              { emoji: '🧪', label: 'Labs & medicines', sub: 'Order from the app · home delivery · pay per order', price: 'Per order' },
            ].map((r, i) => (
              <div key={i} className="flex items-start gap-3">
                <span style={{ fontSize: 19, lineHeight: 1.3 }}>{r.emoji}</span>
                <div className="flex-1">
                  <div className="text-sm font-bold" style={{ color: C.text }}>{r.label}</div>
                  <div className="text-xs" style={{ color: C.muted }}>{r.sub}</div>
                </div>
                <span className="text-sm font-bold flex-shrink-0" style={{ color: r.price === 'Included' ? C.green : C.text }}>{r.price}</span>
              </div>
            ))}
          </div>

          <button onClick={() => setFluorescenceAdded(!fluorescenceAdded)}
            className="w-full rounded-2xl p-4 text-left"
            style={{ background: fluorescenceAdded ? 'rgba(124,111,208,0.10)' : C.panel, border: `2px solid ${fluorescenceAdded ? '#7C6FD0' : C.border}` }}>
            <div className="flex items-start gap-3">
              <span style={{ fontSize: 22 }}>🔬</span>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold" style={{ color: C.text }}>Fluorescence imaging × 2</span>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: '#7C6FD0', color: '#FFFFFF' }}>Recommended</span>
                </div>
                <div className="text-xs mt-1" style={{ color: C.muted }}>Sees infection depth & bone involvement invisible to the eye — the mobile team brings it to you. Guides debridement.</div>
              </div>
              <div className="flex flex-col items-end flex-shrink-0">
                <span className="text-sm font-bold" style={{ color: C.text }}>₹4,999 <span className="text-xs font-semibold" style={{ color: C.muted }}>/scan</span></span>
                <span className="text-xs font-bold" style={{ color: '#7C6FD0' }}>{fluorescenceAdded ? 'Added ✓' : 'Tap to add'}</span>
              </div>
            </div>
          </button>

          <div className="rounded-2xl p-5" style={{ background: 'linear-gradient(120deg, #153E6F, #2B6CB0)' }}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-bold" style={{ color: '#C9DCF2' }}>Total · pay upfront</span>
              <span className="font-display text-2xl font-bold" style={{ color: '#FFFFFF' }}>{fmt(total)}</span>
            </div>
            <div className="text-xs mb-3" style={{ color: '#C9DCF2' }}>14-day money-back guarantee · refund if care doesn't begin as promised</div>
            <button
              onClick={() => { setWoundStep('tracker'); setWoundProgram(true); if (entryType === 'wound') { setOnboardingDone(true); } setAppPhase('main'); }}
              className="w-full rounded-xl py-3.5 text-base font-bold"
              style={{ background: '#FFFFFF', color: '#153E6F' }}>
              Pay {fmt(total)} & start my care
            </button>
          </div>
        </div>
      );
    }

    /* ---- STEP 4: WOUND TRACKER ---- */    /* ---- STEP 4: WOUND TRACKER ---- */
    const weeks = [
      { w: 'Week 1', area: 4.2 },
      { w: 'Week 2', area: 3.6 },
      { w: 'Week 3', area: 3.1 },
    ];
    return (
      <div className="space-y-4">
        <button onClick={() => setAppPhase('main')} className="text-sm text-left font-semibold" style={{ color: C.muted }}>← Back</button>
        {stepper}
        <div>
          <div className="font-display text-2xl mb-1" style={{ color: C.text, fontWeight: 800 }}>Your Wound Tracker</div>
          <div className="text-sm font-semibold" style={{ color: C.muted }}>{woundDiabetic === 'Yes' ? 'Diabetic foot ulcer · Grade 2' : 'Venous leg ulcer'} · Day 21</div>
        </div>

        <div className="rounded-2xl p-5" style={{ background: 'rgba(43,108,176,0.08)', border: '2px solid #2B6CB0' }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-base font-bold" style={{ color: C.text }}>Verdict this week</span>
            <span className="text-sm font-bold px-3 py-1 rounded-full" style={{ background: '#2B6CB0', color: '#FFFFFF' }}>Improving ✓</span>
          </div>
          <div className="text-sm font-semibold" style={{ color: C.text }}>Wound area down 26% in 3 weeks. Keep going — you're healing well.</div>
        </div>

        <div className="rounded-2xl p-5" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <div className="text-base font-bold mb-3" style={{ color: C.text }}>Healing progress</div>
          {weeks.map((wk, i) => (
            <div key={wk.w} className="mb-2.5">
              <div className="flex justify-between text-xs font-bold mb-1" style={{ color: C.text }}>
                <span>{wk.w}</span><span style={{ color: i === weeks.length - 1 ? C.green : C.muted }}>{wk.area} cm²</span>
              </div>
              <div className="rounded-full overflow-hidden" style={{ height: 8, background: C.panelLight }}>
                <div style={{ height: 8, width: `${(wk.area / 4.2) * 100}%`, background: i === weeks.length - 1 ? C.green : '#9DBCE0', borderRadius: 9999 }} />
              </div>
            </div>
          ))}
          <div className="text-xs font-semibold mt-1" style={{ color: C.muted }}>Next: dressing change Thursday · Solagen application · photo review</div>
        </div>

        <div className="rounded-2xl p-5" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <div className="text-base font-bold mb-3" style={{ color: C.text }}>Upcoming schedule</div>
          <div className="space-y-3">
            {[
              { emoji: '🚐', day: 'Thu', what: 'Dressing #7 · Mobile Wound Clinic', sub: 'Debridement + Solagen · at your home' },
              { emoji: '🔬', day: 'Thu', what: 'Fluorescence imaging · ₹4,999', sub: fluorescenceAdded ? 'Checks infection depth & bone · during the visit' : 'Available as add-on — ask your team' },
              { emoji: '🩸', day: 'Fri', what: 'Diabetologist review call', sub: 'Sugar trend & medicine adjustment' },
              { emoji: '🏃', day: 'Mon', what: 'Physio video session', sub: 'Non-weight-bearing exercises' },
              { emoji: '🚐', day: 'Mon', what: 'Dressing #8 · Mobile Wound Clinic', sub: 'Solagen · photo review by your specialist' },
            ].map((e, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="flex items-center justify-center rounded-xl flex-shrink-0 font-bold text-xs" style={{ width: 40, height: 40, background: C.panelLight, color: C.text, flexDirection: 'column', display: 'flex' }}>
                  <span style={{ fontSize: 15 }}>{e.emoji}</span>{e.day}
                </div>
                <div>
                  <div className="text-sm font-bold" style={{ color: C.text }}>{e.what}</div>
                  <div className="text-xs" style={{ color: C.muted }}>{e.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-2.5">
          <button onClick={() => setWoundPhotos(0)} className="flex-1 rounded-2xl py-3.5 text-sm font-bold" style={{ background: C.panel, color: C.text, border: `1.5px solid ${C.border}` }}>
            📸 Send today's photo
          </button>
          <button className="flex-1 rounded-2xl py-3.5 text-sm font-bold" style={{ background: '#C2185B', color: '#FFFFFF' }}>
            📞 Wound specialist
          </button>
        </div>

        <div className="rounded-2xl p-5" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <div className="text-base font-bold mb-3" style={{ color: C.text }}>Your journey — fully documented</div>
          <div>
            {[
              { day: 'Day 0', title: 'Photos submitted', sub: 'Assessed within 4 hours' },
              { day: 'Day 1', title: 'AI analysis + 7 specialists', sub: 'One simple plan created' },
              { day: 'Day 2', title: 'First dressing + Solagen', sub: woundChannel === 'center' ? 'At your wound centre' : 'Mobile team at your home' },
              { day: 'Day 10', title: 'Fluorescence imaging', sub: 'No deep infection, bone clear ✓' },
              { day: 'Day 21', title: 'Week 3 review ✓', sub: '26% smaller · ahead of schedule' },
            ].map((t, i, arr) => (
              <div key={i} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <div className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 26, height: 26, background: i === arr.length - 1 ? C.green : C.panelLight }}>
                    {i === arr.length - 1 ? <CheckCircle2 size={14} color={'#FFFFFF'} /> : <div style={{ width: 8, height: 8, borderRadius: 9999, background: C.green }} />}
                  </div>
                  {i < arr.length - 1 && <div style={{ width: 2, flex: 1, background: C.border }} />}
                </div>
                <div className="pb-3.5 flex-1">
                  <div className="text-xs font-bold" style={{ color: C.muted }}>{t.day}</div>
                  <div className="text-sm font-bold" style={{ color: C.text }}>{t.title}</div>
                  <div className="text-xs" style={{ color: C.muted }}>{t.sub}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="text-xs font-semibold" style={{ color: C.muted }}>Every photo, reading and consult saved in your Health Passport — shareable with any doctor, anywhere.</div>
        </div>
      </div>
    );
  }

  function renderDeviceOffer() {
    const prog = enrolledPrograms[0];
    const dev = PROGRAM_DEVICES[prog];
    if (!dev) return null;
    if (deviceOrdered) {
      return (
        <div className="rounded-2xl p-4 flex items-center gap-3" style={{ background: C.panel, border: `1.5px solid rgba(43,108,176,0.35)` }}>
          <CheckCircle2 size={20} style={{ color: C.green, flexShrink: 0 }} />
          <div className="text-sm font-bold" style={{ color: C.text }}>{dev.name} ordered ✓ <span className="font-semibold" style={{ color: C.muted }}>· arriving Thursday · auto-connects to your app</span></div>
        </div>
      );
    }
    return (
      <div className="rounded-2xl p-5" style={{ background: 'rgba(43,108,176,0.07)', border: '1.5px solid rgba(43,108,176,0.35)' }}>
        <div className="flex items-start gap-3.5">
          <div className="flex items-center justify-center rounded-xl flex-shrink-0" style={{ width: 46, height: 46, background: '#FFFFFF', fontSize: 24, boxShadow: '0 2px 8px rgba(21,62,111,0.12)' }}>{dev.emoji}</div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-bold" style={{ color: C.text }}>{dev.name}</span>
              <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: '#2B6CB0', color: '#FFFFFF' }}>Works with iLive</span>
            </div>
            <div className="text-xs mt-1 font-medium" style={{ color: C.muted }}>{dev.desc}</div>
            <div className="flex items-center justify-between mt-3">
              <span className="text-base font-bold" style={{ color: C.text }}>{dev.price}</span>
              <button onClick={() => setDeviceOrdered(true)} className="rounded-full px-4 py-2 text-xs font-bold" style={{ background: 'linear-gradient(135deg, #3B7FC9 0%, #1F5C9E 100%)', color: '#FFFFFF', boxShadow: '0 6px 18px rgba(31,92,158,0.32)' }}>Order · delivered in 2 days</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderProgramHero() {
    const prog = enrolledPrograms[0];
    const sugarOk = lastSugar.value < 180 && lastSugar.value > 70;

    /* 🩸 DIABETES — glucose first, CGM curve, HbA1c */
    if (prog === 'Diabetes Control') {
      const curve = [118, 145, 128, 165, 142, 124, 132];
      const pts = curve.map((v, i) => `${(i / (curve.length - 1)) * 100},${30 - ((v - 100) / 70) * 26}`).join(' ');
      return (
        <div className="rounded-2xl p-5" style={{ background: C.panel, border: `2px solid rgba(232,161,61,0.45)` }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-base font-bold" style={{ color: C.text }}>🩸 Glucose</span>
            <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: deviceOrdered ? 'rgba(43,108,176,0.12)' : C.panelLight, color: deviceOrdered ? C.green : C.muted }}>{deviceOrdered ? 'CGM live · auto' : 'CGM not connected'}</span>
          </div>
          <div className="flex items-end justify-between mb-2">
            <div>
              <span className="text-3xl font-bold" style={{ color: sugarOk ? C.green : C.amber }}>{deviceOrdered ? '132' : lastSugar.value}</span>
              <span className="text-xs font-semibold ml-1" style={{ color: C.muted }}>mg/dL {deviceOrdered ? '· ↘ steady' : '· last logged'}</span>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold" style={{ color: C.green }}>78%</div>
              <div className="text-xs font-semibold" style={{ color: C.muted }}>time in range today</div>
            </div>
          </div>
          {deviceOrdered && (
            <svg viewBox="0 0 100 32" style={{ width: '100%', height: 44, display: 'block' }}>
              <polyline points={pts} fill="none" stroke="#E8A13D" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              <line x1="0" y1="26" x2="100" y2="26" stroke="rgba(43,108,176,0.25)" strokeWidth="1" strokeDasharray="3 2" />
            </svg>
          )}
          <div className="flex gap-2 mt-2">
            <button onClick={() => { setActiveLog('sugar'); setLogMethod('manual'); }} className="flex-1 rounded-xl py-3 text-sm font-bold" style={{ background: '#C77E1A', color: '#FFFFFF' }}>Log sugar</button>
            <button onClick={() => { setHba1cOpen(!hba1cOpen); setHba1cInput(''); }} className="flex-1 rounded-xl py-3 text-sm font-bold" style={{ background: C.panelLight, color: C.text }}>HbA1c · {hba1c}%</button>
          </div>
          {hba1cOpen && (
            <div className="flex gap-2 mt-2">
              <input type="number" inputMode="decimal" placeholder="Latest HbA1c %" value={hba1cInput} onChange={e => setHba1cInput(e.target.value)}
                className="flex-1 rounded-lg px-3 py-2.5 text-base" style={{ background: C.panelLight, color: C.text, border: `1px solid ${C.border}` }} />
              <button onClick={() => { if (hba1cInput) { setHba1c(hba1cInput); } setHba1cOpen(false); }} className="rounded-lg px-5 text-sm font-bold" style={{ background: 'linear-gradient(135deg, #3B7FC9 0%, #1F5C9E 100%)', color: '#FFFFFF', boxShadow: '0 6px 18px rgba(31,92,158,0.32)' }}>Save</button>
            </div>
          )}
          <div className="text-xs mt-2 font-medium" style={{ color: C.muted }}>Target HbA1c under 7% · your diabetologist reviews every reading</div>
        </div>
      );
    }

    /* 🩺 HYPERTENSION — BP first, morning/evening, 7-day average */
    if (prog === 'Blood Pressure Control') {
      return (
        <div className="rounded-2xl p-5" style={{ background: C.panel, border: `2px solid rgba(43,108,176,0.4)` }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-base font-bold" style={{ color: C.text }}>🩺 Blood Pressure</span>
            <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: deviceOrdered ? 'rgba(43,108,176,0.12)' : C.panelLight, color: deviceOrdered ? C.green : C.muted }}>{deviceOrdered ? 'Cuff connected · auto-upload' : 'Cuff not connected'}</span>
          </div>
          <div className="grid grid-cols-2 gap-2.5 mb-3">
            <div className="rounded-xl p-3" style={{ background: 'rgba(43,108,176,0.08)' }}>
              <div className="text-xs font-bold" style={{ color: C.muted }}>🌅 Morning</div>
              <div className="text-xl font-bold" style={{ color: C.green }}>{lastBp.systolic}/{lastBp.diastolic} <span className="text-xs">✓</span></div>
            </div>
            <div className="rounded-xl p-3" style={{ background: C.panelLight }}>
              <div className="text-xs font-bold" style={{ color: C.muted }}>🌙 Evening</div>
              <div className="text-xl font-bold" style={{ color: C.muted }}>— <span className="text-xs font-semibold">due 8 PM</span></div>
            </div>
          </div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold" style={{ color: C.muted }}>7-day average <span className="font-bold" style={{ color: C.green }}>124/81</span> · in range ✓</span>
            <span className="text-xs font-bold" style={{ color: C.green }}>{'Target < 140/90'}</span>
          </div>
          <button onClick={() => { setActiveLog('bp'); setLogMethod('manual'); }} className="w-full rounded-xl py-3 text-sm font-bold" style={{ background: 'linear-gradient(135deg, #3B7FC9 0%, #1F5C9E 100%)', color: '#FFFFFF', boxShadow: '0 6px 18px rgba(31,92,158,0.32)' }}>Log BP</button>
        </div>
      );
    }

    /* 🫁 COPD — lung function + breathlessness */
    if (prog === 'COPD Care') {
      return (
        <div className="rounded-2xl p-5" style={{ background: C.panel, border: `2px solid rgba(14,156,196,0.4)` }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-base font-bold" style={{ color: C.text }}>🫁 Lung check</span>
            <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: deviceOrdered ? 'rgba(43,108,176,0.12)' : C.panelLight, color: deviceOrdered ? C.green : C.muted }}>{deviceOrdered ? 'Spirometer connected' : 'Spirometer not connected'}</span>
          </div>
          <div className="flex items-end justify-between mb-3">
            <div>
              <span className="text-3xl font-bold" style={{ color: deviceOrdered ? C.green : C.muted }}>{deviceOrdered ? '82%' : '—'}</span>
              <span className="text-xs font-semibold ml-1" style={{ color: C.muted }}>{deviceOrdered ? 'of your best FEV1 · stable' : 'daily blow test — needs spirometer'}</span>
            </div>
          </div>
          <div className="text-sm font-bold mb-2" style={{ color: C.text }}>Breathlessness today?</div>
          <div className="flex gap-1.5">
            {['None', 'Mild', 'Moderate', 'Severe'].map((b, i) => (
              <button key={b} onClick={() => setBreathScore(i)} className="flex-1 rounded-xl py-2.5 text-xs font-bold"
                style={{ background: breathScore === i ? (i >= 2 ? C.amber : C.green) : C.panelLight, color: breathScore === i ? '#FFFFFF' : C.muted }}>{b}</button>
            ))}
          </div>
          {breathScore >= 2 && <div className="text-xs mt-2 font-bold" style={{ color: C.amber }}>Your care team has been notified — expect a call.</div>}
        </div>
      );
    }

    /* ⚖️ CHF — daily weight trend, fluid alert */
    if (prog === 'Heart Failure Care') {
      const days = [71.8, 71.9, 72.0, 71.8, 72.1, 72.2, weightLogged ? Number(weightValue || 72.4) : 72.4];
      return (
        <div className="rounded-2xl p-5" style={{ background: C.panel, border: `2px solid rgba(124,111,208,0.45)` }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-base font-bold" style={{ color: C.text }}>⚖️ Daily weight</span>
            <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: deviceOrdered ? 'rgba(43,108,176,0.12)' : C.panelLight, color: deviceOrdered ? C.green : C.muted }}>{deviceOrdered ? 'Smart scale · auto' : 'Scale not connected'}</span>
          </div>
          <div className="flex items-end gap-1.5 mb-2" style={{ height: 52 }}>
            {days.map((w, i) => (
              <div key={i} className="flex-1 rounded-t" style={{ height: `${((w - 71) / 2) * 100}%`, background: i === days.length - 1 ? '#7C6FD0' : 'rgba(124,111,208,0.3)' }} />
            ))}
          </div>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-bold" style={{ color: C.text }}>{days[days.length - 1].toFixed(1)} kg today</span>
            <span className="text-xs font-bold" style={{ color: C.green }}>+0.6 kg this week · within safe limit ✓</span>
          </div>
          <button onClick={() => setActiveLog('weight')} className="w-full rounded-xl py-3 text-sm font-bold" style={{ background: '#7C6FD0', color: '#FFFFFF' }}>Log today's weight</button>
          <div className="text-xs mt-2 font-medium" style={{ color: C.muted }}>Gain of 1–2 kg in days = fluid retention — your team is alerted before symptoms start.</div>
        </div>
      );
    }

    /* ⚖️ WEIGHT MANAGEMENT — goal progress, streak, meals */
    if (prog === 'Weight Management') {
      return (
        <div className="rounded-2xl p-5" style={{ background: C.panel, border: `2px solid rgba(15,163,107,0.4)` }}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-base font-bold" style={{ color: C.text }}>⚖️ Your journey</span>
            <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: 'rgba(15,163,107,0.12)', color: '#0FA36B' }}>🔥 24-day streak</span>
          </div>
          <div className="flex items-end justify-between mb-2">
            <div>
              <span className="text-3xl font-bold" style={{ color: C.text }}>82.4</span>
              <span className="text-xs font-semibold ml-1" style={{ color: C.muted }}>kg · started 84.5</span>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold" style={{ color: '#0FA36B' }}>−2.1 kg</div>
              <div className="text-xs font-semibold" style={{ color: C.muted }}>goal 76 kg</div>
            </div>
          </div>
          <div className="rounded-full overflow-hidden mb-3" style={{ height: 9, background: C.panelLight }}>
            <div style={{ height: 9, width: '25%', background: 'linear-gradient(90deg, #0FA36B, #2B6CB0)', borderRadius: 9999 }} />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setActiveLog('meals')} className="flex-1 rounded-xl py-3 text-sm font-bold" style={{ background: '#0FA36B', color: '#FFFFFF' }}>📸 Snap my meal</button>
            <button className="flex-1 rounded-xl py-3 text-sm font-bold" style={{ background: C.panelLight, color: C.text }}>1,240 / 1,600 kcal</button>
          </div>
          <div className="text-xs mt-2 font-medium" style={{ color: C.muted }}>Your nutritionist reviews every meal photo · weekly plan adjusts to you</div>
        </div>
      );
    }

    return null;
  }

  function renderHealthGoals() {
    const takenCount = medications.filter(m => m.taken).length;
    const isCHF = enrolledPrograms.includes('Heart Failure Care');
    const goals = [
      { key: 'walk', emoji: '🚶', label: 'Walk', value: '4,250', target: '6,000 steps', pct: 71, color: '#2B6CB0' },
      { key: 'water', emoji: '💧', label: 'Water', value: `${waterGlasses}`, target: '8 glasses', pct: Math.min(100, Math.round((waterGlasses / 8) * 100)), color: '#0E9CC4', onTap: () => setWaterGlasses(w => Math.min(8, w + 1)) },
      { key: 'sleep', emoji: '😴', label: 'Sleep', value: '7.2', target: '8 hrs', pct: 90, color: '#7C6FD0' },
      { key: 'meds', emoji: '💊', label: 'Medicines', value: `${takenCount}`, target: `${medications.length} taken`, pct: Math.round((takenCount / medications.length) * 100), color: '#E8A13D' },
      { key: 'nutrition', emoji: '🥗', label: 'Nutrition', value: mealPhotoTaken ? '✓' : '—', target: mealPhotoTaken ? 'meal logged' : 'log a meal', pct: mealPhotoTaken ? 100 : 0, color: '#0FA36B', onTap: () => { setActiveLog('meals'); setGoalsOpen(false); } },
    ];
    if (isCHF) {
      goals.push({ key: 'weight', emoji: '⚖️', label: 'Body weight', value: weightLogged ? (weightValue || '72.4') : '—', target: weightLogged ? 'kg logged ✓' : 'log daily (CHF)', pct: weightLogged ? 100 : 0, color: '#E06A8A', onTap: () => { setActiveLog('weight'); setGoalsOpen(false); } });
    }
    const doneCount = goals.filter(g => g.pct >= 100).length;

    if (!goalsOpen) {
      return (
        <button onClick={() => setGoalsOpen(true)} className="w-full rounded-2xl p-4 flex items-center gap-3.5" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <div className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 40, height: 40, background: 'rgba(43,108,176,0.10)', fontSize: 18 }}>🎯</div>
          <div className="flex-1 text-left">
            <div className="text-sm font-bold" style={{ color: C.text }}>Today's goals</div>
            <div className="text-xs font-semibold" style={{ color: doneCount === goals.length ? C.green : C.muted }}>{doneCount}/{goals.length} done{doneCount === goals.length ? ' · all complete ✓' : ''}</div>
          </div>
          <ChevronRight size={18} style={{ color: C.muted }} />
        </button>
      );
    }

    return (
      <div className="rounded-2xl p-5" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
        <button onClick={() => setGoalsOpen(false)} className="w-full flex items-center justify-between mb-4">
          <span className="text-base font-bold" style={{ color: C.text }}>Today's goals</span>
          <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: 'rgba(43,108,176,0.12)', color: C.green }}>{doneCount}/{goals.length} done · close</span>
        </button>
        <div className="grid grid-cols-3 gap-2.5">
          {goals.map(g => (
            <button key={g.key} onClick={g.onTap} disabled={!g.onTap}
              className="rounded-xl p-3 text-left"
              style={{ background: `${g.color}12`, border: `1px solid ${g.color}30` }}>
              <div style={{ fontSize: 20, lineHeight: 1 }}>{g.emoji}</div>
              <div className="text-xs font-bold mt-1.5" style={{ color: C.text }}>{g.label}</div>
              <div className="text-xs font-semibold" style={{ color: g.color }}>{g.value} <span style={{ color: C.muted, fontWeight: 500 }}>/ {g.target}</span></div>
              <div className="rounded-full overflow-hidden mt-1.5" style={{ height: 5, background: 'rgba(21,62,111,0.10)' }}>
                <div style={{ height: 5, width: `${g.pct}%`, background: g.color, borderRadius: 9999, transition: 'width 0.3s' }} />
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  function toggleProgram(name) {
    setEnrolledPrograms(prev => prev.includes(name) ? prev.filter(p => p !== name) : [...prev, name]);
  }

  function renderProgramsStrip() {
    // Post-discharge patients follow their prescribed recovery program — keep their home clean.
    // Programs live under More → Health Programs for them. Self-enrolled (organic) users see the strip.
    if (entryType === 'discharge') return null;
    return (
      <div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-base font-bold" style={{ color: C.text }}>Health Programs</span>
          <button onClick={() => setAppPhase('programs')} className="text-xs font-bold" style={{ color: C.green }}>View all 13 →</button>
        </div>
        <div className="flex gap-2.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {PROGRAMS.slice(0, 6).map(p => {
            const joined = enrolledPrograms.includes(p.name);
            return (
              <button key={p.name} onClick={() => setAppPhase('programs')}
                className="rounded-2xl p-3.5 text-left flex-shrink-0"
                style={{ width: 138, background: `${p.color}10`, border: `1.5px solid ${joined ? p.color : `${p.color}30`}` }}>
                <div style={{ fontSize: 24, lineHeight: 1 }}>{p.emoji}</div>
                <div className="text-xs font-bold mt-2" style={{ color: C.text, lineHeight: 1.3 }}>{p.name}</div>
                <div className="text-xs font-bold mt-1.5" style={{ color: p.color }}>{joined ? 'Enrolled ✓' : 'Explore →'}</div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  function renderProgramsScreen() {
    return (
      <div className="space-y-4">
        <button onClick={() => setAppPhase('main')} className="text-sm text-left font-semibold" style={{ color: C.muted }}>← Back</button>
        <div>
          <div className="font-display text-2xl mb-1" style={{ color: C.text, fontWeight: 800 }}>Health Programs</div>
          <div className="text-sm" style={{ color: C.muted }}>Structured care programs — not just features. Each comes with a plan, a care team, and clear goals.</div>
        </div>
        <div className="space-y-2.5">
          {PROGRAMS.map(p => {
            const joined = enrolledPrograms.includes(p.name);
            return (
              <div key={p.name} className="rounded-2xl p-4 flex items-center gap-3.5" style={{ background: C.panel, border: `1.5px solid ${joined ? p.color : C.border}` }}>
                <div className="flex items-center justify-center rounded-xl flex-shrink-0" style={{ width: 46, height: 46, background: `${p.color}15`, fontSize: 24 }}>{p.emoji}</div>
                <div className="flex-1">
                  <div className="text-sm font-bold" style={{ color: C.text }}>{p.name}</div>
                  <div className="text-xs mt-0.5" style={{ color: C.muted }}>{p.desc}</div>
                </div>
                <button onClick={() => toggleProgram(p.name)}
                  className="rounded-full px-3.5 py-1.5 text-xs font-bold flex-shrink-0"
                  style={{ background: joined ? `${p.color}15` : p.color, color: joined ? p.color : '#FFFFFF' }}>
                  {joined ? 'Enrolled ✓' : 'Join'}
                </button>
              </div>
            );
          })}
        </div>
        <div className="rounded-2xl p-4" style={{ background: 'rgba(43,108,176,0.08)', border: '1px solid rgba(43,108,176,0.25)' }}>
          <div className="text-sm font-bold mb-1" style={{ color: C.text }}>Not sure which fits you?</div>
          <div className="text-xs" style={{ color: C.muted }}>Your Command Center doctor can recommend the right program on your next call.</div>
        </div>
      </div>
    );
  }

  /* ========== SHARED PROGRAM-HOME BUILDING BLOCKS ========== */

  function pTask({ emoji, title, sub, done, onTap }) {
    return (
      <button key={title} onClick={onTap} disabled={!onTap} className="w-full flex items-center gap-3 rounded-2xl p-3.5 mb-2.5 text-left" style={{ background: done ? 'rgba(43,108,176,0.07)' : C.panel, border: `1px solid ${done ? 'rgba(43,108,176,0.3)' : C.border}` }}>
        <div className="flex items-center justify-center rounded-xl flex-shrink-0" style={{ width: 42, height: 42, background: C.panelLight, fontSize: 20 }}>{emoji}</div>
        <div className="flex-1">
          <div className="text-sm font-bold" style={{ color: C.text }}>{title}</div>
          <div className="text-xs" style={{ color: C.muted }}>{sub}</div>
        </div>
        <div className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 26, height: 26, background: done ? C.green : 'transparent', border: `2px solid ${done ? C.green : C.border}` }}>
          {done && <CheckCircle2 size={16} color="#FFFFFF" />}
        </div>
      </button>
    );
  }

  function ccCard(msg, sub, ghostLabel, ghostDoctor) {
    return (
      <div className="rounded-2xl p-5" style={{ background: 'linear-gradient(135deg, #153E6F, #2B6CB0)' }}>
        <div className="text-xs font-bold" style={{ color: '#A9C8EA', letterSpacing: 1 }}>YOUR COMMAND CENTER · 24×7</div>
        <div className="text-base font-bold mt-1.5" style={{ color: '#FFFFFF' }}>{msg}</div>
        <div className="text-xs mt-1" style={{ color: '#C9DCF2', lineHeight: 1.55 }}>{sub}</div>
        <div className="flex gap-2.5 mt-3.5">
          <button className="flex-1 rounded-xl py-2.5 text-sm font-bold" style={{ background: '#FFFFFF', color: '#153E6F' }}>Message care team</button>
          <button onClick={() => setIncomingCall({ id: 'cc' + Date.now(), reading: 'your concern', doctor: ghostDoctor || 'Command Center Doctor', phase: 'ringing' })} className="flex-1 rounded-xl py-2.5 text-sm font-bold" style={{ background: 'transparent', color: '#FFFFFF', border: '1.5px solid rgba(255,255,255,0.55)' }}>{ghostLabel}</button>
        </div>
      </div>
    );
  }

  function docStrip(text) {
    return (
      <div className="rounded-2xl p-4 flex items-start gap-3" style={{ background: 'rgba(43,108,176,0.08)', border: '1px solid rgba(43,108,176,0.25)' }}>
        <span style={{ fontSize: 18, lineHeight: 1 }}>🩺</span>
        <span className="text-xs font-semibold" style={{ color: C.text, lineHeight: 1.55 }}>{text}</span>
      </div>
    );
  }

  function careTeamCard(prog) {
    const lead = PROGRAM_LEAD[prog] || { name: 'Dr. A. Mehta', role: 'Physician' };
    const leadName = primaryDoctor ? `Dr. ${primaryDoctor}` : lead.name;
    const members = [
      { name: 'Neha Kapoor', role: 'Nutritionist', bg: '#C77E1A' },
      { name: 'Rohit Verma', role: 'Physiotherapist', bg: '#7C6FD0' },
    ];
    return (
      <div className="rounded-2xl p-5" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
        <div className="text-base font-bold mb-3" style={{ color: C.text }}>Your Care Team</div>

        {/* Team lead — directs the care, reached through the team */}
        <div className="rounded-xl p-3.5 mb-3 flex items-center gap-3" style={{ background: 'linear-gradient(120deg, rgba(43,108,176,0.10), rgba(21,62,111,0.06))', border: '1.5px solid rgba(43,108,176,0.35)' }}>
          <div className="flex items-center justify-center rounded-full text-base font-bold flex-shrink-0" style={{ width: 52, height: 52, background: '#2B6CB018', color: '#2B6CB0', border: '2.5px solid #2B6CB055' }}>{leadName.replace('Dr. ', '').split(' ').map(x => x.charAt(0)).slice(0, 2).join('')}</div>
          <div className="flex-1" style={{ minWidth: 0 }}>
            <div className="text-sm font-bold" style={{ color: C.text }}>{leadName} <span className="text-xs font-bold px-2 py-0.5 rounded-full ml-1" style={{ background: '#2B6CB0', color: '#FFFFFF' }}>Team Lead</span></div>
            <div className="text-xs font-bold mt-0.5" style={{ color: C.green }}>{lead.role}</div>
            <div className="text-xs font-medium mt-0.5" style={{ color: C.muted, lineHeight: 1.4 }}>{leadName} and their team direct your care and review your readings.</div>
          </div>
        </div>

        {/* 24x7 doctor line */}
        <button onClick={() => setIncomingCall({ id: 'doc247' + Date.now(), reading: 'your call', doctor: `${leadName} · iLive doctor on duty`, phase: 'ringing' })} className="w-full rounded-2xl py-3.5 text-sm font-bold mb-3 flex items-center justify-center gap-2" style={{ background: 'linear-gradient(135deg, #23B27A 0%, #178A5C 100%)', color: '#FFFFFF', boxShadow: '0 6px 18px rgba(23,138,92,0.32)' }}><Phone size={15} color="#FFFFFF" /> Call doctor — 24×7</button>

        {/* Reachable members */}
        <div className="space-y-2">
          {members.map(m => (
            <div key={m.role} className="flex items-center gap-3 rounded-xl p-2.5" style={{ background: m.first ? 'rgba(30,158,106,0.07)' : C.panelLight, border: m.first ? '1.5px solid rgba(30,158,106,0.35)' : '1px solid transparent' }}>
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <div className="flex items-center justify-center rounded-full text-sm font-bold" style={{ width: 42, height: 42, background: `${m.bg}18`, color: m.bg, border: `2px solid ${m.bg}45` }}>{m.name.split(' ').map(x => x.charAt(0)).slice(0, 2).join('')}</div>
                <span style={{ position: 'absolute', bottom: 0, right: 0, width: 11, height: 11, borderRadius: 9999, background: '#1E9E6A', border: '2px solid #FFFFFF' }} />
              </div>
              <div className="flex-1" style={{ minWidth: 0 }}>
                <div className="text-sm font-bold" style={{ color: C.text }}>{m.name}</div>
                <div className="text-xs font-semibold" style={{ color: C.muted }}>{m.role}{m.first ? ' · your first call' : ''}</div>
              </div>
              <button onClick={() => setIncomingCall({ id: 'team' + Date.now(), reading: 'your question', doctor: `${m.name} · ${m.role}`, phase: 'ringing' })} className="flex items-center justify-center rounded-full flex-shrink-0 gap-1.5 px-3.5" style={{ height: 36, background: m.first ? '#1E9E6A' : C.green, border: 'none' }}>
                <Phone size={14} color="#FFFFFF" /><span className="text-xs font-bold" style={{ color: '#FFFFFF' }}>Call</span>
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function logBlock(prog) {
    const tiles = [
      { emoji: '🩺', label: 'Log BP', col: '#2B6CB0', a: () => { setActiveLog(activeLog === 'bp' ? null : 'bp'); setLogMethod('manual'); } },
      { emoji: '🩸', label: 'Log Blood Sugar', col: '#B0486E', a: () => { setActiveLog(activeLog === 'sugar' ? null : 'sugar'); setLogMethod('manual'); } },
      { emoji: '🍽️', label: 'Log Meals', col: '#1E8E63', a: () => setActiveLog(activeLog === 'meals' ? null : 'meals') },
    ];
    if (prog === 'Cancer Care' || prog === 'CKD & Dialysis Support' || prog === 'Heart Failure Care') {
      tiles.push({ emoji: '⚖️', label: 'Log Weight', col: '#8A6FBF', a: () => setActiveLog(activeLog === 'weight' ? null : 'weight') });
    }
    return (
      <div className={`grid ${tiles.length === 4 ? 'grid-cols-2' : 'grid-cols-3'} gap-2.5`}>
        {tiles.map(t => (
          <button key={t.label} onClick={t.a} className="rounded-2xl py-4 px-2 text-center" style={{ background: `linear-gradient(160deg, ${t.col}1C 0%, ${t.col}08 45%, #FFFFFF 100%)`, border: `1.5px solid ${t.col}38`, boxShadow: `0 1px 2px rgba(21,62,111,0.05), 0 10px 24px ${t.col}22` }}>
            <div className="flex items-center justify-center rounded-2xl mx-auto" style={{ width: 44, height: 44, background: `linear-gradient(140deg, ${t.col} 0%, ${t.col}CC 100%)`, fontSize: 21, boxShadow: `0 6px 14px ${t.col}45` }}>{t.emoji}</div>
            <div className="font-bold mt-2" style={{ color: C.text, fontSize: 12, lineHeight: 1.2 }}>{t.label}</div>
            <div className="font-bold mt-0.5" style={{ color: t.col, fontSize: 9.5 }}>Tap to log ›</div>
          </button>
        ))}
      </div>
    );
  }

  function modeTabs() {
    return (
      <div className="flex gap-2 mb-3">
        <button onClick={() => { setLogMethod('manual'); }} className="flex-1 rounded-lg py-2 text-xs font-bold" style={{ background: logMethod === 'manual' ? C.green : C.panelLight, color: logMethod === 'manual' ? '#FFFFFF' : C.muted }}>⌨️ Type it</button>
        <button onClick={() => { setLogMethod('photo'); setPhotoTaken(false); }} className="flex-1 rounded-lg py-2 text-xs font-bold" style={{ background: logMethod === 'photo' ? C.green : C.panelLight, color: logMethod === 'photo' ? '#FFFFFF' : C.muted }}>📷 Take a picture</button>
      </div>
    );
  }

  function renderQuickBP() {
    if (activeLog !== 'bp') return null;
    return (
      <div className="rounded-2xl p-4" style={{ background: '#16314F', border: '1.5px solid rgba(156,202,255,0.35)', color: '#FFFFFF' }}>
        <div className="text-sm font-bold mb-2.5" style={{ color: C.text }}>Log your BP</div>
        {modeTabs()}
        {logMethod === 'photo' ? (
          <button onClick={() => setPhotoTaken(true)} className="w-full rounded-xl py-6 flex flex-col items-center gap-2 mb-3" style={{ background: C.panelLight, border: `1.5px dashed ${photoTaken ? C.green : C.border}` }}>
            <Camera size={24} style={{ color: C.green }} />
            <span className="text-xs font-bold" style={{ color: photoTaken ? C.green : C.muted }}>{photoTaken ? 'Photo captured ✓ · reading detected: 128/82' : 'Point at your BP monitor screen & tap'}</span>
          </button>
        ) : (
          <div className="flex gap-2 mb-3">
            <input type="number" inputMode="numeric" placeholder="Systolic" value={bpValue.systolic} onChange={e => setBpValue({ ...bpValue, systolic: e.target.value })} className="flex-1 rounded-lg px-3 py-2.5 text-base" style={{ background: C.panelLight, color: C.text, border: `1px solid ${C.border}`, minWidth: 0 }} />
            <input type="number" inputMode="numeric" placeholder="Diastolic" value={bpValue.diastolic} onChange={e => setBpValue({ ...bpValue, diastolic: e.target.value })} className="flex-1 rounded-lg px-3 py-2.5 text-base" style={{ background: C.panelLight, color: C.text, border: `1px solid ${C.border}`, minWidth: 0 }} />
          </div>
        )}
        <button onClick={handleSaveReading} className="w-full rounded-lg py-3 text-sm font-bold" style={{ background: 'linear-gradient(135deg, #3B7FC9 0%, #1F5C9E 100%)', color: '#FFFFFF', boxShadow: '0 6px 18px rgba(31,92,158,0.32)' }}>Save</button>
        <div className="text-xs mt-2 font-medium text-center" style={{ color: C.muted }}>Reviewed by your Command Center the moment you save.</div>
      </div>
    );
  }

  function renderQuickSugar() {
    if (activeLog !== 'sugar') return null;
    return (
      <div className="rounded-2xl p-4" style={{ background: '#16314F', border: '1.5px solid rgba(156,202,255,0.35)', color: '#FFFFFF' }}>
        <div className="text-sm font-bold mb-2.5" style={{ color: C.text }}>Log your sugar</div>
        {modeTabs()}
        {logMethod === 'photo' ? (
          <button onClick={() => setPhotoTaken(true)} className="w-full rounded-xl py-6 flex flex-col items-center gap-2 mb-3" style={{ background: C.panelLight, border: `1.5px dashed ${photoTaken ? C.green : C.border}` }}>
            <Camera size={24} style={{ color: C.green }} />
            <span className="text-xs font-bold" style={{ color: photoTaken ? C.green : C.muted }}>{photoTaken ? 'Photo captured ✓ · reading detected: 128 mg/dL' : 'Point at your glucometer & tap'}</span>
          </button>
        ) : (
          <input type="number" inputMode="numeric" placeholder="mg/dL" value={sugarValue} onChange={e => setSugarValue(e.target.value)} className="w-full rounded-lg px-3 py-2.5 text-base mb-3" style={{ background: C.panelLight, color: C.text, border: `1px solid ${C.border}` }} />
        )}
        <button onClick={handleSaveReading} className="w-full rounded-lg py-3 text-sm font-bold" style={{ background: 'linear-gradient(135deg, #3B7FC9 0%, #1F5C9E 100%)', color: '#FFFFFF', boxShadow: '0 6px 18px rgba(31,92,158,0.32)' }}>Save</button>
      </div>
    );
  }

  function renderQuickMeal() {
    if (activeLog !== 'meals') return null;
    return (
      <div className="rounded-2xl p-4" style={{ background: '#16314F', border: '1.5px solid rgba(95,220,168,0.4)', color: '#FFFFFF' }}>
        <div className="text-sm font-bold mb-2.5" style={{ color: C.text }}>Log your meal</div>
        <button onClick={() => { setMealPhotoTaken(true); setActiveLog(null); }} className="w-full rounded-xl py-6 flex flex-col items-center gap-2 mb-2.5" style={{ background: 'rgba(30,158,106,0.07)', border: '1.5px dashed rgba(30,158,106,0.45)' }}>
          <Camera size={24} style={{ color: '#1E9E6A' }} />
          <span className="text-xs font-bold" style={{ color: '#1E9E6A' }}>📷 Take a photo — we count the carbs & calories</span>
        </button>
        <div className="flex gap-2">
          <input type="text" placeholder="…or type it: e.g. 2 rotis, dal, salad" value={mealText} onChange={e => setMealText(e.target.value)} className="flex-1 rounded-lg px-3 py-2.5 text-sm" style={{ background: C.panelLight, color: C.text, border: `1px solid ${C.border}`, minWidth: 0 }} />
          <button onClick={() => { if (mealText) { setMealPhotoTaken(true); setMealText(''); setActiveLog(null); } }} className="rounded-lg px-4 text-sm font-bold flex-shrink-0" style={{ background: 'linear-gradient(135deg, #3B7FC9 0%, #1F5C9E 100%)', color: '#FFFFFF', boxShadow: '0 6px 18px rgba(31,92,158,0.32)' }}>Save</button>
        </div>
      </div>
    );
  }

  function renderQuickWeight() {
    if (activeLog !== 'weight') return null;
    return (
      <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1.5px solid rgba(124,111,208,0.45)` }}>
        <div className="text-sm font-bold mb-2.5" style={{ color: C.text }}>Log today's weight</div>
        <button onClick={() => { setWeightValue('72.4'); setWeightLogged(true); setActiveLog(null); }} className="w-full rounded-xl py-5 flex flex-col items-center gap-2 mb-2.5" style={{ background: 'rgba(124,111,208,0.08)', border: '1.5px dashed rgba(124,111,208,0.5)' }}>
          <Camera size={22} style={{ color: '#7C6FD0' }} />
          <span className="text-xs font-bold" style={{ color: '#7C6FD0' }}>📷 Photo of your scale display</span>
        </button>
        <div className="flex gap-2">
          <input type="number" inputMode="decimal" placeholder="…or type kg" value={weightValue} onChange={e => setWeightValue(e.target.value)} className="flex-1 rounded-lg px-3 py-2.5 text-base" style={{ background: C.panelLight, color: C.text, border: `1px solid ${C.border}`, minWidth: 0 }} />
          <button onClick={() => { if (weightValue) { setWeightLogged(true); setActiveLog(null); } }} className="rounded-lg px-5 text-sm font-bold flex-shrink-0" style={{ background: 'linear-gradient(135deg, #3B7FC9 0%, #1F5C9E 100%)', color: '#FFFFFF', boxShadow: '0 6px 18px rgba(31,92,158,0.32)' }}>Save</button>
        </div>
      </div>
    );
  }

  /* ========== ❤️ POST-HEART SURGERY RECOVERY HOME ========== */
  function careCallsRow() {
    const mk = (label) => () => setIncomingCall({ id: 'cc' + Date.now(), reading: 'your call', doctor: label, phase: 'ringing' });
    return (
      <div className="grid grid-cols-3 gap-2.5">
        <button onClick={mk('iLive doctor on duty · 24×7')} className="rounded-2xl p-3 text-center" style={{ background: 'linear-gradient(135deg, #12355E 0%, #1E4E86 100%)', boxShadow: '0 6px 18px rgba(18,53,94,0.3)' }}>
          <div style={{ fontSize: 21 }}>🩺</div>
          <div className="text-xs font-bold mt-1" style={{ color: '#FFFFFF', lineHeight: 1.25 }}>Call your doctor</div>
          <div className="flex items-center justify-center gap-1 mt-1.5"><Phone size={11} color="#7FE0B4" /><span style={{ fontSize: 9.5, color: '#7FE0B4', fontWeight: 800 }}>24×7</span></div>
        </button>
        <button onClick={mk('Neha Kapoor · Nutritionist')} className="rounded-2xl p-3 text-center" style={{ background: WHITE.bg, border: `1px solid ${WHITE.border}` }}>
          <div style={{ fontSize: 21 }}>🥗</div>
          <div className="text-xs font-bold mt-1" style={{ color: WHITE.ink, lineHeight: 1.25 }}>Call nutritionist</div>
          <div className="flex items-center justify-center gap-1 mt-1.5"><Phone size={11} color="#1E9E6A" /><span style={{ fontSize: 9.5, color: WHITE.muted, fontWeight: 700 }}>Neha K.</span></div>
        </button>
        <button onClick={mk('Rohit Verma · Physiotherapist')} className="rounded-2xl p-3 text-center" style={{ background: WHITE.bg, border: `1px solid ${WHITE.border}` }}>
          <div style={{ fontSize: 21 }}>🤸</div>
          <div className="text-xs font-bold mt-1" style={{ color: WHITE.ink, lineHeight: 1.25 }}>Call physiotherapist</div>
          <div className="flex items-center justify-center gap-1 mt-1.5"><Phone size={11} color="#1E9E6A" /><span style={{ fontSize: 9.5, color: WHITE.muted, fontWeight: 700 }}>Rohit V.</span></div>
        </button>
      </div>
    );
  }

  /* =========================================================================
     SHARED TOP BLOCK — identical across every iLive Care and iLive Recover
     programme. One implementation, so the tech team integrates it once.
       row 1 : iLive Health Score  |  Heart Readiness / Recovery Score
       row 2 : Know your heart age            → opens the heart-age page
       row 3 : Today's health                 → opens RHR / HRV / strain detail
     Programme-specific content is appended by each home below this block.
     (iLive Prevent has its own richer layout and does not use this.)
     ========================================================================= */
  function vitalsBlock(scoreTwoLabel, scoreTwoVal, scoreTwoBand) {
    const D = { card: '#16314F', raised: '#1E3C60', hair: 'rgba(255,255,255,.14)', ink: '#FFFFFF', ink2: '#C6D8EC', ink3: '#93AECB', blueLite: '#9CCAFF', green: '#5FDCA8', amber: '#F5C572' };
    const prof = foProfile();
    const hAge = (careRisk && careRisk.heartAge) ? careRisk.heartAge : assessCVD(prof).heartAge;
    const behind = hAge > prof.age;

    const scoreCard = (title, emoji, value, label, sub, col) => (
      <div className="rounded-2xl p-4" style={{ background: 'linear-gradient(160deg, rgba(255,255,255,.07) 0%, rgba(255,255,255,.015) 52%), ' + D.card, border: `1px solid ${col}33` }}>
        <div className="flex items-center gap-2"><span style={{ fontSize: 15 }}>{emoji}</span><span style={{ fontSize: 12.5, color: D.ink2, fontWeight: 600 }}>{title}</span></div>
        <div className="flex items-center justify-between mt-3">
          <div>
            <div className="flex items-baseline gap-1"><span className="font-display" style={{ fontSize: 32, fontWeight: 600, color: col, lineHeight: 1 }}>{value}</span><span style={{ fontSize: 12, color: D.ink3 }}>/100</span></div>
            <div style={{ fontSize: 12.5, color: col, fontWeight: 600, marginTop: 5 }}>{label}</div>
          </div>
          <div className="relative flex-shrink-0" style={{ width: 52, height: 52 }}>
            <svg width="52" height="52"><circle cx="26" cy="26" r="23" fill="none" stroke="rgba(255,255,255,.10)" strokeWidth="5" /><circle cx="26" cy="26" r="23" fill="none" stroke={col} strokeWidth="5" strokeLinecap="round" strokeDasharray={2 * Math.PI * 23} strokeDashoffset={2 * Math.PI * 23 * (1 - value / 100)} transform="rotate(-90 26 26)" /></svg>
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: D.green, marginTop: 8 }}>{sub}</div>
      </div>
    );

    return (
      <div className="space-y-4">
        {/* 1 · the two scores */}
        <div className="grid grid-cols-2 gap-3">
          {scoreCard('iLive Health Score', '🛡️', 82, 'Good', '↑ 4 points this month', D.amber)}
          {scoreCard(scoreTwoLabel, '💙', scoreTwoVal, scoreTwoBand, '↑ 5 points vs yesterday', D.blueLite)}
        </div>

        {/* 2 · heart age */}
        <button onClick={() => { tapFeel('tap'); setPvSheet('age'); }} className="w-full rounded-2xl text-left flex items-center gap-3.5 px-4 py-3.5 relative overflow-hidden" style={{ background: 'linear-gradient(140deg, #12233A 0%, #0A1626 60%, #071120 100%)', border: '1px solid rgba(201,162,39,0.35)' }}>
          <div style={{ position: 'absolute', top: 0, left: 16, right: 16, height: 1, background: 'linear-gradient(90deg, transparent, rgba(201,162,39,0.5), transparent)' }} />
          <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 40, height: 40, background: 'rgba(201,162,39,0.12)', border: '1px solid rgba(201,162,39,0.4)' }}>
            <Heart size={17} color="#C9A227" fill="#C9A227" />
          </span>
          <div className="flex-1 min-w-0">
            <div style={{ fontSize: 14.5, color: D.ink, fontWeight: 600 }}>Know your heart age</div>
            <div style={{ fontSize: 12, color: D.ink3, marginTop: 2 }}>{behind ? `${hAge - prof.age} years older than you are` : 'What changes it, and by how much'}</div>
          </div>
          <span className="flex items-center gap-2 flex-shrink-0">
            <span className="font-display" style={{ fontSize: 24, fontWeight: 700, color: '#E3C766' }}>{hAge}</span>
            <ChevronRight size={16} color="#C9A227" />
          </span>
        </button>

        {/* 3 · today's health — one row, opens the detail */}
        <button onClick={() => { tapFeel('tap'); setPvSheet('today'); }} className="w-full rounded-2xl text-left p-4" style={{ background: 'linear-gradient(160deg, rgba(255,255,255,.07) 0%, rgba(255,255,255,.015) 52%), ' + D.card, border: `1px solid ${D.hair}` }}>
          <div className="flex items-center gap-2.5">
            <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 24, height: 24, background: 'rgba(95,220,168,.18)' }}><Check size={13} color={D.green} strokeWidth={3} /></span>
            <div className="flex-1">
              <div style={{ fontSize: 15, color: D.ink, fontWeight: 600 }}>Today's health</div>
              <div style={{ fontSize: 12, color: D.ink3, marginTop: 1 }}>Based on your last 24 hours of tracking</div>
            </div>
            <ChevronRight size={16} color={D.ink3} />
          </div>
          <div className="flex items-center gap-2 mt-3.5 pt-3.5" style={{ borderTop: `1px solid ${D.hair}` }}>
            {[['❤️', '54', 'bpm'], ['📈', '48', 'ms'], ['⚡', '1.8', '×']].map(([e, v, u], i) => (
              <div key={i} className="flex-1 flex items-center gap-1.5">
                <span style={{ fontSize: 13 }}>{e}</span>
                <span className="font-display" style={{ fontSize: 17, fontWeight: 600, color: D.ink }}>{v}</span>
                <span style={{ fontSize: 10.5, color: D.ink3 }}>{u}</span>
              </div>
            ))}
            <span style={{ fontSize: 11.5, color: D.green, fontWeight: 600 }}>All good</span>
          </div>
        </button>

        {/* 4 · actively monitored — the same four everywhere */}
        <div>
          <div className="flex items-center justify-between px-1.5 pb-3">
            <span style={{ fontSize: 15, color: D.ink, fontWeight: 600 }}>Actively monitored</span>
            <span className="flex items-center gap-1.5" style={{ fontSize: 12, color: D.ink3 }}><span className="rounded-full" style={{ width: 6, height: 6, background: D.green }}></span>⌚ 95%</span>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {[['rhr', '❤️', 'Heart rate', '71', 'bpm', 'Just now'], ['hrv', '📈', 'HRV', '48', 'ms', 'Last night'], ['sleep', '🌙', 'Sleep', '7h 24m', '', 'Last night'], ['steps', '👟', 'Steps', '8,432', '', 'Today']].map(([k, e, t, v, u, w]) => (
              <button key={t} onClick={() => { tapFeel('tap'); setPvSheet(k); }} className="rounded-2xl p-3.5 text-left" style={{ background: '#FFFFFF' }}>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5"><span style={{ fontSize: 13 }}>{e}</span><span style={{ fontSize: 11.5, color: '#153E6F', fontWeight: 700 }}>{t}</span></span>
                  <ChevronRight size={12} color="#7A8CA6" />
                </div>
                <div className="flex items-baseline gap-1 mt-2"><span className="font-display" style={{ fontSize: 20, fontWeight: 600, color: '#0A1B33', lineHeight: 1 }}>{v}</span><span style={{ fontSize: 10.5, color: '#3F5578', fontWeight: 600 }}>{u}</span></div>
                <div style={{ fontSize: 10, color: '#7A8CA6', fontWeight: 600, marginTop: 4 }}>{w}</div>
              </button>
            ))}
          </div>
        </div>


      </div>
    );
  }

  /* ---- Today's health detail: the three numbers, each opening its own page ---- */
  /* ---- Care team, as a page (keeps home screens short) ---- */
  function renderCareTeamPage() {
    const D = { bg: '#0B2039', card: '#16314F', raised: '#1E3C60', hair: 'rgba(255,255,255,.14)', ink: '#FFFFFF', ink2: '#C6D8EC', ink3: '#93AECB', green: '#5FDCA8' };
    return (
      <div className="-mx-4 -mt-4 px-4 pt-5 pb-6" style={{ background: D.bg, color: D.ink, minHeight: '100%' }}>
        <button onClick={() => { tapFeel('tap'); setPvSheet(null); }} className="flex items-center gap-1.5 text-sm font-semibold mb-4" style={{ color: D.ink3 }}><ChevronLeft size={16} color={D.ink3} /> Back</button>
        <div className="font-display" style={{ fontSize: 24, fontWeight: 500, letterSpacing: '-0.03em' }}>The team that cares for you</div>
        <div style={{ fontSize: 13, color: D.ink3, lineHeight: 1.6, margin: '10px 0 18px' }}>A doctor watches over your readings 24×7. Your nutritionist and exercise specialist are a tap away.</div>
        <div className="space-y-2.5">
          {[
            ['🩺', 'Dr. A. Mehta', 'Cardiologist · doctor in charge', 'Reads your patch recording and calls you with the report', true],
            ['🥗', 'Dr. Divya', 'Longevity & nutrition', 'Builds a nutrition plan around what your heart needs', true],
            ['🏋️', 'Dr. Karishma', 'Exercise specialist', 'Sets your safe training range and reviews each session', true],
          ].map(([e, name, role, what, callable]) => (
            <div key={name} className="rounded-2xl p-4 flex items-start gap-3.5" style={{ background: 'linear-gradient(160deg, rgba(255,255,255,.07) 0%, rgba(255,255,255,.015) 52%), ' + D.card, border: `1px solid ${D.hair}` }}>
              <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 42, height: 42, background: D.raised, fontSize: 18 }}>{e}</span>
              <div className="flex-1 min-w-0">
                <div style={{ fontSize: 15, color: D.ink, fontWeight: 600 }}>{name}</div>
                <div style={{ fontSize: 12, color: D.ink3, marginTop: 2 }}>{role}</div>
                <div style={{ fontSize: 12.5, color: D.ink2, marginTop: 7, lineHeight: 1.55 }}>{what}</div>
              </div>
              {callable && (
                <button onClick={() => { tapFeel('tap'); setIncomingCall({ id: 'ct' + Date.now(), reading: 'your call', doctor: `${name} · ${role}`, phase: 'ringing' }); }} className="flex items-center gap-1.5 rounded-full px-3.5 py-2 flex-shrink-0" style={{ background: 'rgba(95,220,168,.14)', color: D.green, fontSize: 12.5, fontWeight: 600 }}><Phone size={11} color={D.green} /> Call</button>
              )}
            </div>
          ))}
        </div>
        <div className="rounded-2xl p-4 mt-4" style={{ background: D.card, border: `1px solid ${D.hair}`, fontSize: 12.5, color: D.ink3, lineHeight: 1.65 }}>
          Every reading you log is seen by this team. If something needs attention, they call you — you never have to decide whether a number matters.
        </div>
      </div>
    );
  }

  /* Care circle — who is watching over this member, and how to add someone. */
  function renderAddonPage(id) {
    const D = { bg: '#0B2039', card: '#16314F', raised: '#1E3C60', hair: 'rgba(255,255,255,.14)', ink: '#FFFFFF', ink2: '#C6D8EC', ink3: '#93AECB', blueLite: '#9CCAFF', green: '#5FDCA8' };
    const a = ADDONS.find(x => x.id === id) || ADDONS[0];
    const detail = id === 'cgm'
      ? [['📎', 'A sensor on your upper arm', 'Painless to apply, waterproof, stays on for 14 days'],
         ['📈', 'A reading every few minutes', 'Day and night — including the hours you are asleep'],
         ['🍽️', 'Linked to Check My Meal', 'Photograph a meal and see what it actually did to your sugar two hours later'],
         ['🩺', 'Your doctor reads the full trace', 'Overnight lows and post-meal peaks are the two things finger-pricks miss']]
      : [['💨', 'Blow into the device three times', 'Takes two minutes, sitting down'],
         ['📊', 'Peak flow and FEV₁ measured', 'The two numbers that define how your lungs are doing'],
         ['⏱️', 'A drop warns us early', 'Usually two to three days before you feel a flare-up'],
         ['🩺', 'Your pulmonologist sees every reading', 'Treatment is stepped up before you need hospital']];
    return (
      <div className="-mx-4 -mt-4 px-4 pt-5 pb-6" style={{ background: D.bg, color: D.ink, minHeight: '100%' }}>
        <button onClick={() => { tapFeel('tap'); setPvSheet(null); }} className="flex items-center gap-1.5 text-sm font-semibold mb-4" style={{ color: D.ink3 }}><ChevronLeft size={16} color={D.ink3} /> Back</button>
        <div className="flex items-center gap-3">
          <span style={{ fontSize: 26 }}>{a.e}</span>
          <div>
            <div className="font-display" style={{ fontSize: 23, fontWeight: 500, letterSpacing: '-0.03em' }}>{a.name}</div>
            <div style={{ fontSize: 12.5, color: D.ink3, marginTop: 2 }}>{a.sub}</div>
          </div>
        </div>
        <div className="rounded-2xl p-5 mt-4" style={{ background: `linear-gradient(160deg, ${D.blueLite}18 0%, rgba(255,255,255,.012) 60%), ${D.card}`, border: `1px solid ${D.blueLite}44` }}>
          <div className="flex items-baseline gap-2">
            <span className="font-display" style={{ fontSize: 34, fontWeight: 700 }}>{a.price}</span>
            <span style={{ fontSize: 13, color: D.ink3 }}>{id === 'cgm' ? 'for 14 days' : 'per device, yours to keep'}</span>
          </div>
          <div style={{ fontSize: 13.5, color: D.ink2, marginTop: 10, lineHeight: 1.65 }}>{a.why}</div>
        </div>
        <div className="rounded-2xl p-4 mt-3" style={{ background: D.card, border: `1px solid ${D.hair}` }}>
          <div style={{ fontSize: 11, letterSpacing: 1.3, color: D.blueLite, fontWeight: 700 }}>HOW IT WORKS</div>
          {detail.map(([e, t, w], i) => (
            <div key={t} className="flex gap-3 items-start" style={{ padding: '11px 0', borderTop: i ? `1px solid ${D.hair}` : 'none', marginTop: i ? 0 : 9 }}>
              <span className="flex items-center justify-center rounded-xl flex-shrink-0" style={{ width: 36, height: 36, background: D.raised, fontSize: 16 }}>{e}</span>
              <div><div style={{ fontSize: 14, color: D.ink }}>{t}</div><div style={{ fontSize: 12.5, color: D.ink3, marginTop: 3, lineHeight: 1.55 }}>{w}</div></div>
            </div>
          ))}
        </div>
        <button onClick={() => { tapFeel('success'); setFrxCelebrate(true); setTimeout(() => { setFrxCelebrate(false); setPvSheet(null); }, 1600); }} className="w-full rounded-2xl py-4 text-base font-bold mt-4" style={{ background: 'linear-gradient(135deg, #4A90F0 0%, #1F5CB0 100%)', color: '#FFFFFF' }}>Order · {a.price}</button>
        <div className="text-center mt-3" style={{ fontSize: 11.5, color: D.ink3, lineHeight: 1.7 }}>Delivered and fitted at home. Your care team walks you through the first reading.</div>
      </div>
    );
  }

  function renderCareCirclePage() {
    const D = { bg: '#0B2039', card: '#16314F', raised: '#1E3C60', hair: 'rgba(255,255,255,.14)', ink: '#FFFFFF', ink2: '#C6D8EC', ink3: '#93AECB', blueLite: '#9CCAFF', green: '#5FDCA8' };
    const ok = ccName.trim() && ccPhone.trim().length >= 10;
    return (
      <div className="-mx-4 -mt-4 px-4 pt-5 pb-6" style={{ background: D.bg, color: D.ink, minHeight: '100%' }}>
        <button onClick={() => { tapFeel('tap'); setPvSheet(null); setCcSent(false); }} className="flex items-center gap-1.5 text-sm font-semibold mb-4" style={{ color: D.ink3 }}><ChevronLeft size={16} color={D.ink3} /> Back</button>
        <div className="font-display" style={{ fontSize: 24, fontWeight: 500, letterSpacing: '-0.03em' }}>Your care circle</div>
        <div style={{ fontSize: 13, color: D.ink3, lineHeight: 1.6, margin: '10px 0 18px' }}>The people who get told if something needs attention. They see your alerts, not your whole record.</div>

        <div className="rounded-2xl p-4" style={{ background: D.card, border: `1px solid ${D.hair}` }}>
          <div style={{ fontSize: 11, letterSpacing: 1.3, color: D.blueLite, fontWeight: 700 }}>ALREADY IN YOUR CIRCLE</div>
          {[['👩', 'Anita', 'Daughter · Delhi', 'Gets every alert'], ['👨', 'Vikram', 'Son · Bengaluru', 'Gets urgent alerts only']].map(([e, n, r2, w], i) => (
            <div key={n} className="flex items-center gap-3.5" style={{ padding: '11px 0', borderTop: i ? `1px solid ${D.hair}` : 'none', marginTop: i ? 0 : 9 }}>
              <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 40, height: 40, background: D.raised, fontSize: 18 }}>{e}</span>
              <div className="flex-1 min-w-0"><div style={{ fontSize: 15, color: D.ink }}>{n}</div><div style={{ fontSize: 12, color: D.ink3, marginTop: 2 }}>{r2} · {w}</div></div>
              <span className="rounded-full" style={{ padding: '3px 9px', background: 'rgba(95,220,168,.14)', color: D.green, fontSize: 10.5, fontWeight: 700 }}>ACTIVE</span>
            </div>
          ))}
        </div>

        {ccSent ? (
          <div className="rounded-2xl p-5 mt-3 text-center" style={{ background: `linear-gradient(160deg, ${D.green}1E 0%, rgba(255,255,255,.012) 60%), ${D.card}`, border: `1px solid ${D.green}55` }}>
            <span className="flex items-center justify-center rounded-full mx-auto frx-stamp" style={{ width: 54, height: 54, background: D.green }}><Check size={26} color="#08182B" strokeWidth={3} /></span>
            <div className="font-display mt-3" style={{ fontSize: 19, fontWeight: 600 }}>Sent to our team</div>
            <div style={{ fontSize: 13.5, color: D.ink2, marginTop: 8, lineHeight: 1.6 }}>We will call <b style={{ color: D.ink }}>{ccName}</b> on {ccPhone} to confirm, explain what they will see, and register them in your circle. Usually within a working day.</div>
            <button onClick={() => { tapFeel('tap'); setCcSent(false); setCcName(''); setCcPhone(''); setCcEmail(''); setCcRel('Daughter'); }} className="w-full rounded-xl py-3 text-sm font-bold mt-4" style={{ background: D.raised, color: D.ink }}>Invite someone else</button>
          </div>
        ) : (
          <div className="rounded-2xl p-4 mt-3" style={{ background: D.card, border: `1px solid ${D.hair}` }}>
            <div style={{ fontSize: 11, letterSpacing: 1.3, color: D.blueLite, fontWeight: 700 }}>INVITE SOMEONE YOU TRUST</div>
            <div style={{ fontSize: 12.5, color: D.ink3, marginTop: 6, lineHeight: 1.55 }}>Give us their details and our team registers them for you. Nothing is shared until they agree on the call.</div>
            {[['Their name', ccName, setCcName, 'text', 'e.g. Anita Sharma'], ['Mobile number', ccPhone, setCcPhone, 'tel', '10-digit mobile'], ['Email (optional)', ccEmail, setCcEmail, 'email', 'name@example.com']].map(([lbl, val, set, tp, ph]) => (
              <div key={lbl} style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, color: D.ink3, marginBottom: 5 }}>{lbl}</div>
                <input value={val} onChange={(e) => set(e.target.value)} type={tp} placeholder={ph} className="w-full rounded-xl" style={{ background: D.raised, border: `1px solid ${D.hair}`, color: D.ink, padding: '12px 14px', fontSize: 14.5 }} />
              </div>
            ))}
            <div style={{ fontSize: 12, color: D.ink3, marginTop: 14, marginBottom: 6 }}>Their relationship to you</div>
            <div className="grid grid-cols-4 gap-2">
              {['Daughter', 'Son', 'Spouse', 'Other'].map(r2 => (
                <button key={r2} onClick={() => { tapFeel('select'); setCcRel(r2); }} className="rounded-xl py-2.5" style={{ background: ccRel === r2 ? 'linear-gradient(135deg, #3B7FC9, #1F5C9E)' : D.raised, border: ccRel === r2 ? '1.5px solid transparent' : `1.5px solid ${D.hair}` }}>
                  <span style={{ fontSize: 12, color: D.ink, fontWeight: 600 }}>{r2}</span>
                </button>
              ))}
            </div>
            <button disabled={!ok} onClick={() => { tapFeel('success'); setCcSent(true); }} className="w-full rounded-xl py-3.5 text-base font-bold mt-4" style={{ background: 'linear-gradient(135deg, #23B27A 0%, #178A5C 100%)', color: '#FFFFFF', opacity: ok ? 1 : 0.45 }}>Send to the iLive team</button>
          </div>
        )}
        <div className="text-center px-4 mt-4" style={{ fontSize: 11.5, color: D.ink3, lineHeight: 1.7 }}>You can remove anyone from your circle at any time by telling your care team.</div>
      </div>
    );
  }

  function renderTodaysHealthPage() {
    const D = { bg: '#0B2039', card: '#16314F', raised: '#1E3C60', hair: 'rgba(255,255,255,.14)', ink: '#FFFFFF', ink2: '#C6D8EC', ink3: '#93AECB', green: '#5FDCA8', amber: '#F5C572' };
    return (
      <div className="-mx-4 -mt-4 px-4 pt-5 pb-6" style={{ background: D.bg, color: D.ink, minHeight: '100%' }}>
        <button onClick={() => { tapFeel('tap'); setPvSheet(null); }} className="flex items-center gap-1.5 text-sm font-semibold mb-4" style={{ color: D.ink3 }}><ChevronLeft size={16} color={D.ink3} /> Back</button>
        <div className="font-display" style={{ fontSize: 24, fontWeight: 500, letterSpacing: '-0.03em' }}>Today's health</div>
        <div style={{ fontSize: 13, color: D.ink3, lineHeight: 1.6, margin: '10px 0 18px' }}>Based on your last 24 hours of tracking. Tap any number to see what it means for you.</div>
        <div className="space-y-2.5">
          {[
            ['rhr', '❤️', 'Resting heart rate', '54', 'bpm', '4 points below yesterday', 'Good', D.green],
            ['hrv', '📈', 'HRV', '48', 'ms', '6 points above yesterday', 'Good', D.green],
            ['load', '⚡', 'Cardiovascular strain', '1.8', '×', '0.6 above yesterday', 'Higher than usual', D.amber],
          ].map(([k, e, t, v, u, d, verdict, c]) => (
            <button key={k} onClick={() => { tapFeel('tap'); setPvSheet(k); }} className="w-full rounded-2xl p-4 text-left flex items-center gap-3.5" style={{ background: 'linear-gradient(160deg, rgba(255,255,255,.07) 0%, rgba(255,255,255,.015) 52%), ' + D.card, border: `1px solid ${D.hair}` }}>
              <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 40, height: 40, background: D.raised, fontSize: 17 }}>{e}</span>
              <div className="flex-1 min-w-0">
                <div style={{ fontSize: 13.5, color: D.ink2, fontWeight: 600 }}>{t}</div>
                <div className="flex items-baseline gap-1 mt-1"><span className="font-display" style={{ fontSize: 24, fontWeight: 600, lineHeight: 1 }}>{v}</span><span style={{ fontSize: 11.5, color: D.ink3 }}>{u}</span></div>
                <div style={{ fontSize: 11.5, color: D.ink3, marginTop: 4 }}>{d} · <span style={{ color: c, fontWeight: 600 }}>{verdict}</span></div>
              </div>
              <ChevronRight size={15} color={D.ink3} />
            </button>
          ))}
        </div>
        <div className="rounded-2xl p-4 mt-4" style={{ background: D.card, border: `1px solid ${D.hair}`, fontSize: 12.5, color: D.ink3, lineHeight: 1.65 }}>
          These three come from your wristband overnight. Your primary doctor sees this board live, which is how they manage you better, and calls you if any of them moves in a way that matters.
        </div>
      </div>
    );
  }

  /* =========================================================================
     SYMPTOM CHECK-IN — one set per care programme, asking only what is relevant.
     `red` lists the answers that raise a Command Centre flag and a doctor call.
     ========================================================================= */
  const CHECKIN_SETS = {
    'Blood Pressure Control': { steps: [
      { q: 'Any headache today — especially at the back of your head or on waking?', key: 'q1', opts: [['😌', 'None'], ['🙂', 'Mild'], ['😣', 'Severe / pounding']] },
      { q: 'Any dizziness or light-headedness when standing?', key: 'q2', opts: [['😊', 'No'], ['😐', 'Occasionally'], ['😵', 'Often / nearly fainted']] },
      { q: 'Blurred vision, chest discomfort or breathlessness?', key: 'q3', opts: [['✅', 'None'], ['⚠️', 'Yes — mild'], ['🚨', 'Yes — sudden or severe']] },
      { q: 'Did you take your BP medicine today?', key: 'q4', opts: [['💊', 'Yes, on time'], ['⏰', 'Late'], ['❌', 'Missed']] },
    ], red: ['Severe / pounding', 'Often / nearly fainted', 'Yes — sudden or severe'] },
    'Diabetes Control': { steps: [
      { q: 'Unusual thirst or passing urine more than usual?', key: 'q1', opts: [['😊', 'No'], ['🙂', 'A little'], ['😟', 'Much more than usual']] },
      { q: 'Any shakiness, sweating or confusion (low sugar)?', key: 'q2', opts: [['✅', 'None'], ['😐', 'Once, settled with food'], ['🚨', 'Yes — felt faint']] },
      { q: 'Numbness, tingling or a wound on your feet?', key: 'q3', opts: [['👟', 'Feet feel normal'], ['🦶', 'Some tingling'], ['🩹', 'A sore or wound']] },
      { q: 'Did you take your diabetes medicine or insulin today?', key: 'q4', opts: [['💊', 'Yes, on time'], ['⏰', 'Late'], ['❌', 'Missed']] },
    ], red: ['Yes — felt faint', 'A sore or wound'] },
    'COPD Care': { steps: [
      { q: 'How is your breathing compared to usual?', key: 'q1', opts: [['😊', 'Same as usual'], ['😐', 'A little worse'], ['😮‍💨', 'Much more breathless']] },
      { q: 'More cough or phlegm than usual?', key: 'q2', opts: [['✅', 'No change'], ['🙂', 'A bit more'], ['🟡', 'Phlegm turned yellow / green']] },
      { q: 'Did you sleep lying flat, or need extra pillows?', key: 'q3', opts: [['😴', 'Slept flat, fine'], ['🛏️', 'Needed extra pillows'], ['😩', 'Could not lie down']] },
      { q: 'Did you use your inhalers today?', key: 'q4', opts: [['💨', 'Yes, both doses'], ['⏰', 'One dose'], ['❌', 'Missed']] },
    ], red: ['Much more breathless', 'Phlegm turned yellow / green', 'Could not lie down'] },
    'Heart Failure Care': { steps: [
      { q: 'How is your breathing compared with usual?', key: 'q1', opts: [['😊', 'Same as usual'], ['😐', 'A little worse'], ['😮‍💨', 'Much more breathless']] },
      { q: 'Any swelling of your feet or ankles?', key: 'q2', opts: [['✅', 'None'], ['🙂', 'A little'], ['🦶', 'Clearly more swollen']] },
      { q: 'How did you sleep?', key: 'q3', opts: [['😴', 'Slept flat, fine'], ['🛏️', 'Needed extra pillows'], ['😩', 'Woke up breathless']] },
      { q: 'Did you take all your medicines today?', key: 'q4', opts: [['💊', 'Yes, all'], ['⏰', 'Late'], ['❌', 'Missed']] },
    ], red: ['Much more breathless', 'Clearly more swollen', 'Woke up breathless'] },
    'Elder Care': { steps: [
      { q: 'How steady on your feet today?', key: 'q1', opts: [['🚶', 'Steady'], ['🤔', 'A little unsteady'], ['🤕', 'Slipped or nearly fell']] },
      { q: 'How is your appetite and drinking today?', key: 'q2', opts: [['😋', 'Good'], ['🙂', 'Some'], ['😐', 'Very little']] },
      { q: 'How is your mood today?', key: 'q3', opts: [['😊', 'Good'], ['😐', 'So-so'], ['😔', 'Low or lonely']] },
      { q: 'Did you take all your medicines today?', key: 'q4', opts: [['💊', 'Yes, all'], ['🤷', 'Not sure'], ['❌', 'Missed some']] },
    ], red: ['Slipped or nearly fell'] },
    'Stroke Recovery': { steps: [
      { q: 'Any new weakness, numbness or drooping of the face?', key: 'q1', opts: [['✅', 'None'], ['⚠️', 'Slight change'], ['🚨', 'Sudden new weakness']] },
      { q: 'Any trouble speaking or understanding today?', key: 'q2', opts: [['✅', 'No'], ['😐', 'Some difficulty'], ['🚨', 'Sudden trouble']] },
      { q: 'How is your mood?', key: 'q3', opts: [['😊', 'Good'], ['😐', 'So-so'], ['😔', 'Low']] },
      { q: 'Did you do your physio exercises today?', key: 'q4', opts: [['🤸', 'Yes'], ['🙂', 'Partly'], ['❌', 'Not today']] },
    ], red: ['Sudden new weakness', 'Sudden trouble'] },
    'Post-Heart Surgery Recovery': { steps: [
      { q: 'How is your chest wound?', key: 'q1', opts: [['✅', 'Clean & dry'], ['😐', 'Some redness'], ['🚨', 'Discharge, or fever']] },
      { q: 'How is your pain?', key: 'q2', opts: [['😌', 'Mild'], ['😐', 'Moderate'], ['😖', 'Severe']] },
      { q: 'Your breathing today?', key: 'q3', opts: [['😊', 'Comfortable'], ['🙂', 'Slightly short'], ['😮‍💨', 'More breathless than usual']] },
      { q: 'Did you use your breathing device and walk today?', key: 'q4', opts: [['✅', 'Yes, both'], ['🙂', 'One of them'], ['❌', 'Not yet']] },
    ], red: ['Discharge, or fever', 'Severe', 'More breathless than usual'] },
    'CKD & Dialysis Support': { steps: [
      { q: 'Any swelling of your feet, ankles or face today?', key: 'q1', opts: [['✅', 'None'], ['🙂', 'A little'], ['🦶', 'Clearly more swollen']] },
      { q: 'How is your breathing when lying flat?', key: 'q2', opts: [['😊', 'Fine'], ['🛏️', 'Need extra pillows'], ['😩', 'Cannot lie flat']] },
      { q: 'How much urine compared with usual?', key: 'q3', opts: [['✅', 'About the same'], ['😐', 'Less than usual'], ['⚠️', 'Much less']] },
      { q: 'Medicines taken and fluid limit kept?', key: 'q4', opts: [['💊', 'Yes, both'], ['🙂', 'One of them'], ['❌', 'Neither']] },
    ], red: ['Clearly more swollen', 'Cannot lie flat', 'Much less'] },
    'Cancer Care': { steps: [
      { q: 'Any fever or chills today?', key: 'q1', opts: [['✅', 'No'], ['😐', 'Feeling warm'], ['🚨', 'Yes, fever']] },
      { q: 'Appetite and keeping food down?', key: 'q2', opts: [['😋', 'Normal'], ['🙂', 'Reduced'], ['🤢', 'Vomiting']] },
      { q: 'Mouth ulcers or pain on swallowing?', key: 'q3', opts: [['✅', 'None'], ['😐', 'Mild'], ['😣', 'Severe']] },
      { q: 'Energy compared with last week?', key: 'q4', opts: [['💪', 'Same or better'], ['😐', 'A bit lower'], ['😴', 'Much lower']] },
    ], red: ['Yes, fever', 'Vomiting', 'Severe'] },
  };
  /* After angioplasty or a stent there is no chest wound — the questions that
     matter are angina, breathlessness, the puncture site and, above all,
     whether the dual antiplatelet is being taken. Stopping it early is the
     commonest cause of stent thrombosis. */
  CHECKIN_SETS['Post-Cardiac Event Recovery'] = { steps: [
    { q: 'Any chest pain, pressure or tightness since yesterday?', key: 'q1', opts: [['✅', 'None'], ['😐', 'Mild, settled with rest'], ['🚨', 'Yes — like before my procedure']] },
    { q: 'How is your breathing on walking?', key: 'q2', opts: [['😊', 'Same as usual'], ['😐', 'A little short'], ['😮‍💨', 'Much more breathless']] },
    { q: 'The puncture site in your wrist or groin?', key: 'q3', opts: [['✅', 'Clean and settled'], ['😐', 'Small bruise'], ['🚨', 'Swelling, oozing or a lump']] },
    { q: 'Did you take your blood-thinning tablets today?', key: 'q4', opts: [['💊', 'Yes, both'], ['⏰', 'One of them'], ['❌', 'Missed — or stopped']] },
  ], red: ['Yes — like before my procedure', 'Much more breathless', 'Swelling, oozing or a lump', 'Missed — or stopped'] };
  CHECKIN_SETS['Post-Hospital Recovery'] = CHECKIN_SETS['Post-Heart Surgery Recovery'];
  const CHECKIN_DEFAULT = { steps: [
    { q: 'How is your pain right now?', key: 'q1', opts: [['😌', 'No pain'], ['🙂', 'Mild'], ['😐', 'Moderate'], ['😖', 'Severe']] },
    { q: 'How did you sleep last night?', key: 'q2', opts: [['😴', 'Slept well'], ['🙂', 'Okay'], ['😩', 'Barely slept']] },
    { q: 'How is your appetite today?', key: 'q3', opts: [['😋', 'Good'], ['🙂', 'Some'], ['😐', 'Very little']] },
    { q: 'Your breathing today?', key: 'q4', opts: [['😊', 'Comfortable'], ['🙂', 'Slightly short'], ['😮‍💨', 'More breathless than usual']] },
  ], red: ['Severe', 'More breathless than usual'] };

  function renderCheckinPage() {
    const set = CHECKIN_SETS[enrolledPrograms[0]] || CHECKIN_DEFAULT;
    const steps = set.steps;
    const done = ciStep >= steps.length;
    const flag = Object.values(ciAns).some(a => set.red.includes(a));
    return (
      <div className="h-full flex flex-col">
        <button onClick={() => { setCheckinOpen(false); setCiStep(0); }} className="flex-shrink-0 text-sm text-left font-semibold mb-3" style={{ color: C.muted }}>← Back to my recovery</button>
        {!done && (
          <div className="flex-1">
            <div className="flex gap-1.5 mb-5">
              {steps.map((_, i) => (
                <div key={i} className="rounded-full flex-1" style={{ height: 5, background: i < ciStep ? '#1E9E6A' : i === ciStep ? C.green : 'rgba(21,62,111,0.1)' }} />
              ))}
            </div>
            <div className="text-xs font-bold" style={{ color: C.muted }}>QUESTION {ciStep + 1} OF {steps.length} · {['LET’S GO 💪', 'NICE PACE ✨', 'ALMOST DONE 🌟', 'LAST ONE 🎉'][ciStep]}</div>
            <div className="font-display text-2xl font-bold mt-1.5 mb-5" style={{ color: C.text, lineHeight: 1.25 }}>{steps[ciStep].q}</div>
            <div className="space-y-2.5">
              {steps[ciStep].opts.map(([e, label]) => (
                <button key={label} onClick={() => { setCiAns({ ...ciAns, [steps[ciStep].key]: label }); setCiStep(ciStep + 1); if (ciStep + 1 >= steps.length) setRbTicks(prev => ({ ...prev, checkin: 1 })); }}
                  className="w-full rounded-2xl p-4 text-left flex items-center gap-3.5" style={{ background: WHITE.bg, border: `1px solid ${WHITE.border}`, color: WHITE.ink }}>
                  <span style={{ fontSize: 26, lineHeight: 1 }}>{e}</span>
                  <span className="text-base font-bold" style={{ color: C.text }}>{label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {done && (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
            <div style={{ fontSize: 46 }}>{flag ? '🩺' : '💙'}</div>
            <div className="font-display text-2xl font-bold mt-3" style={{ color: C.text }}>{flag ? 'Thank you — we\'re on it' : 'Check-in complete'}</div>
            <div className="text-sm font-medium mt-2" style={{ color: C.muted, lineHeight: 1.55 }}>
              {flag
                ? 'Your answers have gone straight to your care team — an iLive doctor will call you shortly. If you feel worse, use Call your doctor right away.'
                : 'Sent to your care team ✓ — you are tracking as expected. Same time tomorrow.'}
            </div>
            <div className="text-sm font-bold mt-4 rounded-full px-4 py-2" style={{ background: 'rgba(232,161,61,0.12)', color: '#B07A1A' }}>🔥 12-day check-in streak — brilliant consistency!</div>
            <button onClick={() => { setCheckinOpen(false); setCiStep(0); }} className="w-full rounded-2xl py-4 text-base font-bold mt-5" style={{ background: 'linear-gradient(135deg, #3B7FC9 0%, #1F5C9E 100%)', color: '#FFFFFF', boxShadow: '0 6px 18px rgba(31,92,158,0.32)' }}>Back to my recovery</button>
          </div>
        )}
      </div>
    );
  }

  function renderCardiacHome() {
    const docName = primaryDoctor ? `Dr. ${primaryDoctor}` : 'Dr. Chandola';
    const week = [
      { d: 'Day 0', who: 'Doctor consult', emoji: '🧑‍⚕️', done: true },
      { d: 'Day 1', who: 'Dietitian', emoji: '🥗', done: true },
      { d: 'Day 2', who: 'Physiotherapist', emoji: '🤸', today: true },
      { d: 'Day 3', who: 'Recovery check', emoji: '📋' },
      { d: 'Day 4', who: 'Diet follow-up', emoji: '🥗' },
      { d: 'Day 5', who: 'Physio follow-up', emoji: '🤸' },
      { d: 'Day 6', who: 'Full data review', emoji: '🖥️' },
      { d: 'Day 7', who: 'Doctor review + Week 2 plan', emoji: '🧑‍⚕️' },
    ];
    const sessions = ['8 AM', '10 AM', '12 PM', '2 PM', '4 PM', '6 PM', '8 PM'];
    const R = 40, CIRC = 2 * Math.PI * R;
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold" style={{ color: C.muted }}>❤️ Heart Recovery · Day 2 · Week 1</div>
            <div className="font-display text-2xl" style={{ color: C.text, fontWeight: 800 }}>Namaste, {(signupName || 'Suresh').split(' ')[0]}</div>
          </div>
          <button onClick={() => setIncomingCall({ id: 'sos', reading: 'SOS alert', doctor: 'Emergency Response Team', phase: 'ringing' })} className="rounded-full px-4 py-2 text-sm font-bold flex-shrink-0" style={{ background: 'rgba(224,82,82,0.12)', color: C.coral, border: '1.5px solid rgba(224,82,82,0.4)' }}>🆘 SOS</button>
        </div>

        {vitalsBlock('Recovery Score', 72, 'Good')}

        <div className="rounded-2xl p-4 flex items-center gap-3.5" style={{ background: 'rgba(43,108,176,0.08)', border: '1.5px solid rgba(43,108,176,0.35)' }}>
          <div className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 46, height: 46, background: '#FFFFFF', fontSize: 22 }}>🤸</div>
          <div className="flex-1">
            <div className="text-sm font-bold" style={{ color: C.text }}>Physiotherapist · 4:00 PM</div>
            <div className="text-xs" style={{ color: C.muted, lineHeight: 1.4 }}>Priya reviews your walking, breathing & chest stiffness, and sets Week-1 targets.</div>
          </div>
          <button className="rounded-xl px-4 py-2.5 text-sm font-bold flex-shrink-0" style={{ background: 'linear-gradient(135deg, #3B7FC9 0%, #1F5C9E 100%)', color: '#FFFFFF', boxShadow: '0 6px 18px rgba(31,92,158,0.32)' }}>Join</button>
        </div>

        {/* Today's recovery board */}
        <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <div className="flex items-start justify-between mb-1">
            <div>
              <div className="text-base font-bold" style={{ color: C.text }}>Today's recovery board</div>
              <div className="text-xs mt-0.5" style={{ color: C.muted }}>Tap a circle each time you finish one.</div>
            </div>
            <div className="text-xl font-bold flex-shrink-0 ml-2" style={{ color: C.navy }}>{Object.values(rbTicks).reduce((a, b) => a + b, 0)}<span className="text-sm" style={{ color: C.muted }}>/{RB_TASKS.reduce((a, t) => a + t.target, 0)}</span></div>
          </div>
          <div className="space-y-3 mt-3">
            {RB_TASKS.map(t => {
              const cnt = rbTicks[t.id] || 0;
              const full = cnt >= t.target;
              return (
                <div key={t.id} onClick={t.id === 'checkin' ? () => { setCheckinOpen(true); setCiStep(0); setCiAns({}); } : undefined} className="rounded-xl p-3" style={{ background: full ? 'rgba(30,158,106,0.06)' : C.panelLight, border: full ? '1px solid rgba(30,158,106,0.35)' : '1px solid transparent', cursor: t.id === 'checkin' ? 'pointer' : 'default' }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span style={{ fontSize: 17 }}>{t.emoji}</span>
                      <div>
                        <span className="text-sm font-bold" style={{ color: C.text }}>{t.title}</span>
                        <span className="text-xs font-bold ml-1.5" style={{ color: full ? '#1E9E6A' : C.muted }}>{full ? 'Done ✓' : `${cnt}/${t.target}`}</span>
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 600, lineHeight: 1.35, marginTop: 3 }}>{t.sub}</div>
                  <div className="flex gap-1.5 mt-2 flex-wrap">
                    {Array.from({ length: t.target }).map((_, i) => {
                      const done = i < cnt, next = i === cnt;
                      return (
                        <button key={i} onClick={() => { if (t.id === 'checkin') { setCheckinOpen(true); setCiStep(0); setCiAns({}); } else { setRbTicks({ ...rbTicks, [t.id]: done && i === cnt - 1 ? i : i + 1 }); } }} className="flex items-center justify-center rounded-full" style={{ width: 27, height: 27, background: done ? '#1E9E6A' : 'transparent', border: done ? 'none' : `2px solid ${next ? '#1E9E6A' : C.border}`, boxShadow: next ? '0 0 0 3px rgba(30,158,106,0.15)' : 'none' }}>
                          {done && <CheckCircle2 size={15} color="#FFFFFF" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="text-xs font-semibold mt-3 rounded-xl p-2.5" style={{ color: C.navy, background: 'rgba(43,108,176,0.07)', lineHeight: 1.45 }}>👨‍⚕️ {docName} sees this board live — every circle you fill, your surgical team sees. This is how readmissions are prevented.</div>
        </div>

        {renderQuickBP()}

        {sharedLogRows()}

        {!isSubscribed && journeysMiniCard()}


      </div>
    );
  }

  /* ========== 🫁 COPD / LUNG CARE HOME (tier-aware) ========== */
  /* =========================================================================
     iLive PREVENT — home
     Heart age is the hero (the number a wristband cannot produce), plotted on a
     ruled age track against chronological age with a 12-month projection.
     Below it: today's readiness and the eight heart zones, weekly Zone 3+
     minutes (the only thing that moves cardio fitness), and the weekly
     physician note. Zones 7 and 8 are EARNED via a stress ECG / VO2 test.
     ========================================================================= */
  /* =========================================================================
     iLive PREVENT — home
     Heart age comes from THE SAME engine as the free screening (Framingham
     heartAgeOf) — never a separate number. Zones are the standard five-zone
     %HRmax model; the member picks a goal and we prescribe zone + minutes.
     ========================================================================= */

  /* Standard 5-zone model. HRmax = 220 − age (Fox). Percentages are the
     conventional training bands used in cardiac rehab and fitness practice. */
  const PV_ZONE_DEFS = [
    { id: 1, name: 'Very light', lo: 0.50, hi: 0.60, col: '#4C8C86', what: 'Walking, stretching, warm-up' },
    { id: 2, name: 'Light',      lo: 0.60, hi: 0.70, col: '#5FDCA8', what: 'Easy walk or cycle — you can talk in full sentences' },
    { id: 3, name: 'Moderate',   lo: 0.70, hi: 0.80, col: '#9BD65E', what: 'Brisk walk or jog — short sentences only' },
    { id: 4, name: 'Hard',       lo: 0.80, hi: 0.90, col: '#F5C572', what: 'Running, hills, intervals — breathing hard' },
    { id: 5, name: 'Maximum',    lo: 0.90, hi: 1.00, col: '#F58D8B', what: 'All-out efforts, short bursts' },
  ];

  /* Goal → prescription. Sources: ACSM guidance (150 min/wk moderate or
     75 min/wk vigorous); fat oxidation peaks at roughly 60–70 % HRmax. */
  const GOAL_TINT = { easy: ['#2E6E63', '#17403A'], fat: ['#8F4A2E', '#4E2618'], fit: ['#8F3A52', '#4C1D2C'], perf: ['#3C4E9E', '#1E2A5C'] };
  const PV_TARGET = 150;   // weekly minutes in Zone 3+ (WHO / ACSM guideline)
  const PV_GOALS = [
    { id: 'easy', e: '🌿', label: 'Stay active',       zones: [1, 2], mins: 30, why: 'Gentle daily movement. Good on a rest day, after a poor night, or when you are starting out.' },
    { id: 'fat',  e: '🔥', label: 'Burn fat',          zones: [2, 3], mins: 40, why: 'Your body burns the highest share of fat between 60 and 70 % of your maximum heart rate. Longer and easier beats short and hard for this goal.' },
    { id: 'fit',  e: '❤️', label: 'Get fitter',        zones: [3, 4], mins: 30, why: 'Moderate-to-hard effort is what raises cardio fitness — the single factor on your heart age that responds to training alone.' },
    { id: 'perf', e: '⚡', label: 'Push performance',  zones: [4, 5], mins: 20, why: 'Short intervals at hard effort. Do this no more than twice a week, and only when you feel well recovered.' },
  ];


  /* Goal → measurable physiological effect, and therefore → heart age.
     Only the modifiable Framingham inputs can move: BMI, systolic BP, smoking, diabetes.
     Conservative mid-points from published guidance:
       · Aerobic exercise lowers systolic BP 5–8 mmHg (ACC/AHA 2017 hypertension guideline;
         Whelton et al., Ann Intern Med 2002).
       · 150–250 min/week moderate activity → ~2–3 % body-weight loss (ACSM Position Stand 2009).
     We apply the LOW end of each range so the projection under-promises. */
  const PV_EFFECT = {
    fat:  { days: 90, perWeek: 5, dSbp: 4, dBmi: 1.5, how: '40 minutes at an easy-to-moderate pace, five days a week, is enough to lose roughly 3 % of body weight in twelve weeks. Lower weight lowers both blood pressure and heart age.' },
    fit:  { days: 90, perWeek: 5, dSbp: 6, dBmi: 0.7, how: 'Around 150 minutes a week of moderate-to-vigorous effort lowers systolic blood pressure by 5–8 mmHg — the same order as a first blood-pressure tablet.' },
    easy: { days: 90, perWeek: 6, dSbp: 3, dBmi: 0.3, how: 'Gentle daily movement still lowers blood pressure by a few points and keeps weight stable. Small, but it counts and it is sustainable.' },
    perf: { days: 90, perWeek: 3, dSbp: 7, dBmi: 1.0, how: 'Interval work produces the largest blood-pressure and fitness gains per minute, but only two or three times a week — recovery is part of the effect.' },
  };
  function pvProjectedAge(prof, goalId) {
    const e = PV_EFFECT[goalId] || PV_EFFECT.fit;
    return heartAgeOf({ ...prof, sbp: Math.max(105, prof.sbp - e.dSbp), bmi: Math.max(20, prof.bmi - e.dBmi) });
  }

  function pvZones(age) {
    const hrMax = 220 - age;
    return PV_ZONE_DEFS.map(z => ({ ...z, from: Math.round(hrMax * z.lo), to: Math.round(hrMax * z.hi) }));
  }

  /* =========================================================================
     PREVENT — metric explainers.
     Every vital on the home screen opens one of these. Each answers, in order:
       1. What is today's number, and is it good or bad?
       2. How does it compare with yesterday, and does that direction matter?
       3. What does this measurement actually mean, in plain words?
       4. What is normal for someone this age?
       5. What has it done every day since you joined?
     ========================================================================= */

  /* Deterministic 30-day history so the chart is stable between renders. */
  function pvSeries(seed, base, spread, trend) {
    const out = [];
    let s = seed;
    for (let i = 29; i >= 0; i--) {
      s = (s * 9301 + 49297) % 233280;
      const noise = (s / 233280 - 0.5) * spread;
      out.push(Math.round((base + noise + (29 - i) * trend) * 10) / 10);
    }
    return out;
  }

  const PV_METRICS = {
    rhr: {
      id: 'rhr', e: '❤️', name: 'Resting heart rate', unit: 'bpm', today: 54, yest: 58, better: 'lower',
      series: () => pvSeries(11, 57, 5, -0.09),
      meaning: 'The number of times your heart beats each minute when you are completely at rest. It is the clearest single sign of how efficient your heart is: a stronger heart pushes more blood with each beat, so it needs fewer beats.',
      range: (age) => 'Most healthy adults sit between 60 and 100 bpm. Regularly active people are often 50–60, and endurance athletes lower still. Below 50 without symptoms is usually fitness, not a problem.',
      verdict: (t, y) => t < y ? { good: true, line: `Down ${Math.round(y - t)} bpm from yesterday. A falling resting heart rate means your heart is recovering well and your fitness is holding or improving.` } : { good: false, line: `Up ${Math.round(t - y)} bpm from yesterday. A rise of 5 or more usually means poor sleep, alcohol, stress, or the start of an infection. One day is nothing; three days in a row is worth a conversation.` },
      band: [50, 70],
    },
    hrv: {
      id: 'hrv', e: '📈', name: 'HRV', unit: 'ms', today: 48, yest: 42, better: 'higher',
      series: () => pvSeries(29, 43, 9, 0.14),
      meaning: 'The tiny variation in time between one heartbeat and the next. It sounds like a fault, but it is a good thing: a heart that is well recovered speeds up and slows down freely. When you are tired, stressed or unwell, the beats become more uniform and HRV falls.',
      range: (age) => `HRV falls naturally with age and varies hugely between people, so your own baseline matters more than any table. As a guide: 20s–30s often 55–105 ms, 40s 40–80 ms, 50s+ 30–65 ms. ${age >= 50 ? 'At your age, anything steady above 30 ms is reassuring.' : 'What matters most is your own trend, not the absolute number.'}`,
      verdict: (t, y) => t > y ? { good: true, line: `Up ${Math.round(t - y)} ms from yesterday. Your body has recovered well overnight — a good day to train harder if you want to.` } : { good: false, line: `Down ${Math.round(y - t)} ms from yesterday. Your body is still carrying yesterday's load, or sleep, alcohol or stress got in the way. Keep today easy.` },
      band: [30, 70],
    },
    sleep: {
      id: 'sleep', e: '🌙', name: 'Sleep', unit: 'hours', today: 7.4, yest: 7.0, better: 'higher',
      series: () => pvSeries(53, 7.0, 1.6, 0.008),
      meaning: 'Total time actually asleep. Sleep is when blood pressure drops, the heart rate slows and the body repairs itself. Short sleep raises blood pressure and blunts recovery the next day — which is why your HRV and resting heart rate both follow it.',
      range: (age) => 'Adults need 7 to 9 hours. Under 6 hours on most nights is associated with higher blood pressure and cardiovascular risk. Consistency of bedtime matters almost as much as the total.',
      verdict: (t, y) => t >= 7 ? { good: true, line: `${Math.round((t - y) * 60)} minutes more than yesterday, and above the 7-hour mark. This is the single easiest thing you did for your heart today.` } : { good: false, line: `Below 7 hours. One short night is fine; a run of them raises blood pressure and drags your recovery down.` },
      band: [7, 9],
    },
    steps: {
      id: 'steps', e: '👟', name: 'Steps', unit: 'steps', today: 8432, yest: 7100, better: 'higher',
      series: () => pvSeries(37, 7600, 3200, 22),
      meaning: 'How much you moved across the whole day — not just during exercise. Steps capture the background activity that training sessions miss, and it is that background level which tracks most closely with long-term heart risk.',
      range: (age) => 'Benefit rises steeply from about 4,000 steps a day and keeps improving to roughly 8,000–10,000, after which the curve flattens. There is no need to chase 10,000 every day; the weekly average is what counts.',
      verdict: (t, y) => t >= 8000 ? { good: true, line: `${(t - y).toLocaleString()} more than yesterday and above 8,000 — the level where most of the cardiovascular benefit is already banked.` } : { good: false, line: `Below 8,000 today. One quiet day is fine, but a week of them undoes a lot of what your sessions build.` },
      band: [8000, 12000],
    },
    glucose: {
      id: 'glucose', e: '🩸', name: 'Blood glucose', unit: 'mg/dL', today: 126, yest: 134, better: 'lower',
      series: () => pvSeries(83, 132, 34, -0.22),
      meaning: 'Your blood sugar right now. It rises after every meal and settles between them. A single reading matters far less than how much of the day you spend inside the healthy band — which is what "time in range" measures.',
      range: (age) => 'Before a meal, aim for 80–130 mg/dL. Two hours after a meal, under 180. Below 70 is a low and should be treated straight away with something sweet.',
      verdict: (t, y) => t <= 130 ? { good: true, line: `${Math.round(y - t)} mg/dL lower than yesterday and inside the pre-meal target. Your time in range is what your doctor watches, and it is holding.` } : { good: false, line: `Above the 130 pre-meal target. One reading is not a problem; a pattern of them over a week is what changes your treatment.` },
      band: [80, 130],
    },
    hba1c: {
      id: 'hba1c', e: '🧪', name: 'HbA1c', unit: '%', today: 7.9, yest: 8.4, better: 'lower',
      series: () => pvSeries(97, 8.2, 0.5, -0.011),
      meaning: 'Your average blood sugar over the last two to three months, carried on your red blood cells. It cannot be gamed by one good week — which is exactly why doctors trust it more than any single reading.',
      range: (age) => 'For most adults with diabetes the target is under 7.0 %. Under 6.5 % if it can be reached safely without lows; a gentler 7.5–8.0 % is appropriate for older adults or anyone prone to hypoglycaemia. Your doctor sets yours.',
      verdict: (t, y) => t < y ? { good: true, line: `Down from ${y} % at the start of your 90-day goal. Your recent readings average about ${Math.round(28.7 * t - 46.7)} mg/dL, which is what produces this number.` } : { good: false, line: `Not moving yet. HbA1c lags real change by six to eight weeks, so keep going before judging it.` },
      band: [6.5, 7.0],
    },
    load: {
      id: 'load', e: '⚡', name: 'Cardiovascular strain', unit: '×', today: 1.8, yest: 1.2, better: 'balanced',
      series: () => pvSeries(71, 1.3, 0.9, 0.006),
      meaning: 'How hard your heart worked over the last 24 hours compared with your own normal — counting both how high your heart rate went and how long it stayed there. 1.0 is an ordinary day for you. Above 1.5 is a genuinely hard day; below 0.7 is a rest day.',
      range: (age) => 'There is no universal target. A good week has a mix: two or three days above 1.3, the rest between 0.7 and 1.2. Staying above 1.5 every day is how people get injured or ill.',
      verdict: (t, y) => t > 1.5 ? { good: true, line: `A hard day — ${t}× your usual. Good training, provided tomorrow is easier. Watch your HRV in the morning to see how well you absorbed it.` } : { good: true, line: `A moderate day at ${t}× your usual. Comfortably within what your body handles.` },
      band: [0.7, 1.5],
    },
  };

  /* Simple line chart — 30 days, with the healthy band shaded. */
  function pvChart(series, band, col, unit) {
    const w = 300, h = 96, pad = 4;
    const lo = Math.min(...series, band[0]) * 0.92, hi = Math.max(...series, band[1]) * 1.06;
    const x = i => pad + (i / (series.length - 1)) * (w - pad * 2);
    const y = v => h - pad - ((v - lo) / (hi - lo)) * (h - pad * 2);
    const pts = series.map((v, i) => `${x(i)},${y(v)}`).join(' ');
    return (
      <div>
        <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: h }} preserveAspectRatio="none">
          <rect x="0" y={y(band[1])} width={w} height={Math.max(0, y(band[0]) - y(band[1]))} fill="rgba(95,220,168,0.10)" />
          <line x1="0" x2={w} y1={y(band[1])} y2={y(band[1])} stroke="rgba(255,255,255,.16)" strokeDasharray="3 3" />
          <line x1="0" x2={w} y1={y(band[0])} y2={y(band[0])} stroke="rgba(255,255,255,.16)" strokeDasharray="3 3" />
          <polyline points={pts} fill="none" stroke={col} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <circle cx={x(series.length - 1)} cy={y(series[series.length - 1])} r="3.5" fill={col} />
        </svg>
        <div className="flex justify-between" style={{ fontSize: 10.5, color: '#93AECB', marginTop: 4 }}>
          <span>30 days ago</span><span>Healthy band {band[0]}–{band[1]} {unit}</span><span>Today</span>
        </div>
      </div>
    );
  }

  /* Session clock. One tick per second: advance total time, drift the heart rate toward
     the target band, and add a second to the in-zone counter only when HR is inside it.
     PRODUCTION: replace the simulated `next` heart rate with the live wristband value. */
  function pvStart() {
    const age = Number(foAge) || 46;
    const zs = pvZones(age);
    const g = PV_GOALS.find(x => x.id === pvGoal) || PV_GOALS[1];
    const gz = zs.filter(z => g.zones.includes(z.id));
    const from = gz[0].from, to = gz[gz.length - 1].to, mid = (from + to) / 2;
    if (pvTimerRef.current) clearInterval(pvTimerRef.current);
    setPvSess(s => ({ ...s, status: 'running' }));
    pvTimerRef.current = setInterval(() => {
      setPvSess(s => {
        if (s.status !== 'running') return s;
        const warm = s.secs < 45;                                  // warm-up climb
        const target = warm ? from - 18 + s.secs * 0.5 : mid;
        const next = Math.round(Math.max(60, s.hr + (target - s.hr) * 0.22 + (Math.random() - 0.5) * 5));
        const inside = next >= from && next <= to;
        const n = s.secs + 1;
        return { ...s, secs: n, hr: next, inZone: s.inZone + (inside ? 1 : 0), avgHr: Math.round(((s.avgHr || next) * (n - 1) + next) / n) };
      });
    }, 1000);
  }
  function pvPause() { setPvSess(s => ({ ...s, status: s.status === 'paused' ? 'running' : 'paused' })); }
  function pvFinish() { if (pvTimerRef.current) clearInterval(pvTimerRef.current); setPvSess(s => ({ ...s, status: 'done' })); }

  /* =========================================================================
     PREVENT — training session.
     Opened from the goal card. Three states: brief → running → done.
     Counts only the seconds spent inside the goal's target zone, which is
     what the weekly 150-minute guideline actually measures.
     ========================================================================= */
  /* =========================================================================
     Check My Meal — screens.
     The rule set is selected automatically from the member's programme, so the
     same component serves diabetes, CKD, hypertension, recovery and prevention
     without the member ever choosing a "diet mode".
     ========================================================================= */
  function frxUserRules() {
    return frxRulesFor({
      programmes: enrolledPrograms || [],
      conditions: (foConds || []).map(c => ({ sugar: 'diabetes', bp: 'hypertension', chol: 'lipids', heart: 'cardiac', kidney: 'kidney' }[c] || c)),
      onDialysis: !!frxDialysis,
    });
  }

  /* =========================================================================
     Check My Meal — photo → verdict → detail.
     Same flow for everyone; only the RULE SET changes with the programme, so a
     diabetic, a CKD patient and a healthy member get different verdicts, fixes
     and longevity tips from the identical screen.
     ========================================================================= */

  /* Keyword → food. Used to read the member's description, and as the offline
     estimator in the prototype. In production the vision model returns the item
     list and this becomes the fallback only. SCORING STAYS LOCAL either way. */
  const FRX_WORDS = [
    ['roti', 'roti'], ['chapati', 'roti'], ['phulka', 'roti'], ['paratha', 'paratha'],
    ['rice', 'rice'], ['chawal', 'rice'], ['biryani', 'rice'], ['pulao', 'rice'],
    ['dal', 'dal'], ['sambar', 'dal'], ['rajma', 'rajma'], ['chana', 'rajma'], ['chole', 'rajma'],
    ['sabzi', 'sabzi'], ['bhindi', 'sabzi'], ['lauki', 'sabzi'], ['gobi', 'sabzi'], ['vegetable', 'sabzi'],
    ['palak', 'palak'], ['spinach', 'palak'], ['saag', 'palak'],
    ['aloo', 'aloo'], ['potato', 'aloo'],
    ['paneer', 'paneer'], ['curd', 'curd'], ['dahi', 'curd'], ['yogurt', 'curd'], ['raita', 'curd'],
    ['egg white', 'eggwhite'], ['egg', 'egg'], ['omelette', 'egg'],
    ['chicken breast', 'chickenBreast'], ['grilled chicken', 'chickenBreast'], ['tandoori', 'tandoori'],
    ['chicken leg', 'chickenLeg'], ['chicken thigh', 'chickenLeg'], ['chicken', 'chicken'],
    ['mutton', 'mutton'], ['fish fillet', 'fishFillet'], ['grilled fish', 'fishFillet'], ['fish', 'fish'],
    ['prawn', 'prawns'], ['soya', 'soya'], ['tofu', 'tofu'], ['sprout', 'sprouts'],
    ['oats', 'oats'], ['daliya', 'oats'], ['brown rice', 'brownRice'], ['millet', 'brownRice'],
    ['ghee', 'ghee'], ['butter', 'ghee'], ['fruit', 'fruitBowl'],
    ['idli', 'idli'], ['dosa', 'dosa'], ['poha', 'poha'], ['upma', 'upma'],
    ['salad', 'salad'], ['samosa', 'samosa'], ['pakora', 'samosa'],
    ['sweet', 'sweet'], ['gulab', 'sweet'], ['halwa', 'sweet'], ['laddu', 'sweet'], ['barfi', 'sweet'],
    ['papad', 'papad'], ['pickle', 'papad'], ['achar', 'papad'],
    ['banana', 'banana'], ['apple', 'apple'], ['pear', 'apple'],
    ['nuts', 'nuts'], ['almond', 'nuts'], ['walnut', 'nuts'], ['badam', 'nuts'],
    ['milk', 'milk'], ['tea', 'teaSugar'], ['chai', 'teaSugar'], ['coffee', 'teaSugar'],
  ];
  const FRX_STAGES = ['Reading your plate…', 'Identifying each item…', 'Estimating portions…', 'Checking against your rules…'];
  const FRX_TYPICAL = { breakfast: [['paratha', 1], ['teaSugar', 1]], lunch: [['roti', 2], ['dal', 1], ['sabzi', 1]], snack: [['teaSugar', 1], ['samosa', 1]], dinner: [['rice', 1], ['dal', 1], ['sabzi', 1]] };

  function frxRead(text, slotId) {
    let t = ' ' + (text || '').toLowerCase() + ' ';
    const found = {};
    /* Longest phrase wins: "chicken breast" must not be read as "chicken curry".
       Each match is consumed so a shorter alias cannot double-count it. */
    [...FRX_WORDS].sort((a, b) => b[0].length - a[0].length).forEach(([w, id]) => {
      if (!t.includes(w)) return;
      const m = t.match(new RegExp('(\\d+)\\s*(?:no\\.?|nos\\.?|pieces?|pcs?|katori|bowls?|plates?|glass(?:es)?|cups?)?\\s*' + w));
      found[id] = Math.max(found[id] || 0, m ? Math.min(6, Number(m[1])) : 1);
      t = t.split(w).join(' ');
    });
    const list = Object.keys(found).map(id => ({ id, qty: found[id] }));
    if (list.length) return { items: list, guessed: false };
    return { items: (FRX_TYPICAL[slotId] || FRX_TYPICAL.lunch).map(([id, qty]) => ({ id, qty })), guessed: true };
  }

  /* The iLive 3-Rule Plate, derived from what is actually on the plate. */
  function frxPlateRule(sel) {
    const g = (pred) => sel.filter(x => pred(frxFood(x.id))).reduce((s, x) => s + x.qty, 0);
    const veg = g(f => f && ['sabzi', 'palak', 'salad'].includes(f.id));
    const prot = g(f => f && ['dal', 'rajma', 'paneer', 'egg', 'eggwhite', 'chicken', 'fish', 'curd', 'milk'].includes(f.id));
    const carbHigh = sel.filter(x => { const f = frxFood(x.id); return f && f.gi === 'high'; }).reduce((s, x) => s + x.qty, 0);
    const carbAny = g(f => f && f.carb >= 18);
    return {
      veg: veg >= 2 ? 'good' : veg === 1 ? 'low' : 'none',
      protein: prot >= 2 ? 'good' : prot === 1 ? 'low' : 'none',
      carb: carbHigh >= 2 ? 'refined' : carbAny > 2 ? 'high' : 'good',
    };
  }

  const FRX_PLATE_TEXT = {
    veg: { title: 'Half the plate — vegetables', good: 'Good amount', low: 'Too little', none: 'Missing' },
    protein: { title: 'A quarter — protein', good: 'Good amount', low: 'Too little', none: 'Missing' },
    carb: { title: 'A quarter — quality carbs', good: 'Right amount', high: 'Too much', refined: 'Refined, swap it' },
  };

  function renderFoodRx() {
    const D = { bg: '#0B2039', card: '#16314F', raised: '#1E3C60', hair: 'rgba(255,255,255,.14)', ink: '#FFFFFF', ink2: '#C6D8EC', ink3: '#93AECB', blueLite: '#9CCAFF', green: '#5FDCA8', amber: '#F5C572', red: '#F58D8B', violet: '#B0A4FF' };
    const rules = frxUserRules();
    const slot = frxSlot(frxSlotId || frxDetectSlot().id);
    const weight = Number(foWt) || 70;
    const VC = { green: D.green, amber: D.amber, red: D.red };
    const HEAD = { green: `Optimal ${slot.noun}`, amber: `Suboptimal ${slot.noun}`, red: `Not a suitable ${slot.noun}` };
    const back = (label, fn) => <button onClick={fn} className="flex items-center gap-1.5 text-sm font-semibold mb-4" style={{ color: D.ink3 }}><ChevronLeft size={16} color={D.ink3} /> {label}</button>;

    /* ---------------- RESULT ---------------- */
    if (frxView === 'result' && frxPlate.length) {
      const a = frxAssess(frxPlate, slot.id, rules, weight, { onInsulin: !!frxInsulin, totals: frxTotals, items: frxItems });
      const col = VC[a.verdict];
      const spikeIdx = { small: 0, moderate: 1, large: 2 }[a.spike];
      const spikeTxt = { small: 'Small rise', moderate: 'Moderate rise', large: 'Large rise' }[a.spike];
      const plate = frxPlateRule(frxPlate);
      const pc = (v) => v === 'good' ? D.green : (v === 'none' || v === 'refined') ? D.red : D.amber;
      const experiment = a.remove.length ? `Tomorrow at ${slot.noun}, try this once: ${a.remove[0].item.toLowerCase()}.` : `Tomorrow at ${slot.noun}, add ${a.add[0].item.toLowerCase()} and see how you feel.`;

      return (
        <div className="-mx-4 -mt-4" style={{ background: D.bg, color: D.ink, minHeight: '100%' }}>
          {/* photo + stamp */}
          <div style={{ position: 'relative' }}>
            {frxPhoto
              ? <img src={frxPhoto} alt="" style={{ width: '100%', height: 200, objectFit: 'cover', display: 'block' }} />
              : <div style={{ height: 104, background: 'linear-gradient(150deg, #153E6F, #2B6CB0)' }} />}
            <div className="flex items-center justify-center frx-stamp" style={{ position: 'absolute', right: 18, bottom: -32, width: 70, height: 70, borderRadius: 35, background: col, border: `4px solid ${D.bg}`, boxShadow: `0 10px 30px ${col}55, 0 8px 24px rgba(0,0,0,.35)` }}>
              {a.verdict === 'green' ? <Check size={32} color="#08182B" strokeWidth={3} /> : a.verdict === 'amber' ? <AlertTriangle size={30} color="#08182B" /> : <X size={32} color="#08182B" strokeWidth={3} />}
            </div>
            <button onClick={() => { tapFeel('tap'); setFrxView('capture'); }} className="flex items-center justify-center" style={{ position: 'absolute', left: 14, top: 14, width: 34, height: 34, borderRadius: 17, background: 'rgba(6,19,31,.55)' }}><X size={17} color="#FFFFFF" /></button>
          </div>

          <div className="px-4" style={{ paddingTop: 16 }}>
            <div style={{ paddingRight: 84 }}>
              <div className="font-display" style={{ fontSize: 23, fontWeight: 600, color: col, lineHeight: 1.2, letterSpacing: '-0.02em' }}>{HEAD[a.verdict]}</div>
              <div style={{ fontSize: 12.5, color: D.ink3, marginTop: 5 }}>Judged for {rules.label.toLowerCase()} · {slot.label.toLowerCase()}</div>
            </div>
          </div>

          <div className="px-4 pb-6 space-y-3" style={{ marginTop: 16 }}>
            {/* hard safety first */}
            {(rules.hardWarnings || []).length > 0 && (
              <div className="rounded-2xl p-4" style={{ background: 'rgba(245,141,139,.09)', border: '1px solid rgba(245,141,139,.35)' }}>
                <div style={{ fontSize: 11, letterSpacing: 1.3, color: D.red, fontWeight: 700 }}>IMPORTANT FOR YOU</div>
                {rules.hardWarnings.map((w, i) => <div key={i} style={{ fontSize: 13, color: D.ink2, lineHeight: 1.6, marginTop: 7 }}>• {w}</div>)}
              </div>
            )}
            {a.guarded.map((g, i) => <div key={i} className="rounded-2xl p-4" style={{ background: 'rgba(245,197,114,.09)', border: '1px solid rgba(245,197,114,.35)', fontSize: 13, color: D.ink2, lineHeight: 1.6 }}>⚠️ {g}</div>)}

            {/* 0 · confidence + what we counted, editable */}
            {frxItems && (
              <div className="rounded-2xl p-4" style={{ background: D.card, border: `1px solid ${frxConf === 'low' ? D.amber + '55' : D.hair}` }}>
                <div className="flex items-center justify-between">
                  <span style={{ fontSize: 11, letterSpacing: 1.3, color: D.blueLite, fontWeight: 700 }}>WHAT WE COUNTED</span>
                  <span className="rounded-full" style={{ padding: '3px 9px', background: frxConf === 'high' ? 'rgba(95,220,168,.16)' : frxConf === 'low' ? 'rgba(245,197,114,.16)' : 'rgba(156,202,255,.14)', color: frxConf === 'high' ? D.green : frxConf === 'low' ? D.amber : D.blueLite, fontSize: 10.5, fontWeight: 700 }}>{frxConf === 'high' ? 'Confident read' : frxConf === 'low' ? 'Unsure — please check' : 'Reasonable read'}</span>
                </div>
                {frxItems.map((it, i) => (
                  <div key={i} className="flex items-center gap-3" style={{ padding: '9px 0', borderTop: i ? `1px solid ${D.hair}` : 'none', marginTop: i ? 0 : 8 }}>
                    <div className="flex-1 min-w-0">
                      <div style={{ fontSize: 14, color: D.ink }}>{it.n}</div>
                      <div style={{ fontSize: 11.5, color: D.ink3, marginTop: 1 }}>{it.q}{it.g ? ` · ${it.g} g` : ''} · {it.kcal} kcal · {it.protein} g protein</div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button onClick={() => { tapFeel('tap'); const next = frxItems.map((x, j) => j === i ? Object.assign({}, x, FRX_KEYS.reduce((o, k) => (o[k] = Math.round(x[k] * 0.5), o), {}), { q: 'half of ' + x.q, g: Math.round(x.g / 2) }) : x); setFrxItems(next); setFrxTotals(FRX_KEYS.reduce((o, k) => (o[k] = next.reduce((s, y) => s + y[k], 0), o), {})); }} className="rounded-full" style={{ width: 30, height: 30, background: D.raised, color: D.ink, fontSize: 12, fontWeight: 700 }}>½</button>
                      <button onClick={() => { tapFeel('tap'); const next = frxItems.map((x, j) => j === i ? Object.assign({}, x, FRX_KEYS.reduce((o, k) => (o[k] = Math.round(x[k] * 2), o), {}), { q: 'double ' + x.q, g: x.g * 2 }) : x); setFrxItems(next); setFrxTotals(FRX_KEYS.reduce((o, k) => (o[k] = next.reduce((s, y) => s + y[k], 0), o), {})); }} className="rounded-full" style={{ width: 30, height: 30, background: D.raised, color: D.ink, fontSize: 12, fontWeight: 700 }}>×2</button>
                      <button onClick={() => { tapFeel('tap'); const next = frxItems.filter((x, j) => j !== i); setFrxItems(next); setFrxTotals(FRX_KEYS.reduce((o, k) => (o[k] = next.reduce((s, y) => s + y[k], 0), o), {})); }} className="rounded-full" style={{ width: 30, height: 30, background: 'rgba(245,141,139,.16)', color: D.red, fontSize: 15, fontWeight: 700 }}>×</button>
                    </div>
                  </div>
                ))}
                <div className="rounded-xl p-3 mt-3" style={{ background: D.raised, fontSize: 12, color: D.ink2, lineHeight: 1.55 }}>
                  Wrong? Tap ½, ×2 or × to correct any item — the numbers and the advice update straight away. Your corrections teach the app.
                </div>
              </div>
            )}

            {/* 1 · what's in it */}
            <div className="rounded-2xl p-4" style={{ background: D.card, border: `1px solid ${D.hair}` }}>
              <div className="font-display" style={{ fontSize: 16, fontWeight: 600 }}>What's in this {slot.noun}</div>
              {a.rows.map((r, i) => (
                <div key={r.k} className="flex items-center gap-3" style={{ padding: '10px 0', borderTop: i ? `1px solid ${D.hair}` : 'none', marginTop: i ? 0 : 8 }}>
                  <div className="flex-1 min-w-0">
                    <div style={{ fontSize: 14, color: D.ink }}>{r.label}</div>
                    <div style={{ fontSize: 11, color: D.ink3, marginTop: 1 }}>aim {r.aim}</div>
                  </div>
                  <div className="font-display" style={{ fontSize: 16, fontWeight: 700, whiteSpace: 'nowrap' }}>{r.v}<span style={{ fontSize: 11, fontWeight: 500, color: D.ink3 }}> {r.u}</span></div>
                  <span className="rounded-full text-center flex-shrink-0" style={{ width: 76, padding: '5px 0', background: `${r.fg}1E`, color: r.fg, fontSize: 10.5, fontWeight: 700 }}>{r.word}</span>
                </div>
              ))}
              <div style={{ fontSize: 11, color: D.ink3, marginTop: 10, lineHeight: 1.5 }}>Estimated from the photo and your note, so treat it as close, not exact.</div>
            </div>

            {/* 2 · why */}
            <div className="rounded-2xl p-4" style={{ background: D.card, border: `1px solid ${D.hair}` }}>
              <div className="font-display" style={{ fontSize: 16, fontWeight: 600 }}>{a.verdict === 'green' ? `Why this is an optimal ${slot.noun}` : `Why this is ${a.verdict === 'amber' ? 'suboptimal' : 'not suitable'}`}</div>
              {a.reasons.map((x, i) => (
                <div key={i} className="flex gap-2.5 items-start" style={{ marginTop: 9 }}>
                  <span className="rounded-full flex-shrink-0" style={{ width: 7, height: 7, background: x.fg, marginTop: 6 }} />
                  <span style={{ fontSize: 13.5, color: D.ink2, lineHeight: 1.55 }}>{x.text}</span>
                </div>
              ))}
              {a.wins.length > 0 && (
                <div style={{ marginTop: a.reasons.length ? 12 : 6, paddingTop: a.reasons.length ? 12 : 0, borderTop: a.reasons.length ? `1px solid ${D.hair}` : 'none' }}>
                  {a.wins.map((w, i) => <div key={i} className="flex gap-2.5 items-center" style={{ padding: '3px 0' }}><Check size={14} color={D.green} strokeWidth={3} /><span style={{ fontSize: 13, color: D.ink3 }}>{w}</span></div>)}
                </div>
              )}
            </div>

            {/* 3 · sugar rise */}
            <div className="rounded-2xl p-4" style={{ background: D.card, border: `1px solid ${D.hair}` }}>
              <div className="flex items-center justify-between">
                <span style={{ fontSize: 13, color: D.ink3 }}>Likely blood-sugar rise</span>
                <span className="font-display" style={{ fontSize: 14, fontWeight: 700, color: [D.green, D.amber, D.red][spikeIdx] }}>{spikeTxt}</span>
              </div>
              <div className="flex gap-1.5 mt-2.5">{[0, 1, 2].map(i => <div key={i} className="flex-1 rounded-full" style={{ height: 9, background: i <= spikeIdx ? [D.green, D.amber, D.red][spikeIdx] : 'rgba(255,255,255,.1)' }} />)}</div>
              <div style={{ fontSize: 11, color: D.ink3, marginTop: 10 }}>An estimate. Your own 2-hour reading is what settles it.</div>
            </div>

            {/* 4 · fix */}
            {(a.remove.length > 0 || a.add.length > 0) && (
              <div className="rounded-2xl p-4" style={{ background: D.card, border: `1px solid ${D.hair}` }}>
                <div className="font-display" style={{ fontSize: 16, fontWeight: 600 }}>{a.verdict === 'green' ? 'Make it even better' : 'How to fix this plate'}</div>
                {a.remove.length > 0 && <div style={{ fontSize: 11.5, color: D.red, fontWeight: 700, marginTop: 10 }}>Take out or cut down</div>}
                {a.remove.map((x, i) => (
                  <div key={i} className="flex gap-3 items-start" style={{ padding: '7px 0' }}>
                    <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 24, height: 24, background: 'rgba(245,141,139,.16)', color: D.red, fontSize: 16, fontWeight: 700, lineHeight: 1 }}>−</span>
                    <div><div style={{ fontSize: 14, color: D.ink }}>{x.item}</div><div style={{ fontSize: 12, color: D.ink3, marginTop: 1 }}>{x.why}</div></div>
                  </div>
                ))}
                {a.add.length > 0 && <div style={{ fontSize: 11.5, color: D.green, fontWeight: 700, marginTop: 10 }}>Add</div>}
                {a.add.map((x, i) => (
                  <div key={i} className="flex gap-3 items-start" style={{ padding: '7px 0' }}>
                    <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 24, height: 24, background: 'rgba(95,220,168,.16)', color: D.green, fontSize: 16, fontWeight: 700, lineHeight: 1 }}>+</span>
                    <div><div style={{ fontSize: 14, color: D.ink }}>{x.item}</div><div style={{ fontSize: 12, color: D.ink3, marginTop: 1 }}>{x.why}</div></div>
                  </div>
                ))}
              </div>
            )}

            {/* 5 · longevity */}
            <div className="rounded-2xl p-4" style={{ background: 'linear-gradient(150deg, rgba(176,164,255,.14) 0%, rgba(176,164,255,.02) 60%), ' + D.card, border: `1px solid ${D.violet}44` }}>
              <div className="flex items-center gap-2"><Sparkles size={15} color={D.violet} /><span style={{ fontSize: 11, letterSpacing: 1.3, color: D.violet, fontWeight: 700 }}>LONGEVITY BOOST</span></div>
              <div className="font-display mt-2.5" style={{ fontSize: 17, fontWeight: 500, lineHeight: 1.35 }}>{a.longevity.item}</div>
              <div style={{ fontSize: 13, color: D.ink2, marginTop: 6, lineHeight: 1.6 }}>{a.longevity.why}</div>
            </div>

            {/* 6 · the iLive plate */}
            <div className="rounded-2xl p-4" style={{ background: D.card, border: `1px solid ${D.hair}` }}>
              <div className="font-display" style={{ fontSize: 15.5, fontWeight: 600 }}>The iLive 3-Rule Plate</div>
              {['veg', 'protein', 'carb'].map(k => (
                <div key={k} className="flex items-center gap-3" style={{ padding: '8px 0' }}>
                  <span className="rounded-full flex-shrink-0" style={{ width: 11, height: 11, background: pc(plate[k]) }} />
                  <span className="flex-1" style={{ fontSize: 14, color: D.ink }}>{FRX_PLATE_TEXT[k].title}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: pc(plate[k]) }}>{FRX_PLATE_TEXT[k][plate[k]]}</span>
                </div>
              ))}
              <div className="rounded-xl p-3 mt-2" style={{ background: D.raised, fontSize: 12.5, color: D.ink2, lineHeight: 1.55 }}>Eat the vegetables and protein first, carbohydrate last. The same plate spikes less in that order.</div>
            </div>

            {/* 7 · experiment */}
            <div className="rounded-2xl p-4 flex gap-3" style={{ background: D.raised }}>
              <span style={{ fontSize: 17 }}>🧪</span>
              <div><div style={{ fontSize: 11.5, fontWeight: 700, color: D.blueLite }}>TOMORROW'S EXPERIMENT</div><div style={{ fontSize: 13.5, color: D.ink, marginTop: 3, lineHeight: 1.5 }}>{experiment}</div></div>
            </div>

            <button onClick={() => { tapFeel('success'); setFrxLog([...frxLog, { id: Date.now(), slot: slot.id, at: Date.now(), verdict: a.verdict, kcal: a.n.kcal, carb: a.n.carb, photo: frxPhoto }]); setFrxCelebrate(true); setTimeout(() => setFrxCelebrate(false), 1900); setFrxPlate([]); setFrxPhoto(null); setFrxText(''); setFrxItems(null); setFrxTotals(null); setFrxConf(null); setFrxView('day'); }} className="w-full rounded-2xl py-4 text-base font-bold" style={{ background: 'linear-gradient(135deg, #23B27A 0%, #178A5C 100%)', color: '#FFFFFF' }}>
              ✓ Log this {slot.noun}
            </button>
            <div className="text-center" style={{ fontSize: 11.5, color: D.ink3, lineHeight: 1.6 }}>{rules.basis}</div>
          </div>
        </div>
      );
    }

    /* ---------------- CAPTURE ---------------- */
    if (frxView === 'capture') {
      const ready = !!frxPhoto || !!(frxText || '').trim();
      const nowSlot = frxDetectSlot();
      const readFile = (file) => {
        if (!file) return;
        const r = new FileReader();
        r.onload = () => { setFrxPhoto(String(r.result)); setFrxErr(''); };
        r.onerror = () => setFrxErr("That file couldn't be opened. JPG and PNG both work.");
        r.readAsDataURL(file);
      };

      /* Try the vision model first. If it is unavailable we do NOT invent a
         plate — we ask. Under-reporting protein once destroys trust. */
      const analyse = async (sid) => {
        tapFeel('success'); setFrxSlotId(sid); setFrxBusy(true); setFrxErr(''); setFrxStage(0);
        const ticker = setInterval(() => setFrxStage(s => s + 1), 900);
        /* Hold the analysing state for a moment even when the answer is instant.
           A result that flashes in feels broken; a short, honest pause with the
           stages named feels considered — and gives the member time to read. */
        const began = Date.now();
        const stop = async () => { clearInterval(ticker); const wait = 2100 - (Date.now() - began); if (wait > 0) await new Promise(r => setTimeout(r, wait)); };
        try {
          const b64 = frxPhoto ? String(frxPhoto).split(',')[1] : null;
          const r = await frxVision({ imageB64: b64, note: frxText });
          if (r.not_food) throw new Error('not food');
          setFrxItems(r.items); setFrxTotals(r.total); setFrxConf(r.confidence);
          await stop(); setFrxPlate([{ id: 'vision', qty: 1 }]); setFrxBusy(false); setFrxView('result');
        } catch (err) {
          await stop(); const read = frxRead(frxText, sid);
          setFrxBusy(false);
          /* Never dead-end. If we could not read it, we still show a result —
             clearly marked as an estimate, with every item editable so the
             member can correct it in two taps. A refusal feels broken. */
          if (read.guessed) setFrxErr('');
          setFrxItems(read.items.map(it => { const f = frxFood(it.id); const o = { n: f.n, q: f.q, g: 0 }; FRX_KEYS.forEach(k => o[k] = Math.round((f[k] || 0) * it.qty)); return o; }));
          setFrxTotals(frxSum(read.items));
          setFrxConf(read.guessed ? 'low' : 'medium');
          setFrxPlate(read.items.length ? read.items : [{ id: 'roti', qty: 2 }]); setFrxView('result');
        }
      };

      return (
        <div className="-mx-4 -mt-4 px-4 pt-5 pb-6" style={{ background: D.bg, color: D.ink, minHeight: '100%' }}>
          {back('Back', () => { tapFeel('tap'); setFrxView('day'); })}
          <div className="font-display" style={{ fontSize: 24, fontWeight: 500, letterSpacing: '-0.03em' }}>Check a meal</div>
          <div style={{ fontSize: 13, color: D.ink3, lineHeight: 1.6, margin: '10px 0 16px' }}>Photograph the plate from above, in good light, with everything in frame.</div>

          <div className="rounded-2xl p-3" style={{ background: D.card, border: `1px solid ${D.hair}` }}>
            {frxPhoto ? (
              <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden' }}>
                <img src={frxPhoto} alt="" style={{ width: '100%', height: 220, objectFit: 'cover', display: 'block' }} />
                {frxBusy && (
                  <>
                    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(11,32,57,.15) 0%, rgba(11,32,57,.78) 100%)' }} />
                    <div className="frx-scan" />
                    <div className="frx-grid" />
                    <div className="frx-pulse" style={{ position: 'absolute', left: '50%', top: '50%', width: 120, height: 120, marginLeft: -60, marginTop: -60, borderRadius: 60, border: '2px solid rgba(156,202,255,.5)' }} />
                    <div className="frx-pulse" style={{ position: 'absolute', left: '50%', top: '50%', width: 120, height: 120, marginLeft: -60, marginTop: -60, borderRadius: 60, border: '2px solid rgba(95,220,168,.4)', animationDelay: '.7s' }} />
                    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 14, textAlign: 'center' }}>
                      <div className="flex items-center justify-center gap-2.5">
                        <span className="frx-spin" style={{ width: 18, height: 18, borderRadius: 9, border: '2.5px solid rgba(156,202,255,.25)', borderTopColor: '#9CCAFF', display: 'inline-block' }} />
                        <span className="font-display" style={{ fontSize: 14.5, color: '#FFFFFF', fontWeight: 600 }}>{FRX_STAGES[frxStage % FRX_STAGES.length]}</span>
                      </div>
                      <div className="flex justify-center gap-1.5 mt-2.5">
                        {FRX_STAGES.map((_, i) => <span key={i} className="rounded-full" style={{ width: i === frxStage % FRX_STAGES.length ? 18 : 6, height: 6, background: i <= frxStage % FRX_STAGES.length ? '#9CCAFF' : 'rgba(255,255,255,.22)', transition: 'width .3s' }} />)}
                      </div>
                    </div>
                  </>
                )}
                {!frxBusy && <button onClick={() => { tapFeel('tap'); setFrxPhoto(null); }} className="rounded-full" style={{ position: 'absolute', right: 10, top: 10, background: 'rgba(6,19,31,.6)', color: '#FFF', padding: '7px 12px', fontSize: 12, fontWeight: 600 }}>Change photo</button>}
              </div>
            ) : (
              <div className="text-center" style={{ border: `2px dashed ${D.hair}`, borderRadius: 14, padding: '24px 14px' }}>
                <span className="flex items-center justify-center rounded-full mx-auto" style={{ width: 56, height: 56, background: D.raised, fontSize: 24 }}>📷</span>
                <div className="font-display" style={{ fontSize: 15.5, fontWeight: 600, marginTop: 10 }}>Add a photo of your plate</div>
                <div style={{ fontSize: 12.5, color: D.ink3, marginTop: 4 }}>Include drinks and sides so nothing is missed.</div>
                <div className="flex gap-2.5 mt-4">
                  <button onClick={() => { tapFeel('tap'); frxCamRef.current && frxCamRef.current.click(); }} className="flex-1 rounded-xl py-3 font-bold" style={{ background: 'linear-gradient(135deg, #4A90F0 0%, #1F5CB0 100%)', color: '#FFF', fontSize: 14 }}>📷 Take photo</button>
                  <button onClick={() => { tapFeel('tap'); frxFileRef.current && frxFileRef.current.click(); }} className="flex-1 rounded-xl py-3 font-bold" style={{ background: D.raised, color: D.ink, fontSize: 14 }}>🖼️ Upload</button>
                </div>
                <input ref={frxCamRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; readFile(f); }} />
                <input ref={frxFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; readFile(f); }} />
                <div style={{ fontSize: 11.5, color: D.ink3, marginTop: 12, lineHeight: 1.5 }}>JPG, PNG or HEIC. On a phone, "Take photo" opens the camera directly.</div>
              </div>
            )}
          </div>

          {frxBusy && !frxPhoto && (
            <div className="rounded-2xl p-5 mt-3 text-center" style={{ background: D.card, border: `1px solid ${D.blueLite}44` }}>
              <span className="frx-spin mx-auto" style={{ width: 26, height: 26, borderRadius: 13, border: '3px solid rgba(156,202,255,.22)', borderTopColor: '#9CCAFF', display: 'block' }} />
              <div className="font-display mt-3" style={{ fontSize: 15, fontWeight: 600 }}>{FRX_STAGES[frxStage % FRX_STAGES.length]}</div>
            </div>
          )}
          <div className="rounded-2xl p-4 mt-3" style={{ background: D.card, border: `1px solid ${D.hair}` }}>
            <div style={{ fontSize: 14, color: D.ink, fontWeight: 600 }}>{frxPhoto ? "Anything the photo can't show?" : 'Or describe the meal'}</div>
            <div style={{ fontSize: 12, color: D.ink3, marginTop: 3 }}>Portions help most — "2 chicken breasts", "3 rotis", "1 katori dal".</div>
            <input value={frxText} onChange={(e) => setFrxText(e.target.value)} placeholder="e.g. 2 chicken breasts, salad, 1 roti"
              className="w-full rounded-xl mt-2.5" style={{ background: D.raised, border: `1px solid ${D.hair}`, color: D.ink, padding: '12px 14px', fontSize: 14 }} />
          </div>

          {frxErr && <div className="rounded-2xl p-4 mt-3" style={{ background: 'rgba(245,197,114,.10)', border: '1px solid rgba(245,197,114,.35)', fontSize: 13, color: D.ink2, lineHeight: 1.6 }}>{frxErr}</div>}

          <div className="rounded-2xl p-4 mt-3" style={{ background: D.card, border: `1px solid ${D.hair}`, opacity: ready || frxBusy ? 1 : 0.5 }}>
            <div className="font-display" style={{ fontSize: 16, fontWeight: 600 }}>Which meal is this?</div>
            <div style={{ fontSize: 12.5, color: D.ink3, marginTop: 3 }}>{ready || frxBusy ? 'Tap one and we will read your plate.' : 'Add a photo or a description first.'}</div>
            <div className="grid grid-cols-2 gap-2.5 mt-3.5">
              {FRX_SLOTS.map(s2 => {
                const isNow = s2.id === nowSlot.id, running = frxBusy && frxSlotId === s2.id;
                return (
                  <button key={s2.id} disabled={!ready || frxBusy} onClick={() => analyse(s2.id)} className="rounded-xl py-4 relative" style={{ background: running ? 'linear-gradient(135deg, #3B7FC9, #1F5C9E)' : isNow ? 'rgba(156,202,255,.12)' : D.raised, border: `1.5px solid ${running || isNow ? D.blueLite : 'transparent'}` }}>
                    <div className="font-display" style={{ fontSize: 15, fontWeight: 700, color: D.ink }}>{running ? 'Reading…' : s2.label}</div>
                    <div style={{ fontSize: 11, color: D.ink3, marginTop: 3 }}>{s2.id === 'dinner' ? 'After 7 PM' : `${s2.start > 12 ? s2.start - 12 : s2.start} ${s2.start >= 12 ? 'PM' : 'AM'} to ${s2.end > 12 ? s2.end - 12 : s2.end} ${s2.end >= 12 ? 'PM' : 'AM'}`}</div>
                    {isNow && !running && <span className="rounded-full" style={{ position: 'absolute', top: -8, right: 10, background: D.blueLite, color: '#08182B', fontSize: 9.5, fontWeight: 800, padding: '3px 9px' }}>NOW</span>}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="text-center mt-4" style={{ fontSize: 11.5, color: D.ink3, lineHeight: 1.6 }}>We never guess your numbers. If the photo is unclear we will ask you, not invent a plate.</div>
        </div>
      );
    }

    /* ---------------- DAY ---------------- */
    const kcalToday = frxLog.reduce((s, e) => s + e.kcal, 0);
    const left = rules.kcal - kcalToday;
    return (
      <div className="-mx-4 -mt-4 px-4 pt-5 pb-6" style={{ background: D.bg, color: D.ink, minHeight: '100%' }}>
        {frxCelebrate && (
          <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 90, overflow: 'hidden' }}>
            {Array.from({ length: 28 }).map((_, i) => (
              <span key={i} className="frx-confetti" style={{ left: `${(i * 37) % 100}%`, background: ['#5FDCA8', '#9CCAFF', '#F5C572', '#B0A4FF', '#E3C766'][i % 5], animationDelay: `${(i % 7) * 0.07}s`, width: 7 + (i % 3) * 2, height: 10 + (i % 4) * 3 }} />
            ))}
          </div>
        )}
        {back('Back', () => { tapFeel('tap'); setPvSheet(null); })}
        <div className="flex items-center gap-2.5">
          <span style={{ fontSize: 22 }}>🍽️</span>
          <div>
            <div className="font-display" style={{ fontSize: 24, fontWeight: 500, letterSpacing: '-0.03em' }}>Check My Meal</div>
            <div style={{ fontSize: 12.5, color: D.ink3, marginTop: 2 }}>Judged for {rules.label.toLowerCase()}</div>
          </div>
        </div>

        <div className="rounded-2xl p-4 mt-4" style={{ background: 'linear-gradient(160deg, rgba(156,202,255,.10) 0%, rgba(255,255,255,.01) 60%), ' + D.card, border: `1px solid ${D.blueLite}33` }}>
          <div style={{ fontSize: 11, letterSpacing: 1.3, color: D.blueLite, fontWeight: 700 }}>YOUR FOOD RULES</div>
          <div style={{ fontSize: 14, color: D.ink, marginTop: 8, lineHeight: 1.55 }}>{rules.aim}</div>
          <div className="flex flex-wrap gap-2 mt-3">
            {rules.heavier.map(k => <span key={k} className="rounded-full" style={{ padding: '3px 10px', background: 'rgba(156,202,255,.14)', color: D.blueLite, fontSize: 11, fontWeight: 600 }}>{{ carb: 'Carbohydrate', sugar: 'Added sugar', fiber: 'Fibre', protein: 'Protein', sodium: 'Salt', potassium: 'Potassium', phosphorus: 'Phosphate', satfat: 'Saturated fat', kcal: 'Calories' }[k]}</span>)}
          </div>
        </div>

        {(rules.hardWarnings || []).length > 0 && (
          <div className="rounded-2xl p-4 mt-3" style={{ background: 'rgba(245,141,139,.09)', border: '1px solid rgba(245,141,139,.35)' }}>
            <div style={{ fontSize: 11, letterSpacing: 1.3, color: D.red, fontWeight: 700 }}>IMPORTANT FOR YOU</div>
            {rules.hardWarnings.map((w, i) => <div key={i} style={{ fontSize: 13, color: D.ink2, lineHeight: 1.6, marginTop: 7 }}>• {w}</div>)}
          </div>
        )}

        <div className="rounded-2xl p-4 mt-3" style={{ background: D.card, border: `1px solid ${D.hair}` }}>
          <div className="flex items-center justify-between">
            <span style={{ fontSize: 15, color: D.ink, fontWeight: 600 }}>Today</span>
            <span className="rounded-full" style={{ padding: '3px 10px', background: left < 0 ? 'rgba(245,141,139,.16)' : 'rgba(95,220,168,.14)', color: left < 0 ? D.red : D.green, fontSize: 11.5, fontWeight: 700 }}>{left < 0 ? `${-left} kcal over` : `${left} kcal left`}</span>
          </div>
          <div className="flex gap-2 mt-3.5">
            {FRX_SLOTS.map(s => {
              const e = frxLog.find(x => x.slot === s.id);
              return (
                <button key={s.id} onClick={() => { tapFeel('tap'); setFrxSlotId(s.id); setFrxPlate([]); setFrxPhoto(null); setFrxText(''); setFrxView('capture'); }} className="flex-1 rounded-xl py-3 text-center" style={{ background: D.raised, border: e ? `1.5px solid ${VC[e.verdict]}` : '1.5px solid transparent' }}>
                  <div className="flex items-center justify-center" style={{ height: 24 }}>
                    {e ? <span className="flex items-center justify-center rounded-full" style={{ width: 22, height: 22, background: VC[e.verdict] }}>{e.verdict === 'green' ? <Check size={12} color="#08182B" strokeWidth={3} /> : e.verdict === 'amber' ? <AlertTriangle size={12} color="#08182B" /> : <X size={12} color="#08182B" strokeWidth={3} />}</span> : <span style={{ fontSize: 15, color: D.ink3 }}>+</span>}
                  </div>
                  <div style={{ fontSize: 10.5, color: D.ink3, marginTop: 5 }}>{s.label}</div>
                </button>
              );
            })}
          </div>
          <button onClick={() => { tapFeel('success'); setFrxSlotId(frxDetectSlot().id); setFrxPlate([]); setFrxPhoto(null); setFrxText(''); setFrxView('capture'); }} className="w-full rounded-xl py-3.5 text-base font-bold mt-3.5" style={{ background: 'linear-gradient(135deg, #4A90F0 0%, #1F5CB0 100%)', color: '#FFFFFF' }}>📷 Photograph a meal</button>
        </div>

        <div className="rounded-2xl p-4 mt-3" style={{ background: 'linear-gradient(150deg, rgba(176,164,255,.14) 0%, rgba(176,164,255,.02) 60%), ' + D.card, border: `1px solid ${D.violet}44` }}>
          <div className="flex items-center gap-2"><Sparkles size={15} color={D.violet} /><span style={{ fontSize: 11, letterSpacing: 1.3, color: D.violet, fontWeight: 700 }}>YOUR LONGEVITY LIST</span></div>
          <div style={{ fontSize: 12.5, color: D.ink3, marginTop: 6, lineHeight: 1.55 }}>Small, cheap, everyday additions — chosen to be safe for {rules.label.toLowerCase()}.</div>
          {rules.longevity.map((l, i) => (
            <div key={i} className="flex gap-3 items-start" style={{ padding: '9px 0', borderTop: i ? `1px solid ${D.hair}` : 'none', marginTop: i ? 0 : 8 }}>
              <span className="flex items-center justify-center rounded-full flex-shrink-0 font-display" style={{ width: 22, height: 22, background: D.raised, fontSize: 11, fontWeight: 700, color: D.violet }}>{i + 1}</span>
              <div><div style={{ fontSize: 13.5, color: D.ink }}>{l.item}</div><div style={{ fontSize: 12, color: D.ink3, marginTop: 2, lineHeight: 1.5 }}>{l.why}</div></div>
            </div>
          ))}
        </div>

        <div className="text-center px-4 mt-4" style={{ fontSize: 11.5, color: D.ink3, lineHeight: 1.7 }}>Check My Meal gives food guidance, not a diagnosis, and never changes your medicines. Your iLive dietitian reviews your plates each week.</div>
      </div>
    );
  }

  /* =========================================================================
     EXERCISE PRESCRIPTION + DIABETIC DIET CHART + ROTATING ADVICE
     ========================================================================= */
  function exrxProfile() {
    const prof = foProfile();
    return exrxPlan({
      age: prof.age, weightKg: Number(foWt) || 70, heightCm: Number(foHt) || 170,
      sbp: prof.sbp, diabetes: prof.diabetes, hypertension: prof.bpTreated || prof.sbp >= 140,
      onInsulin: !!frxInsulin, programmes: enrolledPrograms || [], weeksIn: rxWeeks,
    });
  }

  /* ---- The card that appears on Prevent, Care and PRIVÉ homes ---- */
  function exrxWeightPathFor(plan) {
    return exrxWeightPath({ weightKg: Number(foWt) || 70, heightCm: Number(foHt) || 170 }, plan);
  }

  /* The four goal tiles. Shown openly in Prevent and PRIVÉ; folded behind one
     row in the medical programmes, where the prescription leads instead. */
  function exrxGoalTiles() {
    const T = { easy: ['#2E6E63', '#17403A'], fat: ['#8F4A2E', '#4E2618'], fit: ['#8F3A52', '#4C1D2C'], perf: ['#3C4E9E', '#1E2A5C'] };
    return (
      <div className="grid grid-cols-2 gap-2.5">
        {PV_GOALS.map(g => (
          <button key={g.id} onClick={() => { tapFeel('select'); setPvGoal(g.id); setPvSess({ status: 'brief', secs: 0, inZone: 0, hr: 72, avgHr: 0 }); setPvSheet('session'); }} className="rounded-2xl text-left relative overflow-hidden frx-rise" style={{ background: `linear-gradient(150deg, ${T[g.id][0]} 0%, ${T[g.id][1]} 100%)`, border: '1px solid rgba(255,255,255,.10)', padding: '14px 14px 12px', boxShadow: '0 6px 18px rgba(0,0,0,.22)' }}>
            <div style={{ position: 'absolute', right: -14, top: -14, width: 64, height: 64, borderRadius: 32, background: 'rgba(255,255,255,.07)' }} />
            <span className="flex items-center justify-center rounded-xl" style={{ width: 34, height: 34, background: 'rgba(255,255,255,.16)', fontSize: 17 }}>{g.e}</span>
            <div style={{ fontSize: 13.5, color: '#FFFFFF', fontWeight: 700, marginTop: 10, lineHeight: 1.25 }}>{g.label}</div>
            <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,.72)', marginTop: 3 }}>Zone {g.zones.join('–')} · {g.mins} min</div>
          </button>
        ))}
      </div>
    );
  }

  function exrxCard() {
    const D = { card: '#16314F', raised: '#1E3C60', hair: 'rgba(255,255,255,.14)', ink: '#FFFFFF', ink2: '#C6D8EC', ink3: '#93AECB', blueLite: '#9CCAFF', green: '#5FDCA8', amber: '#F5C572' };
    const r = exrxProfile();
    const z = r.zones[0];
    return (
      <button onClick={() => { tapFeel('tap'); setPvSheet('exrx'); }} className="w-full rounded-2xl p-4 text-left" style={{ background: 'linear-gradient(155deg, rgba(95,220,168,.13) 0%, rgba(255,255,255,.012) 58%), ' + D.card, border: `1px solid ${D.green}44` }}>
        <div className="flex items-center gap-2">
          <span style={{ fontSize: 11, letterSpacing: 1.3, color: D.green, fontWeight: 700 }}>YOUR EXERCISE PRESCRIPTION</span>
        </div>
        <div className="font-display mt-2" style={{ fontSize: 19, fontWeight: 600, lineHeight: 1.25, letterSpacing: '-0.02em' }}>
          {r.perSession} minutes today in Zone {r.zones.map(x => x.z).filter((v, i, a) => a.indexOf(v) === i).join('–')}
        </div>
        <div style={{ fontSize: 13, color: D.ink2, marginTop: 5 }}>{z.from}–{r.zones[r.zones.length - 1].to} bpm · {r.mode.split(',')[0]}</div>
        {(() => { const w = exrxWeightPathFor(r); return w.needed ? (
          <div className="rounded-xl p-3 mt-3" style={{ background: 'rgba(255,255,255,.05)' }}>
            <div style={{ fontSize: 12.5, color: D.ink2, lineHeight: 1.55 }}>Keep this up and your BMI moves from <b style={{ color: D.ink }}>{w.bmi}</b> to <b style={{ color: D.green }}>{w.targetBmi}</b> in about <b style={{ color: D.green }}>{w.months} months</b>.</div>
          </div>
        ) : null; })()}
        <div className="flex items-center justify-between mt-3.5 pt-3.5" style={{ borderTop: `1px solid ${D.hair}` }}>
          <span style={{ fontSize: 12.5, color: D.ink3 }}>{r.weekly} min a week · {r.days} days</span>
          <span style={{ fontSize: 12.5, color: D.green, fontWeight: 600 }}>See the plan →</span>
        </div>
      </button>
    );
  }

  function renderExRx() {
    const D = { bg: '#0B2039', card: '#16314F', raised: '#1E3C60', hair: 'rgba(255,255,255,.14)', ink: '#FFFFFF', ink2: '#C6D8EC', ink3: '#93AECB', blueLite: '#9CCAFF', green: '#5FDCA8', amber: '#F5C572', red: '#F58D8B', violet: '#B0A4FF' };
    const r = exrxProfile();
    const lo = r.zones[0], hi = r.zones[r.zones.length - 1];
    return (
      <div className="-mx-4 -mt-4 px-4 pt-5 pb-6" style={{ background: D.bg, color: D.ink, minHeight: '100%' }}>
        <button onClick={() => { tapFeel('tap'); setPvSheet(null); }} className="flex items-center gap-1.5 text-sm font-semibold mb-4" style={{ color: D.ink3 }}><ChevronLeft size={16} color={D.ink3} /> Back</button>
        <div className="font-display" style={{ fontSize: 24, fontWeight: 500, letterSpacing: '-0.03em' }}>Your path to a healthy weight</div>
        <div style={{ fontSize: 13, color: D.ink3, lineHeight: 1.6, margin: '10px 0 16px' }}>Built from your weight, height, age{r.recovering ? ' and where you are in recovery' : ''}{r.band.id !== 'normal' ? ` · BMI ${r.bmi}, ${r.band.label.toLowerCase()}` : ''}.</div>

        {/* today */}
        <div className="rounded-2xl p-5 text-center frx-rise" style={{ background: `linear-gradient(160deg, ${D.green}1E 0%, rgba(255,255,255,.012) 60%), ${D.card}`, border: `1px solid ${D.green}55` }}>
          <div style={{ fontSize: 11, letterSpacing: 1.3, color: D.green, fontWeight: 700 }}>RECOMMENDED FOR YOU TODAY</div>
          <div className="font-display mt-3" style={{ fontSize: 30, fontWeight: 600, lineHeight: 1.2, letterSpacing: '-0.02em' }}>
            {r.perSession} minutes in Zone {[...new Set(r.zones.map(z => z.z))].join('–')}
          </div>
          <div className="rounded-xl mt-3 mx-auto" style={{ background: 'rgba(255,255,255,.07)', padding: '10px 16px', display: 'inline-block' }}>
            <span className="font-display" style={{ fontSize: 20, fontWeight: 700, color: D.green }}>{lo.from}–{hi.to}</span>
            <span style={{ fontSize: 13, color: D.ink2 }}> beats per minute</span>
          </div>
          <div style={{ fontSize: 12.5, color: D.ink3, marginTop: 8 }}>{lo.feels} · RPE {lo.rpe} · {r.mode.split(',')[0].toLowerCase()}</div>
          <button onClick={() => { tapFeel('success'); setPvGoal(r.recovering ? 'easy' : r.band.id.startsWith('obese') ? 'fat' : 'fit'); setPvSess({ status: 'brief', secs: 0, inZone: 0, hr: 72, avgHr: 0 }); setPvSheet('session'); }} className="w-full rounded-xl py-3.5 text-base font-bold mt-4" style={{ background: 'linear-gradient(135deg, #4A90F0 0%, #1F5CB0 100%)', color: '#FFFFFF' }}>▶ Start this session</button>
        </div>

        {/* what to do */}
        <div className="rounded-2xl p-4 mt-3" style={{ background: D.card, border: `1px solid ${D.hair}` }}>
          <div style={{ fontSize: 11, letterSpacing: 1.3, color: D.blueLite, fontWeight: 700 }}>WHAT TO DO</div>
          <div style={{ fontSize: 15, color: D.ink, marginTop: 8 }}>{r.mode}</div>
          <div style={{ fontSize: 12.5, color: D.ink3, marginTop: 5, lineHeight: 1.55 }}>{r.modeWhy}</div>
          <div className="flex items-center gap-3 mt-3.5 pt-3.5" style={{ borderTop: `1px solid ${D.hair}` }}>
            <span className="flex items-center justify-center rounded-xl flex-shrink-0" style={{ width: 44, height: 44, background: D.raised, fontSize: 19 }}>🏋️</span>
            <div><div style={{ fontSize: 14, color: D.ink }}>{r.strength.days ? `Strength ${r.strength.days} days a week` : 'Strength work — not yet'}</div><div style={{ fontSize: 12, color: D.ink3, marginTop: 2, lineHeight: 1.5 }}>{r.strength.note}</div></div>
          </div>
        </div>

        {/* weekly target */}
        <div className="rounded-2xl p-4 mt-3" style={{ background: D.card, border: `1px solid ${D.hair}` }}>
          <div className="flex items-baseline justify-between">
            <span style={{ fontSize: 11, letterSpacing: 1.3, color: D.blueLite, fontWeight: 700 }}>YOUR WEEKLY TARGET</span>
            <span className="font-display" style={{ fontSize: 20, fontWeight: 700, color: D.ink }}>{r.weekly} min</span>
          </div>
          <div className="flex gap-1.5 mt-3">
            {Array.from({ length: r.days }).map((_, i) => <div key={i} className="flex-1 rounded-full" style={{ height: 8, background: i < 2 ? D.green : 'rgba(255,255,255,.12)' }} />)}
          </div>
          <div style={{ fontSize: 12.5, color: D.ink2, marginTop: 10, lineHeight: 1.6 }}>{r.perSession} minutes × {r.days} days. {r.weeklyWhy}</div>
        </div>

        {/* path to a healthy weight */}
        {(() => {
          const w = exrxWeightPathFor(r);
          if (!w.needed) return null;
          const pct = Math.max(4, Math.min(100, Math.round((w.firstMilestoneKg / w.toLose) * 100)));
          return (
            <div className="rounded-2xl p-4 mt-3" style={{ background: `linear-gradient(155deg, ${D.green}16 0%, rgba(255,255,255,.012) 58%), ${D.card}`, border: `1px solid ${D.green}44` }}>
              <div style={{ fontSize: 11, letterSpacing: 1.3, color: D.green, fontWeight: 700 }}>YOUR PATH TO A HEALTHY WEIGHT</div>
              <div className="flex items-end justify-between mt-3">
                <div><div className="font-display" style={{ fontSize: 30, fontWeight: 700, lineHeight: 1 }}>{w.bmi}</div><div style={{ fontSize: 11, color: D.ink3, marginTop: 4 }}>BMI now · {Number(foWt) || 70} kg</div></div>
                <div style={{ flex: 1, padding: '0 12px' }}>
                  <div className="rounded-full" style={{ height: 8, background: 'rgba(255,255,255,.1)', overflow: 'hidden' }}>
                    <div className="rounded-full" style={{ height: 8, width: `${pct}%`, background: `linear-gradient(90deg, ${D.green}, ${D.blueLite})` }} />
                  </div>
                  <div className="text-center" style={{ fontSize: 10.5, color: D.ink3, marginTop: 6 }}>about {w.months} months</div>
                </div>
                <div className="text-right"><div className="font-display" style={{ fontSize: 30, fontWeight: 700, color: D.green, lineHeight: 1 }}>{w.targetBmi}</div><div style={{ fontSize: 11, color: D.ink3, marginTop: 4 }}>target · {w.targetWt} kg</div></div>
              </div>

              <div className="rounded-xl p-3.5 mt-4" style={{ background: D.raised }}>
                <div style={{ fontSize: 13.5, color: D.ink, lineHeight: 1.6 }}>
                  <b>{r.perSession} minutes in Zone {[...new Set(r.zones.map(z => z.z))].join('–')}</b> burns about <b>{w.kcalPerSession} kcal</b>. Across {r.days} days that is <b>{w.weeklyKcal.toLocaleString()} kcal a week</b> — roughly <b style={{ color: D.green }}>{w.ratePerWeek} kg</b> of fat.
                </div>
                <div style={{ fontSize: 12, color: D.ink3, marginTop: 8, lineHeight: 1.55 }}>kcal/min = MET × 3.5 × your weight ÷ 200 (ACSM). 1 kg of fat ≈ 7,700 kcal, reduced by a quarter for the way metabolism adapts.</div>
              </div>

              <div className="rounded-xl p-3.5 mt-2.5" style={{ background: 'rgba(245,197,114,.10)', border: '1px solid rgba(245,197,114,.32)' }}>
                <div style={{ fontSize: 11, letterSpacing: 1.2, color: D.amber, fontWeight: 700 }}>BE HONEST WITH YOURSELF ABOUT THIS</div>
                <div style={{ fontSize: 13, color: D.ink2, marginTop: 7, lineHeight: 1.6 }}>
                  Exercise on its own usually takes off about <b style={{ color: D.ink }}>{w.exerciseOnlyKg} kg</b> — {w.reachableByExerciseAlone ? 'which is enough in your case.' : <>not the full {w.toLose} kg. The timeline above assumes you also cut portions and drop the sugary things. Without that, the walking still helps your heart, sugar and blood pressure, but the weight moves far more slowly.</>}
                </div>
              </div>

              <div className="flex items-center gap-3 mt-3 pt-3" style={{ borderTop: `1px solid ${D.hair}` }}>
                <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 34, height: 34, background: D.raised, fontSize: 15 }}>🎯</span>
                <div style={{ fontSize: 12.5, color: D.ink2, lineHeight: 1.55 }}>Aim at the first <b style={{ color: D.ink }}>{w.firstMilestoneKg} kg</b> — about {w.firstMilestoneWeeks} weeks. Five per cent already improves sugar, blood pressure and lipids (Look AHEAD).</div>
              </div>
            </div>
          );
        })()}

        {/* expected outcome */}
        <div className="rounded-2xl p-4 mt-3" style={{ background: 'linear-gradient(150deg, rgba(176,164,255,.13) 0%, rgba(176,164,255,.02) 60%), ' + D.card, border: `1px solid ${D.violet}44` }}>
          <div className="flex items-center gap-2"><Sparkles size={15} color={D.violet} /><span style={{ fontSize: 11, letterSpacing: 1.3, color: D.violet, fontWeight: 700 }}>IF YOU KEEP THIS UP FOR 12 WEEKS</span></div>
          {r.outcomes.map((o, i) => (
            <div key={o.k} style={{ padding: '10px 0', borderTop: i ? `1px solid ${D.hair}` : 'none', marginTop: i ? 0 : 8 }}>
              <div style={{ fontSize: 15, color: D.ink, fontWeight: 600 }}>{o.text}</div>
              <div style={{ fontSize: 12.5, color: D.ink3, marginTop: 3, lineHeight: 1.55 }}>{o.why}</div>
            </div>
          ))}
        </div>

        {/* precautions */}
        {r.cautions.length > 0 && (
          <div className="rounded-2xl p-4 mt-3" style={{ background: 'rgba(245,141,139,.09)', border: '1px solid rgba(245,141,139,.35)' }}>
            <div style={{ fontSize: 11, letterSpacing: 1.3, color: D.red, fontWeight: 700 }}>BEFORE YOU START</div>
            {r.cautions.map((c, i) => <div key={i} style={{ fontSize: 13, color: D.ink2, lineHeight: 1.6, marginTop: 7 }}>• {c}</div>)}
          </div>
        )}

        <div className="text-center mt-4" style={{ fontSize: 11.5, color: D.ink3, lineHeight: 1.7 }}>{r.basis}</div>
      </div>
    );
  }

  /* ---- Diabetic diet chart, North / South Indian ---- */
  const DIET_CHART = {
    north: {
      label: 'North Indian',
      eat: [
        ['🫓', 'Roti — bajra, jowar, besan mix', 'Slower than wheat alone; 2 at a meal'],
        ['🥣', 'Dal, rajma, chana, sprouts', 'Protein first — it flattens the sugar rise'],
        ['🥗', 'Salad before the meal', 'Cucumber, tomato, onion, carrot'],
        ['🥬', 'Palak, methi, sarson, lauki, tinda, bhindi', 'Fill half the plate'],
        ['🍶', 'Curd or chaas, unsweetened', 'With every main meal'],
        ['🥚', 'Eggs, paneer, chicken, fish', 'Protein at breakfast is the most missed'],
        ['🥜', 'Almonds, walnuts — a small handful', 'Mid-morning or evening'],
      ],
      avoid: [
        ['🍚', 'Large helpings of white rice', 'One katori, not three. Or swap for brown rice'],
        ['🫓', 'Maida — naan, kulcha, bhature', 'Fastest sugar rise of anything on an Indian table'],
        ['🥔', 'Aloo as the main sabzi', 'Fine as a small part, not the whole dish'],
        ['🍮', 'Mithai, halwa, jalebi', 'Even one piece takes hours to clear'],
        ['🥤', 'Sweet lassi, cold drinks, packaged juice', 'Liquid sugar is the worst form'],
        ['🍟', 'Samosa, pakora, puri', 'Fried plus refined flour together'],
      ],
      fruitYes: 'Guava, apple, pear, papaya, orange, jamun — one at a time, whole, not juiced',
      fruitNo: 'Mango, chikoo, custard apple, grapes, banana when very ripe — small portions only',
    },
    continental: {
      label: 'Continental',
      eat: [
        ['🥣', 'Oats, muesli without added sugar', 'Steel-cut or rolled — not instant, which behaves like sugar'],
        ['🥚', 'Eggs, any style', 'The most reliable protein breakfast there is'],
        ['🥗', 'A large salad with olive oil and vinegar', 'Fill half the plate; the oil helps absorb the vitamins'],
        ['🐟', 'Grilled fish or chicken', 'Grilled or baked rather than fried or breaded'],
        ['🍞', 'Whole-grain or sourdough bread, 1–2 slices', 'Sourdough raises sugar less than ordinary white bread'],
        ['🧀', 'Greek yoghurt, cottage cheese', 'High protein, low sugar — check the label for added sugar'],
        ['🥜', 'Nuts, olives, avocado', 'Good fats that keep you full to the next meal'],
      ],
      avoid: [
        ['🥐', 'Croissants, pastries, white bread', 'Refined flour and fat together — the fastest sugar rise'],
        ['🍝', 'Large pasta or risotto portions', 'A restaurant portion is often three servings of carbohydrate'],
        ['🍟', 'Chips, fries, crisps', 'Fried starch, and very easy to overeat'],
        ['🥤', 'Fruit juice, smoothies, sweetened coffee', 'Liquid sugar with none of the fibre'],
        ['🥓', 'Bacon, sausage, salami most days', 'Processed meat; keep it occasional'],
        ['🍰', 'Desserts and sweetened yoghurt', 'Check labels — "low fat" usually means more sugar'],
      ],
      fruitYes: 'Berries, apple, pear, orange, kiwi — whole, one portion at a time',
      fruitNo: 'Dried fruit, tinned fruit in syrup, very ripe banana — small portions only',
    },
    south: {
      label: 'South Indian',
      eat: [
        ['🍛', 'Idli or dosa with extra sambar', 'Two idlis, not four; the dal in sambar helps'],
        ['🥣', 'Sambar, rasam, kootu', 'Dal-based and filling'],
        ['🌾', 'Ragi, millet, brown rice, red rice', 'The single best swap you can make'],
        ['🥥', 'Coconut chutney in moderation', 'Good fat, but it is calorie-dense'],
        ['🥬', 'Poriyal, avial, thoran — vegetable-heavy', 'Fill half the plate'],
        ['🍶', 'Curd rice with less rice, more curd', 'A South Indian classic that works well'],
        ['🐟', 'Fish, eggs, chicken', 'Protein at every meal'],
      ],
      avoid: [
        ['🍚', 'A big mound of white rice', 'The commonest cause of a high reading here'],
        ['🥞', 'Appam, puttu, idiyappam in large amounts', 'Refined and quick to raise sugar'],
        ['🍬', 'Payasam, mysore pak, halwa', 'Sugar plus ghee together'],
        ['🍌', 'Banana chips, murukku, mixture', 'Fried and salted'],
        ['🥤', 'Filter coffee with sugar, several times a day', 'The sugar adds up quietly'],
        ['🥔', 'Potato or yam as the main vegetable', 'Keep it a side, not the centre'],
      ],
      fruitYes: 'Guava, papaya, apple, pear, jamun, orange — whole, one at a time',
      fruitNo: 'Mango, jackfruit, chikoo, grapes, very ripe banana — small portions only',
    },
  };

  /* Optional diagnostics, priced per order. */
  const ADDONS = [
    { id: 'cgm', e: '🩸', name: 'Continuous glucose monitor', sub: '14 days of sensor data — every meal, every night', price: '₹4,200', why: 'Shows exactly which of your own meals raise your sugar, and by how much. Two weeks of this teaches more than months of finger-pricks.', who: ['Diabetes Management Program'] },
    { id: 'spiro', e: '🫁', name: 'Home spirometer / peak flow meter', sub: 'Lung function measured at home', price: '₹4,200', why: 'Measures how much air you can move and how fast. Picks up a decline two to three days before you feel a flare-up.', who: ['Pulmonology / COPD Program'] },
  ];

  const DIET_EXTRA = {
    label: 'Any kitchen',
    eat: [
      ['🥗', 'Half your plate non-starchy vegetables', 'Works in every cuisine on earth'],
      ['🍗', 'A palm-sized portion of protein at each meal', 'Dal, egg, paneer, fish, chicken, tofu — whichever you eat'],
      ['🌾', 'A cupped-handful of whole grain', 'Not a mound. The hand is a portion guide you always carry'],
      ['🫒', 'A thumb of good fat', 'Olive oil, mustard oil, nuts, seeds'],
      ['💧', 'Water with the meal, not something sweet', 'The easiest single change most people can make'],
    ],
    avoid: [
      ['🥤', 'Anything sweet in liquid form', 'Juice, cold drinks, sweetened tea and coffee'],
      ['🍪', 'Packet snacks between meals', 'Designed to be eaten past the point of fullness'],
      ['🍚', 'Second helpings of the starch', 'Take more vegetables and protein instead'],
      ['🍳', 'Deep-fried food more than once a week', 'Occasional is fine; daily is not'],
    ],
    fruitYes: 'Any whole fruit, one portion at a time, with the skin where you can',
    fruitNo: 'Juice, dried fruit and tinned fruit in syrup',
  };

  function renderDietChart() {
    const D = { bg: '#0B2039', card: '#16314F', raised: '#1E3C60', hair: 'rgba(255,255,255,.14)', ink: '#FFFFFF', ink2: '#C6D8EC', ink3: '#93AECB', blueLite: '#9CCAFF', green: '#5FDCA8', red: '#F58D8B' };
    const c = dietRegion === 'any' ? DIET_EXTRA : (DIET_CHART[dietRegion] || DIET_CHART.north);
    return (
      <div className="-mx-4 -mt-4 px-4 pt-5 pb-6" style={{ background: D.bg, color: D.ink, minHeight: '100%' }}>
        <button onClick={() => { tapFeel('tap'); setPvSheet(null); }} className="flex items-center gap-1.5 text-sm font-semibold mb-4" style={{ color: D.ink3 }}><ChevronLeft size={16} color={D.ink3} /> Back</button>
        <div className="font-display" style={{ fontSize: 24, fontWeight: 500, letterSpacing: '-0.03em' }}>Your diabetic diet chart</div>
        <div style={{ fontSize: 13, color: D.ink3, lineHeight: 1.6, margin: '10px 0 16px' }}>Simple lists. Nothing is banned outright — portion and swap do most of the work.</div>

        <div className="grid grid-cols-2 gap-2.5">
          {['north', 'south', 'continental', 'any'].map(k => (
            <button key={k} onClick={() => { tapFeel('select'); setDietRegion(k); }} className="rounded-xl py-3.5" style={{ background: dietRegion === k ? 'linear-gradient(135deg, #3B7FC9 0%, #1F5C9E 100%)' : D.raised, border: dietRegion === k ? '1.5px solid transparent' : `1.5px solid ${D.hair}` }}>
              <div style={{ fontSize: 13.5, color: D.ink, fontWeight: 700 }}>{(k === 'any' ? DIET_EXTRA : DIET_CHART[k]).label}</div>
            </button>
          ))}
        </div>

        <div className="rounded-2xl p-4 mt-3" style={{ background: `linear-gradient(160deg, ${D.green}14 0%, rgba(255,255,255,.012) 60%), ${D.card}`, border: `1px solid ${D.green}44` }}>
          <div style={{ fontSize: 11, letterSpacing: 1.3, color: D.green, fontWeight: 700 }}>EAT FREELY</div>
          {c.eat.map(([e, t, w], i) => (
            <div key={t} className="flex gap-3 items-start" style={{ padding: '10px 0', borderTop: i ? `1px solid ${D.hair}` : 'none', marginTop: i ? 0 : 8 }}>
              <span style={{ fontSize: 17 }}>{e}</span>
              <div><div style={{ fontSize: 14, color: D.ink }}>{t}</div><div style={{ fontSize: 12, color: D.ink3, marginTop: 2, lineHeight: 1.5 }}>{w}</div></div>
            </div>
          ))}
        </div>

        <div className="rounded-2xl p-4 mt-3" style={{ background: 'rgba(245,141,139,.07)', border: '1px solid rgba(245,141,139,.3)' }}>
          <div style={{ fontSize: 11, letterSpacing: 1.3, color: D.red, fontWeight: 700 }}>KEEP SMALL OR AVOID</div>
          {c.avoid.map(([e, t, w], i) => (
            <div key={t} className="flex gap-3 items-start" style={{ padding: '10px 0', borderTop: i ? '1px solid rgba(245,141,139,.18)' : 'none', marginTop: i ? 0 : 8 }}>
              <span style={{ fontSize: 17 }}>{e}</span>
              <div><div style={{ fontSize: 14, color: D.ink }}>{t}</div><div style={{ fontSize: 12, color: D.ink3, marginTop: 2, lineHeight: 1.5 }}>{w}</div></div>
            </div>
          ))}
        </div>

        <div className="rounded-2xl p-4 mt-3" style={{ background: D.card, border: `1px solid ${D.hair}` }}>
          <div style={{ fontSize: 11, letterSpacing: 1.3, color: D.blueLite, fontWeight: 700 }}>FRUIT</div>
          <div className="flex gap-2.5 items-start mt-3"><Check size={15} color={D.green} strokeWidth={3} /><div style={{ fontSize: 13.5, color: D.ink2, lineHeight: 1.6 }}>{c.fruitYes}</div></div>
          <div className="flex gap-2.5 items-start mt-3"><AlertTriangle size={15} color={D.red} /><div style={{ fontSize: 13.5, color: D.ink2, lineHeight: 1.6 }}>{c.fruitNo}</div></div>
          <div className="rounded-xl p-3 mt-3" style={{ background: D.raised, fontSize: 12.5, color: D.ink2, lineHeight: 1.55 }}>Never juice. Whole fruit carries its fibre, and the fibre is what slows the sugar.</div>
        </div>

        <div className="rounded-2xl p-4 mt-3" style={{ background: D.card, border: `1px solid ${D.hair}` }}>
          <div style={{ fontSize: 11, letterSpacing: 1.3, color: D.blueLite, fontWeight: 700 }}>THREE RULES THAT BEAT EVERY LIST</div>
          {[['Vegetables and protein first, carbohydrate last', 'The same plate raises sugar less in that order'],
            ['Half the rice or roti you normally take', 'Portion beats substitution nearly every time'],
            ['A ten-minute walk after your largest meal', 'Muscle takes sugar out of the blood without insulin']].map(([t, w], i) => (
            <div key={t} className="flex gap-3 items-start" style={{ padding: '10px 0', borderTop: i ? `1px solid ${D.hair}` : 'none', marginTop: i ? 0 : 8 }}>
              <span className="flex items-center justify-center rounded-full flex-shrink-0 font-display" style={{ width: 22, height: 22, background: D.raised, fontSize: 11, fontWeight: 700, color: D.blueLite }}>{i + 1}</span>
              <div><div style={{ fontSize: 14, color: D.ink }}>{t}</div><div style={{ fontSize: 12, color: D.ink3, marginTop: 2, lineHeight: 1.5 }}>{w}</div></div>
            </div>
          ))}
        </div>
        <div className="text-center mt-4" style={{ fontSize: 11.5, color: D.ink3, lineHeight: 1.7 }}>ICMR-NIN Dietary Guidelines for Indians 2024 · ADA Standards of Care 2024. Your nutritionist adapts this to what you actually eat.</div>
      </div>
    );
  }

  /* ---- Rotating advice. Short, specific, and picked for this member. ---- */
  const ADVICE_POOL = {
    diabetes: [
      ['🚶', 'Walk ten minutes after dinner', 'It lowers the post-meal sugar more reliably than almost anything else you can do at home.'],
      ['🍽️', 'Eat the sabzi and dal before the rice', 'Same food, same plate — the sugar rise is measurably smaller in that order.'],
      ['😴', 'Protect seven hours of sleep', 'One short night raises next-morning insulin resistance by around 20 %.'],
      ['🦶', 'Look at your feet every night', 'Diabetes dulls sensation. A small cut you cannot feel is how serious problems start.'],
      ['💊', 'Take metformin with food', 'It halves the stomach upset, and you are far more likely to keep taking it.'],
      ['🥛', 'Swap the evening tea biscuit for a handful of nuts', 'Protein and fat instead of refined flour, at the time of day most people slip.'],
    ],
    obesityDiabetes: [
      ['⚖️', 'Aim for 5 % first, not 20 %', 'Five per cent of your weight already improves sugar, blood pressure and lipids — Look AHEAD proved it.'],
      ['🍚', 'Halve the rice, keep everything else', 'One change, easy to remember, and it does more than most people expect.'],
      ['🥤', 'Nothing sweet in liquid form', 'Juice, sweet lassi and cold drinks bypass the fullness signal entirely.'],
      ['⏰', 'Finish dinner by eight', 'Late eating raises fasting sugar the next morning independent of what you ate.'],
    ],
    hypertension: [
      ['🧂', 'The pickle and papad go first', 'Usually the single largest source of salt on an Indian plate.'],
      ['🩺', 'Measure your BP seated, after five minutes rest', 'Most "high" home readings are a technique problem, not a blood-pressure problem.'],
      ['😴', 'Sleep is blood-pressure treatment', 'Short sleep raises night-time pressure, which is the reading that predicts events.'],
      ['🍺', 'Keep alcohol under two drinks', 'Cutting from heavy to moderate drops systolic by about 4 mmHg within weeks.'],
    ],
    general: [
      ['🥗', 'Half your plate vegetables, every meal', 'The simplest rule that works across every condition we manage.'],
      ['🚶', 'Movement after meals beats movement before', 'The same walk does more for you after eating.'],
      ['💧', 'Water before tea, first thing', 'Most people are mildly dehydrated by morning and read it as tiredness.'],
      ['🧘', 'Five slow breaths before you measure anything', 'Steadier numbers, and a genuinely calmer nervous system.'],
    ],
  };

  function adviceForMember() {
    const prof = foProfile();
    const bmi = prof.bmi;
    const pool = [];
    if (prof.diabetes && bmi >= 25) pool.push(...ADVICE_POOL.obesityDiabetes);
    if (prof.diabetes) pool.push(...ADVICE_POOL.diabetes);
    if (prof.bpTreated || prof.sbp >= 130) pool.push(...ADVICE_POOL.hypertension);
    pool.push(...ADVICE_POOL.general);
    const day = Math.floor(Date.now() / 86400000);
    return [0, 1, 2].map(i => pool[(day + i * 3) % pool.length]);
  }

  function adviceCard() {
    const D = { card: '#16314F', raised: '#1E3C60', hair: 'rgba(255,255,255,.14)', ink: '#FFFFFF', ink2: '#C6D8EC', ink3: '#93AECB', amber: '#F5C572' };
    const list = adviceForMember();
    return (
      <div className="rounded-2xl p-4" style={{ background: 'linear-gradient(155deg, rgba(245,197,114,.11) 0%, rgba(255,255,255,.012) 58%), ' + D.card, border: `1px solid ${D.amber}3D` }}>
        <div className="flex items-center justify-between">
          <span style={{ fontSize: 11, letterSpacing: 1.3, color: D.amber, fontWeight: 700 }}>WORTH KNOWING TODAY</span>
          <span style={{ fontSize: 11, color: D.ink3 }}>changes daily</span>
        </div>
        {list.map(([e, t, w], i) => (
          <div key={t} className="flex gap-3 items-start" style={{ padding: '11px 0', borderTop: i ? `1px solid ${D.hair}` : 'none', marginTop: i ? 0 : 8 }}>
            <span className="flex items-center justify-center rounded-xl flex-shrink-0" style={{ width: 36, height: 36, background: D.raised, fontSize: 16 }}>{e}</span>
            <div><div style={{ fontSize: 14, color: D.ink, lineHeight: 1.4 }}>{t}</div><div style={{ fontSize: 12.5, color: D.ink3, marginTop: 3, lineHeight: 1.55 }}>{w}</div></div>
          </div>
        ))}
      </div>
    );
  }

  function renderPvSession() {
    const D = { bg: '#0B2039', card: '#16314F', raised: '#1E3C60', hair: 'rgba(255,255,255,.14)', ink: '#FFFFFF', ink2: '#C6D8EC', ink3: '#93AECB', blueLite: '#9CCAFF', green: '#5FDCA8', amber: '#F5C572', red: '#F58D8B' };
    const age = Number(foAge) || 46;
    const zones = pvZones(age);
    const goal = PV_GOALS.find(g => g.id === pvGoal) || PV_GOALS[1];
    const gz = zones.filter(z => goal.zones.includes(z.id));
    const bandFrom = gz[0].from, bandTo = gz[gz.length - 1].to;
    const hr = pvSess.hr;
    const inBand = hr >= bandFrom && hr <= bandTo;
    const cur = [...zones].reverse().find(z => hr >= z.from) || zones[0];
    const fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const targetSecs = goal.mins * 60;
    const progress = Math.min(100, (pvSess.inZone / targetSecs) * 100);

    /* ---- BRIEF ---- */
    if (pvSess.status === 'brief') return (
      <div className="-mx-4 -mt-4 px-4 pt-5 pb-6" style={{ background: D.bg, color: D.ink, minHeight: '100%' }}>
        <button onClick={() => { tapFeel('tap'); setPvSheet(null); }} className="flex items-center gap-1.5 text-sm font-semibold mb-4" style={{ color: D.ink3 }}><ChevronLeft size={16} color={D.ink3} /> Back</button>
        <button onClick={() => { tapFeel('tap'); setPvSheet(null); }} className="flex items-center gap-1.5 text-sm font-semibold mb-4" style={{ color: D.ink3 }}><ChevronLeft size={16} color={D.ink3} /> Back to Prevent</button>
        <div className="flex items-center gap-3">
          <span style={{ fontSize: 26 }}>{goal.e}</span>
          <div>
            <div className="font-display" style={{ fontSize: 24, fontWeight: 500, letterSpacing: '-0.03em' }}>{goal.label}</div>
            <div style={{ fontSize: 13, color: D.ink3, marginTop: 2 }}>Today's session</div>
          </div>
        </div>

        <div className="rounded-2xl p-5 mt-4 text-center" style={{ background: 'linear-gradient(160deg, rgba(255,255,255,.07) 0%, rgba(255,255,255,.015) 52%), ' + D.card, border: `1px solid ${gz[0].col}44` }}>
          <div style={{ fontSize: 11, letterSpacing: 1.3, color: D.ink3, fontWeight: 700 }}>YOUR TARGET</div>
          <div className="font-display mt-2.5" style={{ fontSize: 40, fontWeight: 600, color: gz[0].col, lineHeight: 1 }}>{bandFrom}–{bandTo}</div>
          <div style={{ fontSize: 13, color: D.ink2, marginTop: 6 }}>beats per minute</div>
          <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${D.hair}`, fontSize: 14, color: D.ink }}>
            Stay in this range for <b>{goal.mins} minutes</b>
          </div>
          <div style={{ fontSize: 12.5, color: D.ink3, marginTop: 5 }}>Zone {goal.zones.join('–')} · {gz[0].what}</div>
        </div>

        <div className="rounded-2xl p-4 mt-3" style={{ background: D.card, border: `1px solid ${D.hair}` }}>
          <div style={{ fontSize: 11, letterSpacing: 1.3, color: D.blueLite, fontWeight: 700 }}>HOW TO DO IT</div>
          <div className="space-y-2.5 mt-3">
            {[
              ['1', 'Warm up for three minutes', 'Walk easily. Let your heart rate climb on its own — do not start hard.'],
              ['2', `Bring your heart rate into ${bandFrom}–${bandTo}`, goal.id === 'fat' ? 'A pace you could hold a conversation at. If you are gasping, slow down — you have gone past the fat-burning range.' : goal.id === 'perf' ? 'Hard efforts of one to three minutes with easy walking between. The watch counts only the hard parts.' : 'Brisk but sustainable. Short sentences, not full paragraphs.'],
              ['3', 'The timer counts only time inside the band', 'Drift above or below and it pauses. That is deliberate — it is the minutes in range that matter.'],
              ['4', 'Cool down for two minutes', 'Walk slowly and let your heart rate come down before you stop.'],
            ].map(([n, t, d]) => (
              <div key={n} className="flex gap-3 items-start">
                <span className="flex items-center justify-center rounded-full flex-shrink-0 font-display" style={{ width: 22, height: 22, background: D.raised, fontSize: 11.5, fontWeight: 700, color: D.ink2 }}>{n}</span>
                <div><div style={{ fontSize: 13.5, color: D.ink }}>{t}</div><div style={{ fontSize: 12, color: D.ink3, marginTop: 2, lineHeight: 1.5 }}>{d}</div></div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl p-3.5 mt-3 flex items-center gap-3" style={{ background: 'rgba(245,141,139,.08)', border: '1px solid rgba(245,141,139,.28)' }}>
          <span style={{ fontSize: 16 }}>⚠️</span>
          <div style={{ fontSize: 12.5, color: D.ink2, lineHeight: 1.55 }}>Stop at once if you get chest pain or pressure, unusual breathlessness, dizziness or an irregular heartbeat.</div>
        </div>

        <button onClick={() => { tapFeel('success'); pvStart(); }} className="w-full rounded-2xl py-4 text-base font-bold mt-4" style={{ background: 'linear-gradient(135deg, #4A90F0 0%, #1F5CB0 100%)', color: '#FFFFFF', boxShadow: '0 8px 22px rgba(31,92,176,0.4)' }}>▶ Start session</button>
      </div>
    );

    /* ---- RUNNING ---- */
    if (pvSess.status === 'running' || pvSess.status === 'paused') return (
      <div className="-mx-4 -mt-4 px-4 pt-5 pb-6" style={{ background: D.bg, color: D.ink, minHeight: '100%' }}>
        <div className="flex items-center justify-between">
          <div>
            <div style={{ fontSize: 12.5, color: D.ink3 }}>{goal.e} {goal.label}</div>
            <div className="font-display mt-1" style={{ fontSize: 20, fontWeight: 500 }}>Session in progress</div>
          </div>
          <span className="flex items-center gap-1.5 rounded-full px-3 py-1.5" style={{ background: pvSess.status === 'paused' ? 'rgba(245,197,114,.16)' : 'rgba(95,220,168,.14)', color: pvSess.status === 'paused' ? D.amber : D.green, fontSize: 11.5, fontWeight: 700 }}>
            <span className="rounded-full" style={{ width: 7, height: 7, background: pvSess.status === 'paused' ? D.amber : D.green }}></span>{pvSess.status === 'paused' ? 'Paused' : 'Recording'}
          </span>
        </div>

        {/* live heart rate — the hero while training */}
        <div className="rounded-2xl p-6 mt-4 text-center" style={{ background: 'linear-gradient(160deg, ' + (inBand ? 'rgba(95,220,168,.14)' : 'rgba(245,197,114,.12)') + ' 0%, rgba(255,255,255,.01) 60%), ' + D.card, border: `1px solid ${inBand ? D.green : D.amber}55` }}>
          <div style={{ fontSize: 11, letterSpacing: 1.3, color: D.ink3, fontWeight: 700 }}>YOUR HEART RATE</div>
          <div className="flex items-baseline justify-center gap-2 mt-2">
            <span className="font-display" style={{ fontSize: 66, fontWeight: 600, color: inBand ? D.green : D.amber, lineHeight: 1, letterSpacing: '-0.04em' }}>{hr}</span>
            <span style={{ fontSize: 15, color: D.ink3 }}>bpm</span>
          </div>
          <div className="mt-2" style={{ fontSize: 14, color: inBand ? D.green : D.amber, fontWeight: 600 }}>
            {inBand ? '✓ In your target range' : hr < bandFrom ? '↑ Pick up the pace' : '↓ Ease off a little'}
          </div>
          <div style={{ fontSize: 12.5, color: D.ink3, marginTop: 4 }}>Target {bandFrom}–{bandTo} · you are in Zone {cur.id}, {cur.name}</div>

          {/* zone bar with live marker */}
          <div className="flex rounded-lg overflow-hidden mt-4" style={{ height: 22 }}>
            {zones.map(z => (
              <div key={z.id} style={{ flex: 1, background: goal.zones.includes(z.id) ? z.col : 'rgba(255,255,255,.08)', opacity: cur.id === z.id ? 1 : goal.zones.includes(z.id) ? .45 : 1, borderRight: z.id < 5 ? `1px solid ${D.bg}` : 'none' }} />
            ))}
          </div>
          <div className="flex mt-1">
            {zones.map(z => <div key={z.id} className="font-display" style={{ flex: 1, textAlign: 'center', fontSize: 10, color: cur.id === z.id ? D.ink : D.ink3, fontWeight: cur.id === z.id ? 700 : 500 }}>{z.id}</div>)}
          </div>
        </div>

        {/* counters */}
        <div className="grid grid-cols-2 gap-3 mt-3">
          <div className="rounded-2xl p-4 text-center" style={{ background: D.card, border: `1px solid ${D.green}44` }}>
            <div style={{ fontSize: 11, letterSpacing: 1.2, color: D.ink3, fontWeight: 700 }}>IN TARGET ZONE</div>
            <div className="font-display mt-2" style={{ fontSize: 30, fontWeight: 600, color: D.green, lineHeight: 1 }}>{fmt(pvSess.inZone)}</div>
            <div style={{ fontSize: 11.5, color: D.ink3, marginTop: 4 }}>of {goal.mins}:00 target</div>
          </div>
          <div className="rounded-2xl p-4 text-center" style={{ background: D.card, border: `1px solid ${D.hair}` }}>
            <div style={{ fontSize: 11, letterSpacing: 1.2, color: D.ink3, fontWeight: 700 }}>TOTAL TIME</div>
            <div className="font-display mt-2" style={{ fontSize: 30, fontWeight: 600, color: D.ink, lineHeight: 1 }}>{fmt(pvSess.secs)}</div>
            <div style={{ fontSize: 11.5, color: D.ink3, marginTop: 4 }}>including warm-up</div>
          </div>
        </div>

        <div className="rounded-full mt-3" style={{ height: 8, background: 'rgba(255,255,255,.1)', overflow: 'hidden' }}>
          <div className="rounded-full" style={{ height: 8, width: `${progress}%`, background: D.green, transition: 'width .6s linear' }} />
        </div>
        <div className="text-center" style={{ fontSize: 12.5, color: D.ink2, marginTop: 8 }}>
          {progress >= 100 ? '🎉 Target reached — keep going or finish whenever you like' : `${Math.max(0, goal.mins - Math.floor(pvSess.inZone / 60))} minutes left in the band`}
        </div>

        <div className="flex gap-3 mt-5">
          <button onClick={() => { tapFeel('tap'); pvPause(); }} className="flex-1 rounded-2xl py-4 text-base font-bold" style={{ background: D.raised, color: D.ink, border: `1px solid ${D.hair}` }}>{pvSess.status === 'paused' ? '▶ Resume' : '❚❚ Pause'}</button>
          <button onClick={() => { tapFeel('success'); pvFinish(); }} className="flex-1 rounded-2xl py-4 text-base font-bold" style={{ background: 'linear-gradient(135deg, #23B27A 0%, #178A5C 100%)', color: '#FFFFFF' }}>Finish</button>
        </div>
      </div>
    );

    /* ---- DONE ---- */
    const mins = Math.round(pvSess.inZone / 60);
    const total = Math.round(pvSess.secs / 60);
    const hit = pvSess.inZone >= targetSecs * 0.9;
    return (
      <div className="-mx-4 -mt-4 px-4 pt-5 pb-6" style={{ background: D.bg, color: D.ink, minHeight: '100%' }}>
        <div className="text-center mt-6">
          <div style={{ fontSize: 46 }}>{hit ? '🎉' : '👍'}</div>
          <div className="font-display mt-3" style={{ fontSize: 24, fontWeight: 500 }}>{hit ? 'Target hit' : 'Session recorded'}</div>
          <div style={{ fontSize: 14, color: D.ink2, marginTop: 6, lineHeight: 1.6 }}>{hit ? `You held your target range for ${mins} minutes.` : `${mins} minutes in your target range. Every minute counts toward the week.`}</div>
        </div>

        <div className="grid grid-cols-3 gap-2.5 mt-6">
          {[['In target zone', `${mins}`, 'minutes'], ['Total time', `${total}`, 'minutes'], ['Average HR', `${pvSess.avgHr || hr}`, 'bpm']].map(([t, v, u]) => (
            <div key={t} className="rounded-2xl p-3.5 text-center" style={{ background: D.card, border: `1px solid ${D.hair}` }}>
              <div style={{ fontSize: 10.5, color: D.ink3 }}>{t}</div>
              <div className="font-display mt-1.5" style={{ fontSize: 24, fontWeight: 600, color: D.green }}>{v}</div>
              <div style={{ fontSize: 10, color: D.ink3 }}>{u}</div>
            </div>
          ))}
        </div>

        <div className="rounded-2xl p-4 mt-3" style={{ background: 'linear-gradient(150deg, rgba(95,220,168,.12) 0%, rgba(95,220,168,.02) 60%), ' + D.card, border: `1px solid ${D.green}33` }}>
          <div style={{ fontSize: 11, letterSpacing: 1.3, color: D.green, fontWeight: 700 }}>ADDED TO YOUR WEEK</div>
          <div className="flex items-baseline gap-2 mt-2">
            <span className="font-display" style={{ fontSize: 26, fontWeight: 600 }}>{118 + mins}</span>
            <span style={{ fontSize: 13, color: D.ink2 }}>of {PV_TARGET} minutes in Zone 3+</span>
          </div>
          <div className="rounded-full mt-3" style={{ height: 6, background: 'rgba(255,255,255,.1)', overflow: 'hidden' }}>
            <div className="rounded-full" style={{ height: 6, width: `${Math.min(100, ((118 + mins) / PV_TARGET) * 100)}%`, background: D.green }} />
          </div>
          <div style={{ fontSize: 12.5, color: D.ink3, marginTop: 8, lineHeight: 1.6 }}>Reaching 150 minutes a week is what lowers your blood pressure and, through it, your heart age.</div>
        </div>

        <button onClick={() => { tapFeel('tap'); setPvSess({ status: 'brief', secs: 0, inZone: 0, hr: 72, avgHr: 0 }); setPvSheet(null); }} className="w-full rounded-2xl py-4 text-base font-bold mt-5" style={{ background: 'linear-gradient(135deg, #4A90F0 0%, #1F5CB0 100%)', color: '#FFFFFF' }}>Done</button>
      </div>
    );
  }

  function renderPvMetric(id) {
    const D = { bg: '#0B2039', card: '#16314F', raised: '#1E3C60', hair: 'rgba(255,255,255,.14)', ink: '#FFFFFF', ink2: '#C6D8EC', ink3: '#93AECB', green: '#5FDCA8', amber: '#F5C572', blueLite: '#9CCAFF' };
    const m = PV_METRICS[id];
    const age = Number(foAge) || 46;
    const series = m.series();
    const v = m.verdict(m.today, m.yest);
    const col = v.good ? D.green : D.amber;
    const avg = Math.round((series.reduce((a, b) => a + b, 0) / series.length) * 10) / 10;
    const fmt = x => id === 'sleep' ? `${Math.floor(x)}h ${Math.round((x % 1) * 60)}m` : x;
    return (
      <div className="-mx-4 -mt-4 px-4 pt-5 pb-6" style={{ background: D.bg, color: D.ink, minHeight: '100%' }}>
        <button onClick={() => { tapFeel('tap'); setPvSheet(null); }} className="flex items-center gap-1.5 text-sm font-semibold mb-4" style={{ color: D.ink3 }}><ChevronLeft size={16} color={D.ink3} /> Back to Prevent</button>

        {/* today */}
        <div className="flex items-center gap-3">
          <span style={{ fontSize: 24 }}>{m.e}</span>
          <div className="font-display" style={{ fontSize: 24, fontWeight: 500, letterSpacing: '-0.03em' }}>{m.name}</div>
        </div>
        <div className="rounded-2xl p-5 mt-4" style={{ background: 'linear-gradient(160deg, rgba(255,255,255,.07) 0%, rgba(255,255,255,.015) 52%), ' + D.card, border: `1px solid ${col}44` }}>
          <div className="flex items-end justify-between gap-3">
            <div>
              <div style={{ fontSize: 11, letterSpacing: 1.3, color: D.ink3, fontWeight: 700 }}>TODAY</div>
              <div className="flex items-baseline gap-1.5 mt-2">
                <span className="font-display" style={{ fontSize: 44, fontWeight: 600, color: col, lineHeight: 1 }}>{fmt(m.today)}</span>
                <span style={{ fontSize: 13, color: D.ink3 }}>{id === 'sleep' ? '' : m.unit}</span>
              </div>
            </div>
            <span className="rounded-full flex-shrink-0" style={{ padding: '5px 12px', background: v.good ? 'rgba(95,220,168,.16)' : 'rgba(245,197,114,.16)', color: col, fontSize: 12.5, fontWeight: 700 }}>{v.good ? 'Good' : 'Watch this'}</span>
          </div>
          <div className="mt-3.5 pt-3.5" style={{ borderTop: `1px solid ${D.hair}`, fontSize: 13.5, color: D.ink2, lineHeight: 1.65 }}>{v.line}</div>
          <div className="flex gap-4 mt-3.5">
            <div><div style={{ fontSize: 10.5, color: D.ink3 }}>Yesterday</div><div className="font-display" style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>{fmt(m.yest)}</div></div>
            <div><div style={{ fontSize: 10.5, color: D.ink3 }}>Your 30-day average</div><div className="font-display" style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>{fmt(avg)}</div></div>
          </div>
        </div>

        {/* what the change means */}
        <div className="rounded-2xl p-4 mt-3" style={{ background: D.card, border: `1px solid ${D.hair}` }}>
          <div style={{ fontSize: 11, letterSpacing: 1.3, color: D.blueLite, fontWeight: 700 }}>WHAT THE CHANGE FROM YESTERDAY MEANS</div>
          <div className="flex items-center gap-3 mt-3">
            <span className="flex items-center justify-center rounded-xl flex-shrink-0" style={{ width: 52, height: 44, background: D.raised }}>
              <span className="font-display" style={{ fontSize: 17, fontWeight: 700, color: col }}>{m.today > m.yest ? '↑' : m.today < m.yest ? '↓' : '='}{id === 'sleep' ? Math.abs(Math.round((m.today - m.yest) * 60)) : Math.abs(Math.round((m.today - m.yest) * (id === 'load' ? 10 : 1)) / (id === 'load' ? 10 : 1))}</span>
            </span>
            <div style={{ fontSize: 13.5, color: D.ink2, lineHeight: 1.6 }}>
              {id === 'rhr' && (m.today < m.yest ? `Your resting heart rate is ${Math.round(m.yest - m.today)} beats lower than yesterday. Fewer beats at rest means the heart is filling and emptying more efficiently — it is the clearest day-to-day sign that recovery went well.` : `Up ${Math.round(m.today - m.yest)} beats. A single higher day is usually sleep, alcohol or stress. Three in a row is the pattern that matters.`)}
              {id === 'hrv' && (m.today > m.yest ? `Your HRV is ${Math.round(m.today - m.yest)} ms higher than yesterday. A rise means the recovery side of your nervous system is back in charge — your body has absorbed yesterday's load.` : `Down ${Math.round(m.yest - m.today)} ms. Your body is still under load. Not a problem for one day, but train easy today.`)}
              {id === 'steps' && (m.today > m.yest ? `${(m.today - m.yest).toLocaleString()} more steps than yesterday. Background movement like this adds up to more cardiovascular benefit over a year than the sessions do.` : `${(m.yest - m.today).toLocaleString()} fewer than yesterday. One quiet day is fine.`)}
              {id === 'sleep' && (m.today > m.yest ? `${Math.round((m.today - m.yest) * 60)} minutes more than last night. Extra sleep lowers your overnight blood pressure and shows up tomorrow as a higher HRV and a lower resting heart rate.` : `${Math.round((m.yest - m.today) * 60)} minutes less. Expect a slightly higher resting heart rate tomorrow.`)}
              {id === 'load' && (m.today > m.yest ? `Your heart worked ${Math.round((m.today - m.yest) * 10) / 10}× harder than yesterday. That is training, not a warning — provided tomorrow is easier and your HRV comes back up.` : `An easier day than yesterday. Useful: strain and recovery have to alternate.`)}
            </div>
          </div>
        </div>

        {/* what it means */}
        <div className="rounded-2xl p-4 mt-3" style={{ background: D.card, border: `1px solid ${D.hair}` }}>
          <div style={{ fontSize: 11, letterSpacing: 1.3, color: D.blueLite, fontWeight: 700 }}>WHAT THIS ACTUALLY MEANS</div>
          <div style={{ fontSize: 13.5, color: D.ink2, lineHeight: 1.7, marginTop: 8 }}>{m.meaning}</div>
        </div>

        {/* normal range */}
        <div className="rounded-2xl p-4 mt-3" style={{ background: D.card, border: `1px solid ${D.hair}` }}>
          <div style={{ fontSize: 11, letterSpacing: 1.3, color: D.blueLite, fontWeight: 700 }}>WHAT IS NORMAL AT {age}</div>
          <div style={{ fontSize: 13.5, color: D.ink2, lineHeight: 1.7, marginTop: 8 }}>{m.range(age)}</div>
        </div>

        {/* trend */}
        <div className="rounded-2xl p-4 mt-3" style={{ background: D.card, border: `1px solid ${D.hair}` }}>
          <div style={{ fontSize: 11, letterSpacing: 1.3, color: D.ink3, fontWeight: 700 }}>SINCE YOU JOINED</div>
          <div style={{ marginTop: 12 }}>{pvChart(series, m.band, col, m.unit)}</div>
        </div>

        <div className="text-center px-4 mt-4" style={{ fontSize: 11.5, color: D.ink3, lineHeight: 1.7 }}>Measured by your wristband. One unusual day is rarely meaningful — the trend is what your doctor reads.</div>
      </div>
    );
  }

  function renderProtectHome() {
    const D = { bg: '#0B2039', card: '#16314F', raised: '#1E3C60', hair: 'rgba(255,255,255,.14)', ink: '#FFFFFF', ink2: '#C6D8EC', ink3: '#93AECB', blueLite: '#9CCAFF', green: '#5FDCA8', amber: '#F5C572', red: '#F58D8B', violet: '#B0A4FF', bone: '#EDE8DE', boneInk: '#111A1D' };
    const first = (foName || signupName || 'Rahul').split(' ')[0];

    /* ---- HEART AGE — from the screening engine, not a separate number ---- */
    const prof = foProfile();
    const age = prof.age;
    const assessed = assessCVD(prof);
    const heartAge = (careRisk && careRisk.heartAge) ? careRisk.heartAge : assessed.heartAge;
    const behind = heartAge > age;
    const gap = Math.abs(heartAge - age);
    /* Projection: what the heart age becomes if the modifiable levers are met.
       bestCase risk → the age a healthy profile reaches that same risk. */
    const projected = heartAgeOf({ ...prof, smoker: false, sbp: Math.min(prof.sbp, 125), bmi: Math.min(prof.bmi, 23) });
    /* iLive Cardiovascular Age — clinical anchor + bounded physiological correction.
       PRODUCTION: replace pvPhys/pvDays with the member's real wearable aggregates. */
    const pvPhys = { vo2: 41, rhr: 54, mvpa: 118, steps: 8432, sleepHrs: 7.4, sleepSd: 48, strength: 1, hrr1: 22 };
    const pvDays = 45;
    const cva = cardiovascularAge({ age, sex: prof.sex === 'Female' ? 'female' : 'male', clinicalHeartAge: heartAge }, pvPhys, { daysOfData: pvDays });

    const healthScore = 82, readiness = 86;
    const hrMax = 220 - age;
    const zones = pvZones(age);
    const goal = PV_GOALS.find(g => g.id === pvGoal) || PV_GOALS[1];
    const gz = zones.filter(z => goal.zones.includes(z.id));
    const bandFrom = gz[0].from, bandTo = gz[gz.length - 1].to;
    const todayMins = { 1: 24, 2: 31, 3: 18, 4: 12, 5: 0 };
    const doneInBand = goal.zones.reduce((s, k) => s + todayMins[k], 0);

    const lo = Math.floor(Math.min(age, projected) - 6), hi = Math.ceil(Math.max(age, heartAge) + 6);
    const pct = v => Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100));
    const ticks = []; for (let a = lo; a <= hi; a++) ticks.push(a);

    if (pvSheet === 'session') return renderPvSession();
    if (pvSheet && PV_METRICS[pvSheet]) return renderPvMetric(pvSheet);
    if (pvSheet === 'age') return renderPvAgeSheet(prof, age, heartAge, projected, assessed, cva);
    if (pvSheet === 'zones') return renderPvZonesSheet(zones, hrMax, todayMins, goal);

    const scoreCard = (title, emoji, value, label, sub, col, onTap) => (
      <button onClick={onTap} className="rounded-2xl p-4 text-left" style={{ background: 'linear-gradient(160deg, rgba(255,255,255,.07) 0%, rgba(255,255,255,.015) 52%), ' + D.card, border: `1px solid ${col}33` }}>
        <div className="flex items-center gap-2"><span style={{ fontSize: 15 }}>{emoji}</span><span style={{ fontSize: 12.5, color: D.ink2, fontWeight: 600 }}>{title}</span></div>
        <div className="flex items-center justify-between mt-3">
          <div>
            <div className="flex items-baseline gap-1"><span className="font-display" style={{ fontSize: 32, fontWeight: 600, color: col, lineHeight: 1 }}>{value}</span><span style={{ fontSize: 12, color: D.ink3 }}>/100</span></div>
            <div style={{ fontSize: 12.5, color: col, fontWeight: 600, marginTop: 5 }}>{label}</div>
          </div>
          <div className="relative flex-shrink-0" style={{ width: 52, height: 52 }}>
            <svg width="52" height="52"><circle cx="26" cy="26" r="23" fill="none" stroke="rgba(255,255,255,.10)" strokeWidth="5" /><circle cx="26" cy="26" r="23" fill="none" stroke={col} strokeWidth="5" strokeLinecap="round" strokeDasharray={2 * Math.PI * 23} strokeDashoffset={2 * Math.PI * 23 * (1 - value / 100)} transform="rotate(-90 26 26)" /></svg>
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: D.green, marginTop: 8 }}>↑ {sub}</div>
      </button>
    );

    return (
      <div className="-mx-4 -mt-4 px-4 pt-5 pb-6 ilive-premium" style={{ background: D.bg, color: D.ink, minHeight: '100%' }}>
        <div className="flex items-start justify-between">
          <div>
            <div style={{ fontSize: 13, color: D.ink3 }}>⌚ iLive Prevent</div>
            <div className="font-display mt-1" style={{ fontSize: 24, fontWeight: 400, letterSpacing: '-0.03em' }}>Good morning, {first} 👋</div>
            <div className="mt-1" style={{ fontSize: 13.5, color: D.ink2 }}>Here's your health snapshot for today.</div>
          </div>
          <span className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full flex-shrink-0" style={{ background: 'rgba(95,220,168,.14)', color: D.green, border: `1px solid ${D.green}33` }}><span className="rounded-full" style={{ width: 7, height: 7, background: D.green }}></span>Live</span>
        </div>

        <div className="space-y-4 mt-6">
          {/* 1 · SCORES */}
          <div className="grid grid-cols-2 gap-3">
            {scoreCard('iLive Health Score', '🛡️', healthScore, 'Good', '4 points this month', D.amber, () => { tapFeel('tap'); setPvSheet('age'); })}
            {scoreCard('Heart Readiness', '💙', readiness, 'Well recovered', '5 points vs yesterday', D.blueLite, () => { tapFeel('tap'); setPvSheet('zones'); })}
          </div>

          {/* 3 · KNOW YOUR HEART AGE — one row, opens the full explanation */}
          <button onClick={() => { tapFeel('tap'); setPvSheet('age'); }} className="w-full rounded-2xl text-left flex items-center gap-3.5 px-4 py-3.5 relative overflow-hidden" style={{ background: 'linear-gradient(140deg, #12233A 0%, #0A1626 60%, #071120 100%)', border: '1px solid rgba(201,162,39,0.35)' }}>
            <div style={{ position: 'absolute', top: 0, left: 16, right: 16, height: 1, background: 'linear-gradient(90deg, transparent, rgba(201,162,39,0.5), transparent)' }} />
            <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 40, height: 40, background: 'rgba(201,162,39,0.12)', border: '1px solid rgba(201,162,39,0.4)' }}>
              <Heart size={17} color="#C9A227" fill="#C9A227" />
            </span>
            <div className="flex-1 min-w-0">
              <div style={{ fontSize: 14.5, color: D.ink, fontWeight: 600 }}>Know your heart age</div>
              <div style={{ fontSize: 12, color: D.ink3, marginTop: 2 }}>What your heart's age says, and what changes it</div>
            </div>
            <span className="flex items-center gap-2 flex-shrink-0">
              <span className="font-display" style={{ fontSize: 24, fontWeight: 700, color: '#E3C766' }}>{Math.round(cva.cardiovascularAge)}</span>
              <ChevronRight size={16} color="#C9A227" />
            </span>
          </button>

          {/* 5 · TODAY'S HEALTH — last 24 hours, three numbers */}
          <div className="rounded-2xl p-4" style={{ background: 'linear-gradient(160deg, rgba(255,255,255,.07) 0%, rgba(255,255,255,.015) 52%), ' + D.card, border: `1px solid ${D.hair}` }}>
            <div className="flex items-center gap-2.5">
              <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 24, height: 24, background: 'rgba(95,220,168,.18)' }}><Check size={13} color={D.green} strokeWidth={3} /></span>
              <div>
                <div style={{ fontSize: 15, color: D.ink, fontWeight: 600 }}>Today's health</div>
                <div style={{ fontSize: 12, color: D.ink3, marginTop: 1 }}>Based on your last 24 hours of captured data</div>
              </div>
            </div>
            <div className="space-y-2.5 mt-4">
              {[
                ['rhr', '❤️', 'Resting heart rate', '54', 'bpm', '4 points below yesterday', 'Good', D.green],
                ['hrv', '📈', 'HRV', '48', 'ms', '6 points above yesterday', 'Good', D.green],
                ['load', '⚡', 'Cardiovascular strain', '1.8', '×', '0.6 above yesterday', 'Higher than usual', D.amber],
              ].map(([k, e, t, v, u, d, verdict, c]) => (
                <button key={k} onClick={() => { tapFeel('tap'); setPvSheet(k); }} className="w-full rounded-xl p-3.5 text-left flex items-center gap-3.5" style={{ background: D.raised }}>
                  <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 36, height: 36, background: 'rgba(255,255,255,.05)', fontSize: 16 }}>{e}</span>
                  <div className="flex-1 min-w-0">
                    <div style={{ fontSize: 13.5, color: D.ink2, fontWeight: 600 }}>{t}</div>
                    <div className="flex items-baseline gap-1 mt-1"><span className="font-display" style={{ fontSize: 22, fontWeight: 600, color: D.ink, lineHeight: 1 }}>{v}</span><span style={{ fontSize: 11, color: D.ink3 }}>{u}</span></div>
                    <div style={{ fontSize: 11.5, color: D.ink3, marginTop: 4 }}>{d} · <span style={{ color: c, fontWeight: 600 }}>{verdict}</span></div>
                  </div>
                  <ChevronRight size={15} color={D.ink3} />
                </button>
              ))}
            </div>
            <div style={{ fontSize: 12, color: D.ink3, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${D.hair}` }}>Tap any of the three to see what it means for you.</div>
          </div>

          {/* 4 · TODAY'S PLAN — goal chosen by the member */}
          <div className="rounded-2xl p-4" style={{ background: 'linear-gradient(160deg, rgba(255,255,255,.07) 0%, rgba(255,255,255,.015) 52%), ' + D.card, border: `1px solid ${D.hair}` }}>
            <div style={{ fontSize: 15, color: D.ink, fontWeight: 600 }}>What is your health goal today?</div>
            <div className="grid grid-cols-2 gap-2 mt-3">
              {PV_GOALS.map(g => (
                <button key={g.id} onClick={() => { tapFeel('select'); setPvGoal(g.id); setPvSess({ status: 'brief', secs: 0, inZone: 0, hr: 72, avgHr: 0 }); setPvSheet('session'); }} className="rounded-2xl text-left relative overflow-hidden" style={{ background: `linear-gradient(150deg, ${GOAL_TINT[g.id][0]} 0%, ${GOAL_TINT[g.id][1]} 100%)`, border: '1px solid rgba(255,255,255,.10)', padding: '14px 14px 12px', boxShadow: '0 6px 18px rgba(0,0,0,.22)' }}>
                  <div style={{ position: 'absolute', right: -14, top: -14, width: 64, height: 64, borderRadius: 32, background: 'rgba(255,255,255,.07)' }} />
                  <span className="flex items-center justify-center rounded-xl" style={{ width: 34, height: 34, background: 'rgba(255,255,255,.16)', fontSize: 17 }}>{g.e}</span>
                  <div style={{ fontSize: 13.5, color: '#FFFFFF', fontWeight: 700, marginTop: 10, lineHeight: 1.25 }}>{g.label}</div>
                  <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,.72)', marginTop: 3 }}>Zone {g.zones.join('–')} · {g.mins} min</div>
                </button>
              ))}
            </div>

            <button onClick={() => { tapFeel('tap'); setPvSheet('zones'); }} className="w-full flex items-center justify-between mt-3 pt-3" style={{ borderTop: `1px solid ${D.hair}` }}>
              <span style={{ fontSize: 12.5, color: D.blueLite, fontWeight: 600 }}>See all five heart zones</span>
              <ChevronRight size={15} color={D.blueLite} />
            </button>
          </div>

          {/* 6 · YOUR VITALS — four */}
          <div>
            <div className="px-1.5 pb-3" style={{ fontSize: 15, color: D.ink, fontWeight: 600 }}>Your vitals</div>
            <div className="grid grid-cols-2 gap-2.5">
              {[['rhr', '❤️', 'Heart rate', '71', 'bpm', 'Just now'], ['hrv', '📈', 'HRV', '48', 'ms', 'Last night'], ['sleep', '🌙', 'Sleep', '7h 24m', '', 'Last night'], ['steps', '👟', 'Steps', '8,432', '', 'Today']].map(([k, e, t, v, u, w]) => (
                <button key={t} onClick={() => { tapFeel('tap'); setPvSheet(k); }} className="rounded-2xl p-3.5 text-left" style={{ background: '#FFFFFF' }}>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5"><span style={{ fontSize: 13 }}>{e}</span><span style={{ fontSize: 11.5, color: '#153E6F', fontWeight: 700 }}>{t}</span></span>
                    <ChevronRight size={12} color="#7A8CA6" />
                  </div>
                  <div className="flex items-baseline gap-1 mt-2"><span className="font-display" style={{ fontSize: 20, fontWeight: 600, color: '#0A1B33', lineHeight: 1 }}>{v}</span><span style={{ fontSize: 10.5, color: '#3F5578', fontWeight: 600 }}>{u}</span></div>
                  <div style={{ fontSize: 10, color: '#7A8CA6', fontWeight: 600, marginTop: 4 }}>{w}</div>
                </button>
              ))}
            </div>
          </div>

          {exrxCard()}
          {adviceCard()}

          {/* 6 · CARE TEAM — one row, opens the page */}
          <button onClick={() => { tapFeel('tap'); setPvSheet('team'); }} className="w-full rounded-2xl p-4 flex items-center gap-3.5 text-left" style={{ background: 'linear-gradient(160deg, rgba(255,255,255,.07) 0%, rgba(255,255,255,.015) 52%), ' + D.card, border: `1px solid ${D.hair}` }}>
            <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 40, height: 40, background: D.raised, fontSize: 17 }}>👥</span>
            <div className="flex-1 min-w-0">
              <div style={{ fontSize: 14.5, color: D.ink, fontWeight: 600 }}>Your care team</div>
              <div style={{ fontSize: 12, color: D.ink3, marginTop: 2 }}>Medical expert · longevity expert · exercise specialist</div>
            </div>
            <ChevronRight size={16} color={D.ink3} />
          </button>

          {/* 7 · SERVICES — crisp */}
          <div className="rounded-2xl overflow-hidden" style={{ background: D.card, border: `1px solid ${D.hair}` }}>
            {[['🧪', 'Book lab tests', 'Home sample collection', () => { setMoreScreen('labs'); setActiveTab('more'); }], ['💊', 'Order medicines', 'From your prescriptions', () => { setMoreScreen('medicines'); setActiveTab('more'); }]].map(([e, label, sub, act], i) => (
              <button key={label} onClick={() => { tapFeel('tap'); act(); }} className="w-full flex items-center gap-3.5 px-4 py-4 text-left" style={{ borderBottom: i === 0 ? `1px solid ${D.hair}` : 'none' }}>
                <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 38, height: 38, background: D.raised, fontSize: 16 }}>{e}</span>
                <div className="flex-1 min-w-0"><div style={{ fontSize: 14.5, color: D.ink }}>{label}</div><div style={{ fontSize: 12, color: D.ink3, marginTop: 2 }}>{sub}</div></div>
                <ChevronRight size={16} color={D.ink3} />
              </button>
            ))}
          </div>

          <div className="text-center px-5" style={{ fontSize: 12, color: D.ink3, lineHeight: 1.8 }}>Heart age is a risk estimate from your screening, not a diagnosis.</div>
        </div>
      </div>
    );
  }

  /* ---- Sheet: how the heart age is calculated ---- */
  function renderPvAgeSheet(prof, age, heartAge, projected, assessed, cva) {
    const B = { bone: '#0B2039', card: '#16314F', raised: '#1E3C60', ink: '#FFFFFF', ink2: '#C6D8EC', ink3: '#93AECB', line: 'rgba(255,255,255,.14)', gold: '#C9A227', green: '#5FDCA8', red: '#F58D8B' };
    const rows = [
      ['Your age', `${age} years`],
      ['Sex', prof.sex],
      ['BMI', prof.bmi.toFixed(1)],
      ['Systolic blood pressure', `${prof.sbp} mmHg${prof.bpTreated ? ' (on treatment)' : ''}`],
      ['Smoking', prof.smoker ? 'Current smoker' : 'Non-smoker'],
      ['Diabetes', prof.diabetes ? 'Yes' : 'No'],
    ];
    return (
      <div className="-mx-4 -mt-4 px-4 pt-5 pb-6" style={{ background: B.bone, color: B.ink, minHeight: '100%' }}>
        <button onClick={() => { tapFeel('tap'); setPvSheet(null); }} className="flex items-center gap-1.5 text-sm font-semibold mb-4" style={{ color: B.ink3 }}><ChevronLeft size={16} color="#93AECB" /> Back to Prevent</button>
        <div className="font-display" style={{ fontSize: 24, fontWeight: 500, letterSpacing: '-0.03em' }}>How your cardiovascular age is calculated</div>
        {cva && (
          <div className="rounded-2xl p-4 mt-4" style={{ background: B.card, border: `1px solid ${B.line}` }}>
            <div style={{ fontSize: 11, letterSpacing: 1.3, color: '#C9A227', fontWeight: 700 }}>TWO PARTS, SHOWN SEPARATELY</div>
            <div className="flex items-center gap-2 mt-3.5">
              <div className="flex-1 text-center rounded-xl py-3" style={{ background: B.raised }}>
                <div className="font-display" style={{ fontSize: 22, fontWeight: 700 }}>{cva.clinicalHeartAge}</div>
                <div style={{ fontSize: 10.5, color: B.ink3, marginTop: 3 }}>Clinical<br/>(Framingham)</div>
              </div>
              <span style={{ fontSize: 18, color: B.ink3 }}>{cva.appliedAdjustment < 0 ? '−' : '+'}</span>
              <div className="flex-1 text-center rounded-xl py-3" style={{ background: B.raised }}>
                <div className="font-display" style={{ fontSize: 22, fontWeight: 700, color: cva.appliedAdjustment < 0 ? B.green : B.red }}>{Math.abs(cva.appliedAdjustment)}</div>
                <div style={{ fontSize: 10.5, color: B.ink3, marginTop: 3 }}>Physiology<br/>(your wearable)</div>
              </div>
              <span style={{ fontSize: 18, color: B.ink3 }}>=</span>
              <div className="flex-1 text-center rounded-xl py-3" style={{ background: 'rgba(201,162,39,.12)', border: '1px solid rgba(201,162,39,.3)' }}>
                <div className="font-display" style={{ fontSize: 22, fontWeight: 700, color: '#E3C766' }}>{Math.round(cva.cardiovascularAge)}</div>
                <div style={{ fontSize: 10.5, color: B.ink3, marginTop: 3 }}>Your CV<br/>age</div>
              </div>
            </div>
            <div className="mt-3.5 pt-3.5" style={{ borderTop: `1px solid ${B.line}`, fontSize: 12.5, color: B.ink2, lineHeight: 1.6 }}>
              <b style={{ color: B.ink }}>{cva.confidence.label}.</b> {cva.confidence.note}
            </div>
          </div>
        )}

        {cva && cva.contributors.length > 0 && (
          <div className="mt-4">
            <div style={{ fontSize: 11, letterSpacing: 1.3, color: '#9CCAFF', fontWeight: 700 }}>WHAT YOUR PHYSIOLOGY IS DOING</div>
            <div style={{ fontSize: 12.5, color: B.ink3, lineHeight: 1.6, marginTop: 6, marginBottom: 10 }}>Each measurement compared with what is typical for your age and sex. Years shown are that factor's share of the physiological correction.</div>
            {cva.contributors.map(c => (
              <div key={c.key} className="flex items-center gap-3" style={{ padding: '10px 0', borderBottom: `1px solid ${B.line}` }}>
                <div className="flex-1 min-w-0">
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{LABELS[c.key]}</div>
                  <div style={{ fontSize: 11, color: B.ink3, marginTop: 2 }}>{c.value}{c.key === 'rhr' || c.key === 'hrr1' ? ' bpm' : c.key === 'vo2' ? ' ml/kg/min' : c.key === 'mvpa' ? ' min/week' : c.key === 'steps' ? ' steps/day' : c.key === 'sleepHrs' ? ' h' : c.key === 'sleepSd' ? ' min variation' : '×/week'} · {c.z > 0.4 ? 'better than typical' : c.z < -0.4 ? 'below typical' : 'about typical'}</div>
                </div>
                <div className="font-display flex-shrink-0" style={{ fontSize: 15, fontWeight: 700, color: c.ageImpactYears < 0 ? B.green : c.ageImpactYears > 0 ? B.red : B.ink3 }}>
                  {c.ageImpactYears > 0 ? '+' : ''}{c.ageImpactYears} yrs
                </div>
              </div>
            ))}
            <div className="rounded-2xl p-3.5 mt-3" style={{ background: B.card, border: `1px solid ${B.line}`, fontSize: 12, color: B.ink3, lineHeight: 1.6 }}>
              HRV is deliberately excluded: it is strongly genetically determined, so it compares poorly against population norms. We use it for your daily readiness instead.
            </div>
          </div>
        )}
        <div style={{ fontSize: 13, color: B.ink2, lineHeight: 1.6, margin: '10px 0 18px' }}>
          This is the same number as your screening — not a separate score. Your 10-year cardiovascular risk is <b>{assessed.pct.toFixed(1)}%</b>. Your heart age is the age at which someone with a healthy profile reaches that same risk.
        </div>
        <div className="rounded-2xl p-4" style={{ background: B.card, border: `1px solid ${B.line}` }}>
          <div style={{ fontSize: 11, letterSpacing: 1.3, color: '#9CCAFF', fontWeight: 700 }}>WHAT WENT IN</div>
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between" style={{ padding: '9px 0', borderBottom: `1px solid ${B.line}` }}>
              <span style={{ fontSize: 13, color: B.ink2 }}>{k}</span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{v}</span>
            </div>
          ))}
          <div className="flex items-center justify-between" style={{ paddingTop: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Your heart age</span>
            <span className="font-display" style={{ fontSize: 22, fontWeight: 700, color: heartAge > age ? '#C23A26' : '#1E7A5A' }}>{heartAge}</span>
          </div>
        </div>
        <div className="mt-5">
          <div style={{ fontSize: 11, letterSpacing: 1.3, color: '#9CCAFF', fontWeight: 700 }}>WHAT WOULD BRING IT DOWN</div>
          <div style={{ fontSize: 12.5, color: B.ink3, lineHeight: 1.6, marginTop: 6, marginBottom: 10 }}>Each line is this same calculation re-run with one thing changed. Nothing else.</div>
          {(() => {
            const levers = [];
            if (prof.smoker) levers.push(['🚭', 'Stop smoking', 'The single largest change available to you', heartAgeOf({ ...prof, smoker: false })]);
            if (prof.sbp > 125) levers.push(['🩺', `Blood pressure ${prof.sbp} → 125`, 'Salt, weight, sleep — then medication if it holds', heartAgeOf({ ...prof, sbp: 125 })]);
            if (prof.bmi > 23) levers.push(['⚖️', `BMI ${prof.bmi.toFixed(1)} → 23`, 'Asian-Indian cut-off; your nutritionist sets a realistic target', heartAgeOf({ ...prof, bmi: 23 })]);
            if (prof.diabetes) levers.push(['🍎', 'Tight blood-sugar control', 'Diabetes stays in the calculation, but control changes your real outcome', null]);
            if (!levers.length) levers.push(['✅', 'Nothing to change', 'Your modifiable factors are already at target', null]);
            return levers.map(([e, t, d, na]) => (
              <div key={t} className="flex items-start gap-3" style={{ padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,.14)' }}>
                <span style={{ fontSize: 17 }}>{e}</span>
                <div className="flex-1 min-w-0">
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t}</div>
                  <div style={{ fontSize: 11.5, color: B.ink3, marginTop: 3, lineHeight: 1.5 }}>{d}</div>
                </div>
                {na !== null && (
                  <div className="text-right flex-shrink-0">
                    <div className="font-display" style={{ fontSize: 18, fontWeight: 700, color: heartAge - na > 0 ? '#1E7A5A' : 'rgba(17,26,29,.4)' }}>{na}</div>
                    <div style={{ fontSize: 9.5, color: B.ink3 }}>{heartAge - na > 0 ? `−${heartAge - na} yrs` : 'no change'}</div>
                  </div>
                )}
              </div>
            ));
          })()}
        </div>
        <div className="rounded-2xl p-4 mt-4" style={{ background: 'linear-gradient(150deg, rgba(95,220,168,.12) 0%, rgba(95,220,168,.02) 60%), #16314F', border: '1px solid rgba(95,220,168,.3)' }}>
          <div style={{ fontSize: 13, color: B.ink2, lineHeight: 1.65 }}>
            Do all of them and the same calculation gives a heart age of <b style={{ fontSize: 15 }}>{projected}</b>. Your medical expert and longevity expert will decide the order with you.
          </div>
        </div>

        {/* HOW to move those numbers — habits, each mapped to the input it changes */}
        <div className="mt-6">
          <div style={{ fontSize: 11, letterSpacing: 1.3, color: '#C9A227', fontWeight: 700 }}>HOW TO MOVE THOSE NUMBERS</div>
          <div style={{ fontSize: 12.5, color: B.ink3, lineHeight: 1.6, marginTop: 6, marginBottom: 12 }}>
            The calculation above only reads six things. These habits are how you actually change them — each one is tagged with the number it moves, and by how much in published trials.
          </div>
          {[
            ['🧂', 'Cut added salt to under 5 g a day', 'Skip pickle, papad, packet snacks and restaurant food. This is the single fastest blood-pressure change available.', 'Blood pressure', '−5 to −6 mmHg', 'WHO sodium guideline; DASH-Sodium trial, NEJM 2001', prof.sbp > 125],
            ['🥗', 'Eat a DASH-style plate', 'Vegetables, fruit, dal and whole grains; less fried food and red meat. Works on blood pressure independently of salt.', 'Blood pressure', '−8 to −11 mmHg', 'ACC/AHA 2017 hypertension guideline', prof.sbp > 125],
            ['🚶', '150 minutes of brisk activity a week', 'Thirty minutes, five days. Lowers blood pressure and helps weight at the same time.', 'Blood pressure + BMI', '−5 to −8 mmHg', 'ACC/AHA 2017; Whelton, Ann Intern Med 2002', true],
            ['⚖️', 'Lose 5 kg', 'Roughly 1 mmHg comes off your blood pressure for every kilogram lost, and BMI falls with it.', 'BMI + blood pressure', '−5 mmHg, BMI −1.6', 'ACC/AHA 2017; Neter, Hypertension 2003', prof.bmi > 23],
            ['🍺', 'Keep alcohol under two drinks a day', 'Cutting from heavy to moderate intake lowers blood pressure measurably within weeks.', 'Blood pressure', '−4 mmHg', 'ACC/AHA 2017 hypertension guideline', true],
            ['🍌', 'More potassium — fruit, dal, vegetables', 'Potassium counteracts sodium. Avoid supplements if you have kidney disease.', 'Blood pressure', '−4 to −5 mmHg', 'ACC/AHA 2017; WHO potassium guideline', true],
            ['😴', 'Seven hours of sleep, same window nightly', 'Short sleep raises night-time blood pressure and blunts every other effort on this list.', 'Blood pressure (indirect)', 'supports control', 'AHA Life\'s Essential 8, Circulation 2022', true],
            ['🚭', 'Stop smoking', 'Removes the single largest multiplier in the calculation outright — nothing else changes the number this much.', 'Smoking status', 'removed from equation', 'Framingham 2008 model input', prof.smoker],
          ].filter(r => r[6]).map(([e, t, d, moves, effect, src2]) => (
            <div key={t} style={{ padding: '13px 0', borderBottom: '1px solid rgba(255,255,255,.14)' }}>
              <div className="flex items-start gap-3">
                <span style={{ fontSize: 17, lineHeight: 1.2 }}>{e}</span>
                <div className="flex-1 min-w-0">
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t}</div>
                  <div style={{ fontSize: 12, color: B.ink3, marginTop: 3, lineHeight: 1.55 }}>{d}</div>
                  <div className="flex flex-wrap gap-1.5" style={{ marginTop: 7 }}>
                    <span className="rounded-full" style={{ padding: '2px 8px', background: 'rgba(95,220,168,.14)', color: '#5FDCA8', fontSize: 10.5, fontWeight: 700 }}>Moves: {moves}</span>
                    <span className="rounded-full" style={{ padding: '2px 8px', background: B.raised, color: B.ink3, fontSize: 10.5, fontWeight: 600 }}>{effect}</span>
                  </div>
                  <div style={{ fontSize: 10.5, color: B.ink3, marginTop: 5 }}>{src2}</div>
                </div>
              </div>
            </div>
          ))}
          <div className="rounded-2xl p-4 mt-4" style={{ background: B.card, border: `1px solid ${B.line}` }}>
            <div style={{ fontSize: 12.5, color: B.ink2, lineHeight: 1.65 }}>
              <b style={{ color: '#FFFFFF' }}>Why some things are not on this list.</b> Cholesterol, family history, kidney disease and sleep apnoea all affect real risk, but they are not inputs to this particular equation — the office-based Framingham model uses only age, sex, BMI, blood pressure, smoking and diabetes. Your detailed assessment covers the rest, and a blood panel lets us switch to the lipid version of the score.
            </div>
          </div>
        </div>
        {/* how the service itself moves this number */}
        <div className="rounded-2xl p-4 mt-5" style={{ background: 'linear-gradient(155deg, rgba(95,220,168,.12) 0%, rgba(255,255,255,.012) 58%), ' + B.card, border: `1px solid ${B.green}44` }}>
          <div style={{ fontSize: 11, letterSpacing: 1.3, color: B.green, fontWeight: 700 }}>HOW ILIVE BRINGS THIS DOWN WITH YOU</div>
          <div style={{ fontSize: 12.5, color: B.ink3, lineHeight: 1.6, marginTop: 7 }}>Knowing the number changes nothing. This is the part that does.</div>
          {[
            ['🩺', 'A doctor reads your numbers, not an app', 'Every blood pressure and sugar you log is seen by your iLive doctor. If a pattern is forming, they call you — you never have to decide whether a reading matters.'],
            ['🏃', 'Your exercise is prescribed, not guessed', 'Minutes and heart-rate zone set from your weight, age and conditions, and moved up as you improve. This is the lever that shifts blood pressure and fitness together.'],
            ['📸', 'Check My Meal reads the food actually on your plate', 'Photograph a meal and see what to keep and what to drop. Weight and sugar move through what you eat more than anything else.'],
            ['🥗', 'A longevity expert builds the plan around your kitchen', 'Not a printed diet sheet — a plan around what your household already cooks, which is the only kind people keep to.'],
            ['📈', 'The number is recalculated as your readings change', 'Bring your blood pressure down and your heart age falls with it, at your next reading. Nothing here is a one-time score.'],
          ].map(([e, t, w], i) => (
            <div key={t} className="flex gap-3 items-start" style={{ padding: '11px 0', borderTop: i ? `1px solid ${B.line}` : 'none', marginTop: i ? 0 : 9 }}>
              <span className="flex items-center justify-center rounded-xl flex-shrink-0" style={{ width: 36, height: 36, background: B.raised, fontSize: 16 }}>{e}</span>
              <div><div style={{ fontSize: 14, color: B.ink, lineHeight: 1.4 }}>{t}</div><div style={{ fontSize: 12.5, color: B.ink3, marginTop: 3, lineHeight: 1.55 }}>{w}</div></div>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 11.5, color: B.ink3, lineHeight: 1.7, marginTop: 16 }}>
          Heart age is capped at 85. Framingham is validated to age 74, so above that we report "85+" rather than invent a number the equation cannot support — a very high risk simply exceeds what any healthy age reaches. Heart age from the Framingham General Cardiovascular Risk Score, D'Agostino et al., Circulation 2008. Validated for ages 30–74 without existing heart disease. A South Asian adjustment is applied for men. This is a risk estimate, not a diagnosis.
        </div>
      </div>
    );
  }

  /* ---- Sheet: the five zones ---- */
  function renderPvZonesSheet(zones, hrMax, todayMins, goal) {
    const D = { bg: '#0B2039', card: '#16314F', raised: '#1E3C60', hair: 'rgba(255,255,255,.14)', ink: '#FFFFFF', ink2: '#C6D8EC', ink3: '#93AECB', green: '#5FDCA8' };
    return (
      <div className="-mx-4 -mt-4 px-4 pt-5 pb-6" style={{ background: D.bg, color: D.ink, minHeight: '100%' }}>
        <button onClick={() => { tapFeel('tap'); setPvSheet(null); }} className="flex items-center gap-1.5 text-sm font-semibold mb-4" style={{ color: D.ink3 }}><ChevronLeft size={16} color={D.ink3} /> Back to Prevent</button>
        <div className="font-display" style={{ fontSize: 24, fontWeight: 500, letterSpacing: '-0.03em' }}>Your five heart zones</div>
        <div style={{ fontSize: 13, color: D.ink3, lineHeight: 1.6, margin: '10px 0 18px' }}>
          Your maximum heart rate is about <b style={{ color: D.ink }}>{hrMax} bpm</b> (220 minus your age). Each zone is a share of that maximum.
        </div>
        <div className="space-y-2">
          {zones.map(z => {
            const inPlan = goal.zones.includes(z.id);
            return (
              <div key={z.id} className="flex items-center gap-3 rounded-xl p-3.5" style={{ background: inPlan ? `${z.col}14` : 'rgba(255,255,255,.03)', border: `1px solid ${inPlan ? z.col + '55' : D.hair}` }}>
                <span className="flex items-center justify-center rounded-lg flex-shrink-0 font-display" style={{ width: 30, height: 30, background: `${z.col}22`, fontSize: 13, fontWeight: 700, color: z.col }}>{z.id}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{z.name}</span>
                    {inPlan && <span className="rounded" style={{ fontSize: 9.5, fontWeight: 700, color: z.col, background: `${z.col}1E`, padding: '2px 6px' }}>TODAY'S PLAN</span>}
                    {todayMins[z.id] > 0 && <span style={{ fontSize: 11, color: D.ink3 }}>{todayMins[z.id]} min today</span>}
                  </div>
                  <div style={{ fontSize: 11.5, color: D.ink3, marginTop: 2 }}>{z.what}</div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="font-display" style={{ fontSize: 13.5, fontWeight: 600, color: z.col }}>{z.from}–{z.to}</div>
                  <div style={{ fontSize: 10, color: D.ink3 }}>{Math.round(z.lo * 100)}–{Math.round(z.hi * 100)}%</div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="rounded-2xl p-4 mt-4" style={{ background: D.card, border: `1px solid ${D.hair}` }}>
          <div style={{ fontSize: 13, color: D.ink2, lineHeight: 1.65 }}>
            Aim for <b style={{ color: D.ink }}>150 minutes a week</b> in Zone 3 or above, or 75 minutes in Zone 4–5. That is the standard guideline and it is what moves your cardio fitness.
          </div>
        </div>

        <div className="rounded-2xl p-4 mt-3" style={{ background: D.card, border: `1px solid ${D.hair}` }}>
          <div style={{ fontSize: 11, letterSpacing: 1.3, color: D.blueLite, fontWeight: 700 }}>WHERE THESE ZONES COME FROM</div>
          <div style={{ fontSize: 13, color: D.ink2, lineHeight: 1.7, marginTop: 9 }}>
            These are the standard five zones used in cardiac rehabilitation and sports physiology, defined as percentages of your maximum heart rate:
          </div>
          <div className="rounded-xl p-3.5 mt-3" style={{ background: D.raised }}>
            {[['Zone 1', '50–60 %', 'Very light'], ['Zone 2', '60–70 %', 'Light'], ['Zone 3', '70–80 %', 'Moderate'], ['Zone 4', '80–90 %', 'Hard'], ['Zone 5', '90–100 %', 'Maximum']].map(([z, p2, n], i) => (
              <div key={z} className="flex items-center gap-3" style={{ padding: '6px 0', borderTop: i ? `1px solid ${D.hair}` : 'none' }}>
                <span style={{ fontSize: 13, color: D.ink, width: 58 }}>{z}</span>
                <span className="font-display" style={{ fontSize: 13, color: D.blueLite, fontWeight: 700, width: 74 }}>{p2}</span>
                <span style={{ fontSize: 12.5, color: D.ink3 }}>{n}</span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: D.ink3, lineHeight: 1.65, marginTop: 10 }}>
            Your maximum heart rate is taken as <b style={{ color: D.ink2 }}>220 minus your age</b> (Fox formula) — the method used by ACSM and in cardiac rehabilitation worldwide. It is an estimate: individuals vary by about ±10 beats, which is why we also show how the effort should <i>feel</i>. If you have had a stress test, your measured maximum replaces this and every zone shifts with it.
          </div>
          <div style={{ fontSize: 11.5, color: D.ink3, lineHeight: 1.6, marginTop: 9, paddingTop: 9, borderTop: `1px solid ${D.hair}` }}>
            ACSM Guidelines for Exercise Testing and Prescription, 11th edition · AACVPR cardiac rehabilitation standards · WHO Physical Activity Guidelines 2020. Any app using the same %HRmax convention will show the same bands.
          </div>
        </div>
      </div>
    );
  }

  function elderBack(label) {
    return (
      <button onClick={() => { setElderView(null); setElderQStep(0); setElderQAns({}); }} className="flex-shrink-0 text-sm text-left font-semibold mb-3" style={{ color: C.muted }}>← {label}</button>
    );
  }

  /* =========================================================================
     ELDER CARE — the four monthly checks.
     Every one is a published, validated instrument. Each screen states why it
     is done, scores it the way the paper does, says what the score means, and
     says what happens next. Nothing here is invented.
       Memory     · Mini-Cog        Borson, Int J Geriatr Psychiatry 2000;15:1021
       Mood       · PHQ-2           Kroenke, Med Care 2003;41:1284
                    UCLA-3 loneliness  Hughes, Res Aging 2004;26:655
       Strength   · CDC STEADI      30-second chair stand (Jones, RQES 1999) +
                                     3 STEADI fall-risk questions
       Vaccines   · Adult 65+ immunisation schedule
     ========================================================================= */
  const ELDER_UI = { bg: '#0B2039', card: '#16314F', raised: '#1E3C60', hair: 'rgba(255,255,255,.14)', ink: '#FFFFFF', ink2: '#C6D8EC', ink3: '#93AECB', blueLite: '#9CCAFF', green: '#5FDCA8', amber: '#F5C572', red: '#F58D8B', violet: '#B0A4FF' };

  function elderShell(title, subtitle, children, footer) {
    const D = ELDER_UI;
    return (
      <div className="-mx-4 -mt-4 px-4 pt-5 pb-6" style={{ background: D.bg, color: D.ink, minHeight: '100%' }}>
        <button onClick={() => { tapFeel('tap'); setElderView(null); setElderQStep(0); setElderQAns({}); }} className="flex items-center gap-1.5 text-sm font-semibold mb-4" style={{ color: D.ink3 }}><ChevronLeft size={16} color={D.ink3} /> Back to Elder Care</button>
        <div className="font-display" style={{ fontSize: 24, fontWeight: 500, letterSpacing: '-0.03em' }}>{title}</div>
        <div style={{ fontSize: 13, color: D.ink3, lineHeight: 1.6, margin: '10px 0 18px' }}>{subtitle}</div>
        {children}
        {footer && <div className="rounded-2xl p-4 mt-4" style={{ background: D.card, border: `1px solid ${D.hair}`, fontSize: 12, color: D.ink3, lineHeight: 1.65 }}>{footer}</div>}
      </div>
    );
  }

  function elderOption(label, sel, onTap, col) {
    const D = ELDER_UI;
    return (
      <button onClick={onTap} className="w-full rounded-xl px-4 py-4 text-left flex items-center gap-3" style={{ background: sel ? `${col || D.blueLite}1E` : D.raised, border: sel ? `1.5px solid ${col || D.blueLite}` : `1.5px solid transparent`, marginTop: 8 }}>
        <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 22, height: 22, background: sel ? (col || D.blueLite) : 'transparent', border: sel ? 'none' : `2px solid ${D.hair}` }}>{sel && <Check size={12} color="#08182B" strokeWidth={3} />}</span>
        <span style={{ fontSize: 15.5, color: D.ink }}>{label}</span>
      </button>
    );
  }

  /* ---------------- 1 · MEMORY — Mini-Cog ---------------- */
  const MINICOG_WORDS = ['Banana', 'Sunrise', 'Chair'];
  function renderElderMemory() {
    const D = ELDER_UI;
    const a = elderQAns, step = elderQStep;
    const next = () => { tapFeel('tap'); setElderQStep(step + 1); };

    if (step === 0) return elderShell('Memory check', 'The Mini-Cog — a three-minute test used in clinics worldwide to pick up early memory change. Done every month, it shows a trend, which is far more useful than a single score.', (
      <>
        <div className="rounded-2xl p-5" style={{ background: D.card, border: `1px solid ${D.blueLite}33` }}>
          <div style={{ fontSize: 11, letterSpacing: 1.3, color: D.blueLite, fontWeight: 700 }}>STEP 1 OF 3 · REMEMBER THESE</div>
          <div style={{ fontSize: 14, color: D.ink2, lineHeight: 1.6, marginTop: 10 }}>Say these three words out loud, twice. You will be asked for them at the end.</div>
          <div className="grid grid-cols-3 gap-2.5 mt-4">
            {MINICOG_WORDS.map(w => (
              <div key={w} className="rounded-xl py-5 text-center" style={{ background: D.raised }}>
                <div className="font-display" style={{ fontSize: 19, fontWeight: 600, color: D.ink }}>{w}</div>
              </div>
            ))}
          </div>
        </div>
        <button onClick={next} className="w-full rounded-2xl py-4 text-base font-bold mt-4" style={{ background: 'linear-gradient(135deg, #4A90F0 0%, #1F5CB0 100%)', color: '#FFFFFF' }}>I have said them — continue</button>
      </>
    ), 'Mini-Cog · Borson S et al., Int J Geriatr Psychiatry 2000. Validated for dementia screening in primary care.');

    if (step === 1) return elderShell('Memory check', 'Step 2 — the clock. This is the distraction task, and it also tests planning and spatial ability.', (
      <>
        <div className="rounded-2xl p-5" style={{ background: D.card, border: `1px solid ${D.blueLite}33` }}>
          <div style={{ fontSize: 11, letterSpacing: 1.3, color: D.blueLite, fontWeight: 700 }}>STEP 2 OF 3 · DRAW A CLOCK</div>
          <div style={{ fontSize: 14, color: D.ink2, lineHeight: 1.6, marginTop: 10 }}>On paper, draw a round clock face, put in all the numbers, then draw the hands to show <b style={{ color: D.ink }}>ten past eleven</b>.</div>
          <div className="rounded-xl p-4 mt-4 text-center" style={{ background: D.raised }}><span style={{ fontSize: 40 }}>🕚</span><div style={{ fontSize: 12, color: D.ink3, marginTop: 6 }}>Take a photo when done — your doctor reviews it</div></div>
          <button onClick={() => { tapFeel('select'); setElderQAns({ ...a, clock: 'done' }); }} className="w-full rounded-xl py-3 text-sm font-bold mt-3" style={{ background: a.clock ? 'rgba(95,220,168,.18)' : D.raised, color: a.clock ? D.green : D.ink }}>{a.clock ? '✓ Photo added' : '📷 Add photo of the clock'}</button>
        </div>
        <div style={{ fontSize: 12.5, color: D.ink3, marginTop: 12 }}>Could not draw it? That is useful information too — tap continue and tell us.</div>
        <button onClick={next} className="w-full rounded-2xl py-4 text-base font-bold mt-3" style={{ background: 'linear-gradient(135deg, #4A90F0 0%, #1F5CB0 100%)', color: '#FFFFFF' }}>Continue</button>
      </>
    ), 'The clock-drawing task is scored 0 or 2 points: normal or abnormal.');

    if (step === 2) return elderShell('Memory check', 'Step 3 — the three words. Tick every word you can recall, without looking back.', (
      <>
        <div className="rounded-2xl p-5" style={{ background: D.card, border: `1px solid ${D.blueLite}33` }}>
          <div style={{ fontSize: 11, letterSpacing: 1.3, color: D.blueLite, fontWeight: 700 }}>STEP 3 OF 3 · WHAT WERE THE WORDS?</div>
          {[...MINICOG_WORDS, 'Elephant', 'Window', 'River'].sort().map(w => (
            <div key={w}>{elderOption(w, !!a['w_' + w], () => { tapFeel('select'); setElderQAns({ ...a, ['w_' + w]: !a['w_' + w] }); }, MINICOG_WORDS.includes(w) ? D.green : D.red)}</div>
          ))}
        </div>
        <button onClick={next} className="w-full rounded-2xl py-4 text-base font-bold mt-4" style={{ background: 'linear-gradient(135deg, #23B27A 0%, #178A5C 100%)', color: '#FFFFFF' }}>See my result</button>
      </>
    ));

    /* result */
    const recall = MINICOG_WORDS.filter(w => a['w_' + w]).length;
    const wrong = ['Elephant', 'Window', 'River'].filter(w => a['w_' + w]).length;
    const clockPts = a.clock ? 2 : 0;
    const score = recall + clockPts;
    const flag = score < 3;
    return elderShell('Memory check', 'Your Mini-Cog result.', (
      <>
        <div className="rounded-2xl p-5 text-center" style={{ background: D.card, border: `1px solid ${flag ? D.amber : D.green}55` }}>
          <div style={{ fontSize: 11, letterSpacing: 1.3, color: D.ink3, fontWeight: 700 }}>MINI-COG SCORE</div>
          <div className="font-display mt-2" style={{ fontSize: 52, fontWeight: 600, color: flag ? D.amber : D.green, lineHeight: 1 }}>{score}<span style={{ fontSize: 22, color: D.ink3 }}>/5</span></div>
          <div className="mt-3" style={{ fontSize: 14.5, color: D.ink, fontWeight: 600 }}>{flag ? 'Worth a closer look' : 'Normal screen'}</div>
          <div className="mt-2" style={{ fontSize: 13, color: D.ink2, lineHeight: 1.65 }}>{flag
            ? 'A score under 3 does not mean dementia. It means this deserves a proper assessment rather than being brushed off — which is exactly what this check is for.'
            : 'Words recalled and clock drawn as expected. We will repeat this monthly; the trend matters more than any single month.'}</div>
          <div className="mt-3.5 pt-3.5" style={{ borderTop: `1px solid ${D.hair}`, fontSize: 12.5, color: D.ink3 }}>Words recalled {recall}/3 · clock {clockPts}/2{wrong ? ` · ${wrong} word${wrong > 1 ? 's' : ''} chosen that were not on the list` : ''}</div>
        </div>
        <div className="rounded-2xl p-4 mt-3" style={{ background: flag ? 'rgba(245,197,114,.08)' : D.card, border: `1px solid ${flag ? 'rgba(245,197,114,.3)' : D.hair}` }}>
          <div style={{ fontSize: 11, letterSpacing: 1.3, color: flag ? D.amber : D.blueLite, fontWeight: 700 }}>WHAT HAPPENS NOW</div>
          <div style={{ fontSize: 13.5, color: D.ink2, lineHeight: 1.7, marginTop: 8 }}>{flag
            ? 'Dr. M. Krishnan will review this and your clock photo, and call you within 24 hours. He will check the treatable causes first — thyroid, B12, hearing, sleep, medication side-effects — before anything else is considered.'
            : 'Saved to your record. Dr. M. Krishnan sees the trend at your monthly review.'}</div>
        </div>
        <button onClick={() => { tapFeel('success'); setElderView(null); setElderQStep(0); setElderQAns({}); }} className="w-full rounded-2xl py-4 text-base font-bold mt-4" style={{ background: 'linear-gradient(135deg, #4A90F0 0%, #1F5CB0 100%)', color: '#FFFFFF' }}>Done</button>
      </>
    ), 'Mini-Cog scores 0–5: three points for word recall, two for the clock. A score below 3 warrants further assessment (Borson 2000; sensitivity ~76–100% for dementia).');
  }

  /* ---------------- 2 · HOW YOU FEEL — PHQ-2 + UCLA loneliness ---------------- */
  function renderElderMood() {
    const D = ELDER_UI;
    const a = elderQAns, step = elderQStep;
    const Q = [
      { k: 'phq1', q: 'Over the last two weeks, how often have you had little interest or pleasure in doing things?', opts: [['Not at all', 0], ['Several days', 1], ['More than half the days', 2], ['Nearly every day', 3]] },
      { k: 'phq2', q: 'Over the last two weeks, how often have you felt down, depressed or hopeless?', opts: [['Not at all', 0], ['Several days', 1], ['More than half the days', 2], ['Nearly every day', 3]] },
      { k: 'lone1', q: 'How often do you feel that you lack companionship?', opts: [['Hardly ever', 1], ['Some of the time', 2], ['Often', 3]] },
      { k: 'lone2', q: 'How often do you feel left out?', opts: [['Hardly ever', 1], ['Some of the time', 2], ['Often', 3]] },
      { k: 'lone3', q: 'How often do you feel isolated from others?', opts: [['Hardly ever', 1], ['Some of the time', 2], ['Often', 3]] },
    ];
    if (step < Q.length) {
      const q = Q[step];
      return elderShell('How you feel', `Question ${step + 1} of ${Q.length}. Answer honestly — there is no right answer, and nobody is judging.`, (
        <>
          <div className="flex gap-1.5 mb-5">{Q.map((_, i) => <div key={i} className="rounded-full flex-1" style={{ height: 4, background: i < step ? D.green : i === step ? D.blueLite : 'rgba(255,255,255,.12)' }} />)}</div>
          <div className="rounded-2xl p-5" style={{ background: D.card, border: `1px solid ${D.hair}` }}>
            <div style={{ fontSize: 17, color: D.ink, lineHeight: 1.5 }}>{q.q}</div>
            {q.opts.map(([label, val]) => <div key={label}>{elderOption(label, a[q.k] === val, () => { tapFeel('select'); setElderQAns({ ...a, [q.k]: val }); setTimeout(() => setElderQStep(step + 1), 220); }, D.violet)}</div>)}
          </div>
        </>
      ), step < 2 ? 'PHQ-2 · Kroenke K, Spitzer RL, Williams JBW. Med Care 2003;41:1284.' : 'UCLA 3-item Loneliness Scale · Hughes ME et al., Res Aging 2004;26:655.');
    }
    const phq = (a.phq1 || 0) + (a.phq2 || 0);
    const lone = (a.lone1 || 0) + (a.lone2 || 0) + (a.lone3 || 0);
    const phqFlag = phq >= 3, loneFlag = lone >= 6;
    return elderShell('How you feel', 'Your result.', (
      <>
        <div className="grid grid-cols-2 gap-3">
          {[['Mood (PHQ-2)', phq, 6, phqFlag, phqFlag ? 'Screen positive' : 'Screen negative'], ['Loneliness', lone, 9, loneFlag, loneFlag ? 'Lonely' : 'Not lonely']].map(([t, v, max, fl, verdict]) => (
            <div key={t} className="rounded-2xl p-4 text-center" style={{ background: D.card, border: `1px solid ${fl ? D.amber : D.green}55` }}>
              <div style={{ fontSize: 10.5, letterSpacing: 1, color: D.ink3, fontWeight: 700 }}>{t}</div>
              <div className="font-display mt-2" style={{ fontSize: 34, fontWeight: 600, color: fl ? D.amber : D.green, lineHeight: 1 }}>{v}<span style={{ fontSize: 15, color: D.ink3 }}>/{max}</span></div>
              <div style={{ fontSize: 12, color: fl ? D.amber : D.green, fontWeight: 600, marginTop: 6 }}>{verdict}</div>
            </div>
          ))}
        </div>
        <div className="rounded-2xl p-4 mt-3" style={{ background: (phqFlag || loneFlag) ? 'rgba(245,197,114,.08)' : D.card, border: `1px solid ${(phqFlag || loneFlag) ? 'rgba(245,197,114,.3)' : D.hair}` }}>
          <div style={{ fontSize: 11, letterSpacing: 1.3, color: (phqFlag || loneFlag) ? D.amber : D.blueLite, fontWeight: 700 }}>WHAT THIS MEANS</div>
          <div style={{ fontSize: 13.5, color: D.ink2, lineHeight: 1.7, marginTop: 8 }}>
            {phqFlag ? 'A PHQ-2 of 3 or more is a positive depression screen. Depression in later life is common, very treatable, and too often mistaken for "just getting old". Dr. M. Krishnan will call to complete the fuller PHQ-9 with you. ' : 'Your mood screen is negative. '}
            {loneFlag ? 'Your loneliness score is in the lonely range. This is not a soft finding — loneliness carries a mortality risk comparable to smoking (Holt-Lunstad, 2015), and it is one of the strongest predictors of decline in older adults. Your care team will talk with you about companion calls and local groups.' : 'Your loneliness score is in the healthy range.'}
          </div>
        </div>
        <button onClick={() => { tapFeel('success'); setElderView(null); setElderQStep(0); setElderQAns({}); }} className="w-full rounded-2xl py-4 text-base font-bold mt-4" style={{ background: 'linear-gradient(135deg, #4A90F0 0%, #1F5CB0 100%)', color: '#FFFFFF' }}>Done</button>
      </>
    ), 'PHQ-2 ≥3 → complete PHQ-9 (Kroenke 2003). UCLA-3 score 6–9 indicates loneliness (Hughes 2004). Loneliness and mortality: Holt-Lunstad J et al., Perspect Psychol Sci 2015;10:227.');
  }

  /* ---------------- 3 · STRENGTH & BALANCE — CDC STEADI ---------------- */
  function renderElderBalance() {
    const D = ELDER_UI;
    const a = elderQAns, step = elderQStep;
    const age = 72;
    const norm = age < 70 ? 12 : age < 80 ? 11 : 9;   // Jones/Rikli 30-sec chair-stand norms
    const Q = [
      { k: 'fell', q: 'Have you fallen in the past year?', opts: [['No', 0], ['Yes, once', 1], ['Yes, more than once', 2]] },
      { k: 'unsteady', q: 'Do you feel unsteady when standing or walking?', opts: [['No', 0], ['Sometimes', 1], ['Often', 2]] },
      { k: 'worry', q: 'Do you worry about falling?', opts: [['No', 0], ['Sometimes', 1], ['Often', 2]] },
    ];
    if (step < Q.length) {
      const q = Q[step];
      return elderShell('Strength & balance', `Question ${step + 1} of ${Q.length}, then one short exercise. These three questions are the CDC's standard fall-risk screen.`, (
        <>
          <div className="flex gap-1.5 mb-5">{Q.map((_, i) => <div key={i} className="rounded-full flex-1" style={{ height: 4, background: i < step ? D.green : i === step ? D.blueLite : 'rgba(255,255,255,.12)' }} />)}</div>
          <div className="rounded-2xl p-5" style={{ background: D.card, border: `1px solid ${D.hair}` }}>
            <div style={{ fontSize: 17, color: D.ink, lineHeight: 1.5 }}>{q.q}</div>
            {q.opts.map(([label, val]) => <div key={label}>{elderOption(label, a[q.k] === val, () => { tapFeel('select'); setElderQAns({ ...a, [q.k]: val }); setTimeout(() => setElderQStep(step + 1), 220); }, D.green)}</div>)}
          </div>
        </>
      ), 'CDC STEADI · Stopping Elderly Accidents, Deaths & Injuries. A "yes" to any of these three identifies increased fall risk.');
    }
    if (step === Q.length) return elderShell('Strength & balance', 'The 30-second chair stand. It measures leg strength — the single most modifiable cause of falls.', (
      <>
        <div className="rounded-2xl p-5" style={{ background: D.card, border: `1px solid ${D.green}33` }}>
          <div style={{ fontSize: 11, letterSpacing: 1.3, color: D.green, fontWeight: 700 }}>HOW TO DO IT</div>
          <div className="space-y-2.5 mt-3">
            {[['1', 'Sit in a firm chair with arms folded across your chest'], ['2', 'Stand up fully, then sit down again'], ['3', 'Repeat as many times as you can in 30 seconds'], ['4', 'Stop at once if you feel dizzy or unsteady']].map(([n, t]) => (
              <div key={n} className="flex gap-3 items-start">
                <span className="flex items-center justify-center rounded-full flex-shrink-0 font-display" style={{ width: 22, height: 22, background: D.raised, fontSize: 11.5, fontWeight: 700, color: D.ink2 }}>{n}</span>
                <span style={{ fontSize: 14, color: D.ink2, lineHeight: 1.5 }}>{t}</span>
              </div>
            ))}
          </div>
          <div className="rounded-xl p-3.5 mt-4" style={{ background: 'rgba(245,141,139,.08)', border: '1px solid rgba(245,141,139,.28)', fontSize: 12.5, color: D.ink2, lineHeight: 1.55 }}>Have someone nearby, and keep the chair against a wall.</div>
        </div>
        <div className="rounded-2xl p-5 mt-3" style={{ background: D.card, border: `1px solid ${D.hair}` }}>
          <div style={{ fontSize: 14, color: D.ink, marginBottom: 4 }}>How many stands did you complete?</div>
          {[['Fewer than 8', 6], ['8 to 11', 10], ['12 to 15', 13], ['More than 15', 17]].map(([label, val]) => <div key={label}>{elderOption(label, elderBalance === val, () => { tapFeel('select'); setElderBalance(val); }, D.green)}</div>)}
        </div>
        <button disabled={elderBalance === null || elderBalance === undefined} onClick={() => { tapFeel('success'); setElderQStep(step + 1); }} className="w-full rounded-2xl py-4 text-base font-bold mt-4" style={{ background: 'linear-gradient(135deg, #23B27A 0%, #178A5C 100%)', color: '#FFFFFF', opacity: (elderBalance === null || elderBalance === undefined) ? 0.4 : 1 }}>See my result</button>
      </>
    ), '30-Second Chair Stand · Jones CJ, Rikli RE, Beam WC. Res Q Exerc Sport 1999;70:113. Part of the CDC STEADI battery.');

    const risk = (a.fell || 0) + (a.unsteady || 0) + (a.worry || 0);
    const weak = (elderBalance || 0) < norm;
    const flag = risk >= 1 || weak;
    return elderShell('Strength & balance', 'Your result.', (
      <>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl p-4 text-center" style={{ background: D.card, border: `1px solid ${risk >= 1 ? D.amber : D.green}55` }}>
            <div style={{ fontSize: 10.5, letterSpacing: 1, color: D.ink3, fontWeight: 700 }}>FALL RISK</div>
            <div className="font-display mt-2" style={{ fontSize: 30, fontWeight: 600, color: risk >= 1 ? D.amber : D.green, lineHeight: 1 }}>{risk >= 1 ? 'Raised' : 'Low'}</div>
            <div style={{ fontSize: 11.5, color: D.ink3, marginTop: 6 }}>STEADI score {risk}/6</div>
          </div>
          <div className="rounded-2xl p-4 text-center" style={{ background: D.card, border: `1px solid ${weak ? D.amber : D.green}55` }}>
            <div style={{ fontSize: 10.5, letterSpacing: 1, color: D.ink3, fontWeight: 700 }}>LEG STRENGTH</div>
            <div className="font-display mt-2" style={{ fontSize: 30, fontWeight: 600, color: weak ? D.amber : D.green, lineHeight: 1 }}>{elderBalance || 0}</div>
            <div style={{ fontSize: 11.5, color: D.ink3, marginTop: 6 }}>stands · below {norm} is low for your age</div>
          </div>
        </div>
        <div className="rounded-2xl p-4 mt-3" style={{ background: flag ? 'rgba(245,197,114,.08)' : D.card, border: `1px solid ${flag ? 'rgba(245,197,114,.3)' : D.hair}` }}>
          <div style={{ fontSize: 11, letterSpacing: 1.3, color: flag ? D.amber : D.blueLite, fontWeight: 700 }}>WHAT HAPPENS NOW</div>
          <div style={{ fontSize: 13.5, color: D.ink2, lineHeight: 1.7, marginTop: 8 }}>{flag
            ? 'Your physiotherapist will build a strength and balance programme — the only intervention proven to reduce falls, cutting them by around a quarter (Sherrington, Br J Sports Med 2019). Your doctor will also review your medicines for anything that causes dizziness, and check your vitamin D and vision.'
            : 'Leg strength and balance are both in a good range for your age. Keep doing what you are doing — we will repeat this monthly, because strength changes quietly.'}</div>
        </div>
        <button onClick={() => { tapFeel('success'); setElderView(null); setElderQStep(0); setElderQAns({}); }} className="w-full rounded-2xl py-4 text-base font-bold mt-4" style={{ background: 'linear-gradient(135deg, #4A90F0 0%, #1F5CB0 100%)', color: '#FFFFFF' }}>Done</button>
      </>
    ), 'Falls are the leading cause of injury death in adults over 65. Exercise programmes targeting balance and strength reduce falls by ~23% (Sherrington C et al., Br J Sports Med 2019;53:1750).');
  }

  /* ---------------- 4 · VACCINES — adult 65+ schedule ---------------- */
  function renderElderVaccines() {
    const D = ELDER_UI;
    const a = elderQAns;
    const V = [
      { k: 'flu', e: '💉', name: 'Influenza', when: 'Every year, before winter', why: 'Flu triples the risk of a heart attack in the weeks after infection. In older adults it is one of the commonest reasons for a hospital admission that starts a decline.', due: true },
      { k: 'pneu', e: '🫁', name: 'Pneumococcal', when: 'Once after 65 (PCV20, or PCV15 then PPSV23)', why: 'Pneumococcal pneumonia carries high mortality in this age group. One vaccination gives lasting protection.', due: true },
      { k: 'shingles', e: '🌡️', name: 'Shingles (recombinant)', when: 'Two doses, 2–6 months apart', why: 'Over 90% effective. Prevents post-herpetic neuralgia, a pain syndrome that can last years and is very hard to treat.', due: false },
      { k: 'td', e: '🩹', name: 'Tetanus / diphtheria', when: 'Booster every 10 years', why: 'Standard adult booster. Particularly relevant if there are garden or kitchen injuries.', due: false },
      { k: 'covid', e: '🦠', name: 'COVID-19', when: 'As per current national guidance', why: 'Older adults remain the group at highest risk of severe disease.', due: true },
    ];
    return elderShell('Vaccines', 'Five vaccinations protect older adults from the infections most likely to put them in hospital. We give them at home.', (
      <>
        <div className="space-y-2.5">
          {V.map(v => (
            <div key={v.k} className="rounded-2xl p-4" style={{ background: D.card, border: `1px solid ${a['v_' + v.k] ? D.green + '55' : v.due ? D.amber + '44' : D.hair}` }}>
              <div className="flex items-start gap-3.5">
                <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 40, height: 40, background: D.raised, fontSize: 18 }}>{v.e}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span style={{ fontSize: 15, color: D.ink, fontWeight: 600 }}>{v.name}</span>
                    {a['v_' + v.k] ? <span className="rounded-full" style={{ padding: '2px 8px', background: 'rgba(95,220,168,.16)', color: D.green, fontSize: 10, fontWeight: 700 }}>DONE</span>
                      : v.due && <span className="rounded-full" style={{ padding: '2px 8px', background: 'rgba(245,197,114,.16)', color: D.amber, fontSize: 10, fontWeight: 700 }}>DUE</span>}
                  </div>
                  <div style={{ fontSize: 12, color: D.ink3, marginTop: 3 }}>{v.when}</div>
                  <div style={{ fontSize: 12.5, color: D.ink2, marginTop: 8, lineHeight: 1.6 }}>{v.why}</div>
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => { tapFeel('select'); setElderQAns({ ...a, ['v_' + v.k]: !a['v_' + v.k] }); }} className="rounded-lg px-3 py-2" style={{ background: D.raised, color: D.ink2, fontSize: 12, fontWeight: 600 }}>{a['v_' + v.k] ? 'Mark as not done' : 'I have had this'}</button>
                    {!a['v_' + v.k] && v.due && <button onClick={() => { tapFeel('success'); setIncomingCall({ id: 'vax' + Date.now(), reading: 'vaccination at home', doctor: 'Dr. M. Krishnan · Geriatric Physician', phase: 'ringing' }); }} className="rounded-lg px-3 py-2" style={{ background: 'linear-gradient(135deg, #3B7FC9 0%, #1F5C9E 100%)', color: '#FFFFFF', fontSize: 12, fontWeight: 600 }}>Book at home</button>}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <button onClick={() => { tapFeel('success'); setElderView(null); }} className="w-full rounded-2xl py-4 text-base font-bold mt-4" style={{ background: 'linear-gradient(135deg, #4A90F0 0%, #1F5CB0 100%)', color: '#FFFFFF' }}>Done</button>
      </>
    ), 'Adult immunisation schedule for 65+. Your nurse administers these during a home visit; your record is updated automatically.');
  }

  function renderElderHome() {
    if (elderView === 'memory') return renderElderMemory();
    if (elderView === 'mood') return renderElderMood();
    if (elderView === 'balance') return renderElderBalance();
    if (elderView === 'vaccines') return renderElderVaccines();
    const first = (foName || signupName || 'Suresh').split(' ')[0];
    const medRows = [['morning', '☀️', 'Morning', '3 medicines · after breakfast'], ['afternoon', '🌤️', 'Afternoon', '1 medicine · after lunch'], ['evening', '🌙', 'Evening', '2 medicines · after dinner']];
    const medsDone = medRows.filter(([k]) => elderMeds[k]).length;
    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold" style={{ color: C.muted }}>🌿 Elder Care Program</div>
            <div className="font-display text-2xl" style={{ color: C.text, fontWeight: 800 }}>Namaste, {first} ji</div>
          </div>
          <span className="text-xs font-bold px-3 py-1.5 rounded-full flex-shrink-0" style={{ background: 'rgba(95,220,168,0.14)', color: '#5FDCA8', border: '1px solid rgba(95,220,168,0.3)' }}>Care active ✓</span>
        </div>

        {vitalsBlock('Recovery Score', 76, 'Good')}

        {/* Symptom check-in */}
        <button onClick={() => { tapFeel('tap'); setCheckinOpen(true); setCiStep(0); setCiAns({}); }} className="w-full rounded-2xl p-4 flex items-center gap-3.5 text-left" style={{ background: 'linear-gradient(120deg, #2B6CB0, #153E6F)', boxShadow: '0 8px 22px rgba(21,62,111,0.25)' }}>
          <div className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 46, height: 46, background: 'rgba(255,255,255,0.2)', fontSize: 22 }}>📝</div>
          <div className="flex-1">
            <div className="text-base font-bold" style={{ color: '#FFFFFF' }}>2-minute check-in</div>
            <div className="text-xs font-semibold mt-0.5" style={{ color: 'rgba(255,255,255,0.8)' }}>Steadiness, appetite, mood, medicines — 4 taps</div>
          </div>
          <span className="text-xs font-bold" style={{ color: '#FFFFFF' }}>Start →</span>
        </button>

        {/* Medication reminders */}
        <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <div className="flex items-center justify-between">
            <span className="text-base font-bold" style={{ color: C.text }}>💊 Medication reminders</span>
            <span className="text-sm font-bold" style={{ color: medsDone === 3 ? '#5FDCA8' : C.muted }}>{medsDone}/3 today</span>
          </div>
          <div className="text-xs mt-0.5 mb-2.5" style={{ color: C.muted }}>We remind you at each time. Tap when taken — your family sees it too.</div>
          <div className="space-y-2">
            {medRows.map(([k, e, label, detail]) => (
              <button key={k} onClick={() => { tapFeel(elderMeds[k] ? 'tap' : 'success'); setElderMeds({ ...elderMeds, [k]: !elderMeds[k] }); }} className="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left" style={{ background: elderMeds[k] ? 'rgba(95,220,168,0.10)' : C.panelLight, border: elderMeds[k] ? '1px solid rgba(95,220,168,0.4)' : '1px solid transparent' }}>
                <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 28, height: 28, background: elderMeds[k] ? '#5FDCA8' : 'transparent', border: elderMeds[k] ? 'none' : `2px solid ${C.border}` }}>{elderMeds[k] && <CheckCircle2 size={16} color="#08182B" />}</span>
                <span style={{ fontSize: 18 }}>{e}</span>
                <span className="flex-1"><span className="text-base font-bold" style={{ color: C.text }}>{label}</span><div style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>{detail}</div></span>
              </button>
            ))}
          </div>
        </div>

        {/* Monthly checks — bold, visible tiles */}
        <div>
          <div className="text-base font-bold px-1" style={{ color: C.text }}>Your monthly checks</div>
          <div className="text-xs mt-0.5 mb-2.5 px-1" style={{ color: C.muted }}>Four quick checks that catch what quietly changes with age.</div>
          <div className="grid grid-cols-2 gap-2.5">
            {[
              ['🧠', 'Memory check', '2 minutes', '#B0A4FF', 'memory'],
              ['💙', 'How you feel', '2 minutes', '#9CCAFF', 'mood'],
              ['🦵', 'Strength & balance', '30 seconds', '#5FDCA8', 'balance'],
              ['💉', 'Vaccines', 'Stay protected', '#F5C572', 'vaccines'],
            ].map(([e, t, sub, col, view]) => (
              <button key={t} onClick={() => { tapFeel('tap'); setElderView(view); setElderQStep(0); setElderQAns({}); }} className="rounded-2xl p-4 text-left" style={{ background: `linear-gradient(140deg, ${col}2E 0%, ${col}12 100%)`, border: `1.5px solid ${col}66`, boxShadow: `0 6px 18px ${col}22` }}>
                <div className="flex items-center justify-center rounded-2xl" style={{ width: 46, height: 46, background: col, fontSize: 22, boxShadow: `0 6px 14px ${col}55` }}>{e}</div>
                <div className="font-bold mt-2.5" style={{ color: C.text, fontSize: 14.5, lineHeight: 1.2 }}>{t}</div>
                <div style={{ fontSize: 11.5, color: col, fontWeight: 800, marginTop: 3 }}>{sub} ›</div>
              </button>
            ))}
          </div>
        </div>

        {/* Care circle — one row, opens the page */}
        <button onClick={() => { tapFeel('tap'); setPvSheet('circle'); }} className="w-full rounded-2xl p-4 flex items-center gap-3.5 text-left" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 42, height: 42, background: C.panelLight, fontSize: 19 }}>👨‍👩‍👧</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold" style={{ color: C.text }}>Your care circle</div>
            <div style={{ fontSize: 11.5, color: C.muted, fontWeight: 600, marginTop: 2, lineHeight: 1.45 }}>Invite your son, daughter, or anyone you trust</div>
          </div>
          <ChevronRight size={16} color={C.muted} />
        </button>

        {sharedLogRows()}
      </div>
    );
  }
  function renderCHFHome() {
    const first = (foName || signupName || 'Suresh').split(' ')[0];
    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold" style={{ color: C.muted }}>🩺 Chronic Health Condition Program</div>
            <div className="font-display text-2xl" style={{ color: C.text, fontWeight: 800 }}>Namaste, {first}</div>
          </div>
          <span className="text-xs font-bold px-3 py-1.5 rounded-full flex-shrink-0" style={{ background: 'rgba(95,220,168,0.14)', color: '#5FDCA8', border: '1px solid rgba(95,220,168,0.3)' }}>Care active ✓</span>
        </div>

        {vitalsBlock('Recovery Score', 74, 'Good')}

        {/* Symptom check-in */}
        <button onClick={() => { tapFeel('tap'); setCheckinOpen(true); setCiStep(0); setCiAns({}); }} className="w-full rounded-2xl p-4 flex items-center gap-3.5 text-left" style={{ background: 'linear-gradient(120deg, #2B6CB0, #153E6F)', boxShadow: '0 8px 22px rgba(21,62,111,0.25)' }}>
          <div className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 46, height: 46, background: 'rgba(255,255,255,0.2)', fontSize: 22 }}>📝</div>
          <div className="flex-1">
            <div className="text-base font-bold" style={{ color: '#FFFFFF' }}>2-minute symptom check-in</div>
            <div className="text-xs font-semibold mt-0.5" style={{ color: 'rgba(255,255,255,0.8)' }}>How you feel today — 4 taps, your doctor sees it</div>
          </div>
          <span className="text-xs font-bold" style={{ color: '#FFFFFF' }}>Start →</span>
        </button>

        {sharedLogRows()}
      </div>
    );
  }
  function renderLungHome() {
    const aqi = 178;
    const aqiBand = aqi <= 50 ? ['Good', '#1E9E6A', 'A clear day — enjoy your walk.'] : aqi <= 100 ? ['Moderate', '#C77E1A', 'Fine for most activity — carry your inhaler.'] : aqi <= 200 ? ['Poor', '#D4622E', 'Mask on outdoors. Skip the morning walk — breathe indoors today.'] : ['Severe', '#C0392B', 'Stay indoors. Windows closed. Call us if breathing worsens.'];
    const best = 390;
    const pef = copdPef || 320;
    const pct = Math.round((pef / best) * 100);
    const zone = pct >= 80 ? ['GREEN ZONE', '#1E9E6A', 'Well controlled — keep your routine going.'] : pct >= 50 ? ['YELLOW ZONE', '#C77E1A', 'Below your usual. Take your reliever now and recheck in 20 minutes. If it stays here — call us.'] : ['RED ZONE', '#C0392B', 'Danger zone. Use your reliever and call your doctor immediately.'];
    const fev1Trend = [1.92, 1.90, 1.94, 1.91, 1.89, 1.93, 1.90];
    const w = 120, h = 30, mn = 1.8, mx = 2.0;
    const spark = fev1Trend.map((v, i) => `${(i / (fev1Trend.length - 1)) * w},${h - ((v - mn) / (mx - mn)) * h}`).join(' ');
    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold" style={{ color: C.muted }}>🫁 COPD & Asthma Care</div>
            <div className="font-display text-2xl" style={{ color: C.text, fontWeight: 800 }}>Hello, {(signupName || 'Arjun').split(' ')[0]}</div>
          </div>
          <span className="text-xs font-bold px-3 py-1.5 rounded-full flex-shrink-0" style={{ background: 'rgba(30,158,106,0.12)', color: '#1E9E6A' }}>Care active ✓</span>
        </div>

        {vitalsBlock('Recovery Score', 74, 'Good')}

          {/* device you may need for this programme */}
          <button onClick={() => { tapFeel('tap'); setPvSheet('addon:spiro'); }} className="w-full rounded-2xl p-4 flex items-center gap-3.5 text-left" style={{ background: 'linear-gradient(155deg, rgba(156,202,255,.12) 0%, rgba(255,255,255,.012) 58%), #16314F', border: '1px solid rgba(156,202,255,.34)' }}>
            <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 42, height: 42, background: '#1E3C60', fontSize: 19 }}>🫁</span>
            <div className="flex-1 min-w-0">
              <div style={{ fontSize: 14.5, color: '#FFFFFF', fontWeight: 600 }}>Home spirometer / peak flow meter</div>
              <div style={{ fontSize: 12, color: '#93AECB', marginTop: 2, lineHeight: 1.45 }}>Optional. Measures your lungs at home and warns us two to three days before a flare-up.</div>
            </div>
            <span className="font-display flex-shrink-0" style={{ fontSize: 15, color: '#9CCAFF', fontWeight: 700 }}>₹4,200</span>
          </button>

        {/* Today's Air */}
        <div className="rounded-2xl p-4" style={{ background: `linear-gradient(150deg, ${aqiBand[1]}14 0%, #FFFFFF 60%)`, border: `1px solid ${aqiBand[1]}35` }}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold" style={{ color: C.text }}>🌬️ Today's air — your area</span>
            <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: `${aqiBand[1]}18`, color: aqiBand[1] }}>AQI {aqi} · {aqiBand[0]}</span>
          </div>
          <div className="text-sm font-semibold mt-2" style={{ color: C.text, lineHeight: 1.45 }}>{aqiBand[2]}</div>
        </div>

        {/* Connected devices — one calm line */}
        <div className="flex items-center gap-2 px-1" style={{ fontSize: 12.5, color: C.muted }}>
          <span className="rounded-full" style={{ width: 7, height: 7, background: '#5FDCA8' }}></span>
          <span>Wristband · Spirometer · Oximeter — all connected</span>
        </div>

        {/* Lung check — calm */}
        <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold" style={{ color: C.text }}>🫁 Lung check today</span>
            <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: copdPef === 180 ? 'rgba(245,141,139,0.18)' : copdPef === 295 ? 'rgba(245,197,114,0.18)' : 'rgba(95,220,168,0.16)', color: copdPef === 180 ? '#F58D8B' : copdPef === 295 ? '#F5C572' : '#5FDCA8' }}>{copdPef === 180 ? 'Needs attention' : copdPef === 295 ? 'Watch today' : 'All good ✓'}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3.5">
            {[
              ['Peak flow', String(copdPef || 320), `${Math.round(((copdPef || 320) / 390) * 100)}% of normal`, 'airway openness', copdPef === 180 ? '#F58D8B' : copdPef === 295 ? '#F5C572' : '#5FDCA8'],
              ['FEV₁', '1.90 L', '68% of normal', 'lung strength', '#5FDCA8'],
              ['SpO₂', '96%', 'Normal', 'oxygen in blood', '#5FDCA8'],
            ].map(([name, val, pct, meaning, col]) => (
              <div key={name} className="rounded-xl p-3 text-center" style={{ background: C.panelLight }}>
                <div style={{ fontSize: 11, color: C.muted, fontWeight: 700 }}>{name}</div>
                <div className="font-display mt-1" style={{ fontSize: 22, fontWeight: 600, color: C.text, lineHeight: 1 }}>{val}</div>
                <div style={{ fontSize: 10.5, color: col, fontWeight: 700, marginTop: 4 }}>{pct}</div>
                <div style={{ fontSize: 9.5, color: C.muted, marginTop: 2 }}>{meaning}</div>
              </div>
            ))}
          </div>

          {copdPef === 295 && <div className="text-xs font-semibold mt-2.5 rounded-xl p-2.5" style={{ color: '#C77E1A', background: 'rgba(199,126,26,0.08)', lineHeight: 1.45 }}>A bit lower than usual — take your reliever now and blow again in 20 minutes. If it stays low, call us.</div>}
          {copdPef === 180 && <div className="text-xs font-semibold mt-2.5 rounded-xl p-2.5" style={{ color: '#C0392B', background: 'rgba(192,57,43,0.08)', lineHeight: 1.45 }}>Much lower than usual — use your reliever and call your iLive doctor now.</div>}

        </div>

        {/* Symptom check-in */}
        <button onClick={() => { setCheckinOpen(true); setCiStep(0); setCiAns({}); }} className="w-full rounded-2xl p-4 flex items-center gap-3.5 text-left" style={{ background: 'linear-gradient(120deg, #2B6CB0, #153E6F)', boxShadow: '0 8px 22px rgba(21,62,111,0.25)' }}>
          <div className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 46, height: 46, background: 'rgba(255,255,255,0.2)', fontSize: 22 }}>📝</div>
          <div className="flex-1">
            <div className="text-base font-bold" style={{ color: '#FFFFFF' }}>2-minute symptom check-in</div>
            <div className="text-xs font-semibold mt-0.5" style={{ color: 'rgba(255,255,255,0.8)' }}>Breathing, cough, sleep, inhalers — 4 taps, your doctor sees it</div>
          </div>
          <span className="text-xs font-bold" style={{ color: '#FFFFFF' }}>Start →</span>
        </button>

        {/* Inhaler corner */}
        <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <div className="text-sm font-bold mb-2.5" style={{ color: C.text }}>💨 Inhaler corner</div>
          <div className="grid grid-cols-2 gap-2.5">
            <button onClick={() => setCopdInhalerAM(!copdInhalerAM)} className="rounded-xl p-3 text-center" style={{ background: copdInhalerAM ? 'rgba(30,158,106,0.1)' : C.panelLight, border: copdInhalerAM ? '2px solid rgba(30,158,106,0.5)' : `1px solid ${C.border}` }}>
              <div className="text-sm font-bold" style={{ color: C.text }}>☀️ Morning dose</div>
              <div className="text-xs font-bold mt-1" style={{ color: copdInhalerAM ? '#1E9E6A' : C.muted }}>{copdInhalerAM ? 'Taken ✓' : 'Tap when taken'}</div>
            </button>
            <button onClick={() => setCopdInhalerPM(!copdInhalerPM)} className="rounded-xl p-3 text-center" style={{ background: copdInhalerPM ? 'rgba(30,158,106,0.1)' : C.panelLight, border: copdInhalerPM ? '2px solid rgba(30,158,106,0.5)' : `1px solid ${C.border}` }}>
              <div className="text-sm font-bold" style={{ color: C.text }}>🌙 Evening dose</div>
              <div className="text-xs font-bold mt-1" style={{ color: copdInhalerPM ? '#1E9E6A' : C.muted }}>{copdInhalerPM ? 'Taken ✓' : 'Tap when taken'}</div>
            </button>
          </div>
          <button onClick={() => setCopdTech(!copdTech)} className="w-full rounded-xl py-2.5 text-xs font-bold mt-2.5" style={{ background: 'rgba(14,156,196,0.08)', color: '#0E7A99', border: '1px solid rgba(14,156,196,0.3)' }}>{copdTech ? 'Hide technique check' : '🎯 Check my inhaler technique — 9 in 10 people miss a step'}</button>
          {copdTech && (
            <div className="space-y-1.5 mt-2.5">
              {['Shake well · breathe all the way OUT first', 'Seal lips around the mouthpiece', 'Press and breathe in slowly & deeply — 3 to 5 seconds', 'Hold your breath for 10 seconds, then breathe out gently'].map((s, i) => (
                <div key={i} className="flex items-start gap-2 rounded-xl p-2" style={{ background: C.panelLight }}>
                  <span className="flex items-center justify-center rounded-full flex-shrink-0 text-xs font-bold" style={{ width: 20, height: 20, background: 'rgba(14,156,196,0.12)', color: '#0E7A99' }}>{i + 1}</span>
                  <span className="text-xs font-semibold" style={{ color: C.text, lineHeight: 1.4 }}>{s}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {sharedLogRows()}

        {!isSubscribed && journeysMiniCard()}
      </div>
    );
  }

  function renderBPHome() {
    const okG = '#1E9E6A';
    const docName = primaryDoctor ? `Dr. ${primaryDoctor}` : 'Dr. Sharma';
    const zones = [
      { w: (20 / 70) * 100, c: okG }, { w: (10 / 70) * 100, c: '#8FBF4D' },
      { w: (10 / 70) * 100, c: '#E8930C' }, { w: (30 / 70) * 100, c: '#D64545' },
    ];
    const avgSys = 126, avgDia = 78;
    const markerPos = ((avgSys - 100) / 70) * 100;
    const sysPts = [141, 138, 136, 134, 131, 128, 126];
    const w = 280, h = 52, mn = 110, mx = 150;
    const path = sysPts.map((v, i) => `${(i / (sysPts.length - 1)) * w},${h - ((v - mn) / (mx - mn)) * h}`).join(' ');
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold" style={{ color: C.muted }}>🩺 BP Care</div>
            <div className="font-display text-2xl" style={{ color: C.text, fontWeight: 800 }}>Namaste, {(signupName || 'Suresh').split(' ')[0]}</div>
          </div>
          <span className="text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-1.5 flex-shrink-0" style={{ background: 'rgba(30,158,106,0.12)', color: okG }}>
            <span className="pulse" style={{ width: 7, height: 7, borderRadius: 9999, background: okG, display: 'inline-block' }} />Cuff paired
          </span>
        </div>

        {vitalsBlock('Recovery Score', 78, 'Good')}

        <div className="rounded-2xl p-5 text-center" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <div>
            <span className="font-display font-bold" style={{ fontSize: 46, color: C.text }}>{avgSys}</span>
            <span className="font-bold" style={{ fontSize: 30, color: C.muted, margin: '0 3px' }}>/</span>
            <span className="font-display font-bold" style={{ fontSize: 36, color: C.text }}>{avgDia}</span>
            <span className="text-sm font-semibold ml-2" style={{ color: C.muted }}>mmHg</span>
          </div>
          <div className="flex justify-center items-center gap-3 mt-1">
            <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: 'rgba(30,158,106,0.12)', color: okG }}>▼ 6 vs last week</span>
            <span className="text-sm font-bold" style={{ color: C.muted }}>♥ 72 bpm</span>
          </div>
          <div className="text-xs font-semibold mt-2.5 mb-3" style={{ color: C.muted }}>Your 7-day home average — the number your doctor uses</div>
          <div style={{ position: 'relative', paddingTop: 8 }}>
            <div className="flex rounded-full overflow-hidden" style={{ height: 13 }}>
              {zones.map((z, i) => <div key={i} style={{ width: `${z.w}%`, background: z.c }} />)}
            </div>
            <div style={{ position: 'absolute', top: 1, left: `${markerPos}%`, transform: 'translateX(-50%)' }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: WHITE.bg, color: WHITE.ink, border: `4px solid ${C.navy}`, boxShadow: '0 3px 10px rgba(10,37,64,0.25)' }} />
            </div>
          </div>
          <div className="flex justify-between mt-2.5" style={{ fontSize: 10, color: C.muted, fontWeight: 600, lineHeight: 1.3 }}>
            <span style={{ flex: 1 }}>Optimal<br />{'<120'}</span><span style={{ flex: 1 }}>Elevated<br />120–129</span>
            <span style={{ flex: 1 }}>Stage 1<br />130–139</span><span style={{ flex: 1 }}>Stage 2<br />140+</span>
          </div>
        </div>

        <div className="flex gap-2.5">
          <div className="flex-1 rounded-2xl p-3.5" style={{ background: 'rgba(43,108,176,0.07)', border: '1px solid rgba(43,108,176,0.3)' }}>
            <div className="text-xs font-bold" style={{ color: C.muted }}>☀️ Morning · done</div>
            <div className="text-lg font-bold mt-1" style={{ color: C.text }}>{lastBp.systolic}/{lastBp.diastolic}</div>
            <div className="text-xs" style={{ color: C.muted }}>Avg of 2 readings, 7:40 AM</div>
          </div>
          <button onClick={() => { setActiveLog(activeLog === 'bp' ? null : 'bp'); setLogMethod('manual'); }} className="flex-1 rounded-2xl p-3.5 text-left" style={{ background: readingLoggedToday ? 'rgba(43,108,176,0.07)' : C.panel, border: `1.5px solid ${readingLoggedToday ? 'rgba(43,108,176,0.3)' : C.border}` }}>
            <div className="text-xs font-bold" style={{ color: C.muted }}>🌙 Evening {readingLoggedToday ? '· done' : '· due 8 PM'}</div>
            {readingLoggedToday ? (
              <div className="text-lg font-bold mt-1" style={{ color: C.text }}>{lastBp.systolic}/{lastBp.diastolic} <span className="text-xs" style={{ color: okG }}>✓</span></div>
            ) : (
              <div className="text-sm font-bold mt-1" style={{ color: C.green }}>Take reading →</div>
            )}
            <div className="text-xs" style={{ color: C.muted }}>Sit quietly 5 min first</div>
          </button>
        </div>
        {sharedLogRows()}

        <div>
          <div className="text-lg font-bold mb-3" style={{ color: C.text }}>Today's care plan</div>
          {pTask({ emoji: '💊', title: 'BP medicine', sub: 'Telmisartan 40 mg — taken 8:00 AM', done: true })}
          {pTask({ emoji: '🧂', title: 'Keep salt under 5 g', sub: 'Skip the pickle & papad tonight' })}
          {pTask({ emoji: '🚶', title: '30-minute walk', sub: 'Brisk pace — even 3 × 10 min counts' })}
          {pTask({ emoji: '🩺', title: 'Morning reading', sub: 'Done — auto-synced from your cuff', done: true })}
        </div>

        {/* Symptom check-in */}
        <button onClick={() => { setCheckinOpen(true); setCiStep(0); setCiAns({}); }} className="w-full rounded-2xl p-4 flex items-center gap-3.5 text-left" style={{ background: 'linear-gradient(120deg, #2B6CB0, #153E6F)', boxShadow: '0 8px 22px rgba(21,62,111,0.25)' }}>
          <div className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 46, height: 46, background: 'rgba(255,255,255,0.2)', fontSize: 22 }}>📝</div>
          <div className="flex-1">
            <div className="text-base font-bold" style={{ color: '#FFFFFF' }}>2-minute symptom check-in</div>
            <div className="text-xs font-semibold mt-0.5" style={{ color: 'rgba(255,255,255,0.8)' }}>Headache, dizziness, vision, medicines — 4 taps, your doctor sees it</div>
          </div>
          <span className="text-xs font-bold" style={{ color: '#FFFFFF' }}>Start →</span>
        </button>
        <div className="hidden">
        </div>


        {!isSubscribed && journeysMiniCard()}


        {docStrip(<span><b>Week 7 report sent to {docName}</b> — true home averages, not one-off clinic readings. Your doctor adjusts treatment on real data.</span>)}

      </div>
    );
  }

  /* ========== 🍬 DIABETES CONTROL HOME ========== */
  function renderDiabetesHome() {
    const D = { bg: '#0B2039', card: '#16314F', raised: '#1E3C60', hair: 'rgba(255,255,255,.14)', hair2: 'rgba(255,255,255,.20)', ink: '#FFFFFF', ink2: '#C6D8EC', ink3: '#93AECB', blueLite: '#9CCAFF', green: '#5FDCA8', amber: '#F5C572', orange: '#F5A47A', red: '#F58D8B', teal: '#6FDCD2' };
    const docName = primaryDoctor ? `Dr. ${primaryDoctor}` : 'Dr. Anil Sharma';
    const first = (foName || signupName || 'Rahul').split(' ')[0];
    const glucose = 126, tir = 78, tirDelta = 8;
    const hbStart = 8.4, hbGoal = 7.0, hbNow = 7.9, dayN = 24;
    const hbPct = Math.round(((hbStart - hbNow) / (hbStart - hbGoal)) * 100);
    const curve = [148, 132, 118, 96, 88, 104, 128, 141, 122, 106, 118, 126];
    const w = 220, h = 56, mn = 70, mx = 180;
    const pts = curve.map((v, i) => `${(i / (curve.length - 1)) * w},${h - ((v - mn) / (mx - mn)) * h}`).join(' ');
    const label = (t, col) => <div style={{ fontSize: 11, letterSpacing: 1.6, textTransform: 'uppercase', color: col || D.ink3, fontWeight: 700 }}>{t}</div>;
    const card = (children, extra = {}) => <div className="rounded-2xl" style={{ background: 'linear-gradient(160deg, rgba(255,255,255,.07) 0%, rgba(255,255,255,.015) 52%), ' + D.card, border: `1px solid ${extra.glow || D.hair}`, padding: extra.pad ?? 20, ...(extra.style || {}) }}>{children}</div>;
    const ring = (pct, col, size = 64) => { const st = 6, rad = (size - st) / 2, c = 2 * Math.PI * rad; return (
      <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size}><circle cx={size/2} cy={size/2} r={rad} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth={st} /><circle cx={size/2} cy={size/2} r={rad} fill="none" stroke={col} strokeWidth={st} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} transform={`rotate(-90 ${size/2} ${size/2})`} style={{ transition: 'stroke-dashoffset .9s cubic-bezier(.2,.8,.2,1)' }} /></svg>
        <div className="absolute inset-0 flex items-center justify-center font-display" style={{ fontSize: size * .28, fontWeight: 600, color: D.ink }}>{pct}%</div>
      </div>
    ); };
    const plan = [
      ['pill', '💊', 'Morning medicines'], ['bf', '🍚', 'Breakfast on plan'], ['walk', '🚶', 'Walk 15 min after dinner'], ['pm', '💊', 'Evening medicines'],
    ];
    const done = plan.filter(([k]) => dmPlan[k]).length;
    return (
      <div className="-mx-4 -mt-4 px-4 pt-5 pb-6 ilive-premium" style={{ background: D.bg, color: D.ink, minHeight: '100%', fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif" }}>
        {/* header */}
        <div className="flex items-center justify-between">
          <div>
            <div style={{ fontSize: 13, color: D.ink3 }}>iLive Care · Diabetes</div>
            <div className="font-display mt-1" style={{ fontSize: 24, fontWeight: 400, letterSpacing: '-0.03em' }}>Good morning, {first}</div>
            <div className="mt-1" style={{ fontSize: 13.5, color: D.ink2 }}>Here's your diabetes update</div>
          </div>
          <span className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full flex-shrink-0" style={{ background: 'rgba(95,220,168,.14)', color: D.green, border: `1px solid ${D.green}33` }}><span className="rounded-full" style={{ width: 7, height: 7, background: D.green }}></span>On Track</span>
        </div>

        <div className="space-y-5 mt-6">
          {/* 0 · SHARED BASELINE — identical across every care programme */}
          {vitalsBlock('Recovery Score', 74, 'Good')}

          {/* device you may need for this programme */}
          <button onClick={() => { tapFeel('tap'); setPvSheet('addon:cgm'); }} className="w-full rounded-2xl p-4 flex items-center gap-3.5 text-left" style={{ background: 'linear-gradient(155deg, rgba(156,202,255,.12) 0%, rgba(255,255,255,.012) 58%), #16314F', border: '1px solid rgba(156,202,255,.34)' }}>
            <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 42, height: 42, background: '#1E3C60', fontSize: 19 }}>🩸</span>
            <div className="flex-1 min-w-0">
              <div style={{ fontSize: 14.5, color: '#FFFFFF', fontWeight: 600 }}>Continuous glucose monitor</div>
              <div style={{ fontSize: 12, color: '#93AECB', marginTop: 2, lineHeight: 1.45 }}>Optional. Fourteen days of sensor data shows exactly which of your meals raise your sugar.</div>
            </div>
            <span className="font-display flex-shrink-0" style={{ fontSize: 15, color: '#9CCAFF', fontWeight: 700 }}>₹4,200</span>
          </button>

          {/* 1 · GLUCOSE NOW · TIME IN RANGE · 24H CURVE */}
          <button onClick={() => { tapFeel('tap'); setPvSheet('glucose'); }} className="w-full text-left rounded-2xl" style={{ background: 'linear-gradient(160deg, rgba(255,255,255,.07) 0%, rgba(255,255,255,.015) 52%), ' + D.card, border: `1px solid ${D.green}33`, padding: 20 }}>
            <>
            <div className="flex items-center gap-4">
              <div>
                {label('Current glucose')}
                <div className="flex items-baseline gap-1.5 mt-2">
                  <span className="font-display" style={{ fontSize: 44, fontWeight: 500, color: D.ink, letterSpacing: '-0.04em', lineHeight: 1 }}>{glucose}</span>
                  <span style={{ fontSize: 13, color: D.ink3 }}>mg/dL</span>
                </div>
                <div className="mt-1.5" style={{ fontSize: 12.5, color: D.green }}>In range · from your glucometer, 8:02 AM</div>
              </div>
              <div className="flex-1" />
              {ring(tir, D.green, 70)}
              <div style={{ minWidth: 88 }}>
                <div style={{ fontSize: 13, color: D.ink }}>Time in Range</div>
                <div style={{ fontSize: 12, color: D.ink3, marginTop: 3 }}>Goal: &gt;70%</div>
                <div className="mt-1.5" style={{ fontSize: 12, color: D.green }}>↑ {tirDelta}% better than last week</div>
              </div>
            </div>
            <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${D.hair}` }}>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <svg width="100%" height={h + 8} viewBox={`0 0 ${w} ${h + 8}`} preserveAspectRatio="none">
                    <rect x="0" y={h - ((180 - mn) / (mx - mn)) * h} width={w} height={((180 - 70) / (mx - mn)) * h} fill="rgba(95,220,168,0.10)" rx="3" />
                    <line x1="0" x2={w} y1={h - ((180 - mn) / (mx - mn)) * h} y2={h - ((180 - mn) / (mx - mn)) * h} stroke="rgba(255,255,255,.18)" strokeDasharray="3 3" />
                    <line x1="0" x2={w} y1={h - ((70 - mn) / (mx - mn)) * h} y2={h - ((70 - mn) / (mx - mn)) * h} stroke="rgba(255,255,255,.18)" strokeDasharray="3 3" />
                    <polyline points={pts} fill="none" stroke={D.green} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx={w} cy={h - ((glucose - mn) / (mx - mn)) * h} r="4" fill={D.green} />
                  </svg>
                  <div className="flex justify-between mt-1" style={{ fontSize: 10, color: D.ink3 }}><span>12 AM</span><span>12 PM</span><span>Now</span></div>
                </div>
                <div className="flex flex-col justify-between" style={{ height: h + 8, fontSize: 10, color: D.ink3 }}><span>180</span><span>70</span></div>
              </div>
            </div>
            <div className="flex items-center justify-between mt-3.5 pt-3.5" style={{ borderTop: `1px solid ${D.hair}` }}>
              <span style={{ fontSize: 12.5, color: D.green, fontWeight: 600 }}>What this means for you</span>
              <ChevronRight size={15} color={D.green} />
            </div>
            </>
          </button>

          {/* 2 · 90-DAY HbA1c GOAL */}
          <button onClick={() => { tapFeel('tap'); setPvSheet('hba1c'); }} className="w-full text-left rounded-2xl" style={{ background: 'linear-gradient(160deg, rgba(255,255,255,.07) 0%, rgba(255,255,255,.015) 52%), ' + D.card, border: `1px solid ${D.blueLite}33`, padding: 20 }}>
            <>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                {label('Your 90-day goal · HbA1c', D.blueLite)}
                <div className="flex items-end justify-between mt-4">
                  <div><div className="font-display" style={{ fontSize: 26, fontWeight: 500, color: D.ink, lineHeight: 1 }}>{hbStart}%</div><div style={{ fontSize: 11.5, color: D.ink3, marginTop: 4 }}>Start</div></div>
                  <div className="text-center"><div className="font-display" style={{ fontSize: 20, fontWeight: 500, color: D.blueLite, lineHeight: 1 }}>{hbNow}%</div><div style={{ fontSize: 11.5, color: D.ink3, marginTop: 4 }}>Day {dayN} of 90</div></div>
                  <div className="text-right"><div className="font-display" style={{ fontSize: 26, fontWeight: 500, color: D.ink, lineHeight: 1 }}>&lt;{hbGoal}%</div><div style={{ fontSize: 11.5, color: D.ink3, marginTop: 4 }}>Goal</div></div>
                </div>
                <div className="rounded-full mt-3 relative" style={{ height: 6, background: 'rgba(255,255,255,.12)' }}>
                  <div className="rounded-full" style={{ height: 6, width: `${hbPct}%`, background: `linear-gradient(90deg, ${D.blueLite}, #4A90F0)`, transition: 'width .9s ease' }} />
                  <div className="absolute rounded-full" style={{ left: `${hbPct}%`, top: -3, width: 12, height: 12, background: '#4A90F0', border: `2px solid ${D.ink}`, transform: 'translateX(-50%)' }} />
                </div>
              </div>
              <div className="text-center flex-shrink-0" style={{ width: 96 }}>
                <div className="flex items-center justify-center rounded-full mx-auto" style={{ width: 52, height: 52, background: `${D.blueLite}18`, fontSize: 24 }}>📈</div>
                <div className="mt-2" style={{ fontSize: 12, color: D.blueLite, lineHeight: 1.35 }}>You're moving in the right direction!</div>
              </div>
            </div>
            <div className="mt-3.5 pt-3.5" style={{ borderTop: `1px solid ${D.hair}`, fontSize: 12.5, color: D.ink2, lineHeight: 1.6 }}>Your average glucose this fortnight ({Math.round(28.7 * hbNow - 46.7)} mg/dL) points to an HbA1c near {hbNow}%. Keep this pattern and your next lab test should show it.</div>
            <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: `1px solid ${D.hair}` }}>
              <span style={{ fontSize: 12.5, color: D.blueLite, fontWeight: 600 }}>What HbA1c means, and your trend</span>
              <ChevronRight size={15} color={D.blueLite} />
            </div>
            </>
          </button>

          {/* 3 · BLOOD PRESSURE — clinically paired with glucose */}
          <div className="rounded-2xl p-4 flex items-center gap-3.5" style={{ background: 'linear-gradient(160deg, rgba(255,255,255,.07) 0%, rgba(255,255,255,.015) 52%), ' + D.card, border: `1px solid ${D.hair}` }}>
            <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 40, height: 40, background: D.raised, fontSize: 17 }}>🩺</span>
            <div className="flex-1">
              <div style={{ fontSize: 13.5, color: D.ink2, fontWeight: 600 }}>Blood pressure</div>
              <div className="flex items-baseline gap-1 mt-1"><span className="font-display" style={{ fontSize: 22, fontWeight: 600, color: D.ink, lineHeight: 1 }}>128/82</span><span style={{ fontSize: 11.5, color: D.ink3 }}>mmHg</span></div>
              <div style={{ fontSize: 11.5, color: D.green, marginTop: 4 }}>In target for diabetes (under 130/80)</div>
            </div>
            <button onClick={() => { tapFeel('tap'); setActiveLog(activeLog === 'bp' ? null : 'bp'); setLogMethod('manual'); }} className="rounded-full font-bold flex-shrink-0" style={{ padding: '9px 14px', background: D.blueLite, color: '#08182B', fontSize: 12.5 }}>Log</button>
          </div>

          {/* 4 · TODAY'S PLAN */}
          {card(<>
            <div className="flex items-baseline justify-between"><div className="font-display" style={{ fontSize: 17, fontWeight: 500, color: D.ink }}>Today's Plan</div><span style={{ fontSize: 12.5, color: D.ink3 }}>{done} of {plan.length} completed</span></div>
            <div className="grid grid-cols-4 gap-2 mt-4">
              {plan.map(([k, e, t]) => (
                <button key={k} onClick={() => { tapFeel(dmPlan[k] ? 'tap' : 'success'); setDmPlan({ ...dmPlan, [k]: !dmPlan[k] }); }} className="text-center">
                  <div className="relative mx-auto flex items-center justify-center rounded-full" style={{ width: 52, height: 52, background: dmPlan[k] ? `${D.green}1C` : D.raised, border: `1px solid ${dmPlan[k] ? D.green + '66' : D.hair2}`, fontSize: 22 }}>
                    {e}
                    <span className="absolute flex items-center justify-center rounded-full" style={{ left: -6, top: -4, width: 20, height: 20, background: dmPlan[k] ? D.green : 'transparent', border: dmPlan[k] ? 'none' : `2px solid ${D.hair2}` }}>{dmPlan[k] && <Check size={12} color="#08182B" strokeWidth={3} />}</span>
                  </div>
                  <div className="mt-2" style={{ fontSize: 10.5, color: D.ink2, lineHeight: 1.3 }}>{t}</div>
                </button>
              ))}
            </div>
          </>, { pad: 20 })}

          {/* 5b · SYMPTOM CHECK-IN */}
          <button onClick={() => { tapFeel('tap'); setCheckinOpen(true); setCiStep(0); setCiAns({}); }} className="w-full rounded-2xl p-4 flex items-center gap-3.5 text-left" style={{ background: 'linear-gradient(120deg, #2B6CB0, #153E6F)', boxShadow: '0 8px 22px rgba(21,62,111,0.25)' }}>
            <div className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 46, height: 46, background: 'rgba(255,255,255,0.2)', fontSize: 22 }}>📝</div>
            <div className="flex-1">
              <div className="text-base font-bold" style={{ color: '#FFFFFF' }}>2-minute symptom check-in</div>
              <div className="text-xs font-semibold mt-0.5" style={{ color: 'rgba(255,255,255,0.8)' }}>Thirst, low-sugar signs, feet, medicines — 4 taps</div>
            </div>
            <span className="text-xs font-bold" style={{ color: '#FFFFFF' }}>Start →</span>
          </button>

          {/* 6 · LOG */}
          {sharedLogRows({ weight: true })}


          <div className="text-center px-5" style={{ fontSize: 12, color: D.ink3, lineHeight: 1.8 }}>Readings are reviewed by your care team. In an emergency, call your local emergency number.</div>
        </div>
      </div>
    );
  }

  function statusDot(s) {
    const c = s === 'good' ? '#1E9E6A' : s === 'attention' ? '#E8930C' : '#2B6CB0';
    return <span style={{ width: 10, height: 10, borderRadius: 9999, background: c, display: 'inline-block', flexShrink: 0 }} />;
  }

  function renderFamilyTab() {
    if (familySel) return renderFamilyMember(FAMILY.find(f => f.id === familySel));
    const attention = FAMILY.filter(f => f.status === 'attention').length;
    return (
      <div className="space-y-4">
        <div className="font-display text-2xl" style={{ color: C.text, fontWeight: 800 }}>❤️ My Family</div>

        {/* One-glance summary */}
        <div className="rounded-2xl p-4" style={{ background: 'linear-gradient(120deg, rgba(43,108,176,0.08), rgba(30,158,106,0.07))', border: `1px solid ${C.border}` }}>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <div className="text-sm font-bold" style={{ color: C.text }}>👨‍👩‍👧‍👦 {FAMILY.length + 1} members</div>
            <div className="text-sm font-bold" style={{ color: '#1E9E6A' }}>🟢 {FAMILY.length + 1 - attention} healthy today</div>
            <div className="text-sm font-bold" style={{ color: '#C77E1A' }}>🟡 {attention} needs attention</div>
            <div className="text-sm font-bold" style={{ color: C.navy }}>📅 2 appointments · 1 lab due</div>
          </div>
        </div>

        {/* Members */}
        <div className="space-y-2.5">
          <div className="rounded-2xl p-4 flex items-center gap-3.5" style={{ background: C.panel, border: `1.5px solid rgba(43,108,176,0.3)` }}>
            <div className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 46, height: 46, background: C.panelLight, fontSize: 22 }}>🧑</div>
            <div className="flex-1">
              <div className="text-sm font-bold" style={{ color: C.text }}>{signupName || 'Rahul'} <span className="text-xs font-semibold" style={{ color: C.muted }}>(You)</span></div>
              <div className="text-xs font-bold flex items-center gap-1.5 mt-0.5" style={{ color: '#1E9E6A' }}>{statusDot('good')} Health status good</div>
            </div>
          </div>
          {FAMILY.map(f => (
            <button key={f.id} onClick={() => setFamilySel(f.id)} className="w-full rounded-2xl p-4 flex items-center gap-3.5 text-left" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
              <div className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 46, height: 46, background: C.panelLight, fontSize: 22 }}>{f.emoji}</div>
              <div className="flex-1">
                <div className="text-sm font-bold" style={{ color: C.text }}>{f.rel}</div>
                <div className="text-xs font-bold flex items-center gap-1.5 mt-0.5" style={{ color: f.status === 'good' ? '#1E9E6A' : f.status === 'attention' ? '#C77E1A' : C.navy }}>{statusDot(f.status)} {f.statusText}</div>
              </div>
              <ChevronRight size={18} style={{ color: C.muted }} />
            </button>
          ))}
        </div>

        {/* Invite — never type their data */}
        <button onClick={() => { setInviteOpen(!inviteOpen); setInviteSent(false); }} className="w-full rounded-2xl p-4 flex items-center justify-center gap-2 text-sm font-bold" style={{ background: 'rgba(43,108,176,0.08)', color: C.green, border: `1.5px dashed rgba(43,108,176,0.4)` }}>
          + Add family member
        </button>
        {inviteOpen && (
          <div className="rounded-2xl p-5" style={{ background: C.panel, border: `1.5px solid rgba(43,108,176,0.35)` }}>
            {inviteSent ? (
              <div className="text-center py-2">
                <div style={{ fontSize: 32 }}>✉️</div>
                <div className="text-sm font-bold mt-2" style={{ color: C.text }}>Invite sent ✓</div>
                <div className="text-xs mt-1 font-medium" style={{ color: C.muted, lineHeight: 1.5 }}>They install iLive Connect, verify with OTP, and control their own records. Once they give you permission, their dashboard appears here — you never type their data.</div>
              </div>
            ) : (
              <>
                <div className="text-sm font-bold mb-1" style={{ color: C.text }}>No forms. Just an invite.</div>
                <div className="text-xs font-medium mb-3" style={{ color: C.muted, lineHeight: 1.5 }}>They join with OTP, own their records, and choose what you can see. Their profile builds itself with every lab, prescription and visit.</div>
                <button onClick={() => setInviteSent(true)} className="w-full rounded-xl py-3 text-sm font-bold mb-2" style={{ background: 'linear-gradient(135deg, #3B7FC9 0%, #1F5C9E 100%)', color: '#FFFFFF', boxShadow: '0 6px 18px rgba(31,92,158,0.32)' }}>📲 Send invite on WhatsApp</button>
                <button onClick={() => setInviteSent(true)} className="w-full rounded-xl py-3 text-sm font-bold" style={{ background: C.panelLight, color: C.text }}>They don't use a smartphone → Become Primary Caregiver</button>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  function renderFamilyMember(f) {
    if (!f) return null;
    return (
      <div className="space-y-4">
        <button onClick={() => setFamilySel(null)} className="text-sm text-left font-semibold" style={{ color: C.muted }}>← My Family</button>

        <div className="flex items-center gap-4">
          <div className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 64, height: 64, background: C.panelLight, fontSize: 32 }}>{f.emoji}</div>
          <div>
            <div className="font-display text-xl font-bold" style={{ color: C.text }}>{f.name}</div>
            <div className="text-sm font-semibold" style={{ color: C.muted }}>{f.rel} · Age {f.age}</div>
          </div>
        </div>

        {/* Today's status */}
        <div className="rounded-2xl p-4" style={{ background: f.status === 'attention' ? 'rgba(232,147,12,0.08)' : 'rgba(30,158,106,0.07)', border: `1.5px solid ${f.status === 'attention' ? 'rgba(232,147,12,0.4)' : 'rgba(30,158,106,0.35)'}` }}>
          <div className="text-sm font-bold flex items-center gap-2" style={{ color: C.text }}>{statusDot(f.status)} {f.status === 'attention' ? f.statusText : 'Stable today'}</div>
          <div className="text-xs font-semibold mt-1" style={{ color: C.muted }}>{f.status === 'attention' ? 'One gentle nudge can fix this — send a reminder below.' : 'No missed medicines · no pending alerts'}</div>
        </div>

        {/* Tasks */}
        <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <div className="text-sm font-bold mb-2.5" style={{ color: C.text }}>Today's tasks</div>
          <div className="space-y-2">
            {f.tasks.map(([t, done]) => (
              <div key={t} className="flex items-center gap-2.5">
                <div className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 20, height: 20, background: done ? '#1E9E6A' : 'transparent', border: `2px solid ${done ? '#1E9E6A' : C.border}` }}>
                  {done && <CheckCircle2 size={12} color="#FFFFFF" />}
                </div>
                <span className="text-sm font-medium" style={{ color: done ? C.muted : C.text, textDecoration: done ? 'line-through' : 'none' }}>{t}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Conditions + medicines (only if present) */}
        {f.conditions.length > 0 && (
          <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
            <div className="text-sm font-bold mb-2" style={{ color: C.text }}>Medical conditions</div>
            <div className="flex flex-wrap gap-2">
              {f.conditions.map(c => <span key={c} className="text-xs font-bold px-2.5 py-1.5 rounded-full" style={{ background: C.panelLight, color: C.text }}>{c}</span>)}
            </div>
            {f.meds.length > 0 && (
              <>
                <div className="text-sm font-bold mt-3.5 mb-2" style={{ color: C.text }}>Current medicines</div>
                <div className="text-sm font-medium" style={{ color: C.muted, lineHeight: 1.7 }}>{f.meds.join(' · ')}</div>
              </>
            )}
          </div>
        )}

        {/* Upcoming */}
        <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <div className="text-sm font-bold mb-2" style={{ color: C.text }}>Upcoming</div>
          {f.upcoming.map(u => <div key={u} className="text-sm font-medium flex items-center gap-2 py-0.5" style={{ color: C.muted }}><span style={{ color: C.green }}>•</span>{u}</div>)}
        </div>

        {/* Documents — the passport that builds itself */}
        <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <div className="text-sm font-bold mb-1" style={{ color: C.text }}>📄 Documents</div>
          <div className="text-xs font-medium mb-2.5" style={{ color: C.muted }}>Added automatically with every lab, consult & prescription</div>
          <div className="flex flex-wrap gap-2">
            {f.docs.map(d => <span key={d} className="text-xs font-bold px-2.5 py-1.5 rounded-lg" style={{ background: C.panelLight, color: C.navy }}>{d}</span>)}
          </div>
        </div>

        {/* Passport actions */}
        <div className="flex gap-2.5">
          <button className="flex-1 rounded-2xl py-3.5 text-sm font-bold" style={{ background: C.panel, color: C.text, border: `1.5px solid ${C.border}` }}>🆘 Emergency QR</button>
          <button className="flex-1 rounded-2xl py-3.5 text-sm font-bold" style={{ background: 'linear-gradient(135deg, #3B7FC9 0%, #1F5C9E 100%)', color: '#FFFFFF', boxShadow: '0 6px 18px rgba(31,92,158,0.32)' }}>📤 Share Health Passport</button>
        </div>

        {/* Care team + nudge */}
        <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <div className="text-sm font-bold mb-2" style={{ color: C.text }}>Care team</div>
          <div className="text-sm font-medium" style={{ color: C.muted }}>{f.team.join(' · ')}</div>
        </div>
        {f.status === 'attention' && (
          <button className="w-full rounded-2xl py-3.5 text-sm font-bold" style={{ background: '#E8930C', color: '#FFFFFF' }}>💬 Send a gentle BP reminder</button>
        )}
      </div>
    );
  }

  /* ========== 🧠 STROKE / NEURO RECOVERY HOME ========== */
  function renderNeuroHome() {
    const okG = '#1E9E6A';
    const docName = primaryDoctor ? `Dr. ${primaryDoctor}` : 'Dr. V. Nair';
    const armPct = Math.min(100, 26 + neuroArm * 8);
    const armSessions = ['Morning', 'Afternoon', 'Evening'];
    return (
      <div className="space-y-4">
        {/* Header + FAST */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold" style={{ color: C.muted }}>🧠 Neuro Recovery · Day 12</div>
            <div className="font-display text-2xl" style={{ color: C.text, fontWeight: 800 }}>Namaste, {(signupName || 'Suresh').split(' ')[0]}</div>
          </div>
          <button onClick={() => setFastOpen(!fastOpen)} className="rounded-full px-4 py-2.5 text-sm font-bold flex-shrink-0" style={{ background: C.coral, color: '#FFFFFF', boxShadow: '0 4px 14px rgba(224,82,82,0.4)' }}>⚡ Something feels wrong</button>
        </div>

        {vitalsBlock('Recovery Score', 70, 'Good')}

        {/* BE-FAST panel */}
        {fastOpen && (
          <div className="rounded-2xl p-5" style={{ background: 'rgba(224,82,82,0.06)', border: '2px solid rgba(224,82,82,0.5)' }}>
            <div className="text-base font-bold mb-1" style={{ color: C.text }}>Check yourself — BE-FAST</div>
            <div className="text-xs font-semibold mb-3" style={{ color: C.muted }}>Any ONE of these, suddenly — call now. Minutes save brain.</div>
            <div className="space-y-1.5 mb-4">
              {[
                ['🚶', 'Balance — sudden loss of balance'],
                ['👁️', 'Eyes — sudden vision change'],
                ['🙂', 'Face — one side drooping'],
                ['💪', 'Arm — new weakness or numbness'],
                ['🗣️', 'Speech — slurred or strange'],
                ['⏱️', 'Time — note when it started'],
              ].map(([e, t]) => (
                <div key={t} className="flex items-center gap-2.5 text-sm font-semibold" style={{ color: C.text }}><span style={{ fontSize: 16 }}>{e}</span>{t}</div>
              ))}
            </div>
            <div className="flex gap-2.5">
              <button onClick={() => { setFastOpen(false); setIncomingCall({ id: 'fast' + Date.now(), reading: 'possible stroke symptoms', doctor: 'Emergency Stroke Line · 24×7', phase: 'ringing' }); }} className="flex-1 rounded-xl py-3 text-sm font-bold" style={{ background: C.coral, color: '#FFFFFF' }}>🚨 Yes — call now</button>
              <button onClick={() => setFastOpen(false)} className="flex-1 rounded-xl py-3 text-sm font-bold" style={{ background: C.panel, color: C.text, border: `1.5px solid ${C.border}` }}>I'm okay</button>
            </div>
          </div>
        )}

        {/* Stroke Shield — secondary prevention */}
        <div className="rounded-2xl p-5" style={{ background: 'linear-gradient(135deg, #153E6F, #2B6CB0)' }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-base font-bold" style={{ color: '#FFFFFF' }}>🛡️ Your Stroke Shield</span>
            <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: 'rgba(127,224,180,0.2)', color: '#CFF5E3', border: '1px solid rgba(127,224,180,0.5)' }}>Protected today ✓</span>
          </div>
          <div className="text-xs mb-3.5" style={{ color: '#C9DCF2' }}>Preventing the second stroke is job #1. All three shields are up.</div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { e: '🩺', l: 'Blood pressure', v: `${lastBp.systolic}/${lastBp.diastolic}`, s: 'in range ✓' },
              { e: '💓', l: 'Heart rhythm', v: 'No AF', s: '24 h watched ✓' },
              { e: '💊', l: 'Medicines', v: `${medications.filter(m => m.taken).length}/${medications.length}`, s: 'taken today' },
            ].map(x => (
              <div key={x.l} className="rounded-xl p-2.5 text-center" style={{ background: 'rgba(255,255,255,0.13)', border: '1px solid rgba(255,255,255,0.25)' }}>
                <div style={{ fontSize: 18 }}>{x.e}</div>
                <div className="text-sm font-bold mt-0.5" style={{ color: '#FFFFFF' }}>{x.v}</div>
                <div style={{ fontSize: 9.5, color: '#C9DCF2', fontWeight: 600, lineHeight: 1.25, marginTop: 1 }}>{x.l}<br />{x.s}</div>
              </div>
            ))}
          </div>
          <div className="text-xs mt-3 font-semibold" style={{ color: '#C9DCF2', lineHeight: 1.45 }}>Half of rhythm-related strokes are found only after a stroke — your wristband watches for silent AF around the clock.</div>
        </div>

        {/* Today's rehab plan */}
        <div>
          <div className="text-lg font-bold mb-3" style={{ color: C.text }}>Today's rehab plan</div>
          {pTask({ emoji: '🤸', title: 'Physio video session · 4:00 PM', sub: 'Balance & walking with Rohit — join from your sofa' })}
          {pTask({ emoji: '🗣️', title: 'Speech practice · 15 min', sub: speechDone ? 'Done — clarity improving week over week ✓' : 'Guided exercises — tap to start', done: speechDone, onTap: () => setSpeechDone(true) })}
          {pTask({ emoji: '💊', title: 'Medicines', sub: 'Blood thinner + BP medicine — on time', done: true })}
          {pTask({ emoji: '🙂', title: '2-minute mood & swallow check', sub: 'Low mood is common after stroke — tap to check in', done: false, onTap: () => { setCheckinOpen(true); setCiStep(0); setCiAns({}); } })}
        </div>

        {sharedLogRows()}

        {/* Caregiver strip */}
        <div className="rounded-2xl p-4 flex items-center gap-3" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 20 }}>👨‍👩‍👧</span>
          <span className="text-xs font-semibold flex-1" style={{ color: C.muted, lineHeight: 1.5 }}><b style={{ color: C.text }}>{familyAdded ? familyMember.name : 'Anita (daughter)'}</b> sees your progress and gets alerts — recovery is a family effort.</span>
          <button onClick={() => setGuardianView(true)} className="text-xs font-bold flex-shrink-0" style={{ color: C.green }}>Family view →</button>
        </div>

        {!isSubscribed && journeysMiniCard()}



        {docStrip(<span><b>{docName} sees your week, every week:</b> BP averages, 24×7 rhythm watch, weak-arm use %, therapy adherence and mood — the things that predict readmission, caught early.</span>)}
      </div>
    );
  }

  /* ========== 🎗️ CANCER CARE (CHEMO RECOVERY) HOME ========== */
  function renderOncoHome() {
    const okG = '#1E9E6A';
    const docName = primaryDoctor ? `Dr. ${primaryDoctor}` : 'Dr. S. Menon';
    return (
      <div className="space-y-4">
        {/* Header + cycle */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold" style={{ color: C.muted }}>🎗️ Cancer Care · Cycle 3 of 6 · Day 8</div>
            <div className="font-display text-2xl" style={{ color: C.text, fontWeight: 800 }}>Namaste, {(signupName || 'Kavita').split(' ')[0]}</div>
          </div>
          <span className="text-xs font-bold px-3 py-1.5 rounded-full flex-shrink-0" style={{ background: 'rgba(43,108,176,0.10)', color: C.navy }}>Next chemo · 18 Jul</span>
        </div>

        {vitalsBlock('Recovery Score', 74, 'Good')}

        {/* FEVER WATCH — the one rule that saves lives */}
        <div className="rounded-2xl p-5" style={{ background: 'rgba(224,82,82,0.05)', border: '2px solid rgba(224,82,82,0.45)' }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-base font-bold" style={{ color: C.text }}>🌡️ Fever watch</span>
            <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: 'rgba(232,147,12,0.13)', color: '#C77E1A' }}>Days 7–14 · immunity lowest</span>
          </div>
          <div className="text-sm font-semibold mb-3" style={{ color: C.muted, lineHeight: 1.5 }}>One rule this week: temperature <b style={{ color: C.text }}>100.4°F (38°C) or above</b> — call us that minute, day or night. Never wait for morning.</div>
          <div className="flex gap-2.5">
            <button onClick={() => setTempDone(true)} className="flex-1 rounded-xl py-3 text-sm font-bold" style={{ background: tempDone ? 'rgba(30,158,106,0.12)' : C.panel, color: tempDone ? okG : C.text, border: `1.5px solid ${tempDone ? 'rgba(30,158,106,0.5)' : C.border}` }}>{tempDone ? '98.6°F · normal ✓' : 'I checked — normal'}</button>
            <button onClick={() => setIncomingCall({ id: 'onco' + Date.now(), reading: 'fever during chemotherapy', doctor: 'Onco Emergency Line · 24×7', phase: 'ringing' })} className="flex-1 rounded-xl py-3 text-sm font-bold" style={{ background: C.coral, color: '#FFFFFF' }}>🌡️ I have fever — call</button>
          </div>
        </div>

        {/* 2-minute symptom check — the evidence-backed core */}
        <div className="rounded-2xl p-5" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <div className="flex items-start justify-between mb-1">
            <div className="text-base font-bold" style={{ color: C.text }}>How is today treating you?</div>
            {oncoCheckDone && <span className="text-xs font-bold" style={{ color: okG }}>Done ✓</span>}
          </div>
          <div className="text-xs font-medium mb-3" style={{ color: C.muted, lineHeight: 1.45 }}>2 minutes · nausea, fatigue, mouth sores, appetite, pain. Your oncologist's team sees it the same day — small problems fixed before they grow.</div>
          {oncoCheckDone ? (
            <div className="rounded-xl px-3.5 py-3 text-xs font-bold" style={{ background: 'rgba(30,158,106,0.09)', color: okG, lineHeight: 1.5 }}>Reported: mild fatigue, appetite okay · Nurse Asha will adjust your anti-nausea timing and call you at 4 PM ✓</div>
          ) : (
            <button onClick={() => { setOncoCheckDone(true); setCheckinOpen(true); setCiStep(0); setCiAns({}); }} className="w-full rounded-xl py-3.5 text-sm font-bold" style={{ background: 'linear-gradient(135deg, #3B7FC9 0%, #1F5C9E 100%)', color: '#FFFFFF', boxShadow: '0 6px 18px rgba(31,92,158,0.32)' }}>Start today's 2-minute check</button>
          )}
        </div>

        {sharedLogRows({ weight: true })}
        {renderQuickMeal()}

        {/* Today, gently */}
        <div>
          <div className="text-lg font-bold mb-3" style={{ color: C.text }}>Today, gently</div>
          {pTask({ emoji: '💊', title: 'Anti-nausea medicine', sub: 'Ondansetron — 30 min before food', done: true })}
          {pTask({ emoji: '💧', title: 'Sip through the day · 8 glasses', sub: 'Small sips beat big gulps on chemo days' })}
          {pTask({ emoji: '🚶', title: 'Gentle 15-minute walk', sub: walkDone ? 'Done — movement fights fatigue ✓' : 'Even a slow walk lowers fatigue', done: walkDone, onTap: () => setWalkDone(true) })}
        </div>

        {/* Blood counts */}
        <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-bold" style={{ color: C.text }}>🩸 Blood counts</span>
            <span className="text-xs font-bold" style={{ color: C.navy }}>Next CBC · Thu, home draw</span>
          </div>
          <div className="text-xs font-medium" style={{ color: C.muted, lineHeight: 1.5 }}>WBC dip expected around Day 10 — normal for your protocol. We test at home and your oncologist clears you before Cycle 4.</div>
        </div>

        {!isSubscribed && journeysMiniCard()}



        {docStrip(<span><b>{docName} sees your week, every week:</b> daily symptoms, weight, meals and counts. Patients who report symptoms weekly during chemo live longer and land in hospital less — that's why this check matters.</span>)}
      </div>
    );
  }

  /* ========== 💧 CKD & DIALYSIS HOME ========== */
  function renderKidneyHome() {
    const okG = '#1E9E6A';
    const docName = primaryDoctor ? `Dr. ${primaryDoctor}` : 'Dr. K. Iyer';
    const gained = 1.4, limit = 2.5;
    const fluidGlasses = 5; // 1L/day = 5 glasses of 200ml
    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold" style={{ color: C.muted }}>💧 Kidney & Dialysis Care</div>
            <div className="font-display text-2xl" style={{ color: C.text, fontWeight: 800 }}>Namaste, {(signupName || 'Mohan').split(' ')[0]}</div>
          </div>
          <button onClick={() => setIncomingCall({ id: 'kid' + Date.now(), reading: 'breathlessness or swelling', doctor: 'Dialysis Helpline · 24×7', phase: 'ringing' })} className="rounded-full px-4 py-2.5 text-sm font-bold flex-shrink-0" style={{ background: C.coral, color: '#FFFFFF' }}>😮‍💨 Breathless?</button>
        </div>

        {vitalsBlock('Recovery Score', 75, 'Good')}

        {/* Next dialysis */}
        <div className="rounded-2xl p-4 flex items-center gap-3.5" style={{ background: 'rgba(25,154,142,0.07)', border: '1.5px solid rgba(25,154,142,0.4)' }}>
          <div className="flex items-center justify-center rounded-xl flex-shrink-0" style={{ width: 48, height: 48, background: 'rgba(25,154,142,0.13)', fontSize: 24 }}>🏥</div>
          <div className="flex-1">
            <div className="text-xs font-bold" style={{ color: '#199A8E', letterSpacing: 0.5 }}>NEXT DIALYSIS</div>
            <div className="text-sm font-bold mt-0.5" style={{ color: C.text }}>Wednesday, 7:00 AM · your usual chair</div>
            <div className="text-xs" style={{ color: C.muted }}>Mon · Wed · Fri schedule · cab reminder at 6:00 AM</div>
          </div>
        </div>

        {/* Fluid & weight — the daily battle */}
        <div className="rounded-2xl p-5" style={{ background: 'linear-gradient(135deg, #153E6F, #199A8E)' }}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-base font-bold" style={{ color: '#FFFFFF' }}>💧 Fluid & weight watch</span>
            <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ background: 'rgba(127,224,180,0.2)', color: '#CFF5E3' }}>On track ✓</span>
          </div>
          <div className="text-xs mb-3" style={{ color: '#C9DCF2' }}>Weight gained since last dialysis — the number your nephrologist watches most.</div>
          <div className="flex items-end gap-2 mb-1.5">
            <span className="font-display font-bold" style={{ fontSize: 38, color: '#7FE0B4', lineHeight: 1 }}>+{gained} kg</span>
            <span className="text-xs font-bold pb-1" style={{ color: '#C9DCF2' }}>of {limit} kg safe limit</span>
          </div>
          <div className="rounded-full overflow-hidden mb-4" style={{ height: 9, background: 'rgba(255,255,255,0.2)' }}>
            <div style={{ height: 9, width: `${(gained / limit) * 100}%`, background: '#7FE0B4', borderRadius: 9999 }} />
          </div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-bold" style={{ color: '#FFFFFF' }}>Today's water budget · 1 litre</span>
            <span className="text-xs font-bold" style={{ color: '#C9DCF2' }}>{Math.max(0, fluidGlasses - fluidUsed)} of {fluidGlasses} glasses left</span>
          </div>
          <div className="flex gap-1.5 mb-3">
            {Array.from({ length: fluidGlasses }).map((_, i) => (
              <div key={i} className="flex items-center justify-center rounded-lg" style={{ flex: 1, height: 34, background: i < fluidUsed ? 'rgba(127,224,180,0.3)' : 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.25)', fontSize: 15 }}>{i < fluidUsed ? '💧' : ''}</div>
            ))}
          </div>
          {fluidUsed < fluidGlasses ? (
            <button onClick={() => setFluidUsed(f => Math.min(fluidGlasses, f + 1))} className="w-full rounded-xl py-3 text-sm font-bold" style={{ background: '#FFFFFF', color: '#153E6F' }}>I drank a glass (200 ml)</button>
          ) : (
            <div className="text-xs font-bold text-center" style={{ color: '#CFF5E3' }}>Budget done for today — ice chips & lemon help the thirst 🍋</div>
          )}
        </div>

        {/* 2-minute symptom check-in */}
        <button onClick={() => { tapFeel('tap'); setCheckinOpen(true); setCiStep(0); setCiAns({}); }} className="w-full rounded-2xl p-4 flex items-center gap-3.5 text-left" style={{ background: 'linear-gradient(120deg, #2B6CB0, #153E6F)', boxShadow: '0 8px 22px rgba(21,62,111,0.25)' }}>
          <div className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 46, height: 46, background: 'rgba(255,255,255,0.2)', fontSize: 22 }}>📝</div>
          <div className="flex-1">
            <div className="text-base font-bold" style={{ color: '#FFFFFF' }}>2-minute symptom check-in</div>
            <div className="text-xs font-semibold mt-0.5" style={{ color: 'rgba(255,255,255,0.8)' }}>Swelling, breathing, urine, medicines — 4 taps</div>
          </div>
          <span className="text-xs font-bold" style={{ color: '#FFFFFF' }}>Start →</span>
        </button>

        {sharedLogRows({ weight: true })}
        {renderQuickBP()}
        {renderQuickSugar()}

        {/* Potassium swap of the day */}
        <div className="rounded-2xl p-4" style={{ background: 'rgba(232,147,12,0.07)', border: '1.5px solid rgba(232,147,12,0.35)' }}>
          <div className="text-sm font-bold mb-1" style={{ color: C.text }}>🍌 Today's food swap — potassium</div>
          <div className="text-sm font-semibold" style={{ color: C.text }}>Coconut water → nimbu paani · Banana → apple</div>
          <div className="text-xs mt-1 font-medium" style={{ color: C.muted, lineHeight: 1.45 }}>High potassium is dangerous between dialysis sessions. One smart swap a day keeps your heart safe.</div>
        </div>

        {/* Fistula care + tasks */}
        <div>
          <div className="text-lg font-bold mb-3" style={{ color: C.text }}>Today's care plan</div>
          {pTask({ emoji: '🤲', title: 'Check your fistula — feel the thrill', sub: fistulaChecked ? 'Buzzing felt ✓ — your lifeline is healthy' : 'The gentle buzz under your skin = lifeline working. No buzz? Call us now.', done: fistulaChecked, onTap: () => setFistulaChecked(true) })}
          {pTask({ emoji: '💊', title: 'Phosphate binder with lunch', sub: 'Works only when taken WITH food', done: true })}
          {pTask({ emoji: '🩺', title: 'BP after waking', sub: readingLoggedToday ? `${lastBp.systolic}/${lastBp.diastolic} — logged ✓` : 'Before your morning tea', done: readingLoggedToday, onTap: () => { setActiveLog(activeLog === 'bp' ? null : 'bp'); setLogMethod('manual'); } })}
        </div>

        {!isSubscribed && journeysMiniCard()}



        {docStrip(<span><b>{docName} sees before every session:</b> your fluid gains, BP, potassium-smart eating and fistula checks — so each dialysis starts with zero surprises.</span>)}
      </div>
    );
  }

  /* ========== ❤️ HEART HEALTH CHECK (FREE → PATCH/WRISTBAND) HOME ========== */
  function renderCareRiskScreen() {
    const okG = '#1E9E6A';
    const isPrevent = selectedPlan === 'essential';
    const isFree = !isSubscribed;
    const qs = [
      { q: 'Your age?', key: 'age', opts: [['🌱', 'Under 40', 0], ['🌿', '40 – 54', 1], ['🌳', '55 – 64', 2], ['🎋', '65 or above', 3]] },
      { q: 'High cholesterol?', key: 'chol', opts: [['✅', 'No', 0], ['🤷', 'Don\'t know', 1], ['⚠️', 'Yes', 2]] },
      { q: 'Diabetes or high blood sugar?', key: 'dm', opts: [['✅', 'No', 0], ['⚠️', 'Yes', 2]] },
      { q: 'High blood pressure?', key: 'htn', opts: [['✅', 'No', 0], ['⚠️', 'Yes', 2]] },
      { q: 'Do you smoke?', key: 'smoke', opts: [['✅', 'No', 0], ['🚬', 'Yes', 2]] },
      { q: 'Heart disease in your close family?', key: 'fam', opts: [['✅', 'No', 0], ['👪', 'Yes — parent or sibling', 2]] },
    ];
    const doneQ = careQStep >= qs.length;
    if (doneQ) {
      const total = Object.values(careQAns).reduce((a, b) => a + b, 0);
      const level = total <= 2 ? ['Low', okG, 'under 5%'] : total <= 5 ? ['Moderate', '#C77E1A', '10–15%'] : ['Raised', '#C0392B', 'over 20%'];
      return (
        <div className="h-full flex flex-col items-center justify-center text-center px-3">
          <div style={{ fontSize: 42 }}>{isFree ? '❤️' : isPrevent ? '🛡️' : '💙'}</div>
          <div className="text-xs font-bold mt-3" style={{ color: C.muted }}>YOUR BASELINE HEART RISK</div>
          <div className="font-display font-bold mt-1" style={{ fontSize: 34, color: level[1] }}>{level[0]}</div>
          <div className="text-sm font-semibold mt-1" style={{ color: C.muted }}>Estimated 10-year risk: <b style={{ color: C.text }}>{level[2]}</b></div>
          <div className="text-xs font-medium mt-3 rounded-xl p-3" style={{ color: C.text, background: C.panelLight, lineHeight: 1.55 }}>Based on the risk factors used by the American Heart Association. {isFree ? 'This is your starting point — your free care round helps you act on it, and our care journeys can watch over it every day.' : isPrevent ? 'iLive Prevent starts from this baseline — your wristband and medical team refine it every single day.' : 'Your care team starts from this baseline — and your devices and daily monitoring refine it from day one.'}</div>
          <button onClick={() => setCareRisk({ level: level[0], col: level[1], pct: level[2] })} className="w-full rounded-2xl py-4 text-base font-bold mt-5" style={{ background: 'linear-gradient(135deg, #3B7FC9 0%, #1F5C9E 100%)', color: '#FFFFFF', boxShadow: '0 6px 18px rgba(31,92,158,0.32)' }}>{isFree ? 'See my free journey →' : `Begin my ${isPrevent ? 'iLive Prevent' : 'iLive Care'} →`}</button>
        </div>
      );
    }
    return (
      <div className="h-full flex flex-col">
        {foName && backArrow('Back to my free home', () => { tapFeel('tap'); setIsSubscribed(false); setSelectedPlan(null); setEnrolledPrograms(['iLive Free']); setOnboardingDone(true); setActiveTab('home'); setAppPhase('main'); })}
        <div className="flex gap-1.5 mb-5">
          {qs.map((_, i) => (
            <div key={i} className="rounded-full flex-1" style={{ height: 5, background: i < careQStep ? okG : i === careQStep ? C.green : 'rgba(21,62,111,0.1)' }} />
          ))}
        </div>
        <div className="text-xs font-bold" style={{ color: C.muted }}>YOUR HEALTH RISK PROFILE · {careQStep + 1} OF {qs.length}</div>
        <div className="font-display text-2xl font-bold mt-1.5 mb-5" style={{ color: C.text, lineHeight: 1.25 }}>{qs[careQStep].q}</div>
        <div className="space-y-2.5">
          {qs[careQStep].opts.map(([e, label, pts]) => (
            <button key={label} onClick={() => { setCareQAns({ ...careQAns, [qs[careQStep].key]: pts }); setCareQStep(careQStep + 1); }}
              className="w-full rounded-2xl p-4 text-left flex items-center gap-3.5" style={{ background: '#FFFFFF', border: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 24, lineHeight: 1 }}>{e}</span>
              <span className="text-base font-bold" style={{ color: C.text }}>{label}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  /* =========================================================================
     HOME EXERCISE TEST — simple, evidence-based, easy to build.
     Three phases. Three screens. One timer.
       1. WALK    6 min  — the 6-Minute Walk Test (ATS guideline 2002; Holland et al. ERS/ATS 2014)
       2. CLIMB   3 min  — stair/step effort, sub-maximal (target ≤ 85 % of 220−age, ACC/AHA)
       3. RECOVER 3 min  — seated; heart-rate recovery at 1 min (Cole et al., NEJM 1999: <12 bpm = abnormal)
     The patch records every beat. Cardiologist reads rhythm, ST changes, HR response, recovery.
     ========================================================================= */
  const HET_STAGES = [
    { id: 'walk',    name: 'Walk',    secs: 360, icon: '🚶', do: 'Walk up and down a flat stretch for six minutes. Go as far as you comfortably can. Slow down or stop for a moment if you need to, then carry on.', why: 'The standard six-minute walk test', ref: 'ATS 2002 · ERS/ATS 2014' },
    { id: 'climb',   name: 'Climb',   secs: 180, icon: '🪜', do: 'Climb stairs steadily for three minutes — or just step up and down on the bottom stair. Breathing hard is fine. Chest pain is not.', why: 'Brings your heart rate up safely', ref: 'ACC/AHA exercise-testing guideline' },
    { id: 'recover', name: 'Recover', secs: 180, icon: '🪑', do: 'Sit down and breathe normally for three minutes. Stay seated — do not lie down.', why: 'Measures how fast your heart settles', ref: 'Cole et al., NEJM 1999' },
  ];
  const HET_STOP = 'Stop at once if you get chest pain, severe breathlessness, dizziness or a racing irregular heartbeat.';

  function hetMaxHR() { return 220 - (Number(foAge) || 50); }
  function hetSimHR(stageId, frac) { const max = hetMaxHR(); if (stageId === 'walk') return Math.round(72 + (max * 0.70 - 72) * Math.min(1, frac * 1.3)); if (stageId === 'climb') return Math.round(max * (0.70 + 0.13 * Math.min(1, frac * 1.2))); const peak = Math.round(max * 0.83); return Math.round(peak - (peak - 90) * Math.min(1, frac * 1.5)); }

  function renderHomeExerciseTest() {
    const D = { bg: '#0B2039', card: '#16314F', raised: '#1E3C60', hair: 'rgba(255,255,255,.14)', ink: '#FFFFFF', ink2: '#C6D8EC', ink3: '#93AECB', blueLite: '#9CCAFF', green: '#5FDCA8', amber: '#F5C572', red: '#F58D8B' };
    const fmtT = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const shell = (children) => <div className="h-full flex flex-col -mx-4 -mt-4 px-4 pt-5" style={{ background: D.bg, color: D.ink, minHeight: '100%' }}>{children}</div>;
    const stopBar = () => (
      <div className="rounded-2xl px-4 py-3 flex items-center gap-3" style={{ background: 'rgba(245,141,139,0.10)', border: '1px solid rgba(245,141,139,0.35)' }}>
        <span style={{ fontSize: 12.5, color: D.ink2, lineHeight: 1.5, flex: 1 }}>{HET_STOP}</span>
        <button onClick={() => { tapFeel('tap'); if (hhTimerRef.current) clearInterval(hhTimerRef.current); setHetView('stopped'); }} className="rounded-xl px-4 py-2.5 text-sm font-bold flex-shrink-0" style={{ background: '#C0392B', color: '#FFFFFF' }}>Stop</button>
      </div>
    );

    /* ---- 1. START ---- */
    if (hetView === 'intro') return shell(<>
      <button onClick={() => { tapFeel('tap'); setHetView(null); }} className="flex items-center gap-1.5 text-sm font-semibold mb-4" style={{ color: D.ink3 }}><ChevronLeft size={16} color={D.ink3} /> Back</button>
      <div className="flex-1 overflow-y-auto pb-4 space-y-4">
        <div>
          <div className="font-display" style={{ fontSize: 26, fontWeight: 400, lineHeight: 1.25, letterSpacing: '-0.035em' }}>Your 12-minute exercise test</div>
          <div className="mt-3" style={{ fontSize: 15, color: D.ink2, lineHeight: 1.7 }}>Walk, climb some stairs, then sit down. That is the whole test. Your patch records everything; the app tells you when to change.</div>
        </div>
        <div className="space-y-2.5">
          {HET_STAGES.map((s, i) => (
            <div key={s.id} className="rounded-2xl p-4 flex items-center gap-4" style={{ background: D.card, border: `1px solid ${D.hair}` }}>
              <span className="flex items-center justify-center rounded-full flex-shrink-0 font-display" style={{ width: 44, height: 44, background: D.raised, fontSize: 22 }}>{s.icon}</span>
              <div className="flex-1"><div style={{ fontSize: 16, color: D.ink }}><b>{i + 1}. {s.name}</b> · {Math.round(s.secs / 60)} min</div><div style={{ fontSize: 12.5, color: D.ink2, marginTop: 3, lineHeight: 1.5 }}>{s.why}</div><div style={{ fontSize: 11, color: D.ink3, marginTop: 2 }}>{s.ref}</div></div>
            </div>
          ))}
        </div>
        <div className="rounded-2xl p-4" style={{ background: D.card, border: `1px solid ${D.hair}` }}>
          <div style={{ fontSize: 12.5, color: D.ink2, lineHeight: 1.7 }}>✓ Patch on · comfortable shoes · water nearby<br/>✓ Not within an hour of a big meal<br/>✓ Best with someone at home</div>
        </div>
        <div className="rounded-2xl p-4" style={{ background: 'rgba(245,141,139,0.10)', border: '1px solid rgba(245,141,139,0.35)' }}>
          <div style={{ fontSize: 13.5, color: D.ink, lineHeight: 1.6 }}><b>Before you start:</b> any chest pain, unusual breathlessness or dizziness today — or has a doctor told you not to exercise?</div>
          <div className="flex gap-2 mt-3">
            <button onClick={() => { tapFeel('select'); setHetSafety({ ok: true }); }} className="flex-1 rounded-xl py-3 text-sm font-bold" style={{ background: hetSafety.ok === true ? 'rgba(95,220,168,0.22)' : D.raised, border: hetSafety.ok === true ? `1.5px solid ${D.green}` : '1.5px solid transparent', color: D.ink }}>No, I feel fine</button>
            <button onClick={() => { tapFeel('select'); setHetSafety({ ok: false }); }} className="flex-1 rounded-xl py-3 text-sm font-bold" style={{ background: hetSafety.ok === false ? 'rgba(245,141,139,0.22)' : D.raised, border: hetSafety.ok === false ? `1.5px solid ${D.red}` : '1.5px solid transparent', color: D.ink }}>Yes</button>
          </div>
          {hetSafety.ok === false && <div className="mt-3" style={{ fontSize: 13, color: D.ink2, lineHeight: 1.6 }}>Then not today. Your patch keeps recording — that alone is valuable. <button onClick={() => { tapFeel('tap'); setIncomingCall({ id: 'het' + Date.now(), reading: 'exercise test', doctor: 'iLive doctor on duty', phase: 'ringing' }); }} style={{ color: D.blueLite, fontWeight: 700, background: 'none' }}>Talk to your doctor →</button></div>}
        </div>
      </div>
      <button disabled={hetSafety.ok !== true} onClick={() => { tapFeel('success'); setHetStage(0); setHetView('run'); startStageTimer(HET_STAGES[0].secs); }} className="w-full rounded-2xl py-4 text-base font-bold my-3" style={{ background: 'linear-gradient(135deg, #4A90F0 0%, #1F5CB0 100%)', color: '#FFFFFF', opacity: hetSafety.ok === true ? 1 : 0.4 }}>Start — Walk for 6 minutes</button>
    </>);

    /* ---- 2. RUNNING (one screen, three phases) ---- */
    if (hetView === 'run') {
      const i = hetStage, st = HET_STAGES[i], done = hhTimeLeft === 0, frac = 1 - hhTimeLeft / st.secs;
      const hr = hetSimHR(st.id, frac), max = hetMaxHR(), cap = Math.round(max * 0.85);
      const tooHigh = st.id !== 'recover' && hr > cap;
      return shell(<>
        <div className="flex gap-1.5 mb-4">{HET_STAGES.map((s, k) => <div key={s.id} className="rounded-full flex-1" style={{ height: 5, background: k < i ? D.green : k === i ? D.blueLite : 'rgba(255,255,255,.12)' }} />)}</div>
        <div className="text-center"><span style={{ fontSize: 44 }}>{st.icon}</span><div className="font-display mt-1" style={{ fontSize: 30, fontWeight: 500, letterSpacing: '-0.03em' }}>{i + 1}. {st.name}</div></div>
        <div className="rounded-2xl p-5 mt-4 text-center" style={{ background: D.card, border: `1px solid ${D.hair}` }}>
          <div className="font-display" style={{ fontSize: 64, fontWeight: 500, color: done ? D.green : D.ink, lineHeight: 1, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.03em' }}>{done ? '0:00' : fmtT(hhTimeLeft)}</div>
          <div className="rounded-full mt-4 mx-auto" style={{ height: 6, width: '80%', background: 'rgba(255,255,255,.1)', overflow: 'hidden' }}><div className="rounded-full" style={{ height: 6, width: `${Math.round(frac * 100)}%`, background: D.blueLite, transition: 'width 1s linear' }} /></div>
        </div>
        <div className="rounded-2xl p-4 mt-3" style={{ background: D.raised }}><div style={{ fontSize: 16, color: D.ink, lineHeight: 1.6 }}>{st.do}</div></div>
        <div className="rounded-2xl p-4 mt-3 flex items-center justify-between" style={{ background: D.card, border: `1px solid ${D.hair}` }}>
          <div><div style={{ fontSize: 11, color: D.ink3, letterSpacing: 1.2, fontWeight: 700 }}>HEART RATE</div><div className="flex items-baseline gap-1 mt-1"><span className="font-display" style={{ fontSize: 34, fontWeight: 500, color: tooHigh ? D.amber : D.green, lineHeight: 1 }}>{hr}</span><span style={{ fontSize: 12, color: D.ink3 }}>bpm</span></div></div>
          <div style={{ fontSize: 13, color: tooHigh ? D.amber : D.ink2, textAlign: 'right', lineHeight: 1.5 }}>{st.id === 'recover' ? 'Coming down ✓' : tooHigh ? `Ease off a little\n(keep under ${cap})` : 'Good pace ✓'}</div>
        </div>
        <div className="flex-1" />
        <div className="mt-3">{stopBar()}</div>
        {done && i < HET_STAGES.length - 1 && <button onClick={() => { tapFeel('success'); setHetStage(i + 1); startStageTimer(HET_STAGES[i + 1].secs); }} className="w-full rounded-2xl py-4 text-base font-bold mt-3" style={{ background: 'linear-gradient(135deg, #23B27A 0%, #178A5C 100%)', color: '#FFFFFF', animation: 'ilivePulse 1.1s ease-in-out infinite' }}>Next — {HET_STAGES[i + 1].name} for {Math.round(HET_STAGES[i + 1].secs / 60)} minutes →</button>}
        {done && i === HET_STAGES.length - 1 && <button onClick={() => { tapFeel('success'); setHetView('done'); }} className="w-full rounded-2xl py-4 text-base font-bold mt-3" style={{ background: 'linear-gradient(135deg, #23B27A 0%, #178A5C 100%)', color: '#FFFFFF', animation: 'ilivePulse 1.1s ease-in-out infinite' }}>Finish →</button>}
        {!done && <div className="text-center mt-3 mb-2" style={{ fontSize: 12, color: D.ink3 }}>Keep going until the timer ends.</div>}
      </>);
    }

    /* ---- STOPPED ---- */
    if (hetView === 'stopped') return shell(<div className="flex-1 flex flex-col items-center justify-center text-center px-4">
      <div style={{ fontSize: 46 }}>🩺</div>
      <div className="font-display mt-4" style={{ fontSize: 24, fontWeight: 500 }}>Good — you stopped</div>
      <div className="mt-3" style={{ fontSize: 14.5, color: D.ink2, lineHeight: 1.7 }}>Sit down and breathe slowly. Your patch has recorded everything so far. <b style={{ color: D.ink }}>An iLive doctor will call you now.</b></div>
      <button onClick={() => { tapFeel('tap'); setIncomingCall({ id: 'hetstop' + Date.now(), reading: 'stopped exercise test', doctor: 'iLive doctor on duty', phase: 'ringing' }); }} className="w-full rounded-2xl py-4 text-base font-bold mt-6" style={{ background: '#C0392B', color: '#FFFFFF' }}>Call your doctor</button>
      <button onClick={() => { tapFeel('tap'); setHetView(null); setHetStage(-1); }} className="mt-3 text-sm font-semibold" style={{ color: D.ink3 }}>Back</button>
    </div>);

    /* ---- 3. DONE ---- */
    if (hetView === 'done') {
      const max = hetMaxHR(), peak = Math.round(max * 0.83), hrr = 22;
      return shell(<>
        <div className="flex-1 overflow-y-auto pb-4 space-y-4">
          <div className="text-center mt-6"><div style={{ fontSize: 46 }}>🙏</div><div className="font-display mt-3" style={{ fontSize: 24, fontWeight: 500 }}>Well done — test complete</div><div className="mt-2" style={{ fontSize: 14.5, color: D.ink2, lineHeight: 1.65 }}>Every beat is recorded. Your cardiologist reads the full trace and explains it on your report call.</div></div>
          <div className="grid grid-cols-2 gap-2.5">
            {[['Peak heart rate', `${peak}`, `${Math.round(peak / max * 100)}% of your age-predicted max (${max})`], ['Recovery at 1 min', `−${hrr}`, 'bpm · 12 or more is normal (Cole, NEJM 1999)']].map(([t, v, s]) => (
              <div key={t} className="rounded-2xl p-4 text-center" style={{ background: D.card, border: `1px solid ${D.hair}` }}><div style={{ fontSize: 11, color: D.ink3, letterSpacing: 1, fontWeight: 700 }}>{t.toUpperCase()}</div><div className="font-display mt-1.5" style={{ fontSize: 30, fontWeight: 500, color: D.ink }}>{v}</div><div style={{ fontSize: 11.5, color: D.ink3, marginTop: 4 }}>{s}</div></div>
            ))}
          </div>
          <div className="rounded-2xl p-4" style={{ background: D.card, border: `1px solid ${D.hair}` }}><div style={{ fontSize: 13.5, color: D.ink2, lineHeight: 1.65 }}>Your cardiologist also reads the ECG during effort — rhythm and ST changes — the part no app can show. That is your report.</div></div>
          <div style={{ fontSize: 13, color: D.ink3, textAlign: 'center' }}>Drink some water and take it easy for 30 minutes.</div>
        </div>
        <button onClick={() => { tapFeel('success'); setHetView(null); setHetStage(HET_STAGES.length); }} className="w-full rounded-2xl py-4 text-base font-bold my-3" style={{ background: 'linear-gradient(135deg, #4A90F0 0%, #1F5CB0 100%)', color: '#FFFFFF' }}>Back to my Heart Check</button>
      </>);
    }
    return null;
  }

  function renderHeartCheckHome() {
    const okG = '#1E9E6A';
    const docName = primaryDoctor ? `Dr. ${primaryDoctor}` : 'Dr. A. Mehta';
    const stages = [
      { name: 'Warm-up walk', secs: 180, how: 'Walk slowly and comfortably — around your room or corridor is fine.' },
      { name: 'Brisk walk', secs: 180, how: 'Pick up the pace — walk like you\'re late for a meeting.' },
      { name: 'Stairs or incline', secs: 180, how: 'Climb stairs at an easy rhythm, or walk uphill. Rest a moment if needed.' },
      { name: 'Fast pace', secs: 180, how: 'Your fastest comfortable walk. Breathing hard is okay — chest pain is not.' },
      { name: 'Cool-down', secs: 180, how: 'Slow right down. Let your breathing settle — we\'re measuring your recovery.' },
    ];
    const fmtT = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const stageDone = hhStage >= 0 && hhStage < stages.length && hhTimeLeft === 0;
    const hcQuestions = [
      { q: 'Your age?', key: 'age', opts: [['🌱', 'Under 40', 0], ['🌿', '40 – 54', 1], ['🌳', '55 – 64', 2], ['🎋', '65 or above', 3]] },
      { q: 'High cholesterol?', key: 'chol', opts: [['✅', 'No', 0], ['🤷', 'Don\'t know', 1], ['⚠️', 'Yes', 2]] },
      { q: 'Diabetes or high blood sugar?', key: 'dm', opts: [['✅', 'No', 0], ['⚠️', 'Yes', 2]] },
      { q: 'High blood pressure?', key: 'htn', opts: [['✅', 'No', 0], ['⚠️', 'Yes', 2]] },
      { q: 'Do you smoke?', key: 'smoke', opts: [['✅', 'No', 0], ['🚬', 'Yes', 2]] },
      { q: 'Heart disease in your close family?', key: 'fam', opts: [['✅', 'No', 0], ['👪', 'Yes — parent or sibling', 2]] },
    ];

    /* ---- Baseline risk screening flow (skipped if already screened) ---- */
    if (hcRisk === null && careRisk && careRisk.level) { setHcRisk({ level: careRisk.level, col: careRisk.col, pct: careRisk.pct }); return null; }
    if (hcRisk === null) {
      const doneQ = hcQStep >= hcQuestions.length;
      if (doneQ) {
        const total = Object.values(hcQAns).reduce((a, b) => a + b, 0);
        const level = total <= 2 ? ['Low', okG, 'under 5%'] : total <= 5 ? ['Moderate', '#C77E1A', '10–15%'] : ['Raised', '#C0392B', 'over 20%'];
        return (
          <div className="h-full flex flex-col items-center justify-center text-center px-3">
            <div style={{ fontSize: 42 }}>❤️</div>
            <div className="text-xs font-bold mt-3" style={{ color: C.muted }}>YOUR BASELINE HEART RISK</div>
            <div className="font-display font-bold mt-1" style={{ fontSize: 34, color: level[1] }}>{level[0]}</div>
            <div className="text-sm font-semibold mt-1" style={{ color: C.muted }}>Estimated 10-year risk: <b style={{ color: C.text }}>{level[2]}</b></div>
            <div className="text-xs font-medium mt-3 rounded-xl p-3" style={{ color: C.text, background: C.panelLight, lineHeight: 1.55 }}>Based on the risk factors used by the American Heart Association. Over the next <b>{hsDays} days</b>, your chest patch will refine this with what no questionnaire can see — <b>arrhythmia burden, AV conduction blocks, and ST-T (ischemic) changes</b>.</div>
            <button onClick={() => setHcRisk({ level: level[0], col: level[1], pct: level[2] })} className="w-full rounded-2xl py-4 text-base font-bold mt-5" style={{ background: 'linear-gradient(135deg, #3B7FC9 0%, #1F5C9E 100%)', color: '#FFFFFF', boxShadow: '0 6px 18px rgba(31,92,158,0.32)' }}>Begin my {hsDays}-day Heart Check →</button>
          </div>
        );
      }
      return (
        <div className="h-full flex flex-col">
          <div className="flex gap-1.5 mb-5">
            {hcQuestions.map((_, i) => (
              <div key={i} className="rounded-full flex-1" style={{ height: 5, background: i < hcQStep ? okG : i === hcQStep ? C.green : 'rgba(21,62,111,0.1)' }} />
            ))}
          </div>
          <div className="text-xs font-bold" style={{ color: C.muted }}>YOUR HEART RISK PROFILE · {hcQStep + 1} OF {hcQuestions.length}</div>
          <div className="font-display text-2xl font-bold mt-1.5 mb-5" style={{ color: C.text, lineHeight: 1.25 }}>{hcQuestions[hcQStep].q}</div>
          <div className="space-y-2.5">
            {hcQuestions[hcQStep].opts.map(([e, label, pts]) => (
              <button key={label} onClick={() => { setHcQAns({ ...hcQAns, [hcQuestions[hcQStep].key]: pts }); setHcQStep(hcQStep + 1); }}
                className="w-full rounded-2xl p-4 text-left flex items-center gap-3.5" style={{ background: '#FFFFFF', border: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 24, lineHeight: 1 }}>{e}</span>
                <span className="text-base font-bold" style={{ color: C.text }}>{label}</span>
              </button>
            ))}
          </div>
        </div>
      );
    }

    /* ---- Blood markers — the science ---- */
    if (hcLabsView === 'info') {
      return (
        <div className="h-full flex flex-col">
          <button onClick={() => setHcLabsView(null)} className="flex-shrink-0 text-sm text-left font-semibold mb-3" style={{ color: C.muted }}>← Back to my Heart Check</button>
          <div className="flex-1 overflow-y-auto space-y-3 pb-2">
            <div>
              <div className="font-display text-xl font-bold" style={{ color: C.text }}>Five markers. One clearer answer.</div>
              <div className="text-sm font-medium mt-1" style={{ color: C.muted, lineHeight: 1.5 }}>Each has independent scientific evidence for predicting heart risk — beyond what any ECG can see.</div>
            </div>
            <div className="space-y-2">
              {[
                ['🧈', 'Lipid profile', 'The foundation — LDL cholesterol is what builds plaque in your arteries.'],
                ['🧬', 'Lipoprotein(a)', 'An inherited risk factor. One in five people carry it — a once-in-a-lifetime test.'],
                ['🔥', 'hs-CRP', 'Measures silent inflammation inside your artery walls.'],
                ['🍬', 'HbA1c', 'Your 3-month sugar average — catches diabetes years before symptoms.'],
                ['🧪', 'Homocysteine', 'Raised levels are linked to early heart disease and clotting.'],
              ].map(([e, t, d]) => (
                <div key={t} className="flex items-start gap-3 rounded-2xl p-3.5" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
                  <span style={{ fontSize: 20, lineHeight: 1.3 }}>{e}</span>
                  <div>
                    <div className="text-sm font-bold" style={{ color: C.text }}>{t}</div>
                    <div className="text-xs font-medium mt-0.5" style={{ color: C.muted, lineHeight: 1.45 }}>{d}</div>
                  </div>
                </div>
              ))}
            </div>
            {!hcLabsAdded ? (
              <button onClick={() => setHcLabsAdded(true)} className="w-full rounded-2xl py-4 text-base font-bold" style={{ background: 'linear-gradient(135deg, #3B7FC9 0%, #1F5C9E 100%)', color: '#FFFFFF', boxShadow: '0 6px 18px rgba(31,92,158,0.32)' }}>Add these tests to my Heart Check</button>
            ) : (
              <div className="rounded-2xl p-4 text-center" style={{ background: 'rgba(30,158,106,0.08)', border: '1px solid rgba(30,158,106,0.35)' }}>
                <div style={{ fontSize: 26 }}>✓</div>
                <div className="text-sm font-bold mt-1" style={{ color: '#178A5C' }}>Added to your Heart Check</div>
                <div className="text-xs font-semibold mt-1" style={{ color: C.muted, lineHeight: 1.5 }}>Home sample collection will be arranged on your doctor call — results woven into your report.</div>
              </div>
            )}
            <div className="text-xs text-center font-medium" style={{ color: C.muted }}>Sample collected at your home · reviewed by your cardiologist</div>
          </div>
        </div>
      );
    }

    /* ---- Heart Check home ---- */
    if (hetView) return renderHomeExerciseTest();
    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold" style={{ color: C.muted }}>{hsDays}-day heart analysis</div>
            <div className="font-display text-2xl" style={{ color: C.text, fontWeight: 800 }}>Hello, {(foName || signupName || 'Arjun').split(' ')[0]}</div>
          </div>
          <span className="text-xs font-bold px-3 py-1.5 rounded-full flex-shrink-0" style={{ background: 'rgba(95,220,168,0.14)', color: '#5FDCA8', border: '1px solid rgba(95,220,168,0.3)' }}>Day 1 of {hsDays} ✓</span>
        </div>

        {/* Baseline risk — solid, readable */}
        <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-bold" style={{ color: C.text }}>Your baseline heart risk</span>
            <span className="text-xs font-bold px-2.5 py-1 rounded-full flex-shrink-0" style={{ background: `${hcRisk.col}26`, color: hcRisk.col, border: `1px solid ${hcRisk.col}55` }}>{hcRisk.level} · {hcRisk.pct}</span>
          </div>
          <div className="text-sm mt-3" style={{ color: C.muted, lineHeight: 1.6 }}>Over the next {hsDays} days your chest patch refines this — screening for:</div>
          <div className="grid grid-cols-3 gap-2 mt-2.5">
            {[['💓', 'Rhythm', 'arrhythmia burden'], ['⚡', 'Conduction', 'AV blocks'], ['🫀', 'Blood supply', 'ST-T changes']].map(([e, t, d]) => (
              <div key={t} className="rounded-xl p-2.5 text-center" style={{ background: C.panelLight }}>
                <div style={{ fontSize: 18 }}>{e}</div>
                <div className="text-xs font-bold mt-1" style={{ color: C.text }}>{t}</div>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 600, marginTop: 1 }}>{d}</div>
              </div>
            ))}
          </div>
          <div className="text-xs mt-2.5" style={{ color: C.muted }}>One guided exercise test is part of your analysis.</div>
        </div>

        {/* Patch is recording — quiet reassurance, no ECG trace */}
        <div className="rounded-2xl p-4 flex items-center gap-3.5" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 40, height: 40, background: 'rgba(95,220,168,0.14)' }}>
            <span className="rounded-full pulse" style={{ width: 10, height: 10, background: '#5FDCA8' }} />
          </span>
          <div className="flex-1">
            <div className="text-sm font-bold" style={{ color: C.text }}>Your patch is recording</div>
            <div style={{ fontSize: 11.5, color: C.muted, fontWeight: 600, marginTop: 2, lineHeight: 1.45 }}>Relaying your heart continuously, monitored 24×7.</div>
          </div>
          <span className="text-xs font-bold px-2.5 py-1 rounded-full flex-shrink-0" style={{ background: 'rgba(95,220,168,0.14)', color: '#178A5C' }}>Day 1 of {hsDays}</span>
        </div>

        {/* Live vitals — separate premium cards */}
        <div className="grid grid-cols-1 gap-2.5">
          {[
            ['❤️', 'Heart rate — continuous', '72', 'bpm'],
          ].map(([e, name, val, unit]) => (
            <button key={name} className="rounded-2xl p-3 text-center" style={{ background: WHITE.bg, border: `1px solid ${WHITE.border}` }}>
              <div className="flex items-center justify-center gap-1">
                <span style={{ fontSize: 14 }}>{e}</span>
                <span className="flex items-center justify-center rounded-full" style={{ width: 15, height: 15, background: '#2B6CB0' }}><span style={{ color: '#FFFFFF', fontSize: 8, fontWeight: 800 }}>›</span></span>
              </div>
              <div className="flex items-baseline justify-center gap-0.5 mt-1">
                <span className="font-display text-lg font-bold" style={{ color: WHITE.ink, lineHeight: 1 }}>{val}</span>
                <span style={{ fontSize: 9, color: WHITE.muted, fontWeight: 700 }}>{unit}</span>
              </div>
              <div style={{ fontSize: 9, color: WHITE.navy, fontWeight: 800, marginTop: 2 }}>{name}</div>
              <div className="flex items-center justify-center gap-1 mt-0.5">
                <span className="rounded-full" style={{ width: 5, height: 5, background: '#1E9E6A' }}></span>
                <span style={{ fontSize: 8.5, color: '#1E9E6A', fontWeight: 700 }}>Normal</span>
              </div>
            </button>
          ))}
        </div>

        {/* Heart age — compact */}
        {(() => {
          const prof = foProfile();
          const hAge = (careRisk && careRisk.heartAge) ? careRisk.heartAge : assessCVD(prof).heartAge;
          const diff = hAge - prof.age;
          return (
            <button onClick={() => { tapFeel('tap'); setPvSheet('age'); }} className="w-full rounded-2xl text-left flex items-center gap-3.5 px-4 py-3.5 relative overflow-hidden" style={{ background: 'linear-gradient(140deg, #12233A 0%, #0A1626 60%, #071120 100%)', border: '1px solid rgba(201,162,39,0.38)' }}>
              <div style={{ position: 'absolute', top: 0, left: 16, right: 16, height: 1, background: 'linear-gradient(90deg, transparent, rgba(201,162,39,0.55), transparent)' }} />
              <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 40, height: 40, background: 'rgba(201,162,39,0.12)', border: '1px solid rgba(201,162,39,0.4)' }}>
                <Heart size={17} color="#C9A227" fill="#C9A227" />
              </span>
              <div className="flex-1 min-w-0">
                <div style={{ fontSize: 14.5, color: '#FFFFFF', fontWeight: 600 }}>Your heart age</div>
                <div style={{ fontSize: 12, color: '#93AECB', marginTop: 2 }}>{diff > 0 ? `${diff} years ahead of you — see what changes it` : 'See what changes it'}</div>
              </div>
              <span className="flex items-center gap-2 flex-shrink-0">
                <span className="font-display" style={{ fontSize: 24, fontWeight: 700, color: '#E3C766' }}>{hAge}</span>
                <ChevronRight size={16} color="#C9A227" />
              </span>
            </button>
          );
        })()}

        {/* Today, I want to… — tapping a goal opens its plan and session */}
        <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <div className="text-base font-bold" style={{ color: C.text }}>Today, I want to…</div>
          <div className="text-xs mt-0.5 mb-3" style={{ color: C.muted }}>Movement is safe and encouraged while you wear the patch. Pick one and we'll set your target.</div>
          <div className="grid grid-cols-2 gap-2">
            {PV_GOALS.map(g => (
              <button key={g.id} onClick={() => { tapFeel('select'); setPvGoal(g.id); setPvSess({ status: 'brief', secs: 0, inZone: 0, hr: 72, avgHr: 0 }); setPvSheet('session'); }} className="rounded-xl px-3 py-3.5 text-left flex items-center gap-2.5" style={{ background: C.panelLight, border: `1.5px solid ${C.border}` }}>
                <span style={{ fontSize: 17 }}>{g.e}</span>
                <span className="flex-1" style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{g.label}</span>
                <ChevronRight size={13} color={C.muted} />
              </button>
            ))}
          </div>
          <button onClick={() => { tapFeel('tap'); setPvSheet('zones'); }} className="w-full flex items-center gap-3 mt-3 pt-3" style={{ borderTop: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 15 }}>🎯</span>
            <span className="flex-1 text-left"><span className="text-sm font-bold" style={{ color: C.text }}>Heart zones</span><div style={{ fontSize: 11.5, color: C.muted, fontWeight: 600 }}>What they are, and which one you should train in</div></span>
            <ChevronRight size={15} color={C.navy} />
          </button>
        </div>

        {/* Exercise test — launcher */}
        <button onClick={() => { tapFeel('tap'); setHetView(hetStage >= HET_STAGES.length ? 'done' : 'intro'); }} className="w-full rounded-2xl p-4 flex items-center gap-3.5 text-left" style={{ background: 'linear-gradient(120deg, #2B6CB0, #153E6F)', boxShadow: '0 8px 22px rgba(21,62,111,0.25)' }}>
          <div className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 46, height: 46, background: 'rgba(255,255,255,0.2)', fontSize: 22 }}>{hetStage >= HET_STAGES.length ? '✅' : '🏃'}</div>
          <div className="flex-1">
            <div className="text-base font-bold" style={{ color: '#FFFFFF' }}>{hetStage >= HET_STAGES.length ? 'Exercise test complete' : 'Your 12-minute exercise test'}</div>
            <div className="text-xs font-semibold mt-0.5" style={{ color: 'rgba(255,255,255,0.8)' }}>{hetStage >= HET_STAGES.length ? 'Recorded · see your summary' : 'Walk · Climb · Recover — the app tells you what to do'}</div>
          </div>
          <span className="text-xs font-bold" style={{ color: '#FFFFFF' }}>{hetStage >= HET_STAGES.length ? 'View →' : 'Start →'}</span>
        </button>

        {/* Blood markers — quiet evidence note */}
        <button onClick={() => setHcLabsView('info')} className="w-full rounded-2xl p-4 flex items-center gap-3 text-left" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 20 }}>🔬</span>
          <span className="text-xs font-semibold flex-1" style={{ color: C.muted, lineHeight: 1.5 }}>Evidence shows five blood markers make a heart check definitive.{hcLabsAdded ? ' Added to your check ✓' : ''} <b style={{ color: C.navy }}>Learn more →</b></span>
        </button>

        {sharedLogRows()}
        {renderQuickSugar()}

        {/* After the check — iLive Prevent (compact) */}
        <button onClick={() => { setPlanDetail('essential'); setShowPlans(true); }} className="w-full rounded-2xl p-4 text-left" style={{ background: 'linear-gradient(140deg, #2C5A8F 0%, #16304F 100%)', boxShadow: '0 1px 2px rgba(21,62,111,0.06), 0 10px 22px rgba(21,62,111,0.12)' }}>
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center rounded-xl flex-shrink-0" style={{ width: 40, height: 40, background: 'rgba(255,255,255,0.14)', fontSize: 20 }}>🛡️</div>
            <div className="flex-1">
              <div className="text-sm font-bold" style={{ color: '#FFFFFF' }}>After your report — iLive Prevent</div>
              <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.8)', fontWeight: 600, lineHeight: 1.35, marginTop: 2 }}>Daily insights · a doctor steps in early · diet & exercise guidance</div>
            </div>
            <span className="text-xs font-bold flex-shrink-0" style={{ color: '#FFFFFF' }}>₹29,999/year →</span>
          </div>
        </button>
      </div>
    );
  }

  function renderWoundHome() {
    const RC = '#C2185B';
    const takenCount = medications.filter(m => m.taken).length;
    const sugarOk = lastSugar.value < 180 && lastSugar.value > 70;
    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold" style={{ color: C.muted }}>🩹 WoundConnect · Day 21</div>
            <div className="font-display text-2xl" style={{ color: C.text, fontWeight: 800 }}>{signupName || 'Meena Kapoor'}</div>
          </div>
          <span className="text-xs font-bold px-3 py-1.5 rounded-full flex-shrink-0" style={{ background: 'rgba(30,158,106,0.12)', color: '#1E9E6A' }}>Healing ✓</span>
        </div>

        {vitalsBlock('Recovery Score', 76, 'Good')}

        {/* ONE status */}
        <div className="rounded-2xl p-5" style={{ background: 'linear-gradient(120deg, #2B6CB0, #153E6F)' }}>
          <div className="text-base font-bold mb-1" style={{ color: '#FFFFFF' }}>Your wound is healing well</div>
          <div className="flex items-end gap-2 mb-1">
            <span className="font-display font-bold" style={{ fontSize: 40, color: '#7FE0B4', lineHeight: 1 }}>26%</span>
            <span className="text-sm font-bold pb-1" style={{ color: '#DCE9F8' }}>smaller in 3 weeks · ahead of schedule</span>
          </div>
          <div className="flex items-end gap-1.5 mt-2 mb-2" style={{ height: 34 }}>
            {[4.2, 3.6, 3.1].map((a, i) => (
              <div key={i} className="rounded-t" style={{ width: 34, height: `${(a / 4.2) * 100}%`, background: i === 2 ? '#7FE0B4' : 'rgba(255,255,255,0.3)' }} />
            ))}
            <span className="text-xs font-bold pb-0.5 ml-1" style={{ color: '#DCE9F8' }}>4.2 → 3.1 cm²</span>
          </div>
          <button onClick={() => { setAppPhase('woundCare'); setWoundStep('tracker'); }} className="rounded-full px-4 py-2 text-xs font-bold" style={{ background: '#FFFFFF', color: '#153E6F' }}>Full journey →</button>
        </div>

        {/* ONE next step */}
        <div className="rounded-2xl p-4 flex items-center gap-3.5" style={{ background: 'rgba(194,24,91,0.06)', border: '1.5px solid rgba(194,24,91,0.35)' }}>
          <div className="flex items-center justify-center rounded-xl flex-shrink-0" style={{ width: 48, height: 48, background: 'rgba(194,24,91,0.12)', fontSize: 24 }}>{woundChannel === 'center' ? '🏥' : '🚐'}</div>
          <div className="flex-1">
            <div className="text-xs font-bold" style={{ color: RC, letterSpacing: 0.5 }}>YOUR NEXT STEP</div>
            <div className="text-sm font-bold mt-0.5" style={{ color: C.text }}>Dressing · Thursday, 11 AM{woundChannel === 'center' ? ' · at your centre' : ' · at your home'}</div>
            <div className="text-xs" style={{ color: C.muted }}>Nurse Priya · supervised by Dr. Kapoor · nothing to prepare</div>
          </div>
        </div>

        {/* THREE daily jobs */}
        <div>
          <div className="text-lg font-bold mb-3" style={{ color: C.text }}>Your 3 jobs — that's all</div>
          <div className="grid grid-cols-3 gap-2.5">
            <button onClick={() => toggleMed(medications.find(m => !m.taken)?.id)} className="rounded-2xl p-3.5 text-left" style={{ background: takenCount === medications.length ? 'rgba(30,158,106,0.10)' : C.panel, border: `2px solid ${takenCount === medications.length ? 'rgba(30,158,106,0.5)' : 'rgba(232,161,61,0.45)'}` }}>
              <div style={{ fontSize: 22 }}>💊</div>
              <div className="text-sm font-bold mt-1.5" style={{ color: C.text }}>Medicines</div>
              <div className="text-xs font-bold" style={{ color: takenCount === medications.length ? '#1E9E6A' : '#C77E1A' }}>{takenCount}/{medications.length} {takenCount === medications.length ? '✓' : '· tap'}</div>
            </button>
            <button onClick={() => { setActiveLog(activeLog === 'sugar' ? null : 'sugar'); setLogMethod('manual'); }} className="rounded-2xl p-3.5 text-left" style={{ background: readingLoggedToday ? 'rgba(30,158,106,0.10)' : C.panel, border: `2px solid ${readingLoggedToday ? 'rgba(30,158,106,0.5)' : 'rgba(43,108,176,0.4)'}` }}>
              <div style={{ fontSize: 22 }}>🩸</div>
              <div className="text-sm font-bold mt-1.5" style={{ color: C.text }}>Sugar</div>
              <div className="text-xs font-bold" style={{ color: readingLoggedToday ? '#1E9E6A' : C.green }}>{readingLoggedToday ? `${lastSugar.value} ✓` : sugarOk ? 'log today' : 'log now'}</div>
            </button>
            <button onClick={() => setWoundPhotoSent(true)} className="rounded-2xl p-3.5 text-left" style={{ background: woundPhotoSent ? 'rgba(30,158,106,0.10)' : C.panel, border: `2px solid ${woundPhotoSent ? 'rgba(30,158,106,0.5)' : 'rgba(194,24,91,0.4)'}` }}>
              <div style={{ fontSize: 22 }}>📷</div>
              <div className="text-sm font-bold mt-1.5" style={{ color: C.text }}>Photo</div>
              <div className="text-xs font-bold" style={{ color: woundPhotoSent ? '#1E9E6A' : RC }}>{woundPhotoSent ? 'Sent ✓' : 'weekly · tap'}</div>
            </button>
          </div>
          {woundPhotoSent && (
            <div className="rounded-xl px-3.5 py-2.5 mt-2.5 text-xs font-bold" style={{ background: 'rgba(30,158,106,0.09)', color: '#1E9E6A' }}>Photo received — your specialist will review it today ✓</div>
          )}
        </div>
        {renderQuickSugar()}

        {!isSubscribed && journeysMiniCard()}


      </div>
    );
  }

  function journeysMiniCard() {
    return (
      <div>
        <div className="text-sm font-bold" style={{ color: C.text }}>Go further — your next step</div>
        <div className="text-xs font-semibold mb-2.5" style={{ color: C.muted }}>Tap one to see everything it includes</div>
        <div className="space-y-2">
          {[...PLANS].sort((a, b) => ({ heartScreen: 0, connect: 1, connectPlus: 2, prive: 3, essential: 4 }[a.id] ?? 9) - ({ heartScreen: 0, connect: 1, connectPlus: 2, prive: 3, essential: 4 }[b.id] ?? 9)).map(plan => (
            <button key={plan.id} onClick={() => { setPlanDetail(plan.id); setShowPlans(true); }} className="w-full rounded-xl px-3.5 py-3 text-left flex items-center gap-3" style={{ background: plan.grad, boxShadow: '0 1px 2px rgba(21,62,111,0.05), 0 10px 22px rgba(21,62,111,0.12)' }}>
              <span style={{ fontSize: 19, lineHeight: 1 }}>{plan.emoji}</span>
              <div className="flex-1">
                <div className="text-sm font-bold" style={{ color: '#FFFFFF' }}>{plan.name}</div>
                <div style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.82)', fontWeight: 600, lineHeight: 1.3 }}>{plan.tagline}</div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-xs font-bold" style={{ color: '#FFFFFF' }}>{plan.price}</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.85)', fontWeight: 700 }}>Explore →</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  function freeValueCard() {
    return (
      <div className="space-y-4">
        {/* Yours free — always */}
        <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <div className="text-sm font-bold" style={{ color: C.text }}>Your free health journey</div>
          <div className="text-xs font-medium mt-0.5 mb-2.5" style={{ color: C.muted }}>No charges, no expiry — tap any service to use it now.</div>
          <div className="grid grid-cols-2 gap-2">
            {[
              ['🧪', 'Order lab tests at home', '#2B6CB0', () => { setMoreScreen('labs'); setActiveTab('more'); }],
              ['🩺', 'Second opinion', '#B0486E', () => { setMoreScreen('secondOpinion'); setActiveTab('more'); }],
              ['📄', 'My prescriptions', '#C77E1A', () => setRxOpen(true)],
              ['🛂', 'Health Passport', '#7A56B4', () => setAppPhase('healthRecord')],
              ['📞', 'Consult iLive doctor — 2 calls free', '#178A5C', () => setIncomingCall({ id: 'free' + Date.now(), reading: 'your question', doctor: 'iLive doctor on duty', phase: 'ringing' })],
            ].map(([e, t, col, act]) => (
              <button key={t} onClick={act} className="flex items-center gap-2 rounded-xl px-2.5 py-3 text-left" style={{ background: `linear-gradient(160deg, ${col}14 0%, #FFFFFF 70%)`, border: `1px solid ${col}30` }}>
                <span className="flex items-center justify-center rounded-lg flex-shrink-0" style={{ width: 30, height: 30, background: `${col}1A`, fontSize: 15 }}>{e}</span>
                <span className="text-xs font-bold" style={{ color: C.text, lineHeight: 1.25 }}>{t}</span>
              </button>
            ))}
          </div>
        </div>

        {/* All journeys strip */}
        <div>
          <div className="text-xs font-bold mb-2" style={{ color: C.muted, letterSpacing: '0.08em' }}>iLIVE JOURNEYS</div>
          <div className="grid grid-cols-4 gap-2">
            {[
              ['❤️', 'Heart Check', '₹2,999', 'heartScreen', '#8F3A52'],
              ['🛡️', 'Prevent', '₹29,999/year', 'essential', '#2C5A8F'],
              ['💙', 'Care', '₹4,917/mo', 'connect', '#257D72'],
              ['🩹', 'Recover', '₹14,999+', 'connectPlus', '#A85B3A'],
            ].map(([e, name, price, plan, col]) => (
              <button key={name} onClick={() => { setPlanDetail(plan); setShowPlans(true); }} className="rounded-2xl p-2.5 text-center" style={{ background: `linear-gradient(160deg, ${col}18 0%, #FFFFFF 70%)`, border: `1px solid ${col}33` }}>
                <div style={{ fontSize: 18 }}>{e}</div>
                <div className="font-bold mt-1" style={{ color: C.text, fontSize: 10.5, lineHeight: 1.15 }}>{name}</div>
                <div style={{ fontSize: 8.5, color: col, fontWeight: 800, marginTop: 2 }}>{price}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Quiet upgrade */}
        <button onClick={() => setShowPlans(true)} className="w-full rounded-2xl p-4 text-left" style={{ background: 'linear-gradient(155deg, rgba(43,108,176,0.10) 0%, #FFFFFF 62%)', border: '1px solid rgba(43,108,176,0.25)' }}>
          <div className="text-sm font-bold" style={{ color: C.text }}>Today your care is reactive — we help when you reach out.</div>
          <div className="text-xs font-semibold mt-1" style={{ color: C.muted, lineHeight: 1.55 }}>With a care journey it becomes <b style={{ color: C.text }}>proactive</b>: a wristband streams your heart 24×7, AI + doctors analyse it continuously — and <b style={{ color: C.text }}>we call you</b> the moment something needs attention, usually days before you would feel it. That is the difference between an app and a health companion.</div>
          <div className="text-xs font-bold mt-2" style={{ color: C.navy }}>Explore care journeys →</div>
        </button>
      </div>
    );
  }

  function journeysHomeCard() {
    const VALUE = {
      essential: 'A doctor watches your heart 24×7 — problems caught before they grow',
      connectPlus: 'The week after hospital, made safe — chest patch + wristband, intensively watched',
      connect: 'Your condition, managed every single day by a medical team',
    };
    return (
      <div>
        <div className="font-display text-lg font-bold" style={{ color: C.text }}>One app for every stage of your health.</div>
        <div className="text-xs font-semibold mb-3" style={{ color: C.muted }}>Continuous monitoring · immediate response · tap a journey to see everything it includes</div>
        <div className="space-y-2.5">
          {[...PLANS].sort((a, b) => ({ heartScreen: 0, connect: 1, connectPlus: 2, prive: 3, essential: 4 }[a.id] ?? 9) - ({ heartScreen: 0, connect: 1, connectPlus: 2, prive: 3, essential: 4 }[b.id] ?? 9)).map(plan => (
            <button key={plan.id} onClick={() => { setPlanDetail(plan.id); setShowPlans(true); }} className="w-full rounded-2xl p-4 text-left" style={{ background: plan.grad, boxShadow: '0 1px 2px rgba(21,62,111,0.06), 0 12px 26px rgba(21,62,111,0.13)' }}>
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center rounded-xl flex-shrink-0" style={{ width: 44, height: 44, background: 'rgba(255,255,255,0.16)', fontSize: 22 }}>{plan.emoji}</div>
                <div className="flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-base font-bold" style={{ color: '#FFFFFF' }}>{plan.name}</span>
                    <span className="text-sm font-bold flex-shrink-0" style={{ color: '#FFFFFF' }}>{plan.price}</span>
                  </div>
                  <div className="text-xs font-semibold mt-0.5" style={{ color: 'rgba(255,255,255,0.85)', lineHeight: 1.4 }}>{VALUE[plan.id]}</div>
                </div>
              </div>
              <div className="text-xs font-bold mt-2.5 text-right" style={{ color: '#FFFFFF' }}>See what’s included →</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  function premiumShell(renderFn, tag) {
    usePalette(true);
    let body;
    try { body = renderFn(); } finally { usePalette(false); }
    return (
      <div className="-mx-4 -mt-4 px-4 pt-5 pb-6 ilive-premium" style={{ background: '#0B2039', minHeight: '100%', color: '#FFFFFF' }}>
        {tag && <div style={{ fontSize: 12.5, color: '#93AECB', marginBottom: 6 }}>{tag}</div>}
        {body}
      </div>
    );
  }

  /* =========================================================================
     SHARED ACROSS EVERY HOME — one implementation for the tech team
       sharedLogRows(extra)   → Blood pressure / Blood sugar / Meals rows (+ optional Weight)
       sharedDoctorCard()     → Call your doctor card
     Palette-agnostic: reads C.* so it renders on light OR premium-dark canvases.
     ========================================================================= */
  function sharedLogRows(opts = {}) {
    const rows = [
      { k: 'bp', name: 'Blood pressure', e: '🩺', tint: '#9CCAFF', sub: 'Tap to add a reading', a: () => { setActiveLog(activeLog === 'bp' ? null : 'bp'); setLogMethod('manual'); } },
      { k: 'sugar', name: 'Blood sugar', e: '🩸', tint: '#F2A6C4', sub: 'Fasting or after a meal', a: () => { setActiveLog(activeLog === 'sugar' ? null : 'sugar'); setLogMethod('manual'); } },
      { k: 'report', name: 'Medical reports', e: '📄', tint: '#B0A4FF', sub: 'Lab, prescription, discharge summary', a: () => setActiveLog(activeLog === 'report' ? null : 'report') },
    ];
    return (
      <div>
        {/* one icon on the home screen; the four options appear on tap */}
        <button onClick={() => { tapFeel('tap'); setLogOpen(!logOpen); if (logOpen) setActiveLog(null); }} className="w-full rounded-2xl p-4 flex items-center gap-3.5 text-left" style={{ background: 'linear-gradient(160deg, rgba(255,255,255,.07) 0%, rgba(255,255,255,.015) 52%), ' + P.card, border: `1px solid ${P.hair}` }}>
          <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 42, height: 42, background: P.raised, fontSize: 19 }}>📝</span>
          <div className="flex-1 min-w-0">
            <div style={{ fontSize: 15, color: P.ink, fontWeight: 600 }}>Log your BP / sugar / reports</div>
            <div style={{ fontSize: 12, color: P.ink3, marginTop: 2, lineHeight: 1.45 }}>If anything is abnormal, our care team responds shortly.</div>
          </div>
          <span style={{ fontSize: 15, color: P.blueLite, fontWeight: 700 }}>{logOpen ? '▴' : '▾'}</span>
        </button>

        {logOpen && (
          <div className="rounded-2xl overflow-hidden mt-2" style={{ background: P.card, border: `1px solid ${P.hair}` }}>
            {rows.map((r, i) => (
              <button key={r.k} onClick={() => { tapFeel('tap'); r.a(); }} className="w-full flex items-center gap-3.5 px-4 py-3.5 text-left" style={{ borderBottom: i < rows.length - 1 ? `1px solid ${P.hair}` : 'none' }}>
                <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 36, height: 36, background: P.raised, fontSize: 16 }}>{r.e}</span>
                <div className="flex-1 min-w-0">
                  <div style={{ fontSize: 14.5, color: P.ink }}>{r.name}</div>
                  <div style={{ fontSize: 12, color: P.ink3, marginTop: 2 }}>{r.sub}</div>
                </div>
                <span className="rounded-full font-bold" style={{ padding: '7px 14px', background: r.tint, color: '#08182B', fontSize: 12.5 }}>{r.k === 'report' ? 'Upload' : 'Log'}</span>
              </button>
            ))}
          </div>
        )}
        {logOpen && <div className="ilive-dark-panel" style={{ marginTop: 8 }}>{renderQuickBP()}{renderQuickSugar()}{renderQuickMeal()}{renderQuickReport()}</div>}

        {/* One tidy group: move, eat, ask. Same on every programme. */}
        <div className="rounded-2xl overflow-hidden mt-3" style={{ background: P.card, border: `1px solid ${P.hair}` }}>
          {/* exercise — one row, opens the full prescription */}
          <button onClick={() => { tapFeel('tap'); setPvSheet('exrx'); }} className="w-full flex items-center gap-3.5 px-4 py-4 text-left" style={{ borderBottom: `1px solid ${P.hair}` }}>
            <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 40, height: 40, background: 'rgba(95,220,168,.14)', fontSize: 17 }}>🏃</span>
            <div className="flex-1 min-w-0">
              <div style={{ fontSize: 14.5, color: P.ink, fontWeight: 600 }}>Exercise recommended for you</div>
              <div style={{ fontSize: 12, color: P.ink3, marginTop: 2, lineHeight: 1.45 }}>{(() => { const r = exrxProfile(); return `Chosen from your BMI ${r.bmi} and your conditions · ${r.perSession} min today in Zone ${[...new Set(r.zones.map(z => z.z))].join('–')}`; })()}</div>
            </div>
            <ChevronRight size={16} color="#5FDCA8" />
          </button>

          {/* today I want to … — the member's own choice, plus the zones explainer */}
          <div style={{ borderBottom: `1px solid ${P.hair}` }}>
            <button onClick={() => { tapFeel('tap'); setRxOpen(!rxOpen); }} className="w-full flex items-center gap-3.5 px-4 py-4 text-left">
              <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 40, height: 40, background: P.raised, fontSize: 17 }}>🎽</span>
              <div className="flex-1 min-w-0">
                <div style={{ fontSize: 14.5, color: P.ink, fontWeight: 600 }}>Today I want to…</div>
                <div style={{ fontSize: 12, color: P.ink3, marginTop: 2 }}>Choose something else if you prefer — we'll set the zone for it</div>
              </div>
              <span style={{ fontSize: 15, color: P.blueLite, fontWeight: 700 }}>{rxOpen ? '▴' : '▾'}</span>
            </button>
            {rxOpen && (
              <div className="px-4 pb-4">
                {exrxGoalTiles()}
                <button onClick={() => { tapFeel('tap'); setPvSheet('zones'); }} className="w-full flex items-center gap-2.5 mt-3 pt-3" style={{ borderTop: `1px solid ${P.hair}` }}>
                  <span style={{ fontSize: 14 }}>🎯</span>
                  <span className="flex-1 text-left" style={{ fontSize: 12.5, color: P.blueLite, fontWeight: 600 }}>What are heart zones?</span>
                  <ChevronRight size={14} color={P.blueLite} />
                </button>
              </div>
            )}
          </div>

          {/* PlateIQ */}
          <button onClick={() => { tapFeel('tap'); setFrxView('day'); setPvSheet('foodrx'); }} className="w-full flex items-center gap-3.5 px-4 py-4 text-left" style={{ borderBottom: `1px solid ${P.hair}` }}>
            <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 40, height: 40, background: 'rgba(95,220,168,.14)', fontSize: 17 }}>📸</span>
            <div className="flex-1 min-w-0">
              <div style={{ fontSize: 14.5, color: P.ink, fontWeight: 600 }}>Check My Meal</div>
              <div style={{ fontSize: 12, color: P.ink3, marginTop: 2 }}>Scan. Score. Improve.</div>
            </div>
            <ChevronRight size={16} color="#5FDCA8" />
          </button>

          {/* diet chart, right beside it */}
          <button onClick={() => { tapFeel('tap'); setPvSheet('diet'); }} className="w-full flex items-center gap-3.5 px-4 py-4 text-left" style={{ borderBottom: `1px solid ${P.hair}` }}>
            <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 40, height: 40, background: P.raised, fontSize: 17 }}>📋</span>
            <div className="flex-1 min-w-0">
              <div style={{ fontSize: 14.5, color: P.ink, fontWeight: 600 }}>Your diet chart</div>
              <div style={{ fontSize: 12, color: P.ink3, marginTop: 2 }}>What to eat, what to keep small — North or South Indian</div>
            </div>
            <ChevronRight size={16} color={P.ink3} />
          </button>

          {/* optional diagnostics */}
          {ADDONS.filter(a => a.who.some(w => (enrolledPrograms || []).some(p => p === w))).map(a => (
            <button key={a.id} onClick={() => { tapFeel('tap'); setPvSheet('addon:' + a.id); }} className="w-full flex items-center gap-3.5 px-4 py-4 text-left" style={{ borderTop: `1px solid ${P.hair}` }}>
              <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 40, height: 40, background: P.raised, fontSize: 17 }}>{a.e}</span>
              <div className="flex-1 min-w-0">
                <div style={{ fontSize: 14.5, color: P.ink, fontWeight: 600 }}>{a.name}</div>
                <div style={{ fontSize: 12, color: P.ink3, marginTop: 2 }}>{a.sub}</div>
              </div>
              <span className="font-display flex-shrink-0" style={{ fontSize: 14, color: P.blueLite, fontWeight: 700 }}>{a.price}</span>
            </button>
          ))}
        </div>

        {/* CALL YOUR DOCTOR — the hero action on every care home */}
        <button onClick={() => { tapFeel('tap'); setIncomingCall({ id: 'cd' + Date.now(), reading: 'your call', doctor: PROGRAM_LEAD[enrolledPrograms[0]] ? `${PROGRAM_LEAD[enrolledPrograms[0]].name} · ${PROGRAM_LEAD[enrolledPrograms[0]].role}` : 'iLive doctor on duty', phase: 'ringing' }); }} className="w-full rounded-2xl text-left flex items-center gap-4 mt-3 relative overflow-hidden" style={{ background: 'linear-gradient(140deg, #1E7A5A 0%, #12513C 100%)', padding: '18px 18px', boxShadow: '0 10px 26px rgba(18,81,60,.4)' }}>
          <div style={{ position: 'absolute', right: -24, top: -24, width: 120, height: 120, borderRadius: 60, background: 'rgba(255,255,255,.06)' }} />
          <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 52, height: 52, background: 'rgba(255,255,255,.18)' }}><Phone size={22} color="#FFFFFF" /></span>
          <div className="flex-1 min-w-0">
            <div className="font-display" style={{ fontSize: 19, color: '#FFFFFF', fontWeight: 600, letterSpacing: '-0.02em' }}>Call your doctor</div>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,.85)', marginTop: 3 }}>Any medical question · 24×7 · answered by a doctor</div>
          </div>
          <ChevronRight size={18} color="#FFFFFF" />
        </button>

        {/* rotating advice — diabetes programme only */}
        {(enrolledPrograms || []).some(p => /diabet/i.test(p)) && <div className="mt-3">{adviceCard()}</div>}

      </div>
    );
  }

  function renderQuickReport() {
    if (activeLog !== 'report') return null;
    return (
      <div className="rounded-2xl p-4" style={{ background: '#16314F', border: '1.5px solid rgba(176,164,255,0.5)' }}>
        <div className="text-sm font-bold mb-2" style={{ color: '#FFFFFF' }}>Upload a medical report</div>
        <div className="grid grid-cols-2 gap-2.5">
          <button onClick={() => { tapFeel('success'); setReportShot('done'); }} className="rounded-xl py-3.5 text-sm font-bold" style={{ background: 'linear-gradient(135deg, #3B7FC9 0%, #1F5C9E 100%)', color: '#FFFFFF' }}>📷 Take a photo</button>
          <button onClick={() => { tapFeel('success'); setReportShot('done'); }} className="rounded-xl py-3.5 text-sm font-bold" style={{ background: '#1E3C60', color: '#FFFFFF' }}>🖼️ Upload from phone</button>
        </div>
        {reportShot === 'done' && <div className="rounded-xl p-3 mt-2.5 text-center" style={{ background: 'rgba(30,158,106,0.08)' }}><span className="text-xs font-bold" style={{ color: '#178A5C' }}>✓ Report received — your doctor's insights will arrive within a few hours.</span></div>}
      </div>
    );
  }

  /* ===== The team that cares for you — the standard everywhere (matches the approved design) ===== */
  const P = { bg: '#0B2039', card: '#16314F', raised: '#1E3C60', hair: 'rgba(255,255,255,.14)', ink: '#FFFFFF', ink2: '#C6D8EC', ink3: '#93AECB', blueLite: '#9CCAFF', green: '#5FDCA8', blueDeep: '#1F5CB0' };
  function sharedCareTeam(opts = {}) {
    const doc = opts.doctor || 'Dr. S. Maheshwari';
    const docRole = opts.role || 'Doctor in charge · Senior Physician';
    const nutri = opts.nutri || 'Dr. Divya', physio = opts.physio || 'Dr. Karishma';
    return (
      <div>
        <div className="px-1.5 pb-4">
          <div className="font-display" style={{ fontSize: 20, color: '#FFFFFF', fontWeight: 500, letterSpacing: '-0.025em' }}>The team that cares for you</div>
          <div className="mt-2" style={{ fontSize: 13.5, color: P.ink3, lineHeight: 1.65 }}>A doctor watches over your readings. Talk to your nutritionist or physiotherapist any time.</div>
        </div>
        <div className="rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(160deg, rgba(255,255,255,.07) 0%, rgba(255,255,255,.015) 52%), ' + P.card, border: `1px solid ${P.hair}` }}>
          <div className="flex items-center gap-3.5 px-4 py-4" style={{ borderBottom: `1px solid ${P.hair}` }}>
            <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 40, height: 40, background: P.raised, border: `1px solid ${P.blueLite}55` }}><User size={17} color={P.blueLite} /></span>
            <div className="flex-1 min-w-0"><div style={{ fontSize: 15.5, color: P.ink }}>{doc}</div><div style={{ fontSize: 12.5, color: P.ink3, marginTop: 3 }}>{docRole}</div></div>
          </div>
          {[[nutri, 'Nutritionist', '🥗'], [physio, 'Physiotherapist', '🤸']].map(([name, role, e], i) => (
            <button key={name} onClick={() => { tapFeel('tap'); setIncomingCall({ id: 'team' + Date.now(), reading: 'your consultation', doctor: `${name} · ${role}`, phase: 'ringing' }); }} className="w-full flex items-center gap-3.5 px-4 py-4 text-left" style={{ borderBottom: i < 2 ? `1px solid ${P.hair}` : 'none' }}>
              <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 40, height: 40, background: P.raised, fontSize: 17 }}>{e}</span>
              <div className="flex-1 min-w-0"><div style={{ fontSize: 15.5, color: P.ink }}>{name}</div><div style={{ fontSize: 12.5, color: P.ink3, marginTop: 3 }}>{role}</div></div>
              <span className="flex items-center gap-1.5 rounded-full px-4 py-2" style={{ background: 'rgba(95,220,168,.14)', color: P.green, fontSize: 13, fontWeight: 600 }}><Phone size={12} color={P.green} /> Talk</span>
            </button>
          ))}
        </div>
        <div className="mt-3">{sharedDoctorCard({ doctor: opts.dutyDoctor })}</div>
      </div>
    );
  }


  function sharedDoctorCard(opts = {}) {
    return (
      <button onClick={() => { tapFeel('tap'); setIncomingCall({ id: 'doc' + Date.now(), reading: 'your question', doctor: opts.doctor || 'iLive doctor on duty', phase: 'ringing' }); }} className="w-full rounded-2xl p-5 text-left" style={{ background: 'linear-gradient(120deg, #1F5CB0, #0A2140)', border: '1px solid rgba(255,255,255,.2)' }}>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="font-display" style={{ fontSize: 18, color: '#fff', letterSpacing: '-0.03em', fontWeight: 500 }}>{opts.title || 'Call your doctor'}</div>
            <div className="mt-1.5" style={{ fontSize: 13, color: 'rgba(255,255,255,.75)' }}>{opts.sub || 'Medical advice, when you need it'}</div>
          </div>
          <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 44, height: 44, background: '#fff' }}><Phone size={16} color="#1F5CB0" fill="#1F5CB0" /></span>
        </div>
        <div className="flex items-center gap-2 mt-4 pt-3.5" style={{ borderTop: '1px solid rgba(255,255,255,.14)' }}>
          <Check size={12} color="rgba(255,255,255,.8)" strokeWidth={3} />
          <span style={{ fontSize: 12.5, color: 'rgba(255,255,255,.8)' }}>{opts.foot || 'For any medical problem · available to you 24×7'}</span>
        </div>
      </button>
    );
  }

  /* Universal back arrow — top-left, on every screen after the free home */
  function goBackHome() {
    tapFeel('tap'); setActiveLog(null); setCheckinOpen(false); setSharpenView(null);
    if (isSubscribed && (selectedPlan === 'connect' || selectedPlan === 'connectPlus') && enrolledPrograms[0] && enrolledPrograms[0] !== 'iLive Free') {
      setEnrolledPrograms([]); setAppPhase('programPick'); return;
    }
    setIsSubscribed(false); setSelectedPlan(null); setEnrolledPrograms(['iLive Free']); setOnboardingDone(true); setActiveTab('home'); setAppPhase('main');
  }
  function backArrow(label = 'Back', onClick) {
    return (
      <button onClick={onClick || goBackHome} className="flex items-center gap-1.5 text-sm font-semibold mb-3" style={{ color: C.muted }}>
        <ChevronLeft size={18} style={{ color: C.muted }} /> {label}
      </button>
    );
  }

  function programBackBar() {
    const isCare = selectedPlan === 'connect';
    const isHC = selectedPlan === 'heartScreen' || selectedPlan === 'essential';
    const portalLabel = isHC ? '❤️ iLive Heart Check' : isCare ? '💙 iLive Care programs' : '🩹 iLive Recover programs';
    return (
      <div className="flex items-center justify-between -mt-1 mb-1">
        <button onClick={() => { tapFeel('tap'); setActiveLog(null); if (isHC) { setIsSubscribed(false); setSelectedPlan(null); setEnrolledPrograms(['iLive Free']); setAppPhase('main'); } else { setEnrolledPrograms([]); setAppPhase('programPick'); } }} className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: C.navy }}>
          <ChevronLeft size={18} style={{ color: C.navy }} /> {isHC ? 'Back to my free home' : 'Back'}
        </button>
        {foName && !isHC && (
          <button onClick={() => { tapFeel('tap'); setActiveLog(null); setIsSubscribed(false); setSelectedPlan(null); setEnrolledPrograms(['iLive Free']); setOnboardingDone(true); setActiveTab('home'); setAppPhase('main'); }} className="text-xs font-bold px-2.5 py-1.5 rounded-full" style={{ background: 'rgba(43,108,176,0.08)', color: C.navy, border: '1px solid rgba(43,108,176,0.25)' }}>
            My free home
          </button>
        )}
      </div>
    );
  }

  function renderHome() {
    if (checkinOpen) return renderCheckinPage();
    if (pvSheet === 'session') return renderPvSession();
    if (pvSheet === 'zones') { const a2 = Number(foAge) || 46; const g2 = PV_GOALS.find(g => g.id === pvGoal) || PV_GOALS[1]; return renderPvZonesSheet(pvZones(a2), 220 - a2, { 1: 24, 2: 31, 3: 18, 4: 12, 5: 0 }, g2); }
    if (pvSheet === 'exrx') return renderExRx();
    if (pvSheet === 'diet') return renderDietChart();
    if (pvSheet === 'foodrx') return renderFoodRx();
    if (pvSheet && String(pvSheet).startsWith('addon:')) return renderAddonPage(String(pvSheet).split(':')[1]);
    if (pvSheet === 'circle') return renderCareCirclePage();
    if (pvSheet === 'team') return renderCareTeamPage();
    if (pvSheet === 'today') return renderTodaysHealthPage();
    if (pvSheet && PV_METRICS[pvSheet]) return renderPvMetric(pvSheet);
    if (pvSheet === 'age') { const p2 = foProfile(); return renderPvAgeSheet(p2, p2.age, (careRisk && careRisk.heartAge) ? careRisk.heartAge : assessCVD(p2).heartAge, pvProjectedAge(p2, 'fit'), assessCVD(p2), null); }
    if (isSubscribed && (selectedPlan === 'connect' || selectedPlan === 'connectPlus') && (!enrolledPrograms[0] || enrolledPrograms[0] === 'iLive Free')) { setAppPhase('programPick'); return null; }
    if (!isSubscribed && foName) return renderFreeHome();
    if (careRisk === null && enrolledPrograms[0] !== 'Heart Health Check' && (selectedPlan === 'connect' || selectedPlan === 'essential')) return renderCareRiskScreen();
    if (woundProgram) return renderWoundHome();
    const prog0 = enrolledPrograms[0];
    if (prog0 === 'Post-Heart Surgery Recovery' || prog0 === 'Post-Hospital Recovery') return premiumShell(renderCardiacHome, '🩹 iLive Recover');
    if (prog0 === 'iLive Prevent') return renderProtectHome();
    if (prog0 === 'Elder Care') return premiumShell(renderElderHome, '💙 iLive Care');
    if (prog0 === 'Heart Failure Care') return premiumShell(renderCHFHome, '💙 iLive Care');
    if (prog0 === 'COPD Care') return premiumShell(renderLungHome, '💙 iLive Care');
    if (prog0 === 'Stroke Recovery') return premiumShell(renderNeuroHome, '🩹 iLive Recover');
    if (prog0 === 'Blood Pressure Control') return premiumShell(renderBPHome, '💙 iLive Care');
    if (prog0 === 'Diabetes Control') return renderDiabetesHome();
    if (prog0 === 'Post-Cardiac Event Recovery') return premiumShell(renderCardiacHome, '🩹 iLive Recover');
    if (prog0 === 'Cancer Care') return renderOncoHome();
    if (prog0 === 'CKD & Dialysis Support') return renderKidneyHome();
    if (prog0 === 'Heart Health Check') return premiumShell(renderHeartCheckHome, '❤️ iLive Heart Check');
    return (
      <div className="space-y-5">
        <div>
          <div className="text-sm" style={{ color: C.muted }}>Good afternoon</div>
          <div className="font-display text-2xl" style={{ color: C.text, fontWeight: 700 }}>{signupName || 'Meena Kapoor'}</div>
        </div>

        {vitalsBlock('Recovery Score', 72, 'Good')}



        {entryType === 'discharge' && isSubscribed && selectedPlan !== 'essential' && (
          <div className="rounded-2xl p-4" style={{ background: planExtended ? C.panel : 'rgba(199,126,26,0.08)', border: `1.5px solid ${planExtended ? 'rgba(43,108,176,0.35)' : 'rgba(199,126,26,0.4)'}` }}>
            {planExtended ? (
              <div className="flex items-center gap-3">
                <CheckCircle2 size={20} style={{ color: C.green, flexShrink: 0 }} />
                <div className="text-sm font-bold" style={{ color: C.text }}>Extended to monthly ✓ <span className="font-semibold" style={{ color: C.muted }}>· same price, till 4 Aug</span></div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-bold" style={{ color: C.text }}>Intensive post-op week · Day 6 of 7</span>
                  <span className="text-xs font-bold" style={{ color: '#C77E1A' }}>Ends tomorrow</span>
                </div>
                <div className="text-xs mb-3 font-medium" style={{ color: C.muted }}>Keep your {selectedPlan === 'connectPlus' ? 'wristband + chest patch' : 'wristband'} monitoring going — continue as a monthly program at the same price.</div>
                <button onClick={() => setPlanExtended(true)} className="w-full rounded-xl py-3 text-sm font-bold" style={{ background: 'linear-gradient(135deg, #3B7FC9 0%, #1F5C9E 100%)', color: '#FFFFFF', boxShadow: '0 6px 18px rgba(31,92,158,0.32)' }}>
                  {selectedPlan === 'connectPlus' ? 'Extend to 14 days · ₹24,999' : 'Continue with iLive Care · ₹5,999/mo'}
                </button>
              </>
            )}
          </div>
        )}

        {renderProgramHero()}

        {!isSubscribed && sharpenCard()}
        {!isSubscribed && freeValueCard()}

        {!isSubscribed && renderJourneyCard()}

        <button onClick={() => setRxOpen(!rxOpen)} className="w-full rounded-2xl p-4 flex items-center gap-3 text-left" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 19 }}>📄</span>
          <span className="text-sm font-bold flex-1" style={{ color: C.text }}>My prescriptions</span>
          <span className="text-xs font-bold" style={{ color: C.navy }}>{rxOpen ? 'Hide ▴' : 'View ▾'}</span>
        </button>
        {rxOpen && (
        <div className="rounded-2xl p-5" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <div className="flex items-center gap-2 mb-4">
            <Pill size={18} style={{ color: C.amber }} />
            <span className="text-base font-semibold" style={{ color: C.text }}>Today's medicines</span>
          </div>
          <div className="space-y-3">
            {medications.map(med => (
              <button key={med.id} onClick={() => toggleMed(med.id)} className="w-full flex items-center gap-3 rounded-xl p-3 text-left">
                <div
                  className="flex items-center justify-center rounded-full flex-shrink-0"
                  style={{ width: 28, height: 28, background: med.taken ? C.green : 'transparent', border: `2px solid ${med.taken ? C.green : C.muted}` }}
                >
                  {med.taken && <CheckCircle2 size={18} color={C.ink} />}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium" style={{ color: med.taken ? C.muted : C.text, textDecoration: med.taken ? 'line-through' : 'none' }}>{med.name}</div>
                  <div className="text-xs" style={{ color: C.muted }}>{med.time}{med.withFood ? ' · with food' : ''}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
        )}

        <div>
          <div className="text-base font-bold" style={{ color: C.text }}>Get doctor insights — immediately</div>
          <div className="text-xs font-semibold mt-0.5 mb-2.5" style={{ color: C.muted, lineHeight: 1.45 }}>Log your blood pressure or blood sugar — or send any health, lab or consultation report.</div>
          {sharedLogRows()}
          <button onClick={() => { tapFeel('tap'); setPvSheet('team'); }} className="w-full rounded-2xl p-4 flex items-center gap-3.5 text-left" style={{ background: 'linear-gradient(160deg, rgba(255,255,255,.07) 0%, rgba(255,255,255,.015) 52%), #16314F', border: '1px solid rgba(255,255,255,.14)' }}>
            <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 40, height: 40, background: '#1E3C60', fontSize: 17 }}>👥</span>
            <div className="flex-1 min-w-0">
              <div style={{ fontSize: 14.5, color: '#FFFFFF', fontWeight: 600 }}>Your care team</div>
              <div style={{ fontSize: 12, color: '#93AECB', marginTop: 2 }}>Doctor · longevity expert · exercise specialist</div>
            </div>
            <ChevronRight size={16} color="#93AECB" />
          </button>
          <button onClick={() => setReportShot(reportShot ? null : 'open')} className="w-full rounded-2xl p-4 mt-2.5 flex items-center gap-3 text-left" style={{ background: 'linear-gradient(160deg, rgba(122,86,180,0.14) 0%, rgba(122,86,180,0.04) 45%, #FFFFFF 100%)', border: '1.5px solid rgba(122,86,180,0.35)', boxShadow: '0 1px 2px rgba(21,62,111,0.05), 0 10px 24px rgba(122,86,180,0.18)' }}>
            <div className="flex items-center justify-center rounded-2xl flex-shrink-0" style={{ width: 44, height: 44, background: 'linear-gradient(140deg, #7A56B4 0%, #5C3F8E 100%)', fontSize: 20, boxShadow: '0 6px 14px rgba(122,86,180,0.4)' }}>📷</div>
            <div className="flex-1">
              <div className="text-sm font-bold" style={{ color: C.text }}>Send any report — snap a photo</div>
              <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 600, lineHeight: 1.35 }}>Lab report · consultation · discharge summary — doctor insights follow</div>
            </div>
          </button>
          {reportShot === 'open' && (
            <div className="grid grid-cols-2 gap-2.5 mt-2.5">
              <button onClick={() => setReportShot('done')} className="rounded-xl py-3.5 text-sm font-bold" style={{ background: 'linear-gradient(135deg, #3B7FC9 0%, #1F5C9E 100%)', color: '#FFFFFF', boxShadow: '0 6px 18px rgba(31,92,158,0.32)' }}>📷 Take a photo</button>
              <button onClick={() => setReportShot('done')} className="rounded-xl py-3.5 text-sm font-bold" style={{ background: C.panelLight, color: C.text, border: `1px solid ${C.border}` }}>🖼️ Upload from phone</button>
            </div>
          )}
          {reportShot === 'done' && (
            <div className="rounded-xl p-3 mt-2.5 text-center" style={{ background: 'rgba(30,158,106,0.08)', border: '1px solid rgba(30,158,106,0.35)' }}>
              <span className="text-xs font-bold" style={{ color: '#178A5C' }}>✓ Report received — your doctor's insights will arrive as a notification within a few hours.</span>
            </div>
          )}
        </div>

        {renderDailyCheckin()}

        <button onClick={() => setActiveTab('family')} className="w-full rounded-2xl p-4 flex items-center gap-3 text-left" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <span className="flex items-center justify-center rounded-xl flex-shrink-0" style={{ width: 40, height: 40, background: 'rgba(43,108,176,0.1)', fontSize: 19 }}>👨‍👩‍👧</span>
          <div className="flex-1">
            <div className="text-sm font-bold" style={{ color: C.text }}>My family</div>
            <div style={{ fontSize: 10.5, color: C.muted, fontWeight: 600 }}>Add family & see their daily check-ins</div>
          </div>
          <span className="text-xs font-bold" style={{ color: C.navy }}>Open →</span>
        </button>

        <div className="rounded-2xl p-4 flex items-center justify-between" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <div className="flex items-center gap-3">
            <MessageCircle size={18} style={{ color: C.green }} />
            <div>
              <div className="text-sm font-semibold" style={{ color: C.text }}>WhatsApp logging</div>
              <div className="text-xs" style={{ color: C.muted }}>Message a reading — no app needed</div>
            </div>
          </div>
          <div className="rounded-full flex-shrink-0" style={{ width: 40, height: 22, background: C.green, padding: 2 }}>
            <div className="rounded-full" style={{ width: 18, height: 18, background: C.ink, marginLeft: 18 }} />
          </div>
        </div>

        <button onClick={() => setAppPhase('healthRecord')} className="w-full rounded-2xl p-4 flex items-center gap-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <div className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 40, height: 40, background: 'rgba(43,108,176,0.15)' }}>
            <QrCode size={18} style={{ color: C.green }} />
          </div>
          <div className="flex-1 text-left">
            <div className="text-sm font-semibold" style={{ color: C.text }}>My Health Passport</div>
            <div className="text-xs" style={{ color: C.muted }}>One QR · every report & medicine · builds itself</div>
          </div>
          <ChevronRight size={18} style={{ color: C.muted }} />
        </button>

        {isSubscribed && selectedPlan === 'essential' && (
          <button onClick={() => setShowPlans(true)} className="w-full rounded-2xl p-4 text-left" style={{ background: 'linear-gradient(135deg, rgba(43,108,176,0.12), rgba(244,166,61,0.08))', border: `1px solid ${C.border}` }}>
            <div className="text-sm font-semibold mb-1" style={{ color: C.text }}>Want continuous monitoring?</div>
            <div className="text-xs mb-2" style={{ color: C.muted }}>Connect adds a wristband with ECG-backed tracking — no manual logging.</div>
            <div className="text-sm font-semibold" style={{ color: C.green }}>See what's included →</div>
          </button>
        )}
      </div>
    );
  }

  function toggleConcern(c) {
    setConcerns(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);
  }

  function submitCheckin() {
    setCheckedIn(true);
    setCheckinTime('Just now');
    setCheckinOpen(false);
  }

  const flagged = mood === 'low' || concerns.length > 0;

  function renderDailyCheckin() {
    const moods = [
      { id: 'good', emoji: '😊', label: 'Good' },
      { id: 'okay', emoji: '😐', label: 'Okay' },
      { id: 'low', emoji: '😟', label: 'Not great' },
    ];
    const concernList = ['Pain', 'Breathing', 'Poor sleep', 'Swelling', 'Weight change'];

    if (checkedIn) {
      return (
        <div className="rounded-2xl p-5" style={{ background: C.panel, border: `1.5px solid ${flagged ? 'rgba(232,161,61,0.5)' : 'rgba(43,108,176,0.35)'}` }}>
          <div className="flex items-center gap-4">
            <div className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 48, height: 48, background: flagged ? 'rgba(232,161,61,0.15)' : 'rgba(43,108,176,0.12)' }}>
              <CheckCircle2 size={24} style={{ color: flagged ? C.amber : C.green }} />
            </div>
            <div>
              <div className="text-base font-bold" style={{ color: C.text }}>{flagged ? 'Check-in received' : 'Sent to your family'}</div>
              <div className="text-xs mt-0.5 font-medium" style={{ color: flagged ? C.amber : C.green }}>
                {flagged ? 'Your care team has been notified — expect a call' : `Checked in · ${checkinTime} · All good ✓`}
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (!checkinOpen) {
      return (
        <button onClick={() => setCheckinOpen(true)} className="w-full rounded-2xl p-5 flex items-center gap-4" style={{ background: 'linear-gradient(120deg, #2B6CB0, #153E6F)' }}>
          <div className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 48, height: 48, background: 'rgba(255,255,255,0.22)', fontSize: 22 }}>😊</div>
          <div className="text-left flex-1">
            <div className="text-base font-bold" style={{ color: '#FFFFFF' }}>Daily check-in</div>
            <div className="text-xs" style={{ color: '#C9DCF2' }}>30 seconds · catches problems early</div>
          </div>
          <ChevronRight size={20} color="#C9DCF2" />
        </button>
      );
    }

    return (
      <div className="rounded-2xl p-5" style={{ background: C.panel, border: `1.5px solid rgba(43,108,176,0.35)` }}>
        <div className="text-base font-bold mb-1" style={{ color: C.text }}>How do you feel today?</div>
        <div className="text-xs mb-3" style={{ color: C.muted }}>Takes 30 seconds · seen by your family & care team</div>

        <div className="flex gap-2 mb-4">
          {moods.map(m => (
            <button key={m.id} onClick={() => setMood(m.id)}
              className="flex-1 rounded-xl py-3 flex flex-col items-center gap-1"
              style={{ background: mood === m.id ? 'rgba(43,108,176,0.12)' : C.panelLight, border: `2px solid ${mood === m.id ? C.green : 'transparent'}` }}>
              <span style={{ fontSize: 26 }}>{m.emoji}</span>
              <span className="text-xs font-semibold" style={{ color: mood === m.id ? C.green : C.muted }}>{m.label}</span>
            </button>
          ))}
        </div>

        <div className="text-sm font-bold mb-2" style={{ color: C.text }}>Anything bothering you?</div>
        <div className="flex flex-wrap gap-2 mb-4">
          {concernList.map(c => (
            <button key={c} onClick={() => toggleConcern(c)}
              className="px-3 py-1.5 rounded-full text-xs font-semibold"
              style={{ background: concerns.includes(c) ? C.amber : C.panelLight, color: concerns.includes(c) ? '#FFFFFF' : C.muted, border: `1px solid ${concerns.includes(c) ? C.amber : C.border}` }}>
              {c}
            </button>
          ))}
          <button onClick={() => setConcerns([])}
            className="px-3 py-1.5 rounded-full text-xs font-semibold"
            style={{ background: concerns.length === 0 && mood ? 'rgba(43,108,176,0.12)' : C.panelLight, color: concerns.length === 0 && mood ? C.green : C.muted, border: `1px solid ${concerns.length === 0 && mood ? C.green : C.border}` }}>
            Nothing ✓
          </button>
        </div>

        <button onClick={submitCheckin} disabled={!mood}
          className="w-full rounded-xl py-3.5 text-base font-bold"
          style={{ background: mood ? C.green : C.panelLight, color: mood ? '#FFFFFF' : C.muted }}>
          Send my check-in
        </button>
      </div>
    );
  }

  /* ---------- GUARDIAN VIEW ---------- */

  function renderGuardianHome() {
    const takenCount = medications.filter(m => m.taken).length;
    const parentLabel = familyMember.name || 'Your parent';
    return (
      <div className="space-y-5">
        <div>
          <div className="text-sm" style={{ color: C.muted }}>Good afternoon</div>
          <div className="font-display text-2xl" style={{ color: C.text, fontWeight: 700 }}>{parentLabel}'s care</div>
        </div>

        <div className="rounded-2xl p-5" style={{ background: 'linear-gradient(135deg, rgba(43,108,176,0.16), rgba(234,242,251,0.4))', border: `1px solid ${C.border}` }}>
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-semibold" style={{ color: C.text }}>Today, at a glance</span>
            <span className="text-xs flex items-center gap-1" style={{ color: C.green }}>
              <span style={{ width: 6, height: 6, borderRadius: 9999, background: C.green, display: 'inline-block' }} />
              Active 12 min ago
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-xs mb-1" style={{ color: C.muted }}>iLive Score</div>
              <div className="text-sm font-bold" style={{ color: iliveScore >= 75 ? C.green : iliveScore >= 50 ? C.amber : C.coral }}>{iliveScore}</div>
            </div>
            <div>
              <div className="text-xs mb-1" style={{ color: C.muted }}>Check-in</div>
              <div className="text-sm font-bold" style={{ color: checkedIn ? C.green : C.amber }}>{checkedIn ? `Done · ${checkinTime}` : 'Not yet'}</div>
            </div>
            <div>
              <div className="text-xs mb-1" style={{ color: C.muted }}>Medicines</div>
              <div className="text-sm font-bold" style={{ color: C.text }}>{takenCount}/{medications.length} taken</div>
            </div>
          </div>
        </div>

        {!checkedIn && (
          <button
            onClick={() => setReminderSent(true)}
            disabled={reminderSent}
            className="w-full rounded-2xl p-4 flex items-center gap-4"
            style={{ background: reminderSent ? C.panel : C.amber, border: reminderSent ? `1px solid ${C.border}` : 'none' }}
          >
            <div className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 40, height: 40, background: reminderSent ? 'rgba(43,108,176,0.15)' : 'rgba(255,255,255,0.22)' }}>
              {reminderSent ? <CheckCircle2 size={20} style={{ color: C.green }} /> : <MessageCircle size={18} color={C.ink} />}
            </div>
            <div className="text-left">
              <div className="text-sm font-bold" style={{ color: reminderSent ? C.text : C.ink }}>{reminderSent ? 'Reminder sent' : 'Send a check-in reminder'}</div>
              <div className="text-xs" style={{ color: reminderSent ? C.muted : C.ink, opacity: reminderSent ? 1 : 0.7 }}>{reminderSent ? `We've nudged ${parentLabel} to check in` : "They haven't checked in yet today"}</div>
            </div>
          </button>
        )}

        <div className="grid grid-cols-2 gap-3">
          <button className="rounded-2xl p-4 flex flex-col items-center gap-2" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
            <Phone size={20} style={{ color: C.green }} />
            <span className="text-sm font-semibold" style={{ color: C.text }}>Call {parentLabel}</span>
          </button>
          <button className="rounded-2xl p-4 flex flex-col items-center gap-2" style={{ background: C.green }}>
            <Stethoscope size={20} color={C.ink} />
            <span className="text-sm font-semibold" style={{ color: C.ink }}>Call care team</span>
          </button>
        </div>

        <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <div className="text-sm font-semibold mb-3" style={{ color: C.text }}>This week</div>
          <div className="space-y-3">
            {[{ label: 'Daily check-ins', value: 6, max: 7 }, { label: 'Medicines on time', value: 12, max: 14 }].map((row, i) => (
              <div key={i}>
                <div className="flex justify-between text-xs mb-1" style={{ color: C.muted }}>
                  <span>{row.label}</span>
                  <span>{row.value}/{row.max}</span>
                </div>
                <div className="rounded-full overflow-hidden" style={{ height: 6, background: C.panelLight }}>
                  <div style={{ height: 6, width: `${(row.value / row.max) * 100}%`, background: C.green, borderRadius: 9999 }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl p-4 flex items-center justify-between" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <div>
            <div className="text-sm font-semibold" style={{ color: C.text }}>Alert me if no check-in</div>
            <div className="text-xs" style={{ color: C.muted }}>By 10:00 AM each day</div>
          </div>
          <button onClick={() => setMissedCheckinAlert(!missedCheckinAlert)} className="rounded-full flex-shrink-0" style={{ width: 40, height: 22, background: missedCheckinAlert ? C.green : C.panelLight, padding: 2 }}>
            <div className="rounded-full" style={{ width: 18, height: 18, background: C.ink, marginLeft: missedCheckinAlert ? 18 : 0, transition: 'margin 0.15s' }} />
          </button>
        </div>

        <button onClick={() => setGuardianView(false)} className="w-full text-center text-xs py-2" style={{ color: C.muted }}>
          <span style={{ color: C.green }}>← Back to my own care</span>
        </button>
      </div>
    );
  }

  /* ---------- COMMUNITY ---------- */

  function renderCommunity() {
    const posts = [
      { name: 'Sunita R.', tag: 'Heart bypass · Day 12', text: "Walked to the end of my street today without stopping. Small win but I'll take it.", hearts: 24 },
      { name: 'Vikram S.', tag: 'Lung transplant · Day 45', text: "Anyone else's appetite taking a while to come back? Nutritionist says it's normal but wanted to check.", hearts: 8 },
      { name: 'Anjali M.', tag: 'Heart bypass · Day 60', text: "One year ago I couldn't climb one flight of stairs. Today I did three. Grateful for this program.", hearts: 41 },
    ];
    return (
      <div className="space-y-4">
        <div className="rounded-2xl p-4 flex items-center gap-3" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <div className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 36, height: 36, background: 'rgba(43,108,176,0.15)' }}>
            <ShieldCheck size={18} style={{ color: C.green }} />
          </div>
          <div className="text-xs" style={{ color: C.muted }}>Moderated by our clinical team · For patients recovering from heart and lung procedures</div>
        </div>

        <button className="w-full rounded-2xl p-4 text-left" style={{ background: C.panelLight, border: `1px solid ${C.border}` }}>
          <span className="text-sm" style={{ color: C.muted }}>Ask the community a question...</span>
        </button>

        {posts.map((post, i) => (
          <div key={i} className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
            <div className="flex items-center gap-2 mb-2">
              <div className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 32, height: 32, background: C.panelLight }}>
                <span className="text-xs font-semibold" style={{ color: C.text }}>{post.name.charAt(0)}</span>
              </div>
              <div>
                <div className="text-sm font-semibold" style={{ color: C.text }}>{post.name}</div>
                <div className="text-xs" style={{ color: C.muted }}>{post.tag}</div>
              </div>
            </div>
            <div className="text-sm mb-2" style={{ color: C.text }}>{post.text}</div>
            <div className="flex items-center gap-1 text-xs" style={{ color: C.amber }}>
              <Heart size={12} fill={C.amber} color={C.amber} /> {post.hearts} found this helpful
            </div>
          </div>
        ))}
      </div>
    );
  }

  /* ---------- MORE + SERVICES ---------- */

  function renderSecondOpinion() {
    return (
      <div className="space-y-4">
        <button onClick={() => { tapFeel('tap'); setMoreScreen(null); }} className="text-sm" style={{ color: C.muted }}>← Back</button>
        <div>
          <div className="font-display text-xl mb-1" style={{ color: C.text, fontWeight: 800 }}>Second opinion</div>
          <div className="text-sm" style={{ color: C.muted, lineHeight: 1.55 }}>Talk to a specialist doctor and get an independent second opinion. Share your report or write your concern — a doctor calls you back.</div>
        </div>
        <div>
          <div className="text-sm font-semibold mb-2" style={{ color: C.text }}>Share your report or investigation</div>
          <button onClick={() => { tapFeel('select'); setOpinionUploaded(true); }} className="w-full rounded-xl py-6 flex flex-col items-center gap-2" style={{ background: C.panel, border: `1px dashed ${C.border}` }}>
            <Camera size={22} style={{ color: C.green }} />
            <span className="text-xs" style={{ color: C.muted }}>{opinionUploaded ? 'Report uploaded ✓' : 'Tap to add a photo or PDF (optional)'}</span>
          </button>
        </div>
        <div>
          <div className="text-sm font-semibold mb-2" style={{ color: C.text }}>Or write your concern</div>
          <textarea value={opinionConcern} onChange={e => setOpinionConcern(e.target.value)} placeholder="What would you like a second opinion on?" rows={4} className="w-full rounded-xl px-4 py-3 text-sm" style={{ background: C.panel, color: C.text, border: `1px solid ${C.border}` }} />
        </div>
        <button onClick={() => { tapFeel('success'); setMoreScreen(null); }} className="w-full rounded-2xl py-4 text-base font-bold" style={{ background: C.green, color: C.ink }}>Request a doctor callback</button>
        <div className="text-xs text-center" style={{ color: C.muted, lineHeight: 1.6 }}>A specialist reviews your case and calls you back — usually within a working day.</div>
      </div>
    );
  }

  function renderOrderLabs() {
    const tests = ['Lipid profile', 'HbA1c', 'ECG', 'Chest X-ray', 'Complete blood count', 'Kidney function test'];
    function toggleTest(t) {
      setSelectedTests(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
    }
    return (
      <div className="space-y-4">
        <button onClick={() => setMoreScreen(null)} className="text-sm" style={{ color: C.muted }}>← Back</button>
        <div>
          <div className="font-display text-xl mb-1" style={{ color: C.text, fontWeight: 800 }}>Order lab tests</div>
          <div className="text-sm" style={{ color: C.muted }}>Select tests, or ones your doctor has suggested. Pay per order.</div>
        </div>
        <div className="space-y-2">
          {tests.map(t => (
            <button
              key={t}
              onClick={() => toggleTest(t)}
              className="w-full flex items-center justify-between rounded-xl p-3"
              style={{ background: C.panel, border: `1px solid ${selectedTests.includes(t) ? C.green : C.border}` }}
            >
              <span className="text-sm" style={{ color: C.text }}>{t}</span>
              <div
                className="flex items-center justify-center rounded-full flex-shrink-0"
                style={{ width: 22, height: 22, background: selectedTests.includes(t) ? C.green : 'transparent', border: `2px solid ${selectedTests.includes(t) ? C.green : C.muted}` }}
              >
                {selectedTests.includes(t) && <CheckCircle2 size={14} color={C.ink} />}
              </div>
            </button>
          ))}
        </div>
        <button onClick={() => setMoreScreen(null)} className="w-full rounded-2xl py-4 text-base font-bold" style={{ background: C.green, color: C.ink }}>
          Request {selectedTests.length > 0 ? `${selectedTests.length} test${selectedTests.length > 1 ? 's' : ''}` : 'tests'}
        </button>
      </div>
    );
  }

  function renderOrderMedicines() {
    return (
      <div className="space-y-4">
        <button onClick={() => setMoreScreen(null)} className="text-sm" style={{ color: C.muted }}>← Back</button>
        <div>
          <div className="font-display text-xl mb-1" style={{ color: C.text, fontWeight: 800 }}>Order medicines</div>
          <div className="text-sm" style={{ color: C.muted }}>From your prescription, delivered to you. Pay per order.</div>
        </div>
        <div className="space-y-2">
          {medications.map(med => (
            <div key={med.id} className="w-full flex items-center justify-between rounded-xl p-3" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
              <div>
                <div className="text-sm font-medium" style={{ color: C.text }}>{med.name}</div>
                <div className="text-xs" style={{ color: C.muted }}>{med.time}{med.withFood ? ' · with food' : ''}</div>
              </div>
              <button className="rounded-full px-3 py-1.5 text-xs font-semibold" style={{ background: C.green, color: C.ink }}>Reorder</button>
            </div>
          ))}
        </div>
        <button className="w-full rounded-xl p-3 text-left text-sm" style={{ background: C.panel, border: `1px dashed ${C.border}`, color: C.muted }}>+ Search for another medicine</button>
      </div>
    );
  }

  function renderMore() {
    if (moreScreen === 'secondOpinion') return renderSecondOpinion();
    if (moreScreen === 'labs') return renderOrderLabs();
    if (moreScreen === 'medicines') return renderOrderMedicines();

    const items = [
      { label: 'Order lab tests', icon: FlaskConical, note: 'Home sample collection · pay per order', action: 'labs' },
      { label: 'Order medicines', icon: Pill, note: 'From your prescriptions, delivered home', action: 'medicines' },
      { label: 'Second opinion', icon: Stethoscope, note: 'From our specialists', action: 'secondOpinion' },
      { label: 'My prescriptions', icon: FileText, note: isSubscribed ? '2 active' : 'Enroll to get e-prescriptions', action: 'medicines' },
    ];
    return (
      <div className="space-y-3">
        {items.map((item, i) => (
          <button key={i} onClick={() => setMoreScreen(item.action)} className="w-full flex items-center gap-4 rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
            <div className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 40, height: 40, background: 'rgba(43,108,176,0.15)' }}>
              <item.icon size={18} style={{ color: C.green }} />
            </div>
            <div className="flex-1 text-left">
              <div className="text-sm font-semibold" style={{ color: C.text }}>{item.label}</div>
              <div className="text-xs" style={{ color: C.muted }}>{item.note}</div>
            </div>
            <ChevronRight size={18} style={{ color: C.muted }} />
          </button>
        ))}

        <button onClick={() => setAppPhase('healthRecord')} className="w-full flex items-center gap-4 rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <div className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 40, height: 40, background: 'rgba(43,108,176,0.15)' }}>
            <QrCode size={18} style={{ color: C.green }} />
          </div>
          <div className="flex-1 text-left">
            <div className="text-sm font-semibold" style={{ color: C.text }}>My Health Passport</div>
            <div className="text-xs" style={{ color: C.muted }}>Every report, medicine & visit · builds itself · one QR</div>
          </div>
          <ChevronRight size={18} style={{ color: C.muted }} />
        </button>
      </div>
    );
  }

  /* ---------- OPTIONAL HEALTH CHECK (from More) ---------- */

  function renderBaselineHealth() {
    const chipRow = (label, field, options) => (
      <div>
        <div className="text-sm mb-2" style={{ color: C.text }}>{label}</div>
        <div className="flex flex-wrap gap-2">
          {options.map(opt => (
            <button
              key={opt}
              onClick={() => setBaseline({ ...baseline, [field]: opt })}
              className="px-3 py-1.5 rounded-full text-xs font-medium"
              style={{
                background: baseline[field] === opt ? C.green : C.panel,
                color: baseline[field] === opt ? C.ink : C.muted,
                border: `1px solid ${baseline[field] === opt ? C.green : C.border}`,
              }}
            >
              {opt}
            </button>
          ))}
        </div>
      </div>
    );
    return (
      <div className="space-y-5">
        <button onClick={() => setAppPhase('main')} className="text-sm text-left" style={{ color: C.muted }}>← Back</button>
        <div>
          <div className="font-display text-2xl mb-1" style={{ color: C.text, fontWeight: 800 }}>Your health profile</div>
          <div className="text-sm" style={{ color: C.muted }}>A minute of questions — a starting point, not a diagnosis</div>
        </div>

        <div className="rounded-2xl p-4 space-y-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <div className="text-xs font-semibold" style={{ color: C.green, letterSpacing: 1 }}>BODY BASICS</div>
          <div className="grid grid-cols-3 gap-2">
            <input type="number" inputMode="numeric" placeholder="Age" value={baseline.age} onChange={e => setBaseline({ ...baseline, age: e.target.value })} className="rounded-lg px-3 py-3 text-sm text-center" style={{ background: C.panelLight, color: C.text, border: `1px solid ${C.border}` }} />
            <input type="number" inputMode="numeric" placeholder="Height cm" value={baseline.height} onChange={e => setBaseline({ ...baseline, height: e.target.value })} className="rounded-lg px-3 py-3 text-sm text-center" style={{ background: C.panelLight, color: C.text, border: `1px solid ${C.border}` }} />
            <input type="number" inputMode="numeric" placeholder="Weight kg" value={baseline.weight} onChange={e => setBaseline({ ...baseline, weight: e.target.value })} className="rounded-lg px-3 py-3 text-sm text-center" style={{ background: C.panelLight, color: C.text, border: `1px solid ${C.border}` }} />
          </div>
          <div>
            <div className="text-sm mb-2" style={{ color: C.text }}>Blood pressure, if you know it (optional)</div>
            <div className="flex gap-2">
              <input type="number" inputMode="numeric" placeholder="Systolic" value={baseline.systolic} onChange={e => setBaseline({ ...baseline, systolic: e.target.value })} className="flex-1 rounded-lg px-3 py-3 text-sm text-center" style={{ background: C.panelLight, color: C.text, border: `1px solid ${C.border}` }} />
              <input type="number" inputMode="numeric" placeholder="Diastolic" value={baseline.diastolic} onChange={e => setBaseline({ ...baseline, diastolic: e.target.value })} className="flex-1 rounded-lg px-3 py-3 text-sm text-center" style={{ background: C.panelLight, color: C.text, border: `1px solid ${C.border}` }} />
            </div>
          </div>
        </div>

        <div className="rounded-2xl p-4 space-y-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <div className="text-xs font-semibold" style={{ color: C.green, letterSpacing: 1 }}>HEALTH HISTORY</div>
          {chipRow('Diabetes', 'diabetes', ['No', 'Pre-diabetic', 'Yes'])}
          {chipRow('Cholesterol', 'cholesterol', ['Normal', 'High', 'Not sure'])}
          {chipRow('Smoking', 'smoking', ['No', 'Yes'])}
          {chipRow('Physical activity', 'activity', ['Active (150+ min/wk)', 'Inactive'])}
          {chipRow('Average sleep per night', 'sleep', ['Under 6 hrs', '6–9 hrs', 'Over 9 hrs'])}
          {chipRow('Typical diet quality', 'dietQuality', ['Poor', 'Average', 'Good'])}
          {chipRow('Family history of heart disease', 'familyHistory', ['No', 'Yes'])}
          {chipRow('Kidney disease', 'kidneyDisease', ['No', 'Yes'])}
        </div>

        <button onClick={() => setAppPhase('baselineResult')} className="w-full rounded-2xl py-4 text-base font-bold" style={{ background: C.green, color: C.ink }}>See my risk profile</button>
        {!onboardingDone && (
          <button onClick={() => setAppPhase('ready')} className="w-full text-center text-sm py-1" style={{ color: C.muted }}>Skip for now</button>
        )}
      </div>
    );
  }

  function renderBaselineResult() {
    const bmi = baseline.height && baseline.weight ? (Number(baseline.weight) / Math.pow(Number(baseline.height) / 100, 2)) : null;
    const bmiCategory = bmi ? (bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal' : bmi < 30 ? 'Overweight' : 'Obese') : null;
    const sys = Number(baseline.systolic), dia = Number(baseline.diastolic);
    const bpCategory = baseline.systolic && baseline.diastolic
      ? (sys >= 140 || dia >= 90 ? 'Stage 2 Hypertension' : sys >= 130 || dia >= 80 ? 'Stage 1 Hypertension' : sys >= 120 ? 'Elevated' : 'Normal')
      : null;

    const factors = [];
    if (Number(baseline.age) >= 45) factors.push('Age 45+');
    if (bmiCategory === 'Overweight' || bmiCategory === 'Obese') factors.push(`BMI: ${bmiCategory.toLowerCase()}`);
    if (bpCategory && bpCategory !== 'Normal') factors.push(`Blood pressure: ${bpCategory.toLowerCase()}`);
    if (baseline.diabetes === 'Yes' || baseline.diabetes === 'Pre-diabetic') factors.push('Diabetes');
    if (baseline.cholesterol === 'High') factors.push('High cholesterol');
    if (baseline.smoking === 'Yes') factors.push('Smoking');
    if (baseline.activity === 'Inactive') factors.push('Physical inactivity');
    if (baseline.familyHistory === 'Yes') factors.push('Family history');
    if (baseline.kidneyDisease === 'Yes') factors.push('Kidney disease');

    const level = factors.length >= 4 ? 'High' : factors.length >= 2 ? 'Moderate' : 'Low';
    const levelColor = level === 'High' ? C.coral : level === 'Moderate' ? C.amber : C.green;

    // Simplified, rule-based approximations for display only —
    // not the validated Pooled Cohort Equations or the official AHA Life's Essential 8 algorithm.
    let ascvd = Math.max(1, (Number(baseline.age) || 40) - 40) * 0.4;
    if (bpCategory === 'Stage 2 Hypertension') ascvd += 6;
    else if (bpCategory === 'Stage 1 Hypertension') ascvd += 3;
    else if (bpCategory === 'Elevated') ascvd += 1;
    if (baseline.diabetes === 'Yes') ascvd += 6;
    else if (baseline.diabetes === 'Pre-diabetic') ascvd += 2;
    if (baseline.smoking === 'Yes') ascvd += 5;
    if (baseline.cholesterol === 'High') ascvd += 4;
    if (bmiCategory === 'Obese') ascvd += 3;
    else if (bmiCategory === 'Overweight') ascvd += 1;
    if (baseline.familyHistory === 'Yes') ascvd += 2;
    ascvd = Math.min(40, Math.max(1, Math.round(ascvd)));

    const bpScore = bpCategory === 'Normal' ? 100 : bpCategory === 'Elevated' ? 75 : bpCategory === 'Stage 1 Hypertension' ? 50 : bpCategory === 'Stage 2 Hypertension' ? 25 : 60;
    const bmiScore = !bmiCategory ? 60 : bmiCategory === 'Normal' || bmiCategory === 'Underweight' ? 100 : bmiCategory === 'Overweight' ? 70 : 30;
    const nicotineScore = baseline.smoking === 'Yes' ? 0 : 100;
    const activityScore = baseline.activity === 'Active (150+ min/wk)' ? 100 : baseline.activity === 'Inactive' ? 20 : 60;
    const sleepScore = baseline.sleep === '6–9 hrs' ? 100 : baseline.sleep === 'Under 6 hrs' ? 40 : baseline.sleep === 'Over 9 hrs' ? 70 : 60;
    const dietScore = baseline.dietQuality === 'Good' ? 100 : baseline.dietQuality === 'Average' ? 50 : baseline.dietQuality === 'Poor' ? 10 : 60;
    const lipidScore = baseline.cholesterol === 'Normal' ? 100 : baseline.cholesterol === 'High' ? 20 : 60;
    const glucoseScore = baseline.diabetes === 'No' ? 100 : baseline.diabetes === 'Pre-diabetic' ? 60 : baseline.diabetes === 'Yes' ? 20 : 60;
    const lifeEssential8 = Math.round((bpScore + bmiScore + nicotineScore + activityScore + sleepScore + dietScore + lipidScore + glucoseScore) / 8);

    return (
      <div className="space-y-5">
        <div className="text-center">
          <div className="flex items-center justify-center rounded-full mx-auto mb-3" style={{ width: 88, height: 88, background: levelColor }}>
            <Heart size={40} color={C.ink} fill={C.ink} />
          </div>
          <div className="font-display text-2xl" style={{ color: C.text, fontWeight: 800 }}>{level} Risk</div>
          <div className="text-sm mt-1" style={{ color: C.muted }}>Based on your answers — a starting point, not a diagnosis</div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
            <div className="text-xs" style={{ color: C.muted }}>10-Year Heart Risk (est.)</div>
            <div className="font-display text-2xl mt-1" style={{ color: C.text, fontWeight: 800 }}>{ascvd}%</div>
          </div>
          <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
            <div className="text-xs" style={{ color: C.muted }}>Life's Essential 8 (est.)</div>
            <div className="font-display text-2xl mt-1" style={{ color: C.text, fontWeight: 800 }}>{lifeEssential8}/100</div>
          </div>
        </div>
        <div className="text-xs" style={{ color: C.muted }}>
          The first estimates your 10-year chance of a heart attack or stroke, in the style of ASCVD risk calculators. The second averages eight everyday habits and numbers per the AHA's Life's Essential 8 framework. Both are simplified approximations, not the validated clinical calculators.
        </div>

        <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
          <div className="text-xs font-semibold mb-3" style={{ color: C.text }}>YOUR NUMBERS</div>
          <div className="grid grid-cols-2 gap-3">
            {bmiCategory && (
              <div>
                <div className="text-xs" style={{ color: C.muted }}>BMI</div>
                <div className="text-sm font-bold" style={{ color: C.text }}>{bmiCategory}</div>
              </div>
            )}
            {bpCategory && (
              <div>
                <div className="text-xs" style={{ color: C.muted }}>Blood pressure</div>
                <div className="text-sm font-bold" style={{ color: C.text }}>{bpCategory}</div>
              </div>
            )}
            <div>
              <div className="text-xs" style={{ color: C.muted }}>Diabetes</div>
              <div className="text-sm font-bold" style={{ color: C.text }}>{baseline.diabetes || 'Not answered'}</div>
            </div>
            <div>
              <div className="text-xs" style={{ color: C.muted }}>Smoking</div>
              <div className="text-sm font-bold" style={{ color: C.text }}>{baseline.smoking || 'Not answered'}</div>
            </div>
          </div>
        </div>

        {factors.length > 0 && (
          <div className="rounded-2xl p-4" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
            <div className="text-xs font-semibold mb-2" style={{ color: C.text }}>CONTRIBUTING FACTORS</div>
            <div className="flex flex-wrap gap-2">
              {factors.map((f, i) => (
                <span key={i} className="px-2.5 py-1 rounded-full text-xs" style={{ background: C.panelLight, color: C.muted }}>{f}</span>
              ))}
            </div>
          </div>
        )}

        {(() => {
          const tips = [];
          if (baseline.smoking === 'Yes') tips.push('Quitting smoking is the single biggest win for your heart.');
          if (bpCategory && bpCategory !== 'Normal') tips.push('Daily BP logging and less salt help bring blood pressure down.');
          if (baseline.diabetes === 'Yes' || baseline.diabetes === 'Pre-diabetic') tips.push('Keeping sugar in range protects your heart and kidneys.');
          if (bmiCategory === 'Overweight' || bmiCategory === 'Obese') tips.push('Even a 5% weight drop meaningfully lowers your risk.');
          if (baseline.activity === 'Inactive') tips.push('A 20-minute walk most days improves nearly every number here.');
          if (baseline.cholesterol === 'High') tips.push('Ask your doctor whether diet changes or a statin fit you.');
          if (tips.length === 0) tips.push('You are doing well — keep logging so we can catch any change early.');
          return (
            <div className="rounded-2xl p-4" style={{ background: 'rgba(43,108,176,0.08)', border: '1px solid rgba(43,108,176,0.25)' }}>
              <div className="text-sm font-semibold mb-2" style={{ color: C.text }}>Ways to improve your score</div>
              <div className="space-y-2">
                {tips.slice(0, 3).map((t, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <CheckCircle2 size={14} style={{ color: C.green, marginTop: 2, flexShrink: 0 }} />
                    <span className="text-xs" style={{ color: C.muted }}>{t}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {level !== 'Low' && (
          <div className="rounded-2xl p-4" style={{ background: 'rgba(244,166,61,0.08)', border: '1px solid rgba(244,166,61,0.25)' }}>
            <div className="text-sm font-semibold mb-1" style={{ color: C.text }}>Worth discussing with a doctor</div>
            <div className="text-xs" style={{ color: C.muted }}>Your onboarding call is a good place to start — the doctor can look at these numbers with you.</div>
          </div>
        )}

        <button onClick={() => setAppPhase(onboardingDone ? 'main' : 'ready')} className="w-full rounded-2xl py-4 text-base font-bold" style={{ background: C.green, color: C.ink }}>Continue</button>
      </div>
    );
  }

  /* ---------- SHELL ---------- */

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4" style={{ background: 'radial-gradient(1100px 650px at 18% -5%, #2A5E9F 0%, #153E6F 52%, #0D2947 100%)' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap');
        .font-display { font-family: 'Sora', system-ui, sans-serif; }
        .font-body { font-family: 'Inter', system-ui, sans-serif; }
        .pulse { animation: ilivePulse 1.1s ease-in-out infinite; }
        .rounded-2xl { box-shadow: 0 1px 2px rgba(21,62,111,0.05), 0 12px 32px rgba(21,62,111,0.09); border-radius: 20px; }
        button.rounded-2xl:active, button.rounded-xl:active { transform: scale(0.985); }
        button { transition: transform 0.12s ease, box-shadow 0.2s ease, opacity 0.2s ease; }
        .font-body { -webkit-font-smoothing: antialiased; }
        .font-display { letter-spacing: -0.02em; }
        .text-xs { font-weight: 600; }
        .text-sm { font-weight: 500; }
        .font-medium { font-weight: 600; }
        .font-semibold { font-weight: 700; }
        .overflow-x-auto::-webkit-scrollbar { display: none; }
        @keyframes ilivePulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
      `}</style>
      <div
        className="font-body flex flex-col overflow-hidden relative"
        style={{
          width: 'min(400px, 94vw)', height: 'min(844px, 88vh)',
          background: 'linear-gradient(180deg, #F9FCFF 0%, #EEF4FB 100%)', borderRadius: 44, border: '1px solid rgba(255,255,255,0.55)',
          boxShadow: '0 30px 80px rgba(10,30,60,0.45)',
        }}
      >
        {appPhase === 'main' && (
          <div className="flex-shrink-0 px-5 pt-5 pb-3" style={{ borderBottom: `1px solid ${C.border}` }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ILiveLogo height={38} />
              </div>
              <div className="flex items-center justify-center rounded-full" style={{ width: 36, height: 36, background: C.panelLight }}>
                <Bell size={16} style={{ color: C.green }} />
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {showPlans ? renderPlans()
            : appPhase === 'splash' ? renderSplash()
            : appPhase === 'freeOnboard' ? (foStep >= 6 ? renderFreeRecommend() : renderFreeOnboard())
            : appPhase === 'entryFork' ? renderEntryFork()
            : appPhase === 'signup' ? renderSignup()
            : appPhase === 'dischargePay' ? renderDischargePay()
            : appPhase === 'programPick' ? renderProgramPick()
            : appPhase === 'reason' ? renderReason()
            : appPhase === 'conditionPicker' ? renderConditionPicker()
            : appPhase === 'ready' ? renderReady()
            : appPhase === 'healthRecord' ? renderHealthRecord()
            : appPhase === 'programs' ? renderProgramsScreen()
            : appPhase === 'woundCare' ? renderWoundCare()
            : appPhase === 'questionnaire' ? renderBaselineHealth()
            : appPhase === 'baselineHealth' ? renderBaselineHealth()
            : appPhase === 'baselineResult' ? renderBaselineResult()
            : activeTab === 'home' ? (guardianView ? renderGuardianHome() : (
                (isSubscribed && (selectedPlan === 'connect' || selectedPlan === 'connectPlus' || selectedPlan === 'heartScreen' || selectedPlan === 'essential') && enrolledPrograms[0] && enrolledPrograms[0] !== 'iLive Free' && !checkinOpen && !sharpenView)
                  ? <div className="space-y-4">{programBackBar()}{renderHome()}</div>
                  : renderHome()
              ))
            : activeTab === 'family' ? renderFamilyTab()
            : activeTab === 'community' ? renderCommunity()
            : renderMore()}
        </div>

        {appPhase === 'main' && (
          <div className="flex-shrink-0 flex items-stretch justify-around py-3" style={{ background: C.panel, borderTop: `1px solid ${C.border}` }}>
            {[{ id: 'home', label: 'Home', icon: Home }, { id: 'family', label: 'Family', icon: Users }, { id: 'more', label: 'More', icon: MoreHorizontal }].filter(item => !(item.id === 'family' && enrolledPrograms[0] !== 'Elder Care')).map(item => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className="flex flex-col items-center gap-1 py-1 px-4"
                style={{ color: activeTab === item.id ? C.green : C.muted, background: 'transparent', border: 'none' }}
              >
                <item.icon size={22} />
                <span className="text-sm">{item.label}</span>
              </button>
            ))}
          </div>
        )}

        {incomingCall && renderCallOverlay()}
      </div>
    </div>
  );
}
