import { expect, test } from 'bun:test';
import { createContextSnapshot } from '../../src/agent/context';
import type { SavedSession } from '../../src/agent/session';
import {
	buildSessionTranscript,
	renderSessionListLines,
} from '../../src/cli/resume';

test('buildSessionTranscript renders markdown and hides tool-call progress text', () => {
	const session: SavedSession = {
		name: 'demo',
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		cwd: process.cwd(),
		lastReplyPreview: 'reply',
		context: createContextSnapshot(),
		history: [
			{ role: 'user', content: '你好，这是什么项目' },
			{
				role: 'assistant',
				content: [
					{
						type: 'tool-call',
						toolCallId: 'call_1',
						toolName: 'list_files',
						input: { depth: 2 },
					},
					{ type: 'text', text: '让我先看看当前工作目录的结构。' },
				],
			} as never,
			{
				role: 'tool',
				content: [
					{
						type: 'tool-result',
						toolCallId: 'call_1',
						toolName: 'list_files',
						output: { type: 'text', value: 'ok' },
					},
				],
			} as never,
			{
				role: 'assistant',
				content: [
					{
						type: 'text',
						text: [
							'这就是 **mini-claude-code** 项目。',
							'',
							'- **终端运行**：直接在命令行里交互。',
							'',
							'运行方式：`bun src/index.ts`',
						].join('\n'),
					},
				],
			},
		],
	};

	const transcript = buildSessionTranscript(session, { colors: false });

	expect(transcript).toContain('已恢复历史记录：');
	expect(transcript).toContain('── 第 1 轮 ──');
	expect(transcript).toContain('> 你好，这是什么项目');
	expect(transcript).toContain('Agent\n这就是 mini-claude-code 项目。');
	expect(transcript).toContain('• 终端运行：直接在命令行里交互。');
	expect(transcript).toContain('运行方式：bun src/index.ts');
	expect(transcript).not.toContain('让我先看看当前工作目录的结构。');
	expect(transcript).not.toContain('**');
	expect(transcript).not.toContain('`');
});

test('renderSessionListLines supports session management with delete prompt', () => {
	const session: SavedSession = {
		name: 'demo',
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		cwd: process.cwd(),
		lastReplyPreview: 'reply',
		context: createContextSnapshot(),
		history: [],
	};

	const lines = renderSessionListLines([session], 0, {
		mode: 'manage',
		colors: false,
		width: 80,
		deleteIndex: 0,
	});

	expect(lines[0]).toBe('管理历史会话');
	expect(lines[1]).toBe('↑/↓ 选择，d 删除，q 返回');
	expect(lines[2]).toContain('› ');
	expect(lines[2]).toContain('reply');
	expect(lines[3]).toBe('确认删除该会话？按 y 删除，n 取消');
});
