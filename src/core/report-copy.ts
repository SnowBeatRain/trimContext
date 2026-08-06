import type {
  AnalysisReport,
  Finding,
  HealthDimension,
  Recommendation,
  ReviewQueueItem
} from "../types/report.js";
import type { ResumeReadiness } from "../types/resume.js";
import type { EvidenceConfidence } from "../types/signals.js";

const HEALTH_STATUS_LABELS: Record<AnalysisReport["assessment"]["status"], string> = {
  healthy: "健康",
  attention: "需关注",
  degraded: "已劣化",
  unknown: "未知"
};

const CONFIDENCE_LABELS: Record<EvidenceConfidence, string> = {
  high: "高",
  medium: "中",
  low: "低"
};

const LEVEL_LABELS: Record<HealthDimension["level"], string> = {
  high: "高",
  medium: "中",
  low: "低",
  unknown: "未知"
};

const READINESS_LABELS: Record<ResumeReadiness["level"], string> = {
  ready: "就绪",
  partial: "部分就绪",
  blocked: "受阻"
};

const LIMITATION_LABELS: Record<string, string> = {
  sample_too_short: "样本过短，无法形成可靠结论。",
  protected_coverage_too_high: "Protected 内容占比过高，可分析证据不足。",
  unknown_role_coverage_too_high: "未知角色内容占比过高，角色证据不足。",
  analyzable_coverage_too_low: "可分析消息占比过低，无法形成可靠结论。",
  insufficient_positive_evidence: "正向证据不足，不能判定会话健康。"
};

const ASSESSMENT_SUMMARIES: Record<string, string> = {
  "Insufficient observable evidence for a reliable health label.": "可观测证据不足，无法给出可靠的健康判断。",
  "Multiple high-confidence or token-weighted risk signals require action.": "存在多个高置信或按 token 加权的风险信号，需要处理。",
  "Reviewable context risks are present, but evidence does not meet degraded thresholds.": "检测到需要复核的上下文风险，但尚未达到劣化阈值。",
  "Sufficient observable evidence indicates low context risk.": "现有可观测证据表明上下文风险较低。",
  "Positive evidence is insufficient for a healthy label.": "正向证据不足，无法判定会话健康。"
};

const MISSING_EVIDENCE_LABELS: Record<string, string> = {
  "current goal": "当前目标",
  "user decisions": "用户决策",
  "active files": "活跃文件",
  "test signals": "测试信号",
  "next steps": "下一步"
};

const RECOMMENDATION_SUMMARIES: Record<Recommendation["code"], string> = {
  write_report: "先生成完整 JSON 报告，再判断会话健康状态。",
  clarify_continuation: "继续会话前，补充缺失的续接证据。",
  new_chat: "生成经过审查的新会话续接包。",
  review_then_compress: "审查删除候选后，再生成压缩副本。"
};

const ACTION_LABELS: Record<Finding["suggested_action"], string> = {
  review_superseded_context: "复核已被取代的上下文",
  keep_canonical_message: "保留规范消息并复核重复项",
  review_tool_evidence: "复核工具调用证据",
  review_metadata: "复核低价值元数据",
  collect_more_evidence: "收集更多证据"
};

const RISK_LABELS: Record<ReviewQueueItem["risk"], string> = {
  high: "高",
  medium: "中",
  low: "低"
};

export function healthStatusLabel(value: AnalysisReport["assessment"]["status"]): string {
  return HEALTH_STATUS_LABELS[value];
}

export function confidenceLabel(value: EvidenceConfidence): string {
  return CONFIDENCE_LABELS[value];
}

export function dimensionLevelLabel(value: HealthDimension["level"]): string {
  return LEVEL_LABELS[value];
}

export function readinessLabel(value: ResumeReadiness["level"]): string {
  return READINESS_LABELS[value];
}

export function limitationLabel(value: string): string {
  return LIMITATION_LABELS[value] ?? value;
}

export function assessmentSummaryLabel(value: string): string {
  return ASSESSMENT_SUMMARIES[value] ?? value;
}

export function missingEvidenceLabel(value: string): string {
  return MISSING_EVIDENCE_LABELS[value] ?? value;
}

export function recommendationSummaryLabel(
  recommendation: Recommendation,
  missingEvidence: readonly string[]
): string {
  if (recommendation.code === "clarify_continuation" && missingEvidence.length > 0) {
    return `继续会话前，补充缺失的${missingEvidence.map(missingEvidenceLabel).join("、")}。`;
  }
  return RECOMMENDATION_SUMMARIES[recommendation.code] ?? recommendation.summary;
}

export function suggestedActionLabel(value: Finding["suggested_action"]): string {
  return ACTION_LABELS[value];
}

export function riskLabel(value: ReviewQueueItem["risk"]): string {
  return RISK_LABELS[value];
}

export function dimensionSummaryLabel(value: string): string {
  const patterns: Array<[RegExp, (count: string) => string]> = [
    [/^(\d+) estimated tokens$/, count => `约 ${count} tokens`],
    [/^(\d+) stale-evidence tokens$/, count => `${count} tokens 命中陈旧证据`],
    [/^(\d+) repeated-context tokens$/, count => `${count} tokens 属于重复上下文`],
    [/^(\d+) tool-noise tokens$/, count => `${count} tokens 属于工具噪声`],
    [/^(\d+) warning\(s\); role and content coverage measured\.$/, count => `${count} 条警告；已统计角色和内容覆盖率`]
  ];
  for (const [pattern, format] of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return format(match[1]);
  }

  const exact: Record<string, string> = {
    "Continuation evidence is ready.": "续接证据已就绪。",
    "Continuation evidence is partial.": "续接证据不完整。",
    "Continuation evidence is blocked.": "续接证据不足，当前处于受阻状态。"
  };
  return exact[value] ?? value;
}

export function findingCopy(finding: Finding): Pick<Finding, "title" | "explanation" | "summary"> {
  const count = finding.impact.message_count;
  switch (finding.code) {
    case "superseded":
      return {
        title: "已取代上下文证据",
        explanation: "后续消息提供了替代或修正内容，相关旧消息需人工复核。",
        summary: `${count} 条消息被归入已取代上下文组。`
      };
    case "exact_duplicate":
      return {
        title: "重复上下文证据",
        explanation: "完全重复的消息被归为同一组，需人工确认保留项。",
        summary: `${count} 条消息被归入完全重复内容组。`
      };
    case "similar_duplicate":
      return {
        title: "相似上下文证据",
        explanation: "高度相似的消息被归为同一组，需人工确认其差异是否重要。",
        summary: `${count} 条消息被归入相似内容组。`
      };
    case "orphan_tool_result":
      return {
        title: "孤立工具结果证据",
        explanation: "工具结果缺少可信的后续引用，需人工确认是否仍有价值。",
        summary: `${count} 条消息被归入孤立工具结果组。`
      };
    case "obsolete_tool_output":
      return {
        title: "过时工具输出证据",
        explanation: "后续工具输出可能已经取代这些结果，需人工复核。",
        summary: `${count} 条消息被归入过时工具输出组。`
      };
    case "low_value_metadata":
      return {
        title: "低价值元数据证据",
        explanation: "这些元事件通常不承载当前任务所需的业务上下文。",
        summary: `${count} 条消息被归入低价值元数据组。`
      };
    default:
      if (finding.type === "limitation") {
        return {
          title: `评估限制：${limitationLabel(finding.code)}`,
          explanation: "证据覆盖范围限制了整体健康评估的置信度。",
          summary: limitationLabel(finding.code)
        };
      }
      return {
        title: finding.title,
        explanation: finding.explanation,
        summary: finding.summary
      };
  }
}
