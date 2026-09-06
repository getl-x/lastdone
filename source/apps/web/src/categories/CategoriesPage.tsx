import { useLiveQuery } from "dexie-react-hooks";
import { useState, type FormEvent } from "react";

import type { CategoryRecord } from "@lastdone/storage";

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
  const data = useLiveQuery(async () => {
    const [categories, items] = await Promise.all([
      db.categories.where("userId").equals(userId).sortBy("displayOrder"),
      db.items.where("userId").equals(userId).toArray(),
    ]);
    const itemCounts = new Map<string, number>();
    for (const item of items) {
      if (!item.deletedAt) {
        itemCounts.set(item.categoryId, (itemCounts.get(item.categoryId) ?? 0) + 1);
      }
    }
    return {
      categories: categories.filter((category) => !category.deletedAt),
      itemCounts,
    };
  }, [db, userId]);
  const categories = data?.categories;
  const [name, setName] = useState("");
  const [color, setColor] = useState("#5B7FD8");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [editingColor, setEditingColor] = useState("#5B7FD8");
  const [editingIcon, setEditingIcon] = useState("shapes");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [replacementId, setReplacementId] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await repositories.categories.create({ name, color, icon: "shapes" });
    setName("");
  }

  function beginEditing(category: CategoryRecord) {
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

  function beginDeleting(category: CategoryRecord) {
    const replacements = (categories ?? []).filter(({ id }) => id !== category.id);
    const preferred =
      replacements.find(({ lifecycle }) => lifecycle === "active") ?? replacements[0];
    setDeletingId(category.id);
    setReplacementId(preferred?.id ?? "");
    setDeleteError("");
  }

  function cancelDeleting() {
    setDeletingId(null);
    setDeleteError("");
  }

  async function confirmDeleting() {
    if (!deletingId) return;
    const itemCount = data?.itemCounts.get(deletingId) ?? 0;
    setIsDeleting(true);
    setDeleteError("");
    try {
      await repositories.categories.remove(
        deletingId,
        itemCount > 0 ? replacementId : undefined,
      );
      setDeletingId(null);
    } catch {
      setDeleteError("删除失败，请确认已选择接收事项的分类后重试。");
    } finally {
      setIsDeleting(false);
    }
  }

  const deletingCategory = categories?.find(({ id }) => id === deletingId);
  const deletingItemCount = deletingId ? (data?.itemCounts.get(deletingId) ?? 0) : 0;
  const replacementCategories = (categories ?? []).filter(
    ({ id }) => id !== deletingId,
  );

  return (
    <div className="categories-page">
      <header className="content-header">
        <div>
          <p className="eyebrow">整理</p>
          <h1>分类</h1>
          <p>每个事项只属于一个清晰的分类。</p>
        </div>
      </header>

      <section className="surface-card category-create-card">
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

      <section className="surface-card category-list-card">
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
                <div className="category-copy">
                  <strong>{category.name}</strong>
                  <small>
                    {category.lifecycle === "archived" ? "已归档" : `排序 ${index + 1}`}
                    {` · ${data?.itemCounts.get(category.id) ?? 0} 个事项`}
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
                <button
                  className="text-button category-delete-button"
                  type="button"
                  aria-label={`删除分类 ${category.name}`}
                  title={
                    (categories?.length ?? 0) <= 1 ? "至少需要保留一个分类" : undefined
                  }
                  disabled={editingId === category.id || (categories?.length ?? 0) <= 1}
                  onClick={() => beginDeleting(category)}
                >
                  删除
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {deletingCategory ? (
        <div className="dialog-backdrop" role="presentation">
          <section
            className="dialog-card category-delete-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-category-title"
          >
            <div className="category-delete-heading">
              <span
                className="category-swatch"
                style={{ background: deletingCategory.color }}
                aria-hidden="true"
              />
              <div>
                <p className="eyebrow">删除分类</p>
                <h2 id="delete-category-title">删除“{deletingCategory.name}”？</h2>
              </div>
            </div>

            {deletingItemCount > 0 ? (
              <>
                <p className="dialog-description">
                  此分类中有 {deletingItemCount}{" "}
                  个事项（包括暂停或归档事项）。删除分类前， 请为它们选择新的归属。
                </p>
                <label className="field">
                  <span>事项移动到</span>
                  <select
                    value={replacementId}
                    onChange={(event) => setReplacementId(event.target.value)}
                  >
                    {replacementCategories.map((category) => (
                      <option value={category.id} key={category.id}>
                        {category.name}
                        {category.lifecycle === "archived" ? "（已归档）" : ""}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <p className="dialog-description">
                此分类中没有事项。删除后，它会在同步完成后从所有设备移除。
              </p>
            )}

            {deleteError ? <p className="notice notice-error">{deleteError}</p> : null}
            <div className="dialog-actions">
              <button
                className="button button-secondary"
                type="button"
                disabled={isDeleting}
                onClick={cancelDeleting}
              >
                取消
              </button>
              <button
                className="button button-danger"
                type="button"
                disabled={isDeleting || (deletingItemCount > 0 && !replacementId)}
                onClick={() => void confirmDeleting()}
              >
                {isDeleting ? "正在删除…" : "确认删除"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
