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
  parsedFiles: [],
  repairEntries: [],
  parseErrors: [],
  headers: [],
  rows: [],
  workbookBytes: null,
};

const collatedState = {
  selectedFiles: [],
  entries: [],
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
    ['stats', 'Metric'],
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
  const headers = [...STANDARD_ELEMENTS, ...STANDARD_RATIOS];
  const seen = new Set([...headers, 'File'].map((header) => header.toLowerCase()));

  if (includeExtras) {
    for (const sample of builderState.samples) {
      for (const header of sample.headers) {
        if (!header || META_COLUMNS.includes(header) || header === INCLUSION_COLUMN) continue;
        const key = header.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        headers.push(header);
      }
    }
  }

  return orderMeasurementHeaders(headers);
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

const QUICK_SHEET_GREEN_FILL = 'C6EFCE';

function isGreenElementHeader(header) {
  return /^(?:Y|La|Nd|Yb)\d*$/i.test(normaliseText(header));
}

function isotopeSortInfo(header) {
  const match = normaliseText(header).match(/^([A-Za-z]{1,2})(\d{1,3})$/);
  if (!match) return null;
  return {
    symbol: match[1][0].toUpperCase() + match[1].slice(1).toLowerCase(),
    mass: Number(match[2]),
  };
}

function isRatioHeader(header) {
  return /^[A-Za-z]{1,2}\s*\/\s*[A-Za-z]{1,2}$/i.test(normaliseText(header));
}

function orderMeasurementHeaders(headers) {
  const unique = [];
  const seen = new Set();

  for (const rawHeader of headers) {
    const header = canonicalHeader(rawHeader);
    if (!header) continue;
    const key = header.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(header);
  }

  const isotopes = [];
  const otherMeasurements = [];
  const ratios = [];

  for (const header of unique) {
    const isotope = isotopeSortInfo(header);
    if (isotope) {
      isotopes.push({ header, ...isotope });
    } else if (isRatioHeader(header)) {
      ratios.push(header);
    } else {
      otherMeasurements.push(header);
    }
  }

  isotopes.sort((a, b) =>
    (a.mass - b.mass) ||
    a.symbol.localeCompare(b.symbol, undefined, { sensitivity: 'base' })
  );

  // Keep the familiar QuickSheet ratio order first, then any extra ratios.
  const standardRatioRank = new Map(
    STANDARD_RATIOS.map((header, index) => [header.toLowerCase(), index]),
  );
  ratios.sort((a, b) => {
    const rankA = standardRatioRank.has(a.toLowerCase())
      ? standardRatioRank.get(a.toLowerCase())
      : Number.POSITIVE_INFINITY;
    const rankB = standardRatioRank.has(b.toLowerCase())
      ? standardRatioRank.get(b.toLowerCase())
      : Number.POSITIVE_INFINITY;

    if (rankA !== rankB) return rankA - rankB;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });

  return [
    ...isotopes.map((entry) => entry.header),
    ...otherMeasurements,
    ...ratios,
  ];
}
const QUICK_SHEET_BORDER_COLOUR = '000000';

function quickSheetEntryBoundaries(rows) {
  const groups = [];
  let start = null;

  for (let index = 0; index < rows.length; index += 1) {
    const metric = canonicalMetric(rows[index]?.Metric);
    const beginsEntry = metric === 'avg' || (start == null && !rowIsBlank(Object.values(rows[index] || {})));

    if (beginsEntry) {
      if (start != null && start < index) groups.push({ start, end: index - 1 });
      start = index;
    } else if (start == null) {
      start = index;
    }

    if (metric === 'rsd' && start != null) {
      groups.push({ start, end: index });
      start = null;
    }
  }

  if (start != null && start < rows.length) groups.push({ start, end: rows.length - 1 });
  return groups;
}

function makeCellBorder({ top = false, bottom = false, left = false, right = false } = {}) {
  const line = { style: 'thin', color: { rgb: QUICK_SHEET_BORDER_COLOUR } };
  const border = {};
  if (top) border.top = line;
  if (bottom) border.bottom = line;
  if (left) border.left = line;
  if (right) border.right = line;
  return border;
}

function styleQuickSheet(sheet, headers, rows) {
  const groups = quickSheetEntryBoundaries(rows);
  const topRows = new Set(groups.map((group) => group.start));
  const bottomRows = new Set(groups.map((group) => group.end));
  const lastColumn = headers.length - 1;

  for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
    const address = XLSX.utils.encode_cell({ r: 0, c: columnIndex });
    if (!sheet[address]) sheet[address] = { t: 's', v: headers[columnIndex] };
    sheet[address].s = {
      font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: '000000' } },
      alignment: { vertical: 'center' },
    };
  }

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const excelRow = rowIndex + 1;
    const metric = canonicalMetric(rows[rowIndex]?.Metric);

    for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
      const header = headers[columnIndex];
      const address = XLSX.utils.encode_cell({ r: excelRow, c: columnIndex });
      if (!sheet[address]) sheet[address] = { t: 's', v: '' };

      const style = {
        font: { name: 'Calibri', sz: 11, color: { rgb: '000000' } },
        alignment: { vertical: 'center' },
      };

      if (!['Code', 'Compound', 'Metric'].includes(header)) style.numFmt = '0.00';

      if (metric === 'avg' && isGreenElementHeader(header)) {
        style.fill = {
          patternType: 'solid',
          fgColor: { rgb: QUICK_SHEET_GREEN_FILL },
        };
      }

      const border = makeCellBorder({
        top: topRows.has(rowIndex),
        bottom: bottomRows.has(rowIndex),
        left: columnIndex === 0,
        right: columnIndex === lastColumn,
      });
      if (Object.keys(border).length) style.border = border;

      sheet[address].s = style;
    }
  }
}

function makeWorkbookBytes(headers, rows, sheetName = 'QuickSheet') {
  const matrix = [headers, ...rows.map((row) => headers.map((header) => row[header] ?? ''))];
  const sheet = XLSX.utils.aoa_to_sheet(matrix);
  styleQuickSheet(sheet, headers, rows);
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

  const previewRows = rows.slice(0, maxRows);
  const groups = quickSheetEntryBoundaries(previewRows);
  const topRows = new Set(groups.map((group) => group.start));
  const bottomRows = new Set(groups.map((group) => group.end));
  const body = document.createElement('tbody');

  previewRows.forEach((data, rowIndex) => {
    const row = document.createElement('tr');
    const metric = canonicalMetric(data?.Metric);
    headers.forEach((header, columnIndex) => {
      const cell = addCell(row, displayValue(data[header]));
      if (metric === 'avg' && isGreenElementHeader(header)) {
        cell.style.backgroundColor = '#C6EFCE';
      }
      if (topRows.has(rowIndex)) cell.style.borderTop = '1px solid #000';
      if (bottomRows.has(rowIndex)) cell.style.borderBottom = '1px solid #000';
      if (columnIndex === 0) cell.style.borderLeft = '1px solid #000';
      if (columnIndex === headers.length - 1) cell.style.borderRight = '1px solid #000';
    });
    body.appendChild(row);
  });
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


function loadedCollatedSignatures() {
  return new Set(collatedState.entries.map((entry) => fileSignature(entry.file)));
}

function invalidateCollatedOutput() {
  collatedState.headers = [];
  collatedState.rows = [];
  collatedState.workbookBytes = null;
  $('downloadCollatedQuickSheet').disabled = true;
  $('collatedPreviewCard').classList.add('hidden');
  clearNode($('collatedPreview'));
  renderSummary('collatedSummary', []);
}

function updateCollatedControls() {
  const queued = collatedState.selectedFiles.length;
  const loaded = collatedState.entries.length;
  $('loadCollated').disabled = queued === 0;
  $('clearCollated').disabled = queued === 0 && loaded === 0;
}

function renderCollatedQueue() {
  renderSelectedFiles(collatedState.selectedFiles, 'collatedFileList', (index) => {
    collatedState.selectedFiles.splice(index, 1);
    renderCollatedQueue();
    updateCollatedControls();
    const queued = collatedState.selectedFiles.length;
    const loaded = collatedState.entries.length;
    setStatus(
      'collatedStatus',
      queued
        ? `${queued} file(s) queued; ${loaded} subentry or subentries already loaded. Click Continue to read the queue.`
        : loaded
          ? `${loaded} subentry or subentries loaded. Add another batch at any time, or build the QuickSheet.`
          : `Add one or more collated workbooks. Each workbook's first worksheet will be read.`,
    );
  });
}

function findCollatedSummaryTable(workbook) {
  const sheetName = workbook.SheetNames?.[0];
  if (!sheetName) throw new Error('The workbook does not contain a worksheet.');

  const rows = rowsFromSheet(workbook.Sheets[sheetName]);
  for (let index = 0; index < Math.min(rows.length, 60); index += 1) {
    const headerEntries = mapHeaders(rows[index]);
    const headerSet = new Set(headerEntries.map((entry) => entry.header));
    if (headerSet.has('Code') && headerSet.has('Metric')) {
      return { sheetName, rows, headerIndex: index, headerEntries };
    }
  }
  throw new Error(`The first worksheet "${sheetName}" does not contain a header row with Code and Metric.`);
}

async function parseCollatedFile(file) {
  const workbook = await readWorkbook(file);
  const table = findCollatedSummaryTable(workbook);
  const headers = table.headerEntries.map((entry) => entry.header);
  const entries = [];
  let current = null;
  let sequence = 0;

  for (let index = table.headerIndex + 1; index < table.rows.length; index += 1) {
    const sourceRow = table.rows[index];
    if (rowIsBlank(sourceRow)) continue;

    const object = cleanQuickSheetRow(sourceRow, table.headerEntries);
    const metric = canonicalMetric(object.Metric);
    if (!['avg', 'std dev', 'rsd'].includes(metric)) continue;

    if (metric === 'avg') {
      sequence += 1;
      const sourceCode = normaliseText(object.Code) || `${safeFileStem(file.name)}_${sequence}`;
      current = {
        id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}-${sequence}`,
        file,
        fileName: file.name,
        sheetName: table.sheetName,
        sourceCode,
        code: sourceCode,
        compound: '',
        molkg: '',
        wt: '',
        headers,
        summary: {
          average: object,
          stddev: null,
          rsd: null,
        },
        inclusionCount: numericValue(object[INCLUSION_COLUMN]),
      };
      entries.push(current);
      continue;
    }

    if (!current) continue;
    if (metric === 'std dev') current.summary.stddev = object;
    if (metric === 'rsd') current.summary.rsd = object;
  }

  if (!entries.length) {
    throw new Error(`No avg / std dev / rsd subentries were found on the first worksheet "${table.sheetName}".`);
  }

  return entries;
}

function renderCollatedMetadataRows() {
  const body = $('collatedMetadataRows');
  clearNode(body);

  collatedState.entries.forEach((entry, index) => {
    const row = document.createElement('tr');
    addCell(row, entry.fileName, 'source-cell');
    addCell(row, entry.sourceCode);

    const fields = [
      ['code', 'text', entry.code],
      ['compound', 'text', entry.compound],
      ['molkg', 'number', entry.molkg],
      ['wt', 'number', entry.wt],
    ];
    for (const [field, type, value] of fields) {
      const cell = document.createElement('td');
      const input = document.createElement('input');
      input.type = type;
      input.value = value;
      input.dataset.collatedIndex = String(index);
      input.dataset.field = field;
      if (type === 'number') {
        input.step = 'any';
        input.inputMode = 'decimal';
      }
      input.addEventListener('input', () => {
        collatedState.entries[index][field] = input.value;
        invalidateCollatedOutput();
      });
      cell.appendChild(input);
      row.appendChild(cell);
    }

    addCell(row, entry.inclusionCount ?? '');
    const detected = entry.headers
      .filter((header) => !META_COLUMNS.includes(header) && header !== INCLUSION_COLUMN)
      .join(', ');
    addCell(row, detected, 'detected-columns');

    const actionCell = document.createElement('td');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'file-remove';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      collatedState.entries.splice(index, 1);
      invalidateCollatedOutput();
      renderCollatedMetadataRows();
      updateCollatedVisibility();
      updateCollatedControls();
      const queued = collatedState.selectedFiles.length;
      const loaded = collatedState.entries.length;
      setStatus(
        'collatedStatus',
        queued
          ? `${queued} file(s) queued; ${loaded} subentry or subentries loaded.`
          : loaded
            ? `${loaded} subentry or subentries loaded. Add another batch at any time, or build the QuickSheet.`
            : `Add one or more collated workbooks. Each workbook's first worksheet will be read.`,
      );
    });
    actionCell.appendChild(remove);
    row.appendChild(actionCell);
    body.appendChild(row);
  });

  $('collatedMetadataCount').textContent = `${collatedState.entries.length} subentr${collatedState.entries.length === 1 ? 'y' : 'ies'}`;
}

function updateCollatedVisibility() {
  const hasEntries = collatedState.entries.length > 0;
  $('collatedMetadataCard').classList.toggle('hidden', !hasEntries);
  if (!hasEntries && !collatedState.selectedFiles.length) {
    setStatus('collatedStatus', `Add one or more collated workbooks. Each workbook's first worksheet will be read.`);
  }
}

async function loadCollatedFiles() {
  if (!collatedState.selectedFiles.length) return;

  const queue = [...collatedState.selectedFiles];
  collatedState.selectedFiles = [];
  $('collatedFiles').value = '';
  renderCollatedQueue();
  updateCollatedControls();
  invalidateCollatedOutput();

  const errors = [];
  let filesLoaded = 0;
  let entriesAdded = 0;

  for (let index = 0; index < queue.length; index += 1) {
    const file = queue[index];
    setStatus('collatedStatus', `Reading ${file.name} (${index + 1} of ${queue.length})…`);
    try {
      const entries = await parseCollatedFile(file);
      collatedState.entries.push(...entries);
      filesLoaded += 1;
      entriesAdded += entries.length;
    } catch (error) {
      console.error(error);
      errors.push(`${file.name}: ${error.message}`);
    }
    await yieldToBrowser();
  }

  renderCollatedMetadataRows();
  updateCollatedVisibility();
  updateCollatedControls();

  const errorText = errors.length ? ` ${errors.length} file(s) could not be read.` : '';
  setStatus(
    'collatedStatus',
    `Added ${entriesAdded} subentry or subentries from ${filesLoaded} workbook(s); ${collatedState.entries.length} total loaded.${errorText}`,
    errors.length > 0 && entriesAdded === 0,
  );
  if (errors.length) setStatus('collatedBuilderStatus', errors.join(' | '), true);
  else setStatus('collatedBuilderStatus', 'Enter metadata for each subentry, add another upload batch if needed, then build the QuickSheet.');
}

function collatedMeasurementHeaders() {
  const includeExtras = $('collatedIncludeExtraColumns').checked;
  const headers = [...STANDARD_ELEMENTS, ...STANDARD_RATIOS];
  const seen = new Set([
    ...headers,
    ...META_COLUMNS,
    INCLUSION_COLUMN,
  ].map((header) => header.toLowerCase()));

  if (includeExtras) {
    for (const entry of collatedState.entries) {
      for (const header of entry.headers) {
        if (!header) continue;
        const key = header.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        headers.push(header);
      }
    }
  }

  return orderMeasurementHeaders(headers);
}

function validateCollatedMetadata() {
  const problems = [];
  collatedState.entries.forEach((entry) => {
    const label = `${entry.fileName} — ${entry.sourceCode}`;
    if (!normaliseText(entry.code)) problems.push(`${label}: Output Code is blank`);
    if (!normaliseText(entry.compound)) problems.push(`${label}: Compound is blank`);
    if (numericValue(entry.molkg) == null) problems.push(`${label}: Mol/Kg is blank or invalid`);
    if (numericValue(entry.wt) == null) problems.push(`${label}: wt% is blank or invalid`);
  });
  return problems;
}

function collatedSummaryValue(entry, metricKey, header) {
  const value = entry.summary[metricKey]?.[header];
  return numericValue(value) ?? cleanValue(value);
}

function buildRowsFromCollated() {
  const measurementHeaders = collatedMeasurementHeaders();
  const headers = [...META_COLUMNS, ...measurementHeaders, INCLUSION_COLUMN];
  const rows = [];

  for (const entry of collatedState.entries) {
    for (const metric of METRICS) {
      const row = {};
      row.Code = metric.key === 'average' ? normaliseText(entry.code) : null;
      row.Compound = metric.key === 'average' ? normaliseText(entry.compound) : null;
      row['Mol/Kg'] = metric.key === 'average' ? numericValue(entry.molkg) : null;
      row['wt%'] = metric.key === 'average' ? numericValue(entry.wt) : null;
      row.Metric = metric.label;
      for (const header of measurementHeaders) row[header] = collatedSummaryValue(entry, metric.key, header);
      row[INCLUSION_COLUMN] = metric.key === 'average' ? entry.inclusionCount : null;
      rows.push(row);
    }
  }
  return { headers, rows };
}

function buildCollatedQuickSheet() {
  try {
    const problems = validateCollatedMetadata();
    if (problems.length) throw new Error(problems.join(' | '));

    const result = buildRowsFromCollated();
    collatedState.headers = result.headers;
    collatedState.rows = result.rows;
    collatedState.workbookBytes = makeWorkbookBytes(result.headers, result.rows, 'QuickSheet');

    renderPreview('collatedPreview', result.headers, result.rows);
    const filename = ensureXlsxName($('collatedFileName').value, 'laicpms_quicksheet_from_collated');
    $('collatedOutputBadge').textContent = filename;
    $('collatedPreviewNote').textContent = result.rows.length > MAX_PREVIEW_ROWS
      ? `Showing the first ${MAX_PREVIEW_ROWS} of ${result.rows.length} rows.`
      : `Showing all ${result.rows.length} rows.`;
    renderSummary('collatedSummary', [
      ['Subentries', collatedState.entries.length],
      ['Metric rows', result.rows.length],
      ['Columns', result.headers.length],
      ['First-sheet import', 'Yes'],
    ]);
    $('collatedPreviewCard').classList.remove('hidden');
    $('downloadCollatedQuickSheet').disabled = false;
    setStatus('collatedBuilderStatus', `QuickSheet built successfully from ${collatedState.entries.length} collated subentry or subentries.`);
  } catch (error) {
    console.error(error);
    invalidateCollatedOutput();
    setStatus('collatedBuilderStatus', error.message || 'The collated QuickSheet could not be built.', true);
  }
}

function resetCollated() {
  collatedState.selectedFiles = [];
  collatedState.entries = [];
  collatedState.headers = [];
  collatedState.rows = [];
  collatedState.workbookBytes = null;
  $('collatedFiles').value = '';
  renderCollatedQueue();
  clearNode($('collatedMetadataRows'));
  $('collatedMetadataCard').classList.add('hidden');
  $('collatedPreviewCard').classList.add('hidden');
  $('downloadCollatedQuickSheet').disabled = true;
  renderSummary('collatedSummary', []);
  setStatus('collatedStatus', `Add one or more collated workbooks. Each workbook's first worksheet will be read.`);
  setStatus('collatedBuilderStatus', '');
  updateCollatedControls();
}


const CORE_QUICKSHEET_METRICS = new Set(['avg', 'std dev', 'rsd']);

function inferQuickSheetMetricColumn(rows, headerIndex) {
  const sampleEnd = Math.min(rows.length, headerIndex + 31);
  const maxColumns = rows
    .slice(headerIndex, sampleEnd)
    .reduce((maximum, row) => Math.max(maximum, row?.length || 0), 0);

  let best = null;

  for (let columnIndex = 0; columnIndex < maxColumns; columnIndex += 1) {
    const hits = [];
    for (let rowIndex = headerIndex + 1; rowIndex < sampleEnd; rowIndex += 1) {
      const metric = canonicalMetric(rows[rowIndex]?.[columnIndex]);
      if (CORE_QUICKSHEET_METRICS.has(metric)) hits.push(metric);
    }

    const distinct = new Set(hits);
    if (hits.length < 3 || distinct.size < 3) continue;

    const score = (hits.length * 10) + (distinct.size * 100);
    if (!best || score > best.score) best = { columnIndex, score };
  }

  return best?.columnIndex ?? -1;
}

function withInferredMetricHeader(headerEntries, metricColumnIndex) {
  const repaired = headerEntries
    .filter((entry) => entry.index !== metricColumnIndex && entry.header !== 'Metric')
    .map((entry) => ({ ...entry }));

  repaired.push({ header: 'Metric', index: metricColumnIndex });
  repaired.sort((a, b) => a.index - b.index);
  return repaired;
}

function quickSheetHeaderScore(headerEntries) {
  const headers = headerEntries.map((entry) => entry.header);
  const headerSet = new Set(headers);
  const measurementCount = headers.filter((header) =>
    isotopeSortInfo(header) || isRatioHeader(header)
  ).length;

  let score = measurementCount * 10;
  if (headerSet.has('Code')) score += 30;
  if (headerSet.has('Compound')) score += 12;
  if (headerSet.has('Mol/Kg')) score += 12;
  if (headerSet.has('wt%')) score += 12;
  if (headerSet.has('Metric')) score += 35;
  if (headerSet.has(INCLUSION_COLUMN)) score += 5;
  return { score, measurementCount, headerSet };
}

function findQuickSheetTable(workbook) {
  let fallback = null;

  for (const sheetName of workbook.SheetNames) {
    const rows = rowsFromSheet(workbook.Sheets[sheetName]);

    for (let index = 0; index < Math.min(rows.length, 50); index += 1) {
      const headers = mapHeaders(rows[index]);
      if (!headers.length) continue;

      const info = quickSheetHeaderScore(headers);
      const metricColumnIndex = inferQuickSheetMetricColumn(rows, index);

      // Normal modern QuickSheet.
      if (info.headerSet.has('Code') && info.headerSet.has('Metric')) {
        return {
          sheetName,
          rows,
          headerIndex: index,
          headerEntries: headers,
          inferredMetricColumn: false,
          missingMetricColumn: false,
        };
      }

      // Legacy QuickSheet with avg/std dev/rsd in an unlabeled column.
      if (metricColumnIndex >= 0 && (info.headerSet.has('Code') || info.measurementCount >= 2)) {
        return {
          sheetName,
          rows,
          headerIndex: index,
          headerEntries: withInferredMetricHeader(headers, metricColumnIndex),
          inferredMetricColumn: true,
          missingMetricColumn: false,
        };
      }

      // A QuickSheet can still be repaired manually if Code and/or Metric
      // metadata columns are entirely absent. Require a convincing set of
      // measurement headers so an arbitrary worksheet is not selected.
      if (info.measurementCount >= 2 && info.score >= 20) {
        const candidate = {
          sheetName,
          rows,
          headerIndex: index,
          headerEntries: headers,
          inferredMetricColumn: false,
          missingMetricColumn: !info.headerSet.has('Metric'),
          score: info.score,
        };
        if (!fallback || candidate.score > fallback.score) fallback = candidate;
      }
    }
  }

  if (fallback) return fallback;

  throw new Error(
    'Could not identify a QuickSheet table. The sheet needs recognizable isotope/ratio columns; missing Code, Compound, Mol/Kg, wt% or Metric metadata can then be entered manually.',
  );
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
  return {
    file,
    fileName: file.name,
    sheetName: table.sheetName,
    headers,
    rows,
    inferredMetricColumn: Boolean(table.inferredMetricColumn),
    missingMetricColumn: Boolean(table.missingMetricColumn),
  };
}


function firstPresentValue(rows, header) {
  for (const row of rows) {
    const value = row?.[header];
    if (value != null && normaliseText(value) !== '') return value;
  }
  return null;
}

function quickSheetEntryGroups(parsed) {
  const rows = parsed.rows;
  if (!rows.length) return [];

  const recognisedMetrics = rows.filter((row) =>
    CORE_QUICKSHEET_METRICS.has(canonicalMetric(row?.Metric))
  ).length;

  const groups = [];

  if (recognisedMetrics > 0) {
    let current = [];
    for (const row of rows) {
      const metric = canonicalMetric(row?.Metric);

      if (metric === 'avg' && current.length) {
        groups.push(current);
        current = [];
      }

      current.push(row);

      // Most QuickSheets are exactly avg / std dev / rsd. Closing at rsd
      // prevents a malformed following row from being swallowed into the entry.
      if (metric === 'rsd') {
        groups.push(current);
        current = [];
      }
    }
    if (current.length) groups.push(current);
    return groups.filter((group) => group.length);
  }

  // If Metric is completely absent, QuickSheets are still expected to use
  // three consecutive statistic rows per entry. Default those rows to the
  // standard avg / std dev / rsd pattern and let the user confirm/edit it.
  for (let index = 0; index < rows.length; index += 3) {
    groups.push(rows.slice(index, index + 3));
  }
  return groups.filter((group) => group.length);
}

function buildMergeRepairEntries(parsedFiles) {
  const entries = [];

  for (const parsed of parsedFiles) {
    const groups = quickSheetEntryGroups(parsed);

    groups.forEach((group, groupIndex) => {
      const metrics = group.map((row, rowIndex) => {
        const metric = canonicalMetric(row?.Metric);
        if (CORE_QUICKSHEET_METRICS.has(metric)) return metric;
        return METRICS[rowIndex]?.label || '';
      });

      const code = normaliseText(firstPresentValue(group, 'Code'));
      const compound = normaliseText(firstPresentValue(group, 'Compound'));
      const molkg = firstPresentValue(group, 'Mol/Kg');
      const wt = firstPresentValue(group, 'wt%');

      const metricNeedsRepair = group.some((row) =>
        !CORE_QUICKSHEET_METRICS.has(canonicalMetric(row?.Metric))
      );

      const needsRepair =
        !code ||
        !compound ||
        numericValue(molkg) == null ||
        numericValue(wt) == null ||
        metricNeedsRepair;

      entries.push({
        parsed,
        group,
        groupIndex,
        code,
        compound,
        molkg: molkg ?? '',
        wt: wt ?? '',
        metrics,
        metricNeedsRepair,
        needsRepair,
      });
    });
  }

  return entries;
}

function clearMergeRepair() {
  mergeState.parsedFiles = [];
  mergeState.repairEntries = [];
  mergeState.parseErrors = [];

  const card = $('mergeRepairCard');
  if (card) card.classList.add('hidden');

  const body = $('mergeRepairRows');
  if (body) clearNode(body);

  const status = $('mergeRepairStatus');
  if (status) setStatus('mergeRepairStatus', '');
}

function renderMergeRepairRows() {
  const body = $('mergeRepairRows');
  clearNode(body);

  const repairEntries = mergeState.repairEntries.filter((entry) => entry.needsRepair);

  repairEntries.forEach((entry, repairIndex) => {
    const row = document.createElement('tr');

    addCell(row, entry.parsed.fileName, 'source-cell');
    addCell(row, String(entry.groupIndex + 1));

    const metadataFields = [
      ['code', 'text', entry.code],
      ['compound', 'text', entry.compound],
      ['molkg', 'number', entry.molkg],
      ['wt', 'number', entry.wt],
    ];

    for (const [field, type, value] of metadataFields) {
      const cell = document.createElement('td');
      const input = document.createElement('input');
      input.type = type;
      input.value = value ?? '';
      input.dataset.repairIndex = String(repairIndex);
      input.dataset.field = field;

      if (type === 'number') {
        input.step = 'any';
        input.inputMode = 'decimal';
      }

      if (
        (field === 'code' && !normaliseText(value)) ||
        (field === 'compound' && !normaliseText(value)) ||
        (field === 'molkg' && numericValue(value) == null) ||
        (field === 'wt' && numericValue(value) == null)
      ) {
        input.classList.add('missing-input');
      }

      input.addEventListener('input', () => {
        entry[field] = input.value;
        input.classList.remove('missing-input');
      });

      cell.appendChild(input);
      row.appendChild(cell);
    }

    const metricCell = document.createElement('td');
    const stack = document.createElement('div');
    stack.className = 'metric-repair-stack';

    entry.group.forEach((sourceRow, rowIndex) => {
      const line = document.createElement('div');
      line.className = 'metric-repair-line';

      const label = document.createElement('span');
      label.textContent = `Row ${rowIndex + 1}`;
      line.appendChild(label);

      const select = document.createElement('select');
      const options = [
        ['', 'Choose…'],
        ['avg', 'avg'],
        ['std dev', 'std dev'],
        ['rsd', 'rsd'],
      ];
      for (const [value, text] of options) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        select.appendChild(option);
      }

      select.value = entry.metrics[rowIndex] || '';
      if (!CORE_QUICKSHEET_METRICS.has(canonicalMetric(sourceRow?.Metric))) {
        select.classList.add('missing-input');
      }

      select.addEventListener('change', () => {
        entry.metrics[rowIndex] = select.value;
        select.classList.remove('missing-input');
      });

      line.appendChild(select);
      stack.appendChild(line);
    });

    metricCell.appendChild(stack);
    row.appendChild(metricCell);

    body.appendChild(row);
  });

  $('mergeRepairCount').textContent =
    `${repairEntries.length} entr${repairEntries.length === 1 ? 'y' : 'ies'} need input`;
}

function validateMergeRepairs() {
  const problems = [];

  for (const entry of mergeState.repairEntries.filter((item) => item.needsRepair)) {
    const label = `${entry.parsed.fileName} — entry ${entry.groupIndex + 1}`;

    if (!normaliseText(entry.code)) problems.push(`${label}: Code is blank`);
    if (!normaliseText(entry.compound)) problems.push(`${label}: Compound is blank`);
    if (numericValue(entry.molkg) == null) problems.push(`${label}: Mol/Kg is blank or invalid`);
    if (numericValue(entry.wt) == null) problems.push(`${label}: wt% is blank or invalid`);

    const metrics = entry.metrics.map(canonicalMetric);
    if (metrics.some((metric) => !CORE_QUICKSHEET_METRICS.has(metric))) {
      problems.push(`${label}: every row needs a valid Metric`);
    }

    if (entry.group.length === 3) {
      const metricSet = new Set(metrics);
      if (
        metricSet.size !== 3 ||
        !metricSet.has('avg') ||
        !metricSet.has('std dev') ||
        !metricSet.has('rsd')
      ) {
        problems.push(`${label}: the three rows must contain avg, std dev and rsd once each`);
      }
    }
  }

  return problems;
}

function applyMergeRepairs() {
  for (const entry of mergeState.repairEntries) {
    const metrics = entry.metrics.map(canonicalMetric);
    const avgIndex = Math.max(0, metrics.indexOf('avg'));

    entry.group.forEach((row, rowIndex) => {
      row.Metric = metrics[rowIndex] || row.Metric || null;

      // Standardise metadata so it appears once per QuickSheet entry,
      // matching the builder's normal output format.
      row.Code = rowIndex === avgIndex ? normaliseText(entry.code) : null;
      row.Compound = rowIndex === avgIndex ? normaliseText(entry.compound) : null;
      row['Mol/Kg'] = rowIndex === avgIndex ? numericValue(entry.molkg) : null;
      row['wt%'] = rowIndex === avgIndex ? numericValue(entry.wt) : null;
    });
  }
}

function showMergeRepair(parsedFiles, errors) {
  mergeState.parsedFiles = parsedFiles;
  mergeState.parseErrors = errors;
  mergeState.repairEntries = buildMergeRepairEntries(parsedFiles);

  const missing = mergeState.repairEntries.filter((entry) => entry.needsRepair);
  if (!missing.length) return false;

  renderMergeRepairRows();
  $('mergeRepairCard').classList.remove('hidden');

  const affectedFiles = new Set(missing.map((entry) => entry.parsed.fileName)).size;
  setStatus(
    'mergeRepairStatus',
    `${missing.length} QuickSheet entr${missing.length === 1 ? 'y is' : 'ies are'} missing required plotting metadata. Fill the highlighted fields, then continue the merge.`,
    false,
  );
  setStatus(
    'mergeStatus',
    `Manual metadata is required for ${missing.length} entr${missing.length === 1 ? 'y' : 'ies'} across ${affectedFiles} workbook${affectedFiles === 1 ? '' : 's'}.`,
    false,
  );
  return true;
}

function finaliseQuickSheetMerge(parsedFiles, errors = []) {
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

  const legacyCount = parsedFiles.filter((parsed) => parsed.inferredMetricColumn).length;
  renderSummary('mergeSummary', [
    ['Workbooks merged', parsedFiles.length],
    ['Rows', rows.length],
    ['Columns', headers.length],
    ['Legacy layouts repaired', legacyCount],
    ['Files skipped', errors.length],
  ]);

  const skippedNote = errors.length ? ` ${errors.length} file(s) were skipped.` : '';
  const legacyNote = legacyCount
    ? ` Repaired ${legacyCount} older QuickSheet layout(s) with an unlabeled metric column.`
    : '';

  setStatus(
    'mergeStatus',
    `Merged ${parsedFiles.length} QuickSheet workbook(s) into ${rows.length} rows.${legacyNote}${skippedNote}`,
    false,
  );

  $('mergeQuickSheets').disabled = false;
}

function continueMergeAfterRepair() {
  const problems = validateMergeRepairs();
  if (problems.length) {
    setStatus('mergeRepairStatus', problems.slice(0, 8).join(' | '), true);
    return;
  }

  applyMergeRepairs();
  $('mergeRepairCard').classList.add('hidden');
  finaliseQuickSheetMerge(mergeState.parsedFiles, mergeState.parseErrors);
}


function orderedMergedHeaders(parsedFiles) {
  const measurementHeaders = [...STANDARD_ELEMENTS, ...STANDARD_RATIOS];
  const excluded = new Set([...META_COLUMNS, INCLUSION_COLUMN].map((header) => header.toLowerCase()));
  const seen = new Set(measurementHeaders.map((header) => header.toLowerCase()));

  for (const parsed of parsedFiles) {
    for (const rawHeader of parsed.headers) {
      const header = canonicalHeader(rawHeader);
      if (!header) continue;
      const key = header.toLowerCase();
      if (excluded.has(key) || seen.has(key)) continue;
      seen.add(key);
      measurementHeaders.push(header);
    }
  }

  return [
    ...META_COLUMNS,
    ...orderMeasurementHeaders(measurementHeaders),
    INCLUSION_COLUMN,
  ];
}

function invalidateMergeOutput() {
  mergeState.headers = [];
  mergeState.rows = [];
  mergeState.workbookBytes = null;
  $('downloadMerged').disabled = true;
  $('mergePreviewWrap').classList.add('hidden');
  clearNode($('mergePreview'));
  renderSummary('mergeSummary', []);
  clearMergeRepair();
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

  if (showMergeRepair(parsedFiles, errors)) {
    $('mergeQuickSheets').disabled = false;
    return;
  }

  mergeState.parsedFiles = parsedFiles;
  mergeState.parseErrors = errors;
  mergeState.repairEntries = buildMergeRepairEntries(parsedFiles);

  // Even when no prompting is needed, normalise the entry metadata layout.
  applyMergeRepairs();
  finaliseQuickSheetMerge(parsedFiles, errors);
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
  mergeState.parsedFiles = [];
  mergeState.repairEntries = [];
  mergeState.parseErrors = [];
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


  $('collatedFiles').addEventListener('change', (event) => {
    const incoming = Array.from(event.target.files || []);
    const result = appendUniqueFiles(
      collatedState.selectedFiles,
      incoming,
      loadedCollatedSignatures(),
    );
    collatedState.selectedFiles = result.files;
    event.target.value = '';
    renderCollatedQueue();
    updateCollatedControls();

    const queued = collatedState.selectedFiles.length;
    const loaded = collatedState.entries.length;
    const duplicateText = result.skipped ? ` ${result.skipped} duplicate file(s) were ignored.` : '';
    setStatus(
      'collatedStatus',
      queued
        ? `${queued} file(s) queued; ${loaded} subentry or subentries already loaded. Click Continue to read the queue.${duplicateText}`
        : loaded
          ? `${loaded} subentry or subentries loaded.${duplicateText}`
          : `No new files were added.${duplicateText}`,
    );
  });
  $('loadCollated').addEventListener('click', loadCollatedFiles);
  $('clearCollated').addEventListener('click', resetCollated);
  $('collatedIncludeExtraColumns').addEventListener('change', invalidateCollatedOutput);
  $('collatedFileName').addEventListener('input', () => {
    if (collatedState.workbookBytes) {
      $('collatedOutputBadge').textContent = ensureXlsxName($('collatedFileName').value, 'laicpms_quicksheet_from_collated');
    }
  });
  $('buildCollatedQuickSheet').addEventListener('click', buildCollatedQuickSheet);
  $('downloadCollatedQuickSheet').addEventListener('click', () => {
    if (!collatedState.workbookBytes) return;
    downloadBytes(
      collatedState.workbookBytes,
      ensureXlsxName($('collatedFileName').value, 'laicpms_quicksheet_from_collated'),
    );
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
  $('continueMergeRepair').addEventListener('click', continueMergeAfterRepair);
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
  resetCollated();
  resetMerge();
});
