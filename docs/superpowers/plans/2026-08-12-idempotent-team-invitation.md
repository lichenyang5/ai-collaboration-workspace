# Idempotent Team Invitation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make member invitation idempotent and guarantee that the project page reconciles its member list and exits the pending state after every result.

**Architecture:** The API remains the source of truth: it returns a `TeamMemberSummary` both when a membership already exists and when it is newly created. The React page treats that response as an upsert and owns invitation pending/error state in one reducer, with a synchronous ref preventing same-render duplicate submissions.

**Tech Stack:** NestJS 11, TypeORM, Jest, React 19, Vitest, Testing Library, TypeScript.

## Global Constraints

- Do not change database schema, migrations, routes, authentication, projects, or task-board behavior.
- Keep `POST /api/teams/:teamId/members` and the existing `TeamMemberSummary` response shape.
- Preserve 403 for non-owners and 404 for unknown email addresses.
- Existing memberships are successful idempotent results, not 409 errors.
- Frontend member reconciliation is by member `id`; no duplicate list entries.
- Every success or failure restores the invitation button; a new request clears a prior invitation error.
- Use TDD: each production change follows a focused test observed failing for the intended reason.

---

### Task 1: Idempotent invitation service

**Files:**
- Create: `apps/api/src/teams/teams.service.spec.ts`
- Modify: `apps/api/src/teams/teams.service.ts`

**Interfaces:**
- Consumes: `TeamsService.addTeamMember(teamId, input, requesterId)` and the existing `DataSource` repositories.
- Produces: the same `Promise<TeamMemberSummary>` result for an existing or newly saved membership.

- [ ] **Step 1: Write focused failing service tests**

Create repository doubles for `TeamMember` and `User` and cover these literal behaviors:

```ts
it('returns the existing member summary without saving another membership', async () => {
  // requireOwner finds owner membership
  // user lookup returns member-user-2
  // membership lookup returns an entity with user + role
  expect(await service.addTeamMember('team-1', { email: 'member@example.com' }, 'owner-1'))
    .toEqual({
      id: 'member-user-2',
      displayName: '成员二',
      email: 'member@example.com',
      role: TeamMemberRole.Member,
    });
  expect(memberRepository.save).not.toHaveBeenCalled();
});

it('rereads and returns the membership after a concurrent unique violation', async () => {
  // first membership lookup returns null; save rejects with driverError.code === '23505'
  // the recovery lookup returns the complete persisted membership
  // assert the public summary and exactly one save attempt
});
```

Retain a new-member test proving one `create` and one `save` call. Use complete entity fixtures containing `team`, `user`, `role`, `id`, and timestamps as required by the service mapping.

- [ ] **Step 2: Run Task 1 tests and verify RED**

Run:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run test --workspace @workspace/api -- teams.service.spec.ts --runInBand
```

Expected: the existing-member test fails with `ConflictException`; the concurrent test fails because the unique error escapes.

- [ ] **Step 3: Implement the minimal idempotent service behavior**

In `addTeamMember`:

```ts
const existingMember = await teamMemberRepository.findOne({
  where: { team: { id: teamId }, user: { id: user.id } },
  relations: { user: true },
});

if (existingMember) {
  return this.toTeamMemberSummary(existingMember);
}
```

Wrap only the membership save in `try/catch`. Treat an error as a unique violation only when it is a `QueryFailedError` whose driver error code is the PostgreSQL literal `23505`. On that case, reread the same team/user membership with `relations: { user: true }`; return its summary when found, otherwise rethrow the original error. Rethrow every non-unique error unchanged.

- [ ] **Step 4: Verify Task 1 GREEN and API regression safety**

Run the focused command from Step 2, followed by:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run test --workspace @workspace/api -- --runInBand
& 'C:\Program Files\nodejs\npm.cmd' run build --workspace @workspace/api
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit Task 1**

```powershell
git add apps/api/src/teams/teams.service.ts apps/api/src/teams/teams.service.spec.ts
git commit -m "fix: make team invitations idempotent"
```

---

### Task 2: Atomic invitation UI and member upsert

**Files:**
- Modify: `apps/web/src/pages/ProjectListPage.tsx`
- Modify: `apps/web/src/pages/ProjectListPage.test.tsx`

**Interfaces:**
- Consumes: `POST /api/teams/:teamId/members` returning `TeamMemberSummary` for both an existing and a new member.
- Produces: reducer actions `inviteStarted`, `inviteFailed`, and `memberInvited`; the rendered list contains at most one row per member `id`.

- [ ] **Step 1: Write focused failing component tests**

Replace the old 409-specific expectation with successful idempotent behavior and add concurrency/state coverage:

```ts
it('upserts an existing member response and restores the invitation button', async () => {
  // initial GET already contains member-user-2
  // POST returns the same id with the authoritative display name/email/role
  // assert exactly one row for that email and an enabled 邀请成员 button
});

it('blocks same-render duplicate invitation submissions', async () => {
  // keep the first POST deferred
  // dispatch submit twice synchronously on the form
  // assert only one POST; then resolve and assert button restored
});

it('clears a previous invitation error when a retry starts and restores it after failure', async () => {
  // first POST fails; second POST remains deferred
  // while deferred, old alert is absent and button says 邀请中...
  // after failure, button says 邀请成员 and is enabled
});
```

The tests must assert visible component behavior. The fetch fake is only the HTTP boundary and must route GET/POST separately.

- [ ] **Step 2: Run Task 2 tests and verify RED**

Run:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run test --workspace @workspace/web -- ProjectListPage.test.tsx --run
```

Expected: duplicate member rows or duplicate POSTs are observed, and the previous alert is not cleared when retry begins.

- [ ] **Step 3: Implement reducer-owned invitation state and synchronous guard**

Move `isInviting` into `ProjectPageState`. Add these transitions:

```ts
case 'inviteStarted':
  return { ...state, isInviting: true, errorMessage: '' };
case 'inviteFailed':
  return { ...state, isInviting: false, errorMessage: action.message };
case 'memberInvited': {
  const existingIndex = state.members.findIndex(({ id }) => id === action.member.id);
  const members = existingIndex === -1
    ? [...state.members, action.member]
    : state.members.map((member) => member.id === action.member.id ? action.member : member);
  return { ...state, members, memberEmail: '', isInviting: false, errorMessage: '' };
}
```

Use `useRef(false)` as `invitePendingRef`. At handler entry, return when it is true; set it synchronously before dispatching `inviteStarted`; release it in `finally`. Do not keep a second `useState` source of invitation truth. Render button state from `state.isInviting`.

- [ ] **Step 4: Verify Task 2 GREEN and Web regression safety**

Run the focused command from Step 2, followed by:

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run test --workspace @workspace/web -- --run
& 'C:\Program Files\nodejs\npm.cmd' run build --workspace @workspace/web
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit Task 2**

```powershell
git add apps/web/src/pages/ProjectListPage.tsx apps/web/src/pages/ProjectListPage.test.tsx
git commit -m "fix: reconcile invitation state and members"
```

---

### Task 3: Integrated verification and handoff

**Files:**
- Verify only; no planned production changes.

**Interfaces:**
- Consumes: Task 1 API contract and Task 2 UI contract.
- Produces: evidence that the repository remains buildable and test-clean.

- [ ] **Step 1: Run repository tests**

```powershell
& 'C:\Program Files\nodejs\npm.cmd' test
```

- [ ] **Step 2: Run repository build**

```powershell
& 'C:\Program Files\nodejs\npm.cmd' run build
```

- [ ] **Step 3: Inspect final scope**

```powershell
git status --short
git diff --check HEAD~2..HEAD
```

Expected: tests and build exit 0; no uncommitted files; no whitespace errors.

- [ ] **Step 4: Perform broad code review**

Review the complete implementation against `docs/superpowers/specs/2026-08-12-idempotent-team-invitation-design.md`, with special attention to non-unique database errors, member relation loading, duplicate POST prevention, and pending-state release.
