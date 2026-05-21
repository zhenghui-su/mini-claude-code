import { expect, test } from 'bun:test';
import { createContextSnapshot } from '../../src/agent/context';
import { assembleSystemPrompt } from '../../src/agent/prompt';

test('assembleSystemPrompt injects context sections in stable order', async () => {
	const prompt = await assembleSystemPrompt(
		createContextSnapshot({
			lastPromptTokens: 2048,
			workingMemory: ['Finish /compact'],
			userConstraints: ['Use Chinese'],
			sessionSummary: '<completed>done</completed>',
		}),
		['# 临时指令\n\n只输出计划'],
	);

	const runtimeIndex = prompt.indexOf('# 运行时状态');
	const constraintIndex = prompt.indexOf('# 用户约束');
	const memoryIndex = prompt.indexOf('# 工作记忆');
	const summaryIndex = prompt.indexOf('# 会话摘要');
	const extraIndex = prompt.indexOf('# 临时指令');

	expect(runtimeIndex).toBeGreaterThan(-1);
	expect(constraintIndex).toBeGreaterThan(runtimeIndex);
	expect(memoryIndex).toBeGreaterThan(constraintIndex);
	expect(summaryIndex).toBeGreaterThan(memoryIndex);
	expect(extraIndex).toBeGreaterThan(summaryIndex);
});

test('assembleSystemPrompt skips empty optional context sections', async () => {
	const prompt = await assembleSystemPrompt(createContextSnapshot());

	expect(prompt).toContain('# 运行时状态');
	expect(prompt).not.toContain('# 用户约束');
	expect(prompt).not.toContain('# 工作记忆');
	expect(prompt).not.toContain('# 会话摘要');
});
