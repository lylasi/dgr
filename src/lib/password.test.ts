import { describe, expect, it } from "vitest";
import { hashPassword, safeTextEqual, verifyPassword } from "@/lib/password";

describe("password helpers", () => {
  it("hashes worker PINs with a unique salt", async () => {
    const first = await hashPassword("1234");
    const second = await hashPassword("1234");
    expect(first).not.toBe(second);
    await expect(verifyPassword("1234", first)).resolves.toBe(true);
    await expect(verifyPassword("4321", first)).resolves.toBe(false);
  });

  it("compares administrator configuration values safely", () => {
    expect(safeTextEqual("secret", "secret")).toBe(true);
    expect(safeTextEqual("secret", "wrong")).toBe(false);
  });
});
