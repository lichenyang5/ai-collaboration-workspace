export interface TeamSummary {
  id: string;
  name: string;
  role: 'owner' | 'member';
}

export interface TeamMemberSummary {
  id: string;
  displayName: string;
  email: string;
  role: 'owner' | 'member';
}

export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
}

export type TaskStatus = 'todo' | 'in_progress' | 'done';

export type TaskPriority = 'low' | 'medium' | 'high';

export type TaskDueFilter = 'unset' | 'normal' | 'due_soon' | 'overdue';

export type TaskBoardView = 'active' | 'archived';

export interface TaskFilterValues {
  q: string;
  assigneeId: string;
  priority: '' | TaskPriority;
  due: '' | TaskDueFilter;
  view: TaskBoardView;
}

export interface AiTaskDraft {
  title: string;
  description: string;
  priority: TaskPriority;
}

export interface TaskSummary {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  archivedAt: string | null;
  createdAt: string;
  assignee: {
    id: string;
    displayName: string;
    email: string;
  } | null;
}

export interface TaskBoardResponse {
  projectId: string;
  projectName: string;
  teamId: string;
  columns: Record<TaskStatus, TaskSummary[]>;
}

export interface TaskActivitySummary {
  id: string;
  eventType:
    | 'created'
    | 'updated'
    | 'status_changed'
    | 'assignee_changed'
    | 'archived'
    | 'restored'
    | string;
  details: Record<string, unknown>;
  createdAt: string;
  task: { id: string; title: string };
  actor: { id: string; displayName: string; email: string };
}
