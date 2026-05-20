import type { SlashCommand } from './types';

export const PROMPT_TEXT = '\x1b[34m> \x1b[0m';
export const PROMPT_COLUMNS = 2;

export const SLASH_COMMANDS: SlashCommand[] = [
	{ name: '/help', description: '查看命令帮助' },
	{ name: '/plan', description: '本轮先制定计划再执行' },
	{ name: '/reset', description: '清空当前会话历史，重新开始' },
	{ name: '/sessions', description: '列出已保存会话' },
	{ name: '/exit', description: '退出' },
];
