import { expect, test } from 'bun:test';
import { displayWidth, formatDuration, truncateByDisplayWidth } from '../../src/cli/format';

test('formatDuration renders seconds and minutes', () => {
	expect(formatDuration(1_400)).toBe('1s');
	expect(formatDuration(65_000)).toBe('1m 5s');
});

test('truncateByDisplayWidth counts wide characters', () => {
	expect(displayWidth('a你')).toBe(3);
	expect(truncateByDisplayWidth('你好abc', 5)).toBe('你好…');
});
