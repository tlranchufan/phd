'use strict';

const $ = id => document.getElementById(id);
const state = {
  pending: null,
  file: null,
  rows: [],
  avgRows: [],
  sdRows: [],
  elements: [],
  codes: [],
  compareElementOrder: [],
  creeResults: [],
  yMin: null,
  yMax: null
};

const atomicWeights = {
  Na:22.98976928, Al:26.9815385, Si:28.085, K:39.0983, Ca:40.078, Ti:47.867,
  Cr:51.9961, Mn:54.938044, Fe:55.845, Co:58.933194, Ni:58.6934, Cu:63.546,
  Zn:65.38, Rb:85.4678, Sr:87.62, Y:88.90584, Zr:91.224, Nb:92.90637,
  Cs:132.90545196, Ba:137.327, La:138.90547, Ce:140.116, Pr:140.90766,
  Nd:144.242, Sm:150.36, Eu:151.964, Gd:157.25, Tb:158.92535, Dy:162.5,
  Ho:164.93033, Er:167.259, Tm:168.93422, Yb:173.045, Lu:174.9668,
  Hf:178.49, Ta:180.94788, Pb:207.2, Th:232.0377, U:238.02891
};

const CHONDRITE_REFERENCE_META = {
  name: 'CI chondrite',
  citation: 'McDonough & Sun (1995)',
  title: 'The composition of the Earth',
  doi: '10.1016/0009-2541(94)00140-4'
};

// Table 2 values transcribed from the user-supplied workbook.
// Units intentionally remain in their source form and are converted to ppm
// at runtime so wt%, ppm, and ppb cannot be mixed accidentally.
// The uploaded workbook contains a second "Ti" row at 140 ppb. Table 2 of
// McDonough & Sun (1995) identifies that row as Tl, so it is represented as Tl.
const CI_CHONDRITE_SOURCE = [
  {element:"Li", value:1.5, unit:"ppm"},
  {element:"Be", value:0.025, unit:"ppm"},
  {element:"B", value:0.9, unit:"ppm"},
  {element:"C", value:3.5, unit:"%"},
  {element:"N", value:3180, unit:"ppm"},
  {element:"F", value:60, unit:"ppm"},
  {element:"Na", value:5100, unit:"ppm"},
  {element:"Mg", value:9.65, unit:"%"},
  {element:"Al", value:0.86, unit:"%"},
  {element:"Si", value:10.65, unit:"%"},
  {element:"P", value:1080, unit:"ppm"},
  {element:"S", value:5.4, unit:"%"},
  {element:"Cl", value:680, unit:"ppm"},
  {element:"K", value:550, unit:"ppm"},
  {element:"Ca", value:0.925, unit:"%"},
  {element:"Sc", value:5.92, unit:"ppm"},
  {element:"Ti", value:440, unit:"ppm"},
  {element:"V", value:56, unit:"ppm"},
  {element:"Cr", value:2650, unit:"ppm"},
  {element:"Mn", value:1920, unit:"ppm"},
  {element:"Fe", value:18.1, unit:"%"},
  {element:"Co", value:500, unit:"ppm"},
  {element:"Ni", value:10500, unit:"ppm"},
  {element:"Cu", value:120, unit:"ppm"},
  {element:"Zn", value:310, unit:"ppm"},
  {element:"Ga", value:9.2, unit:"ppm"},
  {element:"Ge", value:31, unit:"ppm"},
  {element:"As", value:1.85, unit:"ppm"},
  {element:"Se", value:21, unit:"ppm"},
  {element:"Br", value:3.57, unit:"ppm"},
  {element:"Rb", value:2.3, unit:"ppm"},
  {element:"Sr", value:7.25, unit:"ppm"},
  {element:"Y", value:1.57, unit:"ppm"},
  {element:"Zr", value:3.82, unit:"ppm"},
  {element:"Nb", value:240, unit:"ppb"},
  {element:"Mo", value:900, unit:"ppb"},
  {element:"Ru", value:710, unit:"ppb"},
  {element:"Rh", value:130, unit:"ppb"},
  {element:"Pd", value:550, unit:"ppb"},
  {element:"Ag", value:200, unit:"ppb"},
  {element:"Cd", value:710, unit:"ppb"},
  {element:"In", value:80, unit:"ppb"},
  {element:"Sn", value:1650, unit:"ppb"},
  {element:"Sb", value:140, unit:"ppb"},
  {element:"Te", value:2330, unit:"ppb"},
  {element:"I", value:450, unit:"ppb"},
  {element:"Cs", value:190, unit:"ppb"},
  {element:"Ba", value:2410, unit:"ppb"},
  {element:"La", value:237, unit:"ppb"},
  {element:"Ce", value:613, unit:"ppb"},
  {element:"Pr", value:92.8, unit:"ppb"},
  {element:"Nd", value:457, unit:"ppb"},
  {element:"Sm", value:148, unit:"ppb"},
  {element:"Eu", value:56.3, unit:"ppb"},
  {element:"Gd", value:199, unit:"ppb"},
  {element:"Tb", value:36.1, unit:"ppb"},
  {element:"Dy", value:246, unit:"ppb"},
  {element:"Ho", value:54.6, unit:"ppb"},
  {element:"Er", value:160, unit:"ppb"},
  {element:"Tm", value:24.7, unit:"ppb"},
  {element:"Yb", value:161, unit:"ppb"},
  {element:"Lu", value:24.6, unit:"ppb"},
  {element:"Hf", value:103, unit:"ppb"},
  {element:"Ta", value:13.6, unit:"ppb"},
  {element:"W", value:93, unit:"ppb"},
  {element:"Re", value:40, unit:"ppb"},
  {element:"Os", value:490, unit:"ppb"},
  {element:"Ir", value:455, unit:"ppb"},
  {element:"Pt", value:1010, unit:"ppb"},
  {element:"Au", value:140, unit:"ppb"},
  {element:"Hg", value:300, unit:"ppb"},
  {element:"Tl", value:140, unit:"ppb"},
  {element:"Pb", value:2470, unit:"ppb"},
  {element:"Bi", value:110, unit:"ppb"},
  {element:"Th", value:29, unit:"ppb"},
  {element:"U", value:7.4, unit:"ppb"}
];

function referenceUnitToPpm(value, unit) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const key = String(unit ?? '').trim().toLowerCase().replaceAll(' ', '');
  if (key === 'ppm') return n;
  if (key === 'ppb') return n / 1000;
  if (key === '%' || key === 'wt%' || key === 'wt.%') return n * 10000;
  return null;
}

const CI_CHONDRITE_BY_ELEMENT = new Map(
  CI_CHONDRITE_SOURCE.map(entry => [
    entry.element,
    {...entry, ppm: referenceUnitToPpm(entry.value, entry.unit)}
  ])
);

function isElementColumnName(name) {
  return /^[A-Z][a-z]?\d*$/.test(String(name ?? '').trim());
}

function chondriteReferenceForElement(columnName) {
  if (!isElementColumnName(columnName)) return null;
  return CI_CHONDRITE_BY_ELEMENT.get(elemSymbol(columnName)) || null;
}

function chondritePpmForElement(columnName) {
  const ref = chondriteReferenceForElement(columnName);
  return ref && Number.isFinite(ref.ppm) && ref.ppm > 0 ? ref.ppm : null;
}

function chondriteSourceText(columnName) {
  const ref = chondriteReferenceForElement(columnName);
  if (!ref) return '';
  return `${ref.value} ${ref.unit} = ${Number(ref.ppm.toPrecision(10))} ppm`;
}

function chondriteNormalizationEnabled() {
  return Boolean($('normalizeChondrite')?.checked);
}


const META = new Set(['Code','Compound','Mol/Kg','wt%','Metric','no. inclusions','File','DECISION','K/Cs','Na/Cs','Rb/Cs']);
const num = v => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replaceAll(',','').trim());
  return Number.isFinite(n) ? n : null;
};
const elemSymbol = name => (String(name).match(/^[A-Za-z]+/) || [''])[0];

function elementDisplayName(name) {
  const full = String(name ?? '');
  return $('showIsotopeLabels')?.checked ? full : (elemSymbol(full) || full);
}

const sanitizeName = value => {
  const s = String(value || 'laicpms_plot').trim().replace(/[\\/:*?"<>|]+/g,'_').replace(/\s+/g,'_');
  return s || 'laicpms_plot';
};
const selectedValues = select => [...select.selectedOptions].map(o => o.value);
const radioValue = name => document.querySelector(`input[name="${name}"]:checked`)?.value;

function isBlank(value) {
  return value === '' || value === null || value === undefined;
}

function metricKey(value) {
  const key = String(value ?? '').trim().toLowerCase().replace(/[._-]+/g, ' ').replace(/\s+/g, ' ');
  if (['avg', 'average', 'mean'].includes(key)) return 'avg';
  if (['std dev', 'standard deviation', 'stdev', 'sd'].includes(key)) return 'std dev';
  if (['rsd', 'relative standard deviation'].includes(key)) return 'rsd';
  return key;
}

function fillDownWithinEntries(rows, columns) {
  let current = Object.fromEntries(columns.map(col => [col, '']));

  return rows.map(row => {
    const out = {...row};
    const metric = metricKey(out.Metric);

    // An avg row starts a NEW QuickSheet entry. Reset every metadata field here.
    // This is the key safeguard: a genuinely blank Mol/Kg or wt% on a new avg
    // row must NOT inherit the previous sample's x value.
    if (metric === 'avg') {
      current = {};
      columns.forEach(col => {
        current[col] = isBlank(out[col]) ? '' : out[col];
      });
      return out;
    }

    // std dev / rsd rows belong to the current entry, so blank metadata on
    // those rows should inherit only from that entry's avg row.
    columns.forEach(col => {
      if (isBlank(out[col])) out[col] = current[col] ?? '';
      else current[col] = out[col];
    });

    return out;
  });
}

function sortElements(elements) {
  return [...elements].sort((a,b) => {
    const awA = atomicWeights[elemSymbol(a)] ?? Infinity;
    const awB = atomicWeights[elemSymbol(b)] ?? Infinity;
    return awA - awB || a.localeCompare(b, undefined, {numeric:true});
  });
}

function findMetric(rows, target) {
  const t = target.toLowerCase();
  return rows.filter(r => String(r.Metric ?? '').trim().toLowerCase() === t);
}

function rowKey(row, index) {
  const filePart = String(row.File ?? '').trim();
  return `${String(row.Code ?? '').trim()}||${String(row.Compound ?? '').trim()}||${filePart}||${index}`;
}

function parseWorkbook(file, bytes) {
  const wb = XLSX.read(bytes, {type:'array', raw:true});
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, {defval:'', raw:true});
  const required = ['Code','Compound','Mol/Kg','wt%','Metric'];
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const missing = required.filter(h => !headers.includes(h));
  if (missing.length) throw new Error(`Missing required columns: ${missing.join(', ')}`);

  const filled = fillDownWithinEntries(rows, ['Code','Compound','Mol/Kg','wt%']);
  const avgRows = findMetric(filled, 'avg');
  const sdRows = findMetric(filled, 'std dev');
  if (!avgRows.length) throw new Error('No rows with Metric = "avg" were found.');

  const candidateElements = headers.filter(h => !META.has(h));
  const elements = sortElements(candidateElements.filter(h => avgRows.some(r => num(r[h]) !== null)));
  if (!elements.length) throw new Error('No numeric element columns were detected in the avg rows.');

  const sdLookup = new Map();
  sdRows.forEach((r,i) => {
    const key = `${String(r.Code)}||${String(r.Compound)}||${String(r['Mol/Kg'])}||${String(r['wt%'])}`;
    if (!sdLookup.has(key)) sdLookup.set(key, r);
  });
  avgRows.forEach((r,i) => {
    r.__index = i;
    r.__sampleKey = rowKey(r,i);
    const key = `${String(r.Code)}||${String(r.Compound)}||${String(r['Mol/Kg'])}||${String(r['wt%'])}`;
    r.__sd = sdLookup.get(key) || null;
  });

  return {
    name:file.name, size:file.size, sheetName, rows:filled, avgRows, sdRows,
    elements, codes:[...new Set(avgRows.map(r => String(r.Code)).filter(Boolean))].sort()
  };
}

function setOptions(select, values, selected=[]) {
  const chosen = new Set(selected);
  select.innerHTML = values.map(v => `<option value="${String(v).replaceAll('&','&amp;').replaceAll('"','&quot;')}" ${chosen.has(v)?'selected':''}>${v}</option>`).join('');
}

function sameNumericValue(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

function uniqueNumericValues(values) {
  const out = [];
  values.forEach(value => {
    if (!Number.isFinite(value)) return;
    if (!out.some(existing => sameNumericValue(existing, value))) out.push(value);
  });
  return out.sort((a, b) => a - b);
}

function commonMolKgValues(codes) {
  const selectedCodes = [...codes];
  if (selectedCodes.length < 2) return [];

  const valuesByCode = selectedCodes.map(code =>
    uniqueNumericValues(
      state.avgRows
        .filter(row => String(row.Code) === code)
        .map(row => num(row['Mol/Kg']))
        .filter(Number.isFinite)
    )
  );

  if (valuesByCode.some(values => !values.length)) return [];

  return valuesByCode[0].filter(value =>
    valuesByCode.slice(1).every(values =>
      values.some(other => sameNumericValue(value, other))
    )
  );
}

function formatMolKg(value) {
  if (!Number.isFinite(value)) return '';
  return String(Number(value.toPrecision(12)));
}

function updateCompareMolChoices() {
  if (!state.file) return;

  const select = $('compareMolKg');
  const hint = $('compareMolHint');
  const codes = new Set(selectedValues($('codes')));
  const previous = num(select.value);
  const common = commonMolKgValues(codes);

  let chosen = null;
  if (previous !== null) {
    chosen = common.find(value => sameNumericValue(value, previous)) ?? null;
  }
  if (chosen === null && common.length) chosen = common[0];

  select.innerHTML = common.length
    ? common.map(value => `<option value="${value}" ${chosen !== null && sameNumericValue(value, chosen) ? 'selected' : ''}>${formatMolKg(value)}</option>`).join('')
    : '<option value="">No common Mol/Kg</option>';

  select.disabled = common.length === 0;

  if (codes.size < 2) {
    hint.textContent = 'Select at least two Codes to find common Mol/Kg values.';
  } else if (!common.length) {
    hint.textContent = 'The selected Codes do not share a Mol/Kg value.';
  } else {
    hint.textContent = `${common.length} common Mol/Kg value${common.length === 1 ? '' : 's'} available across ${codes.size} selected Codes.`;
  }
}

function compareRowsForCode(code, molkg) {
  return state.avgRows.filter(row =>
    String(row.Code) === code &&
    sameNumericValue(num(row['Mol/Kg']), molkg)
  );
}


function creeValidRowsForElement(rows, element, compound=null) {
  const normalize = chondriteNormalizationEnabled();
  const ciPpm = normalize ? chondritePpmForElement(element) : null;
  if (normalize && ciPpm === null) return [];

  return rows
    .filter(row => compound === null || String(row.Compound || 'Unknown') === compound)
    .map(row => {
      const solute = num(row['Mol/Kg']);
      const raw = num(row[element]);
      if (solute === null || solute <= 0 || raw === null || raw <= 0) return null;

      const concentration = normalize ? raw / ciPpm : raw;
      if (!Number.isFinite(concentration) || concentration <= 0) return null;

      return {
        row,
        solute,
        concentration,
        x: Math.log10(solute),
        y: Math.log10(concentration)
      };
    })
    .filter(Boolean);
}

function linearRegression(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;

  const meanX = xs.reduce((a,b)=>a+b,0) / n;
  const meanY = ys.reduce((a,b)=>a+b,0) / n;

  let sxx = 0, sxy = 0, syy = 0;
  for (let i=0; i<n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }

  if (!Number.isFinite(sxx) || sxx <= 0) return null;

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;

  let ssRes = 0;
  for (let i=0; i<n; i++) {
    const predicted = intercept + slope * xs[i];
    const residual = ys[i] - predicted;
    ssRes += residual * residual;
  }

  const r2 = syy > 0 ? 1 - ssRes / syy : 1;
  return {
    slope,
    intercept,
    r2: Number.isFinite(r2) ? Math.max(-1, Math.min(1, r2)) : null,
    n,
    minX: Math.min(...xs),
    maxX: Math.max(...xs)
  };
}

const CREE_ELEMENT_COLORS = [
  '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd',
  '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf',
  '#393b79', '#637939', '#8c6d31', '#843c39', '#7b4173',
  '#3182bd', '#31a354', '#756bb1', '#636363', '#e6550d'
];

const CREE_COMPOUND_SYMBOLS = [
  'circle', 'square', 'diamond', 'cross', 'triangle-up',
  'triangle-down', 'star', 'hexagon', 'pentagon', 'x'
];

const CREE_COMPOUND_DASHES = [
  'solid', 'dash', 'dot', 'dashdot', 'longdash', 'longdashdot'
];

function creeElementColor(element) {
  const index = Math.max(0, state.elements.indexOf(element));
  return CREE_ELEMENT_COLORS[index % CREE_ELEMENT_COLORS.length];
}

function creeRegressionLabel(element, compound, fit) {
  const base = `${elementDisplayName(element)} · ${compound}`;
  if (!$('creeShowEquation')?.checked || !fit) return base;
  const nText = Number.isFinite(fit.slope) ? fit.slope.toFixed(2) : '—';
  const r2Text = Number.isFinite(fit.r2) ? fit.r2.toFixed(3) : '—';
  return `${base} (n=${nText}, R²=${r2Text})`;
}

function creeLogError(raw, sdRaw, ciPpm=null) {
  if (!Number.isFinite(raw) || raw <= 0 || !Number.isFinite(sdRaw) || sdRaw < 0) {
    return {plus:0, minus:0, lowerClipped:false};
  }

  const scale = ciPpm && ciPpm > 0 ? ciPpm : 1;
  const value = raw / scale;
  const sd = sdRaw / scale;
  if (!(value > 0) || !(sd >= 0)) return {plus:0, minus:0, lowerClipped:false};

  const center = Math.log10(value);
  const upper = Math.log10(value + sd) - center;

  if (value - sd <= 0) {
    return {plus:Number.isFinite(upper)?upper:0, minus:0, lowerClipped:true};
  }

  const lower = center - Math.log10(value - sd);
  return {
    plus:Number.isFinite(upper)?upper:0,
    minus:Number.isFinite(lower)?lower:0,
    lowerClipped:false
  };
}

function renderCreeResults(results) {
  state.creeResults = results || [];
  const card = $('creeResultsCard');
  const body = $('creeResultsBody');
  const button = $('downloadCreeCsv');

  if (radioValue('plotMode') !== 'cree' || !state.creeResults.length) {
    card.classList.add('hidden');
    body.innerHTML = '';
    button.disabled = true;
    return;
  }

  body.innerHTML = state.creeResults.map(result => `
    <tr>
      <td>${elementDisplayName(result.element)}</td>
      <td>${result.compound}</td>
      <td>${Number.isFinite(result.slope) ? result.slope.toFixed(4) : '—'}</td>
      <td>${Number.isFinite(result.intercept) ? result.intercept.toFixed(4) : '—'}</td>
      <td>${Number.isFinite(result.A) ? Number(result.A.toPrecision(6)) : '—'}</td>
      <td>${Number.isFinite(result.r2) ? result.r2.toFixed(4) : '—'}</td>
      <td>${result.n}</td>
      <td>${formatMolKg(result.minSolute)}–${formatMolKg(result.maxSolute)}</td>
    </tr>
  `).join('');

  card.classList.remove('hidden');
  button.disabled = false;
}

function downloadCreeResultsCsv() {
  if (!state.creeResults.length) return;

  const rows = [
    ['Element','Compound','Slope_n','log10_A','A','R2','N','Min_MolKg','Max_MolKg','CI_normalized'],
    ...state.creeResults.map(result => [
      elementDisplayName(result.element),
      result.compound,
      result.slope,
      result.intercept,
      result.A,
      result.r2,
      result.n,
      result.minSolute,
      result.maxSolute,
      chondriteNormalizationEnabled() ? 'YES' : 'NO'
    ])
  ];

  const csv = rows.map(row =>
    row.map(value => `"${String(value ?? '').replaceAll('"','""')}"`).join(',')
  ).join('\r\n');

  const blob = new Blob([csv], {type:'text/csv;charset=utf-8'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${sanitizeName($('plotName').value)}_cree_regression.csv`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

function updateYBoundsHint() {
  const hint = $('yBoundsHint');
  if (!hint) return;

  if (radioValue('plotMode') === 'cree') {
    hint.textContent = 'Optional. CREE mode already plots log10-transformed values, so enter Y minimum and maximum directly in log10 units (for example 2 to 5).';
  } else {
    hint.textContent = 'Optional. Enter the actual minimum and maximum values you want displayed, then click Apply Y bounds. The same bounds are applied to every facet. For log10 plots, enter the real values (for example 10 and 10000), not the exponents.';
  }
}

function eligibleElementsForCodes(codes) {
  if (!state.file || !codes.size) return [];

  const plotMode = radioValue('plotMode');

  if (plotMode === 'cree') {
    const rows = state.avgRows.filter(row => codes.has(String(row.Code)));
    return state.elements.filter(element => {
      if (chondriteNormalizationEnabled() && chondritePpmForElement(element) === null) return false;
      const compounds = [...new Set(rows.map(row => String(row.Compound || 'Unknown')))];
      return compounds.some(compound => creeValidRowsForElement(rows, element, compound).length >= 2);
    });
  }

  if (plotMode === 'compare') {
    const molkg = num($('compareMolKg')?.value);
    if (codes.size < 2 || molkg === null) return [];

    // In Compare mode, every selected Code must contain a numeric value for
    // the element at the chosen shared Mol/Kg. This guarantees a complete
    // double/triple/etc. bar group for each eligible element.
    return state.elements.filter(element =>
      (!chondriteNormalizationEnabled() || chondritePpmForElement(element) !== null) &&
      [...codes].every(code =>
        compareRowsForCode(code, molkg).some(row => num(row[element]) !== null)
      )
    );
  }

  const rows = state.avgRows.filter(row => codes.has(String(row.Code)));
  return state.elements.filter(element =>
    (!chondriteNormalizationEnabled() || chondritePpmForElement(element) !== null) &&
    rows.some(row => num(row[element]) !== null)
  );
}

function syncCompareElementOrder({reset=false} = {}) {
  const orderSelect = $('compareElementOrder');
  if (!orderSelect) return;

  const selected = selectedValues($('elements'));
  const selectedSet = new Set(selected);

  if (reset) {
    state.compareElementOrder = [...selected];
  } else {
    const kept = state.compareElementOrder.filter(element => selectedSet.has(element));
    const appended = selected.filter(element => !kept.includes(element));
    state.compareElementOrder = [...kept, ...appended];
  }

  const previousFocus = orderSelect.value;
  orderSelect.innerHTML = state.compareElementOrder
    .map(element => `<option value="${String(element).replaceAll('&','&amp;').replaceAll('"','&quot;')}">${elementDisplayName(element)}</option>`)
    .join('');

  if (state.compareElementOrder.includes(previousFocus)) {
    orderSelect.value = previousFocus;
  } else if (state.compareElementOrder.length) {
    orderSelect.value = state.compareElementOrder[0];
  }

  const hasSelection = state.compareElementOrder.length > 0;
  $('moveCompareElementLeft').disabled = !hasSelection;
  $('moveCompareElementRight').disabled = !hasSelection;
  $('resetCompareElementOrder').disabled = !hasSelection;
}

function orderedCompareElements() {
  const selected = selectedValues($('elements'));
  const selectedSet = new Set(selected);
  const ordered = state.compareElementOrder.filter(element => selectedSet.has(element));
  const missing = selected.filter(element => !ordered.includes(element));
  return [...ordered, ...missing];
}

function moveCompareElement(direction) {
  syncCompareElementOrder();

  const select = $('compareElementOrder');
  const element = select.value;
  if (!element) return;

  const index = state.compareElementOrder.indexOf(element);
  if (index < 0) return;

  const target = index + direction;
  if (target < 0 || target >= state.compareElementOrder.length) return;

  [state.compareElementOrder[index], state.compareElementOrder[target]] =
    [state.compareElementOrder[target], state.compareElementOrder[index]];

  syncCompareElementOrder();
  select.value = element;
  renderPlot();
}

function updateElementChoices({initial=false, autoSelectIfEmpty=false} = {}) {
  if (!state.file) return;

  const codes = new Set(selectedValues($('codes')));
  const eligible = eligibleElementsForCodes(codes);

  const previousElements = selectedValues($('elements'));
  const retainedElements = previousElements.filter(element => eligible.includes(element));

  let selectedElements = retainedElements;
  if ((initial || autoSelectIfEmpty) && !selectedElements.length) {
    selectedElements = eligible.slice(0, Math.min(6, eligible.length));
  }

  setOptions($('elements'), eligible, selectedElements);

  const previousNumerator = $('numerator').value;
  const previousDenominator = $('denominator').value;

  const numeratorSelection = eligible.includes(previousNumerator)
    ? [previousNumerator]
    : eligible.slice(0, 1);

  let denominatorSelection = eligible.includes(previousDenominator)
    ? [previousDenominator]
    : [];

  if (!denominatorSelection.length) {
    denominatorSelection = eligible.filter(element => element !== numeratorSelection[0]).slice(0, 1);
  }

  setOptions($('numerator'), eligible, numeratorSelection);
  setOptions($('denominator'), eligible, denominatorSelection);

  const hint = $('elementAvailabilityHint');
  if (hint) {
    const plotMode = radioValue('plotMode');
    if (!codes.size) {
      hint.textContent = 'Select at least one Code to make element choices available.';
    } else if (plotMode === 'compare' && codes.size < 2) {
      hint.textContent = 'Compare mode requires at least two selected Codes.';
    } else if (plotMode === 'compare' && num($('compareMolKg')?.value) === null) {
      hint.textContent = 'No common Mol/Kg is available for the selected Codes.';
    } else if (!eligible.length) {
      hint.textContent = plotMode === 'compare'
        ? 'No element has a numeric avg value in every selected Code at this Mol/Kg.'
        : plotMode === 'cree'
          ? 'No element has at least two positive concentration points at positive Mol/Kg for the selected Codes.'
          : 'No element columns contain numeric avg values for the selected Codes.';
    } else if (plotMode === 'compare') {
      hint.textContent = `${eligible.length} element${eligible.length === 1 ? '' : 's'} available in every selected Code at ${formatMolKg(num($('compareMolKg').value))} Mol/Kg.`;
    } else if (plotMode === 'cree') {
      hint.textContent = `${eligible.length} element${eligible.length === 1 ? '' : 's'} have enough positive data for at least one log–log fit across the selected Codes.`;
    } else {
      hint.textContent = `${eligible.length} element${eligible.length === 1 ? '' : 's'} available for the selected Code${codes.size === 1 ? '' : 's'}.`;
    }

    if (chondriteNormalizationEnabled()) {
      hint.textContent += ' CI normalization is on, so elements without a McDonough & Sun (1995) reference value are excluded.';
    }
  }

  syncCompareElementOrder();
}

function clearWorkbook() {
  state.pending = null;
  state.file = null;
  state.rows = [];
  state.avgRows = [];
  state.sdRows = [];
  state.elements = [];
  state.codes = [];
  state.compareElementOrder = [];
  state.creeResults = [];
  state.yMin = null;
  state.yMax = null;

  $('plotFile').value='';
  $('compareElementOrder').innerHTML='';
  $('moveCompareElementLeft').disabled=true;
  $('moveCompareElementRight').disabled=true;
  $('resetCompareElementOrder').disabled=true;
  $('yMin').value='';
  $('yMax').value='';
  $('yBoundsControls').classList.add('hidden');
  $('loadPlotFile').disabled=true; $('clearPlotFile').disabled=true;
  $('plotConfig').classList.add('hidden'); $('exportCard').classList.add('hidden');
  $('plotFileSummary').innerHTML=''; $('plotLoadStatus').textContent='Choose a workbook, then click Continue.';
  $('plotStatus').textContent='Load a workbook to begin.'; $('plotWarnings').classList.add('hidden');
  $('creeResultsCard').classList.add('hidden');
  $('creeResultsBody').innerHTML='';
  $('downloadCreeCsv').disabled=true;
  $('resetZoom').disabled=true;
  if (typeof Plotly !== 'undefined') Plotly.purge('plot');
}

function renderLoaded() {
  setOptions($('codes'), state.codes, state.codes);
  updateCompareMolChoices();
  updateElementChoices({initial:true});

  $('plotFileSummary').innerHTML = `<div class="file-item"><div class="file-meta"><div class="file-name">${state.file.name}</div><div class="file-detail">Sheet: ${state.file.sheetName} · ${state.avgRows.length} avg rows · ${state.elements.length} detected element columns</div></div></div>`;
  $('plotConfig').classList.remove('hidden');
  $('exportCard').classList.remove('hidden');
  $('yBoundsControls').classList.remove('hidden');
  $('clearPlotFile').disabled=false;
  $('resetZoom').disabled=false;
  renderPlot();
}

function nearestSpacing(values) {
  const unique = [...new Set(values.filter(Number.isFinite))].sort((a,b)=>a-b);
  if (unique.length < 2) return Math.max(Math.abs(unique[0] || 1),1);
  let min = Infinity;
  for (let i=1;i<unique.length;i++) if (unique[i]-unique[i-1] > 0) min=Math.min(min, unique[i]-unique[i-1]);
  return Number.isFinite(min) ? min : 1;
}

function applyOffsets(rows, xField, mode, spreadFraction) {
  const copy = rows.map((r,i) => ({...r, __displayX:num(r[xField]), __offset:0, __order:i}));
  if (mode === 'none') return copy;
  const spacing = nearestSpacing(copy.map(r=>r.__displayX));
  const totalSpread = spacing * spreadFraction;
  const groups = new Map();
  copy.forEach(r => {
    if (!Number.isFinite(r.__displayX)) return;
    const key = String(r.__displayX);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  });
  groups.forEach(group => {
    const identity = r => mode === 'compound' ? String(r.Compound ?? '') : mode === 'code' ? String(r.Code ?? '') : r.__sampleKey;
    const ids = [...new Set(group.map(identity))];
    if (ids.length <= 1) return;
    const step = totalSpread / Math.max(1, ids.length-1);
    ids.forEach((id,idx) => {
      const offset = -totalSpread/2 + idx*step;
      group.filter(r => identity(r)===id).forEach(r => {r.__displayX += offset; r.__offset=offset;});
    });
  });
  return copy;
}

function subplotDomains(count) {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);

  // Faceted plots need extra vertical room for tick labels and panel titles.
  // Increase the gap slightly as the number of rows grows, while keeping
  // enough plotting area for every panel.
  const gapX = cols > 1 ? 0.08 : 0;
  // Keep enough paper-space between rows for a full x-axis title on every panel.
  const gapY = rows > 1 ? Math.min(0.26, 0.20 + 0.01 * Math.min(rows, 4)) : 0;
  const w = (1 - gapX * (cols - 1)) / cols;
  const h = (1 - gapY * (rows - 1)) / rows;

  return Array.from({length: count}, (_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      col,
      row,
      cols,
      rows,
      isBottomRow: row === rows - 1 || i + cols >= count,
      isLeftColumn: col === 0,
      x: [col * (w + gapX), col * (w + gapX) + w],
      y: [1 - (row + 1) * h - row * gapY, 1 - row * h - row * gapY]
    };
  });
}

function manualYBounds(logY) {
  const min = state.yMin;
  const max = state.yMax;

  if (min === null || max === null) return null;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (min >= max) throw new Error('Y-axis minimum must be smaller than the maximum.');
  if (logY && (min <= 0 || max <= 0)) {
    throw new Error('Manual Y-axis bounds must both be greater than zero when using a log10 y-axis.');
  }

  return logY ? [Math.log10(min), Math.log10(max)] : [min, max];
}

function makeLayout(panelNames, xLabel, yLabel, logY, panelLabels = panelNames) {
  const isFaceted = panelNames.length > 1;
  const textSize = Math.max(8, Math.min(28, Number($('plotTextSize')?.value) || 14));
  const thickGrid = Boolean($('thickGridLines')?.checked);
  const thickAxes = Boolean($('thickAxes')?.checked);
  const gridWidth = thickGrid ? 2.25 : 1;
  const axisWidth = thickAxes ? 3 : 1;

  const layout = {
    margin: {l: isFaceted ? 82 : 70, r: 30, t: isFaceted ? 72 : 30, b: isFaceted ? 78 : 65},
    font: {size: textSize},
    legend: {orientation: 'h', y: -0.18, font: {size: textSize}},
    hovermode: 'closest',
    paper_bgcolor: '#fff',
    plot_bgcolor: '#fff'
  };

  const domains = subplotDomains(panelNames.length);
  panelNames.forEach((name, i) => {
    const n = i + 1;
    const suffix = n === 1 ? '' : n;
    const domain = domains[i];

    const xAxis = {
      domain: domain.x,
      anchor: `y${suffix}`,
      title: {text: xLabel, standoff: isFaceted ? 24 : 14, font: {size: textSize + 1}},
      tickfont: {size: textSize},
      showgrid: true,
      gridwidth: gridWidth,
      showline: thickAxes,
      linewidth: axisWidth,
      linecolor: '#222',
      zeroline: false,
      automargin: true
    };

    const yAxis = {
      domain: domain.y,
      anchor: `x${suffix}`,
      title: {text: yLabel, standoff: isFaceted ? 24 : 14, font: {size: textSize + 1}},
      tickfont: {size: textSize},
      type: logY ? 'log' : 'linear',
      showgrid: true,
      gridwidth: gridWidth,
      showline: thickAxes,
      linewidth: axisWidth,
      linecolor: '#222',
      zeroline: false,
      automargin: true
    };

    const yBounds = manualYBounds(logY);
    if (yBounds) {
      yAxis.range = yBounds;
      yAxis.autorange = false;
    }

    // Show clean powers of ten (10^2, 10^3, …), rather than 100, 1000,
    // and suppress the crowded minor-number labels seen on log facets.
    if (logY) {
      yAxis.dtick = 1;
      yAxis.exponentformat = 'power';
      yAxis.showexponent = 'all';
      yAxis.minor = {showgrid: true, gridcolor: '#eeeeee', gridwidth: thickGrid ? 1.5 : 1, ticks: ''};
    } else {
      // In regular (linear) mode, always show the full value instead of
      // Plotly's abbreviated SI labels such as 2k or 3k.
      // The trim flag removes unnecessary trailing zeroes while retaining
      // decimals for small values.
      yAxis.tickformat = '.10~f';
      yAxis.hoverformat = '.10~f';
      yAxis.exponentformat = 'none';
      yAxis.showexponent = 'none';
    }

    layout[`xaxis${suffix}`] = xAxis;
    layout[`yaxis${suffix}`] = yAxis;

    if (isFaceted) {
      layout.annotations = (layout.annotations || []).concat({
        text: panelLabels[i] ?? name,
        x: (domain.x[0] + domain.x[1]) / 2,
        y: domain.y[1] + (domain.row === 0 ? 0.030 : 0.025),
        xref: 'paper',
        yref: 'paper',
        showarrow: false,
        font: {size: textSize + 1},
        xanchor: 'center',
        yanchor: 'bottom'
      });
    }
  });
  return layout;
}

function buildSimplePlot(rows, xField) {
  const selectedElements = selectedValues($('elements'));
  if (!selectedElements.length) throw new Error('Select at least one element.');
  const yMode=radioValue('yMode');
  const normalize=chondriteNormalizationEnabled();
  const facetElements=$('facetElements').checked, facetCompounds=$('facetCompounds').checked;
  const showErr=$('showErr').checked, logY=$('logY').checked;
  const panelNames = facetElements && facetCompounds
    ? [...new Set(rows.flatMap(r=>selectedElements.map(e=>`${e} · ${r.Compound || 'Unknown'}`)))]
    : facetElements ? selectedElements
    : facetCompounds ? [...new Set(rows.map(r=>String(r.Compound||'Unknown')))]
    : ['Plot'];

  const panelLabels = panelNames.map(panel => {
    if (facetElements && facetCompounds) {
      const matchingElement = selectedElements.find(element => panel.startsWith(`${element} · `));
      if (!matchingElement) return panel;
      return `${elementDisplayName(matchingElement)}${panel.slice(matchingElement.length)}`;
    }
    if (facetElements) return elementDisplayName(panel);
    return panel;
  });

  const traces=[];
  panelNames.forEach((panel,panelIndex)=>{
    selectedElements.forEach(element=>{
      const byCompound=new Map();
      rows.forEach(r=>{
        const comp=String(r.Compound||'Unknown');
        const panelMatch = facetElements && facetCompounds ? panel===`${element} · ${comp}` : facetElements ? panel===element : facetCompounds ? panel===comp : true;
        if(!panelMatch) return;
        const raw=num(r[element]); if(raw===null) return;
        const aw=atomicWeights[elemSymbol(element)];
        const ciPpm=normalize ? chondritePpmForElement(element) : null;
        if(normalize && ciPpm===null) return;
        if(!normalize && yMode==='mol' && !aw) return;

        const y=normalize
          ? raw/ciPpm
          : (yMode==='mol'?raw/aw:raw);

        const sdRaw=num(r.__sd?.[element]);
        const err=sdRaw===null
          ? null
          : normalize
            ? sdRaw/ciPpm
            : (yMode==='mol'?sdRaw/aw:sdRaw);

        if(logY && y<=0) return;
        if(!byCompound.has(comp)) byCompound.set(comp,[]);
        byCompound.get(comp).push({r,y,err});
      });
      byCompound.forEach((pts,comp)=>{
        pts.sort((a,b)=>a.r.__displayX-b.r.__displayX);
        const axis=panelIndex+1, suffix=axis===1?'':axis;
        traces.push({
          type:'scatter', mode:'lines+markers', name:panelNames.length>1?`${elementDisplayName(element)} · ${comp}`:`${elementDisplayName(element)}${byCompound.size>1?' · '+comp:''}`,
          x:pts.map(p=>p.r.__displayX), y:pts.map(p=>p.y), xaxis:`x${suffix}`, yaxis:`y${suffix}`,
          marker:{size:10}, line:{width:2},
          error_y:showErr?{type:'data',array:pts.map(p=>p.err??0),visible:true,thickness:1.2,width:4}:undefined,
          customdata:pts.map(p=>[
            p.r.Code,p.r.Compound,p.r[xField],p.r.__offset,p.r.File||'',
            elementDisplayName(element),
            normalize ? chondritePpmForElement(element) : '',
            normalize ? chondriteSourceText(element) : ''
          ]),
          hovertemplate:normalize
            ? 'Code: %{customdata[0]}<br>Compound: %{customdata[1]}<br>'+xField+': %{customdata[2]}<br>Display offset: %{customdata[3]:.4g}<br>Element: %{customdata[5]}<br>CI reference: %{customdata[7]}<br>Sample / CI: %{y:.10~f}<extra></extra>'
            : 'Code: %{customdata[0]}<br>Compound: %{customdata[1]}<br>'+xField+': %{customdata[2]}<br>Display offset: %{customdata[3]:.4g}<br>Element: %{customdata[5]}<br>Y: %{y:.10~f}<extra></extra>'
        });
      });
    });
  });
  return {
    traces,
    layout:makeLayout(
      panelNames,
      xField,
      normalize ? 'Sample / CI chondrite' : (yMode==='mol'?'Element (mol/kg)':'ppm'),
      logY,
      panelLabels
    )
  };
}

function buildRatioPlot(rows,xField) {
  const numerator=$('numerator').value, denominator=$('denominator').value;
  if(!numerator||!denominator) throw new Error('Choose numerator and denominator elements.');
  if(numerator===denominator) throw new Error('Choose two different elements.');
  const basis=radioValue('ratioBasis'), logY=$('ratioLogY').checked;
  const normalize=chondriteNormalizationEnabled();
  const numAw=atomicWeights[elemSymbol(numerator)], denAw=atomicWeights[elemSymbol(denominator)];
  const ciNum=normalize ? chondritePpmForElement(numerator) : null;
  const ciDen=normalize ? chondritePpmForElement(denominator) : null;

  if(normalize && (ciNum===null || ciDen===null)) {
    throw new Error('A CI chondrite reference value is missing for the selected ratio.');
  }
  if(!normalize && basis==='mm' && (!numAw || !denAw)) throw new Error('An atomic weight is missing for the selected ratio.');
  const groups=new Map(); let skippedZero=0;
  rows.forEach(r=>{
    const a=num(r[numerator]), b=num(r[denominator]);
    if(a===null||b===null||b===0){ if(b===0) skippedZero++; return; }
    let ratio;
    if(normalize) {
      // (sample numerator / CI numerator) / (sample denominator / CI denominator).
      // Atomic weights cancel, so the normalized result is identical for
      // weight/weight and mol/mol bases.
      ratio=(a/ciNum)/(b/ciDen);
    } else {
      ratio=basis==='mm'?(a/numAw)/(b/denAw):a/b;
    }
    if(logY && ratio<=0) return;
    const comp=String(r.Compound||'Unknown'); if(!groups.has(comp))groups.set(comp,[]);
    groups.get(comp).push({r,ratio});
  });
  const traces=[];
  groups.forEach((pts,comp)=>{
    pts.sort((a,b)=>a.r.__displayX-b.r.__displayX);
    traces.push({
      type:'scatter',mode:'lines+markers',name:comp,
      x:pts.map(p=>p.r.__displayX),y:pts.map(p=>p.ratio),
      marker:{size:10},line:{width:2},
      customdata:pts.map(p=>[
        p.r.Code,p.r.Compound,p.r[xField],p.r.__offset,
        normalize ? chondriteSourceText(numerator) : '',
        normalize ? chondriteSourceText(denominator) : ''
      ]),
      hovertemplate:normalize
        ? 'Code: %{customdata[0]}<br>Compound: %{customdata[1]}<br>'+xField+': %{customdata[2]}<br>Display offset: %{customdata[3]:.4g}<br>CI numerator: %{customdata[4]}<br>CI denominator: %{customdata[5]}<br>Normalized ratio: %{y:.10~f}<extra></extra>'
        : 'Code: %{customdata[0]}<br>Compound: %{customdata[1]}<br>'+xField+': %{customdata[2]}<br>Display offset: %{customdata[3]:.4g}<br>Ratio: %{y:.10~f}<extra></extra>'
    });
  });
  return {
    traces,
    layout:makeLayout(
      ['Plot'],
      xField,
      normalize
        ? `Chondrite-normalized ${elementDisplayName(numerator)}/${elementDisplayName(denominator)}`
        : `${elementDisplayName(numerator)}/${elementDisplayName(denominator)} (${basis==='mm'?'mol/mol':'w/w'})`,
      logY
    ),
    warnings:skippedZero?[`${skippedZero} row(s) were skipped because the denominator was zero.`]:[]
  };
}

function buildComparePlot(codes) {
  if (codes.size < 2) throw new Error('Compare mode requires at least two selected Codes.');

  const molkg = num($('compareMolKg').value);
  if (molkg === null) throw new Error('The selected Codes do not share a Mol/Kg value.');

  const selectedElements = orderedCompareElements();
  if (!selectedElements.length) throw new Error('Select at least one eligible element to compare.');

  const yMode = radioValue('compareYMode');
  const normalize = chondriteNormalizationEnabled();
  const showErr = $('compareShowErr').checked;
  const logY = $('compareLogY').checked;
  const warnings = [];
  const traces = [];

  [...codes].forEach(code => {
    const matchingRows = compareRowsForCode(code, molkg);
    if (!matchingRows.length) return;

    if (matchingRows.length > 1) {
      warnings.push(
        `${code} has ${matchingRows.length} avg rows at ${formatMolKg(molkg)} Mol/Kg; the first numeric row for each element is used.`
      );
    }

    const x = [];
    const y = [];
    const errors = [];
    const customdata = [];

    selectedElements.forEach(element => {
      const row = matchingRows.find(candidate => num(candidate[element]) !== null);
      if (!row) return;

      const raw = num(row[element]);
      const aw = atomicWeights[elemSymbol(element)];
      const ciPpm = normalize ? chondritePpmForElement(element) : null;

      if (normalize && ciPpm === null) return;
      if (!normalize && yMode === 'mol' && !aw) return;

      const value = normalize
        ? raw / ciPpm
        : (yMode === 'mol' ? raw / aw : raw);

      if (logY && value <= 0) {
        warnings.push(`${code} ${elementDisplayName(element)} was omitted because its value is not positive on a log10 axis.`);
        return;
      }

      const sdRaw = num(row.__sd?.[element]);
      const error = sdRaw === null
        ? null
        : normalize
          ? sdRaw / ciPpm
          : (yMode === 'mol' ? sdRaw / aw : sdRaw);

      x.push(elementDisplayName(element));
      y.push(value);
      errors.push(error ?? 0);
      customdata.push([
        code,
        row.Compound || '',
        formatMolKg(molkg),
        elementDisplayName(element),
        row.File || '',
        normalize ? chondriteSourceText(element) : ''
      ]);
    });

    if (!x.length) return;

    traces.push({
      type: 'bar',
      name: code,
      x,
      y,
      error_y: showErr
        ? {type:'data', array:errors, visible:true, thickness:1.2, width:4}
        : undefined,
      customdata,
      hovertemplate:normalize
        ? 'Code: %{customdata[0]}<br>' +
          'Compound: %{customdata[1]}<br>' +
          'Mol/Kg: %{customdata[2]}<br>' +
          'Element: %{customdata[3]}<br>' +
          'CI reference: %{customdata[5]}<br>' +
          'Sample / CI: %{y:.10~f}<extra></extra>'
        : 'Code: %{customdata[0]}<br>' +
          'Compound: %{customdata[1]}<br>' +
          'Mol/Kg: %{customdata[2]}<br>' +
          'Element: %{customdata[3]}<br>' +
          'Y: %{y:.10~f}<extra></extra>'
    });
  });

  if (!traces.length) throw new Error('No comparable numeric values were found.');

  const layout = makeLayout(
    ['Plot'],
    'Element',
    normalize ? 'Sample / CI chondrite' : (yMode === 'mol' ? 'Element (mol/kg)' : 'ppm'),
    logY
  );
  layout.barmode = 'group';
  layout.bargap = 0.18;
  layout.bargroupgap = 0.06;

  return {traces, layout, warnings};
}


function buildCreePlot(codes) {
  const selectedElements = selectedValues($('elements'));
  if (!selectedElements.length) {
    throw new Error('Select at least one element with enough positive data for a log–log fit.');
  }

  const selectedRows = state.avgRows.filter(row => codes.has(String(row.Code)));
  const normalize = chondriteNormalizationEnabled();
  const facetElements = $('creeFacetElements').checked;
  const showFit = $('creeShowFit').checked;
  const showLineLabels = $('creeShowLineLabels').checked;
  const showErr = $('creeShowErr').checked;
  const warnings = [];
  const results = [];
  const traces = [];
  const fitLabels = [];
  const panelXRanges = new Map();

  const panelNames = facetElements ? selectedElements : ['Plot'];
  const panelLabels = facetElements ? selectedElements.map(elementDisplayName) : ['Plot'];

  selectedElements.forEach(element => {
    const compounds = [...new Set(selectedRows.map(row => String(row.Compound || 'Unknown')))];
    const ciPpm = normalize ? chondritePpmForElement(element) : null;

    compounds.forEach(compound => {
      const points = creeValidRowsForElement(selectedRows, element, compound)
        .sort((a,b)=>a.x-b.x);

      if (points.length < 2) {
        if (points.length === 1) {
          warnings.push(`${elementDisplayName(element)} · ${compound} has only one valid positive point and was not fitted.`);
        }
        return;
      }

      const distinctX = uniqueNumericValues(points.map(point => point.solute));
      if (distinctX.length < 2) {
        warnings.push(`${elementDisplayName(element)} · ${compound} has fewer than two distinct positive Mol/Kg values and was not fitted.`);
        return;
      }

      const fit = linearRegression(points.map(point=>point.x), points.map(point=>point.y));
      if (!fit) {
        warnings.push(`${elementDisplayName(element)} · ${compound} could not be fitted.`);
        return;
      }

      const panelIndex = facetElements ? selectedElements.indexOf(element) : 0;
      const axis = panelIndex + 1;
      const suffix = axis === 1 ? '' : axis;
      const seriesName = creeRegressionLabel(element, compound, fit);
      const elementColor = creeElementColor(element);
      const compoundIndex = compounds.indexOf(compound);
      const markerSymbol = CREE_COMPOUND_SYMBOLS[compoundIndex % CREE_COMPOUND_SYMBOLS.length];
      const lineDash = CREE_COMPOUND_DASHES[compoundIndex % CREE_COMPOUND_DASHES.length];

      const panelRange = panelXRanges.get(panelIndex) || {min:Infinity, max:-Infinity};
      points.forEach(point => {
        panelRange.min = Math.min(panelRange.min, point.x);
        panelRange.max = Math.max(panelRange.max, point.x);
      });
      panelXRanges.set(panelIndex, panelRange);

      const errPlus = [];
      const errMinus = [];
      let clippedErrorCount = 0;

      points.forEach(point => {
        const sdRaw = num(point.row.__sd?.[element]);
        const raw = num(point.row[element]);
        const logErr = creeLogError(raw, sdRaw, normalize ? ciPpm : null);
        errPlus.push(logErr.plus);
        errMinus.push(logErr.minus);
        if (logErr.lowerClipped) clippedErrorCount++;
      });

      if (clippedErrorCount) {
        warnings.push(`${elementDisplayName(element)} · ${compound}: ${clippedErrorCount} SD lower bound(s) reached zero or below, so only the upper transformed error is shown for those points.`);
      }

      traces.push({
        type:'scatter',
        mode:'markers',
        name:seriesName,
        legendgroup:`${element}||${compound}`,
        x:points.map(point=>point.x),
        y:points.map(point=>point.y),
        xaxis:`x${suffix}`,
        yaxis:`y${suffix}`,
        marker:{size:10,color:elementColor,symbol:markerSymbol},
        error_y:showErr ? {
          type:'data',
          array:errPlus,
          arrayminus:errMinus,
          symmetric:false,
          visible:true,
          thickness:1.2,
          width:4,
          color:elementColor
        } : undefined,
        customdata:points.map(point=>[
          point.row.Code,
          point.row.Compound,
          point.solute,
          elementDisplayName(element),
          point.concentration,
          normalize ? chondriteSourceText(element) : ''
        ]),
        hovertemplate:normalize
          ? 'Code: %{customdata[0]}<br>Compound: %{customdata[1]}<br>Mol/Kg: %{customdata[2]}<br>Element: %{customdata[3]}<br>C/CI: %{customdata[4]:.10~f}<br>log10 Mol/Kg: %{x:.5f}<br>log10(C/CI): %{y:.5f}<br>CI reference: %{customdata[5]}<extra></extra>'
          : 'Code: %{customdata[0]}<br>Compound: %{customdata[1]}<br>Mol/Kg: %{customdata[2]}<br>Element: %{customdata[3]}<br>C: %{customdata[4]:.10~f} ppm<br>log10 Mol/Kg: %{x:.5f}<br>log10 C: %{y:.5f}<extra></extra>'
      });

      if (showFit) {
        const x0 = fit.minX;
        const x1 = fit.maxX;
        const y0 = fit.intercept + fit.slope*x0;
        const y1 = fit.intercept + fit.slope*x1;

        traces.push({
          type:'scatter',
          mode:'lines',
          name:`${seriesName} fit`,
          showlegend:false,
          legendgroup:`${element}||${compound}`,
          x:[x0,x1],
          y:[y0,y1],
          xaxis:`x${suffix}`,
          yaxis:`y${suffix}`,
          line:{width:2.5,color:elementColor,dash:lineDash},
          hovertemplate:`${elementDisplayName(element)} · ${compound}<br>n=${fit.slope.toFixed(4)}<br>log10 A=${fit.intercept.toFixed(4)}<br>R²=${fit.r2.toFixed(4)}<extra></extra>`
        });

        if (showLineLabels) {
          fitLabels.push({
            element,
            compound,
            panelIndex,
            suffix,
            x:x1,
            y:y1,
            slope:fit.slope,
            color:elementColor
          });
        }
      }

      results.push({
        element,
        compound,
        slope:fit.slope,
        intercept:fit.intercept,
        A:Math.pow(10, fit.intercept),
        r2:fit.r2,
        n:fit.n,
        minSolute:Math.min(...points.map(point=>point.solute)),
        maxSolute:Math.max(...points.map(point=>point.solute))
      });

      if (fit.n < 3) {
        warnings.push(`${elementDisplayName(element)} · ${compound} fit uses only ${fit.n} points; slope n is mathematically defined but should be interpreted cautiously.`);
      }
    });
  });

  if (!results.length) {
    throw new Error('No selected element/Compound group has at least two valid positive concentrations at distinct positive Mol/Kg values.');
  }

  const layout = makeLayout(
    panelNames,
    'log10[solute concentration (Mol/Kg)]',
    normalize ? 'log10(CREE / CI chondrite)' : 'log10 CREE (ppm)',
    false,
    panelLabels
  );

  if (showFit && showLineLabels && fitLabels.length) {
    const textSize = Math.max(8, Math.min(28, Number($('plotTextSize')?.value) || 14));
    const fitsPerElement = new Map();

    fitLabels.forEach(label => {
      fitsPerElement.set(label.element, (fitsPerElement.get(label.element) || 0) + 1);
    });

    // Add a little extra room to the right of each CREE panel so the
    // floating labels sit beside the line rather than on top of the last point.
    panelXRanges.forEach((range, panelIndex) => {
      if (!Number.isFinite(range.min) || !Number.isFinite(range.max)) return;
      const span = Math.max(0.12, range.max - range.min);
      const axis = panelIndex + 1;
      const suffix = axis === 1 ? '' : axis;
      const xAxis = layout[`xaxis${suffix}`];
      if (!xAxis) return;

      xAxis.range = [
        range.min - 0.05 * span,
        range.max + 0.28 * span
      ];
      xAxis.autorange = false;
    });

    const labelsByElement = new Map();
    fitLabels.forEach(label => {
      const list = labelsByElement.get(label.element) || [];
      list.push(label);
      labelsByElement.set(label.element, list);
    });

    fitLabels.forEach(label => {
      const panelRange = panelXRanges.get(label.panelIndex);
      const span = panelRange && Number.isFinite(panelRange.max - panelRange.min)
        ? Math.max(0.12, panelRange.max - panelRange.min)
        : 0.12;

      const siblings = labelsByElement.get(label.element) || [label];
      const siblingIndex = siblings.findIndex(item => item === label);
      const yShift = (siblingIndex - (siblings.length - 1) / 2) * 18;
      const hasMultipleCompounds = (fitsPerElement.get(label.element) || 0) > 1;
      const compoundText = hasMultipleCompounds ? ` · ${label.compound}` : '';
      const text = `<b>${elementDisplayName(label.element)}</b>${compoundText}  n=${label.slope.toFixed(2)}`;

      layout.annotations = (layout.annotations || []).concat({
        text,
        x: label.x + 0.035 * span,
        y: label.y,
        xref: `x${label.suffix}`,
        yref: `y${label.suffix}`,
        showarrow: false,
        xanchor: 'left',
        yanchor: 'middle',
        yshift: yShift,
        font: {size:textSize,color:label.color},
        bgcolor: 'rgba(255,255,255,0.78)',
        borderpad: 2
      });
    });
  }

  // These are already log10-transformed coordinates, so keep linear axes.
  Object.keys(layout).forEach(key => {
    if (/^xaxis\d*$/.test(key)) {
      layout[key].tickformat = '.4~f';
      layout[key].hoverformat = '.6~f';
      layout[key].exponentformat = 'none';
      layout[key].showexponent = 'none';
    }
  });

  return {traces, layout, warnings, creeResults:results};
}

function renderPlot() {
  if(!state.file) return;
  try {
    const codes = new Set(selectedValues($('codes')));
    if(!codes.size) throw new Error('Select at least one Code.');

    const plotMode = radioValue('plotMode');
    let result;
    let statusText;

    if (plotMode === 'compare') {
      result = buildComparePlot(codes);
      const molkg = num($('compareMolKg').value);
      const elementCount = orderedCompareElements().length;
      statusText = `Compare: ${codes.size} Codes at ${formatMolKg(molkg)} Mol/Kg; ${elementCount} selected element${elementCount === 1 ? '' : 's'}.`;
    } else if (plotMode === 'cree') {
      result = buildCreePlot(codes);
      const fitCount = result.creeResults?.length || 0;
      statusText = `CREE log–log: ${fitCount} fitted element/Compound series from ${codes.size} selected Code${codes.size===1?'':'s'}; x = log10(Mol/Kg).`;
    } else {
      const xField = radioValue('xunit');
      const selectedRows = state.avgRows.filter(r=>codes.has(String(r.Code)));
      const missingXRows = selectedRows.filter(r=>num(r[xField])===null);
      const rawRows = selectedRows.filter(r=>num(r[xField])!==null);

      if(!rawRows.length) {
        throw new Error(`None of the selected entries has a numeric ${xField} value.`);
      }

      const offsetMode = $('offsetMode').value;
      const spread = Number($('offsetSpread').value);
      const rows = applyOffsets(rawRows,xField,offsetMode,spread);

      result = plotMode === 'simple'
        ? buildSimplePlot(rows,xField)
        : buildRatioPlot(rows,xField);

      if(missingXRows.length) {
        const labels=[...new Set(missingXRows.map(r=>String(r.Code||'unnamed entry')))];
        const shown=labels.slice(0,8).join(', ');
        const more=labels.length>8?` (+${labels.length-8} more)`:'';
        result.warnings = result.warnings || [];
        result.warnings.unshift(
          `${missingXRows.length} selected entr${missingXRows.length===1?'y was':'ies were'} omitted because ${xField} is blank or non-numeric${shown?`: ${shown}${more}`:''}.`
        );
      }

      statusText = `${rawRows.length} sample row(s), ${codes.size} Code(s), x = ${xField}; offset mode: ${offsetMode}.`;
    }

    const warnings = result.warnings || [];
    const width = $('plot').clientWidth || 900;
    const auto = $('autoAspect').checked;
    let aspect = Number($('aspectRatio').value) || .7;

    if(auto){
      const faceted =
        (plotMode === 'simple' && ($('facetElements').checked || $('facetCompounds').checked)) ||
        (plotMode === 'cree' && $('creeFacetElements').checked);
      const count = faceted ? Math.max(1,(result.layout.annotations||[]).length) : 1;
      if (faceted) {
        const cols=Math.ceil(Math.sqrt(count));
        const facetRows=Math.ceil(count/cols);
        result.layout.height=Math.max(620, facetRows*430);
      } else {
        result.layout.height=Math.max(520,Math.round(width*.7));
      }
    } else {
      result.layout.height=Math.max(520,Math.round(width*aspect));
    }

    result.layout.autosize=true;
    Plotly.react(
      'plot',
      result.traces,
      result.layout,
      {
        responsive:true,
        displaylogo:false,
        scrollZoom:true,
        toImageButtonOptions:{
          format:'png',
          filename:sanitizeName($('plotName').value),
          scale:2
        }
      }
    );

    const yBoundText = state.yMin !== null && state.yMax !== null
      ? ` Y bounds = ${state.yMin} to ${state.yMax}.`
      : '';

    const normalizationText = chondriteNormalizationEnabled()
      ? ` CI-normalized to ${CHONDRITE_REFERENCE_META.citation}.`
      : '';

    $('plotStatus').textContent = `${statusText}${normalizationText}${yBoundText}`;
    $('plotWarnings').textContent = warnings.join(' ');
    $('plotWarnings').classList.toggle('hidden',warnings.length===0);

    renderCreeResults(plotMode === 'cree' ? (result.creeResults || []) : []);
  } catch(err) {
    Plotly.purge('plot');
    $('plotStatus').textContent=`Cannot plot: ${err.message}`;
    $('plotWarnings').textContent='';
    $('plotWarnings').classList.add('hidden');
    renderCreeResults([]);
  }
}

async function exportImage(format) {
  if(!state.file) return;
  const name=sanitizeName($('plotName').value);
  const width=1400;
  const auto=$('autoAspect').checked;
  const ratio=auto ? (($('plot').clientHeight||700)/Math.max($('plot').clientWidth||1000,1)) : Number($('aspectRatio').value)||.7;
  const height=Math.max(500,Math.round(width*ratio));
  const url=await Plotly.toImage('plot',{format,width,height,scale:format==='png'?2:1});
  const a=document.createElement('a');a.href=url;a.download=`${name}.${format}`;a.click();
}

async function exportPdf() {
  const name=sanitizeName($('plotName').value);
  const width=1400, ratio=$('autoAspect').checked?(($('plot').clientHeight||700)/Math.max($('plot').clientWidth||1000,1)):(Number($('aspectRatio').value)||.7), height=Math.max(500,Math.round(width*ratio));
  const dataUrl=await Plotly.toImage('plot',{format:'png',width,height,scale:2});
  const orientation=width>=height?'landscape':'portrait';
  const {jsPDF}=window.jspdf;
  const pdf=new jsPDF({orientation,unit:'pt',format:'a4'});
  const pageW=pdf.internal.pageSize.getWidth(), pageH=pdf.internal.pageSize.getHeight(), margin=28;
  const scale=Math.min((pageW-2*margin)/width,(pageH-2*margin)/height);
  pdf.addImage(dataUrl,'PNG',(pageW-width*scale)/2,(pageH-height*scale)/2,width*scale,height*scale);
  pdf.save(`${name}.pdf`);
}

function exportHtml() {
  const name=sanitizeName($('plotName').value);
  const graph=$('plot');
  const payload={data:graph.data||[],layout:graph.layout||{}};
  const html=`<!doctype html><html><head><meta charset="utf-8"><title>${name}</title><script src="https://cdn.plot.ly/plotly-2.35.2.min.js"><\/script></head><body><div id="plot" style="width:100%;height:95vh"></div><script>const fig=${JSON.stringify(payload)};Plotly.newPlot('plot',fig.data,fig.layout,{responsive:true,displaylogo:false});<\/script></body></html>`;
  const blob=new Blob([html],{type:'text/html'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${name}.html`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

$('plotFile').addEventListener('change',e=>{
  state.pending=e.target.files[0]||null;
  $('loadPlotFile').disabled=!state.pending;
  $('plotLoadStatus').textContent=state.pending?`${state.pending.name} selected. Click Continue to load it.`:'Choose a workbook, then click Continue.';
});
$('loadPlotFile').addEventListener('click',async()=>{
  if(!state.pending)return;
  try{
    if(typeof XLSX==='undefined')throw new Error('The Excel-reading library did not load.');
    $('loadPlotFile').disabled=true;$('plotLoadStatus').textContent='Reading workbook…';
    const parsed=parseWorkbook(state.pending,await state.pending.arrayBuffer());
    Object.assign(state,{file:parsed,rows:parsed.rows,avgRows:parsed.avgRows,sdRows:parsed.sdRows,elements:parsed.elements,codes:parsed.codes});
    $('plotLoadStatus').textContent='Workbook loaded successfully.';renderLoaded();
  }catch(err){console.error(err);$('plotLoadStatus').textContent=`Error: ${err.message}`;$('loadPlotFile').disabled=false;}
});
$('clearPlotFile').addEventListener('click',clearWorkbook);
$('selectAllCodes').addEventListener('click',()=>{
  [...$('codes').options].forEach(o=>o.selected=true);
  updateCompareMolChoices();
  updateElementChoices({autoSelectIfEmpty: ['compare','cree'].includes(radioValue('plotMode'))});
  renderPlot();
});
$('clearCodes').addEventListener('click',()=>{
  [...$('codes').options].forEach(o=>o.selected=false);
  updateCompareMolChoices();
  updateElementChoices();
  renderPlot();
});
$('selectAllElements').addEventListener('click',()=>{
  [...$('elements').options].forEach(o=>o.selected=true);
  syncCompareElementOrder();
  renderPlot();
});
$('clearElements').addEventListener('click',()=>{
  [...$('elements').options].forEach(o=>o.selected=false);
  syncCompareElementOrder();
  renderPlot();
});
$('moveCompareElementLeft').addEventListener('click',()=>moveCompareElement(-1));
$('moveCompareElementRight').addEventListener('click',()=>moveCompareElement(1));
$('resetCompareElementOrder').addEventListener('click',()=>{
  syncCompareElementOrder({reset:true});
  renderPlot();
});
$('offsetSpread').addEventListener('input',()=>{$('offsetSpreadValue').textContent=`${Math.round(Number($('offsetSpread').value)*100)}%`;renderPlot();});
$('plotTextSize').addEventListener('input',()=>{
  $('plotTextSizeValue').textContent=`${$('plotTextSize').value} px`;
  renderPlot();
});
$('autoAspect').addEventListener('change',()=>{$('aspectWrap').classList.toggle('hidden',$('autoAspect').checked);renderPlot();});
function applyManualYBounds() {
  const minText = $('yMin').value.trim();
  const maxText = $('yMax').value.trim();

  if (!minText && !maxText) {
    state.yMin = null;
    state.yMax = null;
    renderPlot();
    return;
  }

  const min = num(minText);
  const max = num(maxText);

  if (min === null || max === null) {
    $('plotWarnings').textContent = 'Enter numeric values for both Y minimum and Y maximum, or use Auto Y.';
    $('plotWarnings').classList.remove('hidden');
    return;
  }
  if (min >= max) {
    $('plotWarnings').textContent = 'Y-axis minimum must be smaller than the maximum.';
    $('plotWarnings').classList.remove('hidden');
    return;
  }

  const currentPlotMode = radioValue('plotMode');
  const logY = currentPlotMode === 'ratio'
    ? $('ratioLogY').checked
    : currentPlotMode === 'compare'
      ? $('compareLogY').checked
      : currentPlotMode === 'cree'
        ? false
        : $('logY').checked;
  if (logY && (min <= 0 || max <= 0)) {
    $('plotWarnings').textContent = 'For a log10 y-axis, both manual Y bounds must be greater than zero.';
    $('plotWarnings').classList.remove('hidden');
    return;
  }

  state.yMin = min;
  state.yMax = max;
  renderPlot();
}

function clearManualYBounds() {
  state.yMin = null;
  state.yMax = null;
  $('yMin').value = '';
  $('yMax').value = '';
  renderPlot();
}

function resetInteractiveZoom() {
  if (!state.file) return;

  const graph = $('plot');
  const layout = graph.layout || {};
  const update = {};

  Object.keys(layout).forEach((key) => {
    if (!/^xaxis\d*$/.test(key) && !/^yaxis\d*$/.test(key)) return;

    if (/^yaxis\d*$/.test(key) && state.yMin !== null && state.yMax !== null) {
      const logAxis = layout[key]?.type === 'log';
      update[`${key}.range`] = logAxis
        ? [Math.log10(state.yMin), Math.log10(state.yMax)]
        : [state.yMin, state.yMax];
      update[`${key}.autorange`] = false;
    } else {
      update[`${key}.autorange`] = true;
    }
  });

  Plotly.relayout('plot', update);
}

$('applyYBounds').addEventListener('click', applyManualYBounds);
$('autoYBounds').addEventListener('click', clearManualYBounds);
$('yMin').addEventListener('keydown', e => { if (e.key === 'Enter') applyManualYBounds(); });
$('yMax').addEventListener('keydown', e => { if (e.key === 'Enter') applyManualYBounds(); });
$('resetZoom').addEventListener('click', resetInteractiveZoom);
$('downloadPng').addEventListener('click',()=>exportImage('png'));
$('downloadSvg').addEventListener('click',()=>exportImage('svg'));
$('downloadPdf').addEventListener('click',exportPdf);
$('downloadHtml').addEventListener('click',exportHtml);
$('downloadCreeCsv').addEventListener('click',downloadCreeResultsCsv);

document.querySelectorAll('#plotConfig input, #plotConfig select').forEach(el=>el.addEventListener('change',()=>{
  const plotMode = radioValue('plotMode');

  if (el.id === 'elements') {
    syncCompareElementOrder();
  }

  if (el.id === 'codes') {
    updateCompareMolChoices();
    updateElementChoices({autoSelectIfEmpty: plotMode === 'compare' || plotMode === 'cree'});
  } else if (el.name === 'plotMode') {
    updateCompareMolChoices();
    updateElementChoices({autoSelectIfEmpty: plotMode === 'compare' || plotMode === 'cree'});
    updateYBoundsHint();
  } else if (el.id === 'showIsotopeLabels') {
    syncCompareElementOrder();
  } else if (el.id === 'normalizeChondrite') {
    updateElementChoices({autoSelectIfEmpty: plotMode === 'compare' || plotMode === 'cree'});
  } else if (el.id === 'compareMolKg') {
    updateElementChoices({autoSelectIfEmpty:true});
  }

  const simple = plotMode === 'simple';
  const ratio = plotMode === 'ratio';
  const compare = plotMode === 'compare';
  const cree = plotMode === 'cree';

  $('simpleControls').classList.toggle('hidden', !simple);
  $('ratioControls').classList.toggle('hidden', !ratio);
  $('compareControls').classList.toggle('hidden', !compare);
  $('creeControls').classList.toggle('hidden', !cree);
  $('elementSelectionControls').classList.toggle('hidden', ratio);
  $('xAxisControls').classList.toggle('hidden', compare || cree);
  $('offsetControls').classList.toggle('hidden', compare || cree);

  if (!cree) renderCreeResults([]);
  renderPlot();
}));
$('plotName').addEventListener('change',renderPlot);
window.addEventListener('resize',()=>{if(state.file)renderPlot();});

clearWorkbook();
updateYBoundsHint();
