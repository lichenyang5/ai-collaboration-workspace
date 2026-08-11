import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { AiTaskPlanner } from '../components/tasks/AiTaskPlanner';
import { TaskCard } from '../components/tasks/TaskCard';
import { TaskEditor } from '../components/tasks/TaskEditor';
import type { UpdateTaskInput } from '../components/tasks/TaskEditor';
import { TaskFilters } from '../components/tasks/TaskFilters';
import { getTaskDueLabel } from '../components/tasks/task-due-state';
import { apiRequest } from '../services/api';
import type {
  AiTaskDraft,
  TaskBoardResponse,
  TaskBoardView,
  TaskDueFilter,
  TaskFilterValues,
  TaskPriority,
  TaskStatus,
  TaskSummary,
  TeamMemberSummary,
} from '../types/workspace';

const columnDefinitions: ReadonlyArray<{ status: TaskStatus; title: string }> =
  [
    { status: 'todo', title: '待办' },
    { status: 'in_progress', title: '进行中' },
    { status: 'done', title: '已完成' },
  ];

const priorityValues = new Set<TaskPriority>(['low', 'medium', 'high']);
const dueValues = new Set<TaskDueFilter>([
  'unset',
  'normal',
  'due_soon',
  'overdue',
]);
const viewValues = new Set<TaskBoardView>(['active', 'archived']);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getNextStatus(status: TaskStatus): TaskStatus {
  if (status === 'todo') {
    return 'in_progress';
  }

  if (status === 'in_progress') {
    return 'done';
  }

  return 'todo';
}

function normalizeFilterValues(searchParams: URLSearchParams): TaskFilterValues {
  const priority = searchParams.get('priority') ?? '';
  const due = searchParams.get('due') ?? '';
  const view = searchParams.get('view') ?? 'active';
  const assigneeId = searchParams.get('assigneeId')?.trim() ?? '';

  return {
    q: (searchParams.get('q') ?? '').trim().slice(0, 200),
    assigneeId:
      assigneeId === 'unassigned' || uuidPattern.test(assigneeId)
        ? assigneeId
        : '',
    priority: priorityValues.has(priority as TaskPriority)
      ? (priority as TaskPriority)
      : '',
    due: dueValues.has(due as TaskDueFilter) ? (due as TaskDueFilter) : '',
    view: viewValues.has(view as TaskBoardView)
      ? (view as TaskBoardView)
      : 'active',
  };
}

function toSearchParams(values: TaskFilterValues): URLSearchParams {
  const next = new URLSearchParams();
  if (values.q) {
    next.set('q', values.q);
  }
  if (values.assigneeId) {
    next.set('assigneeId', values.assigneeId);
  }
  if (values.priority) {
    next.set('priority', values.priority);
  }
  if (values.due) {
    next.set('due', values.due);
  }
  if (values.view !== 'active') {
    next.set('view', values.view);
  }
  return next;
}

function toBoardQuery(values: TaskFilterValues): string {
  return toSearchParams(values).toString();
}

export function TaskBoardPage() {
  const { projectId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(
    () => normalizeFilterValues(searchParams),
    [searchParams],
  );
  const normalizedSearchParams = useMemo(() => toSearchParams(filters), [filters]);
  const [debouncedQuery, setDebouncedQuery] = useState(() => filters.q);
  const boardMutationGeneration = useRef(0);
  const [board, setBoard] = useState<TaskBoardResponse | null>(null);
  const [lastSuccessfulBoard, setLastSuccessfulBoard] =
    useState<TaskBoardResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [boardError, setBoardError] = useState('');
  const [boardRequestGeneration, setBoardRequestGeneration] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [assigneeId, setAssigneeId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [members, setMembers] = useState<TeamMemberSummary[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [membersError, setMembersError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [movingTaskId, setMovingTaskId] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<TaskStatus>('todo');
  const [editingTask, setEditingTask] = useState<TaskSummary | null>(null);
  const [editInput, setEditInput] = useState<UpdateTaskInput>({
    title: '',
    description: '',
    priority: 'medium',
    assigneeId: null,
    dueDate: null,
  });
  const [taskEditError, setTaskEditError] = useState('');
  const [isSavingTask, setIsSavingTask] = useState(false);
  const [aiGoal, setAiGoal] = useState('');
  const [aiDrafts, setAiDrafts] = useState<AiTaskDraft[]>([]);
  const [aiError, setAiError] = useState('');
  const [isGeneratingAiDrafts, setIsGeneratingAiDrafts] = useState(false);
  const [isConfirmingAiDrafts, setIsConfirmingAiDrafts] = useState(false);

  useEffect(() => {
    if (searchParams.toString() !== normalizedSearchParams.toString()) {
      setSearchParams(normalizedSearchParams, { replace: true });
    }
  }, [normalizedSearchParams, searchParams, setSearchParams]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(filters.q);
    }, 250);

    return () => window.clearTimeout(timer);
  }, [filters.q]);

  const boardFilters = useMemo(
    () => ({ ...filters, q: debouncedQuery }),
    [debouncedQuery, filters],
  );
  const boardQuery = useMemo(
    () => toBoardQuery(boardFilters),
    [boardFilters],
  );
  const isKeywordDebouncing = filters.q !== debouncedQuery;

  useEffect(() => {
    if (!projectId) {
      setBoardError('未找到项目标识');
      setIsLoading(false);
      return;
    }

    if (isKeywordDebouncing) {
      return;
    }

    let isActive = true;
    const requestMutationGeneration = boardMutationGeneration.current;
    setIsLoading(true);
    setBoardError('');

    async function loadBoard() {
      try {
        const result = await apiRequest<TaskBoardResponse>(
          `api/projects/${projectId}/tasks${boardQuery ? `?${boardQuery}` : ''}`,
        );
        if (
          isActive &&
          requestMutationGeneration === boardMutationGeneration.current
        ) {
          setBoard(result);
          setLastSuccessfulBoard(result);
        }
      } catch (error: unknown) {
        if (
          isActive &&
          requestMutationGeneration === boardMutationGeneration.current
        ) {
          setBoardError(
            error instanceof Error
              ? error.message
              : '任务看板加载失败，请稍后重试',
          );
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
  }, [
    boardQuery,
    boardRequestGeneration,
    isKeywordDebouncing,
    projectId,
  ]);

  const visibleBoard = board ?? lastSuccessfulBoard;
  const teamId = visibleBoard?.teamId;

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
        const result = await apiRequest<TeamMemberSummary[]>(
          `api/teams/${teamId}/members`,
        );
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
          setMembersError(
            error instanceof Error ? error.message : '负责人列表加载失败',
          );
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

  function handleFiltersChange(next: TaskFilterValues) {
    setSearchParams(toSearchParams(next));
  }

  function retryBoard() {
    setBoardRequestGeneration((generation) => generation + 1);
  }

  function invalidateBoardLoadsBeforeMutation() {
    boardMutationGeneration.current += 1;
  }

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
      const createdTask = await apiRequest<TaskSummary>(
        `api/projects/${projectId}/tasks`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: taskTitle,
            description: description.trim(),
            priority,
            ...(assigneeId ? { assigneeId } : {}),
            ...(dueDate ? { dueDate } : {}),
          }),
        },
      );
      setBoard((currentBoard) =>
        currentBoard
          ? {
              ...currentBoard,
              columns: {
                ...currentBoard.columns,
                todo: [...currentBoard.columns.todo, createdTask],
              },
            }
          : currentBoard,
      );
      setLastSuccessfulBoard((currentBoard) =>
        currentBoard
          ? {
              ...currentBoard,
              columns: {
                ...currentBoard.columns,
                todo: [...currentBoard.columns.todo, createdTask],
              },
            }
          : currentBoard,
      );
      invalidateBoardLoadsBeforeMutation();
      setTitle('');
      setDescription('');
      setPriority('medium');
      setAssigneeId('');
      setDueDate('');
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof Error ? error.message : '任务创建失败，请稍后重试',
      );
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
      const updatedTask = await apiRequest<TaskSummary>(
        `api/tasks/${task.id}/status`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: toStatus }),
        },
      );
      moveTaskInBoards(task.id, fromStatus, toStatus, updatedTask);
      invalidateBoardLoadsBeforeMutation();
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof Error ? error.message : '任务状态更新失败，请稍后重试',
      );
    } finally {
      setMovingTaskId(null);
    }
  }

  function moveTaskInBoards(
    taskId: string,
    fromStatus: TaskStatus,
    toStatus: TaskStatus,
    updatedTask: TaskSummary,
  ) {
    const moveTask = (currentBoard: TaskBoardResponse | null) =>
      currentBoard
        ? {
            ...currentBoard,
            columns: {
              ...currentBoard.columns,
              [fromStatus]: currentBoard.columns[fromStatus].filter(
                (item) => item.id !== taskId,
              ),
              [toStatus]: [...currentBoard.columns[toStatus], updatedTask],
            },
          }
        : currentBoard;
    setBoard(moveTask);
    setLastSuccessfulBoard(moveTask);
  }

  function openTaskEditor(task: TaskSummary) {
    setEditingTask(task);
    setEditInput({
      title: task.title,
      description: task.description,
      priority: task.priority,
      assigneeId: task.assignee?.id ?? null,
      dueDate: task.dueDate?.slice(0, 10) ?? null,
    });
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
    const replace = (currentBoard: TaskBoardResponse | null) =>
      currentBoard
        ? {
            ...currentBoard,
            columns: {
              todo: currentBoard.columns.todo.map((task) =>
                task.id === updatedTask.id ? updatedTask : task,
              ),
              in_progress: currentBoard.columns.in_progress.map((task) =>
                task.id === updatedTask.id ? updatedTask : task,
              ),
              done: currentBoard.columns.done.map((task) =>
                task.id === updatedTask.id ? updatedTask : task,
              ),
            },
          }
        : currentBoard;
    setBoard(replace);
    setLastSuccessfulBoard(replace);
  }

  async function handleUpdateTask() {
    if (!editingTask || isSavingTask) {
      return;
    }

    const nextTitle = editInput.title.trim();
    if (nextTitle.length < 2) {
      setTaskEditError('任务标题至少需要 2 个字符');
      return;
    }

    setTaskEditError('');
    setIsSavingTask(true);
    try {
      const updatedTask = await apiRequest<TaskSummary>(
        `api/tasks/${editingTask.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: nextTitle,
            description: editInput.description.trim(),
            priority: editInput.priority,
            assigneeId: editInput.assigneeId,
            dueDate: editInput.dueDate,
          }),
        },
      );
      replaceTask(updatedTask);
      invalidateBoardLoadsBeforeMutation();
      setEditingTask(null);
    } catch (error: unknown) {
      setTaskEditError(
        error instanceof Error ? error.message : '任务详情保存失败，请稍后重试',
      );
    } finally {
      setIsSavingTask(false);
    }
  }

  async function handleGenerateAiDrafts() {
    if (!projectId || isGeneratingAiDrafts) {
      return;
    }

    const goal = aiGoal.trim();
    if (goal.length < 10) {
      setAiError('项目目标至少需要 10 个字符');
      return;
    }

    setAiError('');
    setIsGeneratingAiDrafts(true);
    try {
      const drafts = await apiRequest<AiTaskDraft[]>(
        `api/projects/${projectId}/ai/task-drafts`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ goal }),
        },
      );
      setAiDrafts(drafts);
    } catch (error: unknown) {
      setAiError(
        error instanceof Error
          ? error.message
          : 'AI 任务草稿生成失败，请稍后重试',
      );
    } finally {
      setIsGeneratingAiDrafts(false);
    }
  }

  function updateAiDraft(index: number, draft: AiTaskDraft) {
    setAiDrafts((currentDrafts) =>
      currentDrafts.map((currentDraft, draftIndex) =>
        draftIndex === index ? draft : currentDraft,
      ),
    );
  }

  function removeAiDraft(index: number) {
    setAiDrafts((currentDrafts) =>
      currentDrafts.filter((_, draftIndex) => draftIndex !== index),
    );
  }

  async function handleConfirmAiDrafts() {
    if (!projectId || isConfirmingAiDrafts || aiDrafts.length === 0) {
      return;
    }

    const tasks = aiDrafts.map((draft) => ({
      title: draft.title.trim(),
      description: draft.description.trim(),
      priority: draft.priority,
    }));
    if (tasks.some((task) => task.title.length < 2)) {
      setAiError('每条任务草稿的标题至少需要 2 个字符');
      return;
    }

    setAiError('');
    setIsConfirmingAiDrafts(true);
    try {
      const createdTasks = await apiRequest<TaskSummary[]>(
        `api/projects/${projectId}/tasks/batch`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tasks }),
        },
      );
      const appendTasks = (currentBoard: TaskBoardResponse | null) =>
        currentBoard
          ? {
              ...currentBoard,
              columns: {
                ...currentBoard.columns,
                todo: [...currentBoard.columns.todo, ...createdTasks],
              },
            }
          : currentBoard;
      setBoard(appendTasks);
      setLastSuccessfulBoard(appendTasks);
      invalidateBoardLoadsBeforeMutation();
      setAiGoal('');
      setAiDrafts([]);
    } catch (error: unknown) {
      setAiError(
        error instanceof Error ? error.message : 'AI 任务创建失败，请稍后重试',
      );
    } finally {
      setIsConfirmingAiDrafts(false);
    }
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="workspace-shell">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">项目工作区</p>
          <h1>{visibleBoard?.projectName ?? '项目任务看板'}</h1>
        </div>
        <Link className="back-link" to="/workspace">
          返回工作区
        </Link>
      </header>
      <section className="workspace-content" aria-labelledby="task-board-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">任务</p>
            <h2 id="task-board-title">协作任务</h2>
          </div>
        </div>
        <TaskFilters
          values={filters}
          members={members}
          onChange={handleFiltersChange}
        />
        <form className="task-create-form" noValidate onSubmit={handleCreateTask}>
          <div className="task-field task-field-wide">
            <label htmlFor="task-title">
              任务标题
            </label>
            <input
              id="task-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
              placeholder="例如：梳理项目接口"
              aria-required="true"
            />
          </div>
          <div className="task-field">
            <label htmlFor="task-description">
              任务说明
            </label>
            <textarea
              id="task-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={5000}
              placeholder="可选：补充交付说明"
            />
          </div>
          <div className="task-field">
            <label htmlFor="task-priority">
              优先级
            </label>
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
          <div className="task-field">
            <label htmlFor="task-assignee">
              负责人
            </label>
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
          <div className="task-field">
            <label htmlFor="task-due-date">截止日期</label>
            <input
              id="task-due-date"
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </div>
          <button type="submit" disabled={isCreating || !projectId}>
            {isCreating ? '创建中…' : '创建任务'}
          </button>
        </form>
        <AiTaskPlanner
          goal={aiGoal}
          drafts={aiDrafts}
          isGenerating={isGeneratingAiDrafts}
          isConfirming={isConfirmingAiDrafts}
          error={aiError}
          onGoalChange={setAiGoal}
          onDraftChange={updateAiDraft}
          onDraftRemove={removeAiDraft}
          onGenerate={() => void handleGenerateAiDrafts()}
          onConfirm={() => void handleConfirmAiDrafts()}
        />
        {membersError ? (
          <p className="form-error">负责人列表加载失败，仍可创建未指派任务。</p>
        ) : null}
        {errorMessage ? (
          <p className="form-error" role="alert">
            {errorMessage}
          </p>
        ) : null}
        {boardError ? (
          <div className="task-board-error" role="alert">
            <p>{boardError}</p>
            {projectId ? (
              <button type="button" className="task-secondary-button" onClick={retryBoard}>
                重新加载
              </button>
            ) : null}
          </div>
        ) : null}
        {isLoading && !visibleBoard ? (
          <p className="workspace-state">正在加载任务看板…</p>
        ) : null}
        {editingTask ? (
          <TaskEditor
            task={editingTask}
            value={editInput}
            members={members}
            isLoadingMembers={isLoadingMembers}
            membersError={membersError}
            isSaving={isSavingTask}
            error={taskEditError}
            onChange={setEditInput}
            onSubmit={() => void handleUpdateTask()}
            onCancel={closeTaskEditor}
          />
        ) : null}
        {visibleBoard ? (
          <section className="task-status-list" aria-label="任务状态列表">
            <div className="task-status-tabs" role="tablist" aria-label="任务状态">
              {columnDefinitions.map((column) => {
                const isSelected = selectedStatus === column.status;
                const taskCount = visibleBoard.columns[column.status].length;

                return (
                  <button
                    key={column.status}
                    id={`task-status-tab-${column.status}`}
                    type="button"
                    role="tab"
                    className={`task-status-tab${isSelected ? ' is-active' : ''}`}
                    aria-label={`${column.title} ${taskCount}`}
                    aria-selected={isSelected}
                    aria-controls="task-status-panel"
                    onClick={() => setSelectedStatus(column.status)}
                  >
                    <span>{column.title}</span>
                    <strong>{taskCount}</strong>
                  </button>
                );
              })}
            </div>
            <div
              id="task-status-panel"
              className="task-board"
              role="tabpanel"
              aria-labelledby={`task-status-tab-${selectedStatus}`}
            >
              {columnDefinitions
                .filter((column) => column.status === selectedStatus)
                .map((column) => (
                  <section key={column.status} className="task-column" aria-label={column.title}>
                    <h3>{column.title}</h3>
                    {visibleBoard.columns[column.status].length === 0 ? (
                      <p className="task-column-empty">暂时没有任务</p>
                    ) : (
                      <ul className="task-list">
                        {visibleBoard.columns[column.status].map((task) => (
                          <li key={task.id}>
                            <TaskCard
                              task={task}
                              isMoving={movingTaskId === task.id}
                              isSaving={isSavingTask}
                              dueLabel={getTaskDueLabel(task, today)}
                              onEdit={openTaskEditor}
                              onMove={(currentTask) => void handleMoveTask(currentTask)}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                ))}
            </div>
          </section>
        ) : null}
      </section>
    </main>
  );
}
