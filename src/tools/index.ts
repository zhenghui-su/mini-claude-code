import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { readFile } from './read-file';
import { writeFile } from './write-file';
import { editFile } from './edit-file';
import { bash } from './bash';
import { webFetch } from './web-fetch';

// 工具注册表
// Vercel AI SDK 的 tool() 封装了 inputSchema(Zod) 和执行函数
// SDK 自动处理：参数解析 → 执行 → 结果回填到 history
export const TOOLS = {
	read_file: tool({
		description:
			'读取本地文件内容。大文件建议用 offset + limit 分段读取，避免一次性读取撑爆上下文。输出带行号，方便定位。',
		inputSchema: z.object({
			path: z.string().min(1).describe('文件路径(相对于当前工作目录)'),
			offset: z
				.number()
				.int()
				.nonnegative()
				.optional()
				.describe('从第几行开始读(0-indexed,默认从头)'),
			limit: z
				.number()
				.int()
				.positive()
				.optional()
				.describe('最多读取多少行(默认读到文件末尾)'),
		}),
		execute: async (params) => readFile(params),
	}),

	write_file: tool({
		description:
			'将内容写入文件。文件不存在则创建，已存在则完整覆盖。局部修改请用 edit_file，避免不必要的全量重写。',
		inputSchema: z.object({
			path: z.string().min(1).describe('文件路径(相对于当前工作目录)'),
			content: z.string().describe('要写入的完整文件内容'),
		}),
		execute: async (params) => writeFile(params),
	}),

	edit_file: tool({
		description:
			'替换文件中的特定字符串。old_string 必须在文件中唯一存在(仅出现一次)，否则会报错。建议先用 read_file 确认目标字符串。',
		inputSchema: z.object({
			path: z.string().min(1).describe('文件路径(相对于当前工作目录)'),
			old_string: z.string().min(1).describe('要被替换的原始字符串，必须唯一'),
			new_string: z.string().describe('替换后的新字符串'),
		}),
		execute: async (params) => editFile(params),
	}),

	bash: tool({
		description:
			'执行 Shell 命令。危险命令(如 rm -rf)会暂停并等待用户确认。命令输出超长时自动截断。',
		inputSchema: z.object({
			command: z.string().min(1).describe('要执行的 Shell 命令'),
			timeout: z
				.number()
				.int()
				.positive()
				.optional()
				.describe('超时时间(毫秒)，默认 30000'),
		}),
		execute: async (params) => bash(params),
	}),

	web_fetch: tool({
		description:
			'抓取网页内容并转换为 Markdown 格式返回。适合查阅文档、README、API 参考等。',
		inputSchema: z.object({
			url: z.string().url().describe('要抓取的完整 URL(包含 https://)'),
		}),
		execute: async (params) => webFetch(params),
	}),
} satisfies ToolSet;
