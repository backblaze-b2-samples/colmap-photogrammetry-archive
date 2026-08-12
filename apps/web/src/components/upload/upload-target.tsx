"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { FolderInput } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProjects } from "@/lib/queries";
import { useUploadQueue } from "@/lib/upload-queue-context";

const GENERIC = "__generic__";

/**
 * Ingest target selector. Uploads default to the generic ``uploads/`` prefix;
 * pick a project to land photos under ``projects/<slug>/images/`` instead. Honors
 * a ``?project=<slug>`` deep link (the "Ingest photos" button on a project).
 */
export function UploadTarget() {
  const { data: projects = [] } = useProjects();
  const { projectTarget, setProjectTarget, uploading } = useUploadQueue();
  const params = useSearchParams();
  const deepLink = params.get("project");

  useEffect(() => {
    if (deepLink && projects.some((p) => p.slug === deepLink)) {
      setProjectTarget(deepLink);
    }
    // Only react to the deep link resolving against the loaded project list.
  }, [deepLink, projects, setProjectTarget]);

  const value = projectTarget ?? GENERIC;
  const active = projects.find((p) => p.slug === projectTarget);

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <div className="stat-icon-wrap">
            <FolderInput className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-medium">Ingest target</p>
            <p className="text-xs text-muted-foreground">
              {active
                ? `Photos land in projects/${active.slug}/images/`
                : "Photos land in the generic uploads/ prefix"}
            </p>
          </div>
        </div>
        <Select
          value={value}
          onValueChange={(v) => setProjectTarget(v === GENERIC ? null : v)}
          disabled={uploading}
        >
          <SelectTrigger className="w-full sm:w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={GENERIC}>No project (uploads/)</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.slug} value={p.slug}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  );
}
