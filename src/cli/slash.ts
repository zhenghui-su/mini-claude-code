import { SLASH_COMMANDS } from './constants';
import type { SlashCommand } from './types';

export function getSlashMatches(
	input: string,
	commands: SlashCommand[] = SLASH_COMMANDS,
): SlashCommand[] {
	const slashInput = input.trimStart();
	if (!slashInput.startsWith('/')) return [];
	if (slashInput.includes(' ')) return [];

	return commands.filter((command) => command.name.startsWith(slashInput));
}

export function normalizeSlashSelection(
	input: string,
	selectedIndex: number,
	commands: SlashCommand[] = SLASH_COMMANDS,
): number {
	const matches = getSlashMatches(input, commands);
	if (matches.length === 0) return 0;

	return ((selectedIndex % matches.length) + matches.length) % matches.length;
}

export function moveSlashSelection(
	input: string,
	selectedIndex: number,
	direction: 1 | -1,
	commands: SlashCommand[] = SLASH_COMMANDS,
): number {
	const matches = getSlashMatches(input, commands);
	if (matches.length === 0) return 0;

	return normalizeSlashSelection(input, selectedIndex + direction, commands);
}

export function completeSlashInput(
	input: string,
	selectedIndex: number,
	commands: SlashCommand[] = SLASH_COMMANDS,
): string | undefined {
	const matches = getSlashMatches(input, commands);
	if (matches.length === 0) return undefined;

	const index = normalizeSlashSelection(input, selectedIndex, commands);
	const command = matches[index];
	if (!command) return undefined;

	return command.name === '/plan' ? `${command.name} ` : command.name;
}

export function parsePlanInput(input: string): string | undefined {
	if (!input.startsWith('/plan ')) return undefined;

	const content = input.slice('/plan'.length).trim();
	return content || undefined;
}
