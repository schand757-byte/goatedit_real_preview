// ============================================================
// Builds the gallery: checks every template folder, then writes dist/ —
//
//   dist/index.json      the list the editor and the gallery page read
//   dist/t/<id>.json     each project, its "./assets/…" turned into links
//   dist/index.html …    the gallery page
//
// A template's files are never copied into dist/. Their links point into this
// repository at the exact commit being built, so a link never changes under
// anyone and the CDN can keep it forever:
//
//   up to 20 MB   https://cdn.jsdelivr.net/gh/<owner>/<repo>@<sha>/templates/<id>/<file>
//   larger        https://raw.githubusercontent.com/<owner>/<repo>/<sha>/templates/<id>/<file>
//
// jsDelivr serves nothing over 20 MB from GitHub; raw GitHub serves up to
// GitHub's own 100 MB limit, with less caching.
//
//   node scripts/build.mjs           build for GitHub Pages
//   node scripts/build.mjs --check   check only (what pull requests run)
//   node scripts/build.mjs --local   build for `npm run preview`, files served from this folder
// ============================================================

import { execSync } from 'node:child_process';
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES = join(ROOT, 'templates');
const DIST = join(ROOT, 'dist');

const CHECK = process.argv.includes('--check');
const LOCAL = process.argv.includes('--local');
const PORT = Number(process.env.PORT ?? 4174);

const SCHEMA = 1;
const MB = 1024 * 1024;
const CDN_LIMIT = 20 * MB;
const GITHUB_LIMIT = 100 * MB;
const LICENSES = new Set(['CC-BY-4.0', 'CC0-1.0', 'CC-BY-NC-4.0', 'MIT']);
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const EDITOR = (process.env.EDITOR_URL ?? 'https://ai.goatedit.com').replace(/\/$/, '');

const errors = [];
const warnings = [];

function sh(cmd) {
  try { return execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; }
}

/** owner/name of this repository on GitHub. */
function repository() {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const m = sh('git remote get-url origin').match(/github\.com[:/]([^/]+\/[^/.]+?)(\.git)?$/);
  return m ? m[1] : '';
}

/** Where the gallery page is published. */
function siteUrl(repo) {
  if (LOCAL) return `http://localhost:${PORT}`;
  if (process.env.PAGES_URL) return process.env.PAGES_URL.replace(/\/$/, '');
  const [owner, name] = repo.split('/');
  return name.toLowerCase() === `${owner.toLowerCase()}.github.io`
    ? `https://${owner.toLowerCase()}.github.io`
    : `https://${owner.toLowerCase()}.github.io/${name}`;
}

async function isFile(p) {
  try { return (await stat(p)).isFile(); } catch { return false; }
}

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else if (e.name !== '.DS_Store') out.push(p);
  }
  return out;
}

/** Every string in `v`, through `fn`, in a copy. */
function mapStrings(v, fn) {
  if (typeof v === 'string') return fn(v);
  if (Array.isArray(v)) return v.map(x => mapStrings(x, fn));
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = mapStrings(v[k], fn);
    return out;
  }
  return v;
}

/** One template folder, checked. Null if it cannot be published. */
async function readTemplate(id) {
  const dir = join(TEMPLATES, id);
  const bad = msg => { errors.push(`${id}: ${msg}`); };
  if (!ID.test(id)) { bad('folder name must be lower-case letters, digits and dashes'); return null; }

  let meta, project;
  try { meta = JSON.parse(await readFile(join(dir, 'template.json'), 'utf8')); } catch (e) { bad(`template.json: ${e.message}`); return null; }
  try { project = JSON.parse(await readFile(join(dir, 'project.json'), 'utf8')); } catch (e) { bad(`project.json: ${e.message}`); return null; }

  if (meta.id !== id) bad(`template.json id "${meta.id}" is not the folder name`);
  for (const k of ['name', 'author', 'license']) if (typeof meta[k] !== 'string' || !meta[k].trim()) bad(`template.json needs "${k}"`);
  for (const k of ['width', 'height']) if (!(meta[k] > 0)) bad(`template.json needs "${k}"`);
  if (meta.license && !LICENSES.has(meta.license)) bad(`licence "${meta.license}" is not one of ${[...LICENSES].join(', ')}`);
  if (meta.authorUrl && !/^https:\/\//.test(meta.authorUrl)) bad('authorUrl must be https');
  if (!Array.isArray(project.mediaFiles) || !Array.isArray(project.sequences) || !project.timeline || !project.settings) {
    bad('project.json is not a GoatEdit project');
  }

  // Files: what the project names must exist; what is there and unnamed is dead weight.
  const files = new Map();
  for (const p of await walk(dir)) {
    const rel = relative(dir, p).split('\\').join('/');
    const size = (await stat(p)).size;
    files.set(rel, size);
    if (size > GITHUB_LIMIT) bad(`${rel} is ${(size / MB).toFixed(0)} MB; GitHub refuses files over 100 MB`);
  }
  const used = new Set();
  let local = 0;
  mapStrings(project, s => {
    if (s.startsWith('./assets/')) {
      const rel = s.slice(2);
      if (!files.has(rel)) bad(`project.json uses ${rel}, which is not in the folder`);
      used.add(rel);
    } else if (/^(blob:|file:)/.test(s)) local++;
    return s;
  });
  if (local) warnings.push(`${id}: ${local} link(s) to files on the author's machine; they open empty`);
  for (const [rel, size] of files) {
    if (rel.startsWith('assets/') && !used.has(rel)) warnings.push(`${id}: ${rel} is not used by the project`);
    if (used.has(rel) && size > CDN_LIMIT) warnings.push(`${id}: ${rel} is over 20 MB, so it streams from raw GitHub rather than the CDN`);
  }
  for (const k of ['preview', 'thumbnail']) {
    if (meta[k] && !files.has(meta[k])) bad(`template.json names ${k} "${meta[k]}", which is not in the folder`);
  }
  if (!meta.preview) warnings.push(`${id}: no preview video; its card will be blank`);

  const bytes = [...used, meta.preview, meta.thumbnail].filter(Boolean).reduce((n, rel) => n + (files.get(rel) ?? 0), 0);
  return { id, meta, project, files, bytes };
}

async function main() {
  const ids = (await readdir(TEMPLATES, { withFileTypes: true }).catch(() => []))
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort();
  const read = (await Promise.all(ids.map(readTemplate))).filter(Boolean);

  for (const w of warnings) console.warn(`warning  ${w}`);
  for (const e of errors) console.error(`error    ${e}`);
  if (errors.length) {
    console.error(`\n${errors.length} problem(s); nothing built.`);
    process.exit(1);
  }
  console.log(`${read.length} template(s) ok.`);
  if (CHECK) return;

  const repo = repository();
  const sha = process.env.GITHUB_SHA ?? sh('git rev-parse HEAD');
  if (!LOCAL && (!repo || !sha)) {
    console.error('Cannot tell which GitHub repository and commit this is. Set GITHUB_REPOSITORY and GITHUB_SHA, or add an origin remote and a commit.');
    process.exit(1);
  }
  if (!LOCAL && sh('git status --porcelain templates')) {
    console.warn('warning  templates/ has uncommitted changes; the published links point at the last commit, which does not have them');
  }
  const site = siteUrl(repo);
  const fileUrl = (id, rel, size) => {
    const path = `templates/${id}/${rel.split('/').map(encodeURIComponent).join('/')}`;
    if (LOCAL) return `${site}/${path}`;
    return size > CDN_LIMIT
      ? `https://raw.githubusercontent.com/${repo}/${sha}/${path}`
      : `https://cdn.jsdelivr.net/gh/${repo}@${sha}/${path}`;
  };

  await rm(DIST, { recursive: true, force: true });
  await mkdir(join(DIST, 't'), { recursive: true });

  const entries = [];
  for (const t of read) {
    const { id, meta, project, files } = t;
    const resolved = mapStrings(project, s => {
      if (s.startsWith('./assets/')) { const rel = s.slice(2); return fileUrl(id, rel, files.get(rel)); }
      return /^(blob:|file:)/.test(s) ? '' : s;
    });
    await writeFile(join(DIST, 't', `${id}.json`), JSON.stringify(resolved));
    entries.push({
      id,
      name: meta.name,
      description: meta.description ?? '',
      author: meta.author,
      ...(meta.authorUrl ? { authorUrl: meta.authorUrl } : {}),
      license: meta.license,
      tags: Array.isArray(meta.tags) ? meta.tags : [],
      width: meta.width,
      height: meta.height,
      fps: meta.fps ?? 30,
      duration: meta.duration ?? 0,
      projectUrl: `${site}/t/${id}.json`,
      ...(meta.preview ? { previewUrl: fileUrl(id, meta.preview, files.get(meta.preview)) } : {}),
      ...(meta.thumbnail ? { thumbnailUrl: fileUrl(id, meta.thumbnail, files.get(meta.thumbnail)) } : {}),
      bytes: t.bytes,
      openUrl: `${EDITOR}/?project-template=${id}`,
      sourceUrl: LOCAL ? '' : `https://github.com/${repo}/tree/main/templates/${id}`,
    });
  }

  const manifest = {
    schemaVersion: SCHEMA,
    generatedAt: new Date().toISOString(),
    count: entries.length,
    tags: [...new Set(entries.flatMap(e => e.tags))].sort(),
    templates: entries,
  };
  await writeFile(join(DIST, 'index.json'), JSON.stringify(manifest, null, 2));
  await cp(join(ROOT, 'site'), DIST, { recursive: true });
  await writeFile(join(DIST, '.nojekyll'), '');
  console.log(`Built ${entries.length} template(s) into dist/ for ${site}${LOCAL ? '' : ` (files at ${repo}@${sha.slice(0, 7)})`}.`);
}

main().catch(e => { console.error(e); process.exit(1); });
