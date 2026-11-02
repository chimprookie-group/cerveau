'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

/**
 * Moteur Obsidian : accès direct aux fichiers Markdown du coffre.
 * Aucun plugin requis. Obsidian recharge automatiquement les fichiers modifiés
 * à chaud, donc les notes écrites ici apparaissent immédiatement dans l'app.
 */

const IGNORED_DIRS = new Set([
  '.obsidian', '.git', '.trash', 'node_modules', '.DS_Store', '.stfolder'
]);

const MAX_READ_BYTES = 2 * 1024 * 1024; // 2 Mo

/* ------------------------------- utilitaires ---------------------------- */

function assertInside(vaultPath, target) {
  const root = path.resolve(vaultPath);
  const resolved = path.resolve(target);
  const rel = path.relative(root, resolved);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Chemin hors du coffre refusé : ${target}`);
  }
  return resolved;
}

function safeName(name) {
  return String(name)
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function ensureMd(p) {
  return p.toLowerCase().endsWith('.md') ? p : `${p}.md`;
}

function normalizeVaultPath(vaultPath, relPath) {
  const rel = String(relPath || '').replace(/^[/\\]+/, '');
  const withExt = ensureMd(rel);
  const abs = path.join(vaultPath, withExt);
  assertInside(vaultPath, abs);
  return abs;
}

function toRel(vaultPath, abs) {
  return path.relative(vaultPath, abs).split(path.sep).join('/');
}

/* ------------------------------ arborescence ---------------------------- */

async function walk(dir, vaultPath, depth = 0, out = []) {
  if (depth > 12) return out;
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.') && IGNORED_DIRS.has(e.name)) continue;
    if (IGNORED_DIRS.has(e.name)) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push({ type: 'dossier', name: e.name, path: toRel(vaultPath, abs), children: [] });
      await walk(abs, vaultPath, depth + 1, out[out.length - 1].children);
    } else if (e.name.toLowerCase().endsWith('.md')) {
      let stat = null;
      try { stat = await fsp.stat(abs); } catch { /* ignore */ }
      out.push({
        type: 'note',
        name: e.name,
        path: toRel(vaultPath, abs),
        size: stat ? stat.size : 0,
        mtime: stat ? stat.mtimeMs : 0
      });
    }
  }
  out.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dossier' ? -1 : 1;
    return a.name.localeCompare(b.name, 'fr');
  });
  return out;
}

async function tree(vaultPath) {
  if (!vaultPath) throw new Error('Aucun coffre actif.');
  if (!fs.existsSync(vaultPath)) throw new Error(`Coffre introuvable : ${vaultPath}`);
  return walk(vaultPath, vaultPath);
}

function flatten(nodes, out = []) {
  for (const n of nodes) {
    if (n.type === 'note') out.push(n);
    if (n.children) flatten(n.children, out);
  }
  return out;
}

async function listNotes(vaultPath) {
  return flatten(await tree(vaultPath)).map((n) => ({
    path: n.path, name: n.name, size: n.size, mtime: n.mtime
  }));
}

/* --------------------------------- lecture ------------------------------ */

async function readNote(vaultPath, relPath) {
  const abs = normalizeVaultPath(vaultPath, relPath);
  const stat = await fsp.stat(abs);
  if (stat.size > MAX_READ_BYTES) {
    throw new Error(`Note trop volumineuse (${Math.round(stat.size / 1024)} Ko > 2 Mo).`);
  }
  const content = await fsp.readFile(abs, 'utf8');
  return { path: toRel(vaultPath, abs), content, size: stat.size, mtime: stat.mtimeMs };
}

/* -------------------------------- écriture ------------------------------ */

async function writeNote(vaultPath, relPath, content, { create = true } = {}) {
  const abs = normalizeVaultPath(vaultPath, relPath);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  if (!create && !fs.existsSync(abs)) {
    throw new Error(`La note n'existe pas : ${toRel(vaultPath, abs)}`);
  }
  const existed = fs.existsSync(abs);
  await fsp.writeFile(abs, String(content ?? ''), 'utf8');
  return { path: toRel(vaultPath, abs), created: !existed, bytes: Buffer.byteLength(String(content ?? '')) };
}

async function appendToNote(vaultPath, relPath, content) {
  const abs = normalizeVaultPath(vaultPath, relPath);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  const existed = fs.existsSync(abs);
  const prefix = existed ? '\n\n' : '';
  await fsp.appendFile(abs, prefix + String(content ?? ''), 'utf8');
  return { path: toRel(vaultPath, abs), created: !existed };
}

async function prependToNote(vaultPath, relPath, content) {
  const abs = normalizeVaultPath(vaultPath, relPath);
  let existing = '';
  try { existing = await fsp.readFile(abs, 'utf8'); } catch { /* nouveau fichier */ }
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, String(content ?? '') + '\n\n' + existing, 'utf8');
  return { path: toRel(vaultPath, abs) };
}

async function patchNote(vaultPath, relPath, search, replace, { all = false } = {}) {
  const abs = normalizeVaultPath(vaultPath, relPath);
  const content = await fsp.readFile(abs, 'utf8');
  if (!content.includes(search)) {
    throw new Error('Texte à remplacer introuvable dans la note.');
  }
  const next = all ? content.split(search).join(replace) : content.replace(search, replace);
  await fsp.writeFile(abs, next, 'utf8');
  return {
    path: toRel(vaultPath, abs),
    remplacements: all ? content.split(search).length - 1 : 1
  };
}

async function deleteNote(vaultPath, relPath, { corbeille = true } = {}) {
  const abs = normalizeVaultPath(vaultPath, relPath);
  if (!fs.existsSync(abs)) throw new Error(`Note introuvable : ${relPath}`);
  if (corbeille) {
    const trash = path.join(vaultPath, '.trash');
    await fsp.mkdir(trash, { recursive: true });
    const dest = path.join(trash, `${Date.now()}-${path.basename(abs)}`);
    await fsp.rename(abs, dest);
    return { path: toRel(vaultPath, abs), deplaceeVers: toRel(vaultPath, dest) };
  }
  await fsp.unlink(abs);
  return { path: toRel(vaultPath, relPath), supprimee: true };
}

async function moveNote(vaultPath, from, to) {
  const src = normalizeVaultPath(vaultPath, from);
  const dest = normalizeVaultPath(vaultPath, to);
  if (!fs.existsSync(src)) throw new Error(`Note introuvable : ${from}`);
  if (fs.existsSync(dest)) throw new Error(`La destination existe déjà : ${to}`);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.rename(src, dest);
  return { de: toRel(vaultPath, src), vers: toRel(vaultPath, dest) };
}

async function makeFolder(vaultPath, relPath) {
  const abs = assertInside(vaultPath, path.join(vaultPath, String(relPath)));
  await fsp.mkdir(abs, { recursive: true });
  return { dossier: toRel(vaultPath, abs) };
}

/* -------------------------------- recherche ----------------------------- */

function stripFrontmatter(text) {
  return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

async function search(vaultPath, query, { limit = 40, dossier = null, sensibleCasse = false } = {}) {
  const notes = await listNotes(vaultPath);
  const q = String(query || '');
  if (!q.trim()) return [];
  let re;
  try {
    re = new RegExp(q, sensibleCasse ? 'g' : 'gi');
  } catch {
    re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  }
  const results = [];
  for (const n of notes) {
    if (dossier && !n.path.startsWith(dossier)) continue;
    let content = '';
    try { content = await fsp.readFile(path.join(vaultPath, n.path), 'utf8'); } catch { continue; }
    const lines = stripFrontmatter(content).split(/\r?\n/);
    const hits = [];
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        hits.push({ ligne: i + 1, extrait: lines[i].slice(0, 300) });
        if (hits.length >= 5) break;
      }
      re.lastIndex = 0;
    }
    if (hits.length) {
      const titreMatch = content.match(/^#\s+(.+)$/m);
      results.push({
        path: n.path,
        titre: titreMatch ? titreMatch[1] : n.name.replace(/\.md$/, ''),
        occurrences: hits.length,
        extraits: hits
      });
    }
    if (results.length >= limit) break;
  }
  // tri : nombre d'occurrences puis titre
  results.sort((a, b) => b.occurrences - a.occurrences || a.titre.localeCompare(b.titre, 'fr'));
  return results;
}

/* ------------------------------ tags & liens ---------------------------- */

async function tags(vaultPath) {
  const notes = await listNotes(vaultPath);
  const counts = new Map();
  const inlineRe = /(?:^|\s)#([\p{L}\p{N}_/-]{1,64})/gu;
  for (const n of notes) {
    let content = '';
    try { content = await fsp.readFile(path.join(vaultPath, n.path), 'utf8'); } catch { continue; }
    const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (fm) {
      const tagLine = fm[1].match(/^\s*tags:\s*(.+)$/m);
      if (tagLine) {
        const items = tagLine[1]
          .replace(/[[\]]/g, ' ')
          .split(/[,\s]+/)
          .filter(Boolean);
        for (const t of items) {
          const k = t.replace(/^#/, '');
          if (k) counts.set(k, (counts.get(k) || 0) + 1);
        }
      }
    }
    let m;
    const body = stripFrontmatter(content);
    while ((m = inlineRe.exec(body)) !== null) {
      const k = m[1];
      if (/^\d+$/.test(k)) continue;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'fr'));
}

async function notesByTag(vaultPath, tag) {
  const wanted = String(tag).replace(/^#/, '').toLowerCase();
  const notes = await listNotes(vaultPath);
  const out = [];
  for (const n of notes) {
    let content = '';
    try { content = await fsp.readFile(path.join(vaultPath, n.path), 'utf8'); } catch { continue; }
    const found = new Set();
    const body = stripFrontmatter(content);
    let m;
    const re = /(?:^|\s)#([\p{L}\p{N}_/-]{1,64})/gu;
    while ((m = re.exec(body)) !== null) found.add(m[1].toLowerCase());
    const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (fm) {
      const tagLine = fm[1].match(/^\s*tags:\s*(.+)$/m);
      if (tagLine) {
        tagLine[1].replace(/[[\]]/g, ' ').split(/[,\s]+/).filter(Boolean)
          .forEach((t) => found.add(t.replace(/^#/, '').toLowerCase()));
      }
    }
    if (found.has(wanted)) out.push({ path: n.path, name: n.name });
  }
  return out;
}

async function links(vaultPath, relPath) {
  const target = normalizeVaultPath(vaultPath, relPath);
  const relCible = toRel(vaultPath, target);
  const base = path.basename(target, '.md').toLowerCase();
  const sansExt = relCible.replace(/\.md$/i, '').toLowerCase();
  const notes = await listNotes(vaultPath);

  // liens sortants depuis la note
  let content = '';
  try { content = await fsp.readFile(target, 'utf8'); } catch { /* ignore */ }
  const outgoing = new Set();
  const wikiRe = /\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g;
  let m;
  while ((m = wikiRe.exec(content)) !== null) outgoing.add(m[1].trim());
  const mdRe = /\[[^\]]*\]\(([^)]+\.md)\)/g;
  while ((m = mdRe.exec(content)) !== null) outgoing.add(m[1].replace(/\.md$/, '').trim());

  // backlinks : la note source pointe-t-elle vers nous (par nom de base OU chemin complet) ?
  const echapperRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cibles = [...new Set([base, sansExt].filter(Boolean))];
  const motifs = cibles.map((c) => new RegExp(
    `\\[\\[(?:[^\\]|#]*/)?${echapperRe(c)}(?:\\.md)?(?:[#|\\]])`, 'i'
  ));

  const backlinks = [];
  for (const n of notes) {
    if (n.path === relCible) continue;
    let c = '';
    try { c = await fsp.readFile(path.join(vaultPath, n.path), 'utf8'); } catch { continue; }
    if (motifs.some((re) => re.test(c))) backlinks.push({ path: n.path, name: n.name });
  }

  return {
    note: relCible,
    sortants: [...outgoing],
    entrants: backlinks
  };
}

/* --------------------------------- stats -------------------------------- */

async function stats(vaultPath) {
  const notes = await listNotes(vaultPath);
  const folders = new Set();
  let totalBytes = 0;
  let totalWords = 0;
  let lastEdit = 0;
  for (const n of notes) {
    totalBytes += n.size || 0;
    if (n.mtime > lastEdit) lastEdit = n.mtime;
    const dir = path.dirname(n.path);
    if (dir !== '.') folders.add(dir);
  }
  // comptage de mots sur un échantillon complet (raisonnable pour un coffre perso)
  for (const n of notes.slice(0, 3000)) {
    try {
      const c = await fsp.readFile(path.join(vaultPath, n.path), 'utf8');
      totalWords += stripFrontmatter(c).split(/\s+/).filter(Boolean).length;
    } catch { /* ignore */ }
  }
  const allTags = await tags(vaultPath);
  return {
    notes: notes.length,
    dossiers: folders.size,
    tags: allTags.length,
    topTags: allTags.slice(0, 12),
    octets: totalBytes,
    mots: totalWords,
    derniereModification: lastEdit || null
  };
}

/* --------------------------------- journal ------------------------------ */

async function journal(vaultPath, { dossier = 'Journal', titre = null } = {}) {
  const now = new Date();
  const iso = now.toISOString().slice(0, 10);
  const nom = titre || `Journal ${iso}`;
  const rel = `${dossier}/${nom}.md`;
  const abs = normalizeVaultPath(vaultPath, rel);
  if (!fs.existsSync(abs)) {
    const entete = `---\ncreated: ${now.toISOString()}\ntags: [journal]\n---\n\n# ${now.toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}\n\n`;
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, entete, 'utf8');
  }
  return readNote(vaultPath, rel);
}

module.exports = {
  tree,
  listNotes,
  readNote,
  writeNote,
  appendToNote,
  prependToNote,
  patchNote,
  deleteNote,
  moveNote,
  makeFolder,
  search,
  tags,
  notesByTag,
  links,
  stats,
  journal,
  normalizeVaultPath,
  toRel
};
