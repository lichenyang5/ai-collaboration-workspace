import { TaskPriority } from '../database/entities/task.entity';
import { SiliconFlowTaskPlanningService } from './siliconflow-task-planning.service';

describe('SiliconFlowTaskPlanningService', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.SILICONFLOW_API_KEY = 'test-siliconflow-key';
    process.env.SILICONFLOW_BASE_URL = 'https://example.test/v1';
    process.env.SILICONFLOW_MODEL = 'Qwen/Qwen2.5-7B-Instruct';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    global.fetch = originalFetch;
    delete process.env.SILICONFLOW_API_KEY;
    delete process.env.SILICONFLOW_BASE_URL;
    delete process.env.SILICONFLOW_MODEL;
  });

  it('parses fenced JSON task drafts returned by SiliconFlow', async () => {
    const fetchMock = jest
      .fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    '```json\n{"tasks":[{"title":"梳理接口边界","description":"输出接口清单","priority":"high"}]}\n```',
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    global.fetch = fetchMock as typeof fetch;
    const service = new SiliconFlowTaskPlanningService();

    await expect(
      service.generateTaskDrafts('完成项目接口设计并联调'),
    ).resolves.toEqual([
      {
        title: '梳理接口边界',
        description: '输出接口清单',
        priority: TaskPriority.High,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rejects a missing API key without calling fetch', async () => {
    delete process.env.SILICONFLOW_API_KEY;
    const fetchMock = jest.fn<
      Promise<Response>,
      [RequestInfo | URL, RequestInit?]
    >();
    global.fetch = fetchMock as typeof fetch;
    const service = new SiliconFlowTaskPlanningService();

    await expect(
      service.generateTaskDrafts('完成项目接口设计并联调'),
    ).rejects.toThrow('AI 服务尚未配置');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a SiliconFlow rate limit response to a retry message', async () => {
    const fetchMock = jest
      .fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: 'Too many requests' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    global.fetch = fetchMock as typeof fetch;
    const service = new SiliconFlowTaskPlanningService();

    await expect(
      service.generateTaskDrafts('完成项目接口设计并联调'),
    ).rejects.toThrow('AI 请求过于频繁，请稍后再试');
  });

  it('stops a hanging upstream request after the configured timeout', async () => {
    jest.useFakeTimers();
    const fetchMock = jest.fn<
      Promise<Response>,
      [RequestInfo | URL, RequestInit?]
    >(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          });
        }),
    );
    global.fetch = fetchMock as typeof fetch;
    const service = new SiliconFlowTaskPlanningService();
    const requestPromise = service.generateTaskDrafts('完成项目接口设计并联调');
    const outcomePromise = requestPromise.then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] ?? [];
    expect(requestUrl).toBe('https://example.test/v1/chat/completions');
    expect(requestInit?.signal).toBeInstanceOf(AbortSignal);

    await jest.advanceTimersByTimeAsync(30_000);

    const outcome = await outcomePromise;
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toBeInstanceOf(Error);
      if (outcome.error instanceof Error) {
        expect(outcome.error.message).toContain('AI 服务请求超时，请稍后再试');
      } else {
        throw new Error('Expected an Error instance for an aborted AI request');
      }
    }
  });

  it('rejects an invalid task draft response without exposing the upstream payload', async () => {
    const fetchMock = jest
      .fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"tasks":[]}' } }],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    global.fetch = fetchMock as typeof fetch;
    const service = new SiliconFlowTaskPlanningService();

    await expect(
      service.generateTaskDrafts('完成项目接口设计并联调'),
    ).rejects.toThrow('AI 服务暂时不可用');
  });
});
