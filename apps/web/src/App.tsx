import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './App.css';
import { LoginPage } from './pages/LoginPage';
import { ProjectListPage } from './pages/ProjectListPage';
import { RegisterPage } from './pages/RegisterPage';
import { TaskBoardPage } from './pages/TaskBoardPage';
import { WorkspacePage } from './pages/WorkspacePage';
import { apiRequest } from './services/api';
import type { PublicUser } from './types/auth';

function AppRoutes() {
  const [currentUser, setCurrentUser] = useState<PublicUser | null>(null);
  const [isRestoringSession, setIsRestoringSession] = useState(true);

  useEffect(() => {
    let isActive = true;

    async function restoreSession() {
      try {
        const user = await apiRequest<PublicUser>('api/auth/me');
        if (isActive) {
          setCurrentUser(user);
        }
      } catch {
        // 没有有效 Cookie 时保持未登录状态，交由受保护路由跳转到登录页。
      } finally {
        if (isActive) {
          setIsRestoringSession(false);
        }
      }
    }

    void restoreSession();
    return () => {
      isActive = false;
    };
  }, []);

  if (isRestoringSession) {
    return <main className="app-loading">正在恢复登录状态…</main>;
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={
          currentUser ? <Navigate to="/workspace" replace /> : <LoginPage onAuthenticated={setCurrentUser} />
        }
      />
      <Route
        path="/register"
        element={
          currentUser ? <Navigate to="/workspace" replace /> : <RegisterPage onAuthenticated={setCurrentUser} />
        }
      />
      <Route
        path="/workspace"
        element={
          currentUser ? (
            <WorkspacePage user={currentUser} onLogout={() => setCurrentUser(null)} />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
      <Route
        path="/teams/:teamId/projects"
        element={currentUser ? <ProjectListPage /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/projects/:projectId/board"
        element={currentUser ? <TaskBoardPage /> : <Navigate to="/login" replace />}
      />
      <Route path="*" element={<Navigate to="/workspace" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}

export default App;
