import { Link } from "react-router";

import type { CategoryRecord, ItemRecord } from "@lastdone/storage";

const CATEGORY_SYMBOLS: Record<string, string> = {
  "heart-pulse": "♥",
  house: "⌂",
  cloud: "☁",
  cpu: "▣",
  car: "◆",
  shapes: "●",
};

export function ItemCard({
  item,
  category,
  statusText,
  onComplete,
}: {
  item: ItemRecord;
  category?: CategoryRecord;
  statusText: string;
  onComplete(): void;
}) {
  return (
    <article
      className={`item-card${item.important ? " is-important" : ""}`}
      data-testid="item-card"
    >
      <Link className="item-card-main" to={`/items/${item.id}`}>
        <span
          className="category-dot"
          style={{ backgroundColor: category?.color ?? "#77736D" }}
          aria-hidden="true"
        >
          {CATEGORY_SYMBOLS[category?.icon ?? ""] ?? "●"}
        </span>
        <span className="item-card-copy">
          <span className="item-card-title">
            {item.name}
            {item.important ? <span aria-label="重要">●</span> : null}
          </span>
          <span className="item-card-status">{statusText}</span>
          {item.lastCompletedDate ? (
            <span className="item-card-last">上次完成：{item.lastCompletedDate}</span>
          ) : null}
        </span>
      </Link>
      <button
        className="button button-complete"
        type="button"
        aria-label={`完成 ${item.name}`}
        onClick={onComplete}
      >
        完成
      </button>
    </article>
  );
}
