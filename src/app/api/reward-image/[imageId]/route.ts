import type { NextRequest } from "next/server";
import { businessContextFromSession } from "@/lib/business-session";
import { getRewardDefinitionImage } from "@/lib/reward-service";
import { getRequestSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ imageId: string }> },
) {
  const { imageId } = await context.params;
  const businessContext = businessContextFromSession(getRequestSession(request));
  if (!businessContext) return new Response(null, { status: 404 });
  const rewardImage = getRewardDefinitionImage(businessContext, imageId);
  if (!rewardImage) return new Response(null, { status: 404 });

  const etag = `"${rewardImage.id}-${rewardImage.created_at}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }
  return new Response(new Uint8Array(rewardImage.image_data), {
    headers: {
      "Content-Type": rewardImage.mime_type,
      "Content-Length": String(rewardImage.image_data.length),
      "Cache-Control": "private, no-cache",
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
