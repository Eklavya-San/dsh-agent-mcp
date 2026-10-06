import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export type PersistedTaskStatus = "QUEUED" | "RUNNING" | "VERIFYING" | "REVIEWING" | "APPROVED" | "NEEDS_REVISION" | "FAILED" | "CANCELLED";
export interface PersistedTask { id: string; status: PersistedTaskStatus; task: string; cwd: string; worktree?: string; provider?: string; model?: string; createdAt?: number; startedAt?: number; finishedAt?: number; durationMs?: number; exitCode?: number | null; retryCount: number; changedFiles: string[]; reviewStatus?: "APPROVED" | "NEEDS_REVISION"; error?: string; }

const storePath = process.env.PI_TASK_STORE || join(homedir(), ".pi-agent-mcp", "tasks.json");
const lockPath = `${storePath}.lock`;
const LOCK_TIMEOUT_MS = 30_000;
const LOCK_RETRY_MS = 25;
const sleepSync = (ms: number): void => { const sab = new SharedArrayBuffer(4); Atomics.wait(new Int32Array(sab), 0, 0, ms); };
function readStore(): PersistedTask[] { try { const parsed = JSON.parse(readFileSync(storePath, "utf-8")); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function writeStore(tasks: PersistedTask[]): void { mkdirSync(dirname(storePath), { recursive: true }); const temp = `${storePath}.tmp-${process.pid}-${Date.now()}`; writeFileSync(temp, JSON.stringify(tasks.slice(-500), null, 2), { mode: 0o600 }); renameSync(temp, storePath); }
function acquireLock(): () => void { mkdirSync(dirname(lockPath), { recursive: true }); const started = Date.now(); while (true) { try { mkdirSync(lockPath); writeFileSync(join(lockPath, "owner"), `${process.pid}\n${Date.now()}\n`, { mode: 0o600 }); return () => { try { rmSync(lockPath, { recursive: true, force: true }); } catch {} }; } catch (error: any) { if (error?.code !== "EEXIST") throw error; try { if (Date.now() - statSync(lockPath).mtimeMs > LOCK_TIMEOUT_MS) { rmSync(lockPath, { recursive: true, force: true }); continue; } } catch {} if (Date.now() - started >= LOCK_TIMEOUT_MS) throw new Error("Timed out acquiring task-store lock"); sleepSync(LOCK_RETRY_MS); } } }
function cleanupApprovedWorktree(worktreePath?: string): void { if (!worktreePath || !isAbsolute(worktreePath)) return; const path = resolve(worktreePath); const taskId = path.split(/[\\/]/).pop() || ""; if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(taskId)) return; const worktreesRoot = resolve(path, ".."); if (relative(worktreesRoot, path) !== taskId || worktreesRoot.split(/[\\/]").pop() !== "worktrees") return; const dshRoot = resolve(worktreesRoot, ".."); if (dshRoot.split(/[\\/]").pop() !== ".dsh") return; const workspaceRoot = resolve(dshRoot, ".."); try { execFileSync("git", ["worktree", "remove", "--force", path], { cwd: workspaceRoot, encoding: "utf-8", stdio: "ignore" }); } catch {} }
export function upsertTask(task: PersistedTask): void { const release = acquireLock(); try { const tasks = readStore(); const index = tasks.findIndex((item) => item.id === task.id); const merged = index >= 0 ? { ...tasks[index], ...task } : task; if (index >= 0) tasks[index] = merged; else tasks.push(merged); writeStore(tasks); if (merged.status === "APPROVED") cleanupApprovedWorktree(merged.worktree); } finally { release(); } }
export function getTask(taskId: string): PersistedTask | undefined { return readStore().find((task) => task.id === taskId); }
export function listPersistedTasks(limit = 100): PersistedTask[] { return readStore().slice(-Math.max(1, Math.min(limit, 500))).reverse(); }
export function recoverInterruptedTasks(): PersistedTask[] { const release = acquireLock(); try { const tasks = readStore(); let changed = false; for (const task of tasks) { if (["QUEUED", "RUNNING", "VERIFYING", "REVIEWING"].includes(task.status)) { task.status = "FAILED"; task.finishedAt = Date.now(); task.error = "Task interrupted by process restart."; changed = true; } } if (changed) writeStore(tasks); return tasks; } finally { release(); } }
