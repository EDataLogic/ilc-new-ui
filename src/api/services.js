/**
 * iLive Connect — API service layer
 * ---------------------------------
 * Every backend touchpoint in the app is a function here.
 * While the backend is being built, USE_MOCK = true returns realistic data
 * so the UI keeps working exactly like the approved prototype.
 * Flip USE_MOCK = false endpoint-by-endpoint as the backend lands.
 *
 * Backend team: implement the contract in ../../API-CONTRACT.md — request/response
 * shapes here and there are identical.
 */

const BASE_URL = import.meta.env.VITE_API_URL || 'https://api.iliveconnect.in/v1';
export const USE_MOCK = true;

let authToken = null;
export const setToken = (t) => { authToken = t; };

async function http(method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
  return res.json();
}

const mock = (data, ms = 400) => new Promise(r => setTimeout(() => r(data), ms));

/* ============ 1. AUTH ============ */
export const requestOtp = (phone) =>
  USE_MOCK ? mock({ requestId: 'otp_123' }) : http('POST', '/auth/otp', { phone });

export const verifyOtp = (requestId, code, profile) =>
  USE_MOCK ? mock({ token: 'jwt_mock', userId: 'u_001', isNew: true })
           : http('POST', '/auth/verify', { requestId, code, ...profile });

/* ============ 2. PAYMENTS (Razorpay) ============ */
// plan: 'essential' | 'connect' | 'connectPlus'; context: 'discharge' | 'organic'
export const createPlanOrder = (plan, context) =>
  USE_MOCK ? mock({ orderId: 'order_rzp_001', amount: plan === 'connectPlus' ? 1250000 : plan === 'connect' ? 880000 : 250000, currency: 'INR' })
           : http('POST', '/payments/plan-order', { plan, context });

export const createWoundPackageOrder = (fluorescenceAdded) =>
  USE_MOCK ? mock({ orderId: 'order_rzp_002', amount: fluorescenceAdded ? 1799800 : 800000 })
           : http('POST', '/payments/wound-package', { fluorescenceAdded });

export const createDeviceOrder = (deviceId) =>          // 'cgm' | 'bp' | 'spiro' | 'scale' | 'patch' | 'band' | 'combo'
  USE_MOCK ? mock({ orderId: 'order_rzp_003' }) : http('POST', '/payments/device-order', { deviceId });

export const confirmPayment = (orderId, razorpayPaymentId, razorpaySignature) =>
  USE_MOCK ? mock({ status: 'paid' }) : http('POST', '/payments/confirm', { orderId, razorpayPaymentId, razorpaySignature });

/* ============ 3. VITALS ============ */
// One endpoint for all vitals. type: 'bp' | 'sugar' | 'weight' | 'temp' | 'hba1c' | 'breathlessness'
// method: 'manual' | 'photo' | 'voice' | 'device'
export const submitVital = (type, payload, method) =>
  USE_MOCK ? mock({ readingId: 'r_' + Date.now(), status: 'received' })
           : http('POST', '/vitals', { type, payload, method, takenAt: new Date().toISOString() });

// Photo-based logging: upload image → OCR/vision extracts the reading
export const submitVitalPhoto = async (type, base64Image) =>
  USE_MOCK ? mock({ readingId: 'r_' + Date.now(), extracted: type === 'bp' ? { systolic: 128, diastolic: 82 } : { value: 128 }, confidence: 0.97 })
           : http('POST', '/vitals/photo', { type, image: base64Image });

export const getVitalsHistory = (type, days = 7) =>
  USE_MOCK ? mock({ readings: [{ takenAt: '2026-07-10T08:00:00Z', payload: { systolic: 126, diastolic: 78 } }] })
           : http('GET', `/vitals?type=${type}&days=${days}`);

/* ============ 4. CARE TRACKER (reading review pipeline) ============ */
// After submitVital, the Command Center reviews. The app listens for status pushes.
// Statuses: received → under_review → all_clear | callback_scheduled | emergency_call
export const getReadingStatus = (readingId) =>
  USE_MOCK ? mock({ status: 'all_clear', reviewedBy: 'Dr. Meera', note: 'Looks good — keep the same medicine timing.' })
           : http('GET', `/vitals/${readingId}/status`);

/* ============ 5. CALLS & CARE TEAM ============ */
export const getCareTeam = (programId) =>
  USE_MOCK ? mock({ lead: { name: 'Dr. Anil Sharma', role: 'Diabetologist' }, members: [
      { id: 'cc1', name: 'Priya Singh', role: 'Care Coordinator', callable: true, firstCall: true },
      { id: 'nu1', name: 'Neha Kapoor', role: 'Nutritionist', callable: true },
      { id: 'ph1', name: 'Rohit Verma', role: 'Physiotherapist', callable: true }] })
           : http('GET', `/care-team?program=${programId}`);

export const requestCall = (memberId, reason) =>        // Exotel/Twilio click-to-call
  USE_MOCK ? mock({ callId: 'call_001', status: 'ringing' }) : http('POST', '/calls', { memberId, reason });

export const triggerEmergency = (kind) =>               // 'sos' | 'befast' | 'fever' | 'breathless'
  USE_MOCK ? mock({ callId: 'call_em_001', line: '24x7' }) : http('POST', '/calls/emergency', { kind });

/* ============ 6. WOUNDCONNECT ============ */
export const createWoundCase = (photos, answers) =>     // photos: base64[]
  USE_MOCK ? mock({ caseId: 'w_001', aiAnalysis: { areaCm2: 3.8, depth: 'partial-thickness', infectionRisk: 'moderate' } })
           : http('POST', '/wound/cases', { photos, answers });

export const getBoardReview = (caseId) =>               // poll or subscribe; specialists complete async
  USE_MOCK ? mock({ done: 8, total: 8, plan: { steps: ['Home dressings 2x/week', 'Sugar on target', 'Weekly photo'] } })
           : http('GET', `/wound/cases/${caseId}/board`);

export const submitWoundPhoto = (caseId, base64Image) =>
  USE_MOCK ? mock({ status: 'received', reviewBy: 'today' }) : http('POST', `/wound/cases/${caseId}/photos`, { image: base64Image });

/* ============ 7. FAMILY & PERMISSIONS ============ */
export const sendFamilyInvite = (phone, relation) =>    // WhatsApp Business API template message
  USE_MOCK ? mock({ inviteId: 'inv_001', channel: 'whatsapp' }) : http('POST', '/family/invites', { phone, relation });

export const becomePrimaryCaregiver = (memberProfile) =>
  USE_MOCK ? mock({ memberId: 'fam_004', role: 'primary_caregiver' }) : http('POST', '/family/caregiver', memberProfile);

export const getFamily = () =>
  USE_MOCK ? mock({ members: [{ id: 'father', name: 'Ramesh Chandola', rel: 'Father', age: 74, status: 'attention', statusText: 'Needs BP update' }] })
           : http('GET', '/family');

export const getFamilyMember = (memberId) =>            // requires that member's granted permission
  USE_MOCK ? mock({ /* shape identical to FAMILY entries in ILiveConnect.jsx */ })
           : http('GET', `/family/${memberId}`);

export const nudgeMember = (memberId, kind) =>          // 'bp_reminder' etc.
  USE_MOCK ? mock({ sent: true }) : http('POST', `/family/${memberId}/nudge`, { kind });

/* ============ 8. HEALTH PASSPORT ============ */
export const getPassport = (memberId = 'me') =>
  USE_MOCK ? mock({ documents: [{ type: 'discharge_summary', title: 'Discharge Summary', url: 'https://…', addedBy: 'hospital', at: '2026-06-02' }], timeline: [] })
           : http('GET', `/passport/${memberId}`);

export const sharePassport = (memberId = 'me', ttlHours = 72) => // returns secure share URL — QR encodes this
  USE_MOCK ? mock({ shareUrl: 'https://ilive.cc/p/abc123', expiresAt: '…' })
           : http('POST', `/passport/${memberId}/share`, { ttlHours });

/* ============ 9. ORDERS (labs & pharmacy) ============ */
export const orderLabs = (tests, address) =>
  USE_MOCK ? mock({ orderId: 'lab_001', homeCollection: true, slot: 'tomorrow 7-9 AM' }) : http('POST', '/orders/labs', { tests, address });

export const orderMedicines = (prescriptionId, address) =>
  USE_MOCK ? mock({ orderId: 'med_001', eta: 'today 6 PM' }) : http('POST', '/orders/medicines', { prescriptionId, address });

/* ============ 10. PROGRAMS, TASKS & CHECK-INS ============ */
export const getMyProgram = () =>
  USE_MOCK ? mock({ programId: 'diabetes', dayN: 8, plan: 'connect', planEndsAt: '…' }) : http('GET', '/me/program');

export const completeTask = (taskId) =>
  USE_MOCK ? mock({ done: true, streak: 12 }) : http('POST', `/tasks/${taskId}/complete`, {});

export const submitSymptomCheck = (programId, answers) => // onco ePRO, neuro mood/swallow, COPD breathlessness…
  USE_MOCK ? mock({ triage: 'nurse_callback', at: '4:00 PM' }) : http('POST', '/symptom-checks', { programId, answers });

/* ============ 11. HEART HEALTH CHECK (patch product) ============ */
export const getPatchLive = () =>
  USE_MOCK ? mock({ hr: 72, beats: 38412, alerts: 0, restingHr: 52 }) : http('GET', '/patch/live');

export const submitExerciseTest = (stages) =>           // [{stage, peakHr, completedAt}]
  USE_MOCK ? mock({ incorporated: true, reportEta: 'tomorrow' }) : http('POST', '/patch/exercise-test', { stages });

/* ============ 12. DEVICE TELEMETRY (webhooks land server-side) ============ */
// CGM / BP cuff / wristband / chest patch push readings to the backend directly.
// The app only reads processed values via getVitalsHistory + push notifications.
