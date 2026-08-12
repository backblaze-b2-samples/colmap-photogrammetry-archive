"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ImagePlus, Pencil, Play, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button, buttonVariants } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/error-state";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useDeleteProject,
  useProject,
  useRefetchArtifactsOnTerminal,
  useRunProject,
  useUpdateProject,
} from "@/lib/queries";
import { ProjectStatusBadge, isRunning } from "./project-status";
import { WriteAmplificationPanel } from "./write-amplification-panel";
import { PipelineTimeline } from "./pipeline-timeline";
import { ReconstructionStats } from "./reconstruction-stats";
import { AssetExplorer } from "./asset-explorer";
import { DownstreamSnippet } from "./downstream-snippet";
import {
  ProjectForm,
  type ProjectFormValues,
  fromProject,
  toPayload,
} from "./project-form";

const MIN_PHOTOS = 3;

export function ProjectDetail({ slug }: { slug: string }) {
  const { data: project, isLoading, error, refetch } = useProject(slug);
  const run = useRunProject(slug);
  const update = useUpdateProject(slug);
  const del = useDeleteProject();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  // Refetch the B2 asset explorer the moment a run settles, so freshly
  // archived artifacts appear without a manual page reload.
  useRefetchArtifactsOnTerminal(slug, project?.status);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      </div>
    );
  }
  if (error || !project) {
    return <ErrorState error={error} onRetry={() => refetch()} />;
  }

  const running = isRunning(project.status);
  const canRun = project.images_archived >= MIN_PHOTOS && !running;

  const onRun = () =>
    run.mutate(undefined, {
      onSuccess: () => toast.success("Reconstruction started"),
      onError: (e) => toast.error("Could not start", { description: e.message }),
    });

  const onEdit = (values: ProjectFormValues) =>
    update.mutate(toPayload(values), {
      onSuccess: () => {
        setEditing(false);
        toast.success("Project updated");
      },
      onError: (e) => toast.error("Update failed", { description: e.message }),
    });

  const onDelete = () =>
    del.mutate(project.slug, {
      onSuccess: () => {
        toast.success("Project deleted");
        router.push("/projects");
      },
      onError: (e) => toast.error("Delete failed", { description: e.message }),
    });

  return (
    <div className="space-y-6">
      <div className="animate-fade-in space-y-4 border-b border-border pb-5">
        <Link
          href="/projects"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          All projects
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="page-title truncate">{project.name}</h1>
              <ProjectStatusBadge status={project.status} />
            </div>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              projects/{project.slug}/ · {project.images_archived} photos archived
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/upload?project=${project.slug}`}>
                <ImagePlus className="h-3.5 w-3.5" />
                Ingest photos
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={running}
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
            <Button size="sm" disabled={!canRun || run.isPending} onClick={onRun}>
              <Play className="h-3.5 w-3.5" />
              {running ? "Running…" : "Run reconstruction"}
            </Button>
            <DeleteButton onConfirm={onDelete} pending={del.isPending} disabled={running} />
          </div>
        </div>
        {!canRun && !running && (
          <p className="text-xs text-muted-foreground">
            Add at least {MIN_PHOTOS} overlapping photos (Ingest) before running.
          </p>
        )}
      </div>

      {project.status === "failed" && project.error && (
        <Alert variant="destructive">
          <AlertTitle>Reconstruction failed</AlertTitle>
          <AlertDescription>{project.error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <WriteAmplificationPanel amp={project.write_amplification} />
          <ReconstructionStats project={project} />
          <DownstreamSnippet slug={project.slug} />
        </div>
        <div className="space-y-6">
          <PipelineTimeline stages={project.stages} />
          <AssetExplorer slug={project.slug} />
        </div>
      </div>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit project</DialogTitle>
            <DialogDescription>
              Settings apply to the next reconstruction run.
            </DialogDescription>
          </DialogHeader>
          <ProjectForm
            mode="edit"
            defaultValues={fromProject(project)}
            pending={update.isPending}
            onSubmit={onEdit}
            onCancel={() => setEditing(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DeleteButton({
  onConfirm,
  pending,
  disabled,
}: {
  onConfirm: () => void;
  pending: boolean;
  disabled: boolean;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled || pending}>
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this project?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently removes every object under the project&apos;s B2
            prefix — source photos, the match database, the sparse model, and the
            manifest. Other projects are untouched. There is no undo.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={buttonVariants({ variant: "destructive" })}
          >
            Delete project
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
