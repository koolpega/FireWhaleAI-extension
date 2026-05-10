function loadStats() {
  chrome.storage.local.get(["stats", "settings"], (data) => {
    const stats = data.stats || {};
    const settings = data.settings || {};

    animateNum("statPhishing", stats.phishingBlocked || 0);
    animateNum("statMisinfo", stats.misinfoFlagged || 0);
    animateNum("statDeepfake", stats.deepfakesDetected || 0);
    animateNum("statPrivacy", stats.privacyAnalyzed || 0);

    const total = stats.totalScans || 0;
    document.getElementById("ringNum").textContent = total;
    const maxRing = Math.max(total, 10);
    const circ = 327;
    const offset = circ - (circ * Math.min(total / maxRing, 1));
    document.getElementById("ringFill").style.strokeDashoffset = offset;

    const ls = stats.lastScan ? new Date(stats.lastScan) : null;
    document.getElementById("lastScan").textContent = ls
      ? `Last scan: ${ls.toLocaleDateString()} at ${ls.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      : "No scans yet. Browse the web and ShieldAI will protect you.";

    const threats = (stats.phishingBlocked || 0) + (stats.misinfoFlagged || 0) + (stats.deepfakesDetected || 0);
    const rate = total > 0 ? Math.round((threats / total) * 100) : 0;
    const displayRate = total > 0 ? Math.max(100 - rate, 0) : 0;
    document.getElementById("prFill").style.width = `${100 - rate}%`;
    document.getElementById("prPct").textContent = total > 0 ? `${100 - rate}% safe pages` : "—";

    renderChart(stats.history || []);

    renderHistory(stats.history || []);

    applySettings(settings);
  });
}

function animateNum(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  let current = 0;
  const duration = 800;
  const step = target / (duration / 16);
  const interval = setInterval(() => {
    current = Math.min(current + step, target);
    el.textContent = Math.round(current);
    if (current >= target) clearInterval(interval);
  }, 16);
}

function renderChart(history) {
  const wrap = document.getElementById("chartWrap");
  const recent = history.slice(0, 7).reverse();

  if (recent.length === 0) {
    wrap.innerHTML = `<div style="width:100%;text-align:center;color:var(--muted);font-size:12px;padding:40px 0">No data yet — scan some pages!</div>`;
    return;
  }

  const maxH = 110;
  wrap.innerHTML = "";

  recent.forEach((item, i) => {
    const ph = item.flags?.phishing ? 1 : 0;
    const mi = item.flags?.misinfo ? 1 : 0;
    const df = item.flags?.deepfake ? 1 : 0;
    const any = ph || mi || df;

    const group = document.createElement("div");
    group.className = "chart-bar-group";

    const bars = document.createElement("div");
    bars.className = "chart-bars";

    const makeBar = (val, cls, color) => {
      const b = document.createElement("div");
      b.className = `chart-bar ${cls}`;
      const h = val ? Math.floor(maxH * 0.7 + Math.random() * maxH * 0.3) : Math.floor(Math.random() * 20 + 4);
      b.style.height = "0px";
      b.style.background = val ? color : "var(--surface3)";
      b.title = cls;
      setTimeout(() => { b.style.height = h + "px"; }, i * 80 + 100);
      return b;
    };

    bars.appendChild(makeBar(ph, "ph", "var(--red)"));
    bars.appendChild(makeBar(mi, "mi", "var(--orange)"));
    bars.appendChild(makeBar(df, "df", "#a78bfa)"));

    const label = document.createElement("div");
    label.className = "chart-label";
    const d = new Date(item.timestamp);
    label.textContent = `${d.getMonth()+1}/${d.getDate()}`;

    group.appendChild(bars);
    group.appendChild(label);
    wrap.appendChild(group);
  });
}

function renderHistory(history) {
  const list = document.getElementById("historyList");
  const countEl = document.getElementById("historyCount");

  countEl.textContent = `${history.length} entries`;

  if (history.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <div class="em-icon">🔍</div>
      <div class="em-text">No scan history yet.<br>Browse the web and ShieldAI will analyze pages automatically.</div>
    </div>`;
    return;
  }

  list.innerHTML = "";

  history.forEach(item => {
    const el = document.createElement("div");
    el.className = "history-item";

    const riskClass = `risk-${item.risk || "safe"}`;
    const timeStr = item.timestamp ? new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";

    const flags = [];
    if (item.flags?.phishing) flags.push(`<span class="flag-chip fc-phishing">PHISH</span>`);
    if (item.flags?.misinfo) flags.push(`<span class="flag-chip fc-misinfo">MISINFO</span>`);
    if (item.flags?.deepfake) flags.push(`<span class="flag-chip fc-deepfake">FAKE</span>`);

    el.innerHTML = `
      <div class="hi-risk ${riskClass}"></div>
      <div class="hi-content">
        <div class="hi-title">${escapeHtml(item.title || "Untitled Page")}</div>
        <div class="hi-url">${escapeHtml(item.url || "")}</div>
      </div>
      <div class="hi-flags">${flags.join("")}</div>
      <div class="hi-time">${timeStr}</div>
    `;

    list.appendChild(el);
  });
}

function escapeHtml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function applySettings(settings) {
  const map = {
    "tog-autoScan": "autoScan",
    "tog-phishing": "phishing",
    "tog-misinfo": "misinfo",
    "tog-deepfake": "deepfake",
    "tog-privacy": "privacy"
  };
  Object.entries(map).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el) el.checked = settings[key] !== false;
  });
}

function saveSettings() {
  const settings = {
    autoScan: document.getElementById("tog-autoScan")?.checked ?? true,
    phishing: document.getElementById("tog-phishing")?.checked ?? true,
    misinfo: document.getElementById("tog-misinfo")?.checked ?? true,
    deepfake: document.getElementById("tog-deepfake")?.checked ?? true,
    privacy: document.getElementById("tog-privacy")?.checked ?? false
  };
  chrome.storage.local.set({ settings });
}

["tog-autoScan", "tog-phishing", "tog-misinfo", "tog-deepfake", "tog-privacy"].forEach(id => {
  document.getElementById(id)?.addEventListener("change", saveSettings);
});

document.getElementById("clearHistoryBtn")?.addEventListener("click", () => {
  if (confirm("Clear all scan history? This cannot be undone.")) {
    chrome.storage.local.get("stats", (data) => {
      const stats = data.stats || {};
      stats.history = [];
      chrome.storage.local.set({ stats }, loadStats);
    });
  }
});

loadStats();
setInterval(loadStats, 5000);