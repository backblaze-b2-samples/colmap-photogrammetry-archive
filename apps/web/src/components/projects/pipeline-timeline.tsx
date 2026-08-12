import { Check, CircleDashed, Loader2, MinusCircle, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { PipelineStage } from "@colmap-photogrammetry-archive/shared";

// The canonical order, so the timeline is stable even before a run has emitted
// any stages. Mirrors STAGE_SPECS in services/api/app/repo/colmap_engine.py.
const DEFAULT_STAGES: PipelineStage[] = [
  { name: "ingest", label: "Stage photos", status: "pending", detail: null },
  { name: "extracting", label: "SIFT feature extraction (CPU)", status: "pending", detail: null },
  { name: "matching", label: "Feature matching", status: "pending", detail: null },
  { name: "sparse", label: "Incremental mapping (sparse SfM)", status: "pending", detail: null },
  { name: "dense", label: "Dense MVS (CUDA only)", status: "pending", detail: null },
  { name: "archived", label: "Archive artifacts to B2", status: "pending", detail: null },
];

const ICONS: Record<string, { icon: LucideIcon; className: string }> = {
  done: { icon: Check, className: "text-emerald-500" },
  running: { icon: Loader2, className: "text-amber-500 animate-spin" },
  failed: { icon: X, className: "text-red-500" },
  skipped: { icon: MinusCircle, className: "text-muted-foreground" },
  pending: { icon: CircleDashed, className: "text-muted-foreground/50" },
};

export function PipelineTimeline({ stages }: { stages: PipelineStage[] }) {
  const merged = stages.length > 0 ? stages : DEFAULT_STAGES;

  return (
    <Card>
      <CardHeader className="border-b border-border px-5 py-4">
        <CardTitle className="card-title">Reconstruction pipeline</CardTitle>
      </CardHeader>
      <CardContent className="px-5 py-4">
        <ol className="space-y-3">
          {merged.map((stage) => {
            const meta = ICONS[stage.status] ?? ICONS.pending;
            const Icon = meta.icon;
            return (
              <li key={stage.name} className="flex items-start gap-3">
                <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", meta.className)} />
                <div className="min-w-0">
                  <p
                    className={cn(
                      "text-sm font-medium",
                      stage.status === "pending" && "text-muted-foreground",
                    )}
                  >
                    {stage.label}
                  </p>
                  {stage.detail && (
                    <p className="text-xs text-muted-foreground">{stage.detail}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
