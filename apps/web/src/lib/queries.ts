"use client";

import { useEffect, useRef } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  ApiError,
  createProject,
  deleteFile,
  deleteProject,
  getDownloadUrl,
  getFileDetail,
  getFiles,
  getFileStats,
  getHealth,
  getPreviewUrl,
  getProject,
  getProjectArtifacts,
  getProjectCapabilities,
  getProjects,
  getProjectStats,
  getUploadActivity,
  runProject,
  updateProject,
} from "@/lib/api-client";
import type {
  ArtifactEntry,
  FileMetadata,
  FileMetadataDetail,
  Project,
  ProjectCreate,
  ProjectStats,
  ProjectUpdate,
  ServerCapabilities,
} from "@colmap-photogrammetry-archive/shared";

// Single source of truth for query keys. Keep these tightly scoped so that
// invalidating "files" doesn't blow away unrelated caches, and so an IDE
// "find usages" of `qk.files` reveals every consumer.
export const qk = {
  all: ["b2"] as const,
  files: (prefix?: string, limit?: number) =>
    [...qk.all, "files", prefix ?? "", limit ?? 100] as const,
  stats: () => [...qk.all, "stats"] as const,
  uploadActivity: (days: number) =>
    [...qk.all, "stats", "activity", days] as const,
  preview: (key: string) => [...qk.all, "preview", key] as const,
  detail: (key: string) => [...qk.all, "detail", key] as const,
  health: () => [...qk.all, "health"] as const,
  projects: () => [...qk.all, "projects"] as const,
  project: (slug: string) => [...qk.all, "project", slug] as const,
  projectStats: () => [...qk.all, "projects", "stats"] as const,
  projectArtifacts: (slug: string) =>
    [...qk.all, "project", slug, "artifacts"] as const,
};

// A project is mid-reconstruction in any of these states, so its detail view
// should poll for live stage/status updates.
const RUNNING_STATUSES = new Set([
  "queued",
  "extracting",
  "matching",
  "sparse",
  "dense",
]);

export type Health = Awaited<ReturnType<typeof getHealth>>;

/**
 * Gate a query on something being open/visible. Deliberately the only option we
 * expose, so callers can't drift the caching policy per call site — the ⌘K
 * palette reuses `useFiles`' key (and therefore its cache) instead of fetching
 * its own private, smaller list.
 */
export interface QueryGate {
  enabled?: boolean;
}

export function useFiles(prefix = "", limit = 100, { enabled = true }: QueryGate = {}) {
  return useQuery<FileMetadata[], ApiError>({
    queryKey: qk.files(prefix, limit),
    queryFn: () => getFiles(prefix, limit),
    enabled,
  });
}

export function useFileStats({ enabled = true }: QueryGate = {}) {
  return useQuery({
    queryKey: qk.stats(),
    queryFn: getFileStats,
    enabled,
  });
}

export function useUploadActivity(days = 7) {
  return useQuery({
    queryKey: qk.uploadActivity(days),
    queryFn: () => getUploadActivity(days),
  });
}

// Presigned preview URL — only fetched when `enabled` is true (e.g., when
// the dialog opens for a specific file). Kept short-lived (60s) because
// the URL itself has a presigned expiry and is cheap to regenerate.
export function usePreviewUrl(key: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: qk.preview(key ?? ""),
    queryFn: () => getPreviewUrl(key as string),
    enabled: enabled && !!key,
    staleTime: 60_000,
  });
}

// Rich metadata for an already-stored file. The server recomputes it on demand
// (a full object download), so it's only fetched when `enabled` — i.e. the
// preview dialog is open AND the user expands "Detailed metadata". Kept
// short-lived like the preview URL; cheap correctness under key overwrites.
export function useFileDetail(key: string | undefined, enabled: boolean) {
  return useQuery<FileMetadataDetail, ApiError>({
    queryKey: qk.detail(key ?? ""),
    queryFn: () => getFileDetail(key as string),
    enabled: enabled && !!key,
    staleTime: 60_000,
  });
}

// Health poll for the top-of-app B2 banner. `retry: false` and letting a
// failed fetch leave `data` undefined keeps a down API silent (the
// per-component ErrorState covers that); the banner only reacts to an up API
// reporting b2_connected: false. Polls every 60s and on window focus.
export function useHealth() {
  return useQuery<Health>({
    queryKey: qk.health(),
    queryFn: getHealth,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: false,
  });
}

/**
 * Drop a deleted object from every cached file list, plus its own cached
 * preview/detail entries.
 *
 * Invalidation alone is not enough: the refetch re-lists the whole bucket and
 * took 5-6s in practice, so the success toast fired while the row was still
 * listed — and using that stale row's Preview 404'd. Editing the cache makes
 * the row disappear with the toast; the invalidation that follows still
 * reconciles against the server.
 *
 * Exported for tests — the mutation below is its only production caller.
 */
export function dropDeletedFileFromCache(qc: QueryClient, fileKey: string) {
  qc.setQueriesData<FileMetadata[]>(
    // Partial key: matches qk.files(prefix, limit) for every prefix/limit.
    { queryKey: [...qk.all, "files"] },
    (previous) =>
      previous ? previous.filter((file) => file.key !== fileKey) : previous,
  );
  // A presigned URL for a deleted key can only 404 now.
  qc.removeQueries({ queryKey: qk.preview(fileKey) });
  qc.removeQueries({ queryKey: qk.detail(fileKey) });
}

/**
 * Fetch a download URL for one file.
 *
 * A mutation, not a query: it has a server side effect (it bumps the download
 * counter) and it must never be cached or replayed. Being a mutation is also
 * what gives the UI an honest pending state — the old code awaited the presign
 * inside a plain click handler, so a slow round trip left the screen completely
 * unchanged and a user could not tell a working download from a dead button.
 *
 * The caller performs the navigation (see `lib/browser-download.ts`) and gets
 * `isPending` / `variables` for the pending row.
 */
export function useDownloadUrl() {
  const qc = useQueryClient();
  return useMutation<{ url: string }, ApiError, FileMetadata>({
    mutationFn: (file) => getDownloadUrl(file.key),
    // The server counted a download, so the dashboard's "Total Downloads" is
    // now stale. Cheap: /files/stats reads a cached bucket listing.
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.stats() }),
  });
}

export function useDeleteFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fileKey: string) => deleteFile(fileKey),
    onSuccess: (_data, fileKey) => {
      // Remove the row immediately, then reconcile everything (lists, stats,
      // activity) against the server in the background.
      dropDeletedFileFromCache(qc, fileKey);
      qc.invalidateQueries({ queryKey: qk.all });
    },
  });
}

// --- Photogrammetry archive: Project hooks ---------------------------------

export function useProjects() {
  return useQuery<Project[], ApiError>({
    queryKey: qk.projects(),
    queryFn: getProjects,
  });
}

export function useProjectStats() {
  return useQuery<ProjectStats, ApiError>({
    queryKey: qk.projectStats(),
    queryFn: getProjectStats,
  });
}

export function useProjectCapabilities() {
  return useQuery<ServerCapabilities, ApiError>({
    queryKey: [...qk.all, "projects", "capabilities"],
    queryFn: getProjectCapabilities,
    staleTime: 5 * 60_000,
  });
}

/**
 * One project's detail. While it is mid-reconstruction the query polls every
 * 2.5s so the stage timeline, status badge, and write-amplification panel
 * advance live; once it settles (archived/failed/draft) polling stops.
 */
export function useProject(slug: string | undefined, { enabled = true }: QueryGate = {}) {
  return useQuery<Project, ApiError>({
    queryKey: qk.project(slug ?? ""),
    queryFn: () => getProject(slug as string),
    enabled: enabled && !!slug,
    refetchInterval: (query) =>
      query.state.data && RUNNING_STATUSES.has(query.state.data.status)
        ? 2500
        : false,
  });
}

export function useProjectArtifacts(
  slug: string | undefined,
  { enabled = true }: QueryGate = {},
) {
  return useQuery<ArtifactEntry[], ApiError>({
    queryKey: qk.projectArtifacts(slug ?? ""),
    queryFn: () => getProjectArtifacts(slug as string),
    enabled: enabled && !!slug,
  });
}

/**
 * The project-artifacts query does not poll, so when a run settles into a
 * terminal state (archived/failed) the artifacts just written to B2 never
 * appear until a manual page reload. Watch the polled project status and, on
 * the running -> terminal transition, invalidate the artifacts query so the
 * asset explorer refetches the complete set. Invalidating only on the
 * transition (not a blanket refetchInterval) keeps the query idle otherwise.
 */
export function useRefetchArtifactsOnTerminal(
  slug: string | undefined,
  status: Project["status"] | undefined,
) {
  const qc = useQueryClient();
  const prevStatus = useRef<Project["status"] | undefined>(undefined);
  useEffect(() => {
    const previous = prevStatus.current;
    prevStatus.current = status;
    const settled = status === "archived" || status === "failed";
    if (slug && settled && previous !== undefined && RUNNING_STATUSES.has(previous)) {
      qc.invalidateQueries({ queryKey: qk.projectArtifacts(slug) });
    }
  }, [slug, status, qc]);
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation<Project, ApiError, ProjectCreate>({
    mutationFn: (payload) => createProject(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.projects() }),
  });
}

export function useUpdateProject(slug: string) {
  const qc = useQueryClient();
  return useMutation<Project, ApiError, ProjectUpdate>({
    mutationFn: (payload) => updateProject(slug, payload),
    onSuccess: (project) => {
      qc.setQueryData(qk.project(slug), project);
      qc.invalidateQueries({ queryKey: qk.projects() });
    },
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation<{ deleted: boolean; slug: string }, ApiError, string>({
    mutationFn: (slug) => deleteProject(slug),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.all }),
  });
}

export function useRunProject(slug: string) {
  const qc = useQueryClient();
  return useMutation<Project, ApiError, void>({
    mutationFn: () => runProject(slug),
    onSuccess: (project) => {
      qc.setQueryData(qk.project(slug), project);
      qc.invalidateQueries({ queryKey: qk.projects() });
    },
  });
}
