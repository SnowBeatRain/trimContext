import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { installInitAssets } from "../src/commands/init-installer.js";
import {
  createInitAssets,
  parseInitClient,
  parseInitTarget,
  type InitAsset
} from "../src/commands/init-plan.js";
import {
  isInteractiveInput,
  resolveInitTarget,
  type InitPrompt
} from "../src/commands/init-prompt.js";

describe("init planning", () => {
  test("plans Claude and Codex assets from explicit roots", () => {
    expect(createInitAssets("package-a", "all", "base-a")).toEqual([
      {
        client: "claude",
        source: join("package-a", "plugins", "trimctx"),
        destination: join("base-a", ".claude", "plugins", "trimctx"),
        label: "Claude Code plugin commands"
      },
      {
        client: "codex",
        source: join("package-a", "codex", "skills", "trimctx"),
        destination: join("base-a", ".codex", "skills", "trimctx"),
        label: "Codex skill"
      }
    ]);
    expect(createInitAssets("package-b", "claude", "base-b")[0]).toMatchObject({
      source: join("package-b", "plugins", "trimctx"),
      destination: join("base-b", ".claude", "plugins", "trimctx")
    });
  });

  test("parses only the established client and target values", () => {
    expect(parseInitClient(undefined)).toBe("all");
    expect(parseInitClient("all")).toBe("all");
    expect(parseInitClient("claude")).toBe("claude");
    expect(parseInitClient("codex")).toBe("codex");
    expect(parseInitTarget("user")).toBe("user");
    expect(parseInitTarget("project")).toBe("project");
    expect(() => parseInitClient("vim")).toThrow("client must be one of: all, claude, codex");
    expect(() => parseInitTarget("global")).toThrow("target must be one of: user, project");
  });
});

describe("init target prompting", () => {
  test.each(["", "1", "user", "global"])("maps %j to the user target", async (answer) => {
    await expect(resolveInitTarget(undefined, promptFor(answer))).resolves.toBe("user");
  });

  test.each(["2", "project", "local"])("maps %j to the project target", async (answer) => {
    await expect(resolveInitTarget(undefined, promptFor(answer))).resolves.toBe("project");
  });

  test("retries invalid answers through an injected output writer", async () => {
    const writes: string[] = [];

    await expect(resolveInitTarget(
      undefined,
      promptFor("invalid", "local"),
      (text) => writes.push(text)
    )).resolves.toBe("project");
    expect(writes).toEqual(["Please choose 1 for user/global or 2 for project.\n"]);
  });

  test("requires a prompt when target is omitted", async () => {
    await expect(resolveInitTarget(undefined)).rejects.toThrow(
      "target is required in non-interactive mode; pass --target user or --target project"
    );
  });

  test("detects forced and TTY interactivity from injected facts", () => {
    expect(isInteractiveInput({ TRIMCTX_FORCE_INTERACTIVE: "1" }, false, false)).toBe(true);
    expect(isInteractiveInput({}, true, true)).toBe(true);
    expect(isInteractiveInput({}, true, false)).toBe(false);
  });
});

describe("init asset installation", () => {
  test("dry-run validates templates and writes nothing", async () => {
    const fixture = await initAssetFixture();

    await expect(installInitAssets([fixture.asset], { dryRun: true })).resolves.toEqual([
      `- ${fixture.asset.label}: ${fixture.asset.destination}`
    ]);
    await expect(access(fixture.destinationFile)).rejects.toThrow();
  });

  test("preflights all conflicts before copying the first asset", async () => {
    const first = await initAssetFixture("first");
    const second = await initAssetFixture("second");
    await mkdir(second.asset.destination, { recursive: true });

    await expect(installInitAssets([first.asset, second.asset])).rejects.toThrow("already exists");
    await expect(access(first.destinationFile)).rejects.toThrow();
  });

  test("force replaces existing trimctx destinations", async () => {
    const fixture = await initAssetFixture();
    await mkdir(fixture.asset.destination, { recursive: true });
    await writeFile(fixture.staleFile, "stale", "utf8");

    await installInitAssets([fixture.asset], { force: true });

    await expect(readFile(fixture.destinationFile, "utf8")).resolves.toBe("current");
    await expect(access(fixture.staleFile)).rejects.toThrow();
  });

  test("refuses to force-replace a destination not owned by trimctx", async () => {
    const fixture = await initAssetFixture();
    const unsafeDestination = join(fixture.root, "installed", "other");
    const marker = join(unsafeDestination, "marker.txt");
    await mkdir(unsafeDestination, { recursive: true });
    await writeFile(marker, "keep", "utf8");

    await expect(installInitAssets([{
      ...fixture.asset,
      destination: unsafeDestination
    }], { force: true })).rejects.toThrow("refusing to overwrite non-trimctx");
    await expect(readFile(marker, "utf8")).resolves.toBe("keep");
  });
});

function promptFor(...answers: string[]): InitPrompt {
  return {
    question: async () => answers.shift() ?? ""
  };
}

async function initAssetFixture(name = "asset"): Promise<{
  root: string;
  asset: InitAsset;
  destinationFile: string;
  staleFile: string;
}> {
  const root = await mkdtemp(join(tmpdir(), `trimctx-init-boundary-${name}-`));
  const source = join(root, "source", "trimctx");
  const destination = join(root, "installed", "trimctx");
  const destinationFile = join(destination, "current.txt");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "current.txt"), "current", "utf8");
  return {
    root,
    asset: {
      client: name === "second" ? "codex" : "claude",
      source,
      destination,
      label: `${name} asset`
    },
    destinationFile,
    staleFile: join(destination, "stale.txt")
  };
}
