import { chmod, readFile, writeFile } from "node:fs/promises";

const bundlePath = new URL("../dist/cli.js", import.meta.url);
const shebang = "#!/usr/bin/env node";
let content = await readFile(bundlePath, "utf8");
content = content.replace(/^(#!\/usr\/bin\/env node\n)+/, "");
await writeFile(bundlePath, `${shebang}\n${content}`, "utf8");
await chmod(bundlePath, 0o755);
