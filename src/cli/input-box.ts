import { PROMPT_COLUMNS, PROMPT_LABEL } from './constants';
import { displayWidth, truncateByDisplayWidth } from './format';

const BOX_WIDTH_FALLBACK = 80;
const BOX_PROMPT = '\x1b[34m';
const BOX_TEXT = '\x1b[37m';
const ANSI_RESET = '\x1b[0m';

export interface InputBoxRender {
	lines: string[];
	text: string;
	cursorColumn: number;
	cursorLineIndex: number;
	visibleValue: string;
}

interface InputBoxOptions {
	colors?: boolean;
	width?: number;
}

export function renderInputBox(
	value: string,
	options: InputBoxOptions = {},
): InputBoxRender {
	const colors = options.colors ?? Boolean(process.stdout.isTTY);
	const normalized = value.replace(/\r?\n/gu, ' ');
	const terminalWidth =
		options.width ?? (process.stdout.columns ?? BOX_WIDTH_FALLBACK) - 1;
	const width = Math.max(1, terminalWidth);
	const visibleValue = truncateByDisplayWidth(
		normalized,
		Math.max(1, width - PROMPT_COLUMNS),
	);
	const line = colors
		? `${BOX_PROMPT}${PROMPT_LABEL}${ANSI_RESET}${BOX_TEXT}${visibleValue}${ANSI_RESET}`
		: `${PROMPT_LABEL}${visibleValue}`;
	const lines = [line];

	return {
		lines,
		text: lines.join('\n'),
		cursorColumn: PROMPT_COLUMNS + displayWidth(visibleValue),
		cursorLineIndex: 0,
		visibleValue,
	};
}
