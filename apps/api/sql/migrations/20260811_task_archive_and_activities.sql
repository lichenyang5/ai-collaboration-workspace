ALTER TABLE tasks ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS task_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  event_type VARCHAR(32) NOT NULL CHECK (event_type IN (
    'created', 'updated', 'status_changed', 'assignee_changed', 'archived', 'restored'
  )),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tasks_project_archived_status_index
  ON tasks (project_id, archived_at, status, created_at DESC);
CREATE INDEX IF NOT EXISTS task_activities_task_created_index
  ON task_activities (task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS task_activities_created_index
  ON task_activities (created_at DESC);
