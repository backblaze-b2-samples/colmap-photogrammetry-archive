import { TrendingUp } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WriteAmplification } from "@colmap-photogrammetry-archive/shared";

/**
 * The sample's headline metric. A photo set fans out into database + sparse +
 * dense + point-cloud artifacts whose footprint meets or exceeds the source
 * bytes — and B2 is the single layer holding all of it.
 */
export function WriteAmplificationPanel({ amp }: { amp: WriteAmplification }) {
  const total = Math.max(amp.source_bytes + amp.artifact_bytes, 1);
  const sourcePct = (amp.source_bytes / total) * 100;
  const artifactPct = (amp.artifact_bytes / total) * 100;
  const ratio = amp.ratio > 0 ? `${amp.ratio.toFixed(2)}×` : "—";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between border-b border-border px-5 py-4">
        <CardTitle className="card-title flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          Write amplification
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 py-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="font-mono text-4xl font-bold tabular-nums text-primary">
              {ratio}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              derived artifact bytes ÷ source photo bytes
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
            <span className="text-muted-foreground">Source photos</span>
            <span className="text-right font-mono tabular-nums">
              {amp.source_bytes_human}
            </span>
            <span className="text-muted-foreground">Derived artifacts</span>
            <span className="text-right font-mono tabular-nums">
              {amp.artifact_bytes_human}
            </span>
          </div>
        </div>

        <div className="mt-5 space-y-2">
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="bg-[var(--brand-b2)]"
              style={{ width: `${sourcePct}%` }}
              title={`Source ${amp.source_bytes_human}`}
            />
            <div
              className="bg-primary"
              style={{ width: `${artifactPct}%` }}
              title={`Artifacts ${amp.artifact_bytes_human}`}
            />
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[var(--brand-b2)]" />
              Source
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-primary" />
              Artifacts
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
