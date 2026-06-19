import { STUDENTS } from './db.js';

// ========================================
// DOM References
// ========================================
const searchInput = document.getElementById('search-input');
const searchClear = document.querySelector('.search-clear');
const thresholdInput = document.getElementById('threshold-input');
const columnsToggleBtn = document.querySelector('.columns-toggle-btn');
const columnTogglesPanel = document.getElementById('column-toggles-panel');
const columnPills = columnTogglesPanel.querySelectorAll('.column-pill');
const tableBody = document.getElementById('table-body');
const emptyState = document.getElementById('empty-state');
const summaryTotal = document.getElementById('summary-total');
const summaryShown = document.getElementById('summary-shown');
const summaryHighlighted = document.getElementById('summary-highlighted');
const themeToggle = document.querySelector('.theme-toggle');
const tableContainer = document.querySelector('.table-container');
const resultsTable = document.getElementById('results-table');

// ========================================
// State
// ========================================
let currentThreshold = 200;
let currentQuery = '';
let debounceTimer = null;
const VISIBLE_BY_DEFAULT = ['rank', 'nom_prenom', 'moy_annuelle'];

// ========================================
// Theme
// ========================================
function getPreferredTheme() {
  const stored = sessionStorage.getItem('theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  sessionStorage.setItem('theme', theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

applyTheme(getPreferredTheme());
themeToggle.addEventListener('click', toggleTheme);

// ========================================
// Accent-insensitive search normalization
// ========================================
const DIACRITICS_RE = /[\u0300-\u036f]/g;
const NORM_CACHE = new Map();

function normalize(str) {
  if (NORM_CACHE.has(str)) return NORM_CACHE.get(str);
  const n = str
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICS_RE, '')
    .replace(/[^a-z0-9]/g, '');
  NORM_CACHE.set(str, n);
  return n;
}

// ========================================
// Build table rows (once, at load)
// ========================================
const fragment = document.createDocumentFragment();

STUDENTS.forEach((s) => {
  const tr = document.createElement('tr');
  tr.dataset.rank = s.rank;

  tr.innerHTML = `
    <td class="col-rank">${s.rank}</td>
    <td class="col-name">${escapeHtml(s.nom_prenom)}</td>
    <td class="col-avg">${formatNum(s.moy_annuelle)}</td>
    <td class="col-moy_s1" hidden>${formatNum(s.moy_s1)}</td>
    <td class="col-cred_s1" hidden>${s.cred_s1}</td>
    <td class="col-moy_s2" hidden>${formatNum(s.moy_s2)}</td>
    <td class="col-cred_s2" hidden>${s.cred_s2}</td>
    <td class="col-cred_annuel" hidden>${s.cred_annuel}</td>
    <td class="col-matricule" hidden>${escapeHtml(s.matricule)}</td>
    <td class="col-decision_jury" hidden>${renderBadge(s.decision_jury)}</td>
  `;

  fragment.appendChild(tr);
});

tableBody.appendChild(fragment);

// ========================================
// Helpers
// ========================================
function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

function formatNum(val) {
  if (val === null || val === undefined) return '—';
  return Number(val).toFixed(2);
}

function renderBadge(decision) {
  if (!decision) return '';
  const lower = decision.toLowerCase();
  let cls = '';
  if (lower.includes('session normale')) cls = 'decision-badge--session-normale';
  else if (lower.includes('session rattrapage')) cls = 'decision-badge--session-rattrapage';
  else if (lower.includes('ajourn')) cls = 'decision-badge--ajourne';
  else if (lower.includes('réorientation') || lower.includes('reorientation')) cls = 'decision-badge--reorientation';
  else if (lower.includes('abandon')) cls = 'decision-badge--abandon';
  else if (lower.includes('exclusion')) cls = 'decision-badge--exclusion';
  else cls = 'decision-badge--reorientation';

  return `<span class="decision-badge ${cls}">${escapeHtml(decision)}</span>`;
}

function matchTokens(normalizedName, normalizedMatricule, tokens) {
  for (const token of tokens) {
    if (!normalizedName.includes(token) && !normalizedMatricule.includes(token)) {
      return false;
    }
  }
  return true;
}

// ========================================
// Core render logic
// ========================================
const allRows = Array.from(tableBody.querySelectorAll('tr'));

function render() {
  const query = currentQuery.trim();
  const tokens = query
    ? query.toLowerCase().normalize('NFD').replace(DIACRITICS_RE, '').split(/\s+/).filter(Boolean)
    : [];

  let shownCount = 0;
  let highlightedCount = 0;

  allRows.forEach((tr) => {
    const s = STUDENTS[parseInt(tr.dataset.rank, 10) - 1];

    // Search filter
    let visible = true;
    if (tokens.length > 0) {
      const normName = normalize(s.nom_prenom);
      const normMat = normalize(s.matricule);
      visible = matchTokens(normName, normMat, tokens);
    }

    // Highlight check
    const isHighlighted = s.rank <= currentThreshold;

    if (visible) {
      tr.hidden = false;
      tr.classList.toggle('highlighted', isHighlighted);
      shownCount++;
      if (isHighlighted) highlightedCount++;
    } else {
      tr.hidden = true;
      tr.classList.remove('highlighted');
    }
  });

  // Summary
  summaryShown.textContent = shownCount;
  summaryHighlighted.textContent = highlightedCount > 0 ? highlightedCount : 'Aucun';

  // Empty state
  if (shownCount === 0 && tokens.length > 0) {
    emptyState.hidden = false;
    resultsTable.style.display = 'none';
  } else {
    emptyState.hidden = true;
    resultsTable.style.display = '';
  }

  updateScrollHint();
}

// ========================================
// Column visibility
// ========================================
const COL_ORDER = ['rank', 'nom_prenom', 'moy_annuelle', 'moy_s1', 'cred_s1', 'moy_s2', 'cred_s2', 'cred_annuel', 'matricule', 'decision_jury'];

const columnVisibility = {
  rank: true,
  nom_prenom: true,
  moy_annuelle: true,
  moy_s1: false,
  cred_s1: false,
  moy_s2: false,
  cred_s2: false,
  cred_annuel: false,
  matricule: false,
  decision_jury: false,
};

function toggleColumn(col) {
  columnVisibility[col] = !columnVisibility[col];

  // Update pill state
  const pill = columnTogglesPanel.querySelector(`[data-column="${col}"]`);
  if (pill) pill.setAttribute('aria-checked', String(columnVisibility[col]));

  // Toggle header cell
  const th = resultsTable.querySelector(`th[data-col="${col}"]`);
  if (th) th.hidden = !columnVisibility[col];

  // Toggle body cells
  const colIdx = COL_ORDER.indexOf(col);
  if (colIdx === -1) return;
  const allTrs = tableBody.querySelectorAll('tr');
  allTrs.forEach((tr) => {
    const cells = tr.querySelectorAll('td');
    if (cells[colIdx]) cells[colIdx].hidden = !columnVisibility[col];
  });

  updateScrollHint();
}

// Pill click
columnPills.forEach((pill) => {
  pill.addEventListener('click', () => {
    toggleColumn(pill.dataset.column);
  });
  pill.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleColumn(pill.dataset.column);
    }
  });
});

// Columns toggle panel (mobile dropdown)
columnsToggleBtn.addEventListener('click', () => {
  const isOpen = columnTogglesPanel.classList.toggle('is-open');
  columnsToggleBtn.setAttribute('aria-expanded', isOpen);
});

// Close panel on outside click
document.addEventListener('click', (e) => {
  if (!columnsToggleBtn.contains(e.target) && !columnTogglesPanel.contains(e.target)) {
    columnTogglesPanel.classList.remove('is-open');
    columnsToggleBtn.setAttribute('aria-expanded', 'false');
  }
});

// ========================================
// Search
// ========================================
searchInput.addEventListener('input', () => {
  const val = searchInput.value;
  searchClear.hidden = val.length === 0;

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    currentQuery = val;
    render();
  }, 150);
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchClear.hidden = true;
  currentQuery = '';
  render();
  searchInput.focus();
});

// ========================================
// Threshold
// ========================================
thresholdInput.addEventListener('input', () => {
  const val = parseInt(thresholdInput.value, 10);
  currentThreshold = isNaN(val) || val < 0 ? 0 : val;
  render();
});

// ========================================
// Scroll hint
// ========================================
function updateScrollHint() {
  if (!tableContainer) return;
  const isOverflow = resultsTable.scrollWidth > tableContainer.clientWidth;
  tableContainer.classList.toggle('is-scrollable', isOverflow);

  if (isOverflow) {
    tableContainer.addEventListener('scroll', checkScrollEnd, { passive: true });
  } else {
    tableContainer.removeEventListener('scroll', checkScrollEnd);
    tableContainer.classList.remove('scrolled-end');
  }
}

function checkScrollEnd() {
  const atEnd = tableContainer.scrollLeft + tableContainer.clientWidth >= resultsTable.scrollWidth - 2;
  tableContainer.classList.toggle('scrolled-end', atEnd);
}

// ========================================
// Resize observer for scroll hint
// ========================================
if (typeof ResizeObserver !== 'undefined') {
  const ro = new ResizeObserver(() => updateScrollHint());
  ro.observe(resultsTable);
}

// ========================================
// Initial render
// ========================================
summaryTotal.textContent = STUDENTS.length;
render();
