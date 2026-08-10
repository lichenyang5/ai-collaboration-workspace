import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiRequest } from '../services/api';
import type {
  TaskBoardResponse,
  TaskPriority,
  TaskStatus,
  TaskSummary,
  TeamMemberSummary,
} from '../types/workspace';

const columnDefinitions: ReadonlyArray<{ status: TaskStatus; title: string }> = [
  { status: 'todo', title: '待办' },
  { status: 'in_progress', title: '进行中' },
  { status: 'done', title: '已完成' },
];

const priorityLabels: Record<TaskPriority, string> = {
  low: '低优先级',
  medium: '中优先级',
  high: '高优先级',
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

function getStatusLabel(status: TaskStatus): string {
  return columnDefinitions.find((column) => column.status === status)?.title ?? status;
}

export function TaskBoardPage() {
  const { projectId } = useParams();
  const [board, setBoard] = useState<TaskBoardResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [assigneeId, setAssigneeId] = useState('');
  const [members, setMembers] = useState<TeamMemberSummary[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [membersError, setMembersError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [movingTaskId, setMovingTaskId] = useState<string | null>(null);
  const [editingTask, setEditingTask] = useState<TaskSummary | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPriority, setEditPriority] = useState<TaskPriority>('medium');
  const [editAssigneeId, setEditAssigneeId] = useState('');
  const [editDueDate, setEditDueDate] = useState('');
  const [taskEditError, setTaskEditError] = useState('');
  const [isSavingTask, setIsSavingTask] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setErrorMessage('未找到项目标识');
      setIsLoading(false);
      return;
    }

    let isActive = true;

    async function loadBoard() {
      try {
        const result = await apiRequest<TaskBoardResponse>(`api/projects/${projectId}/tasks`);
        if (isActive) {
          setBoard(result);
        }
      } catch (error: unknown) {
        if (isActive) {
          setErrorMessage(error instanceof Error ? error.message : '任务看板加载失败，请稍后重试');
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void loadBoard();
    return () => {
      isActive = false;
    };
  }, [projectId]);

  const teamId = board?.teamId;

  useEffect(() => {
    if (!teamId) {
      setMembers([]);
      setAssigneeId('');
      return;
    }

    let isActive = true;
    setIsLoadingMembers(true);
    setMembersError('');

    async function loadTeamMembers() {
      try {
        const result = await apiRequest<TeamMemberSummary[]>(`api/teams/${teamId}/members`);
        if (!Array.isArray(result)) {
          throw new Error('负责人列表响应格式无效');
        }
        if (isActive) {
          setMembers(result);
        }
      } catch (error: unknown) {
        if (isActive) {
          setMembers([]);
          setAssigneeId('');
          setMembersError(error instanceof Error ? error.message : '负责人列表加载失败');
        }
      } finally {
        if (isActive) {
          setIsLoadingMembers(false);
        }
      }
    }

    void loadTeamMembers();
    return () => {
      isActive = false;
    };
  }, [teamId]);

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId || isCreating) {
      return;
    }

    const taskTitle = title.trim();
    if (taskTitle.length < 2) {
      setErrorMessage('任务标题至少需要 2 个字符');
      return;
    }

    setErrorMessage('');
    setIsCreating(true);
    try {
      const createdTask = await apiRequest<TaskSummary>(`api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: taskTitle,
          description: description.trim(),
          priority,
          ...(assigneeId ? { assigneeId } : {}),
        }),
      });
      setBoard((currentBoard) => currentBoard
        ? {
            ...currentBoard,
            columns: {
              ...currentBoard.columns,
              todo: [...currentBoard.columns.todo, createdTask],
            },
          }
        : currentBoard);
      setTitle('');
      setDescription('');
      setPriority('medium');
      setAssigneeId('');
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : '任务创建失败，请稍后重试');
    } finally {
      setIsCreating(false);
    }
  }

  async function handleMoveTask(task: TaskSummary) {
    if (movingTaskId === task.id) {
      return;
    }

    const fromStatus = task.status;
    const toStatus = getNextStatus(fromStatus);
    setErrorMessage('');
    setMovingTaskId(task.id);
    try {
      const updatedTask = await apiRequest<TaskSummary>(`api/tasks/${task.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: toStatus }),
      });
      setBoard((currentBoard) => currentBoard
        ? {
            ...currentBoard,
            columns: {
              ...currentBoard.columns,
              [fromStatus]: currentBoard.columns[fromStatus].filter((item) => item.id !== task.id),
              [toStatus]: [...currentBoard.columns[toStatus], updatedTask],
            },
          }
        : currentBoard);
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : '任务状态更新失败，请稍后重试');
    } finally {
      setMovingTaskId(null);
    }
  }

  function openTaskEditor(task: TaskSummary) {
    setEditingTask(task);
    setEditTitle(task.title);
    setEditDescription(task.description);
    setEditPriority(task.priority);
    setEditAssigneeId(task.assignee?.id ?? '');
    setEditDueDate(task.dueDate?.slice(0, 10) ?? '');
    setTaskEditError('');
  }

  function closeTaskEditor() {
    if (isSavingTask) {
      return;
    }

    setEditingTask(null);
    setTaskEditError('');
  }

  function replaceTask(updatedTask: TaskSummary) {
    setBoard((currentBoard) => currentBoard
      ? {
          ...currentBoard,
          columns: {
            todo: currentBoard.columns.todo.map((task) => task.id === updatedTask.id ? updatedTask : task),
            in_progress: currentBoard.columns.in_progress.map((task) => task.id === updatedTask.id ? updatedTask : task),
            done: currentBoard.columns.done.map((task) => task.id === updatedTask.id ? updatedTask : task),
          },
        }
      : currentBoard);
  }

  async function handleUpdateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingTask || isSavingTask) {
      return;
    }

    const nextTitle = editTitle.trim();
    if (nextTitle.length < 2) {
      setTaskEditError('任务标题至少需要 2 个字符');
      return;
    }

    setTaskEditError('');
    setIsSavingTask(true);
    try {
      const updatedTask = await apiRequest<TaskSummary>(`api/tasks/${editingTask.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: nextTitle,
          description: editDescription.trim(),
          priority: editPriority,
          assigneeId: editAssigneeId || null,
          dueDate: editDueDate || null,
        }),
      });
      replaceTask(updatedTask);
      setEditingTask(null);
    } catch (error: unknown) {
      setTaskEditError(error instanceof Error ? error.message : '任务详情保存失败，请稍后重试');
    } finally {
      setIsSavingTask(false);
    }
  }

  return (
    <main className="workspace-shell">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">项目工作区</p>
          <h1>{board?.projectName ?? '项目任务看板'}</h1>
        </div>
        <Link className="back-link" to="/workspace">返回工作区</Link>
      </header>
      <section className="workspace-content" aria-labelledby="task-board-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">任务</p>
            <h2 id="task-board-title">协作任务</h2>
          </div>
        </div>
        <form className="task-create-form" noValidate onSubmit={handleCreateTask}>
          <div className="task-field task-field-wide" role="group" aria-labelledby="task-title-label">
            <label id="task-title-label" htmlFor="task-title">任务标题</label>
            <input
              id="task-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
              placeholder="例如：梳理项目接口"
              aria-required="true"
            />
          </div>
          <div className="task-field" role="group" aria-labelledby="task-description-label">
            <label id="task-description-label" htmlFor="task-description">任务说明</label>
            <textarea
              id="task-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={5000}
              placeholder="可选：补充交付说明"
            />
          </div>
          <div className="task-field" role="group" aria-labelledby="task-priority-label">
            <label id="task-priority-label" htmlFor="task-priority">优先级</label>
            <select
              id="task-priority"
              value={priority}
              onChange={(event) => setPriority(event.target.value as TaskPriority)}
            >
              <option value="low">低优先级</option>
              <option value="medium">中优先级</option>
              <option value="high">高优先级</option>
            </select>
          </div>
          <div className="task-field" role="group" aria-labelledby="task-assignee-label">
            <label id="task-assignee-label" htmlFor="task-assignee">负责人</label>
            <select
              id="task-assignee"
              value={assigneeId}
              disabled={isLoadingMembers || Boolean(membersError)}
              onChange={(event) => setAssigneeId(event.target.value)}
            >
              <option value="">未指派</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" disabled={isCreating || !projectId}>
            {isCreating ? '创建中…' : '创建任务'}
          </button>
        </form>
        {membersError ? <p className="form-error">负责人列表加载失败，仍可创建未指派任务。</p> : null}
        {errorMessage ? <p className="form-error" role="alert">{errorMessage}</p> : null}
        {isLoading ? <p className="workspace-state">正在加载任务看板…</p> : null}
        {editingTask ? (
          <section className="task-detail-panel" aria-labelledby="task-detail-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">任务详情</p>
                <h3 id="task-detail-title">编辑“{editingTask.title}”</h3>
              </div>
            </div>
            <form className="task-detail-form" noValidate onSubmit={handleUpdateTask}>
              <div className="task-field task-field-wide">
                <label htmlFor="edit-task-title">编辑任务标题</label>
                <input
                  id="edit-task-title"
                  value={editTitle}
                  maxLength={200}
                  onChange={(event) => setEditTitle(event.target.value)}
                  aria-required="true"
                />
              </div>
              <div className="task-field">
                <label htmlFor="edit-task-description">编辑任务说明</label>
                <textarea
                  id="edit-task-description"
                  value={editDescription}
                  maxLength={5000}
                  onChange={(event) => setEditDescription(event.target.value)}
                />
              </div>
              <div className="task-field">
                <label htmlFor="edit-task-priority">编辑优先级</label>
                <select
                  id="edit-task-priority"
                  value={editPriority}
                  onChange={(event) => setEditPriority(event.target.value as TaskPriority)}
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
                  value={editAssigneeId}
                  disabled={isLoadingMembers || Boolean(membersError)}
                  onChange={(event) => setEditAssigneeId(event.target.value)}
                >
                  <option value="">未指派</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>{member.displayName}</option>
                  ))}
                </select>
              </div>
              <div className="task-field">
                <label htmlFor="edit-task-due-date">截止日期</label>
                <input
                  id="edit-task-due-date"
                  type="date"
                  value={editDueDate}
                  onChange={(event) => setEditDueDate(event.target.value)}
                />
              </div>
              {taskEditError ? <p className="form-error task-detail-error" role="alert">{taskEditError}</p> : null}
              <div className="task-detail-actions">
                <button type="submit" disabled={isSavingTask}>{isSavingTask ? '保存中…' : '保存修改'}</button>
                <button type="button" className="task-secondary-button" disabled={isSavingTask} onClick={closeTaskEditor}>
                  取消编辑
                </button>
              </div>
            </form>
          </section>
        ) : null}
        {board ? (
          <div className="task-board">
            {columnDefinitions.map((column) => (
              <section key={column.status} className="task-column" aria-label={column.title}>
                <h3>{column.title}</h3>
                {board.columns[column.status].length === 0 ? (
                  <p className="task-column-empty">暂时没有任务</p>
                ) : (
                  <ul className="task-list">
                    {board.columns[column.status].map((task) => {
                      const nextStatus = getNextStatus(task.status);
                      const isMoving = movingTaskId === task.id;

                      return (
                        <li key={task.id} className="task-card">
                          <div className="task-card-heading">
                            <h4>{task.title}</h4>
                            <span className={`task-priority task-priority-${task.priority}`}>
                              {priorityLabels[task.priority]}
                            </span>
                          </div>
                          {task.description ? <p>{task.description}</p> : null}
                          <p className="task-assignee">
                            负责人：{task.assignee?.displayName ?? '未指派'}
                          </p>
                          {task.dueDate ? <p>截止日期：{task.dueDate.slice(0, 10)}</p> : null}
                          <div className="task-card-actions">
                            <button
                              type="button"
                              className="task-secondary-button"
                              disabled={isMoving || isSavingTask}
                              onClick={() => openTaskEditor(task)}
                              aria-label={`编辑详情：${task.title}`}
                            >
                              编辑详情
                            </button>
                            <button
                              type="button"
                              disabled={isMoving || isSavingTask}
                              onClick={() => void handleMoveTask(task)}
                              aria-label={`移动“${task.title}”到${getStatusLabel(nextStatus)}`}
                            >
                              {isMoving ? '移动中…' : `移动到${getStatusLabel(nextStatus)}`}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}
