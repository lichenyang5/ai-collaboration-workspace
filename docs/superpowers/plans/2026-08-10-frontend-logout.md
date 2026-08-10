# Frontend Logout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a visible workspace logout action that clears the existing cookie-backed session and returns the user to the login page.

**Architecture:** `AppRoutes` remains the single owner of `currentUser`. It passes an `onLogout` callback to `WorkspacePage`; that page performs the existing logout request and invokes the callback in `finally`, allowing the protected `/workspace` route to redirect to `/login` without duplicating auth state.

**Tech Stack:** React 19, React Router, TypeScript, Vitest, React Testing Library, existing `apiRequest` helper.

## Global Constraints

- Reuse `POST /api/auth/logout`; do not modify NestJS, the JWT cookie, or authentication routing.
- Add no dependencies, global state library, or persistent client-side session state.
- Keep the logout control on the workspace page only.
- Disable repeated logout submits and preserve existing team loading and creation behavior.

---

### Task 1: Workspace logout interaction

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/pages/WorkspacePage.tsx`
- Modify: `apps/web/src/pages/WorkspacePage.test.tsx`

**Interfaces:**
- `WorkspacePageProps` receives `onLogout: () => void` in addition to `user`.
- `AppRoutes` passes `onLogout={() => setCurrentUser(null)}` to the protected workspace route.
- `WorkspacePage` sends `apiRequest<void>('api/auth/logout', { method: 'POST' })` before calling `onLogout` in `finally`.

- [ ] **Step 1: Write the failing UI test**

```tsx
it('requests logout and clears the application session after completion', async () => {
  const onLogout = vi.fn();
  const user = userEvent.setup();
  // Mock GET /api/teams as an empty list and POST /api/auth/logout as 204.
  render(<MemoryRouter><WorkspacePage user={demoUser} onLogout={onLogout} /></MemoryRouter>);

  await user.click(await screen.findByRole('button', { name: '退出登录' }));

  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringMatching(/\/api\/auth\/logout$/),
    expect.objectContaining({ method: 'POST', credentials: 'include' }),
  );
  expect(onLogout).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the focused test and confirm it fails because the button is absent**

Run: `npm run test --workspace @workspace/web -- WorkspacePage.test.tsx --run`

Expected: FAIL with no accessible button named `退出登录`.

- [ ] **Step 3: Add the session-clearing callback and minimal pending state**

```tsx
// App.tsx
<WorkspacePage user={currentUser} onLogout={() => setCurrentUser(null)} />

// WorkspacePage.tsx
const [isLoggingOut, setIsLoggingOut] = useState(false);

async function handleLogout() {
  if (isLoggingOut) return;
  setIsLoggingOut(true);
  try {
    await apiRequest<void>('api/auth/logout', { method: 'POST' });
  } finally {
    onLogout();
  }
}
```

Render a `type="button"` control next to the user email with the text `退出登录`, changing to `退出中…` while disabled. Use the existing focus, button, and responsive header styling patterns; no new layout component is needed.

- [ ] **Step 4: Run focused workspace tests and confirm they pass**

Run: `npm run test --workspace @workspace/web -- WorkspacePage.test.tsx --run`

Expected: PASS; existing team-loading and team-creation assertions remain green.

- [ ] **Step 5: Verify the web application**

Run: `npm run lint --workspace @workspace/web && npm run test --workspace @workspace/web && npm run build --workspace @workspace/web`

Expected: lint, all tests, and production build pass.
