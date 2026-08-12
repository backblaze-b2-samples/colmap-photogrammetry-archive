"use client";

import Link from "next/link";
import { ArrowRight, Boxes } from "lucide-react";

import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { ProjectStatusBadge } from "@/components/projects/project-status";
import { useProjects } from "@/lib/queries";
import { formatDate } from "@/lib/utils";

export function RecentProjects() {
  const { data: projects = [], isLoading, error, refetch } = useProjects();
  const recent = projects.slice(0, 8);

  return (
    <Card>
      <CardHeader className="border-b border-border px-5 py-4">
        <CardTitle className="card-title">Recent projects</CardTitle>
        <CardAction className="self-center">
          <Link
            href="/projects"
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            View all
            <ArrowRight className="h-3 w-3" />
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-3 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : recent.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title="No projects yet"
            description="Create a project to start archiving reconstructions."
          />
        ) : (
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="w-[34%] text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Project
                </TableHead>
                <TableHead className="w-[18%] text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Status
                </TableHead>
                <TableHead className="w-[14%] text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Photos
                </TableHead>
                <TableHead className="w-[14%] text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Amp
                </TableHead>
                <TableHead className="w-[20%] text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Updated
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.map((p) => (
                <TableRow key={p.slug} className="table-row-hover">
                  <TableCell className="font-medium">
                    <Link
                      href={`/projects/${p.slug}`}
                      className="block truncate rounded-sm underline-offset-4 hover:underline"
                      title={p.name}
                    >
                      {p.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <ProjectStatusBadge status={p.status} />
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                    {p.images_archived}
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums text-muted-foreground">
                    {p.write_amplification.ratio > 0
                      ? `${p.write_amplification.ratio.toFixed(2)}×`
                      : "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDate(p.updated_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
