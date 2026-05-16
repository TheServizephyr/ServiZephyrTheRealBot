'use client';

import { useEffect, useMemo, useState } from 'react';
import { auth } from '@/lib/firebase';
import { BriefcaseBusiness, CalendarClock, Edit3, Eye, FilePlus2, GraduationCap, Loader2, Search, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import InfoDialog from '@/components/InfoDialog';

const defaultJobForm = {
  title: '',
  category: 'Sales',
  department: '',
  employmentType: 'Flexible',
  workType: 'Field / Hybrid',
  hiringTimeline: 'Immediate',
  location: '',
  educationTags: 'MBA, Graduate',
  skillTags: 'Sales',
  status: 'active',
  expiresAt: '',
  summary: '',
  description: '',
  responsibilities: '',
  requirements: '',
  benefits: '',
  compensation: '',
  applicationInstructions: '',
};

const categoryOptions = [
  'Sales',
  'Software Development',
  'Operations',
  'Marketing',
  'Customer Support',
  'Design',
  'Finance',
  'Other',
];

const toInputDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
};

const formatDate = (value) => {
  if (!value) return 'No expiry';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No expiry';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

const formatCandidateDate = (value) => {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

const formatBytes = (value) => {
  const bytes = Number(value || 0);
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(mb >= 1 ? 1 : 2)} MB`;
};

const toTextList = (value) => Array.isArray(value) ? value.join(', ') : String(value || '');

const normalizeJobForForm = (job) => ({
  title: job.title || '',
  category: job.category || 'Other',
  department: job.department || '',
  employmentType: job.employmentType || 'Flexible',
  workType: job.workType || 'Field / Hybrid',
  hiringTimeline: job.hiringTimeline || 'Admin will decide',
  location: job.location || '',
  educationTags: toTextList(job.educationTags),
  skillTags: toTextList(job.skillTags),
  status: job.status || 'inactive',
  expiresAt: toInputDate(job.expiresAt),
  summary: job.summary || '',
  description: job.description || '',
  responsibilities: job.responsibilities || '',
  requirements: job.requirements || '',
  benefits: job.benefits || '',
  compensation: job.compensation || '',
  applicationInstructions: job.applicationInstructions || '',
});

const getJobStateLabel = (job) => {
  if (job.isOpen) return 'Active';
  if (job.isExpired) return 'Expired';
  return 'Inactive';
};

export default function AdminCareersPage() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [jobDialogOpen, setJobDialogOpen] = useState(false);
  const [editingJob, setEditingJob] = useState(null);
  const [jobForm, setJobForm] = useState(defaultJobForm);
  const [applicationsDialog, setApplicationsDialog] = useState({ open: false, job: null, applications: [], loading: false });
  const [infoDialog, setInfoDialog] = useState({ isOpen: false, title: '', message: '' });

  const getAdminHeaders = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('Authentication required.');
    const idToken = await currentUser.getIdToken();
    return { Authorization: `Bearer ${idToken}` };
  };

  const loadJobs = async () => {
    setLoading(true);
    try {
      const headers = await getAdminHeaders();
      const response = await fetch('/api/admin/career/jobs', { headers, cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Failed to load jobs.');
      setJobs(data.jobs || []);
    } catch (error) {
      setInfoDialog({ isOpen: true, title: 'Error', message: error.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => ({
    total: jobs.length,
    active: jobs.filter((job) => job.isOpen).length,
    inactive: jobs.filter((job) => !job.isOpen).length,
    applications: jobs.reduce((sum, job) => sum + Number(job.applicationCount || 0), 0),
  }), [jobs]);

  const filteredJobs = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return jobs;
    return jobs.filter((job) => [
      job.title,
      job.category,
      job.location,
      job.department,
      ...(job.educationTags || []),
      ...(job.skillTags || []),
    ].join(' ').toLowerCase().includes(query));
  }, [jobs, search]);

  const openCreate = () => {
    setEditingJob(null);
    setJobForm(defaultJobForm);
    setJobDialogOpen(true);
  };

  const openEdit = (job) => {
    setEditingJob(job);
    setJobForm(normalizeJobForForm(job));
    setJobDialogOpen(true);
  };

  const updateJobForm = (field, value) => {
    setJobForm((prev) => ({ ...prev, [field]: value }));
  };

  const saveJob = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const headers = await getAdminHeaders();
      const endpoint = editingJob ? `/api/admin/career/jobs/${editingJob.id}` : '/api/admin/career/jobs';
      const response = await fetch(endpoint, {
        method: editingJob ? 'PATCH' : 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(jobForm),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Failed to save job.');
      setJobDialogOpen(false);
      setInfoDialog({ isOpen: true, title: 'Saved', message: editingJob ? 'Job updated successfully.' : 'Job created successfully.' });
      await loadJobs();
    } catch (error) {
      setInfoDialog({ isOpen: true, title: 'Error', message: error.message });
    } finally {
      setSaving(false);
    }
  };

  const loadApplications = async (job) => {
    setApplicationsDialog({ open: true, job, applications: [], loading: true });
    try {
      const headers = await getAdminHeaders();
      const response = await fetch(`/api/admin/career/jobs/${job.id}/applications`, { headers, cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Failed to load applications.');
      setApplicationsDialog({ open: true, job: data.job || job, applications: data.applications || [], loading: false });
    } catch (error) {
      setApplicationsDialog({ open: false, job: null, applications: [], loading: false });
      setInfoDialog({ isOpen: true, title: 'Error', message: error.message });
    }
  };

  const activateSalesPartner = async (candidate) => {
    try {
      const headers = await getAdminHeaders();
      const response = await fetch('/api/admin/sales/partners', {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: candidate.fullName,
          phone: candidate.phone,
          email: candidate.email,
          assignedArea: candidate.fullAddress || 'Assign area',
          assignedZones: '',
          status: 'training',
          trainingStatus: 'not_started',
          source: 'career_application',
          candidateApplicationId: candidate.id,
          candidateJobId: candidate.jobId,
          notes: `Activated from career application for ${candidate.jobTitle || applicationsDialog.job?.title || 'job'}.`,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Failed to activate sales partner.');
      setInfoDialog({
        isOpen: true,
        title: 'Activated',
        message: `${candidate.fullName} is now in Sales Operations. Employee ID: ${data.partner?.employeeId || 'Generated in Sales Ops'}`,
      });
      await loadApplications(applicationsDialog.job);
    } catch (error) {
      setInfoDialog({ isOpen: true, title: 'Error', message: error.message });
    }
  };

  return (
    <div className="space-y-6">
      <InfoDialog
        isOpen={infoDialog.isOpen}
        onClose={() => setInfoDialog({ isOpen: false, title: '', message: '' })}
        title={infoDialog.title}
        message={infoDialog.message}
      />

      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Career</h1>
          <p className="text-muted-foreground">Publish jobs and review candidate applications.</p>
        </div>
        <Button onClick={openCreate}>
          <FilePlus2 className="mr-2 h-4 w-4" />
          New Job
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="rounded-lg"><CardContent className="flex items-center gap-4 p-5"><BriefcaseBusiness className="h-8 w-8 text-primary" /><div><p className="text-sm text-muted-foreground">Total Jobs</p><p className="text-2xl font-bold">{counts.total}</p></div></CardContent></Card>
        <Card className="rounded-lg"><CardContent className="flex items-center gap-4 p-5"><CalendarClock className="h-8 w-8 text-green-500" /><div><p className="text-sm text-muted-foreground">Active</p><p className="text-2xl font-bold">{counts.active}</p></div></CardContent></Card>
        <Card className="rounded-lg"><CardContent className="flex items-center gap-4 p-5"><Eye className="h-8 w-8 text-muted-foreground" /><div><p className="text-sm text-muted-foreground">Closed</p><p className="text-2xl font-bold">{counts.inactive}</p></div></CardContent></Card>
        <Card className="rounded-lg"><CardContent className="flex items-center gap-4 p-5"><Users className="h-8 w-8 text-primary" /><div><p className="text-sm text-muted-foreground">Applications</p><p className="text-2xl font-bold">{counts.applications}</p></div></CardContent></Card>
      </div>

      <Card className="rounded-lg">
        <CardHeader className="gap-4 md:flex-row md:items-center md:justify-between">
          <CardTitle>Listed Jobs</CardTitle>
          <div className="relative md:w-80">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search jobs..." className="pl-9" />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading jobs...
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Filters</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Expiry</TableHead>
                  <TableHead>Applications</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredJobs.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">No jobs found.</TableCell></TableRow>
                ) : filteredJobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>
                      <div className="font-semibold">{job.title}</div>
                      <div className="text-sm text-muted-foreground">{job.category} · {job.location || 'No location'} · {job.hiringTimeline || 'Admin will decide'}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex max-w-md flex-wrap gap-1.5">
                        {(job.educationTags || []).slice(0, 3).map((tag) => <Badge key={`${job.id}-edu-${tag}`} variant="secondary">{tag}</Badge>)}
                        {(job.skillTags || []).slice(0, 3).map((tag) => <Badge key={`${job.id}-skill-${tag}`} variant="outline">{tag}</Badge>)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={job.isOpen ? 'default' : 'secondary'}>{getJobStateLabel(job)}</Badge>
                    </TableCell>
                    <TableCell>{formatDate(job.expiresAt)}</TableCell>
                    <TableCell>{job.applicationCount || 0}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => loadApplications(job)}>
                          <Users className="mr-2 h-4 w-4" />
                          Candidates
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => openEdit(job)}>
                          <Edit3 className="mr-2 h-4 w-4" />
                          Edit
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={jobDialogOpen} onOpenChange={setJobDialogOpen}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingJob ? 'Edit Job' : 'Create Job'}</DialogTitle>
            <DialogDescription>This exact job content is what candidates will see on the public career page.</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveJob} className="grid gap-4 md:grid-cols-2">
            <div>
              <Label htmlFor="job-title">Title</Label>
              <Input id="job-title" value={jobForm.title} onChange={(event) => updateJobForm('title', event.target.value)} required />
            </div>
            <div>
              <Label htmlFor="job-category">Category</Label>
              <select id="job-category" value={jobForm.category} onChange={(event) => updateJobForm('category', event.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                {categoryOptions.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="department">Department</Label>
              <Input id="department" value={jobForm.department} onChange={(event) => updateJobForm('department', event.target.value)} placeholder="Sales, IT, Operations..." />
            </div>
            <div>
              <Label htmlFor="location">Location</Label>
              <Input id="location" value={jobForm.location} onChange={(event) => updateJobForm('location', event.target.value)} placeholder="Muradnagar, Remote, Delhi NCR..." />
            </div>
            <div>
              <Label htmlFor="employmentType">Employment Type</Label>
              <Input id="employmentType" value={jobForm.employmentType} onChange={(event) => updateJobForm('employmentType', event.target.value)} placeholder="Full time, Internship, Commission..." />
            </div>
            <div>
              <Label htmlFor="workType">Work Type</Label>
              <Input id="workType" value={jobForm.workType} onChange={(event) => updateJobForm('workType', event.target.value)} placeholder="Field, Remote, Hybrid..." />
            </div>
            <div>
              <Label htmlFor="hiringTimeline">Hiring Timeline</Label>
              <select id="hiringTimeline" value={jobForm.hiringTimeline} onChange={(event) => updateJobForm('hiringTimeline', event.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                <option value="Immediate">Immediate</option>
                <option value="Within 15 days">Within 15 days</option>
                <option value="Within 30 days">Within 30 days</option>
                <option value="Later">Later</option>
              </select>
            </div>
            <div>
              <Label htmlFor="educationTags" className="flex items-center gap-2"><GraduationCap className="h-4 w-4" /> Education Filters</Label>
              <Input id="educationTags" value={jobForm.educationTags} onChange={(event) => updateJobForm('educationTags', event.target.value)} placeholder="MBA, B.Tech, Graduate" />
            </div>
            <div>
              <Label htmlFor="skillTags">Track Filters</Label>
              <Input id="skillTags" value={jobForm.skillTags} onChange={(event) => updateJobForm('skillTags', event.target.value)} placeholder="IT, Sales, Field Work" />
            </div>
            <div>
              <Label htmlFor="status">Status</Label>
              <select id="status" value={jobForm.status} onChange={(event) => updateJobForm('status', event.target.value)} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div>
              <Label htmlFor="expiresAt">Expiry Date</Label>
              <Input id="expiresAt" type="date" value={jobForm.expiresAt} onChange={(event) => updateJobForm('expiresAt', event.target.value)} />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="summary">Short Summary</Label>
              <Textarea id="summary" value={jobForm.summary} onChange={(event) => updateJobForm('summary', event.target.value)} rows={2} />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="description">Full Description</Label>
              <Textarea id="description" value={jobForm.description} onChange={(event) => updateJobForm('description', event.target.value)} rows={5} required />
            </div>
            <div>
              <Label htmlFor="responsibilities">Responsibilities</Label>
              <Textarea id="responsibilities" value={jobForm.responsibilities} onChange={(event) => updateJobForm('responsibilities', event.target.value)} rows={5} />
            </div>
            <div>
              <Label htmlFor="requirements">Requirements</Label>
              <Textarea id="requirements" value={jobForm.requirements} onChange={(event) => updateJobForm('requirements', event.target.value)} rows={5} />
            </div>
            <div>
              <Label htmlFor="benefits">Benefits</Label>
              <Textarea id="benefits" value={jobForm.benefits} onChange={(event) => updateJobForm('benefits', event.target.value)} rows={4} />
            </div>
            <div>
              <Label htmlFor="compensation">Compensation</Label>
              <Textarea id="compensation" value={jobForm.compensation} onChange={(event) => updateJobForm('compensation', event.target.value)} rows={4} />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="applicationInstructions">Application Instructions</Label>
              <Textarea id="applicationInstructions" value={jobForm.applicationInstructions} onChange={(event) => updateJobForm('applicationInstructions', event.target.value)} rows={3} />
            </div>
            <div className="flex gap-3 md:col-span-2">
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FilePlus2 className="mr-2 h-4 w-4" />}
                {saving ? 'Saving...' : 'Save Job'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setJobDialogOpen(false)}>Cancel</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={applicationsDialog.open} onOpenChange={(open) => !open && setApplicationsDialog({ open: false, job: null, applications: [], loading: false })}>
        <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Candidates for {applicationsDialog.job?.title}</DialogTitle>
            <DialogDescription>{applicationsDialog.applications.length} applications received.</DialogDescription>
          </DialogHeader>
          {applicationsDialog.loading ? (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Loading candidates...
            </div>
          ) : applicationsDialog.applications.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">No candidates have applied yet.</div>
          ) : (
            <div className="grid gap-4">
              {applicationsDialog.applications.map((candidate) => (
                <Card key={candidate.id} className="rounded-lg">
                  <CardHeader className="pb-3">
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div>
                        <CardTitle className="text-xl">{candidate.fullName}</CardTitle>
                        <p className="text-sm text-muted-foreground">{candidate.education || 'Education N/A'}</p>
                      </div>
                      <Badge variant="outline">{formatDate(candidate.createdAt)}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="grid gap-4 text-sm md:grid-cols-2">
                    <div><span className="text-muted-foreground">Phone:</span> {candidate.phone || 'N/A'}</div>
                    <div><span className="text-muted-foreground">Email:</span> {candidate.email || 'N/A'}</div>
                    <div><span className="text-muted-foreground">Date of Birth:</span> {formatCandidateDate(candidate.dateOfBirth)}</div>
                    <div><span className="text-muted-foreground">Resume:</span> {candidate.resumeUrl ? <a href={candidate.resumeUrl} target="_blank" rel="noreferrer" className="text-primary underline">{candidate.resumeFileName || 'Open PDF'}</a> : 'N/A'} {formatBytes(candidate.resumeSize)}</div>
                    <div className="md:col-span-2"><span className="text-muted-foreground">Full Address:</span> {candidate.fullAddress || 'N/A'}</div>
                    <div className="md:col-span-2">
                      <p className="font-medium">Experience</p>
                      <div className="mt-1 grid gap-2 text-muted-foreground md:grid-cols-3">
                        <p><span className="text-foreground">Years:</span> {candidate.experienceYears || 'N/A'}</p>
                        <p><span className="text-foreground">Company:</span> {candidate.experienceCompany || 'N/A'}</p>
                        <p><span className="text-foreground">Role:</span> {candidate.experienceRole || 'N/A'}</p>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-muted-foreground">{candidate.experienceDescription || 'N/A'}</p>
                    </div>
                    <div className="md:col-span-2">
                      <p className="font-medium">Why Join</p>
                      <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{candidate.whyJoin || 'N/A'}</p>
                    </div>
                    <div className="md:col-span-2">
                      <Button type="button" onClick={() => activateSalesPartner(candidate)}>
                        Activate Sales Partner
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
