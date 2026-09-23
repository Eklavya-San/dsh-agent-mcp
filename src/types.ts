export interface DshTaskOptions {
  cwd: string;
  task: string;
  timeoutMs?: number;
  verbose?: boolean;
}

export interface DshTaskResult {
  status: "SUCCESS" | "FAILED" | "TIMED_OUT";
  taskId: string;
  cwd: string;
  task: string;
  durationMs: number;
  summary: string;
  reasoning: string;
  filesChanged: string[];
  gitDiffSummary: string;
  exitCode: number | null;
  error?: string;
  rawOutput?: string;
}

export interface DshDoctorReport {
  status: "HEALTHY" | "DEGRADED" | "DOWN";
  dshBinary: {
    installed: boolean;
    path?: string;
    version?: string;
  };
  settings: {
    found: boolean;
    path: string;
    defaultModel?: {
      provider: string;
      model: string;
    };
  };
  modelEndpoint: {
    url: string;
    reachable: boolean;
    statusCode?: number;
    error?: string;
  };
  webUi: {
    running: boolean;
    port: number;
    url: string;
    pid?: number;
  };
}

export interface DshSessionInfo {
  sessionId: string;
  workspace: string;
  directory: string;
  lastModified: string;
  sizeBytes: number;
}

export interface DshWebStatus {
  running: boolean;
  port: number;
  url: string;
  pid?: number;
  recentSessionsCount: number;
}
