import {
  BadGatewayException,
  HttpException,
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { TaskPriority } from '../database/entities/task.entity';
import type { AiTaskDraft } from './types/task-draft';
import { jsonrepair } from 'jsonrepair';

const DEFAULT_BASE_URL = 'https://api.siliconflow.cn/v1';
const DEFAULT_MODEL = 'Qwen/Qwen2.5-7B-Instruct';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_AI_RETRY = 1;

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

    let attempt = 0;
    while (true) {
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);
      let response: Response;

      try {
        response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            temperature: 0.1,
            messages: [
              {
                role: 'system',
                content: `你是项目管理助手。只输出JSON，不要任何解释、markdown、注释。
输出格式：{"tasks":[{"title":"","description":"","priority":"low|medium|high"}]}
规则：
1. key只能是 title、description、priority；
2. priority只能为 low / medium / high；
3. 输出必须完整闭合JSON；
4. 生成1‑8条任务。`,
              },
              { role: 'user', content: `项目目标：${goal.trim()}` },
            ],
          }),
          signal: abortController.signal,
        });
      } catch (err) {
        clearTimeout(timeoutId);
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

      let rawBody: string;
      try {
        console.log('[AI] BEFORE response.text()');
        rawBody = await response.text();
        console.log('[AI] SiliconFlow raw body', { model, rawBody });
        console.log('[AI] SiliconFlow raw body received', {
          model,
          status: response.status,
          bodyLength: rawBody.length,
        });
      } catch (error) {
        console.error('[AI] SiliconFlow body read failed', { model, error });
        throw new BadGatewayException('AI 服务返回数据读取失败');
      }

      let payload: unknown;
      try {
        payload = JSON.parse(rawBody);
      } catch (error) {
        console.error('[AI] SiliconFlow outer JSON parse failed', {
          model,
          body: rawBody,
          error,
        });
        throw new BadGatewayException('AI 服务返回的数据格式异常');
      }

      console.log('[AI] SiliconFlow payload parsed', { model, payload });

      try {
        return this.parseTaskDrafts(payload);
      } catch (parseErr) {
        attempt++;
        if (attempt <= MAX_AI_RETRY) {
          console.warn(`[AI] 任务JSON解析失败，开始重试 ${attempt}/${MAX_AI_RETRY}`);
          continue;
        }
        throw parseErr;
      }
    }
  }

  private parseTaskDrafts(payload: unknown): AiTaskDraft[] {
    const content = this.getMessageContent(payload);

    let dirtyJson = content
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');

    const fixedJson = jsonrepair(dirtyJson);
    console.log('[AI] jsonrepair修复后', fixedJson);

    const draftPayload = JSON.parse(fixedJson);

    if (!isRecord(draftPayload) || !Array.isArray(draftPayload.tasks)) {
      throw new BadGatewayException('AI返回tasks字段格式错误');
    }
    if (draftPayload.tasks.length < 1 || draftPayload.tasks.length > 8) {
      throw new BadGatewayException('AI生成任务数量超出范围');
    }

    return draftPayload.tasks.map((task) => this.parseTaskDraft(task));
  }

  private getMessageContent(payload: unknown): string {
    if (!isRecord(payload)) {
      throw new BadGatewayException('AI返回响应格式错误');
    }

    const response = payload as SiliconFlowResponse;
    const content = response.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new BadGatewayException('AI返回内容为空');
    }
    return content;
  }

  private parseTaskDraft(task: unknown): AiTaskDraft {
    if (!isRecord(task)) {
      throw new BadGatewayException('任务项格式错误');
    }

    const title = typeof task.title === 'string' ? task.title.trim() : '';
    let description = typeof task.description === 'string' ? task.description.trim() : '';

    const priorityValues = ['low', 'medium', 'high'];
    let priority = task.priority;

    if (typeof description === 'string' && priorityValues.includes(description.toLowerCase())) {
      priority = description;
      description = '';
    }

    if (typeof priority === 'string') {
      priority = priority.toLowerCase().replace(/low+/, 'low').replace(/high+/, 'high');
    }

    if (!isTaskPriority(priority)) {
      priority = TaskPriority.Medium;
    }

    if (title.length < 2 || title.length > 200 || description.length > 5000) {
      throw new BadGatewayException('任务字段校验不通过');
    }

    return { title, description, priority: priority as TaskPriority };
  }
}