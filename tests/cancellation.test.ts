import { describe, it, expect } from "vitest";
import { cancelDshTask, listActiveTasks, registerActiveTask, unregisterActiveTask } from "../src/runner.js";

describe("Task Cancellation & Active Registry", () => {
  it("should register, list, and unregister active tasks", () => {
    const mockChild: any = { kill: () => true };
    registerActiveTask("task-123", {
      child: mockChild,
      cwd: "/test/dir",
      task: "test task prompt",
      startTime: Date.now(),
    });

    const active = listActiveTasks();
    expect(active.some((t) => t.taskId === "task-123")).toBe(true);

    const cancelled = cancelDshTask("task-123");
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

  it("should return false when cancelling non-existent task", () => {
    expect(cancelDshTask("non-existent-task")).toBe(false);
  });
});
