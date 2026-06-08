import type { MessageRole, MessageToolInfo } from "../types/message.js";

export function normalizeRole(role: unknown, fallback: MessageRole = "unknown"): MessageRole {
  if (role === "system" || role === "developer" || role === "user" || role === "assistant" || role === "tool") {
    return role;
  }
  return fallback;
}

export function flattenContent(content: unknown): { text: string; tool?: MessageToolInfo } {
  if (typeof content === "string") {
    return { text: content };
  }

  if (content == null) {
    return { text: "" };
  }

  if (Array.isArray(content)) {
    const parts: string[] = [];
    const tool: MessageToolInfo = {};

    for (const block of content) {
      if (typeof block === "string") {
        parts.push(block);
        continue;
      }
      if (!isRecord(block)) {
        parts.push(String(block));
        continue;
      }

      const type = typeof block.type === "string" ? block.type : "";
      if (typeof block.text === "string") {
        parts.push(block.text);
      } else if (typeof block.thinking === "string") {
        parts.push(block.thinking);
      } else if (type === "tool_use") {
        const id = typeof block.id === "string" ? block.id : undefined;
        const name = typeof block.name === "string" ? block.name : "tool";
        tool.toolUseId = id;
        tool.toolName = name;
        tool.isToolUse = true;
        parts.push(`[tool_use ${name}${id ? ` ${id}` : ""}] ${safeJson(block.input)}`);
      } else if (type === "tool_result") {
        const toolUseId = typeof block.tool_use_id === "string" ? block.tool_use_id : undefined;
        tool.toolResultFor = toolUseId;
        tool.isToolResult = true;
        parts.push(`[tool_result${toolUseId ? ` ${toolUseId}` : ""}] ${flattenUnknown(block.content)}`);
      } else if ("content" in block) {
        parts.push(flattenUnknown(block.content));
      } else {
        parts.push(safeJson(block));
      }
    }

    return { text: parts.filter(Boolean).join("\n"), tool: Object.keys(tool).length > 0 ? tool : undefined };
  }

  if (isRecord(content)) {
    if (typeof content.text === "string") {
      return { text: content.text };
    }
    if ("content" in content) {
      return { text: flattenUnknown(content.content) };
    }
  }

  return { text: flattenUnknown(content) };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function flattenUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(flattenUnknown).filter(Boolean).join("\n");
  }
  if (value == null) {
    return "";
  }
  return safeJson(value);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
