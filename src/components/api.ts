export class ApiError extends Error {
  constructor(
    message: string,
    public code = "API_ERROR",
    public status = 400,
  ) {
    super(message);
  }
}

type ApiEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    cache: "no-store",
  });
  const body = (await response.json()) as ApiEnvelope<T>;
  if (!body.ok) throw new ApiError(body.error.message, body.error.code, response.status);
  return body.data;
}

export function mutationId() {
  // `randomUUID()` is only exposed in secure contexts by some browsers.
  // The app is commonly opened over plain HTTP on a home LAN, so keep the
  // request-id helper usable there as well.
  const webCrypto = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (webCrypto && typeof webCrypto.randomUUID === "function") {
    return webCrypto.randomUUID();
  }
  if (webCrypto && typeof webCrypto.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    webCrypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `request-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
