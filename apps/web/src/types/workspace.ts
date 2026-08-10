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

export interface TaskSummary {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
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
