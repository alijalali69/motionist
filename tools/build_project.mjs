// Compose src/project.json from exported page folders under public/projects/<id>/<page>/.
// CLI entry: routes ALL pages at once. Shares logic with the server via compose.mjs.
//
// Usage:  node tools/build_project.mjs <projectId> <page1> <page2> ...

import fs from "node:fs";
import path from "node:path";
import {
  routePage,
  readManifest,
  defaultLoader,
  defaultSubtitle,
  defaultSubtitleStyle,
  FPS,
} from "./compose.mjs";

const [projectId, ...pageDirs] = process.argv.slice(2);
if (!projectId || pageDirs.length === 0) {
  console.error("usage: node tools/build_project.mjs <projectId> <page1> <page2> ...");
  process.exit(1);
}

const ROOT = path.resolve(process.cwd(), "public", "projects", projectId);

const templateLayers = [];
const seenFixed = new Set();
let logo = null;
let loaderBox = null;
let subtitleBox = null;
let cw = 1080, ch = 1920;

const pages = pageDirs.map((pageDir) => {
  const manifest = readManifest(ROOT, pageDir);
  const routed = routePage(projectId, pageDir, manifest);
  [cw, ch] = routed.canvas;
  for (const f of routed.fixed) {
    const key = `${f.name}|${f.left},${f.top},${f.width}x${f.height}`;
    if (!seenFixed.has(key)) {
      seenFixed.add(key);
      templateLayers.push(f);
    }
  }
  if (!logo && routed.logo) logo = routed.logo;
  if (!loaderBox && routed.loaderBox) loaderBox = routed.loaderBox;
  if (!subtitleBox && routed.subtitleBox) subtitleBox = routed.subtitleBox;
  return routed.page;
});

const project = {
  fps: FPS,
  width: cw,
  height: ch,
  projectId,
  template: { layers: templateLayers },
  logo,
  loader: loaderBox ?? defaultLoader(cw, ch),
  subtitle: subtitleBox ?? defaultSubtitle(cw, ch),
  subtitleStyle: defaultSubtitleStyle(ch),
  captions: [],
  pages,
};

const outPath = path.resolve(process.cwd(), "src", "project.json");
fs.writeFileSync(outPath, JSON.stringify(project, null, 2), "utf-8");

console.log(`wrote ${outPath}: ${pages.length} pages, ${cw}x${ch}`);
console.log(`  template: ${templateLayers.length}  logo: ${logo ? "yes" : "no"}  ` +
  `loader: ${loaderBox ? "PSD" : "default"}  subtitle: ${subtitleBox ? "PSD" : "default"}`);
for (const p of pages) {
  console.log(`  ${p.id}: ${p.layers.length} content layers`);
}
