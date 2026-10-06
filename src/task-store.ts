import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

export type PersistedTaskStatus = "QUEUED" | "RUNNING" | "VERIFYING" | "REVIEWING" | "APPROVED" | "NEEDS_REVISION" | "FAILED" | "CANCELLED";
export interface PersistedTask { id: string; status: PersistedTaskStatus; task: string; cwd: string; worktree?: string; provider?: string; model?: string; createdAt?: number; startedAt?: number; finishedAt?: number; durationMs?: number; exitCode?: number | null; retryCount: number; changedFiles: string[]; reviewStatus?: "APPROVED" | "NEEDS_REVISION"; error?: string; }

const storePath = process.env.PI_TASK_STORE || join(homedir(), ".pi-agent-mcp", "tasks.json");
const lockPath = `${storePath}.lock`;
const LOCK_TIMEOUT_MS = 30_000;
const LOCK_RETRY_MS = 25;

function readStore(): PersistedTask[] {
  try {
    const parsed = JSON.parse(readFileSync(storePath, "utf-8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStore(tasks: PersistedTask[]): void {
  mkdirSync(dirname(storePath), { recursive: true });
  const temp = `${storePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temp, JSON.stringify(tasks.slice(-500), null, 2), { mode: 0o600 });
  renameSync(temp, storePath);
}

async function acquireLock(): Promise<() => void> {
  mkdirSync(dirname(lockPath), { recursive: true });
  const started = Date.now();
  while (true) {
    try {
      mkdirSync(lockPath);
      writeFileSync(join(lockPath, "owner"), `${process.pid}\n${Date.now()}\n`, { mode: 0o600 });
      return () => {
        try { rmSync(lockPath, { recursive: true, force: true }); } catch {}
      };
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const age = Date.now() - statSync(lockPath).mtimeMs;
        if (age > LOCK_TIMEOUT_MS) {
          rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {}
      if (Date.now() - started >= LOCK_TIMEOUT_MS) throw new Error("Timed out acquiring task-store lock");
      await sleep(LOCK_RETRY_MS);
    }
  }
}

export async function upsertTask(task: PersistedTask): Promise<void> {
  const release = await acquireLock();
  try {
    const tasks = readStore();
    const index = tasks.findIndex((item) => item.id === task.id);
    if (index >= 0) tasks[index] = { ...tasks[index], ...task };
    else tasks.push(task);
    writeStore(tasks);
  } finally {
    release();
  }
}

export function getTask(taskId: string): PersistedTask | undefined { return readStore().find((task) => task.id === taskId); }
export function listPersistedTasks(limit = 100): PersistedTask[] { return readStore().slice(-Math.max(1, Math.min(limit, 500))).reverse(); }

export async function recoverInterruptedTasks(): Promise<PersistedTask[]> {
  const release = await acquireLock();
  try {
    const tasks = readStore();
    let changed = false;
    for (const task of tasks) {
      if (["QUEUED", "RUNNING", "VERIFYING", "REVIEWING"].includes(task.status)) {
        task.status = "FAILED";
        task.finishedAt = Date.now();
        task.error = "Task interrupted by process restart.";
        changed = true;
      }
    }
    if (changed) writeStore(tasks);
    return tasks;
  } finally {
    release();
  }
}
