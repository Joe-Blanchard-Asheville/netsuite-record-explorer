import { readFile, writeFile, mkdir, copyFile, rm } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const path = (rel) => new URL(rel, root);
await rm(path("dist"), { recursive: true, force: true });
await mkdir(path("dist/FileCabinet/SuiteScripts/RecordExplorer"), {
  recursive: true,
});
const [html, css, js] = await Promise.all(
  ["web/index.html", "web/style.css", "web/app.js"].map((p) =>
    readFile(path(p), "utf8"),
  ),
);
const embedded = html
  .replace(/<link\b[^>]*href="\/style.css"[^>]*>/g, `<style>${css}</style>`)
  .replace(
    /<script\b[^>]*src="\/app.js"[^>]*>\s*<\/script>/g,
    `<script>${js.replace(/<\/script/gi, "<\\/script")}</script>`,
  );
await writeFile(
  path("dist/FileCabinet/SuiteScripts/RecordExplorer/index.html"),
  embedded,
);
for (const name of ["core.js", "service.js", "netsuite-adapter.js"])
  await copyFile(
    path("src/" + name),
    path("dist/FileCabinet/SuiteScripts/RecordExplorer/" + name),
  );
for (const name of ["suitelet.js", "account-config.js"])
  await copyFile(
    path("netsuite/FileCabinet/SuiteScripts/RecordExplorer/" + name),
    path("dist/FileCabinet/SuiteScripts/RecordExplorer/" + name),
  );
// The downloadable demo runs the same core, fixture adapter and service in-browser.
// No copied data model or independently maintained generated source.
const wrap = (name, source, dependency = "null") =>
  `const ${name}=(()=>{const module={exports:{}};const define=undefined;const require=()=>${dependency};${source}\nreturn module.exports;})();`;
const [core, fixtures, service] = await Promise.all(
  ["src/core.js", "src/fixtures.js", "src/service.js"].map((p) =>
    readFile(path(p), "utf8"),
  ),
);
const offlineAPI = `async function api(body) { return wbAPI.route(body); }`;
const offlineJS =
  wrap("wbCore", core) +
  wrap("wbFixtures", fixtures, "wbCore") +
  wrap("wbService", service, "wbCore") +
  "const wbAPI=wbService.createService(wbFixtures.createFixtureAdapter());" +
  js.replace(/async function api\(body\) \{[\s\S]*?\n\}/, offlineAPI);
const demo = html
  .replace(/<link\b[^>]*href="\/style.css"[^>]*>/g, `<style>${css}</style>`)
  .replace(
    /<script\b[^>]*src="\/app.js"[^>]*>\s*<\/script>/g,
    `<script>${offlineJS.replace(/<\/script/gi, "<\\/script")}</script>`,
  );
if (demo.includes('href="/style.css"') || demo.includes('src="/app.js"'))
  throw new Error("Standalone asset embedding failed.");
await writeFile(path("dist/demo.html"), demo);
console.log(
  "Built standalone dist/demo.html and 6 Suitelet files. Sandbox deployment not performed.",
);
