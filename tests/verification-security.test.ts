import { describe, expect, it } from "vitest";
import { sanitizedEnvironment } from "../src/security.js";

describe("verification environment security", () => {
  it("removes credential-bearing environment variables", () => {
    const original = process.env.TEST_SECRET;
    process.env.TEST_SECRET = "secret";
    try {
      const env = sanitizedEnvironment();
      expect(env.TEST_SECRET).toBeUndefined();
    } finally {
      if (original === undefined) delete process.env.TEST_SECRET;
      else process.env.TEST_SECRET = original;
    }
  });
});
