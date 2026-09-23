import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { DshSessionInfo } from "./types.js";

export function getDshSessionsDir(): string {
  return join(homedir(), ".dsh", "sessions");
}

export function countRecentSessions(): number {
  const sessionsDir = getDshSessionsDir();
  if (!existsSync(sessionsDir)) return 0;
  try {
    let count = 0;
    const workspaces = readdirSync(sessionsDir);
    for (const ws of workspaces) {
      const wsPath = join(sessionsDir, ws);
      if (statSync(wsPath).isDirectory()) {
        const sessions = readdirSync(wsPath);
        count += sessions.filter((s) => s.startsWith("session-")).length;
      }
    }
    return count;
  } catch {
    return 0;
  }
}

export function listSessions(targetWorkspace?: string): DshSessionInfo[] {
  const sessionsDir = getDshSessionsDir();
  if (!existsSync(sessionsDir)) return [];

  const results: DshSessionInfo[] = [];

  try {
    const workspaces = readdirSync(sessionsDir);
    for (const ws of workspaces) {
      if (targetWorkspace && !ws.includes(targetWorkspace)) continue;
      const wsPath = join(sessionsDir, ws);
      if (!statSync(wsPath).isDirectory()) continue;

      const sessions = readdirSync(wsPath);
      for (const s of sessions) {
        if (!s.startsWith("session-")) continue;
        const sessionPath = join(wsPath, s);
        try {
          const stats = statSync(sessionPath);
          results.push({
            sessionId: s,
            workspace: ws.replace(/--/g, "/"),
            directory: sessionPath,
            lastModified: stats.mtime.toISOString(),
            sizeBytes: stats.size,
          });
        } catch {}
      }
    }
  } catch {}

  // Sort by most recently modified first
  return results.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());
}
