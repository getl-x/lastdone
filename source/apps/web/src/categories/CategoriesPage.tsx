import { useLiveQuery } from "dexie-react-hooks";
import { useState, type FormEvent } from "react";

import { useData } from "../data/DataProvider";

const CATEGORY_ICONS = [
  { value: "heart-pulse", label: "健康" },
  { value: "house", label: "家居" },
  { value: "cloud", label: "云端" },
  { value: "cpu", label: "设备" },
  { value: "car", label: "车辆" },
  { value: "shapes", label: "其他" },
] as const;

export function CategoriesPage() {
  const { db, repositories, userId } = useData();
  const categories = useLiveQuery(
    async () =>
      (
        await db.categories.where("userId").equals(userId).sortBy("displayOrder")
      ).filter((category) => !category.deletedAt),
    [db, userId],
  );
  const [name, setName] = useState("");
  const [color, setColor] = useState("#657FA3");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingColor, setEditingColor] = useState("#657FA3");
  const [editingIcon, setEditingIcon] = useState("shapes");

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await repositories.categories.create({ name, color, icon: "shapes" });
    setName("");
  }

  function beginEditing(category: NonNullable<typeof categories>[number]) {
    setEditingId(category.id);
    setEditingName(category.name);
    setEditingColor(category.color);
    setEditingIcon(category.icon);
  }

  async function saveEditing(categoryId: string) {
    await repositories.categories.update(categoryId, {
      name: editingName,
      color: editingColor,
      icon: editingIcon,
    });
    setEditingId(null);
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
              {editingId === category.id ? (
                <div className="category-editor">
                  <label className="field">
                    <span>名称</span>
                    <input
                      value={editingName}
                      maxLength={100}
                      onChange={(event) => setEditingName(event.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>图标</span>
                    <select
                      value={editingIcon}
                      onChange={(event) => setEditingIcon(event.target.value)}
                    >
                      {CATEGORY_ICONS.map((icon) => (
                        <option value={icon.value} key={icon.value}>
                          {icon.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field color-field">
                    <span>颜色</span>
                    <input
                      type="color"
                      value={editingColor}
                      onChange={(event) => setEditingColor(event.target.value)}
                    />
                  </label>
                </div>
              ) : (
                <div>
                  <strong>{category.name}</strong>
                  <small>
                    {category.lifecycle === "archived" ? "已归档" : `排序 ${index + 1}`}
                  </small>
                </div>
              )}
              <div className="category-actions">
                {editingId === category.id ? (
                  <>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => void saveEditing(category.id)}
                    >
                      保存
                    </button>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => setEditingId(null)}
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => beginEditing(category)}
                    >
                      编辑
                    </button>
                    <button
                      className="text-button"
                      type="button"
                      disabled={index === 0}
                      onClick={() => void repositories.categories.move(category.id, -1)}
                    >
                      上移
                    </button>
                    <button
                      className="text-button"
                      type="button"
                      disabled={index === (categories?.length ?? 0) - 1}
                      onClick={() => void repositories.categories.move(category.id, 1)}
                    >
                      下移
                    </button>
                  </>
                )}
                <button
                  className="text-button"
                  type="button"
                  disabled={editingId === category.id}
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
