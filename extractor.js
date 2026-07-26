/* File Extractors — GitHub Pages edition */
'use strict';

const MAX_PREVIEW_ROWS = 500;

const csvState = {
  sourceFile: null,
  files: [],
  outputBlob: null,
};

const ramanState = {
  sourceFile: null,
  outputBlob: null,
  outputRows: [],
  log: [],
};

const $ = (id) => document.getElementById(id);

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[index]}`;
}

function safeBaseName(path) {
  const clean = normaliseInputPath(path);
  const parts = clean.split('/');
  return parts[parts.length - 1] || 'unnamed';
}

function directoryName(path) {
  const clean = normaliseInputPath(path);
  const index = clean.lastIndexOf('/');
  return index >= 0 ? clean.slice(0, index) : '';
}

function splitExtension(filename) {
  const index = filename.lastIndexOf('.');
  if (index <= 0) return { stem: filename, extension: '' };
  return { stem: filename.slice(0, index), extension: filename.slice(index) };
}

function extensionOf(path) {
  return splitExtension(safeBaseName(path)).extension.toLowerCase();
}

function stemOf(path) {
  return splitExtension(safeBaseName(path)).stem;
}

function normaliseInputPath(path) {
  const parts = String(path || '')
    .replaceAll('\\', '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..');
  return parts.join('/');
}

function isIgnoredSystemPath(path) {
  const clean = normaliseInputPath(path);
  if (!clean) return true;
  const parts = clean.split('/');
  return parts.some((part) => part === '__MACOSX') ||
    parts.some((part) => part === '.DS_Store' || part === 'Thumbs.db') ||
    safeBaseName(clean).startsWith('._');
}

function setProgress(id, percent) {
  $(id).style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function setStatus(id, text, isError = false) {
  const element = $(id);
  element.textContent = text;
  element.classList.toggle('error-box', isError);
}

function clearElement(element) {
  while (element.firstChild) element.removeChild(element.firstChild);
}

function renderPills(id, items) {
  const holder = $(id);
  clearElement(holder);
  for (const [label, value] of items) {
    const pill = document.createElement('span');
    pill.className = 'summary-pill';
    pill.textContent = `${label}: ${value}`;
    holder.appendChild(pill);
  }
}

function addTableCell(row, value) {
  const cell = document.createElement('td');
  cell.textContent = value;
  row.appendChild(cell);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function yieldToBrowser() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function attachDropZone(zoneId, fileInputId, onFile) {
  const zone = $(zoneId);
  const input = $(fileInputId);

  for (const eventName of ['dragenter', 'dragover']) {
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.add('dragover');
    });
  }
  for (const eventName of ['dragleave', 'drop']) {
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.remove('dragover');
    });
  }
  zone.addEventListener('drop', (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) {
      input.value = '';
      onFile(file);
    }
  });
}

function validateZipFile(file) {
  if (!file) throw new Error('No ZIP archive was selected.');
  const lower = file.name.toLowerCase();
  if (!lower.endsWith('.zip')) throw new Error('Please choose a .zip archive.');
}

function uniqueOutputPath(requestedPath, usedPaths) {
  const clean = normaliseInputPath(requestedPath) || 'unnamed';
  const key = clean.toLowerCase();
  if (!usedPaths.has(key)) {
    usedPaths.add(key);
    return clean;
  }

  const directory = directoryName(clean);
  const filename = safeBaseName(clean);
  const { stem, extension } = splitExtension(filename);
  let number = 2;
  while (true) {
    const candidateName = `${stem}_${number}${extension}`;
    const candidate = directory ? `${directory}/${candidateName}` : candidateName;
    const candidateKey = candidate.toLowerCase();
    if (!usedPaths.has(candidateKey)) {
      usedPaths.add(candidateKey);
      return candidate;
    }
    number += 1;
  }
}

async function loadZipEntries(file, progressId, statusId) {
  validateZipFile(file);
  if (!window.JSZip) throw new Error('JSZip did not load. Refresh the page and try again.');
  setStatus(statusId, `Opening ${file.name}…`);
  setProgress(progressId, 4);

  const zip = await JSZip.loadAsync(file);
  const sourceEntries = Object.values(zip.files).filter((entry) => !entry.dir && !isIgnoredSystemPath(entry.name));
  const entries = [];

  for (let index = 0; index < sourceEntries.length; index += 1) {
    const entry = sourceEntries[index];
    const data = await entry.async('uint8array');
    entries.push({
      sourcePath: normaliseInputPath(entry.name),
      path: normaliseInputPath(entry.name),
      data,
      date: entry.date,
      comment: entry.comment || '',
    });
    setProgress(progressId, 5 + Math.round(((index + 1) / Math.max(sourceEntries.length, 1)) * 55));
    if (index % 20 === 0) await yieldToBrowser();
  }
  return entries;
}

/* CSV EXTRACTOR */

function setCsvFile(file) {
  csvState.sourceFile = file;
  csvState.files = [];
  csvState.outputBlob = null;
  $('csvScan').disabled = !file;
  $('csvReset').disabled = !file;
  $('csvDownload').disabled = true;
  $('csvPreviewWrap').classList.add('hidden');
  clearElement($('csvPreview'));
  renderPills('csvSummary', []);
  setProgress('csvProgress', 0);
  setStatus('csvStatus', file ? `Ready to scan ${file.name} (${formatBytes(file.size)}).` : 'Choose a ZIP archive to begin.');
}

async function scanCsvZip() {
  try {
    $('csvScan').disabled = true;
    $('csvDownload').disabled = true;
    const entries = await loadZipEntries(csvState.sourceFile, 'csvProgress', 'csvStatus');
    const csvFiles = entries.filter((entry) => extensionOf(entry.path) === '.csv');
    csvState.files = csvFiles;

    clearElement($('csvPreview'));
    const previewFiles = csvFiles.slice(0, MAX_PREVIEW_ROWS);
    for (const entry of previewFiles) {
      const row = document.createElement('tr');
      addTableCell(row, safeBaseName(entry.path));
      addTableCell(row, directoryName(entry.path) || '(ZIP root)');
      addTableCell(row, formatBytes(entry.data.byteLength));
      $('csvPreview').appendChild(row);
    }
    $('csvPreviewWrap').classList.toggle('hidden', csvFiles.length === 0);

    const totalBytes = csvFiles.reduce((sum, entry) => sum + entry.data.byteLength, 0);
    renderPills('csvSummary', [
      ['Files scanned', entries.length],
      ['CSVs found', csvFiles.length],
      ['CSV size', formatBytes(totalBytes)],
    ]);

    if (csvFiles.length === 0) {
      setStatus('csvStatus', 'No CSV files were found in this archive.');
      setProgress('csvProgress', 100);
      return;
    }

    await buildCsvOutput();
    const previewNote = csvFiles.length > MAX_PREVIEW_ROWS ? ` Preview shows the first ${MAX_PREVIEW_ROWS}.` : '';
    setStatus('csvStatus', `Found ${csvFiles.length} CSV file(s). Ready to download.${previewNote}`);
    setProgress('csvProgress', 100);
    $('csvDownload').disabled = false;
  } catch (error) {
    console.error(error);
    setStatus('csvStatus', error.message || 'The ZIP archive could not be read.', true);
    setProgress('csvProgress', 0);
  } finally {
    $('csvScan').disabled = !csvState.sourceFile;
  }
}

async function buildCsvOutput() {
  const layout = document.querySelector('input[name="csvLayout"]:checked')?.value || 'retain';
  const output = new JSZip();
  const used = new Set();

  for (let index = 0; index < csvState.files.length; index += 1) {
    const entry = csvState.files[index];
    const requested = layout === 'flatten' ? safeBaseName(entry.path) : entry.path;
    const target = uniqueOutputPath(requested, used);
    output.file(target, entry.data, { date: entry.date });
    setProgress('csvProgress', 62 + Math.round(((index + 1) / csvState.files.length) * 20));
    if (index % 40 === 0) await yieldToBrowser();
  }

  csvState.outputBlob = await output.generateAsync(
    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
    (metadata) => setProgress('csvProgress', 82 + Math.round(metadata.percent * 0.18)),
  );
}

async function rebuildCsvForLayout() {
  if (!csvState.files.length) return;
  try {
    $('csvDownload').disabled = true;
    setStatus('csvStatus', 'Rebuilding the CSV ZIP with the selected folder layout…');
    setProgress('csvProgress', 62);
    await buildCsvOutput();
    setProgress('csvProgress', 100);
    setStatus('csvStatus', `Ready to download ${csvState.files.length} CSV file(s).`);
    $('csvDownload').disabled = false;
  } catch (error) {
    console.error(error);
    setStatus('csvStatus', error.message || 'The output ZIP could not be built.', true);
  }
}

/* RAMAN PROCESSOR */

function presetOptions() {
  const preset = $('ramanPreset').value;
  if (preset === 'custom') {
    return {
      strip: $('opStrip').checked,
      rename: $('opRename').checked,
      sort: $('opSort').checked,
      quartz: $('opQuartz').checked,
      quartzInsensitive: $('opQuartzInsensitive').checked,
      keepOther: $('opKeepOther').checked,
    };
  }
  if (preset === 'strip') return { strip: true, rename: false, sort: false, quartz: false, quartzInsensitive: true, keepOther: true };
  if (preset === 'sort') return { strip: false, rename: false, sort: true, quartz: false, quartzInsensitive: true, keepOther: true };
  if (preset === 'quartz') return { strip: false, rename: false, sort: false, quartz: true, quartzInsensitive: true, keepOther: true };
  return { strip: true, rename: true, sort: true, quartz: true, quartzInsensitive: true, keepOther: true };
}

function setRamanFile(file) {
  ramanState.sourceFile = file;
  ramanState.outputBlob = null;
  ramanState.outputRows = [];
  ramanState.log = [];
  $('ramanProcess').disabled = !file;
  $('ramanReset').disabled = !file;
  $('ramanDownload').disabled = true;
  $('ramanResults').classList.add('hidden');
  clearElement($('ramanPreview'));
  $('ramanLog').textContent = '';
  renderPills('ramanSummary', []);
  setProgress('ramanProgress', 0);
  setStatus('ramanStatus', file ? `Ready to process ${file.name} (${formatBytes(file.size)}).` : 'Choose a ZIP archive to begin.');
}

function decodeText(bytes) {
  if (!bytes?.length) return { text: '', encoding: 'empty' };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'UTF-16 LE' };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = new Uint8Array(bytes.length - 2);
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      swapped[index - 2] = bytes[index + 1];
      swapped[index - 1] = bytes[index];
    }
    return { text: new TextDecoder('utf-16le').decode(swapped), encoding: 'UTF-16 BE' };
  }

  let oddNulls = 0;
  let evenNulls = 0;
  const sampleLength = Math.min(bytes.length, 2000);
  for (let index = 0; index < sampleLength; index += 1) {
    if (bytes[index] === 0) {
      if (index % 2) oddNulls += 1;
      else evenNulls += 1;
    }
  }
  if (oddNulls > sampleLength * 0.15 || evenNulls > sampleLength * 0.15) {
    return { text: new TextDecoder('utf-16le').decode(bytes), encoding: 'UTF-16 LE (detected)' };
  }

  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const replacementCount = (utf8.match(/\uFFFD/g) || []).length;
  if (replacementCount > Math.max(2, utf8.length * 0.002)) {
    try {
      return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'Windows-1252' };
    } catch (_) {
      return { text: utf8, encoding: 'UTF-8' };
    }
  }
  return { text: utf8.replace(/^\uFEFF/, ''), encoding: 'UTF-8' };
}

function encodeText(text) {
  return new TextEncoder().encode(text);
}

function stripFirstLine(text) {
  const match = text.match(/\r\n|\n|\r/);
  if (!match || match.index == null) return { text: '', hadLineBreak: false };
  return { text: text.slice(match.index + match[0].length), hadLineBreak: true };
}

function renameOmnicPath(path) {
  const directory = directoryName(path);
  const filename = safeBaseName(path);
  const renamed = filename.replace(/^@output_/i, 'omnic_');
  return directory ? `${directory}/${renamed}` : renamed;
}

function isQuartzName(path, caseInsensitive) {
  const name = safeBaseName(path);
  return caseInsensitive ? /qz/i.test(name) : /Qz/.test(name);
}

function canonicalPairKey(path) {
  const directory = directoryName(path).toLowerCase();
  const stem = stemOf(path).toLowerCase();
  return directory ? `${directory}/${stem}` : stem;
}

function basenamePairKey(path) {
  return stemOf(path).toLowerCase();
}

function pairEntries(txtEntries, csvEntries) {
  const pairs = [];
  const unmatchedTxt = new Set(txtEntries);
  const unmatchedCsv = new Set(csvEntries);

  function pairByKey(txtList, csvList, keyFunction) {
    const txtGroups = new Map();
    const csvGroups = new Map();
    for (const entry of txtList) {
      const key = keyFunction(entry.path);
      if (!txtGroups.has(key)) txtGroups.set(key, []);
      txtGroups.get(key).push(entry);
    }
    for (const entry of csvList) {
      const key = keyFunction(entry.path);
      if (!csvGroups.has(key)) csvGroups.set(key, []);
      csvGroups.get(key).push(entry);
    }
    for (const [key, txtGroup] of txtGroups) {
      const csvGroup = csvGroups.get(key) || [];
      const count = Math.min(txtGroup.length, csvGroup.length);
      for (let index = 0; index < count; index += 1) {
        const txt = txtGroup[index];
        const csv = csvGroup[index];
        if (!unmatchedTxt.has(txt) || !unmatchedCsv.has(csv)) continue;
        pairs.push({ txt, csv });
        unmatchedTxt.delete(txt);
        unmatchedCsv.delete(csv);
      }
    }
  }

  pairByKey(txtEntries, csvEntries, canonicalPairKey);
  pairByKey([...unmatchedTxt], [...unmatchedCsv], basenamePairKey);

  return { pairs, unmatchedTxt: [...unmatchedTxt], unmatchedCsv: [...unmatchedCsv] };
}

function buildRamanPlan(entries, options) {
  const log = [];
  const counts = {
    scanned: entries.length,
    txt: 0,
    csv: 0,
    pairs: 0,
    unmatchedTxt: 0,
    unmatchedCsv: 0,
    stripped: 0,
    oneLine: 0,
    renamed: 0,
    quartz: 0,
    other: 0,
  };

  const transformed = entries.map((entry) => ({ ...entry, actions: [], quartz: false }));

  for (const entry of transformed) {
    if (extensionOf(entry.path) === '.txt') counts.txt += 1;
    if (extensionOf(entry.path) === '.csv') counts.csv += 1;

    if (options.rename && extensionOf(entry.path) === '.txt' && /^@output_/i.test(safeBaseName(entry.path))) {
      const oldPath = entry.path;
      entry.path = renameOmnicPath(entry.path);
      entry.actions.push('renamed @output_ → omnic_');
      counts.renamed += 1;
      log.push(`RENAMED  ${oldPath}  →  ${entry.path}`);
    }

    if (options.strip && extensionOf(entry.path) === '.txt') {
      const decoded = decodeText(entry.data);
      const stripped = stripFirstLine(decoded.text);
      entry.data = encodeText(stripped.text);
      entry.actions.push(`first line removed (${decoded.encoding})`);
      counts.stripped += 1;
      if (!stripped.hadLineBreak) {
        counts.oneLine += 1;
        log.push(`NOTICE   ${entry.path}: empty or one-line TXT became an empty processed file.`);
      }
    }

    if (options.quartz && isQuartzName(entry.path, options.quartzInsensitive)) {
      entry.quartz = true;
      counts.quartz += 1;
    }
  }

  const txtEntries = transformed.filter((entry) => extensionOf(entry.path) === '.txt');
  const csvEntries = transformed.filter((entry) => extensionOf(entry.path) === '.csv');
  const otherEntries = transformed.filter((entry) => !['.txt', '.csv'].includes(extensionOf(entry.path)));
  const plan = [];

  function addPlan(entry, requestedPath, action) {
    plan.push({ entry, requestedPath, action });
  }

  if (options.sort) {
    const pairing = pairEntries(txtEntries, csvEntries);
    counts.pairs = pairing.pairs.length;
    counts.unmatchedTxt = pairing.unmatchedTxt.length;
    counts.unmatchedCsv = pairing.unmatchedCsv.length;

    for (const pair of pairing.pairs) {
      const quartz = options.quartz && (pair.txt.quartz || pair.csv.quartz);
      const root = quartz ? 'Quartz/' : '';
      addPlan(pair.txt, `${root}omnic_txt/${safeBaseName(pair.txt.path)}`, `${quartz ? 'quartz pair; ' : ''}matched TXT`);
      addPlan(pair.csv, `${root}omnic_csv/${safeBaseName(pair.csv.path)}`, `${quartz ? 'quartz pair; ' : ''}matched CSV`);
    }
    for (const entry of pairing.unmatchedTxt) {
      const root = entry.quartz ? 'Quartz/' : '';
      addPlan(entry, `${root}unused_txt/${safeBaseName(entry.path)}`, `${entry.quartz ? 'quartz; ' : ''}unmatched TXT`);
    }
    for (const entry of pairing.unmatchedCsv) {
      const root = entry.quartz ? 'Quartz/' : '';
      addPlan(entry, `${root}unused_csv/${safeBaseName(entry.path)}`, `${entry.quartz ? 'quartz; ' : ''}unmatched CSV`);
    }
    if (options.keepOther) {
      for (const entry of otherEntries) {
        const root = entry.quartz ? 'Quartz/other/' : 'other/';
        addPlan(entry, `${root}${entry.path}`, entry.quartz ? 'quartz; other file type' : 'other file type');
        counts.other += 1;
      }
    }
  } else {
    for (const entry of transformed) {
      if (!options.keepOther && !['.txt', '.csv'].includes(extensionOf(entry.path))) continue;
      let requestedPath = entry.path;
      let action = entry.actions.join('; ') || 'copied unchanged';
      if (options.quartz && entry.quartz) {
        requestedPath = `Quartz/${entry.path}`;
        action = `${action}; moved to Quartz`;
      }
      addPlan(entry, requestedPath, action);
      if (!['.txt', '.csv'].includes(extensionOf(entry.path))) counts.other += 1;
    }
  }

  log.unshift(
    `Scanned ${counts.scanned} file(s): ${counts.txt} TXT, ${counts.csv} CSV, ${otherEntries.length} other.`,
    options.strip ? `Removed the first line from ${counts.stripped} TXT file(s).` : 'TXT header stripping was not selected.',
    options.rename ? `Renamed ${counts.renamed} @output_ file(s).` : 'OMNIC renaming was not selected.',
    options.sort ? `Matched ${counts.pairs} TXT/CSV pair(s); ${counts.unmatchedTxt} unmatched TXT; ${counts.unmatchedCsv} unmatched CSV.` : 'TXT/CSV sorting was not selected.',
    options.quartz ? `Classified ${counts.quartz} source file(s) as quartz using ${options.quartzInsensitive ? 'case-insensitive' : 'case-sensitive'} Qz matching.` : 'Quartz sorting was not selected.',
  );

  return { plan, counts, log };
}

async function processRamanZip() {
  try {
    $('ramanProcess').disabled = true;
    $('ramanDownload').disabled = true;
    $('ramanResults').classList.add('hidden');
    ramanState.outputBlob = null;
    const options = presetOptions();
    const entries = await loadZipEntries(ramanState.sourceFile, 'ramanProgress', 'ramanStatus');
    setStatus('ramanStatus', 'Applying Raman processing operations…');
    setProgress('ramanProgress', 62);

    const result = buildRamanPlan(entries, options);
    const output = new JSZip();
    const used = new Set();
    const outputRows = [];

    for (let index = 0; index < result.plan.length; index += 1) {
      const item = result.plan[index];
      const outputPath = uniqueOutputPath(item.requestedPath, used);
      output.file(outputPath, item.entry.data, { date: item.entry.date });
      outputRows.push({
        outputPath,
        sourcePath: item.entry.sourcePath,
        action: [item.action, ...item.entry.actions].filter(Boolean).filter((value, position, array) => array.indexOf(value) === position).join('; '),
      });
      setProgress('ramanProgress', 62 + Math.round(((index + 1) / Math.max(result.plan.length, 1)) * 18));
      if (index % 30 === 0) await yieldToBrowser();
    }

    setStatus('ramanStatus', 'Compressing processed files…');
    const blob = await output.generateAsync(
      { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
      (metadata) => setProgress('ramanProgress', 80 + Math.round(metadata.percent * 0.20)),
    );

    ramanState.outputBlob = blob;
    ramanState.outputRows = outputRows;
    ramanState.log = result.log;

    renderRamanResults(result.counts, outputRows, result.log);
    setProgress('ramanProgress', 100);
    setStatus('ramanStatus', `Processing complete. ${outputRows.length} file(s) are ready to download.`);
    $('ramanDownload').disabled = outputRows.length === 0;
  } catch (error) {
    console.error(error);
    setStatus('ramanStatus', error.message || 'The Raman ZIP could not be processed.', true);
    setProgress('ramanProgress', 0);
  } finally {
    $('ramanProcess').disabled = !ramanState.sourceFile;
  }
}

function renderRamanResults(counts, outputRows, log) {
  renderPills('ramanSummary', [
    ['Files scanned', counts.scanned],
    ['TXT', counts.txt],
    ['CSV', counts.csv],
    ['Matched pairs', counts.pairs],
    ['Unmatched TXT', counts.unmatchedTxt],
    ['Unmatched CSV', counts.unmatchedCsv],
    ['Quartz files', counts.quartz],
    ['Headers stripped', counts.stripped],
    ['Renamed', counts.renamed],
  ]);

  $('ramanLog').textContent = log.join('\n');
  clearElement($('ramanPreview'));
  const rows = outputRows.slice(0, MAX_PREVIEW_ROWS);
  for (const item of rows) {
    const row = document.createElement('tr');
    addTableCell(row, item.outputPath);
    addTableCell(row, item.sourcePath);
    addTableCell(row, item.action || 'copied');
    $('ramanPreview').appendChild(row);
  }
  $('ramanPreviewNote').textContent = outputRows.length > MAX_PREVIEW_ROWS
    ? `${outputRows.length} output files prepared. The preview shows the first ${MAX_PREVIEW_ROWS}.`
    : `${outputRows.length} output file(s) prepared.`;
  $('ramanResults').classList.remove('hidden');
}

function resetCsv() {
  $('csvZipFile').value = '';
  setCsvFile(null);
}

function resetRaman() {
  $('ramanZipFile').value = '';
  setRamanFile(null);
}

function initialise() {
  $('csvZipFile').addEventListener('change', (event) => setCsvFile(event.target.files?.[0] || null));
  $('csvScan').addEventListener('click', scanCsvZip);
  $('csvReset').addEventListener('click', resetCsv);
  $('csvDownload').addEventListener('click', () => {
    if (csvState.outputBlob) triggerDownload(csvState.outputBlob, 'csv_extract.zip');
  });
  for (const radio of document.querySelectorAll('input[name="csvLayout"]')) {
    radio.addEventListener('change', rebuildCsvForLayout);
  }
  attachDropZone('csvDrop', 'csvZipFile', setCsvFile);

  $('ramanZipFile').addEventListener('change', (event) => setRamanFile(event.target.files?.[0] || null));
  $('ramanProcess').addEventListener('click', processRamanZip);
  $('ramanReset').addEventListener('click', resetRaman);
  $('ramanDownload').addEventListener('click', () => {
    if (ramanState.outputBlob) triggerDownload(ramanState.outputBlob, 'raman_processed.zip');
  });
  $('ramanPreset').addEventListener('change', () => {
    $('ramanCustom').classList.toggle('hidden', $('ramanPreset').value !== 'custom');
    if (ramanState.sourceFile) {
      ramanState.outputBlob = null;
      $('ramanDownload').disabled = true;
      setStatus('ramanStatus', 'Preset changed. Click Process ZIP to rebuild the output.');
    }
  });
  for (const checkbox of $('ramanCustom').querySelectorAll('input[type="checkbox"]')) {
    checkbox.addEventListener('change', () => {
      if (ramanState.sourceFile) {
        ramanState.outputBlob = null;
        $('ramanDownload').disabled = true;
        setStatus('ramanStatus', 'Custom options changed. Click Process ZIP to rebuild the output.');
      }
    });
  }
  attachDropZone('ramanDrop', 'ramanZipFile', setRamanFile);

  setCsvFile(null);
  setRamanFile(null);
}

document.addEventListener('DOMContentLoaded', initialise);
