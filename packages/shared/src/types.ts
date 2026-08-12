export type FileStatus = "uploading" | "complete" | "error";

export interface FileMetadata {
  key: string;
  filename: string;
  folder: string;
  size_bytes: number;
  size_human: string;
  content_type: string;
  uploaded_at: string;
  url: string | null;
}

export interface FileMetadataDetail {
  filename: string;
  size_bytes: number;
  size_human: string;
  mime_type: string;
  extension: string;
  md5: string;
  sha256: string;
  uploaded_at: string;
  /** Set when a format-specific extractor was skipped or failed (e.g. an image
   *  above the decompression-bomb decode limit). Core fields stay exact. */
  metadata_warning: string | null;
  // Image-specific
  image_width: number | null;
  image_height: number | null;
  exif: Record<string, string> | null;
  // PDF-specific
  pdf_pages: number | null;
  pdf_author: string | null;
  pdf_title: string | null;
  // Audio/Video
  duration_seconds: number | null;
  codec: string | null;
  bitrate: number | null;
}

export interface FileUploadResponse {
  key: string;
  filename: string;
  size_bytes: number;
  size_human: string;
  content_type: string;
  uploaded_at: string;
  url: string | null;
  metadata: FileMetadataDetail | null;
}

/** A short-lived presigned PUT the browser uploads a file directly to B2 with.
 *  `headers` are signed into the URL, so the browser must send them verbatim. */
export interface PresignUploadResponse {
  key: string;
  url: string;
  method: string;
  content_type: string;
  headers: Record<string, string>;
  expires_in: number;
}

export interface DailyUploadCount {
  date: string;
  uploads: number;
}

export interface UploadStats {
  total_files: number;
  total_size_bytes: number;
  total_size_human: string;
  uploads_today: number;
  total_downloads: number;
}

// --- Photogrammetry archive (Project entity) -------------------------------

export type ProjectStatus =
  | "draft"
  | "queued"
  | "extracting"
  | "matching"
  | "sparse"
  | "dense"
  | "archived"
  | "failed";

export type MatcherMode = "exhaustive" | "sequential" | "spatial";
export type FeatureQuality = "low" | "medium" | "high";

export interface ReconstructionStats {
  images_found: number;
  images_registered: number;
  sparse_points: number;
  mean_reproj_error: number;
  dense_points: number | null;
}

export interface ArtifactEntry {
  key: string;
  kind: string;
  size_bytes: number;
  size_human: string;
}

export interface WriteAmplification {
  source_bytes: number;
  source_bytes_human: string;
  artifact_bytes: number;
  artifact_bytes_human: string;
  ratio: number;
}

export interface PipelineStage {
  name: string;
  label: string;
  status: string;
  detail: string | null;
}

export interface Project {
  slug: string;
  name: string;
  status: ProjectStatus;
  matcher: MatcherMode;
  quality: FeatureQuality;
  max_image_dim: number | null;
  enable_dense: boolean;
  source_prefix: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  device: string | null;
  duration_seconds: number | null;
  error: string | null;
  images_archived: number;
  stats: ReconstructionStats;
  write_amplification: WriteAmplification;
  stages: PipelineStage[];
  artifacts: ArtifactEntry[];
}

export interface ProjectCreate {
  name: string;
  matcher: MatcherMode;
  quality: FeatureQuality;
  max_image_dim: number | null;
  enable_dense: boolean;
  source_prefix: string;
}

export type ProjectUpdate = Partial<ProjectCreate>;

export interface ServerCapabilities {
  device: string;
  dense_available: boolean;
}

export interface ProjectStats {
  total_projects: number;
  draft: number;
  running: number;
  archived: number;
  failed: number;
  images_archived: number;
  sparse_points: number;
  source_bytes: number;
  source_bytes_human: string;
  artifact_bytes: number;
  artifact_bytes_human: string;
  ratio: number;
}
