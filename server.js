require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const sharp   = require('sharp');

const app  = express();
const PORT = process.env.PORT || 3000;

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// ── File extension lists ──────────────────────────────────────────────────────
const GUIDELINES_EXTS = ['.json', '.css', '.txt', '.md', '.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt'];
const PRODUCT_EXTS    = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.pbix', '.pbip', '.fig', '.twbx', '.qvf', '.qvw'];
const IMAGE_EXTS      = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

// ── Multer ────────────────────────────────────────────────────────────────────
const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if ([...GUIDELINES_EXTS, ...PRODUCT_EXTS].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${ext}`));
    }
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const configured = {
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    openai:    !!process.env.OPENAI_API_KEY,
    gemini:    !!process.env.GEMINI_API_KEY
  };
  const anyConfigured   = Object.values(configured).some(Boolean);
  const defaultProvider = Object.keys(configured).find(k => configured[k]) || 'anthropic';
  res.json({ status: 'ok', apiKeyConfigured: anyConfigured, defaultProvider, providers: configured });
});

// ── Analyze ───────────────────────────────────────────────────────────────────
app.post('/api/analyze', upload.fields([
  { name: 'guidelines', maxCount: 1 },
  { name: 'product',    maxCount: 1 }
]), async (req, res) => {
  const filesToClean = [];

  try {
    if (!req.files?.guidelines?.[0] || !req.files?.product?.[0]) {
      return res.status(400).json({ error: 'Both a guidelines file and a dashboard file are required.' });
    }

    const guidelinesFile = req.files['guidelines'][0];
    const productFile    = req.files['product'][0];
    filesToClean.push(guidelinesFile.path, productFile.path);

    const provider = (req.body?.provider || 'anthropic').toLowerCase();
    if (!['anthropic', 'openai', 'gemini'].includes(provider)) {
      return res.status(400).json({ error: 'Invalid provider. Use: anthropic, openai, or gemini.' });
    }

    const envKeyMap = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY' };
    const apiKey = process.env[envKeyMap[provider]] || req.headers['x-api-key'];
    if (!apiKey) {
      return res.status(400).json({
        error: `No API key found for ${provider}. Set the environment variable or enter your key in the UI.`
      });
    }

    // Extract guidelines text
    const guidelinesText = await extractGuidelinesText(guidelinesFile.path, guidelinesFile.originalname);

    // Extract / optimise dashboard image
    const productExt    = path.extname(productFile.originalname).toLowerCase();
    const optimizedPath = `${productFile.path}_opt.jpg`;
    filesToClean.push(optimizedPath);

    let imageBuffer;
    let previewImageData = null;

    if (IMAGE_EXTS.includes(productExt)) {
      await sharp(productFile.path)
        .resize(1568, 1568, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .toFile(optimizedPath);
      imageBuffer = fs.readFileSync(optimizedPath);
    } else {
      imageBuffer = await extractProductImage(productFile.path, productFile.originalname);
      fs.writeFileSync(optimizedPath, imageBuffer);
      previewImageData = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
    }

    const imageBase64 = imageBuffer.toString('base64');
    const prompt      = buildAnalysisPrompt(guidelinesText, guidelinesFile.originalname, productFile.originalname);

    let result;
    if (provider === 'anthropic') result = await analyzeWithClaude(prompt, imageBase64, apiKey);
    else if (provider === 'openai') result = await analyzeWithOpenAI(prompt, imageBase64, apiKey);
    else                            result = await analyzeWithGemini(prompt, imageBase64, apiKey);

    if (previewImageData) result._previewImage = previewImageData;

    res.json(result);

  } catch (err) {
    console.error('Analysis error:', err);
    let message = err.message || 'An unexpected error occurred.';
    if (err.status === 401 || /401|unauthorized|invalid.*key|api key/i.test(err.message || '')) {
      const prov = req.body?.provider || 'anthropic';
      const links = { anthropic: 'console.anthropic.com/account/keys', openai: 'platform.openai.com/api-keys', gemini: 'aistudio.google.com/app/apikey' };
      message = `Invalid API key for ${prov}. Check your key at ${links[prov]}`;
    }
    res.status(err.status || 500).json({ error: message });
  } finally {
    for (const fp of filesToClean) {
      try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (_) {}
    }
  }
});

// ── Extract text from guidelines ──────────────────────────────────────────────
async function extractGuidelinesText(filePath, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  try {
    if (ext === '.pdf') {
      const pdfParse = require('pdf-parse');
      return (await pdfParse(fs.readFileSync(filePath))).text;
    }
    if (ext === '.docx' || ext === '.doc') {
      const mammoth = require('mammoth');
      return (await mammoth.extractRawText({ path: filePath })).value;
    }
    if (ext === '.xlsx' || ext === '.xls') {
      const XLSX = require('xlsx');
      const wb   = XLSX.readFile(filePath);
      let text   = '';
      wb.SheetNames.forEach(n => { text += `[Sheet: ${n}]\n` + XLSX.utils.sheet_to_csv(wb.Sheets[n]) + '\n\n'; });
      return text;
    }
    if (ext === '.pptx' || ext === '.ppt') {
      const AdmZip  = require('adm-zip');
      const zip     = new AdmZip(filePath);
      const entries = zip.getEntries();
      let text = '';
      entries
        .filter(e => /ppt\/slides\/slide\d+\.xml$/i.test(e.entryName))
        .sort((a, b) => a.entryName.localeCompare(b.entryName))
        .forEach(e => {
          const slide = e.getData().toString('utf8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          if (slide) text += slide + '\n\n';
        });
      return text || 'No readable text found in presentation.';
    }
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    throw new Error(`Failed to read guidelines file (${ext}): ${err.message}`);
  }
}

// ── Extract image from binary dashboard files ─────────────────────────────────
async function extractProductImage(filePath, originalName) {
  const ext = path.extname(originalName).toLowerCase();

  // PBIP is a JSON pointer file — not a ZIP, no embedded image
  if (ext === '.pbip') {
    throw new Error(
      'Power BI Project (.pbip) files are folder-based and cannot be previewed directly.\n' +
      'Fix: In Power BI Desktop open the .pbip, then use File → Export → Export to PDF and screenshot it,\n' +
      'OR use File → Save As to save as .pbix and upload that instead.'
    );
  }

  // Qlik binary formats — proprietary, not ZIP-based
  if (ext === '.qvf' || ext === '.qvw') {
    throw new Error(
      `${ext.toUpperCase()} is a proprietary Qlik binary format that cannot be previewed directly.\n` +
      'Fix: In Qlik Sense, right-click a sheet → Export → Export as image.\n' +
      'In QlikView, use the snapshot tool or Ctrl+Print Screen.\n' +
      'Then upload the saved PNG/JPG screenshot instead.'
    );
  }

  const AdmZip = require('adm-zip');
  let zip, entries;

  try {
    zip     = new AdmZip(filePath);
    entries = zip.getEntries();
  } catch (_) {
    throw new Error(
      `Could not open ${ext} file. It may be corrupted or use an unsupported format.\n` +
      getExportTip(ext)
    );
  }

  // Tableau .twbx — has a Thumbnails/ directory
  if (ext === '.twbx') {
    const thumb = entries.find(e => {
      const n = e.entryName.toLowerCase();
      return n.endsWith('.png') && (n.includes('thumbnail') || n.startsWith('thumbnails/'));
    });
    if (thumb) {
      return sharp(thumb.getData())
        .resize(1568, 1568, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .toBuffer();
    }
  }

  // Excel .xlsx — has docProps/thumbnail.jpeg
  if (ext === '.xlsx') {
    const thumb = entries.find(e => {
      const n = e.entryName.toLowerCase();
      return n === 'docprops/thumbnail.jpeg' || n === 'docprops/thumbnail.jpg' || n === 'docprops/thumbnail.png';
    });
    if (thumb) {
      return sharp(thumb.getData())
        .resize(1568, 1568, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .toBuffer();
    }
  }

  // Generic — look for thumbnail.png at root (Power BI .pbix, Figma .fig)
  const thumbRoot = entries.find(e => e.entryName.toLowerCase() === 'thumbnail.png');
  if (thumbRoot) {
    return sharp(thumbRoot.getData())
      .resize(1568, 1568, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
  }

  // Fallback — any PNG inside the archive
  const anyPng = entries.find(e => e.entryName.toLowerCase().endsWith('.png'));
  if (anyPng) {
    return sharp(anyPng.getData())
      .resize(1568, 1568, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
  }

  throw new Error(`No preview image found inside this ${ext} file.\n` + getExportTip(ext));
}

function getExportTip(ext) {
  const tips = {
    '.pbix':  'Tip: In Power BI Desktop use File → Export → Export to PDF, screenshot it, and upload as PNG.',
    '.twbx':  'Tip: In Tableau use Dashboard → Export → Image and upload the saved PNG.',
    '.xlsx':  'Tip: Screenshot your Excel dashboard (Win+Shift+S on Windows) and upload as PNG.',
    '.fig':   'Tip: In Figma select the frame → File → Export as PNG and upload that.',
  };
  return tips[ext] || 'Please export a screenshot (PNG/JPG) from your BI tool and upload that instead.';
}

// ── Analysis prompt ────────────────────────────────────────────────────────────
function buildAnalysisPrompt(guidelinesText, guidelinesFilename, productFilename) {
  const hasGuidelines = (guidelinesText || '').trim().length > 30;

  return `You are a senior BI dashboard design expert and quality assurance specialist with deep knowledge of Power BI, Tableau, Qlik, and dashboard design best practices. Analyze the dashboard screenshot provided.

${hasGuidelines
  ? `## Brand & UX Guidelines (from: ${guidelinesFilename})\n\`\`\`\n${guidelinesText}\n\`\`\``
  : `## Brand Guidelines\nNone provided — evaluate solely against BI best practices below.`}

## BI Dashboard Design Standards to Evaluate

### SECTION typography — Typography & Text
- Font families: consistent, professional, readable (not decorative) throughout
- Size hierarchy: page title > section headers > chart titles > axis labels > data labels > footnotes
- Text weight: bold for emphasis only; avoid bold decoration
- Label readability: no truncated, overlapping, or illegibly small (<10px) text
- Table text: headers distinguishable from data rows

### SECTION color — Color & Visual Design
- Brand colors used consistently per guidelines (if provided)
- Color conveys meaning, not decoration
- Sequential palette (light→dark) for quantitative/ordered data
- Diverging palette for data with meaningful midpoint (profit/loss, variance)
- Categorical palette for distinct groups (recommended ≤7 distinct colors)
- Red = negative/bad, Green = positive/good — applied consistently throughout
- Sufficient contrast: text on background must meet WCAG AA (≥4.5:1 for normal text)
- No rainbow / spectral color schemes for quantitative data
- Alert: color used as the ONLY way to encode information (accessibility failure)

### SECTION charts — Charts & Visualizations
- Correct chart type for the data relationship:
  • Time trends → Line or Area chart (NOT bar for many time points)
  • Ranking / comparison → Horizontal bar chart
  • Part-to-whole → Stacked bar or pie/donut (pie ONLY for ≤5 slices)
  • Correlation → Scatter plot
  • Distribution → Histogram or box plot
  • Geographic → Map visual
- Flag: 3D charts (distort perception — always wrong)
- Flag: Pie chart with >5 slices (impossible to compare)
- Flag: Misleading dual-axis chart
- Flag: Bar chart used for time series with many time points (line is better)
- Data-ink ratio: remove chartjunk (unnecessary gridlines, shadows, borders, decorative fills)
- Chart size proportional to its importance on the dashboard

### SECTION numbers — Numbers & KPIs
- Every KPI card MUST have: current value + comparison (vs target OR vs prior period)
- Variance indicators required: arrows (↑↓), delta values (+12%, −£3K), color coding
- Time context required: "MTD", "YTD", "vs Last Year", "as of [Date]"
- Rounding: use £1.2M not £1,234,567; 23% not 23.4872%
- Units and currency symbols present and correct
- Consistent number format: never mix £K and £M, or % and ratio
- Null/zero handling: show "N/A" or "0" not blank cells

### SECTION layout — Layout & Structure
- F-pattern reading: most important KPIs in top-left area
- Visual hierarchy: Page Title → Filters/Slicers → KPI Cards → Charts → Detail Tables
- Grouping: related visuals close together; unrelated visuals separated by whitespace
- Filters/slicers clearly labeled, grouped together
- Grid alignment: elements snap to an invisible grid — no random positioning
- Max ~7 key metrics visible without scrolling
- Page title prominent, descriptive, positioned top-left or top-center

### SECTION best_practices — BI Best Practices (Axes, Tables, Labels, Clarity)
- Axes: bar chart Y-axis starts at zero; line chart Y-axis labeled with units
- Axis titles: every axis labeled with units e.g. "Revenue (£000s)"
- Gridlines: light gray, subtle — gridlines must never compete with data ink
- No unnecessary tick marks or axis lines
- Tables: bold headers; alternating row colors or clear separators; numbers right-aligned; text left-aligned; totals clearly distinguished; conditional formatting for outliers
- Chart titles: specific and descriptive ("Monthly Revenue by Region" not just "Revenue")
- Insight titles preferred ("Revenue dropped 18% in March" beats "March Revenue")
- Legends: labeled clearly (not "Series 1"); positioned close to data; removed if chart is self-labeling
- Cognitive load: dashboard has one clear purpose; ≤9 distinct visuals per page; consistent style
- Interactivity: drill-throughs and buttons have clear visual affordance

## Output Format
Return ONLY valid JSON — zero text outside the JSON, no markdown code fences.

{
  "complianceScore": <integer 0–100 overall>,
  "summary": "<3–4 sentence executive summary: overall rating, top 2 strengths, top 2 critical gaps>",
  "guidelinesSummary": {
    "colors":    ["<color name: #hex or description>"],
    "fonts":     ["<font family and intended use>"],
    "fontSizes": {"<name>": "<value>"},
    "spacing":   {"<name>": "<value>"},
    "other":     ["<other guideline rule>"]
  },
  "sections": [
    {
      "id":         "<typography | color | charts | numbers | layout | best_practices>",
      "title":      "<human-readable title, e.g. 'Typography & Text'>",
      "score":      <integer 0–100 for this section>,
      "summary":    "<2–3 sentences: key finding in this section, most impactful issue>",
      "issueCount": <count of issues tagged to this section>
    }
  ],
  "issues": [
    {
      "id":               <integer starting at 1>,
      "section":          "<typography | color | charts | numbers | layout | best_practices>",
      "category":         "<specific sub-label, e.g.: font-size | chart-type | kpi-comparison | axis-label | table-alignment | color-palette | number-format | layout-hierarchy | legend | cognitive-load | etc.>",
      "severity":         "<critical | high | medium | low>",
      "title":            "<concise issue title, max 70 chars>",
      "description":      "<detailed explanation: WHAT is wrong, exactly WHERE in the dashboard, and WHY it matters — include data misinterpretation risk or brand impact>",
      "location":         "<precise element description, e.g. 'Revenue KPI card, top-left', 'Bar chart title in center panel', 'Table in bottom-right'>",
      "boundingBox":      { "x": <0.0–1.0>, "y": <0.0–1.0>, "width": <0.0–1.0>, "height": <0.0–1.0> },
      "guidelineViolated":"<exact rule from brand guidelines OR specific BI best practice above>",
      "currentValue":     "<what is currently shown, e.g. '#CC0000', 'Pie chart with 9 slices', 'No comparison value shown', 'Arial 9px'>",
      "expectedValue":    "<what it should be, e.g. '#D97757', 'Horizontal bar chart', '+/- vs Prior Year delta', 'Inter 12px minimum'>",
      "recommendation":   "<exact actionable fix: 'Replace pie chart with horizontal bar chart sorted descending', 'Add vs LY delta row below the KPI value in green/red', 'Change font-size from 9px to 12px'>"
    }
  ],
  "positives": [
    "<specific positive finding with detail — name the exact element and which guideline/best practice it follows correctly>"
  ]
}

## Severity Guide
- critical: Causes data misinterpretation OR major brand violation (3D chart, pie with 12 slices, wrong primary brand color on hero element, KPI with zero context)
- high: Significantly hurts professional quality or comprehension (wrong chart type, missing axis labels, no KPI comparisons anywhere, inconsistent number format throughout)
- medium: Notable deviation to fix (minor color inconsistency, data labels on dense chart, slightly off spacing, truncated axis labels)
- low: Polish issue (legend could be repositioned, title could be more descriptive, minor rounding inconsistency)

## Bounding Box Instructions
x=0, y=0 is TOP-LEFT corner. x=1, y=1 is BOTTOM-RIGHT.
Mark the EXACT element. Be precise — these are visual overlays on the dashboard image.
Global issues (affects whole dashboard): {"x":0,"y":0,"width":1,"height":1}

## Thoroughness Requirement
Find EVERY issue — do not stop early. A professional audit of a real dashboard should typically find 15–30+ issues across all 6 sections. Be exhaustive. Return ONLY the JSON.`;
}

// ── JSON extraction ────────────────────────────────────────────────────────────
function extractJSON(rawText) {
  const text = (rawText || '').trim();
  try { return JSON.parse(text); } catch (_) {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) { try { return JSON.parse(match[0]); } catch (_2) {} }
    throw new Error('AI returned malformed JSON. Please try again.');
  }
}

// ── Providers ─────────────────────────────────────────────────────────────────
async function analyzeWithClaude(prompt, imageBase64, apiKey) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 8096,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
      { type: 'text',  text: prompt }
    ]}]
  });
  return extractJSON(response.content[0].text);
}

async function analyzeWithOpenAI(prompt, imageBase64, apiKey) {
  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model: 'gpt-4o', max_tokens: 8096,
    messages: [{ role: 'user', content: [
      { type: 'text',      text: prompt },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: 'high' } }
    ]}]
  });
  return extractJSON(response.choices[0].message.content);
}

async function analyzeWithGemini(prompt, imageBase64, apiKey) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  const model  = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  const result = await model.generateContent([
    { text: prompt },
    { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } }
  ]);
  return extractJSON(result.response.text());
}

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`BI Dashboard Validator running at http://localhost:${PORT}`);
  const missing = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY'].filter(k => !process.env[k]);
  if (missing.length) console.log(`ℹ  No server-side keys for: ${missing.join(', ')} — users must enter in the UI.`);
});
