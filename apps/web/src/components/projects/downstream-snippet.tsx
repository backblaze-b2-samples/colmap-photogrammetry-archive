"use client";

import { useState } from "react";
import { Check, Copy, Rocket } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * A copyable example showing how a downstream NeRF / 3DGS job pulls a project's
 * images and sparse model straight from B2 with presigned URLs — the "serve it
 * back to downstream jobs" half of the archive story.
 */
export function DownstreamSnippet({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);

  const snippet = `import boto3

# B2 is S3-compatible: point boto3 at your regional endpoint.
s3 = boto3.client(
    "s3",
    endpoint_url="https://s3.<region>.backblazeb2.com",
    aws_access_key_id="<B2_APPLICATION_KEY_ID>",
    aws_secret_access_key="<B2_APPLICATION_KEY>",
)
bucket = "<B2_BUCKET_NAME>"
prefix = "projects/${slug}/"

# Presign the sparse model + source photos for a NeRF / 3DGS training job.
for key in [f"{prefix}sparse/points.ply", f"{prefix}sparse/cameras.txt"]:
    url = s3.generate_presigned_url(
        "get_object", Params={"Bucket": bucket, "Key": key}, ExpiresIn=3600
    )
    print(key, "->", url)

# Stream every archived photo without copying the bucket locally:
paginator = s3.get_paginator("list_objects_v2")
for page in paginator.paginate(Bucket=bucket, Prefix=f"{prefix}images/"):
    for obj in page.get("Contents", []):
        print(obj["Key"], obj["Size"])`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the code is still selectable in the block */
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between border-b border-border px-5 py-4">
        <CardTitle className="card-title flex items-center gap-2">
          <Rocket className="h-4 w-4" />
          Serve to a downstream job
        </CardTitle>
        <Button variant="outline" size="sm" className="h-7" onClick={copy}>
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <pre className="overflow-x-auto px-5 py-4 text-xs leading-relaxed">
          <code className="font-mono text-muted-foreground">{snippet}</code>
        </pre>
      </CardContent>
    </Card>
  );
}
