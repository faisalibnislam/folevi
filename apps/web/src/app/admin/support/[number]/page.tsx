import { SupportTicketView } from "@/components/admin/SupportTicketView";

export default async function AdminSupportTicketPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  return <SupportTicketView number={/^\d{1,9}$/.test(number) ? Number(number) : 0} />;
}
