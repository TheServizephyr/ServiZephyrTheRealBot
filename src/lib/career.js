export const CAREER_JOBS_COLLECTION = 'career_jobs';
export const RESUME_MAX_SIZE_BYTES = 5 * 1024 * 1024;

export const JOB_STATUS_OPTIONS = ['active', 'inactive'];

export const DEFAULT_JOB_CATEGORIES = [
  'Sales',
  'Software Development',
  'Operations',
  'Marketing',
  'Customer Support',
  'Design',
  'Finance',
  'Other',
];

const trimString = (value, fallback = '') => {
  if (typeof value !== 'string') return fallback;
  return value.trim();
};

export const normalizePhoneNumber = (value) => (
  String(value || '').replace(/\D/g, '').slice(0, 10)
);

const normalizeArray = (value) => {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  return source
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 30);
};

export const toIso = (value) => {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

export const normalizeJobStatus = (value) => {
  const status = String(value || '').trim().toLowerCase();
  return JOB_STATUS_OPTIONS.includes(status) ? status : 'inactive';
};

export const isJobExpired = (job = {}, now = new Date()) => {
  const expiresAt = toIso(job.expiresAt);
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() < now.getTime();
};

export const isJobOpen = (job = {}, now = new Date()) => (
  normalizeJobStatus(job.status) === 'active' && !isJobExpired(job, now)
);

export const sanitizeJobPayload = (payload = {}) => {
  const category = trimString(payload.category, 'Other') || 'Other';
  const title = trimString(payload.title);
  const description = trimString(payload.description);
  const status = normalizeJobStatus(payload.status || 'active');
  const expiresAt = trimString(payload.expiresAt);
  const parsedExpiry = expiresAt ? new Date(expiresAt) : null;

  return {
    title,
    category,
    department: trimString(payload.department, category),
    employmentType: trimString(payload.employmentType, 'Flexible'),
    workType: trimString(payload.workType, 'Field / Hybrid'),
    hiringTimeline: trimString(payload.hiringTimeline, 'Admin will decide'),
    location: trimString(payload.location, 'India'),
    educationTags: normalizeArray(payload.educationTags),
    skillTags: normalizeArray(payload.skillTags),
    status,
    expiresAt: parsedExpiry && !Number.isNaN(parsedExpiry.getTime()) ? parsedExpiry : null,
    summary: trimString(payload.summary).slice(0, 400),
    description,
    responsibilities: trimString(payload.responsibilities),
    requirements: trimString(payload.requirements),
    benefits: trimString(payload.benefits),
    compensation: trimString(payload.compensation),
    applicationInstructions: trimString(payload.applicationInstructions),
  };
};

export const validateJobPayload = (payload = {}) => {
  const errors = [];
  if (!payload.title) errors.push('Job title is required.');
  if (!payload.category) errors.push('Job category is required.');
  if (!payload.description) errors.push('Job description is required.');
  return errors;
};

export const serializeJob = (doc, { publicOnly = false, now = new Date() } = {}) => {
  const data = doc.data ? doc.data() : doc;
  const job = {
    id: doc.id || data.id,
    title: data.title || 'Untitled Job',
    category: data.category || 'Other',
    department: data.department || data.category || 'Other',
    employmentType: data.employmentType || 'Flexible',
    workType: data.workType || 'Field / Hybrid',
    hiringTimeline: data.hiringTimeline || 'Admin will decide',
    location: data.location || 'India',
    educationTags: Array.isArray(data.educationTags) ? data.educationTags : [],
    skillTags: Array.isArray(data.skillTags) ? data.skillTags : [],
    status: normalizeJobStatus(data.status),
    expiresAt: toIso(data.expiresAt),
    summary: data.summary || '',
    description: data.description || '',
    responsibilities: data.responsibilities || '',
    requirements: data.requirements || '',
    benefits: data.benefits || '',
    compensation: data.compensation || '',
    applicationInstructions: data.applicationInstructions || '',
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };

  return {
    ...job,
    isExpired: isJobExpired(job, now),
    isOpen: isJobOpen(job, now),
    ...(publicOnly ? {} : {
      applicationCount: Number(data.applicationCount || 0),
      createdBy: data.createdBy || '',
      updatedBy: data.updatedBy || '',
    }),
  };
};

export const sanitizeApplicationPayload = (payload = {}) => ({
  fullName: trimString(payload.fullName).slice(0, 120),
  phone: normalizePhoneNumber(payload.phone),
  email: trimString(payload.email).slice(0, 120),
  fullAddress: trimString(payload.fullAddress).slice(0, 500),
  dateOfBirth: trimString(payload.dateOfBirth).slice(0, 20),
  education: trimString(payload.education).slice(0, 160),
  experienceYears: trimString(payload.experienceYears).slice(0, 40),
  experienceCompany: trimString(payload.experienceCompany).slice(0, 160),
  experienceRole: trimString(payload.experienceRole).slice(0, 160),
  experienceDescription: trimString(payload.experienceDescription).slice(0, 2000),
  whyJoin: trimString(payload.whyJoin).slice(0, 2000),
});

export const validateApplicationPayload = (payload = {}) => {
  const errors = [];
  if (!payload.fullName) errors.push('Full name is required.');
  if (!/^\d{10}$/.test(payload.phone || '')) errors.push('Phone number must be exactly 10 digits.');
  if (!payload.fullAddress || payload.fullAddress.length < 10) errors.push('Full address with street/locality is required.');
  if (!payload.dateOfBirth) {
    errors.push('Date of birth is required.');
  } else {
    const dob = new Date(payload.dateOfBirth);
    if (Number.isNaN(dob.getTime()) || dob > new Date()) {
      errors.push('Please select a valid date of birth.');
    }
  }
  if (!payload.education) errors.push('Education is required.');
  return errors;
};

export const serializeApplication = (doc) => {
  const data = doc.data ? doc.data() : doc;
  return {
    id: doc.id || data.id,
    jobId: data.jobId || '',
    jobTitle: data.jobTitle || '',
    fullName: data.fullName || 'Unnamed Candidate',
    phone: data.phone || '',
    email: data.email || '',
    fullAddress: data.fullAddress || data.city || '',
    dateOfBirth: toIso(data.dateOfBirth) || data.dateOfBirth || '',
    education: data.education || '',
    experienceYears: data.experienceYears || '',
    experienceCompany: data.experienceCompany || '',
    experienceRole: data.experienceRole || '',
    experienceDescription: data.experienceDescription || data.experience || '',
    resumeUrl: data.resumeUrl || '',
    resumeFileName: data.resumeFileName || '',
    resumeStoragePath: data.resumeStoragePath || '',
    resumeSize: Number(data.resumeSize || 0),
    whyJoin: data.whyJoin || '',
    status: data.status || 'applied',
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  };
};
