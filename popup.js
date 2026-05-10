const GEMINI_API_KEY = "";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent";

let currentResult = null;
let isScanning = false;

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


const riskBadge = document.getElementById("riskBadge");
const scanSummary = document.getElementById("scanSummary");
const scanBtn = document.getElementById("scanBtn");

const THREATS = ["phishing", "misinfo", "deepfake", "privacy"];

function setScanning() {
  riskBadge.className = "risk-badge risk-scanning";
  riskBadge.innerHTML = '<span class="spinner"></span> Scanning…';
  scanSummary.textContent = "Analyzing page content with Gemini AI…";
  scanBtn.disabled = true;
  isScanning = true;
}

function setResult(result) {
  isScanning = false;
  scanBtn.disabled = false;
  currentResult = result;

  const risk = result.overallRisk || "safe";
  const riskLabels = { safe: "✅ Safe", low: "🟢 Low Risk", medium: "⚠️ Medium Risk", high: "🔴 High Risk", critical: "🚨 Critical" };
  riskBadge.className = `risk-badge risk-${risk}`;
  riskBadge.textContent = riskLabels[risk] || "✅ Safe";
  scanSummary.textContent = result.summary || "Scan complete.";

  const keyMap = { phishing: "phishing", misinfo: "misinfo", deepfake: "deepfake", privacy: "privacy" };

  THREATS.forEach(key => {
    const data = result[key] || {};
    const detected = data.detected;
    const conf = data.confidence || 0;
    const severity = data.severity || "low";

    const card = document.getElementById(`card-${key}`);
    const st = document.getElementById(`st-${key}`);
    const confEl = document.getElementById(`conf-${key}`);
    const bar = document.getElementById(`bar-${key}`);

    card.className = `threat-card ${detected ? "flagged" : "ok"}`;

    if (detected) {
      st.textContent = severity.toUpperCase();
      st.style.color = severity === "critical" ? "#ff3b5c" : severity === "high" ? "#ff6b6b" : "#ff9500";
      bar.style.background = severity === "critical" || severity === "high" ? "var(--red)" : "var(--orange)";
    } else {
      st.textContent = "CLEAR";
      st.style.color = "var(--green)";
      bar.style.background = "var(--green)";
    }

    confEl.textContent = `${conf}% confidence`;
    bar.style.width = `${conf}%`;
  });
}

function setError(msg) {
  isScanning = false;
  scanBtn.disabled = false;
  riskBadge.className = "risk-badge risk-medium";
  riskBadge.textContent = "⚠️ Error";
  scanSummary.textContent = msg || "Could not analyze this page.";
}

async function runScan() {
  if (isScanning) return;
  setScanning();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) { setError("No active tab found."); return; }

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"]
    }).catch(() => {});

    const [{ result: pageData }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const textNodes = [];
        const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT, null);
        let node, charCount = 0;
        while ((node = walker.nextNode()) && charCount < 5000) {
          const t = node.textContent.trim();
          if (t.length > 20) { textNodes.push(t); charCount += t.length; }
        }
        return {
          url: location.href,
          title: document.title,
          textContent: textNodes.join(" ").slice(0, 1500),
          linkCount: document.querySelectorAll("a[href]").length,
          imageCount: document.querySelectorAll("img").length
        };
      }
    });

    if (!pageData || !pageData.textContent || pageData.textContent.length < 50) {
      setError("Not enough content to analyze on this page.");
      return;
    }

    const prompt = `You are a cybersecurity and misinformation detection AI. Analyze the following webpage content.

URL: ${pageData.url}
Title: ${pageData.title}
Content: ${pageData.textContent}
Links count: ${pageData.linkCount}, Images: ${pageData.imageCount}

Check for: phishing, misinformation, deepfakes, privacy risks.

Respond ONLY with valid JSON (no markdown fences):
{
  "phishing": {"detected": false, "confidence": 0, "reasons": [], "severity": "low"},
  "misinfo": {"detected": false, "confidence": 0, "reasons": [], "severity": "low"},
  "deepfake": {"detected": false, "confidence": 0, "reasons": [], "severity": "low"},
  "privacy": {"detected": false, "confidence": 0, "reasons": [], "severity": "low"},
  "overallRisk": "safe",
  "summary": "Brief summary."
}`;

    const resp = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-goog-api-key": GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2048 }
      })
    });

    if (!resp.ok) throw new Error(`API error ${resp.status}`);
    const data = await resp.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const result = safeParseGemini(raw);

    setResult(result);

    chrome.runtime.sendMessage({ type: "ANALYZE_PAGE", data: pageData }).catch(() => {});

  } catch (err) {
    setError("Analysis failed: " + (err.message || "Unknown error"));
    console.error("[ShieldAI]", err);
  }
}

document.getElementById("privacyBtn").addEventListener("click", async () => {
  const modal = document.getElementById("privacyModal");
  const modalContent = document.getElementById("modalContent");
  const modalTitle = document.getElementById("modalTitle");

  modal.classList.add("active");
  modalTitle.textContent = "Analyzing Privacy Policy…";
  modalContent.innerHTML = `<div style="text-align:center;padding:20px;color:var(--muted)">
    <span class="spinner" style="width:20px;height:20px;border-width:3px;display:inline-block"></span>
    <div style="margin-top:10px;font-size:12px">Reading privacy policy text…</div>
  </div>`;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [{ result: policyText }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.body?.innerText?.slice(0, 2000) || ""
    });

    const prompt = `Analyze this as a privacy policy. Text: ${policyText}

Respond ONLY with valid JSON (no markdown):
{
  "grade": "B",
  "score": 65,
  "dataCollected": ["Email", "Usage data"],
  "dataShared": ["Third-party advertisers"],
  "userRights": ["Right to delete", "Right to access"],
  "redFlags": ["Sells data to third parties"],
  "positives": ["Clear opt-out process"],
  "summary": "Plain English 2-sentence summary."
}`;

    const resp = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-goog-api-key": GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 2048 }
      })
    });
    const data = await resp.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const r = safeParseGemini(raw);

    modalTitle.innerHTML = `Privacy Policy: <span class="grade-badge grade-${r.grade}">${r.grade}</span>`;

    const redFlagHtml = (r.redFlags || []).map(f => `<div class="policy-item"><span style="color:var(--red)">✗</span>${f}</div>`).join("") || '<div class="policy-item" style="color:var(--muted)">None found</div>';
    const positiveHtml = (r.positives || []).map(p => `<div class="policy-item"><span style="color:var(--green)">✓</span>${p}</div>`).join("") || '<div class="policy-item" style="color:var(--muted)">None found</div>';
    const dataHtml = (r.dataCollected || []).map(d => `<div class="policy-item"><span>•</span>${d}</div>`).join("");
    const sharedHtml = (r.dataShared || []).map(d => `<div class="policy-item"><span style="color:var(--orange)">→</span>${d}</div>`).join("") || '<div class="policy-item" style="color:var(--muted)">Not specified</div>';
    const rightsHtml = (r.userRights || []).map(d => `<div class="policy-item"><span style="color:var(--accent)">◆</span>${d}</div>`).join("") || '<div class="policy-item" style="color:var(--muted)">Not specified</div>';

    modalContent.innerHTML = `
      <div style="background:var(--surface2);border-radius:8px;padding:10px;margin-bottom:10px;font-size:11px;line-height:1.5;color:var(--muted)">
        ${r.summary}
      </div>
      <div class="policy-section">
        <div class="policy-section-label">⚠️ Red Flags</div>${redFlagHtml}
      </div>
      <div class="policy-section">
        <div class="policy-section-label">✅ Positives</div>${positiveHtml}
      </div>
      <div class="policy-section">
        <div class="policy-section-label">📦 Data Collected</div>${dataHtml}
      </div>
      <div class="policy-section">
        <div class="policy-section-label">🤝 Data Shared With</div>${sharedHtml}
      </div>
      <div class="policy-section">
        <div class="policy-section-label">⚖️ Your Rights</div>${rightsHtml}
      </div>
    `;

    chrome.storage.local.get("stats", (data) => {
      const s = data.stats || {};
      s.privacyAnalyzed = (s.privacyAnalyzed || 0) + 1;
      chrome.storage.local.set({ stats: s });
    });

  } catch (err) {
    modalContent.innerHTML = `<div style="color:var(--red);font-size:12px;padding:10px">Could not analyze: ${err.message}</div>`;
  }
});

scanBtn.addEventListener("click", runScan);
runScan();