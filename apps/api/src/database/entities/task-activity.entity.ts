import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Task } from './task.entity';
import { User } from './user.entity';

export enum TaskActivityEventType {
  Created = 'created',
  Updated = 'updated',
  StatusChanged = 'status_changed',
  AssigneeChanged = 'assignee_changed',
  Archived = 'archived',
  Restored = 'restored',
}

@Entity({ name: 'task_activities' })
export class TaskActivity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Task, (task) => task.activities, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'task_id' })
  task!: Task;

  @ManyToOne(() => User, (user) => user.taskActivities, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'actor_id' })
  actor!: User;

  @Column({ name: 'event_type', type: 'varchar', length: 32 })
  eventType!: TaskActivityEventType;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  details!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
