import type { AiTaskDraft, TaskPriority } from '../../types/workspace';

export interface AiTaskPlannerProps {
  goal: string;
  drafts: AiTaskDraft[];
  isGenerating: boolean;
  isConfirming: boolean;
  error: string;
  onGoalChange(value: string): void;
  onDraftChange(index: number, draft: AiTaskDraft): void;
  onDraftRemove(index: number): void;
  onGenerate(): void;
  onConfirm(): void;
}

export function AiTaskPlanner({
  goal,
  drafts,
  isGenerating,
  isConfirming,
  error,
  onGoalChange,
  onDraftChange,
  onDraftRemove,
  onGenerate,
  onConfirm,
}: AiTaskPlannerProps) {
  return (
    <section className="ai-task-planner" aria-labelledby="ai-task-planner-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">AI 协作</p>
          <h3 id="ai-task-planner-title">AI 拆解项目任务</h3>
        </div>
      </div>
      <p className="ai-task-planner-hint">
        描述项目目标，AI 将生成可编辑的任务草稿；确认后才会创建到待办列。
      </p>
      <form
        className="ai-task-goal-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          onGenerate();
        }}
      >
        <label htmlFor="ai-task-goal">项目目标</label>
        <textarea
          id="ai-task-goal"
          value={goal}
          maxLength={2000}
          placeholder="例如：完成团队协作工作区的接口设计、前端联调与验收"
          onChange={(event) => onGoalChange(event.target.value)}
        />
        <button type="submit" disabled={isGenerating || isConfirming}>
          {isGenerating ? '生成中…' : '生成任务草稿'}
        </button>
      </form>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {drafts.length > 0 ? (
        <div className="ai-draft-section">
          <div className="ai-draft-section-heading">
            <h4>AI 任务草稿</h4>
            <span>{drafts.length} 条</span>
          </div>
          <div className="ai-draft-list">
            {drafts.map((draft, index) => (
              <article key={index} className="ai-draft-card">
                <label htmlFor={`ai-draft-title-${index}`}>草稿 {index + 1} 标题</label>
                <input
                  id={`ai-draft-title-${index}`}
                  value={draft.title}
                  maxLength={200}
                  disabled={isConfirming}
                  onChange={(event) =>
                    onDraftChange(index, { ...draft, title: event.target.value })
                  }
                />
                <label htmlFor={`ai-draft-description-${index}`}>任务说明</label>
                <textarea
                  id={`ai-draft-description-${index}`}
                  value={draft.description}
                  maxLength={5000}
                  disabled={isConfirming}
                  onChange={(event) =>
                    onDraftChange(index, {
                      ...draft,
                      description: event.target.value,
                    })
                  }
                />
                <label htmlFor={`ai-draft-priority-${index}`}>优先级</label>
                <select
                  id={`ai-draft-priority-${index}`}
                  value={draft.priority}
                  disabled={isConfirming}
                  onChange={(event) =>
                    onDraftChange(index, {
                      ...draft,
                      priority: event.target.value as TaskPriority,
                    })
                  }
                >
                  <option value="low">低优先级</option>
                  <option value="medium">中优先级</option>
                  <option value="high">高优先级</option>
                </select>
                <button
                  type="button"
                  className="task-secondary-button"
                  disabled={isConfirming}
                  onClick={() => onDraftRemove(index)}
                >
                  移除草稿
                </button>
              </article>
            ))}
          </div>
          <button
            type="button"
            className="ai-confirm-button"
            disabled={isConfirming}
            onClick={onConfirm}
          >
            {isConfirming ? '创建中…' : '确认创建任务'}
          </button>
        </div>
      ) : null}
    </section>
  );
}
