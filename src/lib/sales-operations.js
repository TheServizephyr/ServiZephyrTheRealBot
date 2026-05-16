export const SALES_PARTNERS_COLLECTION = 'sales_partners';
export const SALES_PITCHES_COLLECTION = 'sales_pitches';
export const SALES_EMPLOYEE_ID_PREFIX = 'SZSP';

export const SALES_PARTNER_STATUSES = ['training', 'active', 'inactive'];
export const SALES_TRAINING_STATUSES = ['not_started', 'in_progress', 'certified'];
export const PITCH_STATUSES = ['interested', 'follow_up', 'demo_scheduled', 'rejected', 'onboarded', 'not_available'];
export const ONBOARDING_STATUSES = ['in_progress', 'verified'];
export const PAYMENT_STATUSES = ['pending', 'paid'];
export const SALES_COMMISSION_RATE = 0.3;

const trimString = (value, fallback = '') => {
  if (typeof value !== 'string') return fallback;
  return value.trim();
};

const normalizeArray = (value) => {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  return source.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 30);
};

const normalizeOption = (value, options, fallback) => {
  const normalized = String(value || '').trim().toLowerCase();
  return options.includes(normalized) ? normalized : fallback;
};

const normalizeMoney = (value) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.round(amount));
};

export const normalizePhone = (value) => String(value || '').replace(/\D/g, '').slice(0, 10);

export const deriveOnboardingStatus = (pitchStatus) => (
  pitchStatus === 'onboarded' ? 'verified' : 'in_progress'
);

export const calculateMonthlyCommission = (pitch = {}) => {
  const pitchStatus = normalizeOption(pitch.pitchStatus, PITCH_STATUSES, 'follow_up');
  const paymentStatus = normalizeOption(pitch.paymentStatus, PAYMENT_STATUSES, 'pending');
  const monthlySubscriptionAmount = normalizeMoney(pitch.monthlySubscriptionAmount);
  if (pitchStatus !== 'onboarded' || paymentStatus !== 'paid') return 0;
  return Math.round(monthlySubscriptionAmount * SALES_COMMISSION_RATE);
};

export const normalizeEmployeeId = (value) => (
  String(value || '').trim().toUpperCase().replace(/\s+/g, '')
);

export const toIso = (value) => {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

export const sanitizePartnerPayload = (payload = {}) => ({
  userId: trimString(payload.userId).slice(0, 160),
  name: trimString(payload.name).slice(0, 140),
  phone: normalizePhone(payload.phone),
  email: trimString(payload.email).toLowerCase().slice(0, 160),
  assignedArea: trimString(payload.assignedArea).slice(0, 240),
  assignedZones: normalizeArray(payload.assignedZones),
  status: normalizeOption(payload.status, SALES_PARTNER_STATUSES, 'training'),
  trainingStatus: normalizeOption(payload.trainingStatus, SALES_TRAINING_STATUSES, 'not_started'),
  source: trimString(payload.source, 'manual').slice(0, 80),
  candidateApplicationId: trimString(payload.candidateApplicationId).slice(0, 160),
  candidateJobId: trimString(payload.candidateJobId).slice(0, 160),
  notes: trimString(payload.notes).slice(0, 2000),
});

export const validatePartnerPayload = (payload = {}) => {
  const errors = [];
  if (!payload.name) errors.push('Sales partner name is required.');
  if (!/^\d{10}$/.test(payload.phone || '')) errors.push('Valid 10 digit phone number is required.');
  if (!payload.assignedArea) errors.push('Assigned area is required.');
  return errors;
};

export const serializePartner = (doc) => {
  const data = doc.data ? doc.data() : doc;
  return {
    id: doc.id || data.id,
    userId: data.userId || '',
    employeeId: data.employeeId || '',
    name: data.name || 'Unnamed Partner',
    phone: data.phone || '',
    email: data.email || '',
    assignedArea: data.assignedArea || '',
    assignedZones: Array.isArray(data.assignedZones) ? data.assignedZones : [],
    status: normalizeOption(data.status, SALES_PARTNER_STATUSES, 'training'),
    trainingStatus: normalizeOption(data.trainingStatus, SALES_TRAINING_STATUSES, 'not_started'),
    source: data.source || 'manual',
    candidateApplicationId: data.candidateApplicationId || '',
    candidateJobId: data.candidateJobId || '',
    notes: data.notes || '',
    totalPitches: Number(data.totalPitches || 0),
    onboardedCount: Number(data.onboardedCount || 0),
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
};

export const sanitizePitchPayload = (payload = {}) => {
  const pitchDateText = trimString(payload.pitchDate);
  const parsedPitchDate = pitchDateText ? new Date(pitchDateText) : null;
  const pitchStatus = normalizeOption(payload.pitchStatus, PITCH_STATUSES, 'follow_up');
  const paymentStatus = normalizeOption(payload.paymentStatus, PAYMENT_STATUSES, 'pending');
  const monthlySubscriptionAmount = normalizeMoney(payload.monthlySubscriptionAmount);
  return {
    restaurantName: trimString(payload.restaurantName).slice(0, 180),
    ownerName: trimString(payload.ownerName).slice(0, 140),
    ownerPhone: normalizePhone(payload.ownerPhone),
    location: trimString(payload.location).slice(0, 300),
    pitchDate: parsedPitchDate && !Number.isNaN(parsedPitchDate.getTime()) ? parsedPitchDate : new Date(),
    pitchStatus,
    onboardingStatus: deriveOnboardingStatus(pitchStatus),
    monthlySubscriptionAmount: pitchStatus === 'onboarded' ? monthlySubscriptionAmount : 0,
    paymentStatus: pitchStatus === 'onboarded' ? paymentStatus : 'pending',
    notes: trimString(payload.notes).slice(0, 2000),
    followUpAt: trimString(payload.followUpAt).slice(0, 40),
  };
};

export const validatePitchPayload = (payload = {}) => {
  const errors = [];
  if (!payload.restaurantName) errors.push('Restaurant name is required.');
  if (!/^\d{10}$/.test(payload.ownerPhone || '')) errors.push('Owner phone must be exactly 10 digits.');
  if (!payload.location) errors.push('Location is required.');
  if (payload.pitchStatus === 'onboarded' && Number(payload.monthlySubscriptionAmount || 0) <= 0) {
    errors.push('Monthly subscription amount is required after onboarding.');
  }
  return errors;
};

export const serializePitch = (doc) => {
  const data = doc.data ? doc.data() : doc;
  const pitchStatus = normalizeOption(data.pitchStatus, PITCH_STATUSES, 'follow_up');
  const paymentStatus = normalizeOption(data.paymentStatus, PAYMENT_STATUSES, 'pending');
  const monthlySubscriptionAmount = pitchStatus === 'onboarded' ? normalizeMoney(data.monthlySubscriptionAmount) : 0;
  const monthlyCommissionAmount = calculateMonthlyCommission({
    pitchStatus,
    paymentStatus,
    monthlySubscriptionAmount,
  });
  return {
    id: doc.id || data.id,
    partnerId: data.partnerId || '',
    partnerName: data.partnerName || '',
    restaurantName: data.restaurantName || 'Unnamed Restaurant',
    ownerName: data.ownerName || '',
    ownerPhone: data.ownerPhone || '',
    location: data.location || '',
    pitchDate: toIso(data.pitchDate),
    pitchStatus,
    onboardingStatus: deriveOnboardingStatus(pitchStatus),
    monthlySubscriptionAmount,
    paymentStatus: pitchStatus === 'onboarded' ? paymentStatus : 'pending',
    monthlyCommissionAmount,
    commissionEligible: monthlyCommissionAmount > 0,
    notes: data.notes || '',
    followUpAt: data.followUpAt || '',
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
};
