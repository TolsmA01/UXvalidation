/* =============================================
   UX VALIDATOR — Frontend Application
   ============================================= */

// ---- State ----
const state = {
  guidelinesFile: null,
  productFile: null,
  productObjectUrl: null,
  analysisResult: null,
  activeFilter: 'all',
  highlightedIssueId: null,
  annotationsVisible: true,
  apiKey: ''
};

// ---- DOM refs (populated in init) ----
const el = {};

// ---- Loading steps ----
const LOADING_STEPS = [
  { text: 'Reading your guidelines...', pct: 15 },
  { text: 'Processing design image...', pct: 30 },
  { text: 'Sending to Claude for analysis...', pct: 50 },
  { text: 'Checking color compliance...', pct: 65 },
  { text: 'Evaluating typography rules...', pct: 78 },
  { text: 'Reviewing spacing & layout...', pct: 88 },
  { text: 'Generating detailed report...', pct: 96 }
];
let loadingStepInterval = null;

// =============================================
// INIT
// =============================================
function init() {
  // Cache DOM elements
  el.guidelinesZone     = document.getElementById('guidelines-zone');
  el.guidelinesInput    = document.getElementById('guidelines-input');
  el.guidelinesPreview  = document.getElementById('guidelines-preview');
  el.guidelinesName     = document.getElementById('guidelines-name');
  el.guidelinesSize     = document.getElementById('guidelines-size');
  el.guidelinesRemove   = document.getElementById('guidelines-remove');

  el.productZone        = document.getElementById('product-zone');
  el.productInput       = document.getElementById('product-input');
  el.productPreview     = document.getElementById('product-preview');
  el.productThumb       = document.getElementById('product-thumb');
  el.productName        = document.getElementById('product-name');
  el.productSize        = document.getElementById('product-size');
  el.productRemove      = document.getElementById('product-remove');

  el.analyzeBtn         = document.getElementById('analyze-btn');

  el.uploadSection      = document.getElementById('upload-section');
  el.loadingSection     = document.getElementById('loading-section');
  el.resultsSection     = document.getElementById('results-section');

  el.loadingStep        = document.getElementById('loading-step');
  el.loadingBar         = document.getElementById('loading-bar');

  el.scoreNumber        = document.getElementById('score-number');
  el.scoreRingFill      = document.getElementById('score-ring-fill');
  el.scoreSummary       = document.getElementById('score-summary');

  el.countCritical      = document.getElementById('count-critical');
  el.countHigh          = document.getElementById('count-high');
  el.countMedium        = document.getElementById('count-medium');
  el.countLow           = document.getElementById('count-low');

  el.guidelinesChips    = document.getElementById('guidelines-chips');
  el.guidelinesSummaryCard = document.getElementById('guidelines-summary-card');

  el.imageContainer     = document.getElementById('image-container');
  el.designImage        = document.getElementById('design-image');
  el.annotationCanvas   = document.getElementById('annotation-canvas');
  el.annotationTooltip  = document.getElementById('annotation-tooltip');
  el.annotationsToggle  = document.getElementById('annotations-toggle');

  el.issuesTotalBadge   = document.getElementById('issues-total-badge');
  el.filterTabs         = document.getElementById('filter-tabs');
  el.issuesList         = document.getElementById('issues-list');

  el.positivesList      = document.getElementById('positives-list');
  el.positivesCard      = document.getElementById('positives-card');

  el.errorToast         = document.getElementById('error-toast');
  el.errorMessage       = document.getElementById('error-message');
  el.toastClose         = document.getElementById('toast-close');

  el.newAnalysisBtn     = document.getElementById('new-analysis-btn');
  el.printBtn           = document.getElementById('print-btn');

  el.apiKeyPanel        = document.getElementById('api-key-panel');
  el.apiKeyInput        = document.getElementById('api-key-input');
  el.apiKeySave         = document.getElementById('api-key-save');

  // Restore saved API key
  const savedKey = localStorage.getItem('uxv_api_key');
  if (savedKey) {
    state.apiKey = savedKey;
    if (el.apiKeyInput) el.apiKeyInput.value = savedKey;
  }

  // Check if API key is needed
  checkApiKeyNeeded();

  // Set up event listeners
  setupDropZone('guidelines', el.guidelinesZone, el.guidelinesInput, handleGuidelinesFile);
  setupDropZone('product', el.productZone, el.productInput, handleProductFile);

  el.guidelinesRemove.addEventListener('click', (e) => { e.stopPropagation(); clearGuidelines(); });
  el.productRemove.addEventListener('click', (e) => { e.stopPropagation(); clearProduct(); });

  el.analyzeBtn.addEventListener('click', runAnalysis);
  el.newAnalysisBtn.addEventListener('click', resetToUpload);
  el.printBtn.addEventListener('click', () => window.print());

  el.toastClose.addEventListener('click', hideError);

  el.filterTabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.filter-tab');
    if (!tab) return;
    setFilter(tab.dataset.filter);
  });

  el.annotationsToggle.addEventListener('change', () => {
    state.annotationsVisible = el.annotationsToggle.checked;
    el.annotationCanvas.style.display = state.annotationsVisible ? 'block' : 'none';
  });

  el.apiKeySave.addEventListener('click', saveApiKey);
  el.apiKeyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveApiKey(); });
}

async function checkApiKeyNeeded() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    if (!data.apiKeyConfigured) {
      el.apiKeyPanel.style.display = 'block';
    }
  } catch (_) {
    // Server unreachable, show panel to be safe
    el.apiKeyPanel.style.display = 'block';
  }
}

function saveApiKey() {
  const key = el.apiKeyInput.value.trim();
  state.apiKey = key;
  if (key) {
    localStorage.setItem('uxv_api_key', key);
  } else {
    localStorage.removeItem('uxv_api_key');
  }
  el.apiKeyInput.blur();
  showToast('API key saved.', 2000);
}

// =============================================
// DROP ZONE SETUP
// =============================================
function setupDropZone(type, zone, input, handler) {
  // Click to open file picker
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
  });

  // File input change
  input.addEventListener('change', () => {
    if (input.files[0]) handler(input.files[0]);
    input.value = ''; // reset so same file can be re-selected
  });

  // Drag events
  zone.addEventListener('dragenter', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragover',  (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', (e) => {
    if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
  });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) handler(file);
  });
}

// =============================================
// FILE HANDLERS
// =============================================
function handleGuidelinesFile(file) {
  const allowed = ['.json', '.css', '.txt', '.md'];
  if (!hasAllowedExt(file.name, allowed)) {
    showError(`Guidelines: unsupported format "${getExt(file.name)}". Use JSON, CSS, TXT, or MD.`);
    return;
  }
  state.guidelinesFile = file;
  el.guidelinesName.textContent = file.name;
  el.guidelinesSize.textContent = formatBytes(file.size);
  el.guidelinesZone.style.display = 'none';
  el.guidelinesPreview.style.display = 'flex';
  updateAnalyzeBtn();
}

function handleProductFile(file) {
  const allowed = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
  if (!hasAllowedExt(file.name, allowed)) {
    showError(`Product: unsupported format "${getExt(file.name)}". Export as PNG, JPG, or WEBP.`);
    return;
  }
  // Revoke old object URL
  if (state.productObjectUrl) URL.revokeObjectURL(state.productObjectUrl);
  state.productFile = file;
  state.productObjectUrl = URL.createObjectURL(file);

  el.productThumb.src = state.productObjectUrl;
  el.productName.textContent = file.name;
  el.productSize.textContent = formatBytes(file.size);
  el.productZone.style.display = 'none';
  el.productPreview.style.display = 'flex';
  updateAnalyzeBtn();
}

function clearGuidelines() {
  state.guidelinesFile = null;
  el.guidelinesZone.style.display = '';
  el.guidelinesPreview.style.display = 'none';
  el.guidelinesName.textContent = '';
  updateAnalyzeBtn();
}

function clearProduct() {
  if (state.productObjectUrl) URL.revokeObjectURL(state.productObjectUrl);
  state.productFile = null;
  state.productObjectUrl = null;
  el.productZone.style.display = '';
  el.productPreview.style.display = 'none';
  el.productThumb.src = '';
  updateAnalyzeBtn();
}

function updateAnalyzeBtn() {
  el.analyzeBtn.disabled = !(state.guidelinesFile && state.productFile);
}

// =============================================
// ANALYSIS
// =============================================
async function runAnalysis() {
  hideError();
  showSection('loading');
  startLoadingSteps();

  const formData = new FormData();
  formData.append('guidelines', state.guidelinesFile, state.guidelinesFile.name);
  formData.append('product', state.productFile, state.productFile.name);

  try {
    const headers = {};
    if (state.apiKey) headers['X-API-Key'] = state.apiKey;

    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers,
      body: formData
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || `Server error ${res.status}`);
    }

    stopLoadingSteps();
    state.analysisResult = data;
    renderResults(data);
    showSection('results');

  } catch (err) {
    stopLoadingSteps();
    showSection('upload');
    showError(err.message || 'Analysis failed. Please try again.');
  }
}

// =============================================
// LOADING STEPS ANIMATION
// =============================================
function startLoadingSteps() {
  let i = 0;
  el.loadingStep.textContent = LOADING_STEPS[0].text;
  el.loadingBar.style.width = LOADING_STEPS[0].pct + '%';

  loadingStepInterval = setInterval(() => {
    i = (i + 1) % LOADING_STEPS.length;
    el.loadingStep.textContent = LOADING_STEPS[i].text;
    el.loadingBar.style.width = LOADING_STEPS[i].pct + '%';
  }, 2800);
}

function stopLoadingSteps() {
  clearInterval(loadingStepInterval);
  loadingStepInterval = null;
  el.loadingBar.style.width = '100%';
}

// =============================================
// RENDER RESULTS
// =============================================
function renderResults(data) {
  renderScore(data.complianceScore);
  el.scoreSummary.textContent = data.summary || '';

  const issues = data.issues || [];
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  issues.forEach(i => { if (counts[i.severity] !== undefined) counts[i.severity]++; });

  el.countCritical.textContent = counts.critical;
  el.countHigh.textContent     = counts.high;
  el.countMedium.textContent   = counts.medium;
  el.countLow.textContent      = counts.low;

  renderGuidelinesChips(data.guidelinesSummary || {});
  renderAnnotatedImage(issues);
  renderIssues(issues);
  renderPositives(data.positives || []);
}

function renderScore(score) {
  const s = Math.max(0, Math.min(100, score || 0));

  // Animate number
  let current = 0;
  const step = Math.ceil(s / 40);
  const timer = setInterval(() => {
    current = Math.min(current + step, s);
    el.scoreNumber.textContent = current;
    if (current >= s) clearInterval(timer);
  }, 25);

  // Animate ring (circumference = 2π×52 ≈ 326.7)
  const circumference = 326.7;
  const dashoffset = circumference - (s / 100) * circumference;
  setTimeout(() => {
    el.scoreRingFill.style.strokeDashoffset = dashoffset;
  }, 50);

  // Color the ring by score
  const color = s >= 80 ? '#22C55E' : s >= 60 ? '#EAB308' : s >= 40 ? '#F97316' : '#EF4444';
  el.scoreRingFill.style.stroke = color;
}

// =============================================
// GUIDELINES SUMMARY CHIPS
// =============================================
function renderGuidelinesChips(summary) {
  el.guidelinesChips.innerHTML = '';

  const isHex = (v) => /^#([0-9A-Fa-f]{3}){1,2}$/.test(v.trim());

  function addChip(label, value, isColor) {
    const chip = document.createElement('div');
    chip.className = 'guideline-chip';
    if (isColor) {
      const swatch = document.createElement('span');
      swatch.className = 'chip-color-swatch';
      swatch.style.background = value;
      chip.appendChild(swatch);
    }
    const lbl = document.createElement('span');
    lbl.className = 'chip-label';
    lbl.textContent = label;
    chip.appendChild(lbl);
    if (value && value !== label) {
      const val = document.createElement('span');
      val.className = 'chip-value';
      val.textContent = value;
      chip.appendChild(val);
    }
    el.guidelinesChips.appendChild(chip);
  }

  function addCategory(label) {
    const chip = document.createElement('div');
    chip.className = 'guideline-chip chip-category';
    chip.textContent = label;
    el.guidelinesChips.appendChild(chip);
  }

  // Colors
  if (summary.colors?.length) {
    addCategory('Colors');
    summary.colors.forEach(c => {
      // Try to parse "name: #hex" or just "#hex" or "name (#hex)"
      const match = c.match(/#([0-9A-Fa-f]{3,6})/);
      const hex = match ? match[0] : null;
      const name = c.replace(/#([0-9A-Fa-f]{3,6})/g, '').replace(/[:\-,]/g, ' ').trim() || c;
      addChip(name, hex || c, !!hex);
    });
  }

  // Fonts
  if (summary.fonts?.length) {
    addCategory('Fonts');
    summary.fonts.forEach(f => addChip(f, '', false));
  }

  // Font sizes
  if (summary.fontSizes && Object.keys(summary.fontSizes).length) {
    addCategory('Sizes');
    Object.entries(summary.fontSizes).forEach(([k, v]) => addChip(k, v, false));
  }

  // Spacing
  if (summary.spacing && Object.keys(summary.spacing).length) {
    addCategory('Spacing');
    Object.entries(summary.spacing).forEach(([k, v]) => addChip(k, v, false));
  }

  // Other
  if (summary.other?.length) {
    addCategory('Other');
    summary.other.forEach(r => addChip(r, '', false));
  }

  if (!el.guidelinesChips.children.length) {
    el.guidelinesSummaryCard.style.display = 'none';
  }
}

// =============================================
// ANNOTATED IMAGE
// =============================================
function renderAnnotatedImage(issues) {
  el.designImage.src = state.productObjectUrl;

  el.designImage.onload = () => {
    const iw = el.designImage.naturalWidth;
    const ih = el.designImage.naturalHeight;

    el.annotationCanvas.width  = iw;
    el.annotationCanvas.height = ih;

    // Match display size to img
    const displayW = el.designImage.getBoundingClientRect().width || el.designImage.offsetWidth;
    el.annotationCanvas.style.width  = displayW + 'px';
    el.annotationCanvas.style.height = (displayW / iw * ih) + 'px';

    drawAnnotations(issues, null);
    setupCanvasInteraction(issues);
  };

  // Handle resize
  window.addEventListener('resize', debounce(() => {
    if (!state.analysisResult) return;
    const displayW = el.designImage.offsetWidth;
    const iw = el.annotationCanvas.width;
    const ih = el.annotationCanvas.height;
    el.annotationCanvas.style.width  = displayW + 'px';
    el.annotationCanvas.style.height = (displayW / iw * ih) + 'px';
  }, 200));
}

function drawAnnotations(issues, highlightId) {
  const canvas = el.annotationCanvas;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  ctx.clearRect(0, 0, W, H);

  const SEVERITY_COLORS = {
    critical: '#EF4444',
    high:     '#F97316',
    medium:   '#EAB308',
    low:      '#22C55E'
  };

  issues.forEach((issue) => {
    const bb = issue.boundingBox;
    if (!bb) return;

    // Skip full-image boxes (they clutter the view)
    if (bb.width >= 0.98 && bb.height >= 0.98) return;

    const x = bb.x * W;
    const y = bb.y * H;
    const w = bb.width * W;
    const h = bb.height * H;

    const color = SEVERITY_COLORS[issue.severity] || '#6366F1';
    const isHighlighted = issue.id === highlightId;
    const dimmed = highlightId !== null && !isHighlighted;

    ctx.save();
    ctx.globalAlpha = dimmed ? 0.25 : 1;

    // Fill
    ctx.fillStyle = color + '22';
    ctx.fillRect(x, y, w, h);

    // Stroke
    ctx.strokeStyle = color;
    ctx.lineWidth = isHighlighted ? 3 : 2;
    if (isHighlighted) {
      ctx.shadowBlur = 8;
      ctx.shadowColor = color;
    }
    ctx.strokeRect(x, y, w, h);
    ctx.shadowBlur = 0;

    // Badge circle
    const badgeR = Math.max(12, Math.min(18, W * 0.015));
    const badgeX = Math.max(x + badgeR, x + badgeR);
    const badgeY = y > badgeR + 2 ? y - badgeR - 2 : y + badgeR + 2;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(badgeX, badgeY, badgeR, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'white';
    ctx.font = `bold ${Math.round(badgeR * 1.1)}px -apple-system, Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(issue.id), badgeX, badgeY);

    ctx.restore();
  });
}

function setupCanvasInteraction(issues) {
  const canvas = el.annotationCanvas;

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top)  * scaleY;

    const hit = findHitIssue(issues, mx, my, canvas.width, canvas.height);

    if (hit) {
      canvas.style.cursor = 'pointer';
      el.annotationTooltip.style.display = 'block';
      el.annotationTooltip.style.left = (e.clientX + 12) + 'px';
      el.annotationTooltip.style.top  = (e.clientY + 12) + 'px';
      el.annotationTooltip.innerHTML =
        `<strong>#${hit.id} ${escapeHtml(hit.title)}</strong><br>` +
        `<span style="opacity:.8">${escapeHtml(hit.location)}</span>`;

      if (state.highlightedIssueId !== hit.id) {
        state.highlightedIssueId = hit.id;
        if (state.annotationsVisible) drawAnnotations(issues, hit.id);
      }
    } else {
      canvas.style.cursor = 'crosshair';
      el.annotationTooltip.style.display = 'none';
      if (state.highlightedIssueId !== null) {
        state.highlightedIssueId = null;
        if (state.annotationsVisible) drawAnnotations(issues, null);
      }
    }
  });

  canvas.addEventListener('mouseleave', () => {
    el.annotationTooltip.style.display = 'none';
    state.highlightedIssueId = null;
    if (state.annotationsVisible) drawAnnotations(issues, null);
  });

  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top)  * scaleY;

    const hit = findHitIssue(issues, mx, my, canvas.width, canvas.height);
    if (hit) {
      const card = document.querySelector(`.issue-card[data-id="${hit.id}"]`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        highlightIssueCard(hit.id);
        // Open body if closed
        const body = card.querySelector('.issue-body');
        const btn  = card.querySelector('.issue-expand-btn');
        if (body && !body.classList.contains('open')) {
          body.classList.add('open');
          btn && btn.classList.add('expanded');
        }
      }
    }
  });
}

function findHitIssue(issues, mx, my, W, H) {
  // Search in reverse order (last drawn = on top)
  for (let i = issues.length - 1; i >= 0; i--) {
    const issue = issues[i];
    const bb = issue.boundingBox;
    if (!bb || (bb.width >= 0.98 && bb.height >= 0.98)) continue;
    const x = bb.x * W, y = bb.y * H, w = bb.width * W, h = bb.height * H;
    if (mx >= x && mx <= x + w && my >= y && my <= y + h) return issue;
  }
  return null;
}

// =============================================
// ISSUES LIST
// =============================================
function renderIssues(issues) {
  el.issuesList.innerHTML = '';
  el.issuesTotalBadge.textContent = issues.length;

  if (!issues.length) {
    el.issuesList.innerHTML = '<p style="color:var(--text-3);font-size:14px;text-align:center;padding:32px">No issues found — great job!</p>';
    return;
  }

  issues.forEach(issue => {
    el.issuesList.appendChild(createIssueCard(issue));
  });
}

function createIssueCard(issue) {
  const card = document.createElement('div');
  card.className = 'issue-card fade-in';
  card.dataset.severity = issue.severity;
  card.dataset.id = issue.id;

  card.innerHTML = `
    <div class="issue-header">
      <div class="issue-number">${issue.id}</div>
      <div class="issue-meta">
        <div class="issue-title-row">
          <span class="issue-title">${escapeHtml(issue.title)}</span>
          <span class="severity-badge ${issue.severity}">${issue.severity}</span>
          <span class="category-badge">${issue.category || ''}</span>
        </div>
        <div class="issue-location">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
          ${escapeHtml(issue.location || '')}
        </div>
      </div>
      <button class="issue-expand-btn" aria-label="Toggle details">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
    </div>
    <div class="issue-body">
      <div class="issue-detail-grid">
        <div class="issue-detail-item" style="grid-column:1/-1">
          <div class="issue-detail-label">Description</div>
          <div class="issue-detail-value">${escapeHtml(issue.description || '')}</div>
        </div>
        <div class="issue-detail-item">
          <div class="issue-detail-label">Guideline Violated</div>
          <div class="issue-detail-value">${escapeHtml(issue.guidelineViolated || '—')}</div>
        </div>
        <div class="issue-detail-item">
          <div class="issue-detail-label">Current → Expected</div>
          <div class="issue-detail-value">
            <div class="value-diff">
              ${buildValueBadge(issue.currentValue, 'current')}
              <span class="value-arrow">→</span>
              ${buildValueBadge(issue.expectedValue, 'expected')}
            </div>
          </div>
        </div>
      </div>
      <div class="issue-recommendation">
        <div class="issue-recommendation-label">Recommendation</div>
        <div class="issue-recommendation-text">${escapeHtml(issue.recommendation || '')}</div>
      </div>
    </div>
  `;

  // Expand toggle
  const header    = card.querySelector('.issue-header');
  const body      = card.querySelector('.issue-body');
  const expandBtn = card.querySelector('.issue-expand-btn');

  header.addEventListener('click', () => {
    const open = body.classList.toggle('open');
    expandBtn.classList.toggle('expanded', open);
  });

  // Canvas highlight on hover
  card.addEventListener('mouseenter', () => {
    state.highlightedIssueId = issue.id;
    if (state.annotationsVisible && state.analysisResult) {
      drawAnnotations(state.analysisResult.issues, issue.id);
    }
  });
  card.addEventListener('mouseleave', () => {
    state.highlightedIssueId = null;
    if (state.annotationsVisible && state.analysisResult) {
      drawAnnotations(state.analysisResult.issues, null);
    }
  });

  return card;
}

function buildValueBadge(value, type) {
  if (!value) return '<span style="color:var(--text-3)">—</span>';
  const cls = type === 'current' ? 'value-current' : 'value-expected';
  // Detect if it's a color hex and show swatch
  const hexMatch = value.match(/#([0-9A-Fa-f]{3,6})/);
  const swatch = hexMatch
    ? `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${hexMatch[0]};border:1px solid rgba(0,0,0,.2)"></span>`
    : '';
  return `<span class="${cls}">${swatch}${escapeHtml(value)}</span>`;
}

function highlightIssueCard(id) {
  document.querySelectorAll('.issue-card').forEach(c => c.classList.remove('highlighted'));
  const target = document.querySelector(`.issue-card[data-id="${id}"]`);
  if (target) {
    target.classList.add('highlighted');
    setTimeout(() => target.classList.remove('highlighted'), 2000);
  }
}

// =============================================
// FILTER
// =============================================
function setFilter(filter) {
  state.activeFilter = filter;
  document.querySelectorAll('.filter-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.filter === filter);
  });
  document.querySelectorAll('.issue-card').forEach(card => {
    const visible = filter === 'all' || card.dataset.severity === filter;
    card.classList.toggle('hidden', !visible);
  });
}

// =============================================
// POSITIVES
// =============================================
function renderPositives(positives) {
  el.positivesList.innerHTML = '';
  if (!positives.length) {
    el.positivesCard.style.display = 'none';
    return;
  }
  positives.forEach(p => {
    const li = document.createElement('li');
    li.textContent = p;
    el.positivesList.appendChild(li);
  });
}

// =============================================
// SECTION SWITCHING
// =============================================
function showSection(name) {
  el.uploadSection.style.display  = name === 'upload'  ? '' : 'none';
  el.loadingSection.style.display = name === 'loading' ? '' : 'none';
  el.resultsSection.style.display = name === 'results' ? '' : 'none';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetToUpload() {
  state.analysisResult = null;
  state.highlightedIssueId = null;
  setFilter('all');
  showSection('upload');
}

// =============================================
// ERROR HANDLING
// =============================================
let errorTimeout = null;

function showError(msg) {
  el.errorMessage.textContent = msg;
  el.errorToast.style.display = 'flex';
  clearTimeout(errorTimeout);
  errorTimeout = setTimeout(hideError, 8000);
}

function hideError() {
  el.errorToast.style.display = 'none';
  clearTimeout(errorTimeout);
}

function showToast(msg, duration = 3000) {
  el.errorMessage.textContent = msg;
  el.errorToast.style.display = 'flex';
  clearTimeout(errorTimeout);
  errorTimeout = setTimeout(hideError, duration);
}

// =============================================
// UTILITIES
// =============================================
function hasAllowedExt(filename, allowed) {
  return allowed.some(ext => filename.toLowerCase().endsWith(ext));
}

function getExt(filename) {
  return filename.slice(filename.lastIndexOf('.')).toLowerCase();
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function debounce(fn, delay) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

// =============================================
// BOOT
// =============================================
document.addEventListener('DOMContentLoaded', init);
