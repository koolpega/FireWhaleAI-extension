(function () {
  if (window.__shieldAILoaded) return;
  window.__shieldAILoaded = true;

  let scanTimeout = null;
  let overlayEl = null;

  function scheduleAutoScan() {
    if (scanTimeout) clearTimeout(scanTimeout);
    scanTimeout = setTimeout(() => {
      chrome.storage.local.get("settings", (data) => {
        const settings = data.settings || {};
        if (settings.autoScan !== false) {
          runScan();
        }
      });
    }, 2500);
  }

  function getPageData() {
    const textNodes = [];
    const walker = document.createTreeWalker(
      document.body || document.documentElement,
      NodeFilter.SHOW_TEXT,
      null
    );
    let node;
    let charCount = 0;
    while ((node = walker.nextNode()) && charCount < 5000) {
      const text = node.textContent.trim();
      if (text.length > 20) {
        textNodes.push(text);
        charCount += text.length;
      }
    }

    const links = Array.from(document.querySelectorAll("a[href]"))
      .map(a => a.href)
      .filter(h => h.startsWith("http"))
      .slice(0, 50);

    const images = Array.from(document.querySelectorAll("img"))
      .map(i => i.src)
      .filter(Boolean)
      .slice(0, 20);

    return {
      url: window.location.href,
      title: document.title,
      textContent: textNodes.join(" ").slice(0, 5000),
      links,
      images
    };
  }

  function runScan() {
    const pageData = getPageData();

    if (!pageData.textContent || pageData.textContent.length < 100) return;
    if (window.location.href === "about:blank" || window.location.href === "chrome://newtab/") return;

    chrome.runtime.sendMessage(
      { type: "ANALYZE_PAGE", data: pageData },
      (response) => {
        // wait for response
      }
    );
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "SCAN_RESULT") {
      handleScanResult(message.result);
    }
    if (message.type === "TRIGGER_SCAN") {
      runScan();
    }
    if (message.type === "ANALYZE_PRIVACY_PAGE") {
      const text = document.body?.innerText || "";
      chrome.runtime.sendMessage({ type: "ANALYZE_PRIVACY", text });
    }
  });

  function handleScanResult(result) {
    if (!result) return;
    const risk = result.overallRisk;
    if (risk === "safe" || risk === "low") return;

    showWarningBanner(result);
  }

  function showWarningBanner(result) {
    if (overlayEl) overlayEl.remove();

    const risk = result.overallRisk;
    const colors = {
      medium: { bg: "#ff9500", text: "#000" },
      high: { bg: "#ff3b30", text: "#fff" },
      critical: { bg: "#8b0000", text: "#fff" }
    };
    const color = colors[risk] || colors.medium;

    const flags = [];
    if (result.phishing?.detected) flags.push("⚠️ Phishing");
    if (result.misinfo?.detected) flags.push("📰 Misinformation");
    if (result.deepfake?.detected) flags.push("🤖 Deepfake");
    if (result.privacy?.detected) flags.push("🔒 Privacy Risk");

    if (flags.length === 0) return;

    const banner = document.createElement("div");
    banner.id = "__shieldai_banner__";
    banner.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 2147483647;
      background: ${color.bg};
      color: ${color.text};
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 13px;
      font-weight: 600;
      padding: 10px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.3);
      animation: __shieldai_slide__ 0.3s ease;
    `;

    const style = document.createElement("style");
    style.textContent = `
      @keyframes __shieldai_slide__ {
        from { transform: translateY(-100%); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);

    banner.innerHTML = `
      <span style="font-size:18px">🛡️</span>
      <span><strong>FireWhale AI detected:</strong> ${flags.join(" · ")}</span>
      <span style="opacity:0.8;font-weight:400;flex:1">${result.summary || ""}</span>
      <button id="__shieldai_close__" style="
        background: rgba(255,255,255,0.25);
        border: none;
        color: inherit;
        padding: 4px 10px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
      ">Dismiss</button>
    `;

    document.body.insertBefore(banner, document.body.firstChild);
    overlayEl = banner;

    document.getElementById("__shieldai_close__")?.addEventListener("click", () => {
      banner.remove();
    });

    if (risk === "medium") {
      setTimeout(() => banner.remove(), 12000);
    }
  }

  if (document.readyState === "complete") {
    scheduleAutoScan();
  } else {
    window.addEventListener("load", scheduleAutoScan);
  }

  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      scheduleAutoScan();
    }
  });
  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: false
  });
})();
