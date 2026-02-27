require('dotenv').config();
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const sharp   = require('sharp');

const app  = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Allowed file extensions
const GUIDELINES_EXTS = ['.json', '.css', '.txt', '.md', '.pdf', '.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt'];
const PRODUCT_EXTS    = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.pbix', '.pbip', '.fig'];
const IMAGE_EXTS      = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

// Multer config — accept all supported extensions
const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB (PBIX files can be large)
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

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const configured = {
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    openai:    !!process.env.OPENAI_API_KEY,
    gemini:    !!process.env.GEMINI_API_KEY
  };
  const anyConfigured  = Object.values(configured).some(Boolean);
  const defaultProvider = Object.keys(configured).find(k => configured[k]) || 'anthropic';
  res.json({ status: 'ok', apiKeyConfigured: anyConfigured, defaultProvider, providers: configured });
});

// ── Main analysis endpoint ────────────────────────────────────────────────────
app.post('/api/analyze', upload.fields([
  { name: 'guidelines', maxCount: 1 },
  { name: 'product',    maxCount: 1 }
]), async (req, res) => {
  const filesToClean = [];

  try {
    if (!req.files?.guidelines?.[0] || !req.files?.product?.[0]) {
      return res.status(400).json({ error: 'Both guidelines and product files are required.' });
    }

    const guidelinesFile = req.files['guidelines'][0];
    const productFile    = req.files['product'][0];
    filesToClean.push(guidelinesFile.path, productFile.path);

    // Determine provider (default: anthropic)
    const provider = (req.body?.provider || 'anthropic').toLowerCase();
    if (!['anthropic', 'openai', 'gemini'].includes(provider)) {
      return res.status(400).json({ error: 'Invalid provider. Use: anthropic, openai, or gemini.' });
    }

    // Resolve API key: env var takes precedence, then request header
    const envKeyMap = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY' };
    const apiKey = process.env[envKeyMap[provider]] || req.headers['x-api-key'];
    if (!apiKey) {
      return res.status(400).json({
        error: `No API key found for ${provider}. Set the environment variable or enter your key in the UI.`
      });
    }

    // ── Extract guidelines text ────────────────────────────────────────────
    const guidelinesText = await extractGuidelinesText(guidelinesFile.path, guidelinesFile.originalname);
    if (!guidelinesText.trim()) {
      return res.status(400).json({ error: 'Could not extract any text from the guidelines file.' });
    }

    // ── Extract / optimise product image ──────────────────────────────────
    const productExt     = path.extname(productFile.originalname).toLowerCase();
    const optimizedPath  = `${productFile.path}_opt.jpg`;
    filesToClean.push(optimizedPath);

    let imageBuffer;
    let previewImageData = null; // sent back to browser for binary uploads

    if (IMAGE_EXTS.includes(productExt)) {
      await sharp(productFile.path)
        .resize(1568, 1568, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .toFile(optimizedPath);
      imageBuffer = fs.readFileSync(optimizedPath);
    } else {
      // Binary design file (.pbix, .pbip, .fig) — extract embedded thumbnail
      imageBuffer = await extractProductImage(productFile.path, productFile.originalname);
      fs.writeFileSync(optimizedPath, imageBuffer);
      previewImageData = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
    }

    const imageBase64 = imageBuffer.toString('base64');

    // ── Run AI analysis ────────────────────────────────────────────────────
    const prompt = buildAnalysisPrompt(guidelinesText, guidelinesFile.originalname, productFile.originalname);

    let result;
    if (provider === 'anthropic') result = await analyzeWithClaude(prompt, imageBase64, apiKey);
    else if (provider === 'openai') result = await analyzeWithOpenAI(prompt, imageBase64, apiKey);
    else                            result = await analyzeWithGemini(prompt, imageBase64, apiKey);

    // Attach preview image for binary uploads so the browser can display it
    if (previewImageData) result._previewImage = previewImageData;

    res.json(result);

  } catch (err) {
    console.error('Analysis error:', err);
    let message = err.message || 'An unexpected error occurred during analysis.';

    // Friendly auth errors per provider
    if (err.status === 401 || /401|unauthorized|invalid.*key|api key/i.test(err.message || '')) {
      const provider = req.body?.provider || 'anthropic';
      const keyLinks = {
        anthropic: 'console.anthropic.com/account/keys',
        openai:    'platform.openai.com/api-keys',
        gemini:    'aistudio.google.com/app/apikey'
      };
      message = `Invalid API key for ${provider}. Check your key at ${keyLinks[provider]}`;
    }

    res.status(err.status || 500).json({ error: message });
  } finally {
    for (const fp of filesToClean) {
      try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (_) {}
    }
  }
});

// ── Extract text from guidelines (all supported formats) ─────────────────────
async function extractGuidelinesText(filePath, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  try {
    // PDF
    if (ext === '.pdf') {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(fs.readFileSync(filePath));
      return data.text;
    }

    // Word (.docx — mammoth handles docx only; .doc may fail gracefully)
    if (ext === '.docx' || ext === '.doc') {
      const mammoth = require('mammoth');
      const result  = await mammoth.extractRawText({ path: filePath });
      return result.value;
    }

    // Excel (.xlsx, .xls — SheetJS handles both)
    if (ext === '.xlsx' || ext === '.xls') {
      const XLSX     = require('xlsx');
      const workbook = XLSX.readFile(filePath);
      let text = '';
      workbook.SheetNames.forEach(name => {
        text += `[Sheet: ${name}]\n`;
        text += XLSX.utils.sheet_to_csv(workbook.Sheets[name]) + '\n\n';
      });
      return text;
    }

    // PowerPoint (.pptx — it's a ZIP of XML slides)
    if (ext === '.pptx' || ext === '.ppt') {
      const AdmZip  = require('adm-zip');
      const zip     = new AdmZip(filePath);
      const entries = zip.getEntries();
      let text = '';
      entries
        .filter(e => /ppt\/slides\/slide\d+\.xml$/i.test(e.entryName))
        .sort((a, b) => a.entryName.localeCompare(b.entryName))
        .forEach(entry => {
          const raw   = entry.getData().toString('utf8');
          const slide = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          if (slide) text += slide + '\n\n';
        });
      return text || 'No readable text found in presentation.';
    }

    // JSON, TXT, MD, CSS — plain UTF-8
    return fs.readFileSync(filePath, 'utf-8');

  } catch (err) {
    throw new Error(`Failed to read guidelines file (${ext}): ${err.message}`);
  }
}

// ── Extract preview image from binary design files (.pbix, .pbip, .fig) ──────
async function extractProductImage(filePath, originalName) {
  const ext    = path.extname(originalName).toLowerCase();
  const AdmZip = require('adm-zip');

  try {
    const zip     = new AdmZip(filePath);
    const entries = zip.getEntries();

    // Look for thumbnail.png (common in both .pbix and .fig files)
    const thumb = entries.find(e =>
      e.entryName.toLowerCase() === 'thumbnail.png' ||
      (e.entryName.toLowerCase().includes('thumbnail') && e.entryName.toLowerCase().endsWith('.png'))
    );

    if (thumb) {
      return await sharp(thumb.getData())
        .resize(1568, 1568, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .toBuffer();
    }

    // Fallback: first PNG found anywhere inside the ZIP
    const anyPng = entries.find(e => e.entryName.toLowerCase().endsWith('.png'));
    if (anyPng) {
      return await sharp(anyPng.getData())
        .resize(1568, 1568, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .toBuffer();
    }

    throw new Error(
      `No preview image found inside this ${ext} file.\n` +
      `Tip: In Power BI click File → Export → PDF (then screenshot), ` +
      `or in Figma use File → Export → PNG and upload that instead.`
    );
  } catch (err) {
    if (err.message.includes('No preview image')) throw err;
    throw new Error(
      `Could not open ${ext} file as a ZIP archive. ` +
      `Please export a screenshot (PNG/JPG) from your design tool and upload that.`
    );
  }
}

// ── Shared analysis prompt ────────────────────────────────────────────────────
function buildAnalysisPrompt(guidelinesText, guidelinesFilename, productFilename) {
  return `You are a senior UX/UI design quality assurance expert. You will analyze a design screenshot against provided UX guidelines and produce a thorough compliance report.

## UX Guidelines (from file: ${guidelinesFilename})
\`\`\`
${guidelinesText}
\`\`\`

## Your Task
Analyze the provided design screenshot (${productFilename}) against the guidelines above. Be extremely thorough and specific. Examine every visible element:
- Colors (backgrounds, text, borders, icons, buttons, links)
- Typography (font families, sizes, weights, line heights, letter spacing)
- Spacing & layout (padding, margins, gaps, grid alignment)
- Component styles (buttons, inputs, cards, navigation, badges)
- Branding consistency (logos, icons, imagery tone)
- Accessibility (contrast ratios, text sizes)

## Output Format
Return ONLY a valid JSON object with ZERO additional text, no markdown code fences, no explanations outside the JSON. Use this exact structure:

{
  "complianceScore": <integer 0-100>,
  "summary": "<2-3 sentence overall assessment>",
  "guidelinesSummary": {
    "colors": ["<each color found in guidelines with its name and hex/value>"],
    "fonts": ["<each font family with its intended use>"],
    "fontSizes": {"<name>": "<value>"},
    "spacing": {"<name>": "<value>"},
    "other": ["<any other rules extracted from guidelines>"]
  },
  "issues": [
    {
      "id": <integer starting at 1>,
      "category": "<one of: color | typography | spacing | layout | component | branding | accessibility | other>",
      "severity": "<one of: critical | high | medium | low>",
      "title": "<short issue title, max 60 chars>",
      "description": "<detailed description: what exactly is wrong, where it appears, why it violates the guideline>",
      "location": "<precise textual description of where in the image this issue occurs>",
      "boundingBox": {
        "x": <float 0.0-1.0, fraction of image width from left edge>,
        "y": <float 0.0-1.0, fraction of image height from top edge>,
        "width": <float 0.0-1.0, fraction of image width>,
        "height": <float 0.0-1.0, fraction of image height>
      },
      "guidelineViolated": "<exact guideline rule that is violated>",
      "currentValue": "<what the design currently shows, e.g., '#FF0000', 'Arial 14px'>",
      "expectedValue": "<what guidelines specify it should be>",
      "recommendation": "<specific, actionable fix with exact values to change to>"
    }
  ],
  "positives": [
    "<specific thing that correctly follows a guideline, with detail>"
  ]
}

## Severity Guide
- critical: Completely wrong / major brand violation (e.g., wrong primary color on hero CTA, wrong font family throughout)
- high: Clearly incorrect value that significantly impacts design quality (e.g., heading size off by more than 20%)
- medium: Notable deviation that should be fixed (e.g., spacing slightly off, secondary color misused)
- low: Minor inconsistency or polish issue (e.g., border-radius slightly different)

## BoundingBox Guidelines
- Use precise coordinates to mark the EXACT element with the issue
- x=0.0, y=0.0 is top-left corner; x=1.0, y=1.0 is bottom-right
- For a small button in the top-right area: {"x": 0.75, "y": 0.02, "width": 0.15, "height": 0.06}
- If an issue is truly global (affects whole design), set {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0}
- Be as precise as possible — users will see these as visual annotations on the image

Find ALL issues. Do not stop early. Return ONLY the JSON object.`;
}

// ── Robustly extract JSON from any AI response ────────────────────────────────
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

// ── Anthropic Claude ──────────────────────────────────────────────────────────
async function analyzeWithClaude(prompt, imageBase64, apiKey) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client    = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 8096,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
        { type: 'text',  text: prompt }
      ]
    }]
  });

  return extractJSON(response.content[0].text);
}

// ── OpenAI GPT-4o ─────────────────────────────────────────────────────────────
async function analyzeWithOpenAI(prompt, imageBase64, apiKey) {
  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey });

  const response = await client.chat.completions.create({
    model:      'gpt-4o',
    max_tokens: 8096,
    messages: [{
      role: 'user',
      content: [
        { type: 'text',      text: prompt },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}`, detail: 'high' } }
      ]
    }]
  });

  return extractJSON(response.choices[0].message.content);
}

// ── Google Gemini ─────────────────────────────────────────────────────────────
async function analyzeWithGemini(prompt, imageBase64, apiKey) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const result = await model.generateContent([
    { text: prompt },
    { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } }
  ]);

  return extractJSON(result.response.text());
}

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`UX Validator running at http://localhost:${PORT}`);
  const missing = [];
  if (!process.env.ANTHROPIC_API_KEY) missing.push('ANTHROPIC_API_KEY');
  if (!process.env.OPENAI_API_KEY)    missing.push('OPENAI_API_KEY');
  if (!process.env.GEMINI_API_KEY)    missing.push('GEMINI_API_KEY');
  if (missing.length < 3) {
    console.log(`ℹ  Server-side keys not set for: ${missing.join(', ')} — users must enter those in the UI.`);
  }
});
