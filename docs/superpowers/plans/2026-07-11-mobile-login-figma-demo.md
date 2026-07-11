# 移动端登录页 Figma Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在新的 Figma Design 文件中创建并交付一个 393 × 852 的极简浅色移动端 App 登录页面。

**Architecture:** 先通过 Figma 账户信息确定可用计划并新建文件，再使用 Figma Plugin API 创建一个采用纵向 Auto Layout 的可编辑页面。最后获取截图进行视觉验收；若存在溢出或布局问题，则在原文件中修正后重新检查。

**Tech Stack:** Figma MCP、Figma Plugin API、Inter 字体、Auto Layout、SVG 图标

---

### Task 1: 创建 Figma 文件

**Files:**
- Create: Figma Design 文件 `Mobile App Login Demo`

- [ ] **Step 1: 获取当前 Figma 用户及可用计划**

调用 `whoami`，读取账户的 plans 列表。

Expected: 返回至少一个包含 `key` 的可用计划。

- [ ] **Step 2: 创建新的设计文件**

调用 `create_new_file`：

```json
{
  "editorType": "design",
  "fileName": "Mobile App Login Demo",
  "planKey": "<whoami 返回的唯一计划 key>"
}
```

Expected: 返回新文件的 `file_key` 与可访问 URL。

### Task 2: 构建登录页面

**Files:**
- Modify: Figma 文件 `Mobile App Login Demo`

- [ ] **Step 1: 检查新文件页面结构**

调用只读 `use_figma`，返回页面名称、ID 和顶层节点数量，确认文件为空并取得当前页面。

Expected: 至少有一个页面，且不存在需要保留的用户内容。

- [ ] **Step 2: 创建 393 × 852 主画板**

使用 `use_figma` 创建名为 `Mobile Login / Light` 的 Frame，尺寸 393 × 852，背景色 `#F8FAFF`，放置在画布可见区域，并启用裁剪。

Expected: 返回主 Frame ID。

- [ ] **Step 3: 创建页面内容**

在主 Frame 内使用 Auto Layout 创建：

- 顶部安全区和品牌 Logo
- `欢迎回来` 标题与辅助说明
- 邮箱和密码输入区
- 忘记密码链接
- 品牌色登录按钮
- `或使用以下方式登录` 分隔区
- Apple、Google 登录按钮
- 底部注册链接
- Home Indicator

统一使用 Inter 字体；颜色、圆角、边框和阴影遵循设计规范。眼睛、Apple、Google 图形均通过 SVG 创建，避免旋转线段造成图标错位。

Expected: 所有内容位于 393 × 852 Frame 内，结构清晰、图层可编辑，并返回所有创建节点 ID。

### Task 3: 视觉验证与交付

**Files:**
- Inspect: Figma Frame `Mobile Login / Light`

- [ ] **Step 1: 获取页面截图**

调用 `get_screenshot`，目标为主 Frame ID，设置足够的 `maxDimension` 以检查文字、间距和边框。

Expected: 返回完整页面 PNG 预览，不出现截断、溢出、重叠或缺失字体。

- [ ] **Step 2: 修正视觉问题**

若截图存在布局问题，使用 `use_figma` 修改对应节点，并再次调用 `get_screenshot` 验证。

Expected: 页面结构完整，主次层级明确，按钮和表单对齐一致。

- [ ] **Step 3: 交付**

向用户提供 Figma 文件链接，并说明页面名称、尺寸、视觉风格及可编辑状态。

Expected: 用户可以打开新 Figma 文件查看和编辑 Demo 页面。
