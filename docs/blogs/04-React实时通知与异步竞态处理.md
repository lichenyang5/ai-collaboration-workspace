# 第四篇：React 实时通知与异步竞态处理

> 本篇目标：理解前端怎样管理 Socket.IO 生命周期、展示通知、刷新 REST 快照，并处理用户与路由切换造成的异步竞态。

[上一篇](./03-NestJS-SocketIO鉴权与幂等邀请.md) · [返回目录](./realtime-team-invitation-with-socketio.md) · [下一篇](./05-测试双浏览器验证与故障排查.md)

## 1. 为什么需要 RealtimeProvider

如果每个页面都创建 socket，会出现重复连接、重复事件和清理困难。项目把连接放在登录成功后的 RealtimeProvider：未登录时没有实时连接；登录用户变化时，旧会话必须完整销毁。

~~~tsx
export function RealtimeProvider({ user, children }: RealtimeProviderProps) {
  return <RealtimeSession key={user.id}>{children}</RealtimeSession>;
}
~~~

key={user.id} 很重要。React 在账号切换时卸载旧 RealtimeSession，再挂载全新实例，notifications、去重集合、generation 和 socket 都不会跨用户复用。

## 2. 创建连接与注册监听

~~~tsx
const socket = io(apiBaseUrl, {
  withCredentials: true,
  autoConnect: true,
  transports: ['websocket'],
});

socket.on(TEAM_MEMBERSHIP_CREATED, handleMembershipCreated);
socket.on('connect', handleConnect);
socket.on('connect_error', handleConnectError);
socket.on('disconnect', handleDisconnect);
~~~

effect cleanup 必须逐一 off，并调用 disconnect。否则组件重新挂载后，旧回调仍可能更新状态或制造重复 toast。

## 3. 一个事件产生两种结果

~~~tsx
const handleMembershipCreated = (event: TeamMembershipCreatedEvent) => {
  if (
    generation !== generationRef.current ||
    seenEventIds.current.has(event.eventId)
  ) return;

  seenEventIds.current.add(event.eventId);
  setNotifications((current) => [...current, event]);
  setTeamRefreshVersion((current) => current + 1);
};
~~~

notifications 驱动通知中心，给用户立即反馈；teamRefreshVersion 是失效信号，WorkspacePage 观察到变化后重新 GET /api/teams。事件没有直接修改团队列表。

eventId Set 防止同一事件重复生成 toast。使用函数式 setState 则避免多个事件在同一渲染周期内互相覆盖。

## 4. teamRefreshVersion 为什么是数字

布尔值只能表达“要刷新/不要刷新”，两个连续事件可能都写 true，第二次不会触发依赖变化。单调递增版本能表达每次变化。

但版本号也不意味着页面必须并发发送同样多的 GET。WorkspacePage 使用 single-flight 与 queued catch-up：加载中又收到刷新，只记录还需要追赶；当前请求结束后再补一次，避免请求风暴，同时保证最终读到更晚快照。

## 5. 首次连接失败与重连要区分

~~~text
首次连接失败 -> 后来第一次成功 -> 需要同步快照
已经连接 -> disconnect -> reconnect -> 需要同步快照
首次直接成功 -> 页面已有正常初始加载 -> 不额外重复同步
~~~

Provider 用 hasConnected、initialConnectionFailed 和 reconnecting 区分这些路径。每次可能存在消息缺口的恢复都会增加 teamRefreshVersion。

## 6. generation 防止旧回调污染

effect 创建时捕获 generation。cleanup 先递增 generation，再移除监听和断开连接。即使测试环境或第三方库晚到地调用旧 handler，比较失败后也不会写入当前状态。

这种“上下文令牌”模式同样适合普通请求：请求开始时捕获用户 ID、团队 ID 和版本；响应回来时只有上下文仍匹配才允许写 UI。

## 7. 邀请按钮为何长期卡在“邀请中”

最初只用 isInviting 控制按钮会遇到两个问题：

1. 双击在 React 提交状态渲染前可能发出两个 POST；
2. team A 请求 pending 时切到 team B，A 的 finally 可能把 B 的按钮解锁，或 A 的成功把成员插进 B。

项目使用同步 ref 阻止同一提交窗口的重复请求，并用 invitationGenerationRef 与 originatingTeamId 判断响应是否仍属于当前页面。success、catch、finally 都必须守同一上下文边界，不能只保护成功分支。

## 8. A → B → A 为什么更难

只比较 teamId 无法识别 ABA：

~~~text
请求开始于 team A
路由切到 team B
路由又切回 team A
旧响应回来时 teamId 仍是 A
~~~

因此每次路由上下文变化都递增 generation。旧 A 响应即使看到相同 teamId，也无法伪装成新 A 请求。

邀请成功还有一个特殊需求：旧 A 请求可能真的写库成功。如果用户已经回到 A，不能直接丢弃这一业务事实。实现将“当前 token 的成功”与“当前显示团队的旧成功对齐”分开：旧成功可以按成员 ID 做 reconciliation，但不能清空新输入、覆盖新错误或解除新请求的 pending。

## 9. 实时刷新与本地创建团队也会竞争

假设页面正在 POST 创建团队，同时实时事件触发 GET /api/teams。若 GET 的旧快照最后返回，可能把刚创建的团队覆盖掉。解决思路不是盲目比较请求开始时间，而是统一所有团队列表更新的所有权：

- GET 用请求 generation 防止旧快照覆盖；
- 本地 mutation 成功使旧 load 失效，必要时追加一次刷新；
- 加载期间的多个实时刷新合并，但至少执行最终追赶；
- 错误只由当前上下文请求显示。

## 10. 用户可见状态与服务器事实要分开

按钮 busy、表单输入、错误提示属于某次前端操作；成员关系和团队列表属于服务器事实。旧请求成功可以触发数据重新对齐，但不应控制当前操作的 busy/error/input。这一划分是解决复杂竞态的关键。

## 11. 常见错误

1. 在组件函数体直接创建 socket：每次渲染都会新增连接；
2. cleanup 只 disconnect 不 off：旧回调仍可能被 mock 或库内部队列触发；
3. 用数组 includes(payload) 去重：对象引用不同，无法识别相同 eventId；
4. 事件到达就完全信任 payload：无法补偿断线漏失，也拿不到完整权威快照；
5. 只在 success 检查上下文：旧 catch/finally 仍会污染错误和 loading；
6. 只比较 teamId：挡不住 A → B → A。

## 12. 本篇小结

前端实时功能的难点不在 socket.on，而在生命周期和异步所有权。Provider 管连接，eventId 管重复，teamRefreshVersion 管失效通知，REST 管权威状态，generation 管旧回调。

[下一篇：测试、双浏览器验证与故障排查](./05-测试双浏览器验证与故障排查.md)
