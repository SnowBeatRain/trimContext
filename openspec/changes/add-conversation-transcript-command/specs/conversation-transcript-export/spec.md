## ADDED Requirements

### Requirement: 生成完整规范化会话 Markdown

系统 SHALL 通过 `trimctx export [file] -o <conversation.md>` 将受支持 JSONL 解析得到的每条 `NormalizedMessage` 按解析器返回顺序写入 Markdown，且不经过 tokenizer、safety、scorer、threshold、report 脱敏、内容筛选或长度截断。

#### Scenario: 导出 Claude Code 会话

- **WHEN** 用户对有效 Claude Code JSONL 运行 `trimctx export session.jsonl -o conversation.md`
- **THEN** 输出按源顺序包含解析器识别的每条 system、user、assistant、tool 和 unknown 消息
- **AND** 每条事件的正文与对应 `NormalizedMessage.content` 一致
- **AND** 输入文件字节和 SHA-256 保持不变

#### Scenario: 导出 OpenAI 或 Codex 会话

- **WHEN** 用户对有效 OpenAI 或 Codex/Hermes JSONL 运行 `export` 命令
- **THEN** 系统复用现有格式自动检测和对应 parser
- **AND** 输出消息数等于 `parseJsonl` 返回的消息数
- **AND** 消息顺序与 `parseJsonl` 返回顺序一致

#### Scenario: 消息正文为空

- **WHEN** parser 返回一条 `content` 为空字符串的规范化消息
- **THEN** Markdown 仍包含该消息事件及其空正文围栏
- **AND** 该事件计入总消息数

### Requirement: 输出可审计来源信息

系统 SHALL 在 Markdown 头部记录 `trimctx.transcript.v1` 格式版本、源文件路径、输入 SHA-256、检测格式、可用的 session ID 和规范化消息总数，并为每条事件记录序号、角色、ID、源行及可用的时间戳、父消息和工具关联。

#### Scenario: 消息带有工具关联

- **WHEN** 规范化消息包含 tool name、tool use ID 或 tool result target
- **THEN** 对应事件元数据包含所有可用工具关联字段
- **AND** 工具输入或输出正文保持在该事件正文中

#### Scenario: 消息缺少可选元数据

- **WHEN** 规范化消息没有 timestamp、parent ID、session ID 或 tool 信息
- **THEN** 渲染器省略缺失字段
- **AND** 不生成猜测值

### Requirement: Markdown 结构对任意正文保持稳定

系统 SHALL 使用长度严格大于正文中同类最长分隔符连续串的反引号或波浪号围栏包裹每条正文，使正文中的标题、HTML、链接和已有代码围栏不能结束事件正文或改变外层文档结构。

#### Scenario: 正文包含 Markdown 和代码围栏

- **WHEN** 消息正文包含标题、HTML、三反引号、四反引号或波浪号围栏
- **THEN** 渲染器选择不会与正文冲突的围栏字符和长度
- **AND** 输出完整包含原始正文，没有转义、脱敏或截断正文内容

#### Scenario: 重复生成相同 transcript

- **WHEN** 同一路径下的输入字节和 parser 行为没有变化
- **THEN** 两次生成的 Markdown 字节完全相同
- **AND** 文档不包含生成时间、随机 ID 或其他非确定性字段

### Requirement: 明确全文导出的隐私与归一化边界

系统 SHALL 在文档头部说明产物包含未脱敏的系统指令、对话和工具数据，分享前必须审查；同时说明它是 parser-normalized transcript，而不是原始 JSONL 的逐字节备份。

#### Scenario: 用户检查导出说明

- **WHEN** 用户打开生成的 Markdown
- **THEN** 首个消息事件之前可见未脱敏隐私警告
- **AND** 可见当前格式对应的归一化限制说明
- **AND** 说明 Codex 加密 reasoning 和 parser 当前忽略的运行时记录不属于该导出契约

### Requirement: 文件输出保持原始 transcript 只读

系统 SHALL 只接受大小写不敏感的 `.md` 输出，拒绝输入文件或其文件系统别名，保持输入句柄打开直到原子提交完成，并在解析或写入失败时保留已有目标文件。

#### Scenario: 输出路径与输入相同或为别名

- **WHEN** `-o` 指向输入本身、符号链接或硬链接别名
- **THEN** 命令以非零状态退出
- **AND** 输入内容不变

#### Scenario: 输出扩展名不受支持

- **WHEN** 输出文件不以 `.md` 结尾
- **THEN** 命令在替换目标前失败并说明只支持 `.md`
- **AND** 已存在目标保持不变

#### Scenario: 输入在准备输出期间变化

- **WHEN** 已打开输入的文件身份、大小或时间戳在原子提交前变化
- **THEN** 命令失败且不提交新 transcript
- **AND** 已存在目标保持不变

#### Scenario: JSONL 解析失败

- **WHEN** 输入包含无效 JSONL 或不受支持格式
- **THEN** 命令以非零状态退出并保留文件名与行号诊断（如适用）
- **AND** 不产生部分 transcript 或破坏已有目标

### Requirement: 当前窗口输入只使用可信绑定

系统 SHALL 允许省略 `[file]`，但此时只通过 `resolveBoundSessionFile()` 使用可信 `TRIMCTX_TRANSCRIPT_PATH`，不得扫描或回退到最近修改的会话。

#### Scenario: 当前窗口已正确绑定

- **WHEN** 用户运行 `trimctx export -o conversation.md` 且当前窗口绑定有效
- **THEN** 系统导出绑定文件
- **AND** 不读取其他本地 session

#### Scenario: 当前窗口没有有效绑定

- **WHEN** 用户省略文件且绑定缺失、不可读或 session ID 不匹配
- **THEN** 命令失败并给出修复 hooks 或显式传入文件的提示
- **AND** 不使用 `--latest` 语义猜测输入
