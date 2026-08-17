# Realtime Team Invitation Juejin Blog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write a detailed Chinese Markdown article that lets a reader with no prior knowledge understand, reproduce, verify, debug, and explain the repository's realtime team-invitation feature.

**Architecture:** The article follows one end-to-end invitation from the REST write through a targeted Socket.IO event to the REST reconciliation on the invited user's browser. Each technical section is grounded in current `main` source and tests; explanatory snippets are shortened without changing identifiers or behavior.

**Tech Stack:** Markdown, Mermaid, React 19, TypeScript, NestJS 11, Socket.IO 4, TypeORM, JWT in HttpOnly Cookie, Jest, Vitest.

## Global Constraints

- Create only `docs/blogs/realtime-team-invitation-with-socketio.md` as the article deliverable.
- Write in Chinese for a reader who does not yet understand WebSocket or the implementation.
- Keep the article between 8,000 and 12,000 Chinese characters where clarity permits.
- Use only behavior confirmed by current `main`; do not invent APIs, environment variables, screenshots, or verification results.
- Keep scope to team invitations; do not imply project invitations, task broadcasts, chat, persistent notification storage, or multi-node Socket.IO delivery.
- Use `team.membership.created` and `user:{userId}` exactly.
- State that REST is authoritative and Socket.IO carries a transient change notification.
- Include both normal behavior and limitations: duplicate invitation, offline invitee, initial connection failure, reconnect, user switch, Origin/Cookie failure, and REST refresh failure.
- Preserve the user's unrelated untracked `.superpowers/` directory and resume document.

---

### Task 1: Evidence map and publishable article frame

**Files:**
- Create: `docs/blogs/realtime-team-invitation-with-socketio.md`
- Read: `README.md:7-9,43-45,221-232,275-279`
- Read: `docs/superpowers/specs/2026-08-14-realtime-team-invitation-design.md`
- Read: `apps/api/src/realtime/realtime-events.ts`
- Read: `apps/web/src/realtime/realtime-types.ts`

**Interfaces:**
- Consumes: Current event contract `{ eventId, teamId, teamName, role: 'member', occurredAt }` and the public GitHub URL.
- Produces: A stable heading tree and terminology used by every later task.

- [ ] **Step 1: Record the current repository evidence before writing**

Run:

```powershell
git status --short
git log -10 --oneline
Select-String -Path README.md -Pattern '实时团队邀请|Socket.IO|GET /api/teams' -Context 2,3
Get-Content -Raw apps/api/src/realtime/realtime-events.ts
Get-Content -Raw apps/web/src/realtime/realtime-types.ts
```

Expected: `main` contains the realtime commits; event names and payload fields match between API and Web. Existing unrelated untracked files remain outside article scope.

- [ ] **Step 2: Create the article metadata and complete heading structure**

Create the target file with:

- one main title emphasizing a real team invitation and Socket.IO;
- a 100-200 character abstract;
- suggested Juejin categories `前端` and `后端`, and tags `React`, `NestJS`, `Socket.IO`, `WebSocket`, `TypeScript`;
- a repository link to `https://github.com/lichenyang5/ai-collaboration-workspace`;
- all 14 headings from the approved design, in the same learning order;
- an opening statement that the article is a real implementation review, not a hypothetical demo.

- [ ] **Step 3: Add the two architecture diagrams**

Add a Mermaid flowchart that separates:

```text
Alice browser -> POST member REST -> TeamsService -> PostgreSQL
TeamsService -> RealtimeNotifier -> user:{bobId} -> Bob browser
Bob browser -> GET /api/teams -> PostgreSQL -> Bob workspace
```

Add a Mermaid sequence diagram with `Alice`, `API`, `PostgreSQL`, `Socket.IO`, and `Bob`, explicitly placing the WebSocket emit after membership persistence and the Bob REST refresh after the event.

- [ ] **Step 4: Verify the frame**

Run:

```powershell
Select-String -Path docs/blogs/realtime-team-invitation-with-socketio.md -Pattern '^# |^## |```mermaid|team.membership.created|user:\{userId\}'
git diff --check -- docs/blogs/realtime-team-invitation-with-socketio.md
```

Expected: one title, all planned headings, two Mermaid openings, both exact realtime identifiers, and no whitespace errors.

- [ ] **Step 5: Commit the article frame**

```powershell
git add -- docs/blogs/realtime-team-invitation-with-socketio.md
git commit -m "docs: outline realtime invitation article"
```

### Task 2: Explain the problem, choices, backend path, and idempotency

**Files:**
- Modify: `docs/blogs/realtime-team-invitation-with-socketio.md`
- Read: `apps/api/src/realtime/realtime.gateway.ts`
- Read: `apps/api/src/realtime/realtime-auth.service.ts`
- Read: `apps/api/src/realtime/realtime-notifier.service.ts`
- Read: `apps/api/src/teams/teams.service.ts:82-149`
- Read: `apps/api/src/database/entities/team-member.entity.ts`

**Interfaces:**
- Consumes: The fixed terminology and diagrams from Task 1.
- Produces: Sections 1-7, ending with a precise server-side event contract for the frontend sections.

- [ ] **Step 1: Explain the original limitation and foundational concepts**

Write sections 1-3 so a beginner can distinguish:

- a REST response returning only to Alice's request;
- a persistent WebSocket connection allowing the server to reach Bob;
- Socket.IO as a higher-level event/reconnect abstraction rather than the WebSocket protocol itself;
- polling, SSE, and WebSocket trade-offs in a comparison table;
- why this bidirectional-capable project selects Socket.IO even though the first event is server-to-client.

- [ ] **Step 2: Explain the authoritative-data architecture**

Use the phrase “消息是提醒，REST 才是账本” as the section's memory aid, then explain:

- `POST /api/teams/:teamId/members` performs permission checks and persistence;
- `team.membership.created` contains enough data for a toast and destination, not a full team/project snapshot;
- Bob reacts by calling `GET /api/teams`;
- a failed emit is logged but does not roll back a successfully persisted membership.

- [ ] **Step 3: Walk through Gateway authentication and user rooms**

Include shortened, source-faithful snippets for:

```ts
@WebSocketGateway({ allowRequest, cors })
server.use(async (client, next) => { ... })
await client.join(`user:${client.data.user.id}`)
this.server.to(`user:${userId}`).emit(event, payload)
```

Explain, in order: browser Origin check, Cookie transmission, `access_token` parsing, JWT verification, typed socket user data, room join, and targeted emission. Explicitly state why authenticating after an unauthenticated connection lifecycle would be too late.

- [ ] **Step 4: Walk through invitation persistence and duplicate handling**

Explain the exact `TeamsService.addTeamMember` order:

1. requester must be team owner;
2. team and registered user must exist;
3. existing membership returns immediately without a new event;
4. new membership is saved;
5. event ID is the persisted membership ID;
6. PostgreSQL `23505` race recovery reloads the existing membership without emitting again.

State that this gives an idempotent user-visible result and prevents duplicate toast events for the same membership creation.

- [ ] **Step 5: Verify backend claims against source**

Run:

```powershell
Select-String -Path apps/api/src/realtime/*.ts,apps/api/src/teams/teams.service.ts -Pattern 'allowRequest|access_token|user:|team.membership.created|23505|notifyTeamMembershipCreated' -Context 2,4
Select-String -Path docs/blogs/realtime-team-invitation-with-socketio.md -Pattern '轮询|SSE|Socket.IO|消息是提醒|23505|HttpOnly|JWT'
git diff --check -- docs/blogs/realtime-team-invitation-with-socketio.md
```

Expected: every named behavior appears in both article and source evidence; Markdown has no whitespace errors.

- [ ] **Step 6: Commit the backend explanation**

```powershell
git add -- docs/blogs/realtime-team-invitation-with-socketio.md
git commit -m "docs: explain realtime invitation backend"
```

### Task 3: Explain React state, reconciliation, races, and security

**Files:**
- Modify: `docs/blogs/realtime-team-invitation-with-socketio.md`
- Read: `apps/web/src/realtime/RealtimeProvider.tsx`
- Read: `apps/web/src/realtime/RealtimeNotificationCenter.tsx`
- Read: `apps/web/src/pages/WorkspacePage.tsx`
- Read: `apps/web/src/pages/ProjectListPage.tsx:238-290`
- Read: `apps/web/src/services/api.ts`

**Interfaces:**
- Consumes: Server event semantics from Task 2.
- Produces: Sections 8-10 with a full browser-side data flow and explicit security/consistency boundaries.

- [ ] **Step 1: Explain the authenticated realtime session**

Show a shortened `RealtimeProvider` snippet containing:

```ts
io(apiBaseUrl, {
  withCredentials: true,
  autoConnect: true,
  transports: ['websocket'],
})
```

Explain that the provider mounts only for an authenticated user, is keyed by `user.id`, disconnects on cleanup, deduplicates `eventId`, appends notifications, and increments `teamRefreshVersion`.

- [ ] **Step 2: Explain toast presentation and REST reconciliation**

Describe the bottom-right toast text `你已加入「{teamName}」`, five-second timeout, manual close, queue behavior, and `查看团队` link. Then trace `teamRefreshVersion` into `WorkspacePage.loadTeams()` and explain why the UI does not trust the event as a complete database snapshot.

- [ ] **Step 3: Explain the race-condition defenses**

Use separate examples for:

- Alice's invitation button: synchronous pending ref blocks double submit; success upserts by member ID; current request clears the input and releases `邀请中...`;
- authenticated user A to B switch: keyed provider prevents old socket callbacks from entering the new session;
- initial `connect_error` followed by first successful connection: trigger one REST refresh;
- later disconnect and reconnect: trigger one REST refresh;
- concurrent workspace loads: single-flight request plus queued catch-up prevents an old response from becoming final;
- local team creation racing with realtime refresh: mutation version preserves the confirmed local result until a final authoritative reload.

- [ ] **Step 4: Explain the security boundary without overstating it**

Cover exact Origin matching through `CORS_ORIGIN`, credentialed Cookie handshake, JWT verification before room join, and explicit WebSocket transport. State these current limits:

- the notification is transient and not stored as an inbox;
- a single Node process owns the Socket.IO rooms;
- horizontal scaling would require a shared adapter such as Redis, which is not implemented;
- HTTPS deployment must produce a compatible WSS connection and matching production Origin.

- [ ] **Step 5: Verify frontend and security claims**

Run:

```powershell
Select-String -Path apps/web/src/realtime/*.tsx,apps/web/src/pages/WorkspacePage.tsx,apps/web/src/pages/ProjectListPage.tsx -Pattern 'transports|withCredentials|seenEventIds|teamRefreshVersion|reloadQueuedRef|invitationPendingRef|memberInvited' -Context 2,4
Select-String -Path docs/blogs/realtime-team-invitation-with-socketio.md -Pattern '5 秒|eventId|connect_error|重新连接|单飞|CORS_ORIGIN|WSS|Redis'
git diff --check -- docs/blogs/realtime-team-invitation-with-socketio.md
```

Expected: article includes every required state and limitation; identifiers agree with source.

- [ ] **Step 6: Commit the frontend and race explanation**

```powershell
git add -- docs/blogs/realtime-team-invitation-with-socketio.md
git commit -m "docs: explain realtime invitation frontend"
```

### Task 4: Add verification, troubleshooting, interview scripts, and publication QA

**Files:**
- Modify: `docs/blogs/realtime-team-invitation-with-socketio.md`
- Read: `apps/api/src/realtime/*.spec.ts`
- Read: `apps/web/src/realtime/*.test.tsx`
- Read: `apps/web/src/pages/WorkspacePage.test.tsx`
- Read: `README.md:221-232,275-279`

**Interfaces:**
- Consumes: Complete technical narrative from Tasks 1-3.
- Produces: Final publishable article with reproducible evidence, honest limitations, and no unfinished markers.

- [ ] **Step 1: Explain the automated test pyramid**

Describe what each layer proves:

- auth service tests: Cookie/JWT acceptance and rejection;
- gateway unit tests: user room and targeted event;
- real Socket.IO integration tests: allowed/rejected/missing Origin plus valid/missing/invalid Cookie;
- notifier and TeamsService tests: one event only after a new insert and best-effort failure behavior;
- provider tests: event dedupe, connection recovery, reconnect, user isolation, and WebSocket-only client configuration;
- notification/page tests: toast queue, five-second timeout, navigation, and authoritative team reload.

Report the last verified repository totals accurately: API 90 tests and Web 89 tests, while labeling dual-browser interaction as a manual acceptance procedure rather than an already captured browser run.

- [ ] **Step 2: Add the dual-browser reproduction**

Write numbered steps using one normal and one incognito browser session. Include expected Network evidence:

```text
Alice: POST /api/teams/:teamId/members
Bob: WebSocket event team.membership.created
Bob: GET /api/teams
```

Include duplicate-invite and offline-invite checks, and explain the expected absence of a second toast.

- [ ] **Step 3: Add a symptom-to-cause troubleshooting table**

Include rows for:

- invitation succeeds but no toast;
- WebSocket rejected by Origin;
- missing Cookie or unauthorized handshake;
- toast appears but team list does not update;
- duplicate notifications;
- invite button remains busy;
- local development ports or stale processes;
- HTTPS page attempting an incompatible non-secure socket connection.

Each row must list the browser/API evidence to inspect before suggesting a remedy.

- [ ] **Step 4: Add interview-ready explanations and conclusion**

Write:

- a one-minute answer covering problem, architecture, result, and one hard point;
- a three-minute answer covering data flow, security, idempotency, reconnection, and tests;
- three likely interviewer follow-ups: why not polling, why REST reload, and how to scale to multiple API instances;
- a conclusion linking the GitHub repository and distinguishing completed behavior from possible future extensions.

- [ ] **Step 5: Run publication QA**

Run:

```powershell
$file = 'docs/blogs/realtime-team-invitation-with-socketio.md'
$content = Get-Content -Raw $file
"Characters: $($content.Length)"
"Code fences: $(([regex]::Matches($content, '```')).Count)"
$unfinishedPatterns = @('TO' + 'DO', 'TB' + 'D', '待' + '补充', 'localhost:3000', 'project.membership.created')
Select-String -Path $file -Pattern $unfinishedPatterns
Select-String -Path $file -Pattern 'API 90|Web 89|team.membership.created|user:\{userId\}|CORS_ORIGIN|VITE_API_BASE_URL|JWT_SECRET'
git diff --check -- $file
```

Expected: 8,000-12,000 characters unless a small documented overage is necessary for clarity; code-fence count is even; forbidden placeholder/wrong-identifier search returns no matches; required factual identifiers all appear; diff check passes.

- [ ] **Step 6: Review the rendered Markdown structure manually**

Confirm:

- every Mermaid block has a closing fence and readable node labels;
- heading levels never jump from `##` to `####`;
- tables have header separators and no unescaped pipe that breaks a cell;
- code excerpts are introduced and explained rather than pasted without context;
- no paragraph claims the dual-browser flow was personally observed in this run;
- title, abstract, categories, tags, repository link, conclusion, and interview scripts are present.

- [ ] **Step 7: Commit the publishable article**

```powershell
git add -- docs/blogs/realtime-team-invitation-with-socketio.md
git commit -m "docs: publish realtime invitation article"
```
