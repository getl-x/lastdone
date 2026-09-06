import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { nextDueDate, type ScheduleRule } from "@lastdone/core";

import { useData } from "../data/DataProvider";

type ScheduleKind = "relative" | "fixed-monthly" | "fixed-yearly";

const REMINDER_OPTIONS = [
  { value: 30, label: "提前 30 天" },
  { value: 7, label: "提前 7 天" },
  { value: 3, label: "提前 3 天" },
  { value: 1, label: "提前 1 天" },
  { value: 0, label: "到期当天" },
] as const;

export function ItemFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { db, repositories, userId } = useData();
  const categories = useLiveQuery(
    async () =>
      (
        await db.categories.where("userId").equals(userId).sortBy("displayOrder")
      ).filter((category) => !category.deletedAt),
    [db, userId],
  );
  const existing = useLiveQuery(() => (id ? db.items.get(id) : undefined), [db, id]);
  const [initializedId, setInitializedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [scheduleKind, setScheduleKind] = useState<ScheduleKind>("relative");
  const [every, setEvery] = useState(30);
  const [unit, setUnit] = useState<"days" | "weeks" | "months" | "years">("days");
  const [monthlyDay, setMonthlyDay] = useState(1);
  const [yearlyMonth, setYearlyMonth] = useState(1);
  const [yearlyDay, setYearlyDay] = useState(1);
  const [startMode, setStartMode] = useState<"previous" | "due">("previous");
  const [previousDate, setPreviousDate] = useState("");
  const [initialDueDate, setInitialDueDate] = useState("");
  const [important, setImportant] = useState(false);
  const [reminderOffsets, setReminderOffsets] = useState<number[]>([7, 1, 0]);
  const [error, setError] = useState("");

  if (existing && initializedId !== existing.id) {
    setInitializedId(existing.id);
    setName(existing.name);
    setCategoryId(existing.categoryId);
    setScheduleKind(existing.schedule.type);
    if (existing.schedule.type === "relative") {
      setEvery(existing.schedule.every);
      setUnit(existing.schedule.unit);
    } else if (existing.schedule.type === "fixed-monthly") {
      setMonthlyDay(existing.schedule.day);
    } else {
      setYearlyMonth(existing.schedule.month);
      setYearlyDay(existing.schedule.day);
    }
    setStartMode("due");
    setInitialDueDate(existing.dueDate ?? "");
    setImportant(existing.important);
    setReminderOffsets(existing.reminderOffsets);
  }

  const resolvedCategoryId =
    categoryId ||
    categories?.find((category) => category.lifecycle === "active")?.id ||
    "";
  const selectableCategories = categories?.filter(
    (category) =>
      category.lifecycle === "active" || category.id === existing?.categoryId,
  );
  const schedule = useMemo<ScheduleRule>(() => {
    if (scheduleKind === "fixed-monthly") {
      return { type: "fixed-monthly", day: monthlyDay };
    }
    if (scheduleKind === "fixed-yearly") {
      return { type: "fixed-yearly", month: yearlyMonth, day: yearlyDay };
    }
    return { type: "relative", every, unit };
  }, [every, monthlyDay, scheduleKind, unit, yearlyDay, yearlyMonth]);
  const preview = useMemo(() => {
    try {
      if (startMode === "previous" && previousDate) {
        return nextDueDate(schedule, previousDate);
      }
      return initialDueDate || null;
    } catch {
      return null;
    }
  }, [initialDueDate, previousDate, schedule, startMode]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      if (important && reminderOffsets.length === 0) {
        throw new Error("重要事项至少需要选择一个提醒时间");
      }
      const selectedReminderOffsets = important
        ? [...reminderOffsets].sort((left, right) => right - left)
        : [];
      if (id) {
        await repositories.items.update(id, {
          name,
          categoryId: resolvedCategoryId,
          schedule,
          dueDate: preview,
          important,
          reminderOffsets: selectedReminderOffsets,
        });
        navigate(`/items/${id}`);
        return;
      }
      const item = await repositories.items.create({
        name,
        categoryId: resolvedCategoryId,
        schedule,
        ...(startMode === "previous"
          ? { previousCompletionDate: previousDate }
          : { initialDueDate }),
        important,
        reminderOffsets: selectedReminderOffsets,
      });
      navigate(`/items/${item.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，请重试");
    }
  }

  return (
    <div className="form-page">
      <header className="content-header compact-header">
        <div>
          <p className="eyebrow">事项</p>
          <h1>{id ? "编辑事项" : "新建事项"}</h1>
        </div>
        <Link className="text-link" to={id ? `/items/${id}` : "/"}>
          返回
        </Link>
      </header>

      {error ? <div className="notice notice-error">{error}</div> : null}
      <form className="surface-form" onSubmit={save}>
        <label className="field">
          <span>事项名称</span>
          <input
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          <span>分类</span>
          <select
            required
            value={resolvedCategoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            {selectableCategories?.map((category) => (
              <option
                key={category.id}
                value={category.id}
                disabled={category.lifecycle === "archived"}
              >
                {category.name}
                {category.lifecycle === "archived" ? "（已归档）" : ""}
              </option>
            ))}
          </select>
        </label>

        <fieldset>
          <legend>重复方式</legend>
          <div className="segmented-control">
            <label>
              <input
                type="radio"
                name="schedule-kind"
                checked={scheduleKind === "relative"}
                onChange={() => setScheduleKind("relative")}
              />
              完成后计算
            </label>
            <label>
              <input
                type="radio"
                name="schedule-kind"
                checked={scheduleKind === "fixed-monthly"}
                onChange={() => setScheduleKind("fixed-monthly")}
              />
              每月固定日
            </label>
            <label>
              <input
                type="radio"
                name="schedule-kind"
                checked={scheduleKind === "fixed-yearly"}
                onChange={() => setScheduleKind("fixed-yearly")}
              />
              每年固定日
            </label>
          </div>
        </fieldset>

        {scheduleKind === "relative" ? (
          <div className="field-row">
            <label className="field">
              <span>间隔</span>
              <input
                type="number"
                min={1}
                required
                value={every}
                onChange={(event) => setEvery(Number(event.target.value))}
              />
            </label>
            <label className="field">
              <span>单位</span>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value as typeof unit)}
              >
                <option value="days">天</option>
                <option value="weeks">周</option>
                <option value="months">月</option>
                <option value="years">年</option>
              </select>
            </label>
          </div>
        ) : null}
        {scheduleKind === "fixed-monthly" ? (
          <label className="field">
            <span>每月第几日</span>
            <input
              type="number"
              min={1}
              max={31}
              value={monthlyDay}
              onChange={(e) => setMonthlyDay(Number(e.target.value))}
            />
          </label>
        ) : null}
        {scheduleKind === "fixed-yearly" ? (
          <div className="field-row">
            <label className="field">
              <span>月份</span>
              <input
                type="number"
                min={1}
                max={12}
                value={yearlyMonth}
                onChange={(e) => setYearlyMonth(Number(e.target.value))}
              />
            </label>
            <label className="field">
              <span>日期</span>
              <input
                type="number"
                min={1}
                max={31}
                value={yearlyDay}
                onChange={(e) => setYearlyDay(Number(e.target.value))}
              />
            </label>
          </div>
        ) : null}

        {!id ? (
          <fieldset>
            <legend>从哪里开始</legend>
            <div className="segmented-control two-columns">
              <label>
                <input
                  type="radio"
                  name="start-mode"
                  checked={startMode === "previous"}
                  onChange={() => setStartMode("previous")}
                />
                已知上次完成日期
              </label>
              <label>
                <input
                  type="radio"
                  name="start-mode"
                  checked={startMode === "due"}
                  onChange={() => setStartMode("due")}
                />
                直接指定首次到期日
              </label>
            </div>
          </fieldset>
        ) : null}
        {startMode === "previous" && !id ? (
          <label className="field">
            <span>上次完成日期</span>
            <input
              type="date"
              required
              value={previousDate}
              onChange={(e) => setPreviousDate(e.target.value)}
            />
          </label>
        ) : (
          <label className="field">
            <span>{id ? "下次到期日" : "首次到期日"}</span>
            <input
              type="date"
              required
              value={initialDueDate}
              onChange={(e) => setInitialDueDate(e.target.value)}
            />
          </label>
        )}

        {preview ? <div className="due-preview">预计下次：{preview}</div> : null}
        <label className="check-field">
          <input
            type="checkbox"
            checked={important}
            onChange={(e) => setImportant(e.target.checked)}
          />
          <span>重要事项</span>
        </label>
        {important ? (
          <fieldset>
            <legend>提醒时间</legend>
            <div className="reminder-options">
              {REMINDER_OPTIONS.map((option) => (
                <label className="check-field" key={option.value}>
                  <input
                    type="checkbox"
                    checked={reminderOffsets.includes(option.value)}
                    onChange={(event) =>
                      setReminderOffsets((current) =>
                        event.target.checked
                          ? [...new Set([...current, option.value])]
                          : current.filter((value) => value !== option.value),
                      )
                    }
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <button className="button button-primary" type="submit">
          保存事项
        </button>
      </form>
    </div>
  );
}
