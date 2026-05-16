import { NextResponse } from 'next/server';
import { FieldValue, getFirestore } from '@/lib/firebase-admin';
import { getStorage } from 'firebase-admin/storage';
import { nanoid } from 'nanoid';
import { firebaseConfig } from '@/firebase/config';
import {
  CAREER_JOBS_COLLECTION,
  RESUME_MAX_SIZE_BYTES,
  isJobOpen,
  sanitizeApplicationPayload,
  serializeJob,
  validateApplicationPayload,
} from '@/lib/career';

export const dynamic = 'force-dynamic';

async function findExistingApplication(jobRef, application) {
  const phoneSnapshot = await jobRef
    .collection('applications')
    .where('phone', '==', application.phone)
    .limit(1)
    .get();

  if (!phoneSnapshot.empty) {
    return { field: 'phone', applicationId: phoneSnapshot.docs[0].id };
  }

  const email = String(application.email || '').trim().toLowerCase();
  if (!email) return null;

  const emailSnapshot = await jobRef
    .collection('applications')
    .where('emailKey', '==', email)
    .limit(1)
    .get();

  if (!emailSnapshot.empty) {
    return { field: 'email', applicationId: emailSnapshot.docs[0].id };
  }

  return null;
}

export async function POST(req, { params }) {
  try {
    const jobId = String(params?.jobId || '').trim();
    if (!jobId) {
      return NextResponse.json({ message: 'Job ID is required.' }, { status: 400 });
    }

    const formData = await req.formData();
    const resumeFile = formData.get('resume');
    const application = sanitizeApplicationPayload({
      fullName: formData.get('fullName'),
      phone: formData.get('phone'),
      email: formData.get('email'),
      fullAddress: formData.get('fullAddress'),
      dateOfBirth: formData.get('dateOfBirth'),
      education: formData.get('education'),
      experienceYears: formData.get('experienceYears'),
      experienceCompany: formData.get('experienceCompany'),
      experienceRole: formData.get('experienceRole'),
      experienceDescription: formData.get('experienceDescription'),
      whyJoin: formData.get('whyJoin'),
    });
    const errors = validateApplicationPayload(application);
    if (!resumeFile || typeof resumeFile.arrayBuffer !== 'function') {
      errors.push('Resume PDF is required.');
    } else {
      const fileName = String(resumeFile.name || '').toLowerCase();
      const fileType = String(resumeFile.type || '').toLowerCase();
      if (fileType !== 'application/pdf' && !fileName.endsWith('.pdf')) {
        errors.push('Resume must be a PDF file.');
      }
      if (Number(resumeFile.size || 0) > RESUME_MAX_SIZE_BYTES) {
        errors.push('Resume PDF must be 5 MB or smaller.');
      }
    }
    if (errors.length > 0) {
      return NextResponse.json({ message: errors.join(' ') }, { status: 400 });
    }

    const firestore = await getFirestore();
    const jobRef = firestore.collection(CAREER_JOBS_COLLECTION).doc(jobId);
    const jobSnap = await jobRef.get();
    if (!jobSnap.exists) {
      return NextResponse.json({ message: 'Job not found.' }, { status: 404 });
    }

    const job = serializeJob(jobSnap, { publicOnly: true });
    if (!isJobOpen(job)) {
      return NextResponse.json({ message: 'This job is not accepting applications right now.' }, { status: 409 });
    }

    const existingApplication = await findExistingApplication(jobRef, application);
    if (existingApplication) {
      return NextResponse.json({
        message: 'You already applied for this job.',
        duplicate: true,
        duplicateField: existingApplication.field,
      }, { status: 409 });
    }

    const applicationRef = jobRef.collection('applications').doc();
    const resumeBuffer = Buffer.from(await resumeFile.arrayBuffer());
    const safeResumeName = String(resumeFile.name || 'resume.pdf').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
    const resumePath = `career_resumes/${jobId}/${applicationRef.id}/${nanoid()}-${safeResumeName || 'resume.pdf'}`;
    const bucketName = firebaseConfig.storageBucket || `${process.env.FIREBASE_PROJECT_ID}.firebasestorage.app`;
    const bucket = getStorage().bucket(bucketName);
    const storageFile = bucket.file(resumePath);
    await storageFile.save(resumeBuffer, {
      metadata: {
        contentType: 'application/pdf',
      },
      public: true,
    });
    const resumeUrl = `https://storage.googleapis.com/${bucket.name}/${resumePath}`;

    await firestore.runTransaction(async (transaction) => {
      transaction.set(applicationRef, {
        ...application,
        jobId,
        jobTitle: job.title,
        emailKey: String(application.email || '').trim().toLowerCase(),
        resumeUrl,
        resumeFileName: resumeFile.name || 'resume.pdf',
        resumeStoragePath: resumePath,
        resumeSize: Number(resumeFile.size || resumeBuffer.length || 0),
        status: 'applied',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(jobRef, {
        applicationCount: FieldValue.increment(1),
        lastApplicationAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });

    return NextResponse.json({
      success: true,
      applicationId: applicationRef.id,
      message: 'Application submitted successfully.',
    }, { status: 201 });
  } catch (error) {
    console.error('POST /api/career/jobs/[jobId]/apply ERROR:', error);
    return NextResponse.json(
      { message: 'Failed to submit application.', error: error.message },
      { status: 500 }
    );
  }
}
