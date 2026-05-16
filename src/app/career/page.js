'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BriefcaseBusiness, CalendarClock, Filter, GraduationCap, MapPin, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import CareerApplyDialog from '@/components/career/CareerApplyDialog';

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

const getJobHref = (job) => `/career/${encodeURIComponent(job.id)}`;

export default function CareerPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [education, setEducation] = useState('all');
  const [skill, setSkill] = useState('all');
  const [applicationJob, setApplicationJob] = useState(null);

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
            <Card
              key={job.id}
              role="link"
              tabIndex={0}
              onClick={() => router.push(getJobHref(job))}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  router.push(getJobHref(job));
                }
              }}
              className="cursor-pointer overflow-hidden rounded-lg transition-colors hover:border-primary/50 hover:bg-muted/20"
            >
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
                <Button asChild variant="outline" className="w-full sm:w-auto">
                  <Link href={getJobHref(job)} onClick={(event) => event.stopPropagation()}>
                    Read Description
                  </Link>
                </Button>
                <Button
                  className="w-full sm:w-auto"
                  disabled={!job.isOpen}
                  onClick={(event) => {
                    event.stopPropagation();
                    openApply(job);
                  }}
                >
                  {job.isOpen ? 'Apply' : 'Applications Closed'}
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </section>

      <CareerApplyDialog
        job={applicationJob}
        open={Boolean(applicationJob)}
        onOpenChange={(open) => !open && setApplicationJob(null)}
      />
    </main>
  );
}
