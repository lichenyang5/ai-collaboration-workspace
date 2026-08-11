import { getMetadataArgsStorage } from 'typeorm';
import { Project } from './project.entity';
import { Task } from './task.entity';
import { TaskActivity } from './task-activity.entity';
import { TeamMember } from './team-member.entity';
import { Team } from './team.entity';
import { User } from './user.entity';

function columnName(target: Function, propertyName: string): string | undefined {
  return getMetadataArgsStorage().columns.find(
    (column) => column.target === target && column.propertyName === propertyName,
  )?.options.name as string | undefined;
}

function joinColumnName(target: Function, propertyName: string): string | undefined {
  return getMetadataArgsStorage().joinColumns.find(
    (column) => column.target === target && column.propertyName === propertyName,
  )?.name;
}

describe('PostgreSQL schema mappings', () => {
  it('maps camelCase properties to the existing snake_case schema', () => {
    expect(columnName(User, 'displayName')).toBe('display_name');
    expect(joinColumnName(Team, 'createdBy')).toBe('created_by_id');
    expect(joinColumnName(TeamMember, 'team')).toBe('team_id');
    expect(joinColumnName(TeamMember, 'user')).toBe('user_id');
    expect(joinColumnName(Project, 'team')).toBe('team_id');
    expect(joinColumnName(Task, 'project')).toBe('project_id');
    expect(joinColumnName(Task, 'assignee')).toBe('assignee_id');
    expect(columnName(Task, 'archivedAt')).toBe('archived_at');
    expect(joinColumnName(TaskActivity, 'task')).toBe('task_id');
    expect(joinColumnName(TaskActivity, 'actor')).toBe('actor_id');
    expect(columnName(TaskActivity, 'eventType')).toBe('event_type');
  });
});
