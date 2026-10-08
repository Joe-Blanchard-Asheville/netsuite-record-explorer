import { readdir, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
async function walk(path) {
  const out = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (["node_modules", "dist", "artifacts", ".git"].includes(entry.name))
      continue;
    const next = path + "/" + entry.name;
    if (entry.isDirectory()) out.push(...(await walk(next)));
    else out.push(next);
  }
  return out;
}
let checked = 0;
for (const file of await walk(".")) {
  if (/\.(js|mjs|cjs)$/.test(file)) {
    const check = spawnSync(process.execPath, ["--check", file], {
      encoding: "utf8",
    });
    if (check.status !== 0) throw Error(check.stderr);
    checked++;
  }
  if (/\.(js|mjs|cjs|md|html|json|yml)$/.test(file)) {
    const text = await readFile(file, "utf8");
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text))
      throw Error("Unexpected private key: " + file);
  }
}
console.log(`Syntax checked ${checked} JavaScript files.`);
