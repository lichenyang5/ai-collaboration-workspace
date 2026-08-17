import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useRealtime } from '../realtime/RealtimeProvider';
import { apiRequest } from '../services/api';
import type { PublicUser } from '../types/auth';
import type { TeamSummary } from '../types/workspace';

interface WorkspacePageProps {
  user: PublicUser;
  onLogout: () => void;
}

interface CreatedTeam {
  id: string;
  name: string;
}

export function WorkspacePage({ user, onLogout }: WorkspacePageProps) {
  const { teamRefreshVersion } = useRealtime();
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [teamName, setTeamName] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [loadErrorMessage, setLoadErrorMessage] = useState('');
  const [createErrorMessage, setCreateErrorMessage] = useState('');
  const errorMessage = createErrorMessage || loadErrorMessage;
  const loadInFlightRef = useRef(false);
  const reloadQueuedRef = useRef(false);
  const requestGenerationRef = useRef(0);
  const hasInitialResultRef = useRef(false);
  const lastRefreshVersionRef = useRef(teamRefreshVersion);
  const teamMutationVersionRef = useRef(0);

  const loadTeams = useCallback(async (generation: number) => {
    if (generation !== requestGenerationRef.current) {
      return;
    }
    if (loadInFlightRef.current) {
      reloadQueuedRef.current = true;
      return;
    }

    loadInFlightRef.current = true;
    try {
      do {
        reloadQueuedRef.current = false;
        const isInitialLoad = !hasInitialResultRef.current;
        const mutationVersion = teamMutationVersionRef.current;

        try {
          const result = await apiRequest<TeamSummary[]>('api/teams');
          if (generation !== requestGenerationRef.current) {
            return;
          }
          if (mutationVersion === teamMutationVersionRef.current) {
            setTeams(result);
          } else {
            reloadQueuedRef.current = true;
          }
          setLoadErrorMessage('');
        } catch (error: unknown) {
          if (generation !== requestGenerationRef.current) {
            return;
          }
          setLoadErrorMessage(
            isInitialLoad
              ? error instanceof Error
                ? error.message
                : '团队加载失败，请稍后重试'
              : '实时同步失败，可刷新页面重试',
          );
        } finally {
          if (generation !== requestGenerationRef.current) {
            return;
          }
          if (isInitialLoad) {
            hasInitialResultRef.current = true;
            setIsLoading(false);
          }
        }
      } while (reloadQueuedRef.current && generation === requestGenerationRef.current);
    } finally {
      if (generation === requestGenerationRef.current) {
        loadInFlightRef.current = false;
      }
    }
  }, []);

  useEffect(() => {
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    loadInFlightRef.current = false;
    reloadQueuedRef.current = false;
    hasInitialResultRef.current = false;
    lastRefreshVersionRef.current = teamRefreshVersion;
    teamMutationVersionRef.current = 0;
    setTeams([]);
    setLoadErrorMessage('');
    setCreateErrorMessage('');
    setIsLoading(true);
    setIsCreating(false);

    void loadTeams(generation);
    return () => {
      if (requestGenerationRef.current === generation) {
        requestGenerationRef.current += 1;
        loadInFlightRef.current = false;
        reloadQueuedRef.current = false;
      }
    };
  }, [loadTeams, user.id]);

  useEffect(() => {
    if (lastRefreshVersionRef.current === teamRefreshVersion) {
      return;
    }
    lastRefreshVersionRef.current = teamRefreshVersion;
    void loadTeams(requestGenerationRef.current);
  }, [loadTeams, teamRefreshVersion]);

  async function handleCreateTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = teamName.trim();
    if (!name) {
      return;
    }

    setLoadErrorMessage('');
    setCreateErrorMessage('');
    setIsCreating(true);
    const generation = requestGenerationRef.current;
    try {
      const createdTeam = await apiRequest<CreatedTeam>('api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (generation !== requestGenerationRef.current) {
        return;
      }
      teamMutationVersionRef.current += 1;
      setTeams((currentTeams) => {
        const createdTeamSummary: TeamSummary = { ...createdTeam, role: 'owner' };
        const existingTeamIndex = currentTeams.findIndex((team) => team.id === createdTeam.id);
        if (existingTeamIndex === -1) {
          return [...currentTeams, createdTeamSummary];
        }
        return currentTeams.map((team, index) =>
          index === existingTeamIndex ? createdTeamSummary : team,
        );
      });
      setTeamName('');
      void loadTeams(generation);
    } catch (error: unknown) {
      if (generation !== requestGenerationRef.current) {
        return;
      }
      setCreateErrorMessage(error instanceof Error ? error.message : '创建团队失败，请稍后重试');
    } finally {
      if (generation === requestGenerationRef.current) {
        setIsCreating(false);
      }
    }
  }

  async function handleLogout() {
    if (isLoggingOut) {
      return;
    }

    setIsLoggingOut(true);
    try {
      await apiRequest<void>('api/auth/logout', { method: 'POST' });
    } finally {
      onLogout();
    }
  }

  return (
    <main className="workspace-shell">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">AI Collaboration Workspace</p>
          <h1>你好，{user.displayName}</h1>
        </div>
        <div className="workspace-user-actions">
          <p className="workspace-email">{user.email}</p>
          <button
            className="logout-button"
            type="button"
            disabled={isLoggingOut}
            onClick={() => void handleLogout()}
          >
            {isLoggingOut ? '退出中…' : '退出登录'}
          </button>
        </div>
      </header>
      <section className="workspace-content" aria-labelledby="teams-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">工作区</p>
            <h2 id="teams-title">你的团队</h2>
          </div>
        </div>
        <form className="team-form" onSubmit={handleCreateTeam}>
          <label htmlFor="team-name">团队名称</label>
          <input
            id="team-name"
            value={teamName}
            onChange={(event) => setTeamName(event.target.value)}
            minLength={2}
            maxLength={120}
            placeholder="例如：产品研发组"
            required
          />
          <button type="submit" disabled={isCreating}>
            {isCreating ? '创建中…' : '创建团队'}
          </button>
        </form>
        {isLoading ? <p className="workspace-state">正在加载团队…</p> : null}
        {errorMessage ? <p className="form-error" role="alert">{errorMessage}</p> : null}
        {!isLoading && !errorMessage && teams.length === 0 ? (
          <p className="workspace-state">还没有团队，下一步可以创建你的第一个团队。</p>
        ) : null}
        {teams.length > 0 ? (
          <ul className="team-grid">
            {teams.map((team) => (
              <li key={team.id} className="team-card">
                <p className="team-role">{team.role === 'owner' ? '负责人' : '成员'}</p>
                <h3>{team.name}</h3>
                <p>项目与任务看板将在这里展开。</p>
                <Link className="card-link" to={`/teams/${team.id}/projects`}>查看项目</Link>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </main>
  );
}
