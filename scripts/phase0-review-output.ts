import { writePhase0ArtifactPair } from "./phase0-artifact-output.js";

export async function writePhase0ReviewArtifacts(
  outDir: string,
  json: string,
  markdown: string
): Promise<void> {
  await writePhase0ArtifactPair("review", outDir, [
    { fileName: "phase0-review.json", data: json },
    { fileName: "phase0-review.md", data: markdown }
  ]);
}
