"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Boxes, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LoadingNotice } from "@/components/common/loading-notice";
import { useCreateProject, useProjects } from "@/lib/queries";
import { ProjectCard } from "./project-card";
import {
  CREATE_DEFAULTS,
  ProjectForm,
  type ProjectFormValues,
  toPayload,
} from "./project-form";

function NewProjectButton({ onOpen }: { onOpen: () => void }) {
  return (
    <Button size="sm" className="h-8" onClick={onOpen}>
      <Plus className="h-3.5 w-3.5" />
      New Project
    </Button>
  );
}

export function ProjectsLibrary() {
  const { data: projects = [], isLoading, error, refetch } = useProjects();
  const create = useCreateProject();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const onSubmit = (values: ProjectFormValues) => {
    create.mutate(toPayload(values), {
      onSuccess: (project) => {
        setOpen(false);
        toast.success(`Project “${project.name}” created`, {
          description: "Ingest photos, then run the reconstruction.",
        });
        router.push(`/projects/${project.slug}`);
      },
      onError: (e) => toast.error("Could not create project", { description: e.message }),
    });
  };

  return (
    <div className="space-y-8">
      <div className="animate-fade-in flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5">
        <div>
          <h1 className="page-title">Projects</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Structure-from-motion archive scenes. Each project holds its source
            photos and every derived COLMAP artifact on B2.
          </p>
        </div>
        <NewProjectButton onOpen={() => setOpen(true)} />
      </div>

      {isLoading && <LoadingNotice subject="projects" />}

      {error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No projects yet"
          description="Create a project, ingest a set of overlapping photos, then run COLMAP to recover camera poses and a sparse point cloud."
          action={<NewProjectButton onOpen={() => setOpen(true)} />}
        />
      ) : (
        <div className="grid animate-fade-in-up gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard key={project.slug} project={project} />
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              Defaults suit an ordered set of overlapping photos. You can change
              matcher, quality, and resolution any time before running.
            </DialogDescription>
          </DialogHeader>
          <ProjectForm
            mode="create"
            defaultValues={CREATE_DEFAULTS}
            pending={create.isPending}
            onSubmit={onSubmit}
            onCancel={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
