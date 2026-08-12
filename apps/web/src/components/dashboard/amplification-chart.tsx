"use client";

import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { BarChart3 } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjects } from "@/lib/queries";

const chartConfig = {
  source: { label: "Source (MB)", color: "var(--brand-b2)" },
  artifact: { label: "Artifacts (MB)", color: "var(--chart-1)" },
} satisfies ChartConfig;

const MB = 1024 * 1024;

export function AmplificationChart() {
  const { data: projects, isLoading, error, refetch } = useProjects();

  const data = useMemo(
    () =>
      (projects ?? [])
        .filter(
          (p) =>
            p.write_amplification.source_bytes > 0 ||
            p.write_amplification.artifact_bytes > 0,
        )
        .slice(0, 8)
        .map((p) => ({
          name: p.name.length > 14 ? `${p.name.slice(0, 13)}…` : p.name,
          source: +(p.write_amplification.source_bytes / MB).toFixed(2),
          artifact: +(p.write_amplification.artifact_bytes / MB).toFixed(2),
        })),
    [projects],
  );

  return (
    <Card>
      <CardHeader className="border-b border-border px-5 py-4">
        <CardTitle className="card-title">Source vs artifact bytes</CardTitle>
        <CardDescription className="text-xs">
          Per project — the fan-out B2 absorbs (MB)
        </CardDescription>
      </CardHeader>
      <CardContent className="p-5">
        {isLoading ? (
          <Skeleton className="h-[240px] w-full" />
        ) : error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : data.length === 0 ? (
          <EmptyState
            icon={BarChart3}
            title="No reconstructions yet"
            description="Run a project to see how a photo set fans out into derived artifacts."
          />
        ) : (
          <ChartContainer config={chartConfig} className="h-[240px] w-full">
            <BarChart data={data} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tickLine={false} axisLine={false} tickMargin={10} fontSize={11} />
              <YAxis tickLine={false} axisLine={false} tickMargin={6} fontSize={11} width={36} />
              <ChartTooltip cursor={{ fill: "var(--accent-subtle)" }} content={<ChartTooltipContent />} />
              <Bar dataKey="source" fill="var(--color-source)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="artifact" fill="var(--color-artifact)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
