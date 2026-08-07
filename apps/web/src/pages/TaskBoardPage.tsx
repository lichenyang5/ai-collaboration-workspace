import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiRequest } from '../services/api';
import type { TaskBoardResponse, TaskPriority, TaskStatus, TaskSummary } from '../types/workspace';

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
  const [isCreating, setIsCreating] = useState(false);
  const [movingTaskId, setMovingTaskId] = useState<string | null>(null);

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

  return (
    <main className="workspace-shell">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">项目工作区</p>
          <h1>项目任务看板</h1>
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
          <label htmlFor="task-title">任务标题</label>
          <input
            id="task-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
            placeholder="例如：梳理项目接口"
            aria-required="true"
          />
          <label htmlFor="task-description">任务说明</label>
          <textarea
            id="task-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={5000}
            placeholder="可选：补充交付说明"
          />
          <label htmlFor="task-priority">优先级</label>
          <select
            id="task-priority"
            value={priority}
            onChange={(event) => setPriority(event.target.value as TaskPriority)}
          >
            <option value="low">低优先级</option>
            <option value="medium">中优先级</option>
            <option value="high">高优先级</option>
          </select>
          <button type="submit" disabled={isCreating || !projectId}>
            {isCreating ? '创建中…' : '创建任务'}
          </button>
        </form>
        {errorMessage ? <p className="form-error" role="alert">{errorMessage}</p> : null}
        {isLoading ? <p className="workspace-state">正在加载任务看板…</p> : null}
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
                          <button
                            type="button"
                            disabled={isMoving}
                            onClick={() => void handleMoveTask(task)}
                            aria-label={`移动“${task.title}”到${getStatusLabel(nextStatus)}`}
                          >
                            {isMoving ? '移动中…' : `移动到${getStatusLabel(nextStatus)}`}
                          </button>
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
