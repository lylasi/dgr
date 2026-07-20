import { afterEach, describe, expect, it, vi } from "vitest";
import { mutationId } from "@/components/api";

describe("mutationId", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("works on HTTP browsers without crypto.randomUUID", () => {
    vi.stubGlobal("crypto", {
      getRandomValues<T extends ArrayBufferView>(array: T) {
        const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
        bytes.fill(7);
        return array;
      },
    });

    expect(mutationId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("still creates an id when Web Crypto is unavailable", () => {
    vi.stubGlobal("crypto", undefined);
    expect(mutationId()).toMatch(/^request-[a-z0-9]+-[a-z0-9]+$/);
  });
});
