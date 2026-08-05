/* QuickSheet Builder — GitHub Pages edition */
'use strict';

const STANDARD_ELEMENTS = [
  'Na23', 'Al27', 'Si29', 'P31', 'S34', 'Cl35', 'K39', 'Ca44',
  'Rb85', 'Y89', 'Ag107', 'Cs133', 'La139', 'Nd146', 'Yb172',
];
const STANDARD_RATIOS = ['K/Cs', 'Na/Cs', 'Rb/Cs'];
const META_COLUMNS = ['Code', 'Compound', 'Mol/Kg', 'wt%', 'Metric'];
const INCLUSION_COLUMN = 'no. inclusions';
const METRICS = [
  { key: 'average', label: 'avg' },
  { key: 'stddev', label: 'std dev' },
  { key: 'rsd', label: 'rsd' },
];
const MAX_PREVIEW_ROWS = 180;

const builderState = {
  selectedFiles: [],
  samples: [],
  headers: [],
  rows: [],
  workbookBytes: null,
};

const mergeState = {
  selectedFiles: [],
  headers: [],
  rows: [],
  workbookBytes: null,
};

const $ = (id) => document.getElementById(id);

function normaliseText(value) {
  return String(value ?? '').trim();
}

function lowerText(value) {
  return normaliseText(value).toLowerCase().replace(/\s+/g, ' ');
}

function safeFileStem(filename) {
  return normaliseText(filename)
    .replace(/\.(xlsx?|xls)$/i, '')
    .replace(/\s*\(\d+\)\s*$/i, '')
    .replace(/(?:[_\-\s]+processed)$/i, '')
    .trim() || 'Sample';
}

function ensureXlsxName(value, fallback) {
  let name = normaliseText(value) || fallback;
  if (!/\.xlsx$/i.test(name)) name += '.xlsx';
  return name.replace(/[\\/:*?"<>|]+/g, '_');
}

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

function fileSignature(file) {
  return [file.name, file.size, file.lastModified, file.type].join('::');
}

function appendUniqueFiles(existingFiles, newFiles, additionalSignatures = new Set()) {
  const known = new Set(existingFiles.map(fileSignature));
  for (const signature of additionalSignatures) known.add(signature);

  const added = [];
  let skipped = 0;
  for (const file of newFiles) {
    const signature = fileSignature(file);
    if (known.has(signature)) {
      skipped += 1;
      continue;
    }
    known.add(signature);
    added.push(file);
  }
  return { files: [...existingFiles, ...added], added: added.length, skipped };
}

function setStatus(id, text, isError = false) {
  const node = $(id);
  node.textContent = text;
  node.classList.toggle('error-text', isError);
}

function clearNode(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function addCell(row, value, className = '') {
  const cell = document.createElement('td');
  cell.textContent = value == null ? '' : String(value);
  if (className) cell.className = className;
  row.appendChild(cell);
  return cell;
}

function canonicalHeader(value) {
  const original = normaliseText(value);
  if (!original) return '';
  const compact = original.toLowerCase().replace(/[\s_.-]+/g, '');
  const slashCompact = original.toLowerCase().replace(/\s+/g, '');

  const aliases = new Map([
    ['code', 'Code'],
    ['samplecode', 'Code'],
    ['compound', 'Compound'],
    ['solution', 'Compound'],
    ['mol/kg', 'Mol/Kg'],
    ['molkg', 'Mol/Kg'],
    ['moles/kg', 'Mol/Kg'],
    ['moleskg', 'Mol/Kg'],
    ['wt%', 'wt%'],
    ['weight%', 'wt%'],
    ['weightpercent', 'wt%'],
    ['wtpercent', 'wt%'],
    ['metric', 'Metric'],
    ['statistic', 'Metric'],
    ['statistics', 'Metric'],
    ['no.inclusions', INCLUSION_COLUMN],
    ['noinclusions', INCLUSION_COLUMN],
    ['numberofinclusions', INCLUSION_COLUMN],
    ['numberinclusions', INCLUSION_COLUMN],
    ['ninclusions', INCLUSION_COLUMN],
    ['inclusions', INCLUSION_COLUMN],
    ['file', 'File'],
  ]);

  if (aliases.has(slashCompact)) return aliases.get(slashCompact);
  if (aliases.has(compact)) return aliases.get(compact);

  const ratioKey = original.toLowerCase().replace(/\s+/g, '');
  const ratioAliases = {
    'k/cs': 'K/Cs',
    'na/cs': 'Na/Cs',
    'rb/cs': 'Rb/Cs',
    'ca/cs': 'Ca/Cs',
  };
  if (ratioAliases[ratioKey]) return ratioAliases[ratioKey];

  for (const header of STANDARD_ELEMENTS) {
    if (header.toLowerCase() === original.toLowerCase().replace(/\s+/g, '')) return header;
  }

  const isotope = original.match(/^([A-Za-z]{1,2})\s*[-_ ]?\s*(\d{1,3})$/);
  if (isotope) {
    const symbol = isotope[1][0].toUpperCase() + isotope[1].slice(1).toLowerCase();
    return `${symbol}${isotope[2]}`;
  }

  return original;
}

function canonicalMetric(value) {
  const key = lowerText(value).replace(/[._-]+/g, ' ');
  if (['avg', 'average', 'mean'].includes(key)) return 'avg';
  if (['std dev', 'standard deviation', 'stdev', 'sd'].includes(key)) return 'std dev';
  if (['rsd', 'relative standard deviation'].includes(key)) return 'rsd';
  return normaliseText(value);
}

function isBelowDetection(value) {
  return typeof value === 'string' && /^\s*</.test(value);
}

function cleanValue(value) {
  if (value == null || value === '') return null;
  if (isBelowDetection(value)) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = normaliseText(value);
  if (!text) return null;
  return text;
}

function numericValue(value) {
  if (value == null || value === '' || isBelowDetection(value)) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = normaliseText(value).replace(/,/g, '');
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function sampleStdDev(values) {
  if (values.length < 2) return null;
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function ratioStatistics(rows, numerator, denominator = 'Cs133') {
  const values = [];
  for (const row of rows) {
    const top = numericValue(row[numerator]);
    const bottom = numericValue(row[denominator]);
    if (top == null || bottom == null || bottom === 0) continue;
    const ratio = top / bottom;
    if (Number.isFinite(ratio)) values.push(ratio);
  }
  const average = mean(values);
  const stddev = sampleStdDev(values);
  const rsd = average != null && average !== 0 && stddev != null ? stddev / average : null;
  return { average, stddev, rsd, validCount: values.length };
}

function rowIsBlank(row) {
  return !row || row.every((value) => value == null || normaliseText(value) === '');
}

function rowsFromSheet(sheet) {
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    raw: true,
    blankrows: true,
  });
}

async function readWorkbook(file) {
  if (!window.XLSX) throw new Error('SheetJS did not load. Refresh the page and try again.');
  const buffer = await file.arrayBuffer();
  return XLSX.read(buffer, { type: 'array', cellDates: false, dense: false });
}

function mapHeaders(headerRow) {
  const entries = [];
  const seen = new Set();
  headerRow.forEach((value, index) => {
    const header = canonicalHeader(value);
    if (!header || seen.has(header.toLowerCase())) return;
    seen.add(header.toLowerCase());
    entries.push({ header, index });
  });
  return entries;
}

function objectFromRow(row, headerEntries) {
  const object = {};
  for (const { header, index } of headerEntries) object[header] = row[index];
  return object;
}

function findProcessedSection(workbook) {
  for (const sheetName of workbook.SheetNames) {
    const rows = rowsFromSheet(workbook.Sheets[sheetName]);
    const lodIndex = rows.findIndex((row) => lowerText(row?.[0]).includes('limits of detection'));
    const end = lodIndex >= 0 ? lodIndex : rows.length;

    for (let headerIndex = 0; headerIndex < end; headerIndex += 1) {
      if (lowerText(rows[headerIndex]?.[0]) !== 'file') continue;
      const averageIndex = rows.findIndex((row, index) => index > headerIndex && index < end && lowerText(row?.[0]) === 'average');
      const stddevIndex = rows.findIndex((row, index) => index > headerIndex && index < end && ['std dev', 'standard deviation', 'stdev'].includes(lowerText(row?.[0])));
      const rsdIndex = rows.findIndex((row, index) => index > headerIndex && index < end && lowerText(row?.[0]) === 'rsd');
      if (averageIndex > headerIndex && stddevIndex > headerIndex && rsdIndex > headerIndex) {
        return { sheetName, rows, headerIndex, averageIndex, stddevIndex, rsdIndex, end };
      }
    }
  }
  throw new Error('Could not find a processed composition table with File, Average, Std Dev and RSD rows.');
}

async function parseProcessedFile(file) {
  const workbook = await readWorkbook(file);
  const section = findProcessedSection(workbook);
  const headerEntries = mapHeaders(section.rows[section.headerIndex]);
  const headers = headerEntries.map((entry) => entry.header).filter((header) => header !== 'File');
  const analysisRows = [];

  for (let index = section.headerIndex + 1; index < section.averageIndex; index += 1) {
    const sourceRow = section.rows[index];
    if (rowIsBlank(sourceRow)) continue;
    const first = normaliseText(sourceRow[0]);
    if (!first || ['average', 'std dev', 'standard deviation', 'rsd'].includes(first.toLowerCase())) continue;
    analysisRows.push(objectFromRow(sourceRow, headerEntries));
  }

  const summary = {
    average: objectFromRow(section.rows[section.averageIndex], headerEntries),
    stddev: objectFromRow(section.rows[section.stddevIndex], headerEntries),
    rsd: objectFromRow(section.rows[section.rsdIndex], headerEntries),
  };

  const ratios = {
    'K/Cs': ratioStatistics(analysisRows, 'K39'),
    'Na/Cs': ratioStatistics(analysisRows, 'Na23'),
    'Rb/Cs': ratioStatistics(analysisRows, 'Rb85'),
  };

  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    file,
    fileName: file.name,
    sheetName: section.sheetName,
    code: safeFileStem(file.name),
    compound: '',
    molkg: '',
    wt: '',
    headers,
    analysisRows,
    summary,
    ratios,
    inclusionCount: analysisRows.length,
  };
}

function renderSelectedFiles(files, targetId, onRemove = null) {
  const target = $(targetId);
  clearNode(target);
  files.forEach((file, index) => {
    const item = document.createElement('div');
    item.className = 'file-item';
    const meta = document.createElement('div');
    meta.className = 'file-meta';
    const name = document.createElement('div');
    name.className = 'file-name';
    name.textContent = file.name;
    const detail = document.createElement('div');
    detail.className = 'file-detail';
    detail.textContent = formatBytes(file.size);
    meta.append(name, detail);
    item.appendChild(meta);

    if (typeof onRemove === 'function') {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'file-remove';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => onRemove(index));
      item.appendChild(remove);
    }

    target.appendChild(item);
  });
}

function loadedProcessedSignatures() {
  return new Set(builderState.samples.map((sample) => fileSignature(sample.file)));
}

function updateProcessedControls() {
  const queued = builderState.selectedFiles.length;
  const loaded = builderState.samples.length;
  $('loadProcessed').disabled = queued === 0;
  $('clearProcessed').disabled = queued === 0 && loaded === 0;
}

function renderProcessedQueue() {
  renderSelectedFiles(builderState.selectedFiles, 'processedFileList', (index) => {
    builderState.selectedFiles.splice(index, 1);
    renderProcessedQueue();
    updateProcessedControls();
    const queued = builderState.selectedFiles.length;
    const loaded = builderState.samples.length;
    setStatus(
      'processedStatus',
      queued
        ? `${queued} file(s) queued; ${loaded} workbook(s) already loaded. Click Continue to read the queue.`
        : loaded
          ? `${loaded} workbook(s) loaded. Add another batch at any time, or build the QuickSheet.`
          : 'Add one or more processed workbooks. You may select files again to append another batch.',
    );
  });
}

function invalidateBuilderOutput() {
  builderState.headers = [];
  builderState.rows = [];
  builderState.workbookBytes = null;
  $('downloadQuickSheet').disabled = true;
  $('builderPreviewCard').classList.add('hidden');
}

function renderMetadataRows() {
  const body = $('metadataRows');
  clearNode(body);

  builderState.samples.forEach((sample, index) => {
    const row = document.createElement('tr');
    addCell(row, sample.fileName, 'source-cell');

    const fields = [
      ['code', 'text', sample.code],
      ['compound', 'text', sample.compound],
      ['molkg', 'number', sample.molkg],
      ['wt', 'number', sample.wt],
    ];
    for (const [field, type, value] of fields) {
      const cell = document.createElement('td');
      const input = document.createElement('input');
      input.type = type;
      input.value = value;
      input.dataset.sampleIndex = String(index);
      input.dataset.field = field;
      if (type === 'number') {
        input.step = 'any';
        input.inputMode = 'decimal';
      }
      input.addEventListener('input', () => {
        builderState.samples[index][field] = input.value;
        invalidateBuilderOutput();
      });
      cell.appendChild(input);
      row.appendChild(cell);
    }

    addCell(row, sample.inclusionCount);
    addCell(row, sample.headers.join(', '), 'detected-columns');

    const actionCell = document.createElement('td');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'file-remove';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      builderState.samples.splice(index, 1);
      invalidateBuilderOutput();
      renderMetadataRows();
      updateMetadataVisibility();
      updateProcessedControls();
      const queued = builderState.selectedFiles.length;
      const loaded = builderState.samples.length;
      setStatus(
        'processedStatus',
        queued
          ? `${queued} file(s) queued; ${loaded} workbook(s) loaded.`
          : loaded
            ? `${loaded} workbook(s) loaded. Add another batch at any time, or build the QuickSheet.`
            : 'Add one or more processed workbooks. You may select files again to append another batch.',
      );
    });
    actionCell.appendChild(remove);
    row.appendChild(actionCell);
    body.appendChild(row);
  });

  $('metadataCount').textContent = `${builderState.samples.length} workbook${builderState.samples.length === 1 ? '' : 's'}`;
}

function updateMetadataVisibility() {
  const hasSamples = builderState.samples.length > 0;
  $('metadataCard').classList.toggle('hidden', !hasSamples);
  if (!hasSamples && !builderState.selectedFiles.length) setStatus('processedStatus', 'Add one or more processed workbooks. You may select files again to append another batch.');
}

async function loadProcessedFiles() {
  if (!builderState.selectedFiles.length) return;

  const queue = [...builderState.selectedFiles];
  builderState.selectedFiles = [];
  $('processedFiles').value = '';
  renderProcessedQueue();
  updateProcessedControls();
  invalidateBuilderOutput();

  const errors = [];
  let newlyLoaded = 0;
  for (let index = 0; index < queue.length; index += 1) {
    const file = queue[index];
    setStatus('processedStatus', `Reading ${file.name} (${index + 1} of ${queue.length})…`);
    try {
      builderState.samples.push(await parseProcessedFile(file));
      newlyLoaded += 1;
    } catch (error) {
      console.error(error);
      errors.push(`${file.name}: ${error.message}`);
    }
    await yieldToBrowser();
  }

  renderMetadataRows();
  updateMetadataVisibility();
  updateProcessedControls();

  const total = builderState.samples.length;
  const skippedText = errors.length ? ` ${errors.length} file(s) could not be read.` : '';
  setStatus(
    'processedStatus',
    `Added ${newlyLoaded} processed workbook${newlyLoaded === 1 ? '' : 's'}; ${total} total loaded.${skippedText}`,
    errors.length > 0 && newlyLoaded === 0,
  );
  if (errors.length) setStatus('builderStatus', errors.join(' | '), true);
  else setStatus('builderStatus', 'Enter sample metadata, add another upload batch if needed, then build the QuickSheet.');
}

function measurementHeadersForBuilder() {
  const includeExtras = $('includeExtraColumns').checked;
  const extras = [];
  const seen = new Set([...STANDARD_ELEMENTS, ...STANDARD_RATIOS, 'File'].map((header) => header.toLowerCase()));

  if (includeExtras) {
    for (const sample of builderState.samples) {
      for (const header of sample.headers) {
        if (!header || META_COLUMNS.includes(header) || header === INCLUSION_COLUMN) continue;
        const key = header.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        extras.push(header);
      }
    }
  }
  return [...STANDARD_ELEMENTS, ...extras, ...STANDARD_RATIOS];
}

function validateSampleMetadata() {
  const problems = [];
  builderState.samples.forEach((sample) => {
    if (!normaliseText(sample.code)) problems.push(`${sample.fileName}: Code is blank`);
    if (!normaliseText(sample.compound)) problems.push(`${sample.fileName}: Compound is blank`);
    if (numericValue(sample.molkg) == null) problems.push(`${sample.fileName}: Mol/Kg is blank or invalid`);
    if (numericValue(sample.wt) == null) problems.push(`${sample.fileName}: wt% is blank or invalid`);
  });
  return problems;
}

function summaryValue(sample, metricKey, header) {
  const existing = cleanValue(sample.summary[metricKey]?.[header]);
  if (numericValue(existing) != null) return numericValue(existing);
  if (STANDARD_RATIOS.includes(header)) return sample.ratios[header]?.[metricKey] ?? null;
  return existing;
}

function buildRowsFromProcessed() {
  const measurementHeaders = measurementHeadersForBuilder();
  const headers = [...META_COLUMNS, ...measurementHeaders, INCLUSION_COLUMN];
  const rows = [];

  for (const sample of builderState.samples) {
    for (const metric of METRICS) {
      const row = {};
      row.Code = metric.key === 'average' ? normaliseText(sample.code) : null;
      row.Compound = metric.key === 'average' ? normaliseText(sample.compound) : null;
      row['Mol/Kg'] = metric.key === 'average' ? numericValue(sample.molkg) : null;
      row['wt%'] = metric.key === 'average' ? numericValue(sample.wt) : null;
      row.Metric = metric.label;
      for (const header of measurementHeaders) row[header] = summaryValue(sample, metric.key, header);
      row[INCLUSION_COLUMN] = metric.key === 'average' ? sample.inclusionCount : null;
      rows.push(row);
    }
  }
  return { headers, rows };
}

function makeWorkbookBytes(headers, rows, sheetName = 'QuickSheet') {
  const matrix = [headers, ...rows.map((row) => headers.map((header) => row[header] ?? null))];
  const sheet = XLSX.utils.aoa_to_sheet(matrix);
  sheet['!cols'] = headers.map((header) => {
    if (header === 'Code') return { wch: 14 };
    if (header === 'Compound') return { wch: 17 };
    if (header === 'Metric') return { wch: 11 };
    if (header === INCLUSION_COLUMN) return { wch: 15 };
    return { wch: Math.max(10, Math.min(18, header.length + 3)) };
  });
  sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ r: 0, c: 0 }, { r: Math.max(rows.length, 1), c: headers.length - 1 }) };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName.slice(0, 31));
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'array', compression: true });
}

function displayValue(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    if (Math.abs(value) >= 100000) return value.toPrecision(7).replace(/\.?0+$/, '');
    return Number(value.toPrecision(8)).toString();
  }
  return String(value);
}

function renderPreview(tableId, headers, rows, maxRows = MAX_PREVIEW_ROWS) {
  const table = $(tableId);
  clearNode(table);
  const head = document.createElement('thead');
  const headerRow = document.createElement('tr');
  for (const header of headers) {
    const th = document.createElement('th');
    th.textContent = header;
    headerRow.appendChild(th);
  }
  head.appendChild(headerRow);
  table.appendChild(head);

  const body = document.createElement('tbody');
  for (const data of rows.slice(0, maxRows)) {
    const row = document.createElement('tr');
    for (const header of headers) addCell(row, displayValue(data[header]));
    body.appendChild(row);
  }
  table.appendChild(body);
}

function renderSummary(id, pairs) {
  const target = $(id);
  clearNode(target);
  for (const [label, value] of pairs) {
    const pill = document.createElement('span');
    pill.className = 'summary-pill';
    pill.textContent = `${label}: ${value}`;
    target.appendChild(pill);
  }
}

function buildQuickSheet() {
  try {
    const problems = validateSampleMetadata();
    if (problems.length) throw new Error(problems.join(' | '));
    const result = buildRowsFromProcessed();
    builderState.headers = result.headers;
    builderState.rows = result.rows;
    builderState.workbookBytes = makeWorkbookBytes(result.headers, result.rows);

    renderPreview('builderPreview', result.headers, result.rows);
    const name = ensureXlsxName($('builderFileName').value, 'laicpms_quicksheet');
    $('builderOutputBadge').textContent = name;
    $('builderPreviewNote').textContent = result.rows.length > MAX_PREVIEW_ROWS ? `Showing the first ${MAX_PREVIEW_ROWS} of ${result.rows.length} rows.` : `Showing all ${result.rows.length} rows.`;
    renderSummary('builderSummary', [
      ['Samples', builderState.samples.length],
      ['Metric rows', result.rows.length],
      ['Columns', result.headers.length],
      ['Ratios', STANDARD_RATIOS.join(', ')],
    ]);
    $('builderPreviewCard').classList.remove('hidden');
    $('downloadQuickSheet').disabled = false;
    setStatus('builderStatus', `QuickSheet built successfully with ${builderState.samples.length} sample(s).`);
  } catch (error) {
    console.error(error);
    invalidateBuilderOutput();
    setStatus('builderStatus', error.message || 'The QuickSheet could not be built.', true);
  }
}

function downloadBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function findQuickSheetTable(workbook) {
  for (const sheetName of workbook.SheetNames) {
    const rows = rowsFromSheet(workbook.Sheets[sheetName]);
    for (let index = 0; index < Math.min(rows.length, 50); index += 1) {
      const headers = mapHeaders(rows[index]);
      const headerSet = new Set(headers.map((entry) => entry.header));
      if (headerSet.has('Code') && headerSet.has('Metric')) {
        return { sheetName, rows, headerIndex: index, headerEntries: headers };
      }
    }
  }
  throw new Error('Could not find a QuickSheet header row containing Code and Metric.');
}

function cleanQuickSheetRow(row, headerEntries) {
  const object = {};
  for (const { header, index } of headerEntries) {
    const source = row[index];
    if (header === 'Metric') object[header] = canonicalMetric(source);
    else if (['Code', 'Compound'].includes(header)) object[header] = cleanValue(source);
    else if (header === 'Mol/Kg' || header === 'wt%' || header === INCLUSION_COLUMN) object[header] = numericValue(source) ?? cleanValue(source);
    else object[header] = numericValue(source) ?? cleanValue(source);
  }
  return object;
}

async function parseQuickSheetFile(file) {
  const workbook = await readWorkbook(file);
  const table = findQuickSheetTable(workbook);
  const headers = table.headerEntries.map((entry) => entry.header);
  const rows = [];
  for (let index = table.headerIndex + 1; index < table.rows.length; index += 1) {
    const sourceRow = table.rows[index];
    if (rowIsBlank(sourceRow)) continue;
    const object = cleanQuickSheetRow(sourceRow, table.headerEntries);
    if (Object.values(object).every((value) => value == null || value === '')) continue;
    rows.push(object);
  }
  return { file, fileName: file.name, sheetName: table.sheetName, headers, rows };
}

function orderedMergedHeaders(parsedFiles) {
  const standardSet = new Set([...META_COLUMNS, ...STANDARD_ELEMENTS, ...STANDARD_RATIOS, INCLUSION_COLUMN].map((header) => header.toLowerCase()));
  const extras = [];
  const seen = new Set();
  for (const parsed of parsedFiles) {
    for (const header of parsed.headers) {
      const key = header.toLowerCase();
      if (standardSet.has(key) || seen.has(key)) continue;
      seen.add(key);
      extras.push(header);
    }
  }
  return [...META_COLUMNS, ...STANDARD_ELEMENTS, ...extras, ...STANDARD_RATIOS, INCLUSION_COLUMN];
}

function invalidateMergeOutput() {
  mergeState.headers = [];
  mergeState.rows = [];
  mergeState.workbookBytes = null;
  $('downloadMerged').disabled = true;
  $('mergePreviewWrap').classList.add('hidden');
  clearNode($('mergePreview'));
  renderSummary('mergeSummary', []);
}

function updateMergeControls() {
  const count = mergeState.selectedFiles.length;
  $('mergeQuickSheets').disabled = count === 0;
  $('clearMerge').disabled = count === 0;
}

function renderMergeFiles() {
  renderSelectedFiles(mergeState.selectedFiles, 'mergeFileList', (index) => {
    mergeState.selectedFiles.splice(index, 1);
    invalidateMergeOutput();
    renderMergeFiles();
    updateMergeControls();
    const count = mergeState.selectedFiles.length;
    setStatus(
      'mergeStatus',
      count
        ? `${count} QuickSheet file(s) selected. Add another batch or click Merge QuickSheets.`
        : 'Add QuickSheets in one or more upload rounds, then click Merge QuickSheets.',
    );
  });
}

async function mergeQuickSheets() {
  if (!mergeState.selectedFiles.length) return;
  $('mergeQuickSheets').disabled = true;
  invalidateMergeOutput();

  const parsedFiles = [];
  const errors = [];
  for (let index = 0; index < mergeState.selectedFiles.length; index += 1) {
    const file = mergeState.selectedFiles[index];
    setStatus('mergeStatus', `Reading ${file.name} (${index + 1} of ${mergeState.selectedFiles.length})…`);
    try {
      parsedFiles.push(await parseQuickSheetFile(file));
    } catch (error) {
      console.error(error);
      errors.push(`${file.name}: ${error.message}`);
    }
    await yieldToBrowser();
  }

  if (!parsedFiles.length) {
    setStatus('mergeStatus', errors.join(' | ') || 'No valid QuickSheets were found.', true);
    $('mergeQuickSheets').disabled = false;
    return;
  }

  const headers = orderedMergedHeaders(parsedFiles);
  const rows = [];
  for (const parsed of parsedFiles) {
    for (const source of parsed.rows) {
      const row = {};
      for (const header of headers) row[header] = source[header] ?? null;
      rows.push(row);
    }
  }

  mergeState.headers = headers;
  mergeState.rows = rows;
  mergeState.workbookBytes = makeWorkbookBytes(headers, rows, 'Merged QuickSheet');
  renderPreview('mergePreview', headers, rows);
  $('mergePreviewWrap').classList.remove('hidden');
  $('downloadMerged').disabled = false;
  renderSummary('mergeSummary', [
    ['Workbooks merged', parsedFiles.length],
    ['Rows', rows.length],
    ['Columns', headers.length],
    ['Files skipped', errors.length],
  ]);
  const note = errors.length ? ` ${errors.length} file(s) were skipped.` : '';
  setStatus('mergeStatus', `Merged ${parsedFiles.length} QuickSheet workbook(s) into ${rows.length} rows.${note}`, false);
  $('mergeQuickSheets').disabled = false;
}

function resetProcessed() {
  builderState.selectedFiles = [];
  builderState.samples = [];
  builderState.headers = [];
  builderState.rows = [];
  builderState.workbookBytes = null;
  $('processedFiles').value = '';
  $('loadProcessed').disabled = true;
  $('clearProcessed').disabled = true;
  renderProcessedQueue();
  clearNode($('metadataRows'));
  $('metadataCard').classList.add('hidden');
  $('builderPreviewCard').classList.add('hidden');
  $('downloadQuickSheet').disabled = true;
  renderSummary('builderSummary', []);
  setStatus('processedStatus', 'Add one or more processed workbooks. You may select files again to append another batch.');
  setStatus('builderStatus', '');
  updateProcessedControls();
}


function resetMerge() {
  mergeState.selectedFiles = [];
  mergeState.headers = [];
  mergeState.rows = [];
  mergeState.workbookBytes = null;
  $('mergeFiles').value = '';
  $('mergeQuickSheets').disabled = true;
  $('clearMerge').disabled = true;
  $('downloadMerged').disabled = true;
  renderMergeFiles();
  clearNode($('mergePreview'));
  $('mergePreviewWrap').classList.add('hidden');
  renderSummary('mergeSummary', []);
  setStatus('mergeStatus', 'Add QuickSheets in one or more upload rounds, then click Merge QuickSheets.');
  updateMergeControls();
}


function bindEvents() {
  $('processedFiles').addEventListener('change', (event) => {
    const incoming = Array.from(event.target.files || []);
    const result = appendUniqueFiles(
      builderState.selectedFiles,
      incoming,
      loadedProcessedSignatures(),
    );
    builderState.selectedFiles = result.files;
    event.target.value = '';
    renderProcessedQueue();
    updateProcessedControls();

    const queued = builderState.selectedFiles.length;
    const loaded = builderState.samples.length;
    const duplicateText = result.skipped ? ` ${result.skipped} duplicate file(s) were ignored.` : '';
    setStatus(
      'processedStatus',
      queued
        ? `${queued} file(s) queued; ${loaded} workbook(s) already loaded. Click Continue to read the queue.${duplicateText}`
        : loaded
          ? `${loaded} workbook(s) loaded.${duplicateText}`
          : `No new files were added.${duplicateText}`,
    );
  });
  $('loadProcessed').addEventListener('click', loadProcessedFiles);
  $('clearProcessed').addEventListener('click', resetProcessed);
  $('includeExtraColumns').addEventListener('change', invalidateBuilderOutput);
  $('builderFileName').addEventListener('input', () => {
    if (builderState.workbookBytes) $('builderOutputBadge').textContent = ensureXlsxName($('builderFileName').value, 'laicpms_quicksheet');
  });
  $('buildQuickSheet').addEventListener('click', buildQuickSheet);
  $('downloadQuickSheet').addEventListener('click', () => {
    if (!builderState.workbookBytes) return;
    downloadBytes(builderState.workbookBytes, ensureXlsxName($('builderFileName').value, 'laicpms_quicksheet'));
  });

  $('mergeFiles').addEventListener('change', (event) => {
    const incoming = Array.from(event.target.files || []);
    const result = appendUniqueFiles(mergeState.selectedFiles, incoming);
    mergeState.selectedFiles = result.files;
    event.target.value = '';
    invalidateMergeOutput();
    renderMergeFiles();
    updateMergeControls();

    const count = mergeState.selectedFiles.length;
    const duplicateText = result.skipped ? ` ${result.skipped} duplicate file(s) were ignored.` : '';
    setStatus(
      'mergeStatus',
      count
        ? `${count} QuickSheet file(s) selected. Add another batch or click Merge QuickSheets.${duplicateText}`
        : `No new files were added.${duplicateText}`,
    );
  });
  $('mergeQuickSheets').addEventListener('click', mergeQuickSheets);
  $('clearMerge').addEventListener('click', resetMerge);
  $('mergeFileName').addEventListener('input', () => {
    if (mergeState.workbookBytes) $('downloadMerged').disabled = false;
  });
  $('downloadMerged').addEventListener('click', () => {
    if (!mergeState.workbookBytes) return;
    downloadBytes(mergeState.workbookBytes, ensureXlsxName($('mergeFileName').value, 'laicpms_quicksheet_merged'));
  });
}

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  resetProcessed();
  resetMerge();
});
