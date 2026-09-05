import type { ItemTemporalStatus } from "@lastdone/core";

const SUMMARY_ITEMS: Array<{
  status: ItemTemporalStatus;
  label: string;
}> = [
  { status: "overdue", label: "逾期" },
  { status: "due-today", label: "今天" },
  { status: "due-soon", label: "即将到期" },
];

export function StatusSummary({
  counts,
}: {
  counts: Partial<Record<ItemTemporalStatus, number>>;
}) {
  return (
    <section className="status-summary" aria-label="到期概览">
      {SUMMARY_ITEMS.map(({ status, label }) => (
        <div className={`summary-card summary-${status}`} key={status}>
          <strong>{counts[status] ?? 0}</strong>
          <span>{label}</span>
        </div>
      ))}
    </section>
  );
}
