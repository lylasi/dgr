import type { NextRequest } from "next/server";
import { getWorkerAvatarImage } from "@/lib/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ workerId: string }> },
) {
  const { workerId } = await context.params;
  const avatar = getWorkerAvatarImage(workerId);
  if (!avatar) return new Response(null, { status: 404 });

  const etag = `"${workerId}-${avatar.updated_at}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }
  return new Response(new Uint8Array(avatar.image_data), {
    headers: {
      "Content-Type": avatar.mime_type,
      "Content-Length": String(avatar.image_data.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
