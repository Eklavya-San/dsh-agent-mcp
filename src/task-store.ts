import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
export type PersistedTaskStatus = "QUEUED" | "RUNNING" | "VERIFYING" | "REVIEWING" | "APPROVED" | "NEEDS_REVISION" | "FAILED" | "CANCELLED";
export interface PersistedTask { id: string; status: PersistedTaskStatus; task: string; cwd: string; worktree?: string; provider?: string; model?: string; createdAt: number; startedAt?: number; finishedAt?: number; durationMs?: number; exitCode?: number | null; retryCount: number; changedFiles: string[]; reviewStatus?: "APPROVED" | "NEEDS_REVISION"; error?: string; }
const storePath = process.env.PI_TASK_STORE || join(homedir(), ".pi-agent-mcp", "tasks.json");
function readStore(): PersistedTask[] { try { const parsed = JSON.parse(readFileSync(storePath, "utf-8")); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function writeStore(tasks: PersistedTask[]): void { mkdirSync(dirname(storePath), { recursive: true }); const temp = `${storePath}.tmp-${process.pid}`; writeFileSync(temp, JSON.stringify(tasks.slice(-500), null, 2), { mode: 0o600 }); renameSync(temp, storePath); }
export function upsertTask(task: PersistedTask): void { const tasks = readStore(); const index = tasks.findIndex((item) => item.id === task.id); if (index >= 0) tasks[index] = { ...tasks[index], ...task }; else tasks.push(task); writeStore(tasks); }
export function getTask(taskId: string): PersistedTask | undefined { return readStore().find((task) => task.id === taskId); }
export function listPersistedTasks(limit = 100): PersistedTask[] { return readStore().slice(-Math.max(1, Math.min(limit, 500))).reverse(); }
export function recoverInterruptedTasks(): PersistedTask[] { const tasks = readStore(); let changed = false; for (const task of tasks) { if (["QUEUED", "RUNNING", "VERIFYING", "REVIEWING"].includes(task.status)) { task.status = "FAILED"; task.finishedAt = Date.now(); task.error = "Task interrupted by process restart."; changed = true; } } if (changed) writeStore(tasks); return tasks; }
