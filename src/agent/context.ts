import type { LanguageModelUsage, ModelMessage } from 'ai';
import { generateText } from 'ai';
import { MODEL_ID, resolveLanguageModel } from './provider';

export const DEFAULT_CONTEXT_LIMIT = 128_000;
const COMPRESS_THRESHOLD = 0.8;

export interface ContextSnapshot {
	modelId: string;
	contextLimit: number;
	lastPromptTokens?: number;
	lastTotalTokens?: number;
	compressionCount: number;
	lastCompressedAt?: string;
	sessionSummary?: string;
	workingMemory: string[];
	userConstraints: string[];
}

export type CompressionReason = 'manual' | 'threshold';

export interface CompactContextResult {
	history: ModelMessage[];
	context: ContextSnapshot;
	summary: string;
	previousMessageCount: number;
	reason: CompressionReason;
}

interface CompactContextOptions {
	history: ModelMessage[];
	context: ContextSnapshot;
	reason: CompressionReason;
	compressor?: (history: ModelMessage[]) => Promise<string>;
	now?: string;
}

export function createContextSnapshot(
	overrides: Partial<ContextSnapshot> = {},
): ContextSnapshot {
	return {
		modelId: overrides.modelId ?? MODEL_ID,
		contextLimit: overrides.contextLimit ?? DEFAULT_CONTEXT_LIMIT,
		lastPromptTokens: overrides.lastPromptTokens,
		lastTotalTokens: overrides.lastTotalTokens,
		compressionCount: overrides.compressionCount ?? 0,
		lastCompressedAt: overrides.lastCompressedAt,
		sessionSummary: overrides.sessionSummary?.trim() || undefined,
		workingMemory: normalizeMemoryLines(overrides.workingMemory ?? []),
		userConstraints: normalizeMemoryLines(overrides.userConstraints ?? []),
	};
}

export function recordUsage(
	context: ContextSnapshot,
	usage: LanguageModelUsage,
): ContextSnapshot {
	return createContextSnapshot({
		...context,
		lastPromptTokens: usage.inputTokens,
		lastTotalTokens: usage.totalTokens,
	});
}

export function shouldCompress(
	promptTokens: number,
	contextLimit: number = DEFAULT_CONTEXT_LIMIT,
): boolean {
	return promptTokens > contextLimit * COMPRESS_THRESHOLD;
}

export function hasCompressibleHistory(history: ModelMessage[]): boolean {
	return history.some((message) => extractMessageText(message.content).length > 0);
}

export async function compactContext({
	history,
	context,
	reason,
	compressor,
	now = new Date().toISOString(),
}: CompactContextOptions): Promise<CompactContextResult> {
	if (!hasCompressibleHistory(history)) {
		throw new Error('当前没有可压缩的历史记录');
	}

	const summarize =
		compressor ?? ((messages: ModelMessage[]) => compressHistory(messages, context));
	const summary = (await summarize(history)).trim();
	if (!summary) {
		throw new Error('压缩结果为空');
	}

	const workingMemory = buildWorkingMemory(summary, context.workingMemory);

	return {
		history: [],
		summary,
		previousMessageCount: history.length,
		reason,
		context: createContextSnapshot({
			...context,
			compressionCount: context.compressionCount + 1,
			lastCompressedAt: now,
			sessionSummary: summary,
			workingMemory,
		}),
	};
}

export function buildPromptContextSections(context: ContextSnapshot): string[] {
	const sections: string[] = [];

	const runtimeLines = [
		`- 当前模型：${context.modelId}`,
		`- 上下文上限：${context.contextLimit}`,
	];
	if (typeof context.lastPromptTokens === 'number') {
		runtimeLines.push(`- 上一轮 prompt tokens：${context.lastPromptTokens}`);
	}
	if (typeof context.lastTotalTokens === 'number') {
		runtimeLines.push(`- 上一轮 total tokens：${context.lastTotalTokens}`);
	}
	runtimeLines.push(`- 已压缩次数：${context.compressionCount}`);
	if (context.lastCompressedAt) {
		runtimeLines.push(`- 最近压缩时间：${context.lastCompressedAt}`);
	}
	sections.push(`# 运行时状态\n\n${runtimeLines.join('\n')}`);

	if (context.userConstraints.length > 0) {
		sections.push(
			`# 用户约束\n\n${context.userConstraints.map((line) => `- ${line}`).join('\n')}`,
		);
	}

	if (context.workingMemory.length > 0) {
		sections.push(
			`# 工作记忆\n\n${context.workingMemory.map((line) => `- ${line}`).join('\n')}`,
		);
	}

	if (context.sessionSummary) {
		sections.push(`# 会话摘要\n\n${context.sessionSummary}`);
	}

	return sections;
}

export function extractLegacySummary(runtimeHints: string[]): string | undefined {
	for (const hint of runtimeHints) {
		const looksLikeSummary =
			hint.includes('[执行历史摘要 - 之前会话已压缩]') ||
			/<completed>|<remaining>|<current_state>|<notes>/i.test(hint);
		if (!looksLikeSummary) continue;

		const cleaned = hint
			.replace(/^\[执行历史摘要 - 之前会话已压缩\]\s*/u, '')
			.replace(
				/注意：以上是对之前执行历史的摘要，你处于重建会话状态。\s*请基于摘要继续完成原始任务，不要重复已完成的操作。\s*$/u,
				'',
			)
			.trim();
		if (cleaned) return cleaned;
	}

	return undefined;
}

// 将完整 history 压缩为结构化摘要
// 摘要要能支撑下一轮继续工作：不追求"漂亮"，追求"够用"
export async function compressHistory(
	history: ModelMessage[],
	context: ContextSnapshot = createContextSnapshot(),
): Promise<string> {
	const COMPRESS_SYSTEM = `
你是一个 Agent 执行历史压缩器。将以下执行历史总结为结构化摘要，输出格式如下（使用 XML 标签）：

<completed>
已完成的具体操作（每行一条，保留关键细节）
</completed>

<remaining>
还未完成的任务或子任务
</remaining>

<current_state>
当前状态：已修改的文件路径、关键变量、环境状态等
</current_state>

<notes>
注意事项：踩过的坑、特殊处理、边界条件
</notes>

要求：信息密度高，去掉废话，保留所有对后续执行有用的细节。
`.trim();

	const historyText = history
		.map((message) => {
			const content =
				typeof message.content === 'string'
					? message.content
					: JSON.stringify(message.content);
			return `[${message.role}]\n${content}`;
		})
		.join('\n\n---\n\n');

	const { text } = await generateText({
		model: await resolveLanguageModel(context.modelId),
		system: COMPRESS_SYSTEM,
		prompt: historyText,
	});

	return text;
}

function buildWorkingMemory(summary: string, fallback: string[]): string[] {
	const remaining = extractSection(summary, 'remaining');
	const currentState = extractSection(summary, 'current_state');

	const memory = [
		...sectionLines(remaining).slice(0, 3).map((line) => `待办: ${line}`),
		...sectionLines(currentState).slice(0, 3).map((line) => `状态: ${line}`),
	];

	return normalizeMemoryLines(memory.length > 0 ? memory : fallback.slice(0, 4));
}

function extractSection(summary: string, tag: string): string {
	const pattern = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i');
	const match = summary.match(pattern);
	return match?.[1]?.trim() ?? '';
}

function sectionLines(value: string): string[] {
	return value
		.split('\n')
		.map((line) => line.replace(/^[-*•\d.)\s]+/u, '').trim())
		.filter(Boolean);
}

function normalizeMemoryLines(lines: string[]): string[] {
	const seen = new Set<string>();
	const normalized: string[] = [];

	for (const rawLine of lines) {
		const line = rawLine.replace(/\s+/g, ' ').trim();
		if (!line || seen.has(line)) continue;
		seen.add(line);
		normalized.push(line);
	}

	return normalized.slice(0, 8);
}

function extractMessageText(content: unknown): string {
	if (typeof content === 'string') return content.trim();
	if (Array.isArray(content)) {
		return content.map(extractMessageText).filter(Boolean).join(' ').trim();
	}
	if (!content || typeof content !== 'object') return '';

	const record = content as Record<string, unknown>;
	if (typeof record.text === 'string') return record.text.trim();
	if (typeof record.content === 'string') return record.content.trim();
	if (typeof record.message === 'string') return record.message.trim();
	return '';
}
