import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../services/api';
import type { AuthenticationResponse, PublicUser } from '../types/auth';

interface RegisterPageProps {
  onAuthenticated: (user: PublicUser) => void;
}

export function RegisterPage({ onAuthenticated }: RegisterPageProps) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage('');
    setIsSubmitting(true);

    try {
      const result = await apiRequest<AuthenticationResponse>('api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, email, password }),
      });
      onAuthenticated(result.user);
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : '注册失败，请稍后重试');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-intro" aria-label="产品介绍">
        <p className="eyebrow">AI Collaboration Workspace</p>
        <h1>从一个清晰的工作区开始协作。</h1>
        <p>创建账户后，即可创建团队、组织项目，并用任务看板推进交付。</p>
      </section>
      <section className="auth-card" aria-labelledby="register-title">
        <p className="eyebrow">创建账户</p>
        <h2 id="register-title">开始使用</h2>
        <p className="muted">已有账户？<Link to="/login">去登录</Link></p>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label htmlFor="register-name">昵称</label>
          <input
            id="register-name"
            type="text"
            autoComplete="name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            minLength={2}
            maxLength={100}
            required
          />
          <label htmlFor="register-email">邮箱</label>
          <input
            id="register-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <label htmlFor="register-password">密码</label>
          <input
            id="register-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={8}
            required
          />
          {errorMessage ? <p className="form-error" role="alert">{errorMessage}</p> : null}
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? '注册中…' : '注册并进入工作区'}
          </button>
        </form>
      </section>
    </main>
  );
}