const GEMINI_API_KEY = "";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent";

function safeParseGemini(raw) {
  if (!raw) throw new Error("Empty response from Gemini");
  raw = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  try { return JSON.parse(raw); } catch (_) {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON found in response");
  let candidate = match[0];
  try { return JSON.parse(candidate); } catch (_) {}
  candidate = repairJson(candidate);
  return JSON.parse(candidate);
}

function repairJson(str) {
  str = str.replace(/,\s*([}\]])/g, "$1");
  let openBraces = 0, openBrackets = 0, inString = false, escaped = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\" && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") openBraces++;
    else if (ch === "}") openBraces--;
    else if (ch === "[") openBrackets++;
    else if (ch === "]") openBrackets--;
  }
  if (inString) str += '"';
  str += "]".repeat(Math.max(0, openBrackets));
  str += "}".repeat(Math.max(0, openBraces));
  return str;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get("stats", (data) => {
    if (!data.stats) {
      chrome.storage.local.set({
        stats: {
          phishingBlocked: 0,
          misinfoFlagged: 0,
          deepfakesDetected: 0,
          privacyAnalyzed: 0,
          totalScans: 0,
          lastScan: null,
          history: []
        },
        settings: {
          autoScan: true,
          phishing: true,
          misinfo: true,
          deepfake: true,
          privacy: false
        }
      });
    }
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "ANALYZE_PAGE") {
    analyzePage(message.data, sender.tab)
      .then(result => sendResponse({ success: true, result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.type === "GET_STATS") {
    chrome.storage.local.get("stats", (data) => {
      sendResponse(data.stats || {});
    });
    return true;
  }

  if (message.type === "GET_SETTINGS") {
    chrome.storage.local.get("settings", (data) => {
      sendResponse(data.settings || {});
    });
    return true;
  }

  if (message.type === "UPDATE_SETTINGS") {
    chrome.storage.local.set({ settings: message.settings }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === "ANALYZE_PRIVACY") {
    analyzePrivacyPolicy(message.text, sender.tab)
      .then(result => sendResponse({ success: true, result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function callGemini(prompt) {
  const response = await fetch(GEMINI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-goog-api-key": GEMINI_API_KEY
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 2048
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

async function analyzePage(pageData, tab) {
  const { url, title, textContent, images, links } = pageData;

  const prompt = `You are a cybersecurity and misinformation detection AI. Analyze the following webpage content and provide a JSON response.

URL: ${url}
Title: ${title}
Content (first 3000 chars): ${textContent?.slice(0, 1500)}
Number of external links: ${links?.length || 0}
Number of images: ${images?.length || 0}

Analyze for:
1. PHISHING: Check for fake login forms, urgent requests for credentials, spoofed domains, misleading URLs, suspicious redirects.
2. MISINFORMATION: Check for false claims, manipulated statistics, missing context, conspiracy theories, health misinformation.
3. DEEPFAKE indicators: Check if content mentions or appears to use AI-generated images/videos without disclosure.
4. PRIVACY concerns: Check if the page collects excessive data, has trackers, or has suspicious data practices.

Respond ONLY with this JSON format (no markdown, no extra text):
{
  "phishing": {
    "detected": true/false,
    "confidence": 0-100,
    "reasons": ["reason1", "reason2"],
    "severity": "low/medium/high/critical"
  },
  "misinfo": {
    "detected": true/false,
    "confidence": 0-100,
    "reasons": ["reason1"],
    "severity": "low/medium/high/critical"
  },
  "deepfake": {
    "detected": true/false,
    "confidence": 0-100,
    "reasons": ["reason1"],
    "severity": "low/medium/high/critical"
  },
  "privacy": {
    "detected": true/false,
    "confidence": 0-100,
    "reasons": ["reason1"],
    "severity": "low/medium/high/critical"
  },
  "overallRisk": "safe/low/medium/high/critical",
  "summary": "One sentence summary of findings"
}`;

  const raw = await callGemini(prompt);
  let result;
  try {
    result = safeParseGemini(raw);
  } catch {
    result = {
      phishing: { detected: false, confidence: 0, reasons: [], severity: "low" },
      misinfo: { detected: false, confidence: 0, reasons: [], severity: "low" },
      deepfake: { detected: false, confidence: 0, reasons: [], severity: "low" },
      privacy: { detected: false, confidence: 0, reasons: [], severity: "low" },
      overallRisk: "safe",
      summary: "Analysis completed."
    };
  }

  await updateStats(result, url, title);

  if (tab?.id) {
    chrome.tabs.sendMessage(tab.id, {
      type: "SCAN_RESULT",
      result,
      url
    }).catch(() => {});
  }

  return result;
}

async function analyzePrivacyPolicy(text, tab) {
  const prompt = `You are a privacy policy expert. Analyze this privacy policy text and provide a clear, human-readable summary.

Privacy Policy Text (first 4000 chars):
${text?.slice(0, 2000)}

Respond ONLY with this JSON format (no markdown):
{
  "grade": "A/B/C/D/F",
  "dataCollected": ["item1", "item2"],
  "dataShared": ["item1"],
  "userRights": ["right1"],
  "redFlags": ["flag1"],
  "positives": ["positive1"],
  "summary": "2-3 sentence plain English summary",
  "score": 0-100
}`;

  const raw = await callGemini(prompt);
  let result;
  try {
    result = safeParseGemini(raw);
  } catch {
    result = {
      grade: "C",
      dataCollected: ["Unable to parse"],
      dataShared: [],
      userRights: [],
      redFlags: [],
      positives: [],
      summary: "Could not fully analyze this policy.",
      score: 50
    };
  }

  chrome.storage.local.get("stats", (data) => {
    const stats = data.stats || {};
    stats.privacyAnalyzed = (stats.privacyAnalyzed || 0) + 1;
    chrome.storage.local.set({ stats });
  });

  return result;
}

async function updateStats(result, url, title) {
  return new Promise((resolve) => {
    chrome.storage.local.get("stats", (data) => {
      const stats = data.stats || {
        phishingBlocked: 0, misinfoFlagged: 0, deepfakesDetected: 0,
        privacyAnalyzed: 0, totalScans: 0, lastScan: null, history: []
      };

      stats.totalScans = (stats.totalScans || 0) + 1;
      stats.lastScan = new Date().toISOString();

      if (result.phishing?.detected) stats.phishingBlocked = (stats.phishingBlocked || 0) + 1;
      if (result.misinfo?.detected) stats.misinfoFlagged = (stats.misinfoFlagged || 0) + 1;
      if (result.deepfake?.detected) stats.deepfakesDetected = (stats.deepfakesDetected || 0) + 1;

      if (!stats.history) stats.history = [];
      stats.history.unshift({
        url: url?.slice(0, 100),
        title: title?.slice(0, 60),
        risk: result.overallRisk,
        summary: result.summary,
        timestamp: new Date().toISOString(),
        flags: {
          phishing: result.phishing?.detected,
          misinfo: result.misinfo?.detected,
          deepfake: result.deepfake?.detected
        }
      });
      if (stats.history.length > 50) stats.history = stats.history.slice(0, 50);

      chrome.storage.local.set({ stats }, resolve);
    });
  });
}