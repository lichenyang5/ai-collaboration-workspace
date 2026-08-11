import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Task } from './task.entity';
import { TaskActivity } from './task-activity.entity';
import { TeamMember } from './team-member.entity';
import { Team } from './team.entity';

@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 255, unique: true })
  email!: string;

  @Column({ name: 'display_name', length: 100 })
  displayName!: string;

  @Column({ name: 'password_hash', select: false })
  passwordHash!: string;

  @OneToMany(() => Team, (team) => team.createdBy)
  createdTeams!: Team[];

  @OneToMany(() => TeamMember, (member) => member.user)
  teamMemberships!: TeamMember[];

  @OneToMany(() => Task, (task) => task.assignee)
  assignedTasks!: Task[];

  @OneToMany(() => TaskActivity, (activity) => activity.actor)
  taskActivities!: TaskActivity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
