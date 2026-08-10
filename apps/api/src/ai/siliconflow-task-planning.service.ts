import {
  BadGatewayException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { TaskPriority } from '../database/entities/task.entity';
import type { AiTaskDraft } from './types/task-draft';

const DEFAULT_BASE_URL = 'https://api.siliconflow.cn/v1';
const DEFAULT_MODEL = 'Qwen/Qwen2.5-7B-Instruct';
const REQUEST_TIMEOUT_MS = 30_000;

interface SiliconFlowChoice {
  message?: {
    content?: unknown;
  };
}

interface SiliconFlowResponse {
  choices?: SiliconFlowChoice[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isTaskPriority(value: unknown): value is TaskPriority {
  return (
    value === TaskPriority.Low ||
    value === TaskPriority.Medium ||
    value === TaskPriority.High
  );
}

@Injectable()
export class SiliconFlowTaskPlanningService {
  async generateTaskDrafts(goal: string): Promise<AiTaskDraft[]> {
    const apiKey = process.env.SILICONFLOW_API_KEY?.trim();
    if (!apiKey) {
      throw new ServiceUnavailableException('AI 服务尚未配置');
    }

    const baseUrl = (
      process.env.SILICONFLOW_BASE_URL?.trim() || DEFAULT_BASE_URL
    ).replace(/\/+$/, '');
    const model = process.env.SILICONFLOW_MODEL?.trim() || DEFAULT_MODEL;
    let response: Response;
    const abortController = new AbortController();
    const timeoutId = setTimeout(
      () => abortController.abort(),
      REQUEST_TIMEOUT_MS,
    );

    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            {
              role: 'system',
              content:
                '你是项目管理助手。仅输出 JSON，不要输出 Markdown 或额外说明。格式为 {"tasks":[{"title":"","description":"","priority":"low|medium|high"}]}。请生成 1 到 8 条可执行任务。',
            },
            { role: 'user', content: `项目目标：${goal.trim()}` },
          ],
        }),
        signal: abortController.signal,
      });
    } catch {
      if (abortController.signal.aborted) {
        throw new BadGatewayException('AI 服务请求超时，请稍后再试');
      }
      throw new BadGatewayException('AI 服务暂时不可用');
    } finally {
      clearTimeout(timeoutId);
    }

    if (response.status === 429) {
      throw new HttpException(
        'AI 请求过于频繁，请稍后再试',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new BadGatewayException('AI 服务认证失败');
    }
    if (!response.ok) {
      throw new BadGatewayException('AI 服务暂时不可用');
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new BadGatewayException('AI 服务暂时不可用');
    }

    return this.parseTaskDrafts(payload);
  }

  private parseTaskDrafts(payload: unknown): AiTaskDraft[] {
    const content = this.getMessageContent(payload);
    const normalizedContent = content
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');

    let draftPayload: unknown;
    try {
      draftPayload = JSON.parse(normalizedContent);
    } catch {
      throw new BadGatewayException('AI 服务暂时不可用');
    }

    if (!isRecord(draftPayload) || !Array.isArray(draftPayload.tasks)) {
      throw new BadGatewayException('AI 服务暂时不可用');
    }
    if (draftPayload.tasks.length < 1 || draftPayload.tasks.length > 8) {
      throw new BadGatewayException('AI 服务暂时不可用');
    }

    return draftPayload.tasks.map((task) => this.parseTaskDraft(task));
  }

  private getMessageContent(payload: unknown): string {
    if (!isRecord(payload)) {
      throw new BadGatewayException('AI 服务暂时不可用');
    }

    const response = payload as SiliconFlowResponse;
    const content = response.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new BadGatewayException('AI 服务暂时不可用');
    }

    return content;
  }

  private parseTaskDraft(task: unknown): AiTaskDraft {
    if (!isRecord(task)) {
      throw new BadGatewayException('AI 服务暂时不可用');
    }

    const title = typeof task.title === 'string' ? task.title.trim() : '';
    const description =
      typeof task.description === 'string' ? task.description.trim() : '';
    if (
      title.length < 2 ||
      title.length > 200 ||
      description.length > 5000 ||
      !isTaskPriority(task.priority)
    ) {
      throw new BadGatewayException('AI 服务暂时不可用');
    }

    return { title, description, priority: task.priority };
  }
}
