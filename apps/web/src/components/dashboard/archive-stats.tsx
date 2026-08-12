"use client";

import { Boxes, HardDrive, ImageIcon, Layers, TrendingUp } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/error-state";
import { LoadingNotice } from "@/components/common/loading-notice";
import { useProjectStats } from "@/lib/queries";
import { cn } from "@/lib/utils";

interface StatCard {
  title: string;
  value: string | number;
  icon: LucideIcon;
  hero?: boolean;
}

export function ArchiveStats() {
  const { data: stats, isLoading, error, refetch } = useProjectStats();

  if (error) {
    return (
      <Card>
        <CardContent className="p-0">
          <ErrorState error={error} onRetry={() => refetch()} />
        </CardContent>
      </Card>
    );
  }

  const ratio = stats?.ratio ?? 0;
  const cards: StatCard[] = [
    {
      title: "Write amplification",
      value: ratio > 0 ? `${ratio.toFixed(2)}×` : "—",
      icon: TrendingUp,
      hero: true,
    },
    { title: "Projects", value: stats?.total_projects ?? 0, icon: Boxes },
    { title: "Photos archived", value: stats?.images_archived ?? 0, icon: ImageIcon },
    { title: "Source on B2", value: stats?.source_bytes_human ?? "0.0 B", icon: HardDrive },
    { title: "Artifacts on B2", value: stats?.artifact_bytes_human ?? "0.0 B", icon: Layers },
  ];

  return (
    <>
      {isLoading && <LoadingNotice className="mb-3" subject="archive metrics" />}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {cards.map((card, i) => (
          <Card
            key={card.title}
            className={cn(
              "card-hover animate-fade-in-up",
              `stagger-${i + 1}`,
              card.hero && "border-primary/40 bg-primary/[0.03]",
            )}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 pb-2 pt-4">
              <CardTitle className="text-xs font-semibold text-muted-foreground">
                {card.title}
              </CardTitle>
              <div className="stat-icon-wrap">
                <card.icon className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-5">
              {isLoading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <div
                  className={cn(
                    "stat-value",
                    card.hero && "text-primary",
                  )}
                >
                  {card.value}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
