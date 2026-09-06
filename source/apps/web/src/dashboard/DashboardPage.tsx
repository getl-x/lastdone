import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";

import {
  classifyItem,
  formatRelativeStatus,
  type ItemTemporalStatus,
} from "@lastdone/core";
import type { ItemRecord } from "@lastdone/storage";

import { useData } from "../data/DataProvider";
import { currentLocalDate } from "../utils/localDate";
import { ItemCard } from "./ItemCard";
import { StatusSummary } from "./StatusSummary";

const GROUP_ORDER: ItemTemporalStatus[] = [
  "overdue",
  "due-today",
  "due-soon",
  "healthy",
  "not-started",
];

const GROUP_LABELS: Record<ItemTemporalStatus, string> = {
  overdue: "逾期",
  "due-today": "今天到期",
  "due-soon": "即将到期",
  healthy: "状态良好",
  "not-started": "尚未开始",
  paused: "已暂停",
  archived: "已归档",
};

function compareItems(left: ItemRecord, right: ItemRecord): number {
  if (left.dueDate === right.dueDate) {
    return left.name.localeCompare(right.name, "zh-CN");
  }
  if (left.dueDate === null) return 1;
  if (right.dueDate === null) return -1;
  return left.dueDate.localeCompare(right.dueDate);
}

export function DashboardPage({ today = currentLocalDate() }: { today?: string }) {
  const { db, repositories, userId } = useData();
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [undoCompletionId, setUndoCompletionId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const attentionOnly = searchParams.get("filter") === "attention";
  const data = useLiveQuery(async () => {
    const [items, categories, completions, settings] = await Promise.all([
      db.items.where("userId").equals(userId).toArray(),
      db.categories.where("userId").equals(userId).sortBy("displayOrder"),
      db.completions.where("userId").equals(userId).toArray(),
      db.settings.get(userId),
    ]);
    return { items, categories, completions, dueSoonDays: settings?.dueSoonDays ?? 7 };
  }, [db, userId]);

  const view = useMemo(() => {
    if (!data) return null;
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    const matchingItemIds = new Set(
      data.completions
        .filter(
          (completion) =>
            !completion.deletedAt &&
            completion.note?.toLocaleLowerCase("zh-CN").includes(normalizedQuery),
        )
        .map((completion) => completion.itemId),
    );
    const groups = new Map<ItemTemporalStatus, ItemRecord[]>();
    const counts: Partial<Record<ItemTemporalStatus, number>> = {};
    for (const item of data.items) {
      if (item.deletedAt || item.lifecycle !== "active") continue;
      if (categoryId && item.categoryId !== categoryId) continue;
      if (
        normalizedQuery &&
        !item.name.toLocaleLowerCase("zh-CN").includes(normalizedQuery) &&
        !matchingItemIds.has(item.id)
      ) {
        continue;
      }
      const status = classifyItem({
        today,
        dueDate: item.dueDate,
        lastCompletedDate: item.lastCompletedDate,
        dueSoonDays: data.dueSoonDays,
        lifecycle: item.lifecycle,
      });
      if (
        attentionOnly &&
        status !== "overdue" &&
        status !== "due-today" &&
        status !== "due-soon"
      ) {
        continue;
      }
      const values = groups.get(status) ?? [];
      values.push(item);
      groups.set(status, values);
      counts[status] = (counts[status] ?? 0) + 1;
    }
    for (const values of groups.values()) values.sort(compareItems);
    return { groups, counts };
  }, [attentionOnly, categoryId, data, query, today]);

  async function complete(item: ItemRecord) {
    const completion = await repositories.items.complete(item.id, {
      completedAt: new Date().toISOString(),
      localDate: today,
    });
    setUndoCompletionId(completion.id);
  }

  return (
    <div className="dashboard-page">
      <header className="content-header">
        <div>
          <p className="eyebrow">概览</p>
          <h1>今天要留意什么？</h1>
        </div>
        <Link className="button button-primary" to="/items/new">
          新建事项
        </Link>
      </header>

      <StatusSummary counts={view?.counts ?? {}} />

      <section className="dashboard-toolbar" aria-label="筛选事项">
        <label className="search-field">
          <span className="visually-hidden">搜索事项或完成备注</span>
          <input
            type="search"
            placeholder="搜索事项或备注"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          <span className="visually-hidden">按分类筛选</span>
          <select
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="">全部分类</option>
            {data?.categories
              .filter((category) => category.lifecycle === "active")
              .map((category) => (
                <option value={category.id} key={category.id}>
                  {category.name}
                </option>
              ))}
          </select>
        </label>
      </section>

      {attentionOnly ? (
        <div className="active-filter-notice">
          <span>只显示逾期、今天到期和即将到期的事项</span>
          <button type="button" onClick={() => setSearchParams({})}>
            显示全部
          </button>
        </div>
      ) : null}

      {!data ? <p className="loading-state">正在读取本地数据…</p> : null}
      {view && [...view.groups.values()].flat().length === 0 ? (
        <section className="empty-state">
          <strong>这里暂时很安静</strong>
          <p>新建一个不定期重复事项，LastDone 会替你记住下次。</p>
        </section>
      ) : null}
      {view
        ? GROUP_ORDER.map((status) => {
            const items = view.groups.get(status);
            if (!items?.length) return null;
            return (
              <section className="item-group" key={status}>
                <h2>{GROUP_LABELS[status]}</h2>
                <div className="item-list">
                  {items.map((item) => (
                    <ItemCard
                      key={item.id}
                      item={item}
                      category={data?.categories.find(
                        (category) => category.id === item.categoryId,
                      )}
                      statusText={formatRelativeStatus(
                        {
                          today,
                          dueDate: item.dueDate,
                          lastCompletedDate: item.lastCompletedDate,
                          dueSoonDays: data?.dueSoonDays ?? 7,
                          lifecycle: item.lifecycle,
                        },
                        "zh-CN",
                      )}
                      onComplete={() => void complete(item)}
                    />
                  ))}
                </div>
              </section>
            );
          })
        : null}

      {undoCompletionId ? (
        <aside className="undo-toast" aria-live="polite">
          <span>已记录完成</span>
          <button
            type="button"
            onClick={() => {
              void repositories.items
                .undoCompletion(undoCompletionId)
                .then(() => setUndoCompletionId(null));
            }}
          >
            撤销
          </button>
        </aside>
      ) : null}
    </div>
  );
}
