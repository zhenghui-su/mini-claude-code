import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdtemp, realpath, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { createContextSnapshot } from '../../src/agent/context';
import {
	listSessions,
	deleteSession,
	loadSession,
	saveSession,
	summarizeSession,
} from '../../src/agent/session';

let previousCwd: string;
let tempDir: string;
let realTempDir: string;

beforeEach(async () => {
	previousCwd = process.cwd();
	tempDir = await mkdtemp(join(tmpdir(), 'mini-agent-session-'));
	realTempDir = await realpath(tempDir);
	process.chdir(tempDir);
});

afterEach(async () => {
	process.chdir(previousCwd);
	await rm(tempDir, { recursive: true, force: true });
});

test('saveSession, loadSession and listSessions round-trip state', async () => {
	await saveSession('demo session', {
		history: [{ role: 'user', content: 'hello' }],
		context: createContextSnapshot({
			workingMemory: ['hint'],
		}),
	});

	const loaded = await loadSession('demo-session');
	const sessions = await listSessions();

	expect(loaded.name).toBe('demo-session');
	expect(loaded.history).toEqual([{ role: 'user', content: 'hello' }]);
	expect(loaded.context.workingMemory).toEqual(['hint']);
	expect(loaded.cwd).toBe(realTempDir);
	expect(sessions.map((session) => session.name)).toContain('demo-session');
});

test('saveSession stores a preview of the latest assistant reply', async () => {
	const saved = await saveSession('preview', {
		history: [
			{ role: 'user', content: 'question' },
			{ role: 'assistant', content: 'first answer' },
			{ role: 'user', content: 'another question' },
			{ role: 'assistant', content: 'latest answer with useful context' },
		],
		context: createContextSnapshot(),
	});

	expect(summarizeSession(saved)).toMatchObject({
		name: 'preview',
		cwd: realTempDir,
		lastReplyPreview: 'latest answer with useful context',
	});
});

test('deleteSession removes a saved session', async () => {
	await saveSession('remove me', {
		history: [{ role: 'user', content: 'temporary' }],
		context: createContextSnapshot(),
	});

	await deleteSession('remove-me');

	expect(await listSessions()).toEqual([]);
	await expect(loadSession('remove-me')).rejects.toThrow('会话不存在');
});

test('saveSession redacts sensitive tool output content', async () => {
	await saveSession('sensitive', {
		history: [
			{
				role: 'assistant',
				content: [
					{
						type: 'tool-result',
						toolName: 'read_file',
						result: {
							ok: true,
							data: { path: '.env', content: 'SECRET=value' },
						},
					},
				],
			} as never,
		],
		context: createContextSnapshot(),
	});

	const raw = await Bun.file('.mini-claude/sessions/sensitive.json').text();

	expect(raw).not.toContain('SECRET=value');
	expect(raw).toContain('已脱敏');
});

test('loadSession migrates legacy runtimeHints into typed context', async () => {
	await Bun.write(
		'.mini-claude/sessions/legacy.json',
		JSON.stringify(
			{
				name: 'legacy',
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
				cwd: realTempDir,
				history: [],
				runtimeHints: [
					[
						'[执行历史摘要 - 之前会话已压缩]',
						'',
						'<completed>done</completed>',
						'',
						'注意：以上是对之前执行历史的摘要，你处于重建会话状态。',
						'请基于摘要继续完成原始任务，不要重复已完成的操作。',
					].join('\n'),
				],
			},
			null,
			2,
		),
	);

	const session = await loadSession('legacy');

	expect(session.context.sessionSummary).toContain('<completed>done</completed>');
	expect(session.context.compressionCount).toBe(1);
	expect(session.context.workingMemory).toEqual([]);
});
