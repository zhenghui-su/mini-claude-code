import { SYSTEM_PROMPT } from './system-prompt';

// 系统提示词分三段拼装：
//   Segment 1: 静态核心指令
//   Segment 2: 运行时状态（可选，如上下文压缩摘要）

export async function assembleSystemPrompt(
	runtimeHints: string[] = [],
): Promise<string> {
	const segments: string[] = [];

	// Segment 1: 静态指令
	segments.push(SYSTEM_PROMPT);

	// Segment 2: 运行时状态（有则注入）
	if (runtimeHints.length > 0) {
		segments.push('---\n# 运行时状态\n\n' + runtimeHints.join('\n\n'));
	}

	return segments.join('\n\n');
}
