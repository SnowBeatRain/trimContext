import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { dirname } from "node:path";
import type { InitAsset } from "./init-plan.js";
import { installInitAssetTransaction } from "./init-transaction.js";

export interface InstallInitAssetsOptions {
  force?: boolean;
  dryRun?: boolean;
}

export async function installInitAssets(
  assets: readonly InitAsset[],
  options: InstallInitAssetsOptions = {}
): Promise<string[]> {
  for (const asset of assets) {
    await assertTemplateExists(asset.source, asset.label);
  }

  const lines = assets.map((asset) => `- ${asset.label}: ${asset.destination}`);
  if (options.dryRun) return lines;

  const destinationExists = await Promise.all(
    assets.map((asset) => pathExists(asset.destination))
  );
  for (let index = 0; index < assets.length; index += 1) {
    if (!destinationExists[index]) continue;
    const asset = assets[index]!;
    if (!options.force) {
      throw new Error(
        `${asset.destination} already exists; rerun with --force to overwrite trimctx ${asset.client} assets`
      );
    }
    assertSafeReplacementDestination(asset);
  }

  await installInitAssetTransaction(assets.map((asset, index) => ({
    asset,
    destinationExists: destinationExists[index]!
  })));
  return lines;
}

async function assertTemplateExists(path: string, label: string): Promise<void> {
  try {
    await access(path, fsConstants.R_OK);
  } catch {
    throw new Error(`${label} template is missing from the installed package: ${path}`);
  }
}

function assertSafeReplacementDestination(asset: InitAsset): void {
  if (asset.destination === dirname(asset.destination) || asset.destination.endsWith("..")) {
    throw new Error(`refusing to overwrite unsafe ${asset.client} destination: ${asset.destination}`);
  }
  if (asset.destination.split(/[\\/]+/).at(-1) !== "trimctx") {
    throw new Error(`refusing to overwrite non-trimctx ${asset.client} destination: ${asset.destination}`);
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
