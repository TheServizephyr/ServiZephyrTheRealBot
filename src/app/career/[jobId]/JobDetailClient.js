'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, CalendarClock, CheckCircle2, Copy, GraduationCap, MapPin, Send, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import CareerApplyDialog from '@/components/career/CareerApplyDialog';

const formatDate = (value) => {
  if (!value) return 'No expiry';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No expiry';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

const DetailSection = ({ title, children }) => {
  if (!children) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold text-foreground">{title}</h2>
      <p className="whitespace-pre-wrap leading-7 text-muted-foreground">{children}</p>
    </section>
  );
};

export default function JobDetailClient({ job }) {
  const [applicationJob, setApplicationJob] = useState(null);
  const [copied, setCopied] = useState(false);

  const copyJobLink = async () => {
    if (typeof window === 'undefined' || !navigator?.clipboard) return;
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b bg-background">
        <div className="container mx-auto flex flex-col gap-4 px-4 py-5 md:flex-row md:items-center md:justify-between md:px-6">
          <Link href="/" className="flex items-center gap-3">
            <Image src="/logo.png" alt="ServiZephyr" width={44} height={44} className="h-11 w-11 rounded-md object-contain" priority />
            <div>
              <p className="text-lg font-bold leading-tight">ServiZephyr Careers</p>
              <p className="text-sm text-muted-foreground">Join the team building restaurant technology.</p>
            </div>
          </Link>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Serving local restaurants through smart technology solutions focused on ordering, billing, customer communication, and operational efficiency.
          </p>
        </div>
      </header>

      <section className="border-b bg-muted/30">
        <div className="container mx-auto px-4 py-10 md:px-6 md:py-14">
          <Button asChild variant="ghost" className="-ml-3 mb-6">
            <Link href="/career">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to careers
            </Link>
          </Button>

          <div className="grid gap-6 lg:grid-cols-[1fr_320px] lg:items-start">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={job.isOpen ? 'default' : 'secondary'}>
                  {job.isOpen ? 'Active' : job.isExpired ? 'Expired' : 'Inactive'}
                </Badge>
                <Badge variant="outline">{job.category}</Badge>
                <Badge variant="outline">{job.employmentType}</Badge>
                <Badge variant="outline">{job.hiringTimeline || 'Admin will decide'}</Badge>
              </div>
              <h1 className="mt-5 max-w-4xl text-4xl font-bold tracking-tight text-foreground md:text-6xl">
                {job.title}
              </h1>
              <div className="mt-5 flex flex-wrap gap-4 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-4 w-4" />
                  {job.location}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CalendarClock className="h-4 w-4" />
                  {formatDate(job.expiresAt)}
                </span>
                {job.department ? (
                  <span className="inline-flex items-center gap-1.5">
                    <GraduationCap className="h-4 w-4" />
                    {job.department}
                  </span>
                ) : null}
              </div>
            </div>

            <Card className="rounded-lg">
              <CardContent className="space-y-3 p-5">
                {job.isOpen ? (
                  <Button className="w-full" onClick={() => setApplicationJob(job)}>
                    <Send className="mr-2 h-4 w-4" />
                    Apply for this job
                  </Button>
                ) : (
                  <div className="flex items-center gap-2 rounded-md border p-3 text-sm text-muted-foreground">
                    <XCircle className="h-4 w-4" />
                    This job is not accepting applications.
                  </div>
                )}
                <Button variant="outline" className="w-full" onClick={copyJobLink}>
                  {copied ? <CheckCircle2 className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                  {copied ? 'Link copied' : 'Copy job link'}
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <section className="container mx-auto grid gap-8 px-4 py-10 md:px-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-8">
          <DetailSection title="Overview">{job.description || job.summary}</DetailSection>
          <DetailSection title="Responsibilities">{job.responsibilities}</DetailSection>
          <DetailSection title="Requirements">{job.requirements}</DetailSection>
          <DetailSection title="Benefits">{job.benefits}</DetailSection>
          <DetailSection title="Compensation">{job.compensation}</DetailSection>
          <DetailSection title="Why Join ServiZephyr?">{job.whyJoinServiZephyr}</DetailSection>
          <DetailSection title="Application Instructions">{job.applicationInstructions}</DetailSection>
        </div>

        <aside className="space-y-5">
          <Card className="rounded-lg">
            <CardContent className="space-y-4 p-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Work Type</p>
                <p className="mt-1 font-medium">{job.workType}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hiring Timeline</p>
                <p className="mt-1 font-medium">{job.hiringTimeline || 'Admin will decide'}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Last Date</p>
                <p className="mt-1 font-medium">{formatDate(job.expiresAt)}</p>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-2">
            {(job.educationTags || []).map((tag) => <Badge key={`edu-${tag}`} variant="secondary">{tag}</Badge>)}
            {(job.skillTags || []).map((tag) => <Badge key={`skill-${tag}`} variant="outline">{tag}</Badge>)}
          </div>
        </aside>
      </section>

      <CareerApplyDialog
        job={applicationJob}
        open={Boolean(applicationJob)}
        onOpenChange={(open) => !open && setApplicationJob(null)}
      />
    </main>
  );
}
