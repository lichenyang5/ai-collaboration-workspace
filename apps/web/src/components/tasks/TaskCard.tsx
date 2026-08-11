import type { TaskPriority, TaskStatus, TaskSummary } from '../../types/workspace';

const priorityLabels: Record<TaskPriority, string> = {
  low: '低优先级',
  medium: '中优先级',
  high: '高优先级',
};

const statusLabels: Record<TaskStatus, string> = {
  todo: '待办',
  in_progress: '进行中',
  done: '已完成',
};

function getNextStatus(status: TaskStatus): TaskStatus {
  if (status === 'todo') {
    return 'in_progress';
  }

  if (status === 'in_progress') {
    return 'done';
  }

  return 'todo';
}

function dueLabelClassName(dueLabel: string): string {
  if (dueLabel === '已逾期') {
    return 'task-due-label task-due-label-overdue';
  }

  if (dueLabel === '三天内到期') {
    return 'task-due-label task-due-label-soon';
  }

  return 'task-due-label task-due-label-today';
}

export interface TaskCardProps {
  task: TaskSummary;
  isMoving: boolean;
  dueLabel: string | null;
  onEdit(task: TaskSummary): void;
  onMove(task: TaskSummary): void;
}

export function TaskCard({
  task,
  isMoving,
  dueLabel,
  onEdit,
  onMove,
}: TaskCardProps) {
  const nextStatus = getNextStatus(task.status);

  return (
    <article className="task-card">
      <div className="task-card-main">
        <div className="task-card-heading">
          <h4>{task.title}</h4>
          <span className={`task-priority task-priority-${task.priority}`}>
            {priorityLabels[task.priority]}
          </span>
        </div>
        {task.description ? <p>{task.description}</p> : null}
      </div>
      <div className="task-card-meta">
        <p className="task-assignee">负责人：{task.assignee?.displayName ?? '未指派'}</p>
        {task.dueDate ? <p>截止日期：{task.dueDate.slice(0, 10)}</p> : null}
        {dueLabel ? <span className={dueLabelClassName(dueLabel)}>{dueLabel}</span> : null}
      </div>
      <div className="task-card-actions">
        <button
          type="button"
          className="task-secondary-button"
          disabled={isMoving}
          onClick={() => onEdit(task)}
          aria-label={`编辑详情：${task.title}`}
        >
          编辑详情
        </button>
        <button
          type="button"
          disabled={isMoving}
          onClick={() => onMove(task)}
          aria-label={`移动“${task.title}”到${statusLabels[nextStatus]}`}
        >
          {isMoving ? '移动中…' : `移动到${statusLabels[nextStatus]}`}
        </button>
      </div>
    </article>
  );
}
