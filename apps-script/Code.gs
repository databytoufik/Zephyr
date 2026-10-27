/**
 * Zephyr backup for Google Drive.
 *
 * Setup (about five minutes):
 *   1. Go to https://script.google.com and create a new project. Paste this whole file in place of the sample code.
 *   2. Change SECRET below to a phrase only you know. Save.
 *   3. Deploy > New deployment > type "Web app". Execute as: Me. Who has access: Anyone. Deploy, and allow access.
 *   4. In Zephyr, open Settings > Google Drive backup. Paste the web app URL (ends in /exec) and the same secret.
 *
 * What it does:
 *   - "saveDoc": each Zephyr document becomes a Google Doc in a "Zephyr" folder, with its title, headings, lists,
 *     bold, italic and underline. Saving again updates the same Google Doc.
 *   - "sessionBackup": the working draft of each session is saved as a text file in "Zephyr/Session backups".
 *     Files there older than seven days are moved to the Drive trash.
 *
 * After editing this script, deploy again with Deploy > Manage deployments > Edit > Version: New version,
 * so the URL stays the same.
 */
const SECRET = 'change me to your own phrase';

const ROOT_FOLDER = 'Zephyr';
const SESSION_FOLDER = 'Session backups';
const KEEP_DAYS = 7;

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (SECRET === 'change me to your own phrase') return reply({ok: false, error: 'Set your own SECRET at the top of the backup script, then deploy a new version.'});
    if (body.secret !== SECRET) return reply({ok: false, error: 'Wrong secret'});
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      if (body.action === 'ping') return reply({ok: true});
      if (body.action === 'saveDoc') return reply(saveDoc(body));
      if (body.action === 'sessionBackup') return reply(sessionBackup(body));
      return reply({ok: false, error: 'Unknown action'});
    } finally { lock.releaseLock(); }
  } catch (err) {
    return reply({ok: false, error: String(err && err.message || err)});
  }
}

function doGet() {
  return reply({ok: true, app: 'zephyr-backup'});
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function folder(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
function rootFolder() { return folder(DriveApp.getRootFolder(), ROOT_FOLDER); }

// Look up a file we created before, by Zephyr's id. Returns null if it was deleted or trashed.
function knownFile(key) {
  const id = PropertiesService.getScriptProperties().getProperty(key);
  if (!id) return null;
  try { const f = DriveApp.getFileById(id); return f.isTrashed() ? null : f; } catch (err) { return null; }
}
function remember(key, id) { PropertiesService.getScriptProperties().setProperty(key, id); }

/* ---------- documents ---------- */
function saveDoc(body) {
  if (!body.docId) return {ok: false, error: 'Missing document id'};
  const title = String(body.title || 'Untitled draft');
  const key = 'doc_' + body.docId;
  let file = knownFile(key), doc;
  if (file) {
    doc = DocumentApp.openById(file.getId());
    if (file.getName() !== title) file.setName(title);
  } else {
    doc = DocumentApp.create(title);
    file = DriveApp.getFileById(doc.getId());
    file.moveTo(rootFolder());
    remember(key, doc.getId());
  }
  writeFormatted(doc.getBody(), String(body.text || ''));
  doc.saveAndClose();
  return {ok: true, id: doc.getId()};
}

// Marks used by Zephyr: "% " title, "# ".."#### " headings, "- " bullets, "1. " numbered items,
// **bold**, *italic*, ++underline++, and a leading "\" for a line that is ordinary text.
function writeFormatted(body, text) {
  body.clear();
  const H = DocumentApp.ParagraphHeading;
  const headings = [null, H.HEADING1, H.HEADING2, H.HEADING3, H.HEADING4];
  let first = true, listId = null, lastKind = null;
  text.split('\n').forEach(function (raw) {
    if (!raw.trim()) { lastKind = 'blank'; return; }
    let kind = 'para', level = 0, content = raw, m;
    if (raw.charAt(0) === '\\') content = raw.slice(1);
    else if ((m = raw.match(/^%(?:[ \t]+|$)/))) { kind = 'title'; content = raw.slice(m[0].length); }
    else if ((m = raw.match(/^(#{1,4})(?:[ \t]+|$)/))) { kind = 'heading'; level = m[1].length; content = raw.slice(m[0].length); }
    else if ((m = raw.match(/^-(?:[ \t]+|$)/)) || (m = raw.match(/^\*[ \t]+/))) { kind = 'bullet'; content = raw.slice(m[0].length); }
    else if ((m = raw.match(/^\d{1,3}[.)](?:[ \t]+|$)/))) { kind = 'number'; content = raw.slice(m[0].length); }
    const runs = inlineRuns(content);
    const plainText = runs.map(function (r) { return r.text; }).join('');
    let el;
    if (kind === 'bullet' || kind === 'number') {
      el = body.appendListItem(plainText || ' ');
      el.setGlyphType(kind === 'bullet' ? DocumentApp.GlyphType.BULLET : DocumentApp.GlyphType.NUMBER);
      if (lastKind === kind && listId) el.setListId(listId); else listId = el;
    } else {
      el = body.appendParagraph(plainText);
      if (kind === 'title') el.setHeading(H.TITLE);
      else if (kind === 'heading') el.setHeading(headings[level]);
      else el.setHeading(H.NORMAL);
      listId = null;
    }
    const t = el.editAsText();
    let pos = 0;
    runs.forEach(function (r) {
      if (r.text.length) {
        const end = pos + r.text.length - 1;
        if (r.b) t.setBold(pos, end, true);
        if (r.i) t.setItalic(pos, end, true);
        if (r.u) t.setUnderline(pos, end, true);
      }
      pos += r.text.length;
    });
    if (first) { const p0 = body.getChild(0); if (p0 && p0.getType() === DocumentApp.ElementType.PARAGRAPH && p0.asParagraph().getText() === '' && body.getNumChildren() > 1) p0.removeFromParent(); first = false; }
    lastKind = kind;
  });
}

// Split a line into runs with bold/italic/underline flags. Marks only count when they pair up and hug words,
// matching the app (so "C++" and "5 * 3" stay as written).
function inlineRuns(s) {
  const isMark = function (c) { return c === '*' || c === '+'; };
  const delims = [];
  for (let k = 0; k < s.length;) {
    if (!isMark(s.charAt(k))) { k++; continue; }
    let re = k; while (re < s.length && isMark(s.charAt(re))) re++;
    const prev = k > 0 ? s.charAt(k - 1) : '', next = re < s.length ? s.charAt(re) : '';
    const canOpen = !!next && !/\s/.test(next) && (!prev || /[\s“"‘'(\[—–-]/.test(prev));
    const canClose = !!prev && !/\s/.test(prev) && (!next || /[\s.,;:!?…”"’')\]—–-]/.test(next));
    for (let p = k; p < re;) {
      if (s.substr(p, 2) === '**') { delims.push({pos: p, len: 2, k: 'b', canOpen: canOpen, canClose: canClose}); p += 2; }
      else if (s.substr(p, 2) === '++') { delims.push({pos: p, len: 2, k: 'u', canOpen: canOpen, canClose: canClose}); p += 2; }
      else if (s.charAt(p) === '*') { delims.push({pos: p, len: 1, k: 'i', canOpen: canOpen, canClose: canClose}); p += 1; }
      else p += 1;
    }
    k = re;
  }
  const open = {b: [], i: [], u: []}, role = {};
  delims.forEach(function (d) {
    if (d.canClose && open[d.k].length) { const o = open[d.k].pop(); role[o.pos] = {d: o, open: true}; role[d.pos] = {d: d, open: false}; }
    else if (d.canOpen) open[d.k].push(d);
  });
  const runs = [], state = {b: false, i: false, u: false};
  let buf = '';
  const push = function () { if (buf) runs.push({text: buf, b: state.b, i: state.i, u: state.u}); buf = ''; };
  for (let k = 0; k < s.length;) {
    const hit = role[k];
    if (hit) { push(); state[hit.d.k] = hit.open; k += hit.d.len; continue; }
    buf += s.charAt(k); k++;
  }
  push();
  return runs;
}

/* ---------- session backups ---------- */
function sessionBackup(body) {
  if (!body.sessionId) return {ok: false, error: 'Missing session id'};
  const dir = folder(rootFolder(), SESSION_FOLDER);
  const key = 'session_' + body.sessionId;
  const name = String(body.label || 'Zephyr session') + (body.ended ? '' : ' (in progress)') + '.txt';
  let file = knownFile(key);
  if (file) { file.setContent(String(body.text || '')); if (file.getName() !== name) file.setName(name); }
  else { file = dir.createFile(name, String(body.text || ''), MimeType.PLAIN_TEXT); remember(key, file.getId()); }
  purgeOld(dir);
  return {ok: true, id: file.getId()};
}

function purgeOld(dir) {
  const cutoff = Date.now() - KEEP_DAYS * 24 * 3600 * 1000;
  const props = PropertiesService.getScriptProperties();
  const files = dir.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    if (f.getLastUpdated().getTime() < cutoff) f.setTrashed(true);
  }
  // forget ids of files that no longer exist so the property store stays small
  const all = props.getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('session_') !== 0) return;
    try { if (DriveApp.getFileById(all[k]).isTrashed()) props.deleteProperty(k); } catch (err) { props.deleteProperty(k); }
  });
}
