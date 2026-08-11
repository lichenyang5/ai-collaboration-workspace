import type { TaskBoardView } from '../../types/workspace';

export interface TaskArchivePanelProps {
  view: TaskBoardView;
  onViewChange(view: TaskBoardView): void;
}

export function TaskArchivePanel({
  view,
  onViewChange,
}: TaskArchivePanelProps) {
  const isArchivedView = view === 'archived';

  return (
    <section className="task-archive-panel" aria-label="任务归档">
      <div>
        <p className="eyebrow">归档</p>
        <h3>{isArchivedView ? '已归档任务' : '进行中的任务'}</h3>
      </div>
      <button
        type="button"
        className="task-secondary-button"
        onClick={() => onViewChange(isArchivedView ? 'active' : 'archived')}
      >
        {isArchivedView ? '查看进行中的任务' : '查看已归档任务'}
      </button>
    </section>
  );
}
