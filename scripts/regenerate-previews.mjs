import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(readFileSync(resolve(projectRoot, "catalog.json"), "utf8"));

for (const entry of catalog) {
  const source = resolve(projectRoot, "assets/originals", entry.originalFilename);
  const destination = resolve(projectRoot, entry.preview);

  execFileSync(
    "sips",
    ["-s", "format", "jpeg", "-s", "formatOptions", "94", source, "--out", destination],
    { stdio: "ignore" },
  );

  process.stdout.write(`已更新 ${entry.id}\n`);
}

