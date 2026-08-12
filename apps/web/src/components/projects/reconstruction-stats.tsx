import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Project } from "@colmap-photogrammetry-archive/shared";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export function ReconstructionStats({ project }: { project: Project }) {
  const s = project.stats;
  const dense =
    s.dense_points === null ? "CUDA required" : s.dense_points.toLocaleString();

  return (
    <Card>
      <CardHeader className="border-b border-border px-5 py-4">
        <CardTitle className="card-title">Reconstruction stats</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 px-5 py-4 sm:grid-cols-3">
        <Stat label="Photos found" value={s.images_found.toLocaleString()} />
        <Stat label="Images registered" value={s.images_registered.toLocaleString()} />
        <Stat label="Sparse points" value={s.sparse_points.toLocaleString()} />
        <Stat label="Mean reproj. error" value={`${s.mean_reproj_error.toFixed(3)} px`} />
        <Stat label="Dense points" value={dense} />
        <Stat label="Device" value={(project.device ?? "cpu").toUpperCase()} />
      </CardContent>
    </Card>
  );
}
