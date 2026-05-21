import packageJson from '../../package.json';
import { SLASH_COMMANDS } from './constants';

export function printHelp() {
	console.log(`
\x1b[1mmini-claude-code\x1b[0m — 教学用 Code Agent

\x1b[1m可用命令：\x1b[0m
${SLASH_COMMANDS.map((command) => `  ${command.name}   ${command.description}`).join('\n')}

\x1b[1m可用工具：\x1b[0m
  list_files  列出项目文件
  search      搜索项目内容
  read_file   读取文件
  write_file  写入文件
  edit_file   局部编辑文件
  bash        执行 Shell 命令
  web_fetch   抓取网页内容
`);
}

export function printCliHelp() {
	console.log(`mini-claude-code ${packageJson.version}

Usage:
  minicc              启动新的本地 Code Agent 会话
  minicc resume       选择并恢复当前目录下的历史会话
  minicc --help       显示帮助
  minicc -h           显示帮助
  minicc -V           显示版本
  minicc --version    显示版本

In app:
  /help               查看交互命令
  /plan <任务>        本轮先制定计划再执行
  /context            查看当前上下文状态与压缩信息
  /compact            立即压缩当前上下文并生成摘要
  /model              打开模型选择器，支持新增、切换、默认和管理模型
  /sessions           管理当前目录历史会话，可删除
  /reset              清空当前会话并开启新会话
  /exit               退出
`);
}
