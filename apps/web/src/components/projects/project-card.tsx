"use client";

import Link from "next/link";
import { ArrowUpRight, ImageIcon, Waypoints } from "lucide-react";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ProjectStatusBadge } from "./project-status";
import type { Project } from "@colmap-photogrammetry-archive/shared";

function AmplificationPill({ ratio }: { ratio: number }) {
  const label = ratio > 0 ? `${ratio.toFixed(2)}×` : "—";
  return (
    <span className="inline-flex items-baseline gap-1 rounded-md bg-primary/10 px-2 py-1 font-mono text-sm font-semibold tabular-nums text-primary">
      {label}
      <span className="text-[10px] font-medium uppercase tracking-wide text-primary/70">
        amp
      </span>
    </span>
  );
}

export function ProjectCard({ project }: { project: Project }) {
  const amp = project.write_amplification;
  return (
    <Link href={`/projects/${project.slug}`} className="group block">
      <Card className="card-hover h-full">
        <CardHeader className="flex flex-row items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <p className="truncate font-semibold leading-tight">{project.name}</p>
            <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
              projects/{project.slug}/
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ProjectStatusBadge status={project.status} />
            <ArrowUpRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </div>
        </CardHeader>
        <CardContent className="px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <ImageIcon className="h-3.5 w-3.5" />
                <span className="font-medium text-foreground tabular-nums">
                  {project.images_archived}
                </span>
                photos
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Waypoints className="h-3.5 w-3.5" />
                <span className="font-medium text-foreground tabular-nums">
                  {project.stats.sparse_points.toLocaleString()}
                </span>
                points
              </span>
            </div>
            <AmplificationPill ratio={amp.ratio} />
          </div>
          <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              Source{" "}
              <span className="font-mono text-foreground">
                {amp.source_bytes_human}
              </span>
            </span>
            <span aria-hidden>→</span>
            <span>
              Artifacts{" "}
              <span className="font-mono text-foreground">
                {amp.artifact_bytes_human}
              </span>
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
