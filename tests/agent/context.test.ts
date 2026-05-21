import { expect, test } from 'bun:test';
import type { ModelMessage } from 'ai';
import {
	compactContext,
	createContextSnapshot,
	recordUsage,
	shouldCompress,
} from '../../src/agent/context';

test('recordUsage stores prompt and total tokens on context snapshot', () => {
	const context = recordUsage(createContextSnapshot(), {
		inputTokens: 1200,
		inputTokenDetails: {
			noCacheTokens: 1200,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		},
		outputTokens: 300,
		outputTokenDetails: {
			textTokens: 300,
			reasoningTokens: 0,
		},
		totalTokens: 1500,
	});

	expect(context.lastPromptTokens).toBe(1200);
	expect(context.lastTotalTokens).toBe(1500);
});

test('compactContext replaces history with session summary and derived memory', async () => {
	const history: ModelMessage[] = [
		{ role: 'user', content: '继续完成 HUD 和 compact 功能' },
		{ role: 'assistant', content: '我会先整理上下文状态模型。' },
	];

	const result = await compactContext({
		history,
		context: createContextSnapshot({
			workingMemory: ['旧记忆'],
		}),
		reason: 'manual',
		now: '2026-05-21T00:00:00.000Z',
		compressor: async () => `
<completed>
新增 HUD 状态栏
</completed>

<remaining>
- 接上 /compact 命令
</remaining>

<current_state>
- context 已改成 typed snapshot
</current_state>

<notes>
- 保持旧 session 兼容
</notes>
`.trim(),
	});

	expect(result.history).toEqual([]);
	expect(result.previousMessageCount).toBe(2);
	expect(result.context.compressionCount).toBe(1);
	expect(result.context.lastCompressedAt).toBe('2026-05-21T00:00:00.000Z');
	expect(result.context.sessionSummary).toContain('<completed>');
	expect(result.context.workingMemory).toEqual([
		'待办: 接上 /compact 命令',
		'状态: context 已改成 typed snapshot',
	]);
});

test('compactContext keeps state unchanged when history is empty', async () => {
	await expect(
		compactContext({
			history: [],
			context: createContextSnapshot(),
			reason: 'manual',
			compressor: async () => '<completed>noop</completed>',
		}),
	).rejects.toThrow('当前没有可压缩的历史记录');
});

test('shouldCompress uses the configured context limit threshold', () => {
	expect(shouldCompress(90, 100)).toBe(true);
	expect(shouldCompress(70, 100)).toBe(false);
});
