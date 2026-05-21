import type { SlashCommand } from './types';
import { theme } from './theme';

export const PROMPT_LABEL = '> ';
export const PROMPT_TEXT = theme.prompt(PROMPT_LABEL);
export const PROMPT_COLUMNS = PROMPT_LABEL.length;

export const SLASH_COMMANDS: SlashCommand[] = [
	{ name: '/help', description: '查看命令帮助' },
	{ name: '/plan', description: '本轮先制定计划再执行' },
	{ name: '/context', description: '查看当前上下文状态与压缩信息' },
	{ name: '/compact', description: '立即压缩当前上下文并生成摘要' },
	{ name: '/model', description: '打开模型选择器，新增、切换、默认或管理模型' },
	{ name: '/reset', description: '清空当前会话历史，重新开始' },
	{ name: '/sessions', description: '管理已保存会话' },
	{ name: '/exit', description: '退出' },
];
