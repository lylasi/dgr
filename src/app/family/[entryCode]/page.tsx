import { AppShell } from "@/components/app-shell";

export default async function FamilyPage({
  params,
}: {
  params: Promise<{ entryCode: string }>;
}) {
  const { entryCode } = await params;
  return <AppShell entryCode={entryCode} />;
}
