import { expect, test } from 'bun:test';
import {
	completeSlashInput,
	getSlashMatches,
	moveSlashSelection,
	normalizeSlashSelection,
	parsePlanInput,
} from '../../src/cli/slash';

test('getSlashMatches filters commands by slash prefix', () => {
	expect(getSlashMatches('/p').map((command) => command.name)).toEqual(['/plan']);
	expect(getSlashMatches('/c').map((command) => command.name)).toEqual([
		'/context',
		'/compact',
	]);
	expect(getSlashMatches('hello')).toEqual([]);
	expect(getSlashMatches('/plan do it')).toEqual([]);
});

test('parsePlanInput extracts a non-empty plan task', () => {
	expect(parsePlanInput('/plan refactor CLI')).toBe('refactor CLI');
	expect(parsePlanInput('/plan   ')).toBeUndefined();
	expect(parsePlanInput('/help')).toBeUndefined();
});

test('slash command selection cycles and completes the selected command', () => {
	expect(normalizeSlashSelection('/c', 10)).toBe(0);
	expect(moveSlashSelection('/c', 0, 1)).toBe(1);
	expect(moveSlashSelection('/c', 0, -1)).toBe(1);
	expect(completeSlashInput('/c', 1)).toBe('/compact');
	expect(completeSlashInput('/p', 0)).toBe('/plan ');
	expect(completeSlashInput('/m', 0)).toBe('/model');
	expect(completeSlashInput('hello', 0)).toBeUndefined();
});
