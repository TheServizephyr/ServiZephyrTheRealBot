import { FieldValue } from '@/lib/firebase-admin';

export const BUSINESS_RUNTIME_COLLECTION = 'business_runtime';
export const BUSINESS_RUNTIME_DOC_ID = 'current';

export function getBusinessRuntimeRef(businessRef) {
  return businessRef.collection(BUSINESS_RUNTIME_COLLECTION).doc(BUSINESS_RUNTIME_DOC_ID);
}

export const DEFAULT_BUSINESS_RUNTIME = Object.freeze({
  menuVersion: 0,
  statsVersion: 0,
  activeOrderVersion: 0,
  runtimeVersion: 0,
  snapshotQueued: false,
  statsReconcileQueued: false,
});

export async function getBusinessRuntime(businessRef) {
  const runtimeRef = getBusinessRuntimeRef(businessRef);
  const snap = await runtimeRef.get();
  if (!snap.exists) {
    return { ...DEFAULT_BUSINESS_RUNTIME };
  }
  return {
    ...DEFAULT_BUSINESS_RUNTIME,
    ...(snap.data() || {}),
  };
}

export async function setBusinessRuntimeFlags(businessRef, updates = {}) {
  const runtimeRef = getBusinessRuntimeRef(businessRef);
  await runtimeRef.set({
    ...updates,
    updatedAt: new Date(),
  }, { merge: true });
}

export async function bumpBusinessRuntimeVersions(businessRef, {
  menuVersion = false,
  statsVersion = false,
  activeOrderVersion = false,
  extra = {},
} = {}) {
  const runtimeRef = getBusinessRuntimeRef(businessRef);
  const updates = {
    runtimeVersion: FieldValue.increment(1),
    updatedAt: new Date(),
    ...extra,
  };

  if (menuVersion) updates.menuVersion = FieldValue.increment(1);
  if (statsVersion) updates.statsVersion = FieldValue.increment(1);
  if (activeOrderVersion) updates.activeOrderVersion = FieldValue.increment(1);

  await runtimeRef.set(updates, { merge: true });
}

export function resolveScopedFeatureFlagValue(flagName, {
  businessData = {},
  runtimeData = {},
  envDefault = false,
} = {}) {
  const safeFlag = String(flagName || '').trim();
  if (!safeFlag) return envDefault === true;

  const candidates = [
    runtimeData?.featureFlags?.[safeFlag],
    businessData?.featureFlags?.[safeFlag],
    runtimeData?.[safeFlag],
    businessData?.[safeFlag],
  ];

  for (const candidate of candidates) {
    if (candidate === true) return true;
    if (candidate === false) return false;
  }

  return envDefault === true;
}
