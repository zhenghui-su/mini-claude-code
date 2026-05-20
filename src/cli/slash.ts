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

export function parsePlanInput(input: string): string | undefined {
	if (!input.startsWith('/plan ')) return undefined;

	const content = input.slice('/plan'.length).trim();
	return content || undefined;
}
