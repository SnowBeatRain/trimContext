import { randomBytes } from "node:crypto";
import { cp, mkdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { InitAsset } from "./init-plan.js";

export interface InitAssetTransactionEntry {
  asset: InitAsset;
  destinationExists: boolean;
}

interface StagedAsset {
  entry: InitAssetTransactionEntry;
  stagePath: string;
  backupPath?: string;
  committed: boolean;
}

export async function installInitAssetTransaction(
  entries: readonly InitAssetTransactionEntry[]
): Promise<void> {
  const stagedAssets: StagedAsset[] = [];
  let transactionFailed = false;
  let transactionError: unknown;
  try {
    for (const entry of entries) {
      const parent = dirname(entry.asset.destination);
      await mkdir(parent, { recursive: true });
      const stagePath = temporarySibling(entry.asset.destination, "stage");
      stagedAssets.push({ entry, stagePath, committed: false });
      await cp(entry.asset.source, stagePath, {
        recursive: true,
        force: false,
        errorOnExist: true
      });
    }

    try {
      for (const staged of stagedAssets) {
        await commitStagedAsset(staged);
      }
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      for (const staged of [...stagedAssets].reverse()) {
        if (!staged.committed) continue;
        try {
          await rollbackStagedAsset(staged);
        } catch (rollbackError) {
          rollbackErrors.push(...errorComponents(rollbackError));
        }
      }
      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [...errorComponents(error), ...rollbackErrors],
          "Failed to install and restore trimctx assets"
        );
      }
      throw error;
    }

    for (const staged of stagedAssets) {
      if (staged.backupPath !== undefined) {
        await rm(staged.backupPath, { recursive: true, force: true });
        staged.backupPath = undefined;
      }
    }
  } catch (error) {
    transactionFailed = true;
    transactionError = error;
    throw error;
  } finally {
    const cleanupErrors = await cleanupStagedAssets(stagedAssets);
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [
          ...(transactionFailed ? errorComponents(transactionError) : []),
          ...cleanupErrors
        ],
        "Failed to install or clean up trimctx assets"
      );
    }
  }
}

async function cleanupStagedAssets(stagedAssets: readonly StagedAsset[]): Promise<unknown[]> {
  const results = await Promise.allSettled(stagedAssets.map((staged) =>
    rm(staged.stagePath, { recursive: true, force: true })
  ));
  return results.flatMap((result) =>
    result.status === "rejected" ? errorComponents(result.reason) : []
  );
}

async function commitStagedAsset(staged: StagedAsset): Promise<void> {
  const destination = staged.entry.asset.destination;
  if (!staged.entry.destinationExists) {
    await rename(staged.stagePath, destination);
    staged.committed = true;
    return;
  }

  const backupPath = temporarySibling(destination, "bak");
  staged.backupPath = backupPath;
  await rename(destination, backupPath);
  try {
    await rename(staged.stagePath, destination);
    staged.committed = true;
  } catch (error) {
    try {
      await rename(backupPath, destination);
      staged.backupPath = undefined;
    } catch (restoreError) {
      throw new AggregateError(
        [...errorComponents(error), ...errorComponents(restoreError)],
        `Failed to install and restore ${destination}`
      );
    }
    throw error;
  }
}

async function rollbackStagedAsset(staged: StagedAsset): Promise<void> {
  const destination = staged.entry.asset.destination;
  await rm(destination, { recursive: true, force: true });
  if (staged.entry.destinationExists && staged.backupPath !== undefined) {
    await rename(staged.backupPath, destination);
    staged.backupPath = undefined;
  }
  staged.committed = false;
}

function temporarySibling(destination: string, suffix: "stage" | "bak"): string {
  return join(
    dirname(destination),
    `.${basename(destination)}.trimctx-${randomBytes(8).toString("hex")}.${suffix}`
  );
}

function errorComponents(error: unknown): unknown[] {
  return error instanceof AggregateError ? error.errors : [error];
}
