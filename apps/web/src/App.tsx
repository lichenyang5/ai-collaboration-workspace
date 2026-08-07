import { useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './App.css';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import type { PublicUser } from './types/auth';

function AuthenticatedPlaceholder({ user }: { user: PublicUser }) {
  return (
    <main className="workspace-placeholder">
      <p className="eyebrow">已登录</p>
      <h1>你好，{user.displayName}</h1>
      <p>团队与项目工作台将在下一步接入。</p>
    </main>
  );
}

function App() {
  const [currentUser, setCurrentUser] = useState<PublicUser | null>(null);

  if (currentUser) {
    return <AuthenticatedPlaceholder user={currentUser} />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage onAuthenticated={setCurrentUser} />} />
        <Route path="/register" element={<RegisterPage onAuthenticated={setCurrentUser} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;