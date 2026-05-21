import { SYSTEM_PROMPT } from './system-prompt';
import {
	buildPromptContextSections,
	createContextSnapshot,
	type ContextSnapshot,
} from './context';

// 系统提示词分三段拼装：
//   Segment 1: 静态核心指令
//   Segment 2: 运行时状态（可选，如上下文压缩摘要）

export async function assembleSystemPrompt(
	context: ContextSnapshot = createContextSnapshot(),
	extraSections: string[] = [],
): Promise<string> {
	const segments: string[] = [];

	// Segment 1: 静态指令
	segments.push(SYSTEM_PROMPT);

	segments.push(
		...buildPromptContextSections(context).map((section) => `---\n${section}`),
	);
	segments.push(...extraSections.map((section) => `---\n${section}`));

	return segments.join('\n\n');
}
