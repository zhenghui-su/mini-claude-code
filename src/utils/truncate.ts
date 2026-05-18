// 工具输出截断保护
// 单次工具返回超过此长度时截断，并附加 system_hint 告知 LLM
const MAX_TOOL_OUTPUT = 8_000;
/**
 * 截断工具输出并添加提示
 * @param toolName 工具名称，用于提示中说明哪个工具的输出被截断
 * @param output 工具的原始输出
 * @returns 截断后的输出，如果原始输出未超过限制则返回原始输出
 */
export function truncateOutput(toolName: string, output: string): string {
	if (output.length <= MAX_TOOL_OUTPUT) return output;

	const truncated = output.slice(0, MAX_TOOL_OUTPUT);

	// 用结构化的 system_hint 告知 LLM 内容被截断，而非直接截断
	// 这样 LLM 不会误以为"内容就这么多"，而是知道还有更多内容
	const hint = [
		'',
		`<system_hint type="tool_output_omitted" tool="${toolName}" reason="too_long"`,
		`             actual_chars="${output.length}" max_chars="${MAX_TOOL_OUTPUT}">`,
		`  工具输出过长，已自动截断。如需完整内容，请用 offset/limit 参数分段调用。`,
		`</system_hint>`,
	].join('\n');

	return truncated + hint;
}
