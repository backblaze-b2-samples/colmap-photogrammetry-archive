import { Suspense } from "react";

import { UploadForm } from "@/components/upload/upload-form";
import { UploadTarget } from "@/components/upload/upload-target";

export default function UploadPage() {
  return (
    <div className="space-y-8">
      <div className="animate-fade-in border-b border-border pb-5">
        <h1 className="page-title">Upload</h1>
        <p className="mt-1.5 max-w-prose text-pretty text-sm text-muted-foreground">
          Drag photos in or click to browse. Choose a project to ingest them
          straight into its reconstruction prefix, or upload to the generic
          bucket path.
        </p>
      </div>
      <div className="animate-fade-in-up stagger-1">
        <Suspense fallback={null}>
          <UploadTarget />
        </Suspense>
      </div>
      <div className="animate-fade-in-up stagger-2">
        <UploadForm />
      </div>
    </div>
  );
}
