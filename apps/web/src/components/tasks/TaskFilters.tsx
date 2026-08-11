import type {
  TaskFilterValues,
  TeamMemberSummary,
} from '../../types/workspace';

export interface TaskFiltersProps {
  values: TaskFilterValues;
  members: TeamMemberSummary[];
  onChange(next: TaskFilterValues): void;
}

export function TaskFilters({
  values,
  members,
  onChange,
}: TaskFiltersProps) {
  return (
    <section className="task-filters" aria-label="任务筛选">
      <div className="task-filter-field task-filter-keyword">
        <label htmlFor="task-filter-keyword">关键词</label>
        <input
          id="task-filter-keyword"
          type="search"
          value={values.q}
          maxLength={200}
          placeholder="搜索任务标题或说明"
          onChange={(event) => onChange({ ...values, q: event.target.value })}
        />
      </div>
      <div className="task-filter-field">
        <label htmlFor="task-filter-assignee">负责人筛选</label>
        <select
          id="task-filter-assignee"
          value={values.assigneeId}
          onChange={(event) =>
            onChange({ ...values, assigneeId: event.target.value })
          }
        >
          <option value="">全部负责人</option>
          <option value="unassigned">未指派</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.displayName}
            </option>
          ))}
        </select>
      </div>
      <div className="task-filter-field">
        <label htmlFor="task-filter-priority">筛选优先级</label>
        <select
          id="task-filter-priority"
          value={values.priority}
          onChange={(event) =>
            onChange({
              ...values,
              priority: event.target.value as TaskFilterValues['priority'],
            })
          }
        >
          <option value="">全部优先级</option>
          <option value="low">低优先级</option>
          <option value="medium">中优先级</option>
          <option value="high">高优先级</option>
        </select>
      </div>
      <div className="task-filter-field">
        <label htmlFor="task-filter-due">截止状态</label>
        <select
          id="task-filter-due"
          value={values.due}
          onChange={(event) =>
            onChange({
              ...values,
              due: event.target.value as TaskFilterValues['due'],
            })
          }
        >
          <option value="">全部截止状态</option>
          <option value="unset">未设置截止日期</option>
          <option value="normal">正常</option>
          <option value="due_soon">三天内到期</option>
          <option value="overdue">已逾期</option>
        </select>
      </div>
    </section>
  );
}
