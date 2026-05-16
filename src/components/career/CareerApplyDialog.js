'use client';

import { useState } from 'react';
import { FileUp, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const emptyApplication = {
  fullName: '',
  phone: '',
  email: '',
  fullAddress: '',
  dateOfBirth: '',
  education: '',
  experienceYears: '',
  experienceCompany: '',
  experienceRole: '',
  experienceDescription: '',
  whyJoin: '',
};

const RESUME_MAX_SIZE_BYTES = 5 * 1024 * 1024;
const todayInputValue = new Date().toISOString().slice(0, 10);

const RequiredLabel = ({ htmlFor, children }) => (
  <Label htmlFor={htmlFor}>
    {children} <span className="text-red-500">*</span>
  </Label>
);

const ErrorText = ({ message }) => (
  message ? <p className="mt-1 text-xs font-medium text-red-500">{message}</p> : null
);

export default function CareerApplyDialog({ job, open, onOpenChange }) {
  const [application, setApplication] = useState(emptyApplication);
  const [resumeFile, setResumeFile] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const resetForm = () => {
    setApplication(emptyApplication);
    setResumeFile(null);
    setFieldErrors({});
    setFormError('');
    setSuccessMessage('');
  };

  const handleOpenChange = (nextOpen) => {
    if (!nextOpen) resetForm();
    onOpenChange?.(nextOpen);
  };

  const updateApplicationField = (field, value) => {
    setApplication((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => ({ ...prev, [field]: '' }));
    setFormError('');
  };

  const handleResumeChange = (file) => {
    setResumeFile(file || null);
    setFieldErrors((prev) => ({ ...prev, resume: '' }));
    setFormError('');
  };

  const validateApplicationForm = () => {
    const nextErrors = {};
    if (!application.fullName.trim()) nextErrors.fullName = 'Full name is required.';
    if (!/^\d{10}$/.test(application.phone)) nextErrors.phone = 'Enter exactly 10 digits.';
    if (!application.dateOfBirth) nextErrors.dateOfBirth = 'Date of birth is required.';
    if (!application.fullAddress.trim()) {
      nextErrors.fullAddress = 'Full address is required.';
    } else if (application.fullAddress.trim().length < 10) {
      nextErrors.fullAddress = 'Please include house/street/locality details.';
    }
    if (!application.education.trim()) nextErrors.education = 'Education is required.';
    if (!resumeFile) {
      nextErrors.resume = 'Resume PDF is required.';
    } else if (resumeFile.type !== 'application/pdf' && !resumeFile.name.toLowerCase().endsWith('.pdf')) {
      nextErrors.resume = 'Upload a PDF file only.';
    } else if (resumeFile.size > RESUME_MAX_SIZE_BYTES) {
      nextErrors.resume = 'PDF must be 5 MB or smaller.';
    }
    return nextErrors;
  };

  const submitApplication = async (event) => {
    event.preventDefault();
    if (!job?.id) return;

    setFormError('');
    setSuccessMessage('');
    const nextErrors = validateApplicationForm();
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    try {
      const formData = new FormData();
      Object.entries(application).forEach(([key, value]) => {
        formData.append(key, value || '');
      });
      formData.append('resume', resumeFile);

      const response = await fetch(`/api/career/jobs/${job.id}/apply`, {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.duplicate) {
          setFieldErrors((prev) => ({
            ...prev,
            [data.duplicateField === 'email' ? 'email' : 'phone']: 'You already applied for this job.',
          }));
          throw new Error(data.message || 'You already applied for this job.');
        }
        throw new Error(data.message || 'Failed to submit application.');
      }
      setSuccessMessage('Application submitted successfully. Our team will review it.');
      setApplication(emptyApplication);
      setResumeFile(null);
      setFieldErrors({});
      setFormError('');
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-xl overflow-y-auto p-5 sm:p-6">
        <DialogHeader>
          <DialogTitle>Apply for {job?.title}</DialogTitle>
          <DialogDescription>Share your details with the ServiZephyr team.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submitApplication} noValidate className="mx-auto flex w-full max-w-md flex-col gap-4">
          {formError ? (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm font-medium text-red-500">
              {formError}
            </div>
          ) : null}
          <div>
            <RequiredLabel htmlFor="fullName">Full Name</RequiredLabel>
            <Input id="fullName" value={application.fullName} onChange={(event) => updateApplicationField('fullName', event.target.value)} aria-invalid={Boolean(fieldErrors.fullName)} />
            <ErrorText message={fieldErrors.fullName} />
          </div>
          <div>
            <RequiredLabel htmlFor="phone">Phone Number</RequiredLabel>
            <Input
              id="phone"
              value={application.phone}
              onChange={(event) => updateApplicationField('phone', event.target.value.replace(/\D/g, '').slice(0, 10))}
              inputMode="numeric"
              maxLength={10}
              pattern="[0-9]{10}"
              placeholder="10 digit mobile number"
              aria-invalid={Boolean(fieldErrors.phone)}
            />
            <ErrorText message={fieldErrors.phone} />
          </div>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={application.email} onChange={(event) => updateApplicationField('email', event.target.value)} aria-invalid={Boolean(fieldErrors.email)} />
            <ErrorText message={fieldErrors.email} />
          </div>
          <div>
            <RequiredLabel htmlFor="dateOfBirth">Date of Birth</RequiredLabel>
            <Input id="dateOfBirth" type="date" max={todayInputValue} value={application.dateOfBirth} onChange={(event) => updateApplicationField('dateOfBirth', event.target.value)} aria-invalid={Boolean(fieldErrors.dateOfBirth)} />
            <ErrorText message={fieldErrors.dateOfBirth} />
          </div>
          <div>
            <RequiredLabel htmlFor="fullAddress">Full Address</RequiredLabel>
            <Textarea
              id="fullAddress"
              value={application.fullAddress}
              onChange={(event) => updateApplicationField('fullAddress', event.target.value)}
              rows={3}
              placeholder="House/flat number, street/locality, city, state, pincode"
              aria-invalid={Boolean(fieldErrors.fullAddress)}
            />
            <ErrorText message={fieldErrors.fullAddress} />
          </div>
          <div>
            <RequiredLabel htmlFor="education">Education</RequiredLabel>
            <Input id="education" value={application.education} onChange={(event) => updateApplicationField('education', event.target.value)} placeholder="MBA, B.Tech, 12th, Diploma..." aria-invalid={Boolean(fieldErrors.education)} />
            <ErrorText message={fieldErrors.education} />
          </div>
          <div>
            <RequiredLabel htmlFor="resume">Resume PDF</RequiredLabel>
            <Input
              id="resume"
              type="file"
              accept="application/pdf,.pdf"
              onChange={(event) => handleResumeChange(event.target.files?.[0] || null)}
              className="sr-only"
            />
            <label
              htmlFor="resume"
              className={`mt-1 flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted ${fieldErrors.resume ? 'border-red-500' : 'border-input'}`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <FileUp className="h-4 w-4 text-primary" />
                <span className="truncate">{resumeFile ? resumeFile.name : 'Upload resume PDF'}</span>
              </span>
              <span className="shrink-0 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
                Choose File
              </span>
            </label>
            <p className="mt-1 text-xs text-muted-foreground">PDF only, max 5 MB.</p>
            <ErrorText message={fieldErrors.resume} />
          </div>
          <div>
            <Label htmlFor="experienceYears">Experience Years</Label>
            <Input id="experienceYears" value={application.experienceYears} onChange={(event) => updateApplicationField('experienceYears', event.target.value)} placeholder="Optional, e.g. 2 years" />
          </div>
          <div>
            <Label htmlFor="experienceCompany">Company / Workplace</Label>
            <Input id="experienceCompany" value={application.experienceCompany} onChange={(event) => updateApplicationField('experienceCompany', event.target.value)} placeholder="Optional" />
          </div>
          <div>
            <Label htmlFor="experienceRole">Previous Role</Label>
            <Input id="experienceRole" value={application.experienceRole} onChange={(event) => updateApplicationField('experienceRole', event.target.value)} placeholder="Optional" />
          </div>
          <div>
            <Label htmlFor="experienceDescription">Experience Description</Label>
            <Textarea id="experienceDescription" value={application.experienceDescription} onChange={(event) => updateApplicationField('experienceDescription', event.target.value)} rows={3} placeholder="Optional: what work you handled, achievements, responsibilities..." />
          </div>
          <div>
            <Label htmlFor="whyJoin">Why do you want to join?</Label>
            <Textarea id="whyJoin" value={application.whyJoin} onChange={(event) => updateApplicationField('whyJoin', event.target.value)} rows={4} placeholder="Optional" />
          </div>
          {successMessage ? <p className="rounded-md bg-green-500/10 p-3 text-sm text-green-600">{successMessage}</p> : null}
          <div className="flex gap-3">
            <Button type="submit" disabled={submitting || Boolean(successMessage)}>
              <Send className="mr-2 h-4 w-4" />
              {submitting ? 'Submitting...' : 'Submit Application'}
            </Button>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>Close</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
