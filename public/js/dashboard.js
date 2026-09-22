(() => {
  const statRow = document.getElementById("statRow");
  const langRadial = document.getElementById("langRadial");
  const catBars = document.getElementById("catBars");
  const sessionRows = document.getElementById("sessionRows");
  const statusDot = document.getElementById("statusDot");
  const statusText = document.getElementById("statusText");

  const LANG_NAMES = { hi: "Hindi", en: "English", ta: "Tamil", te: "Telugu", bn: "Bengali", mr: "Marathi", unknown: "Unclassified" };
  // Native-script labels — the whole reason this product exists is that these
  // scripts aren't an afterthought, so the chart shouldn't render them in
  // Latin transliteration only.
  const LANG_SCRIPT = { hi: "हिंदी", en: "English", ta: "தமிழ்", te: "తెలుగు", bn: "বাংলা", mr: "मराठी", unknown: "—" };
  const RADIAL_COLORS = ["#007f72", "#a65d00", "#2854d9", "#c73832", "#8b4cb8", "#568a2f"];

  function statCard(num, label, tone) {
    const div = document.createElement("div");
    div.className = `stat-card ${tone || ""}`;
    div.innerHTML = `<div class="stat-num">${num}</div><div class="stat-label">${label}</div>`;
    return div;
  }

  function renderStats(s) {
    statRow.innerHTML = "";
    statRow.append(
      statCard(s.activeSessions, "Active sessions"),
      statCard(s.totalQueries, "Queries handled"),
      statCard(s.escalatedSessions, "Escalated", s.escalatedSessions > 0 ? "warn" : ""),
      statCard(s.readyCases, "Cases ready to route", s.readyCases > 0 ? "ready" : ""),
      statCard(`${s.avgLatencyMs}ms`, "Avg round-trip"),
      statCard(s.queueDepth, "Rate-limit queue depth", s.queueDepth > 0 ? "warn" : "")
    );

    statusDot.classList.toggle("mock", !!s.mockMode);
    statusText.textContent = s.mockMode ? "live · mock mode (no API key)" : "live";
  }

  function renderBars(container, counts, nameMap) {
    const entries = Object.entries(counts).filter(([, n]) => n > 0);
    if (entries.length === 0) {
      container.innerHTML = '<p class="empty-note">No queries yet.</p>';
      return;
    }
    const max = Math.max(...entries.map(([, n]) => n));
    container.innerHTML = "";
    entries
      .sort((a, b) => b[1] - a[1])
      .forEach(([key, n]) => {
        const row = document.createElement("div");
        row.className = "bar-row";
        const label = nameMap ? nameMap[key] || key : key;
        row.innerHTML = `
          <span>${label}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${(n / max) * 100}%"></span></span>
          <span>${n}</span>
        `;
        container.appendChild(row);
      });
  }

  function renderLanguageRadial(counts) {
    const entries = Object.entries(counts)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]);

    if (entries.length === 0) {
      langRadial.innerHTML = '<p class="empty-note">No queries yet — send one from the chat page.</p>';
      return;
    }

    const total = entries.reduce((sum, [, n]) => sum + n, 0);
    const r = 42;
    const circumference = 2 * Math.PI * r;

    let offset = 0;
    const arcs = entries
      .map(([lang, n], i) => {
        const portion = (n / total) * circumference;
        const dasharray = `${portion} ${circumference - portion}`;
        const dashoffset = -offset;
        offset += portion;
        const color = RADIAL_COLORS[i % RADIAL_COLORS.length];
        return `<circle cx="60" cy="60" r="${r}" fill="none" stroke="${color}" stroke-width="14"
                  stroke-dasharray="${dasharray}" stroke-dashoffset="${dashoffset}"
                  transform="rotate(-90 60 60)" stroke-linecap="butt"/>`;
      })
      .join("");

    const legend = entries
      .map(([lang, n], i) => {
        const color = RADIAL_COLORS[i % RADIAL_COLORS.length];
        const name = LANG_NAMES[lang] || lang;
        const script = LANG_SCRIPT[lang] || "";
        return `<div class="radial-legend-row">
                  <span class="radial-swatch" style="background:${color}"></span>
                  <span>${name}</span>
                  <span class="radial-script">${script}</span>
                  <span>${n}</span>
                </div>`;
      })
      .join("");

    langRadial.innerHTML = `
      <div class="radial-wrap">
        <svg width="120" height="120" viewBox="0 0 120 120" role="img" aria-label="Query language distribution">
          <circle cx="60" cy="60" r="${r}" fill="none" stroke="#1c2338" stroke-width="14"/>
          ${arcs}
          <text x="60" y="56" text-anchor="middle" fill="var(--text)" class="radial-center-num" font-size="18">${total}</text>
          <text x="60" y="72" text-anchor="middle" fill="var(--text-muted)" font-size="9">queries</text>
        </svg>
        <div class="radial-legend">${legend}</div>
      </div>
    `;
  }

  function timeAgo(ts) {
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s ago`;
    return `${Math.round(s / 60)}m ago`;
  }

  function renderSessions(sessions) {
    if (sessions.length === 0) {
      sessionRows.innerHTML = '<tr><td colspan="7" class="empty-note">No active sessions.</td></tr>';
      return;
    }
    sessionRows.innerHTML = "";
    sessions.forEach((s) => {
      const tr = document.createElement("tr");
      if (s.escalated) tr.className = "escalated";
      tr.innerHTML = `
        <td class="mono">${s.id}</td>
        <td>${LANG_NAMES[s.language] || s.language || "—"}</td>
        <td>${s.turnCount}</td>
        <td>${s.lastCategory || "—"}</td>
        <td><span class="badge badge-${s.lastSentiment || "neutral"}">${s.lastSentiment || "—"}</span></td>
          <td>${s.caseStatus === "ready-for-routing" ? '<span class="badge badge-low">ready to route</span>' : '<span class="badge badge-warn">needs info</span>'}</td>
        <td>${timeAgo(s.lastActivity)}</td>
      `;
      sessionRows.appendChild(tr);
    });
  }

  async function refresh() {
    try {
      const [stats, sessions] = await Promise.all([
        fetch("/api/stats").then((r) => r.json()),
        fetch("/api/sessions").then((r) => r.json()),
      ]);
      renderStats(stats);
      renderLanguageRadial(stats.byLanguage);
      renderBars(catBars, stats.byCategory);
      renderSessions(sessions);
    } catch {
      statusText.textContent = "disconnected — retrying…";
    }
  }

  refresh();
  setInterval(refresh, 3000);
})();
