/* =============================================
   BI Dashboard Validator — Browser-only version (GitHub Pages)
   All processing happens client-side; calls AI APIs directly.
   ============================================= */

// Set pdf.js worker source (CDN)
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
}

// ---- Provider config ----
const PROVIDERS = {
  anthropic: {
    name:       'Anthropic Claude',
    model:      'claude-sonnet-4-6',
    placeholder:'sk-ant-...',
    keyUrl:     'https://console.anthropic.com/account/keys',
    linkLabel:  'Get free key at console.anthropic.com ↗',
    why:        'Best for UX analysis — superior visual comprehension, design system understanding, and structured output accuracy.',
    storageKey: 'uxv_api_key_anthropic'
  },
  openai: {
    name:       'OpenAI GPT-4o',
    model:      'gpt-4o',
    placeholder:'sk-...',
    keyUrl:     'https://platform.openai.com/api-keys',
    linkLabel:  'Get key at platform.openai.com ↗',
    why:        'Great quality visual analysis. Good alternative if you already have an OpenAI subscription.',
    storageKey: 'uxv_api_key_openai'
  },
  gemini: {
    name:       'Google Gemini',
    model:      'gemini-2.0-flash',
    placeholder:'AIza...',
    keyUrl:     'https://aistudio.google.com/app/apikey',
    linkLabel:  'Get free key at aistudio.google.com ↗',
    why:        'Free tier available — generous quota. Fast and affordable for quick checks.',
    storageKey: 'uxv_api_key_gemini'
  }
};

// ---- State ----
const state = {
  guidelinesFile: null,
  productFile: null,
  productObjectUrl: null,
  analysisResult: null,
  activeFilter: 'all',
  activeSection: 'all',
  highlightedIssueId: null,
  annotationsVisible: true,
  provider: 'anthropic',
  apiKeys: { anthropic: '', openai: '', gemini: '' }
};

// ---- DOM refs (populated in init) ----
const el = {};

// ---- Loading steps (BI-specific) ----
const LOADING_STEPS = [
  { text: 'Reading your guidelines...',                  pct: 12 },
  { text: 'Processing dashboard image...',               pct: 25 },
  { text: 'Sending to AI for analysis...',               pct: 40 },
  { text: 'Checking colors & brand compliance...',       pct: 55 },
  { text: 'Evaluating chart types & data visuals...',    pct: 65 },
  { text: 'Reviewing KPIs & number formatting...',       pct: 75 },
  { text: 'Auditing layout & information hierarchy...',  pct: 84 },
  { text: 'Checking BI best practices...',               pct: 92 },
  { text: 'Generating structured report...',             pct: 97 }
];
let loadingStepInterval = null;

// =============================================
// INIT
// =============================================
function init() {
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

  el.sectionsCard       = document.getElementById('sections-card');
  el.sectionsGrid       = document.getElementById('sections-grid');

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
  el.apiKeyLink         = document.getElementById('api-key-link');
  el.providerWhy        = document.getElementById('provider-why');
  el.productThumbIcon   = document.getElementById('product-thumb-icon');

  // Restore saved provider + keys from localStorage
  const savedProvider = localStorage.getItem('uxv_provider');
  if (savedProvider && PROVIDERS[savedProvider]) state.provider = savedProvider;
  Object.keys(PROVIDERS).forEach(p => {
    const k = localStorage.getItem(PROVIDERS[p].storageKey);
    if (k) state.apiKeys[p] = k;
  });

  // Update UI to reflect restored provider
  selectProvider(state.provider, false);

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

  document.querySelectorAll('.provider-card').forEach(card => {
    card.addEventListener('click', () => selectProvider(card.dataset.provider, true));
  });
}

// Switch the active provider — updates UI and persists choice
function selectProvider(provider, persist) {
  if (!PROVIDERS[provider]) return;
  state.provider = provider;
  if (persist) localStorage.setItem('uxv_provider', provider);

  const info = PROVIDERS[provider];

  document.querySelectorAll('.provider-card').forEach(card => {
    card.classList.toggle('active', card.dataset.provider === provider);
  });

  if (el.apiKeyInput) {
    el.apiKeyInput.placeholder = info.placeholder;
    el.apiKeyInput.value       = state.apiKeys[provider] || '';
  }
  if (el.apiKeyLink) {
    el.apiKeyLink.href        = info.keyUrl;
    el.apiKeyLink.textContent = info.linkLabel;
  }
  if (el.providerWhy) el.providerWhy.textContent = info.why;
}

function saveApiKey() {
  const key = el.apiKeyInput.value.trim();
  state.apiKeys[state.provider] = key;
  if (key) {
    localStorage.setItem(PROVIDERS[state.provider].storageKey, key);
  } else {
    localStorage.removeItem(PROVIDERS[state.provider].storageKey);
  }
  el.apiKeyInput.blur();
  showToast(`${PROVIDERS[state.provider].name} key saved.`, 2000);
}

// =============================================
// DROP ZONE SETUP
// =============================================
function setupDropZone(type, zone, input, handler) {
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
  });

  input.addEventListener('change', () => {
    if (input.files[0]) handler(input.files[0]);
    input.value = '';
  });

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
  const allowed = ['.json', '.css', '.txt', '.md', '.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt'];
  if (!hasAllowedExt(file.name, allowed)) {
    showError(`Guidelines: unsupported format "${getExt(file.name)}". Use PDF, DOCX, XLSX, PPTX, JSON, or TXT.`);
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
  const imageExts = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
  const allowed   = [...imageExts, '.pbix', '.pbip', '.fig', '.twbx', '.qvf', '.qvw'];
  if (!hasAllowedExt(file.name, allowed)) {
    showError(`Unsupported format "${getExt(file.name)}". Use PNG/JPG, .pbix (Power BI), .twbx (Tableau), .fig (Figma), or .qvf (Qlik).`);
    return;
  }

  const isImage = hasAllowedExt(file.name, imageExts);

  if (state.productObjectUrl) URL.revokeObjectURL(state.productObjectUrl);
  state.productFile = file;

  if (isImage) {
    state.productObjectUrl   = URL.createObjectURL(file);
    el.productThumb.src      = state.productObjectUrl;
    el.productThumb.style.display = '';
    if (el.productThumbIcon) el.productThumbIcon.style.display = 'none';
  } else {
    state.productObjectUrl        = null;
    el.productThumb.src           = '';
    el.productThumb.style.display = 'none';
    if (el.productThumbIcon) {
      el.productThumbIcon.style.display = '';
      el.productThumbIcon.textContent   = getExt(file.name).replace('.', '').toUpperCase();
    }
  }

  el.productName.textContent = file.name;
  el.productSize.textContent = formatBytes(file.size);
  el.productZone.style.display    = 'none';
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
  el.productZone.style.display    = '';
  el.productPreview.style.display = 'none';
  el.productThumb.src             = '';
  el.productThumb.style.display   = '';
  if (el.productThumbIcon) el.productThumbIcon.style.display = 'none';
  updateAnalyzeBtn();
}

function updateAnalyzeBtn() {
  el.analyzeBtn.disabled = !(state.guidelinesFile && state.productFile);
}

// =============================================
// ANALYSIS — browser-only, direct API calls
// =============================================
async function runAnalysis() {
  hideError();

  const apiKey = state.apiKeys[state.provider];
  if (!apiKey) {
    showError(`No API key for ${PROVIDERS[state.provider].name}. Enter your key above and click Save.`);
    return;
  }

  showSection('loading');
  startLoadingSteps();

  try {
    // 1. Extract guidelines text in browser
    const guidelinesText = await extractGuidelinesText(state.guidelinesFile);
    if (!guidelinesText.trim()) {
      throw new Error('Could not extract any text from the guidelines file.');
    }

    // 2. Extract product image as base64 in browser
    const { imageBase64, previewDataUrl } = await extractProductData(state.productFile);

    // 3. Build prompt
    const prompt = buildAnalysisPrompt(guidelinesText, state.guidelinesFile.name, state.productFile.name);

    // 4. Call AI API directly
    let result;
    if (state.provider === 'anthropic')      result = await analyzeWithClaude(prompt, imageBase64, apiKey);
    else if (state.provider === 'openai')    result = await analyzeWithOpenAI(prompt, imageBase64, apiKey);
    else                                     result = await analyzeWithGemini(prompt, imageBase64, apiKey);

    // Attach preview for binary uploads so the annotated viewer can show the image
    if (previewDataUrl) result._previewImage = previewDataUrl;

    stopLoadingSteps();
    state.analysisResult = result;
    renderResults(result);
    showSection('results');

  } catch (err) {
    stopLoadingSteps();
    showSection('upload');
    showError(err.message || 'Analysis failed. Please try again.');
  }
}

// =============================================
// BROWSER FILE PROCESSING
// =============================================

async function extractGuidelinesText(file) {
  const ext = getExt(file.name);

  if (ext === '.pdf') return extractPdfText(file);
  if (ext === '.docx' || ext === '.doc') return extractDocxText(file);
  if (ext === '.xlsx' || ext === '.xls') return extractXlsxText(file);
  if (ext === '.pptx' || ext === '.ppt') return extractPptxText(file);

  // Plain text: json, txt, md, css
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsText(file);
  });
}

async function extractPdfText(file) {
  if (typeof pdfjsLib === 'undefined') {
    throw new Error('PDF.js failed to load. Please refresh and try again.');
  }
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(' ') + '\n';
  }
  return text;
}

async function extractDocxText(file) {
  if (typeof mammoth === 'undefined') {
    throw new Error('mammoth.js failed to load. Please refresh and try again.');
  }
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

async function extractXlsxText(file) {
  if (typeof XLSX === 'undefined') {
    throw new Error('SheetJS failed to load. Please refresh and try again.');
  }
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
  let text = '';
  workbook.SheetNames.forEach(name => {
    text += `[Sheet: ${name}]\n`;
    text += XLSX.utils.sheet_to_csv(workbook.Sheets[name]) + '\n\n';
  });
  return text;
}

async function extractPptxText(file) {
  if (typeof JSZip === 'undefined') {
    throw new Error('JSZip failed to load. Please refresh and try again.');
  }
  const zip    = new JSZip();
  const loaded = await zip.loadAsync(file);
  const names  = Object.keys(loaded.files)
    .filter(n => /ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort();

  let text = '';
  for (const name of names) {
    const raw   = await loaded.files[name].async('string');
    const slide = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (slide) text += slide + '\n\n';
  }
  return text || 'No readable text found in presentation.';
}

// Extract product image as JPEG base64 — handles images + binary design files
async function extractProductData(file) {
  const ext       = getExt(file.name);
  const imageExts = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

  if (imageExts.includes(ext)) {
    const base64 = await resizeImageToBase64(URL.createObjectURL(file));
    return { imageBase64: base64, previewDataUrl: null };
  }

  // PBIP — not a ZIP, give friendly error
  if (ext === '.pbip') {
    throw new Error(
      'Power BI Project (.pbip) files cannot be previewed directly.\n' +
      'Fix: In Power BI Desktop open the .pbip, then use File → Export → Export to PDF ' +
      '(or take a screenshot) and upload the PNG/JPG instead.'
    );
  }

  // Qlik — proprietary binary, not a ZIP
  if (ext === '.qvf' || ext === '.qvw') {
    throw new Error(
      `${ext.toUpperCase()} Qlik files cannot be previewed directly.\n` +
      'Fix: In Qlik Sense use the export/snapshot feature, or take a screenshot of your dashboard.'
    );
  }

  // ZIP-based design files: .pbix, .fig, .twbx
  if (typeof JSZip === 'undefined') {
    throw new Error('JSZip failed to load. Please refresh and try again.');
  }

  let loaded;
  try {
    const zip = new JSZip();
    loaded = await zip.loadAsync(await file.arrayBuffer());
  } catch (_) {
    throw new Error(
      `Could not open ${ext} file as a ZIP archive. ` +
      'Please export a screenshot (PNG/JPG) from your design tool and upload that instead.'
    );
  }

  const entries = Object.keys(loaded.files);
  let thumbEntry = null;

  if (ext === '.twbx') {
    // Tableau: thumbnail in Thumbnails/ folder
    for (const name of entries) {
      const n = name.toLowerCase();
      if (n.endsWith('.png') && (n.includes('thumbnail') || n.startsWith('thumbnails/'))) {
        thumbEntry = loaded.files[name]; break;
      }
    }
  } else {
    // PBIX, FIG: look for thumbnail.png anywhere
    for (const name of entries) {
      const n = name.toLowerCase();
      if (n === 'thumbnail.png' || (n.includes('thumbnail') && n.endsWith('.png'))) {
        thumbEntry = loaded.files[name]; break;
      }
    }
    // Fallback: first PNG in the archive
    if (!thumbEntry) {
      for (const name of entries) {
        if (name.toLowerCase().endsWith('.png')) {
          thumbEntry = loaded.files[name]; break;
        }
      }
    }
  }

  if (!thumbEntry) {
    throw new Error(
      `No preview image found inside this ${ext} file.\n` +
      'Tip: In Power BI click File → Export → PDF (then screenshot), ' +
      'or in Figma use File → Export → PNG and upload that instead.'
    );
  }

  const imgBytes  = await thumbEntry.async('arraybuffer');
  const blob      = new Blob([imgBytes], { type: 'image/png' });
  const objectUrl = URL.createObjectURL(blob);

  const base64 = await resizeImageToBase64(objectUrl);
  URL.revokeObjectURL(objectUrl);

  const previewDataUrl = 'data:image/jpeg;base64,' + base64;
  return { imageBase64: base64, previewDataUrl };
}

// Resize an image URL to max 1568px and return JPEG base64
function resizeImageToBase64(objectUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1568;
      let w = img.width;
      let h = img.height;
      if (w > MAX || h > MAX) {
        if (w >= h) { h = Math.round(h * MAX / w); w = MAX; }
        else        { w = Math.round(w * MAX / h); h = MAX; }
      }
      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      resolve(dataUrl.split(',')[1]); // base64 only
    };
    img.onerror = () => reject(new Error('Failed to load image for processing.'));
    img.src = objectUrl;
  });
}

// =============================================
// ANALYSIS PROMPT (BI-specific, 6 sections)
// =============================================
function buildAnalysisPrompt(guidelinesText, guidelinesFilename, productFilename) {
  const MAX_GUIDELINES = 12000;
  const text = guidelinesText.length > MAX_GUIDELINES
    ? guidelinesText.substring(0, MAX_GUIDELINES) + '\n... [truncated for length]'
    : guidelinesText;

  return `You are a senior BI design quality assurance expert specialising in dashboard UX. Analyze the provided dashboard screenshot against the brand guidelines and BI best practices. Be extremely thorough.

## Brand Guidelines (from: ${guidelinesFilename})
\`\`\`
${text}
\`\`\`

## Your Task
Analyze the dashboard screenshot (${productFilename}) against:
1. The brand guidelines above (colors, fonts, spacing, components)
2. BI & dashboard design best practices (chart choices, KPI layout, number formatting, axis labels, cognitive load, data-ink ratio, table formatting, color use for data)

Examine every visible element. Aim for 15–30+ issues total across all 6 sections.

## Output Format
Return ONLY a valid JSON object — no markdown fences, no text outside the JSON.

{
  "complianceScore": <integer 0-100>,
  "summary": "<2-3 sentence overall assessment>",
  "guidelinesSummary": {
    "colors": ["<color name and hex>"],
    "fonts": ["<font family with intended use>"],
    "fontSizes": {"<name>": "<value>"},
    "spacing": {"<name>": "<value>"},
    "other": ["<other rules>"]
  },
  "sections": [
    {
      "id": "typography",
      "title": "Typography",
      "score": <0-100>,
      "summary": "<1 sentence>",
      "issueCount": <integer>
    },
    {
      "id": "color",
      "title": "Color & Branding",
      "score": <0-100>,
      "summary": "<1 sentence>",
      "issueCount": <integer>
    },
    {
      "id": "charts",
      "title": "Charts & Visuals",
      "score": <0-100>,
      "summary": "<1 sentence>",
      "issueCount": <integer>
    },
    {
      "id": "numbers",
      "title": "Numbers & KPIs",
      "score": <0-100>,
      "summary": "<1 sentence>",
      "issueCount": <integer>
    },
    {
      "id": "layout",
      "title": "Layout & Spacing",
      "score": <0-100>,
      "summary": "<1 sentence>",
      "issueCount": <integer>
    },
    {
      "id": "best_practices",
      "title": "BI Best Practices",
      "score": <0-100>,
      "summary": "<1 sentence>",
      "issueCount": <integer>
    }
  ],
  "issues": [
    {
      "id": <integer starting at 1>,
      "section": "<one of: typography | color | charts | numbers | layout | best_practices>",
      "category": "<specific sub-category>",
      "severity": "<critical | high | medium | low>",
      "title": "<short issue title, max 60 chars>",
      "description": "<detailed description: what is wrong, where it is, why it violates the rule>",
      "location": "<precise location in the image>",
      "boundingBox": {
        "x": <float 0.0-1.0>,
        "y": <float 0.0-1.0>,
        "width": <float 0.0-1.0>,
        "height": <float 0.0-1.0>
      },
      "guidelineViolated": "<the specific guideline or best practice violated>",
      "currentValue": "<what the dashboard currently shows>",
      "expectedValue": "<what it should be>",
      "recommendation": "<specific actionable fix with exact values>"
    }
  ],
  "positives": ["<specific thing done correctly>"]
}

## Section Guide
- typography: fonts, sizes, weights, line heights, text alignment, hierarchy
- color: brand colors, data colors, contrast ratios, color accessibility
- charts: chart type appropriateness, chart junk, axis labels, legends, titles, gridlines, data-ink ratio
- numbers: KPI formatting, decimal places, units, thousands separators, percentage display
- layout: alignment, spacing, grid consistency, white space, visual hierarchy, cognitive load
- best_practices: dashboard purpose clarity, filter/slicer design, mobile considerations, storytelling, interactivity cues

## BoundingBox Guide
x=0.0, y=0.0 is top-left; x=1.0, y=1.0 is bottom-right. Be precise — these become visual markers on the image.

Return ONLY the JSON object.`;
}

// =============================================
// DIRECT AI API CALLS (browser)
// =============================================

function extractJSON(rawText) {
  const text = (rawText || '').trim();
  try {
    return JSON.parse(text);
  } catch (_) {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch (_2) {}
    }
    throw new Error('AI returned malformed JSON. Please try again.');
  }
}

async function analyzeWithClaude(prompt, imageBase64, apiKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'x-api-key':     apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 8096,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
          { type: 'text',  text: prompt }
        ]
      }]
    })
  });

  if (!res.ok) {
    let msg = `Anthropic API error ${res.status}`;
    try { const e = await res.json(); msg = e.error?.message || msg; } catch (_) {}
    if (res.status === 401) msg = 'Invalid Anthropic API key. Check your key at console.anthropic.com/account/keys';
    throw new Error(msg);
  }

  const data = await res.json();
  return extractJSON(data.content[0].text);
}

async function analyzeWithOpenAI(prompt, imageBase64, apiKey) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model:      'gpt-4o',
      max_tokens: 8096,
      messages: [{
        role: 'user',
        content: [
          { type: 'text',      text: prompt },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: 'high' } }
        ]
      }]
    })
  });

  if (!res.ok) {
    let msg = `OpenAI API error ${res.status}`;
    try { const e = await res.json(); msg = e.error?.message || msg; } catch (_) {}
    if (res.status === 401) msg = 'Invalid OpenAI API key. Check your key at platform.openai.com/api-keys';
    throw new Error(msg);
  }

  const data = await res.json();
  return extractJSON(data.choices[0].message.content);
}

async function analyzeWithGemini(prompt, imageBase64, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } }
        ]
      }]
    })
  });

  if (!res.ok) {
    let msg = `Gemini API error ${res.status}`;
    try { const e = await res.json(); msg = e.error?.message || msg; } catch (_) {}
    if (res.status === 400 || res.status === 403) msg = 'Invalid Gemini API key. Check your key at aistudio.google.com/app/apikey';
    throw new Error(msg);
  }

  const data = await res.json();
  return extractJSON(data.candidates[0].content.parts[0].text);
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
  // Reset section filter on each new result
  state.activeSection = 'all';

  renderScore(data.complianceScore);
  el.scoreSummary.textContent = data.summary || '';

  const issues = data.issues || [];
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  issues.forEach(i => { if (counts[i.severity] !== undefined) counts[i.severity]++; });

  el.countCritical.textContent = counts.critical;
  el.countHigh.textContent     = counts.high;
  el.countMedium.textContent   = counts.medium;
  el.countLow.textContent      = counts.low;

  renderSections(data.sections || []);
  renderGuidelinesChips(data.guidelinesSummary || {});
  renderAnnotatedImage(issues);
  renderIssues(issues);
  renderPositives(data.positives || []);
}

// =============================================
// SECTION SCORES
// =============================================
function renderSections(sections) {
  if (!sections || !sections.length) {
    el.sectionsCard.style.display = 'none';
    return;
  }
  el.sectionsCard.style.display = '';
  el.sectionsGrid.innerHTML = '';

  sections.forEach(sec => {
    const score = Math.max(0, Math.min(100, sec.score || 0));
    const color = score >= 80 ? '#22C55E' : score >= 60 ? '#EAB308' : score >= 40 ? '#F97316' : '#EF4444';
    const count = sec.issueCount || 0;

    const card = document.createElement('button');
    card.className = 'section-score-card';
    card.dataset.section = sec.id;
    card.innerHTML = `
      <div class="section-score-top">
        <span class="section-score-title">${escapeHtml(sec.title)}</span>
        <span class="section-score-num" style="color:${color}">${score}</span>
      </div>
      <div class="section-score-bar">
        <div class="section-score-fill" style="width:0%;background:${color}" data-target="${score}"></div>
      </div>
      <div class="section-score-meta">
        <span class="section-summary-text">${escapeHtml(sec.summary || '')}</span>
        <span class="section-issue-badge">${count} issue${count !== 1 ? 's' : ''}</span>
      </div>
    `;
    card.addEventListener('click', () => setSectionFilter(sec.id));
    el.sectionsGrid.appendChild(card);

    // Animate bar fill after paint
    requestAnimationFrame(() => {
      setTimeout(() => {
        const fill = card.querySelector('.section-score-fill');
        if (fill) fill.style.width = score + '%';
      }, 80);
    });
  });
}

function setSectionFilter(sectionId) {
  // Toggle: click same section again to clear filter
  state.activeSection = state.activeSection === sectionId ? 'all' : sectionId;
  document.querySelectorAll('.section-score-card').forEach(card => {
    card.classList.toggle('active', card.dataset.section === state.activeSection);
  });
  applyFilters();
}

function applyFilters() {
  document.querySelectorAll('.issue-card').forEach(card => {
    const severityOk = state.activeFilter  === 'all' || card.dataset.severity === state.activeFilter;
    const sectionOk  = state.activeSection === 'all' || card.dataset.section  === state.activeSection;
    card.classList.toggle('hidden', !(severityOk && sectionOk));
  });
}

function renderScore(score) {
  const s = Math.max(0, Math.min(100, score || 0));

  let current = 0;
  const step = Math.ceil(s / 40);
  const timer = setInterval(() => {
    current = Math.min(current + step, s);
    el.scoreNumber.textContent = current;
    if (current >= s) clearInterval(timer);
  }, 25);

  const circumference = 326.7;
  const dashoffset = circumference - (s / 100) * circumference;
  setTimeout(() => {
    el.scoreRingFill.style.strokeDashoffset = dashoffset;
  }, 50);

  const color = s >= 80 ? '#22C55E' : s >= 60 ? '#EAB308' : s >= 40 ? '#F97316' : '#EF4444';
  el.scoreRingFill.style.stroke = color;
}

// =============================================
// GUIDELINES SUMMARY CHIPS
// =============================================
function renderGuidelinesChips(summary) {
  el.guidelinesChips.innerHTML = '';

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

  if (summary.colors?.length) {
    addCategory('Colors');
    summary.colors.forEach(c => {
      const match = c.match(/#([0-9A-Fa-f]{3,6})/);
      const hex   = match ? match[0] : null;
      const name  = c.replace(/#([0-9A-Fa-f]{3,6})/g, '').replace(/[:\-,]/g, ' ').trim() || c;
      addChip(name, hex || c, !!hex);
    });
  }
  if (summary.fonts?.length) {
    addCategory('Fonts');
    summary.fonts.forEach(f => addChip(f, '', false));
  }
  if (summary.fontSizes && Object.keys(summary.fontSizes).length) {
    addCategory('Sizes');
    Object.entries(summary.fontSizes).forEach(([k, v]) => addChip(k, v, false));
  }
  if (summary.spacing && Object.keys(summary.spacing).length) {
    addCategory('Spacing');
    Object.entries(summary.spacing).forEach(([k, v]) => addChip(k, v, false));
  }
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
  el.designImage.src = state.analysisResult?._previewImage || state.productObjectUrl;

  el.designImage.onload = () => {
    const iw = el.designImage.naturalWidth;
    const ih = el.designImage.naturalHeight;

    el.annotationCanvas.width  = iw;
    el.annotationCanvas.height = ih;

    const displayW = el.designImage.getBoundingClientRect().width || el.designImage.offsetWidth;
    el.annotationCanvas.style.width  = displayW + 'px';
    el.annotationCanvas.style.height = (displayW / iw * ih) + 'px';

    drawAnnotations(issues, null);
    setupCanvasInteraction(issues);
  };

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

    ctx.fillStyle = color + '22';
    ctx.fillRect(x, y, w, h);

    ctx.strokeStyle = color;
    ctx.lineWidth = isHighlighted ? 3 : 2;
    if (isHighlighted) { ctx.shadowBlur = 8; ctx.shadowColor = color; }
    ctx.strokeRect(x, y, w, h);
    ctx.shadowBlur = 0;

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

const SECTION_LABELS = {
  typography:     'Typography',
  color:          'Color',
  charts:         'Charts',
  numbers:        'Numbers',
  layout:         'Layout',
  best_practices: 'Best Practices'
};

function createIssueCard(issue) {
  const card = document.createElement('div');
  card.className = 'issue-card fade-in';
  card.dataset.severity = issue.severity;
  card.dataset.section  = issue.section || 'best_practices';
  card.dataset.id       = issue.id;

  const sectionLabel = SECTION_LABELS[issue.section] || issue.section || '';

  card.innerHTML = `
    <div class="issue-header">
      <div class="issue-number">${issue.id}</div>
      <div class="issue-meta">
        <div class="issue-title-row">
          <span class="issue-title">${escapeHtml(issue.title)}</span>
          <span class="severity-badge ${issue.severity}">${issue.severity}</span>
          ${sectionLabel ? `<span class="section-tag section-tag-${issue.section}">${sectionLabel}</span>` : ''}
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
          <div class="issue-detail-label">Rule / Best Practice Violated</div>
          <div class="issue-detail-value">${escapeHtml(issue.guidelineViolated || '—')}</div>
        </div>
        <div class="issue-detail-item">
          <div class="issue-detail-label">Sub-category</div>
          <div class="issue-detail-value">${escapeHtml(issue.category || '—')}</div>
        </div>
        <div class="issue-detail-item" style="grid-column:1/-1">
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
        <div class="issue-recommendation-label">Fix / Recommendation</div>
        <div class="issue-recommendation-text">${escapeHtml(issue.recommendation || '')}</div>
      </div>
    </div>
  `;

  const header    = card.querySelector('.issue-header');
  const body      = card.querySelector('.issue-body');
  const expandBtn = card.querySelector('.issue-expand-btn');

  header.addEventListener('click', () => {
    const open = body.classList.toggle('open');
    expandBtn.classList.toggle('expanded', open);
  });

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
// FILTER (severity + section, AND logic)
// =============================================
function setFilter(filter) {
  state.activeFilter = filter;
  document.querySelectorAll('.filter-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.filter === filter);
  });
  applyFilters();
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
  state.activeSection = 'all';
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
