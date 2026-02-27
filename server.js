require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const sharp = require('sharp');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Multer config
const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
  fileFilter: (req, file, cb) => {
    const guidelinesMimes = ['application/json', 'text/css', 'text/plain', 'text/markdown', 'text/x-markdown'];
    const productMimes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
    const allAllowed = [...guidelinesMimes, ...productMimes];
    // Also allow by extension since some browsers misreport mime types
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExts = ['.json', '.css', '.txt', '.md', '.png', '.jpg', '.jpeg', '.webp', '.gif'];
    if (allAllowed.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/api/health', (req, res) => {
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  res.json({ status: 'ok', apiKeyConfigured: hasKey });
});

// Main analysis endpoint
app.post('/api/analyze', upload.fields([
  { name: 'guidelines', maxCount: 1 },
  { name: 'product', maxCount: 1 }
]), async (req, res) => {
  const filesToClean = [];

  try {
    if (!req.files?.guidelines?.[0] || !req.files?.product?.[0]) {
      return res.status(400).json({ error: 'Both guidelines and product files are required.' });
    }

    const guidelinesFile = req.files['guidelines'][0];
    const productFile = req.files['product'][0];
    filesToClean.push(guidelinesFile.path, productFile.path);

    // Resolve API key: env var takes precedence, then request header
    const apiKey = process.env.ANTHROPIC_API_KEY || req.headers['x-api-key'];
    if (!apiKey) {
      return res.status(400).json({
        error: 'No API key found. Set ANTHROPIC_API_KEY in environment or provide it in the UI.'
      });
    }

    // Read guidelines
    const guidelinesText = fs.readFileSync(guidelinesFile.path, 'utf-8');
    if (!guidelinesText.trim()) {
      return res.status(400).json({ error: 'Guidelines file is empty.' });
    }

    // Optimize image with sharp: resize long edge to max 1568px, convert to jpeg
    const optimizedPath = `${productFile.path}_optimized.jpg`;
    filesToClean.push(optimizedPath);

    await sharp(productFile.path)
      .resize(1568, 1568, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toFile(optimizedPath);

    const imageBuffer = fs.readFileSync(optimizedPath);
    const imageBase64 = imageBuffer.toString('base64');

    // Run analysis
    const client = new Anthropic({ apiKey });
    const result = await analyzeWithClaude(client, guidelinesText, imageBase64, guidelinesFile.originalname, productFile.originalname);

    res.json(result);

  } catch (err) {
    console.error('Analysis error:', err);
    const message = err.status === 401
      ? 'Invalid API key. Please check your Anthropic API key.'
      : err.message || 'An unexpected error occurred during analysis.';
    res.status(err.status || 500).json({ error: message });
  } finally {
    // Clean up uploaded files
    for (const fp of filesToClean) {
      try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (_) {}
    }
  }
});

async function analyzeWithClaude(client, guidelinesText, imageBase64, guidelinesFilename, productFilename) {
  const prompt = `You are a senior UX/UI design quality assurance expert. You will analyze a design screenshot against provided UX guidelines and produce a thorough compliance report.

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

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8096,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: imageBase64
            }
          },
          {
            type: 'text',
            text: prompt
          }
        ]
      }
    ]
  });

  const rawText = response.content[0].text.trim();

  // Robustly extract JSON
  try {
    return JSON.parse(rawText);
  } catch (_) {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch (e2) {
        throw new Error('Claude returned malformed JSON. Try again.');
      }
    }
    throw new Error('Could not parse analysis response. Try again.');
  }
}

app.listen(PORT, () => {
  console.log(`UX Validator running at http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠  ANTHROPIC_API_KEY not set. Users must provide their API key in the UI.');
  }
});
