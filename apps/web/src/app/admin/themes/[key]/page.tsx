import { ThemeEditor } from "@/components/admin/ThemeEditor";

export default async function AdminThemePage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  return <ThemeEditor themeKey={key} />;
}
