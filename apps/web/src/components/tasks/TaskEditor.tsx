import type {
  TaskPriority,
  TaskSummary,
  TeamMemberSummary,
} from '../../types/workspace';

export interface UpdateTaskInput {
  title: string;
  description: string;
  priority: TaskPriority;
  assigneeId: string | null;
  dueDate: string | null;
}

export interface TaskEditorProps {
  task: TaskSummary;
  value: UpdateTaskInput;
  members: TeamMemberSummary[];
  isLoadingMembers: boolean;
  membersError: string;
  isSaving: boolean;
  error: string;
  onChange(next: UpdateTaskInput): void;
  onSubmit(): void;
  onCancel(): void;
}

export function TaskEditor({
  task,
  value,
  members,
  isLoadingMembers,
  membersError,
  isSaving,
  error,
  onChange,
  onSubmit,
  onCancel,
}: TaskEditorProps) {
  return (
    <section className="task-detail-panel" aria-labelledby="task-detail-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">任务详情</p>
          <h3 id="task-detail-title">编辑“{task.title}”</h3>
        </div>
      </div>
      <form
        className="task-detail-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="task-field task-field-wide">
          <label htmlFor="edit-task-title">编辑任务标题</label>
          <input
            id="edit-task-title"
            value={value.title}
            maxLength={200}
            onChange={(event) => onChange({ ...value, title: event.target.value })}
            aria-required="true"
          />
        </div>
        <div className="task-field">
          <label htmlFor="edit-task-description">编辑任务说明</label>
          <textarea
            id="edit-task-description"
            value={value.description}
            maxLength={5000}
            onChange={(event) =>
              onChange({ ...value, description: event.target.value })
            }
          />
        </div>
        <div className="task-field">
          <label htmlFor="edit-task-priority">编辑优先级</label>
          <select
            id="edit-task-priority"
            value={value.priority}
            onChange={(event) =>
              onChange({
                ...value,
                priority: event.target.value as TaskPriority,
              })
            }
          >
            <option value="low">低优先级</option>
            <option value="medium">中优先级</option>
            <option value="high">高优先级</option>
          </select>
        </div>
        <div className="task-field">
          <label htmlFor="edit-task-assignee">编辑负责人</label>
          <select
            id="edit-task-assignee"
            value={value.assigneeId ?? ''}
            disabled={isLoadingMembers || Boolean(membersError)}
            onChange={(event) =>
              onChange({ ...value, assigneeId: event.target.value || null })
            }
          >
            <option value="">未指派</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.displayName}
              </option>
            ))}
          </select>
        </div>
        <div className="task-field">
          <label htmlFor="edit-task-due-date">截止日期</label>
          <input
            id="edit-task-due-date"
            type="date"
            value={value.dueDate ?? ''}
            onChange={(event) =>
              onChange({ ...value, dueDate: event.target.value || null })
            }
          />
        </div>
        {error ? (
          <p className="form-error task-detail-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="task-detail-actions">
          <button type="submit" disabled={isSaving}>
            {isSaving ? '保存中…' : '保存修改'}
          </button>
          <button
            type="button"
            className="task-secondary-button"
            disabled={isSaving}
            onClick={onCancel}
          >
            取消编辑
          </button>
        </div>
      </form>
    </section>
  );
}
