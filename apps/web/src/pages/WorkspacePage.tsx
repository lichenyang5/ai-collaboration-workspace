import { useEffect, useState } from 'react';
import { apiRequest } from '../services/api';
import type { PublicUser } from '../types/auth';
import type { TeamSummary } from '../types/workspace';

interface WorkspacePageProps {
  user: PublicUser;
}

export function WorkspacePage({ user }: WorkspacePageProps) {
  const [teams, setTeams] = useState<TeamSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
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
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </main>
  );
}