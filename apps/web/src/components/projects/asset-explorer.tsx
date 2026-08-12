"use client";

import { useState } from "react";
import { Download, FolderTree } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { getProjectArtifactDownloadUrl } from "@/lib/api-client";
import { startBrowserDownload } from "@/lib/browser-download";
import { useProjectArtifacts } from "@/lib/queries";
import type { ArtifactEntry } from "@colmap-photogrammetry-archive/shared";

const KIND_ORDER = ["images", "database", "sparse", "points", "dense", "manifest", "other"];

function shortKey(key: string, slug: string): string {
  return key.replace(`projects/${slug}/`, "");
}

export function AssetExplorer({ slug }: { slug: string }) {
  const { data: entries = [], isLoading, error, refetch } = useProjectArtifacts(slug);
  const [busy, setBusy] = useState<string | null>(null);

  const download = async (entry: ArtifactEntry) => {
    setBusy(entry.key);
    try {
      const { url } = await getProjectArtifactDownloadUrl(slug, entry.key);
      const filename = entry.key.split("/").pop();
      if (!startBrowserDownload(url, filename)) {
        toast.error("Could not start the download");
      }
    } catch (e) {
      toast.error("Download failed", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  const sorted = [...entries].sort(
    (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.key.localeCompare(b.key),
  );

  return (
    <Card>
      <CardHeader className="border-b border-border px-5 py-4">
        <CardTitle className="card-title flex items-center gap-2">
          <FolderTree className="h-4 w-4" />
          Project assets on B2
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : sorted.length === 0 ? (
          <EmptyState
            icon={FolderTree}
            title="No assets yet"
            description="Ingest photos and run a reconstruction to populate this project's prefix."
          />
        ) : (
          <ul className="divide-y divide-border">
            {sorted.map((entry) => (
              <li
                key={entry.key}
                className="flex items-center justify-between gap-3 px-5 py-2.5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Badge variant="secondary" className="shrink-0 font-mono text-[10px] uppercase">
                    {entry.kind}
                  </Badge>
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {shortKey(entry.key, slug)}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {entry.size_human}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label={`Download ${shortKey(entry.key, slug)}`}
                    disabled={busy === entry.key}
                    onClick={() => download(entry)}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
