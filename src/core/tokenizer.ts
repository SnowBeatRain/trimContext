export class ApproxTokenizer {
  count(text: string): number {
    const cjk = text.match(/[\u3400-\u9fff]/g)?.length ?? 0;
    const ascii = text.replace(/[\u3400-\u9fff]/g, " ");
    const words = ascii.match(/[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g)?.length ?? 0;
    return Math.max(1, cjk + words);
  }

  countMessage(content: string): number {
    return this.count(content) + 4;
  }
}
