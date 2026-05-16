'use client';

import { useEffect, useMemo, useState } from 'react';
import { BriefcaseBusiness, CalendarClock, FileUp, Filter, GraduationCap, MapPin, Search, Send, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
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

const formatDate = (value) => {
  if (!value) return 'No expiry';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No expiry';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

const getJobSearchText = (job) => [
  job.title,
  job.category,
  job.department,
  job.location,
  job.description,
  ...(job.educationTags || []),
  ...(job.skillTags || []),
].join(' ').toLowerCase();

export default function CareerPage() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [education, setEducation] = useState('all');
  const [skill, setSkill] = useState('all');
  const [selectedJob, setSelectedJob] = useState(null);
  const [applicationJob, setApplicationJob] = useState(null);
  const [application, setApplication] = useState(emptyApplication);
  const [resumeFile, setResumeFile] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    const loadJobs = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await fetch('/api/career/jobs', { cache: 'no-store' });
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.message || 'Failed to load jobs.');
        }
        const data = await response.json();
        setJobs(data.jobs || []);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadJobs();
  }, []);

  const categories = useMemo(() => Array.from(new Set(jobs.map((job) => job.category).filter(Boolean))).sort(), [jobs]);
  const educationTags = useMemo(() => Array.from(new Set(jobs.flatMap((job) => job.educationTags || []))).sort(), [jobs]);
  const skillTags = useMemo(() => Array.from(new Set(jobs.flatMap((job) => job.skillTags || []))).sort(), [jobs]);

  const filteredJobs = useMemo(() => {
    const query = search.trim().toLowerCase();
    return jobs.filter((job) => {
      if (category !== 'all' && job.category !== category) return false;
      if (education !== 'all' && !(job.educationTags || []).includes(education)) return false;
      if (skill !== 'all' && !(job.skillTags || []).includes(skill)) return false;
      if (query && !getJobSearchText(job).includes(query)) return false;
      return true;
    });
  }, [jobs, search, category, education, skill]);

  const openApply = (job) => {
    setApplicationJob(job);
    setApplication(emptyApplication);
    setResumeFile(null);
    setFieldErrors({});
    setFormError('');
    setSuccessMessage('');
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
    if (!applicationJob?.id) return;

    setError('');
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

      const response = await fetch(`/api/career/jobs/${applicationJob.id}/apply`, {
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
    <main className="min-h-screen bg-background">
      <section className="border-b bg-muted/30">
        <div className="container mx-auto px-4 py-14 md:px-6 md:py-20">
          <div className="max-w-4xl">
            <Badge variant="outline" className="mb-5 gap-2 border-primary/30 bg-primary/10 text-primary">
              <BriefcaseBusiness className="h-3.5 w-3.5" />
              Career
            </Badge>
            <h1 className="text-4xl font-bold tracking-tight text-foreground md:text-6xl">Build ServiZephyr with us.</h1>
            <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
              Explore current openings across sales, technology, operations, and growth roles.
            </p>
          </div>
        </div>
      </section>

      <section className="container mx-auto px-4 py-8 md:px-6">
        <div className="flex flex-col gap-4 border-b pb-6 lg:flex-row lg:items-end">
          <div className="flex-1">
            <Label htmlFor="job-search" className="flex items-center gap-2">
              <Search className="h-4 w-4" />
              Search
            </Label>
            <Input
              id="job-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search role, city, MBA, IT, sales..."
              className="mt-2"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3 lg:w-[680px]">
            <div>
              <Label htmlFor="category-filter" className="flex items-center gap-2">
                <Filter className="h-4 w-4" />
                Category
              </Label>
              <select
                id="category-filter"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className="mt-2 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="all">All categories</option>
                {categories.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="education-filter" className="flex items-center gap-2">
                <GraduationCap className="h-4 w-4" />
                Education
              </Label>
              <select
                id="education-filter"
                value={education}
                onChange={(event) => setEducation(event.target.value)}
                className="mt-2 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="all">All education</option>
                {educationTags.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="skill-filter">Track</Label>
              <select
                id="skill-filter"
                value={skill}
                onChange={(event) => setSkill(event.target.value)}
                className="mt-2 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="all">All tracks</option>
                {skillTags.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
          </div>
        </div>

        {error ? (
          <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        <div className="mt-8 grid gap-5">
          {loading ? (
            <div className="py-16 text-center text-muted-foreground">Loading jobs...</div>
          ) : filteredJobs.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
              No jobs match these filters.
            </div>
          ) : filteredJobs.map((job) => (
            <Card key={job.id} className="overflow-hidden rounded-lg">
              <CardHeader className="gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={job.isOpen ? 'default' : 'secondary'}>
                      {job.isOpen ? 'Active' : job.isExpired ? 'Expired' : 'Inactive'}
                    </Badge>
                    <Badge variant="outline">{job.category}</Badge>
                    <Badge variant="outline">{job.employmentType}</Badge>
                    <Badge variant="outline">{job.hiringTimeline || 'Admin will decide'}</Badge>
                  </div>
                  <CardTitle className="mt-3 text-2xl">{job.title}</CardTitle>
                  <div className="mt-2 flex flex-wrap gap-4 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5"><MapPin className="h-4 w-4" />{job.location}</span>
                    <span className="inline-flex items-center gap-1.5"><CalendarClock className="h-4 w-4" />{formatDate(job.expiresAt)}</span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-muted-foreground">{job.summary || job.description}</p>
                <div className="flex flex-wrap gap-2">
                  {(job.educationTags || []).map((tag) => <Badge key={`edu-${tag}`} variant="secondary">{tag}</Badge>)}
                  {(job.skillTags || []).map((tag) => <Badge key={`skill-${tag}`} variant="outline">{tag}</Badge>)}
                </div>
              </CardContent>
              <CardFooter className="flex flex-col gap-3 border-t bg-muted/20 p-4 sm:flex-row sm:justify-end">
                <Button variant="outline" className="w-full sm:w-auto" onClick={() => setSelectedJob(job)}>
                  Read Description
                </Button>
                <Button className="w-full sm:w-auto" disabled={!job.isOpen} onClick={() => openApply(job)}>
                  {job.isOpen ? 'Apply' : 'Applications Closed'}
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </section>

      <Dialog open={Boolean(selectedJob)} onOpenChange={(open) => !open && setSelectedJob(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedJob?.title}</DialogTitle>
            <DialogDescription>{selectedJob?.category} · {selectedJob?.location}</DialogDescription>
          </DialogHeader>
          {selectedJob ? (
            <div className="space-y-5 text-sm">
              {[
                ['Overview', selectedJob.description],
                ['Responsibilities', selectedJob.responsibilities],
                ['Requirements', selectedJob.requirements],
                ['Benefits', selectedJob.benefits],
                ['Compensation', selectedJob.compensation],
                ['Hiring Timeline', selectedJob.hiringTimeline],
                ['Application Instructions', selectedJob.applicationInstructions],
              ].filter(([, value]) => value).map(([label, value]) => (
                <section key={label}>
                  <h3 className="mb-2 font-semibold text-foreground">{label}</h3>
                  <p className="whitespace-pre-wrap text-muted-foreground">{value}</p>
                </section>
              ))}
              {selectedJob.isOpen ? (
                <Button onClick={() => { setSelectedJob(null); openApply(selectedJob); }}>
                  <Send className="mr-2 h-4 w-4" />
                  Apply for this job
                </Button>
              ) : (
                <div className="flex items-center gap-2 rounded-md border p-3 text-muted-foreground">
                  <XCircle className="h-4 w-4" />
                  This job is not accepting applications.
                </div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(applicationJob)} onOpenChange={(open) => !open && setApplicationJob(null)}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-xl overflow-y-auto p-5 sm:p-6">
          <DialogHeader>
            <DialogTitle>Apply for {applicationJob?.title}</DialogTitle>
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
              <Button type="button" variant="outline" onClick={() => setApplicationJob(null)}>Close</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}
