import { describe, it, expect } from "vitest";
import { cancelPiTask, cancelDshTask, listActiveTasks, registerActiveTask, unregisterActiveTask } from "../src/runner.js";

describe("Pi Task Cancellation & Active Registry", () => {
  it("should register, list, and cancel active tasks with cancelPiTask", () => {
    const mockChild: any = { kill: () => true };
    registerActiveTask("task-123", {
      child: mockChild,
      cwd: "/test/dir",
      task: "test task prompt",
      startTime: Date.now(),
    });

    const active = listActiveTasks();
    expect(active.some((t) => t.taskId === "task-123")).toBe(true);

    const cancelled = cancelPiTask("task-123");
    expect(cancelled).toBe(true);

    const after = listActiveTasks();
    expect(after.some((t) => t.taskId === "task-123")).toBe(false);

    // Test unregisterActiveTask directly
    registerActiveTask("task-456", {
      child: mockChild,
      cwd: "/test/dir",
      task: "another prompt",
      startTime: Date.now(),
    });
    expect(listActiveTasks().some((t) => t.taskId === "task-456")).toBe(true);
    unregisterActiveTask("task-456");
    expect(listActiveTasks().some((t) => t.taskId === "task-456")).toBe(false);
  });

  it("should maintain backward-compatible cancelDshTask alias", () => {
    const mockChild: any = { kill: () => true };
    registerActiveTask("dsh-task-compat", {
      child: mockChild,
      cwd: "/test/dir",
      task: "legacy compatibility prompt",
      startTime: Date.now(),
    });

    expect(listActiveTasks().some((t) => t.taskId === "dsh-task-compat")).toBe(true);
    const cancelled = cancelDshTask("dsh-task-compat");
    expect(cancelled).toBe(true);
    expect(listActiveTasks().some((t) => t.taskId === "dsh-task-compat")).toBe(false);
  });

  it("should return false when cancelling non-existent task", () => {
    expect(cancelPiTask("non-existent-task")).toBe(false);
    expect(cancelDshTask("non-existent-task")).toBe(false);
  });
});
