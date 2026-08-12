import Link from "next/link";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ArchiveStats } from "@/components/dashboard/archive-stats";
import { AmplificationChart } from "@/components/dashboard/amplification-chart";
import { RecentProjects } from "@/components/dashboard/recent-projects";

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <div className="animate-fade-in flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Photogrammetry archive on Backblaze B2 — how far your source photos
            fan out into derived reconstruction artifacts.
          </p>
        </div>
        <Button asChild size="sm" className="h-8">
          <Link href="/projects">
            <Plus className="h-3.5 w-3.5" />
            New project
          </Link>
        </Button>
      </div>
      <ArchiveStats />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="animate-fade-in-up stagger-3">
          <AmplificationChart />
        </div>
        <div className="animate-fade-in-up stagger-4">
          <RecentProjects />
        </div>
      </div>
    </div>
  );
}
