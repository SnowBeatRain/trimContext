import { randomBytes } from "node:crypto";
import { lstat, open, rename, rm, type FileHandle } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export type Phase0ArtifactKind = "review" | "run";

export interface Phase0TextArtifact {
  fileName: string;
  data: string;
}

interface StagedArtifact {
  target: string;
  data: string;
  stagePath: string;
  ownsStagePath: boolean;
  destinationExists: boolean;
  backupPath?: string;
  committed: boolean;
}

export async function writePhase0ArtifactPair(
  kind: Phase0ArtifactKind,
  outDir: string,
  artifactInputs: readonly [Phase0TextArtifact, Phase0TextArtifact]
): Promise<void> {
  const artifactDescription = `Phase 0 ${kind} artifact`;
  const artifactsDescription = `${artifactDescription}s`;
  const artifacts = artifactInputs.map((artifact) =>
    createStagedArtifact(join(outDir, artifact.fileName), artifact.data)
  );
  let transactionFailed = false;
  let transactionError: unknown;

  try {
    for (const artifact of artifacts) await stageArtifact(artifact, artifactDescription);
    for (const artifact of artifacts) {
      artifact.destinationExists = await regularFileExists(artifact.target, artifactDescription);
    }

    try {
      for (const artifact of artifacts) await commitArtifact(artifact, artifactDescription);
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      for (const artifact of [...artifacts].reverse()) {
        if (!artifact.committed) continue;
        try {
          await rollbackArtifact(artifact);
        } catch (rollbackError) {
          rollbackErrors.push(...errorComponents(rollbackError));
        }
      }
      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [...errorComponents(error), ...rollbackErrors],
          `Failed to write and restore ${artifactsDescription}`
        );
      }
      throw error;
    }

    const backupCleanupErrors = await cleanupBackups(artifacts);
    if (backupCleanupErrors.length > 0) {
      throw new AggregateError(
        backupCleanupErrors,
        `Failed to clean up ${artifactDescription} backups`
      );
    }
  } catch (error) {
    transactionFailed = true;
    transactionError = error;
    throw error;
  } finally {
    const stageCleanupErrors = await cleanupStages(artifacts);
    if (stageCleanupErrors.length > 0) {
      throw new AggregateError(
        [
          ...(transactionFailed ? errorComponents(transactionError) : []),
          ...stageCleanupErrors
        ],
        `Failed to write or clean up ${artifactsDescription}`
      );
    }
  }
}

function createStagedArtifact(target: string, data: string): StagedArtifact {
  return {
    target,
    data,
    stagePath: temporarySibling(target, "stage"),
    ownsStagePath: false,
    destinationExists: false,
    committed: false
  };
}

async function stageArtifact(artifact: StagedArtifact, artifactDescription: string): Promise<void> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(artifact.stagePath, "wx");
    artifact.ownsStagePath = true;
    await handle.writeFile(artifact.data, "utf8");
    await handle.close();
    handle = undefined;
  } catch (error) {
    if (handle === undefined) throw error;
    try {
      await handle.close();
    } catch (closeError) {
      throw new AggregateError(
        [...errorComponents(error), ...errorComponents(closeError)],
        `Failed to stage ${artifactDescription}: ${artifact.target}`
      );
    }
    throw error;
  }
}

async function regularFileExists(file: string, artifactDescription: string): Promise<boolean> {
  try {
    const target = await lstat(file);
    if (!target.isFile()) {
      throw new Error(`${artifactDescription} target must be a regular file: ${file}`);
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function commitArtifact(artifact: StagedArtifact, artifactDescription: string): Promise<void> {
  if (!artifact.destinationExists) {
    await rename(artifact.stagePath, artifact.target);
    artifact.ownsStagePath = false;
    artifact.committed = true;
    return;
  }

  const backupPath = temporarySibling(artifact.target, "bak");
  await rename(artifact.target, backupPath);
  artifact.backupPath = backupPath;
  try {
    await rename(artifact.stagePath, artifact.target);
    artifact.ownsStagePath = false;
    artifact.committed = true;
  } catch (error) {
    try {
      await rename(backupPath, artifact.target);
      artifact.backupPath = undefined;
    } catch (restoreError) {
      throw new AggregateError(
        [...errorComponents(error), ...errorComponents(restoreError)],
        `Failed to write and restore ${artifactDescription}: ${artifact.target}`
      );
    }
    throw error;
  }
}

async function rollbackArtifact(artifact: StagedArtifact): Promise<void> {
  await rm(artifact.target, { force: true });
  if (artifact.destinationExists && artifact.backupPath !== undefined) {
    await rename(artifact.backupPath, artifact.target);
    artifact.backupPath = undefined;
  }
  artifact.committed = false;
}

async function cleanupBackups(artifacts: readonly StagedArtifact[]): Promise<unknown[]> {
  const results = await Promise.allSettled(artifacts.map(async (artifact) => {
    if (artifact.backupPath === undefined) return;
    await rm(artifact.backupPath, { force: true });
    artifact.backupPath = undefined;
  }));
  return results.flatMap((result) =>
    result.status === "rejected" ? errorComponents(result.reason) : []
  );
}

async function cleanupStages(artifacts: readonly StagedArtifact[]): Promise<unknown[]> {
  const results = await Promise.allSettled(artifacts.map(async (artifact) => {
    if (!artifact.ownsStagePath) return;
    await rm(artifact.stagePath, { force: true });
    artifact.ownsStagePath = false;
  }));
  return results.flatMap((result) =>
    result.status === "rejected" ? errorComponents(result.reason) : []
  );
}

function temporarySibling(target: string, suffix: "stage" | "bak"): string {
  return join(
    dirname(target),
    `.${basename(target)}.trimctx-${randomBytes(8).toString("hex")}.${suffix}`
  );
}

function errorComponents(error: unknown): unknown[] {
  return error instanceof AggregateError
    ? error.errors.flatMap((component) => errorComponents(component))
    : [error];
}
