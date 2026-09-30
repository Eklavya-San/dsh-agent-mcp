export interface DshTaskOptions {
  cwd: string;
  task: string;
  model?: string;
  endpoint?: string;
  apiKey?: string;
  profile?: string;
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

export interface PiWebStatus {
  running: boolean;
  port: number;
  url: string;
  pid?: number;
  activeTasksCount?: number;
}

export interface DshWebStatus extends PiWebStatus {
  recentSessionsCount?: number;
}

export interface DshReviewOptions {
  cwd: string;
  brief: string;
  diff?: string;
  testCommand?: string;
  model?: string;
  endpoint?: string;
}

export interface DshReviewResult {
  verdict: "APPROVED" | "NEEDS_REVISION";
  summary: string;
  diffInspected: string;
  specCompliance: {
    compliant: boolean;
    missingRequirements: string[];
    unrequestedChanges: string[];
  };
  qualityAudit: {
    issues: Array<{ severity: "CRITICAL" | "IMPORTANT" | "MINOR"; description: string; file?: string }>;
    strengths: string[];
  };
  testResults?: {
    command: string;
    passed: boolean;
    output: string;
  };
}

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  defaultModel: string;
  apiKey?: string;
  authHeader?: string;
}

export interface PiTaskOptions {
  cwd: string;
  task: string;
  provider?: string;
  model?: string;
  timeoutMs?: number;
  verbose?: boolean;
}

export interface PiTaskResult {
  status: "SUCCESS" | "FAILED" | "TIMED_OUT";
  taskId: string;
  cwd: string;
  task: string;
  durationMs: number;
  filesChanged: string[];
  diffSummary: string;
  rawDiff: string;
  output: string;
  error?: string;
}

export interface PiReviewOptions {
  cwd: string;
  brief: string;
  diff?: string;
  testCommand?: string;
  provider?: string;
  model?: string;
}

export interface PiReviewResult {
  verdict: "APPROVED" | "NEEDS_REVISION";
  summary: string;
  diffInspected: string;
  specCompliance: {
    compliant: boolean;
    missingRequirements: string[];
    unrequestedChanges: string[];
  };
  qualityAudit: {
    issues: Array<{ severity: "CRITICAL" | "IMPORTANT" | "MINOR"; description: string; file?: string }>;
    strengths: string[];
  };
  testResults?: {
    command: string;
    passed: boolean;
    output: string;
  };
}

export interface PiDoctorReport {
  status: "HEALTHY" | "DEGRADED" | "DOWN";
  piBinary: {
    installed: boolean;
    path?: string;
    version?: string;
  };
  providers: Array<{
    id: string;
    name: string;
    baseUrl: string;
    model: string;
    reachable: boolean;
    latencyMs?: number;
    error?: string;
  }>;
}

