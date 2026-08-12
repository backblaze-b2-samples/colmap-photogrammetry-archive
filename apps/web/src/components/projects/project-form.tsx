"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { useProjectCapabilities } from "@/lib/queries";
import type { ProjectCreate } from "@colmap-photogrammetry-archive/shared";

// Finite-value fields are selectors (never free text); only name and the
// optional source prefix are free text. See docs/features/projects.md.
const DIM_OPTIONS = ["1024", "1600", "2048", "original"] as const;

const schema = z.object({
  name: z.string().min(1, "Give the scene a name").max(120),
  matcher: z.enum(["exhaustive", "sequential", "spatial"]),
  quality: z.enum(["low", "medium", "high"]),
  max_image_dim: z.enum(DIM_OPTIONS),
  enable_dense: z.boolean(),
  source_prefix: z.string().max(200),
});

export type ProjectFormValues = z.infer<typeof schema>;

export const CREATE_DEFAULTS: ProjectFormValues = {
  name: "",
  matcher: "sequential",
  quality: "medium",
  max_image_dim: "1600",
  enable_dense: false,
  source_prefix: "",
};

export function toPayload(values: ProjectFormValues): ProjectCreate {
  return {
    name: values.name.trim(),
    matcher: values.matcher,
    quality: values.quality,
    max_image_dim:
      values.max_image_dim === "original" ? null : Number(values.max_image_dim),
    enable_dense: values.enable_dense,
    source_prefix: values.source_prefix.trim(),
  };
}

export function fromProject(p: {
  name: string;
  matcher: ProjectFormValues["matcher"];
  quality: ProjectFormValues["quality"];
  max_image_dim: number | null;
  enable_dense: boolean;
  source_prefix: string;
}): ProjectFormValues {
  const dim = p.max_image_dim === null ? "original" : String(p.max_image_dim);
  return {
    name: p.name,
    matcher: p.matcher,
    quality: p.quality,
    max_image_dim: (DIM_OPTIONS as readonly string[]).includes(dim)
      ? (dim as ProjectFormValues["max_image_dim"])
      : "original",
    enable_dense: p.enable_dense,
    source_prefix: p.source_prefix,
  };
}

interface ProjectFormProps {
  mode: "create" | "edit";
  defaultValues: ProjectFormValues;
  pending: boolean;
  onSubmit: (values: ProjectFormValues) => void;
  onCancel?: () => void;
}

export function ProjectForm({
  mode,
  defaultValues,
  pending,
  onSubmit,
  onCancel,
}: ProjectFormProps) {
  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(schema),
    defaultValues,
  });
  const { data: caps } = useProjectCapabilities();
  const denseAvailable = caps?.dense_available ?? false;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Scene name</FormLabel>
              <FormControl>
                <Input placeholder="Cathedral facade — north side" {...field} />
              </FormControl>
              <FormDescription>
                A human name for this archive scene. The URL slug is derived from
                it.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="matcher"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Feature matcher</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="sequential">Sequential</SelectItem>
                  <SelectItem value="exhaustive">Exhaustive</SelectItem>
                  <SelectItem value="spatial">Spatial</SelectItem>
                </SelectContent>
              </Select>
              <FormDescription>
                {mode === "create"
                  ? "Sequential suits ordered photo/video frames; pick exhaustive for an unordered set, spatial when photos carry GPS."
                  : "Sequential for ordered frames, exhaustive for unordered sets, spatial for geotagged photos."}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="quality"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Feature quality</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="low">Low — 2048 features/image</SelectItem>
                  <SelectItem value="medium">Medium — 4096 features/image</SelectItem>
                  <SelectItem value="high">High — 8192 features/image</SelectItem>
                </SelectContent>
              </Select>
              <FormDescription>
                Higher quality registers more views but takes longer on CPU.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="max_image_dim"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Max image dimension</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="1024">1024 px</SelectItem>
                  <SelectItem value="1600">1600 px</SelectItem>
                  <SelectItem value="2048">2048 px</SelectItem>
                  <SelectItem value="original">Original resolution</SelectItem>
                </SelectContent>
              </Select>
              <FormDescription>
                Downscaling the longest edge speeds up CPU SfM. 1600 px is a good
                default.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="enable_dense"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between rounded-md border border-border p-3">
              <div className="space-y-0.5">
                <FormLabel>Dense MVS reconstruction</FormLabel>
                <FormDescription>
                  {denseAvailable
                    ? "Runs patch-match stereo + fusion for a dense point cloud (CUDA detected)."
                    : "CUDA required — no GPU detected, so the dense stage is skipped and the sparse model is archived for downstream GPU jobs."}
                </FormDescription>
              </div>
              <FormControl>
                <Switch
                  checked={field.value && denseAvailable}
                  onCheckedChange={field.onChange}
                  disabled={!denseAvailable}
                />
              </FormControl>
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="source_prefix"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Source prefix (optional)</FormLabel>
              <FormControl>
                <Input placeholder="projects/other-scene/images/" {...field} />
              </FormControl>
              <FormDescription>
                Leave blank to reconstruct from photos you upload to this project.
                Set a bucket prefix to reconstruct from images already in B2.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex items-center justify-end gap-2">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={pending}>
            {pending
              ? "Saving…"
              : mode === "create"
                ? "Create project"
                : "Save changes"}
          </Button>
        </div>
      </form>
    </Form>
  );
}
