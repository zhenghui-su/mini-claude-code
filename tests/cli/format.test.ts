import { expect, test } from 'bun:test';
import {
	displayWidth,
	formatCwdPath,
	formatDuration,
	getUsageRing,
	renderHudLine,
	renderTerminalMarkdown,
	truncateByDisplayWidth,
} from '../../src/cli/format';

test('formatDuration renders seconds and minutes', () => {
	expect(formatDuration(1_400)).toBe('1s');
	expect(formatDuration(65_000)).toBe('1m 5s');
});

test('truncateByDisplayWidth counts wide characters', () => {
	expect(displayWidth('a你')).toBe(3);
	expect(truncateByDisplayWidth('你好abc', 5)).toBe('你好…');
});

test('formatCwdPath shortens the home directory to tilde', () => {
	const home = process.env.HOME ?? '/Users/demo';
	expect(formatCwdPath(`${home}/project/demo`)).toBe('~/project/demo');
	expect(formatCwdPath('/tmp/project')).toBe('/tmp/project');
});

test('getUsageRing maps percentage ranges to circle states', () => {
	expect(getUsageRing(0)).toBe('○');
	expect(getUsageRing(10)).toBe('◔');
	expect(getUsageRing(30)).toBe('◑');
	expect(getUsageRing(70)).toBe('◕');
	expect(getUsageRing(95)).toBe('◉');
});

test('renderTerminalMarkdown removes markdown syntax for terminal output', () => {
	const output = renderTerminalMarkdown(
		[
			'## 当前上下文',
			'',
			'### 会话状态',
			'',
			'- 历史消息：`0`',
			'- 会话摘要：`无`',
		].join('\n'),
		{ colors: false },
	);

	expect(output).toBe(
		[
			'当前上下文',
			'',
			'会话状态',
			'',
			'• 历史消息：0',
			'• 会话摘要：无',
		].join('\n'),
	);
});

test('renderHudLine right-aligns within the terminal width', () => {
	const output = renderHudLine({
		modelId: 'model',
		cwd: '/tmp/project',
		usage: { ring: '○', percent: 0, used: '0', limit: '100k' },
		colors: false,
		width: 40,
	});

	expect(output).toBe('       model  /tmp/project  ○ 0% 0/100k');
});
