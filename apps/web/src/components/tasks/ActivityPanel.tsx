import type { TaskActivitySummary } from '../../types/workspace';

function formatActivity(activity: TaskActivitySummary): string {
  const actor = activity.actor.displayName;
  const title = activity.task.title;

  switch (activity.eventType) {
    case 'created':
      return `${actor} 创建了任务《${title}》`;
    case 'updated':
      return `${actor} 更新了任务《${title}》`;
    case 'status_changed':
      return `${actor} 更新了任务《${title}》的状态`;
    case 'assignee_changed':
      return `${actor} 更新了任务《${title}》的负责人`;
    case 'archived':
      return `${actor} 归档了任务《${title}》`;
    case 'restored':
      return `${actor} 恢复了任务《${title}》`;
    default:
      return `更新了任务《${title}》`;
  }
}

export interface ActivityPanelProps {
  activities: TaskActivitySummary[];
  isLoading: boolean;
  error: string;
  onRetry(): void;
}

export function ActivityPanel({
  activities,
  isLoading,
  error,
  onRetry,
}: ActivityPanelProps) {
  return (
    <section className="activity-panel" aria-labelledby="activity-panel-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">活动</p>
          <h3 id="activity-panel-title">任务活动</h3>
        </div>
      </div>
      {error ? (
        <div className="activity-panel-error" role="alert">
          <p>{error}</p>
          <button type="button" className="task-secondary-button" onClick={onRetry}>
            重新加载活动
          </button>
        </div>
      ) : null}
      {isLoading && activities.length === 0 ? (
        <p className="activity-panel-state">正在加载活动…</p>
      ) : null}
      {!isLoading && activities.length === 0 && !error ? (
        <p className="activity-panel-state">暂无活动记录</p>
      ) : null}
      {activities.length > 0 ? (
        <ol className="activity-list">
          {activities.map((activity) => (
            <li key={activity.id}>
              <p>{formatActivity(activity)}</p>
              <time dateTime={activity.createdAt}>
                {new Date(activity.createdAt).toLocaleString('zh-CN')}
              </time>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
