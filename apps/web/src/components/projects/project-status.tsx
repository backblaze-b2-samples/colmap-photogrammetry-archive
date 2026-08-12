import type { ProjectStatus } from "@colmap-photogrammetry-archive/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type StatusMeta = { label: string; className: string };

const STATUS_META: Record<ProjectStatus, StatusMeta> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
  queued: { label: "Queued", className: "bg-blue-500/15 text-blue-600 dark:text-blue-400" },
  extracting: { label: "Extracting", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  matching: { label: "Matching", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  sparse: { label: "Sparse SfM", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  dense: { label: "Dense MVS", className: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  archived: { label: "Archived", className: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  failed: { label: "Failed", className: "bg-red-500/15 text-red-600 dark:text-red-400" },
};

const RUNNING: ReadonlySet<ProjectStatus> = new Set([
  "queued",
  "extracting",
  "matching",
  "sparse",
  "dense",
]);

export function isRunning(status: ProjectStatus): boolean {
  return RUNNING.has(status);
}

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const meta = STATUS_META[status];
  return (
    <Badge
      variant="outline"
      className={cn("border-transparent font-medium", meta.className)}
    >
      {isRunning(status) && (
        <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      )}
      {meta.label}
    </Badge>
  );
}
