import type { NextRequest } from "next/server";
import { getRewardDefinitionImage } from "@/lib/reward-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ imageId: string }> },
) {
  const { imageId } = await context.params;
  const rewardImage = getRewardDefinitionImage(imageId);
  if (!rewardImage) return new Response(null, { status: 404 });

  const etag = `"${rewardImage.id}-${rewardImage.created_at}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }
  return new Response(new Uint8Array(rewardImage.image_data), {
    headers: {
      "Content-Type": rewardImage.mime_type,
      "Content-Length": String(rewardImage.image_data.length),
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
