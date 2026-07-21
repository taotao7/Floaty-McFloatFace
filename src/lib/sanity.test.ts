import { describe, it, expect } from "vitest";

/**
 * Smoke test: confirms the vitest runner is wired correctly. Real test suites
 * live next to their modules (coords.test.ts, recording store tests, etc.).
 * This file can be deleted once any other test exists.
 */
describe("vitest harness", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
