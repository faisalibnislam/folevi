import { WorkspaceDetailView } from "@/components/admin/WorkspaceDetailView";

export default async function AdminWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WorkspaceDetailView id={decodeURIComponent(id)} />;
}
