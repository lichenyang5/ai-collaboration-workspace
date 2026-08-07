import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../services/api';
import type { PublicUser } from '../types/auth';
import type { TeamSummary } from '../types/workspace';

interface WorkspacePageProps {
  user: PublicUser;
}

interface CreatedTeam {
  id: string;
  name: string;
}

export function WorkspacePage({ user }: WorkspacePageProps) {
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [teamName, setTeamName] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let isActive = true;

    async function loadTeams() {
      try {
        const result = await apiRequest<TeamSummary[]>('api/teams');
        if (isActive) {
          setTeams(result);
        }
      } catch (error: unknown) {
        if (isActive) {
          setErrorMessage(error instanceof Error ? error.message : '团队加载失败，请稍后重试');
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    }

    void loadTeams();
    return () => {
      isActive = false;
    };
  }, []);

  async function handleCreateTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = teamName.trim();
    if (!name) {
      return;
    }

    setErrorMessage('');
    setIsCreating(true);
    try {
      const createdTeam = await apiRequest<CreatedTeam>('api/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      setTeams((currentTeams) => [
        ...currentTeams,
        { ...createdTeam, role: 'owner' },
      ]);
      setTeamName('');
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : '创建团队失败，请稍后重试');
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <main className="workspace-shell">
      <header className="workspace-header">
        <div>
          <p className="eyebrow">AI Collaboration Workspace</p>
          <h1>你好，{user.displayName}</h1>
        </div>
        <p className="workspace-email">{user.email}</p>
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