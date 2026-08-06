import { writePhase0ArtifactPair } from "./phase0-artifact-output.js";

export async function writePhase0RunArtifacts(
  outDir: string,
  json: string,
  markdown: string
): Promise<void> {
  await writePhase0ArtifactPair("run", outDir, [
    { fileName: "phase0-results.json", data: json },
    { fileName: "validation-summary.md", data: markdown }
  ]);
}
