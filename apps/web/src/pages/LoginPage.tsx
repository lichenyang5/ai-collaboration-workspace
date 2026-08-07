import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../services/api';
import type { AuthenticationResponse, PublicUser } from '../types/auth';

interface LoginPageProps {
  onAuthenticated: (user: PublicUser) => void;
}

export function LoginPage({ onAuthenticated }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage('');
    setIsSubmitting(true);

    try {
      const result = await apiRequest<AuthenticationResponse>('api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      onAuthenticated(result.user);
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : '登录失败，请稍后重试');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-intro" aria-label="产品介绍">
        <p className="eyebrow">AI Collaboration Workspace</p>
        <h1>让团队任务协同更清晰。</h1>
        <p>集中管理团队、项目与任务看板，快速掌握每一项工作进度。</p>
      </section>
      <section className="auth-card" aria-labelledby="login-title">
        <p className="eyebrow">欢迎回来</p>
        <h2 id="login-title">登录工作区</h2>
        <p className="muted">还没有账户？<Link to="/register">创建账户</Link></p>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label htmlFor="login-email">邮箱</label>
          <input
            id="login-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <label htmlFor="login-password">密码</label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          {errorMessage ? <p className="form-error" role="alert">{errorMessage}</p> : null}
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? '登录中…' : '登录'}
          </button>
        </form>
      </section>
    </main>
  );
}