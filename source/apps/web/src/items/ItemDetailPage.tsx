import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { formatRelativeStatus } from "@lastdone/core";

import { useData } from "../data/DataProvider";
import { currentLocalDate } from "../utils/localDate";
import { CompletionDialog } from "./CompletionDialog";

function describeSchedule(schedule: unknown): string {
  if (!schedule || typeof schedule !== "object" || !("type" in schedule)) {
    return "未知周期";
  }
  const rule = schedule as {
    type: string;
    every?: number;
    unit?: string;
    day?: number;
    month?: number;
  };
  if (rule.type === "relative") {
    const units: Record<string, string> = {
      days: "天",
      weeks: "周",
      months: "个月",
      years: "年",
    };
    return `每 ${rule.every} ${units[rule.unit ?? ""] ?? rule.unit}`;
  }
  if (rule.type === "fixed-monthly") return `每月 ${rule.day} 日`;
  return `每年 ${rule.month} 月 ${rule.day} 日`;
}

export function ItemDetailPage({ today = currentLocalDate() }: { today?: string }) {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { db, repositories, userId } = useData();
  const [showCompletion, setShowCompletion] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const data = useLiveQuery(async () => {
    const item = await db.items.get(id);
    if (!item) return null;
    const [category, completions, skips, settings] = await Promise.all([
      db.categories.get(item.categoryId),
      db.completions.where("itemId").equals(id).reverse().sortBy("completedAt"),
      db.skips.where("itemId").equals(id).reverse().sortBy("occurrenceDate"),
      db.settings.get(userId),
    ]);
    return {
      item,
      category: category?.deletedAt ? undefined : category,
      completions,
      skips,
      dueSoonDays: settings?.dueSoonDays ?? 7,
    };
  }, [db, id, userId]);

  if (data === undefined) return <p>正在读取事项…</p>;
  if (!data || data.item.deletedAt) {
    return (
      <section className="empty-state">
        <strong>没有找到这个事项</strong>
        <Link to="/">返回首页</Link>
      </section>
    );
  }

  const { item } = data;
  const status = formatRelativeStatus(
    {
      today,
      dueDate: item.dueDate,
      lastCompletedDate: item.lastCompletedDate,
      dueSoonDays: data.dueSoonDays,
      lifecycle: item.lifecycle,
    },
    "zh-CN",
  );

  return (
    <div className="detail-page">
      <header className="content-header compact-header">
        <div>
          <p className="eyebrow">{data.category?.name ?? "未分类"}</p>
          <h1>{item.name}</h1>
        </div>
        <Link className="text-link" to="/">
          返回
        </Link>
      </header>

      <section className="detail-hero">
        <div>
          <span className="detail-status">{status}</span>
          <strong>{item.dueDate ?? "尚未设置日期"}</strong>
          <small>下次到期</small>
        </div>
        {item.lifecycle === "active" ? (
          <button
            className="button button-primary"
            onClick={() => setShowCompletion(true)}
          >
            记录完成
          </button>
        ) : null}
      </section>

      <section className="detail-grid">
        <article className="surface-card">
          <h2>安排</h2>
          <dl className="detail-list">
            <div>
              <dt>重复</dt>
              <dd>{describeSchedule(item.schedule)}</dd>
            </div>
            <div>
              <dt>上次完成</dt>
              <dd>{item.lastCompletedDate ?? "尚未完成"}</dd>
            </div>
            <div>
              <dt>重要事项</dt>
              <dd>{item.important ? "是" : "否"}</dd>
            </div>
          </dl>
          <div className="action-row">
            <Link className="button button-secondary" to={`/items/${item.id}/edit`}>
              编辑
            </Link>
            {item.lifecycle === "active" ? (
              <button
                className="button button-secondary"
                onClick={() => void repositories.items.pause(id)}
              >
                暂停
              </button>
            ) : (
              <button
                className="button button-secondary"
                onClick={() => void repositories.items.restore(id)}
              >
                恢复
              </button>
            )}
            {item.lifecycle !== "archived" ? (
              <button
                className="button button-secondary"
                onClick={() => void repositories.items.archive(id)}
              >
                归档
              </button>
            ) : null}
            {item.schedule.type !== "relative" && item.dueDate ? (
              <button
                className="button button-secondary"
                onClick={() => void repositories.items.skip(id, item.dueDate!)}
              >
                跳过本次
              </button>
            ) : null}
          </div>
        </article>

        <article className="surface-card">
          <h2>历史记录</h2>
          {data.completions.filter((completion) => !completion.deletedAt).length ===
            0 && data.skips.filter((skip) => !skip.deletedAt).length === 0 ? (
            <p className="muted">还没有历史记录。</p>
          ) : (
            <ol className="history-list">
              {data.completions
                .filter((completion) => !completion.deletedAt)
                .map((completion) => (
                  <li key={completion.id}>
                    <span>✓</span>
                    <div>
                      <strong>{completion.localDate}</strong>
                      {completion.note ? <p>{completion.note}</p> : null}
                    </div>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() =>
                        void repositories.items.undoCompletion(completion.id)
                      }
                    >
                      撤销
                    </button>
                  </li>
                ))}
              {data.skips
                .filter((skip) => !skip.deletedAt)
                .map((skip) => (
                  <li key={skip.id}>
                    <span>→</span>
                    <div>
                      <strong>{skip.occurrenceDate}</strong>
                      <p>已跳过</p>
                    </div>
                  </li>
                ))}
            </ol>
          )}
        </article>
      </section>

      <section className="danger-zone">
        <h2>永久删除</h2>
        <p>这会删除事项；历史记录会保留同步墓碑，无法从界面恢复。</p>
        {!confirmDelete ? (
          <button
            className="button button-danger"
            onClick={() => setConfirmDelete(true)}
          >
            删除事项
          </button>
        ) : (
          <div className="action-row">
            <button
              className="button button-secondary"
              onClick={() => setConfirmDelete(false)}
            >
              取消
            </button>
            <button
              className="button button-danger"
              onClick={() => {
                void repositories.items.remove(id).then(() => navigate("/"));
              }}
            >
              确认永久删除
            </button>
          </div>
        )}
      </section>

      {showCompletion ? (
        <CompletionDialog
          itemName={item.name}
          defaultDate={today}
          onCancel={() => setShowCompletion(false)}
          onComplete={async ({ localDate, note }) => {
            await repositories.items.complete(id, {
              localDate,
              note,
              completedAt: new Date().toISOString(),
            });
            setShowCompletion(false);
          }}
        />
      ) : null}
    </div>
  );
}
