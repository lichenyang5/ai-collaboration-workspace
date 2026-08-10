# Task Status List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three-column task board with a switchable status list that displays each task as a horizontal row.

**Architecture:** `TaskBoardPage` owns one selected `TaskStatus` state and derives the visible tasks from the already loaded `board.columns`. Existing task mutation handlers continue to update `board`; the selected tab counts and visible list consequently refresh without new API calls. `App.css` supplies tab, row and responsive layouts.

**Tech Stack:** React, TypeScript, React Testing Library, CSS.

## Global Constraints

- Do not change API endpoints, task data structures, or the AI draft flow.
- Do not add dependencies or routes.
- Preserve editing and task status movement behavior.
- Keep the layout responsive and free of horizontal overflow.

---

### Task 1: Add status-list behavior and regression coverage

**Files:**
- Modify: `apps/web/src/pages/TaskBoardPage.tsx`
- Modify: `apps/web/src/pages/TaskBoardPage.test.tsx`

**Interfaces:**
- Consumes: `TaskBoardResponse.columns: Record<TaskStatus, TaskSummary[]>`.
- Produces: a selected status state and accessible buttons labelled with each status and its current count.

- [ ] **Step 1: Write the failing test**

```tsx
await user.click(screen.getByRole('button', { name: /进行中/ }));
expect(screen.getByText('进行中任务标题')).toBeInTheDocument();
expect(screen.queryByText('待办任务标题')).not.toBeInTheDocument();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace @workspace/web -- TaskBoardPage.test.tsx --run`

Expected: FAIL because the existing three-column board renders every status simultaneously.

- [ ] **Step 3: Write minimal implementation**

```tsx
const [selectedStatus, setSelectedStatus] = useState<TaskStatus>('todo');
const visibleTasks = board?.columns[selectedStatus] ?? [];
```

Render one button per `columnDefinitions` item and render only `visibleTasks` in the task list. Keep `handleMoveTask` unchanged so its existing `setBoard` update refreshes visible tasks and counts.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test --workspace @workspace/web -- TaskBoardPage.test.tsx --run`

Expected: PASS with the new status switching assertion and all existing task interactions.

### Task 2: Apply long-row layout

**Files:**
- Modify: `apps/web/src/App.css`

**Interfaces:**
- Consumes: `.task-status-tabs`, `.task-status-tab`, `.task-list`, `.task-card`, `.task-card-actions` emitted by `TaskBoardPage`.
- Produces: desktop horizontal task rows and narrow-screen stacked rows.

- [ ] **Step 1: Write the minimal CSS implementation**

```css
.task-card {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) auto auto;
  align-items: center;
}

@media (max-width: 720px) {
  .task-card { grid-template-columns: 1fr; }
}
```

Add an active tab style, status counts, visible focus styles, and a fixed minimum list height. Do not retain the three-column grid.

- [ ] **Step 2: Run visual and build verification**

Run: `npm run lint --workspace @workspace/web && npm run build --workspace @workspace/web`

Expected: PASS. Verify tabs, long rows, action wrapping and mobile stacking in the browser.
