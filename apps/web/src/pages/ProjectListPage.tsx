import { useEffect, useReducer } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiRequest } from '../services/api';
import type { ProjectSummary, TeamSummary } from '../types/workspace';

interface ProjectPageState {
  projects: ProjectSummary[];
  teamName: string;
  projectName: string;
  isLoading: boolean;
  isCreating: boolean;
  errorMessage: string;
}

type ProjectPageAction =
  | { type: 'projectsLoaded'; projects: ProjectSummary[]; teamName: string }
  | { type: 'loadFailed'; message: string }
  | { type: 'projectNameChanged'; value: string }
  | { type: 'creationStarted' }
  | { type: 'creationFailed'; message: string }
  | { type: 'projectCreated'; project: ProjectSummary };

const initialProjectPageState: ProjectPageState = {
  projects: [],
  teamName: '当前团队',
  projectName: '',
  isLoading: true,
  isCreating: false,
  errorMessage: '',
};

/**
 * 将创建成功后的列表、输入框和按钮状态放入同一个动作中更新，
 * 避免页面出现“项目已创建但按钮仍显示创建中”的中间状态。
 */
function projectPageReducer(state: ProjectPageState, action: ProjectPageAction): ProjectPageState {
  switch (action.type) {
    case 'projectsLoaded':
      return {
        ...state,
        projects: action.projects,
        teamName: action.teamName,
        isLoading: false,
        errorMessage: '',
      };
    case 'loadFailed':
      return { ...state, isLoading: false, errorMessage: action.message };
    case 'projectNameChanged':
      return { ...state, projectName: action.value };
    case 'creationStarted':
      return { ...state, isCreating: true, errorMessage: '' };
    case 'creationFailed':
      return { ...state, isCreating: false, errorMessage: action.message };
    case 'projectCreated':
      return {
        ...state,
        projects: [...state.projects, action.project],
        projectName: '',
        isCreating: false,
        errorMessage: '',
      };
  }
}

export function ProjectListPage() {
  const { teamId } = useParams();
  const [state, dispatch] = useReducer(projectPageReducer, initialProjectPageState);

  useEffect(() => {
    if (!teamId) {
      dispatch({ type: 'loadFailed', message: '未找到团队标识' });
      return;
    }

    let isActive = true;

    async function loadProjectWorkspace() {
      try {
        const [projects, teams] = await Promise.all([
          apiRequest<ProjectSummary[]>(`api/teams/${teamId}/projects`),
          apiRequest<TeamSummary[]>('api/teams'),
        ]);

        if (isActive) {
          const teamName = teams.find((team) => team.id === teamId)?.name ?? '当前团队';
          dispatch({ type: 'projectsLoaded', projects, teamName });
        }
      } catch (error: unknown) {
        if (isActive) {
          dispatch({
            type: 'loadFailed',
            message: error instanceof Error ? error.message : '项目加载失败，请稍后重试',
          });
        }
      }
    }

    void loadProjectWorkspace();
    return () => {
      isActive = false;
    };
  }, [teamId]);

  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!teamId || state.isCreating) {
      return;
    }

    const name = state.projectName.trim();
    if (!name) {
      dispatch({ type: 'creationFailed', message: '请输入项目名称' });
      return;
    }

    if (name.length < 2) {
      dispatch({ type: 'creationFailed', message: '项目名称至少需要 2 个字符' });
      return;
    }

    dispatch({ type: 'creationStarted' });
    try {
      const createdProject = await apiRequest<ProjectSummary>(`api/teams/${teamId}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: '' }),
      });
      dispatch({ type: 'projectCreated', project: createdProject });
    } catch (error: unknown) {
      dispatch({
        type: 'creationFailed',
        message: error instanceof Error ? error.message : '创建项目失败，请稍后重试',
      });
    }
  }

  return (
    <main className="workspace-shell">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">项目工作区</p>
          <h1>{state.teamName}的项目</h1>
        </div>
        <Link className="back-link" to="/workspace">返回团队列表</Link>
      </header>
      <section className="workspace-content" aria-labelledby="projects-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">项目</p>
            <h2 id="projects-title">项目列表</h2>
          </div>
        </div>
        <form className="team-form" noValidate onSubmit={handleCreateProject}>
          <label htmlFor="project-name">项目名称</label>
          <input
            id="project-name"
            value={state.projectName}
            onChange={(event) => dispatch({ type: 'projectNameChanged', value: event.target.value })}
            maxLength={160}
            placeholder="例如：良好工作台 MVP"
            aria-required="true"
          />
          <button type="submit" disabled={state.isCreating || !teamId}>
            {state.isCreating ? '创建中…' : '创建项目'}
          </button>
        </form>
        {state.isLoading ? <p className="workspace-state">正在加载项目…</p> : null}
        {state.errorMessage ? <p className="form-error" role="alert">{state.errorMessage}</p> : null}
        {!state.isLoading && !state.errorMessage && state.projects.length === 0 ? (
          <p className="workspace-state">还没有项目，创建一个项目开始协作。</p>
        ) : null}
        {state.projects.length > 0 ? (
          <ul className="team-grid">
            {state.projects.map((project) => (
              <li key={project.id} className="team-card">
                <p className="team-role">项目</p>
                <h3>{project.name}</h3>
                <p>{project.description || '暂未填写项目说明。'}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </main>
  );
}
