import { describe, it, expect } from "vitest";
import { countRecentSessions, listSessions, getDshSessionsDir } from "../src/sessions.js";

describe("Sessions Discovery", () => {
  it("should return valid path for dsh sessions directory", () => {
    const dir = getDshSessionsDir();
    expect(dir).toContain(".dsh");
    expect(dir).toContain("sessions");
  });

  it("should return a number for recent sessions count", () => {
    const count = countRecentSessions();
    expect(typeof count).toBe("number");
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("should return an array of session records", () => {
    const sessions = listSessions();
    expect(Array.isArray(sessions)).toBe(true);
  });
});
