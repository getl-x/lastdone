import { useState, type FormEvent } from "react";

export function CompletionDialog({
  itemName,
  defaultDate,
  onCancel,
  onComplete,
}: {
  itemName: string;
  defaultDate: string;
  onCancel(): void;
  onComplete(input: { localDate: string; note?: string }): Promise<void>;
}) {
  const [localDate, setLocalDate] = useState(defaultDate);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      await onComplete({ localDate, note: note.trim() || undefined });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop">
      <section
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="completion-title"
      >
        <h2 id="completion-title">记录完成：{itemName}</h2>
        <form onSubmit={submit}>
          <label className="field">
            <span>完成日期</span>
            <input
              type="date"
              required
              value={localDate}
              onChange={(event) => setLocalDate(event.target.value)}
            />
          </label>
          <label className="field">
            <span>备注（可选）</span>
            <textarea
              rows={3}
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <div className="dialog-actions">
            <button
              className="button button-secondary"
              type="button"
              onClick={onCancel}
            >
              取消
            </button>
            <button className="button button-primary" type="submit" disabled={saving}>
              {saving ? "正在保存…" : "记录完成"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
