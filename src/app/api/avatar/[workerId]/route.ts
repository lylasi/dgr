import type { NextRequest } from "next/server";
import { getActiveFamilyByEntryCode } from "@/lib/account-service";
import { systemBusinessContext } from "@/lib/business-context";
import { businessContextFromSession } from "@/lib/business-session";
import { DEFAULT_FAMILY_ID } from "@/lib/db";
import { getWorkerAvatarImage } from "@/lib/service";
import { getRequestSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ workerId: string }> },
) {
  const { workerId } = await context.params;
  const session = getRequestSession(request);
  const activeContext = businessContextFromSession(session);
  const entryCodeParameter = request.nextUrl.searchParams.get("entryCode");
  const entryFamily = entryCodeParameter === null
    ? null
    : getActiveFamilyByEntryCode(entryCodeParameter);
  if (entryCodeParameter !== null && !entryFamily) return new Response(null, { status: 404 });
  const businessContext = entryFamily
    ? systemBusinessContext(entryFamily.id)
    : activeContext
    || (!session.active ? systemBusinessContext(DEFAULT_FAMILY_ID) : null);
  if (!businessContext) return new Response(null, { status: 404 });
  const avatar = getWorkerAvatarImage(businessContext, workerId);
  if (!avatar) return new Response(null, { status: 404 });

  const etag = `"${workerId}-${avatar.updated_at}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }
  return new Response(new Uint8Array(avatar.image_data), {
    headers: {
      "Content-Type": avatar.mime_type,
      "Content-Length": String(avatar.image_data.length),
      "Cache-Control": "private, no-cache",
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
