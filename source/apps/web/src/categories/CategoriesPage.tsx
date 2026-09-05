import { useLiveQuery } from "dexie-react-hooks";
import { useState, type FormEvent } from "react";

import { useData } from "../data/DataProvider";

export function CategoriesPage() {
  const { db, repositories, userId } = useData();
  const categories = useLiveQuery(
    () => db.categories.where("userId").equals(userId).sortBy("displayOrder"),
    [db, userId],
  );
  const [name, setName] = useState("");
  const [color, setColor] = useState("#657FA3");

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await repositories.categories.create({ name, color, icon: "shapes" });
    setName("");
  }

  return (
    <div className="categories-page">
      <header className="content-header">
        <div>
          <p className="eyebrow">整理</p>
          <h1>分类</h1>
          <p>每个事项只属于一个清晰的分类。</p>
        </div>
      </header>

      <section className="surface-card">
        <h2>添加分类</h2>
        <form className="inline-form" onSubmit={add}>
          <label className="field grow-field">
            <span>分类名称</span>
            <input
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="field color-field">
            <span>颜色</span>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </label>
          <button className="button button-primary" type="submit">
            添加分类
          </button>
        </form>
      </section>

      <section className="surface-card">
        <h2>全部分类</h2>
        <ul className="category-list">
          {categories?.map((category, index) => (
            <li
              key={category.id}
              className={category.lifecycle === "archived" ? "is-muted" : ""}
            >
              <span
                className="category-swatch"
                style={{ background: category.color }}
              />
              <div>
                <strong>{category.name}</strong>
                <small>
                  {category.lifecycle === "archived" ? "已归档" : `排序 ${index + 1}`}
                </small>
              </div>
              <div className="category-actions">
                <button
                  className="text-button"
                  type="button"
                  disabled={index === 0}
                  onClick={() =>
                    void repositories.categories.update(category.id, {
                      displayOrder: Math.max(0, category.displayOrder - 1),
                    })
                  }
                >
                  上移
                </button>
                <button
                  className="text-button"
                  type="button"
                  onClick={() =>
                    void repositories.categories.setArchived(
                      category.id,
                      category.lifecycle !== "archived",
                    )
                  }
                >
                  {category.lifecycle === "archived" ? "恢复" : "归档"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
