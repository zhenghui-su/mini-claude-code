import { expect, test } from 'bun:test';
import { getSlashMatches, parsePlanInput } from '../../src/cli/slash';

test('getSlashMatches filters commands by slash prefix', () => {
	expect(getSlashMatches('/p').map((command) => command.name)).toEqual(['/plan']);
	expect(getSlashMatches('hello')).toEqual([]);
	expect(getSlashMatches('/plan do it')).toEqual([]);
});

test('parsePlanInput extracts a non-empty plan task', () => {
	expect(parsePlanInput('/plan refactor CLI')).toBe('refactor CLI');
	expect(parsePlanInput('/plan   ')).toBeUndefined();
	expect(parsePlanInput('/help')).toBeUndefined();
});
