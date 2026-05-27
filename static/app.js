/* Drug Half-Life Calculator — front-end logic v2 */

(() => {
  "use strict";

  // ── Colour palette for multi-drug timeline ────────────────────
  const COLORS = [
    { line: "#4f6ef7", bg: "rgba(79,110,247,0.15)"  },
    { line: "#e74694", bg: "rgba(231,70,148,0.15)"   },
    { line: "#f59e0b", bg: "rgba(245,158,11,0.15)"   },
    { line: "#10b981", bg: "rgba(16,185,129,0.15)"    },
    { line: "#8b5cf6", bg: "rgba(139,92,246,0.15)"    },
    { line: "#ef4444", bg: "rgba(239,68,68,0.15)"     },
    { line: "#06b6d4", bg: "rgba(6,182,212,0.15)"     },
    { line: "#f97316", bg: "rgba(249,115,22,0.15)"    },
  ];

  // ── DOM refs ──────────────────────────────────────────────────
  const drugSearch  = document.getElementById("drug-search");
  const drugSelect  = document.getElementById("drug-select");
  const drugInfo    = document.getElementById("drug-info");
  const drugCategory    = document.getElementById("drug-category");
  const drugHalflife    = document.getElementById("drug-halflife");
  const drugTypicalDose = document.getElementById("drug-typical-dose");
  const drugMaxDaily    = document.getElementById("drug-max-daily");
  const drugNotes       = document.getElementById("drug-notes");
  const doseInput   = document.getElementById("dose-input");
  const calcBtn     = document.getElementById("calculate-btn");
  const takeDoseBtn = document.getElementById("take-dose-btn");
  const placeholder = document.getElementById("chart-placeholder");
  const statsDiv    = document.getElementById("stats");
  const timelinePlaceholder = document.getElementById("timeline-placeholder");
  const legendDiv   = document.getElementById("legend");
  const doseLogBody = document.getElementById("dose-log-body");
  const doseLogEmpty    = document.getElementById("dose-log-empty");
  const doseTableWrap   = document.getElementById("dose-table-wrap");
  const clearLogBtn     = document.getElementById("clear-log-btn");

  let drugs = {};           // keyed by slug
  let decayChart = null;    // single-drug Chart.js instance
  let timelineChart = null; // 24-h Chart.js instance
  let doseLog = [];         // [{id, drugKey, drugName, dose_mg, half_life_hr, takenAt, color}]
  let colorIndex = 0;
  let timerInterval = null;

  // ── Initialise ────────────────────────────────────────────────

  fetch("/api/drugs")
    .then(r => r.json())
    .then(data => {
      drugs = data;
      populateSelect("");
    });

  // ── Search filtering ──────────────────────────────────────────

  function populateSelect(filter) {
    const lc = filter.toLowerCase();
    drugSelect.innerHTML = '<option value="" disabled selected>Choose a drug…</option>';
    for (const [key, d] of Object.entries(drugs)) {
      if (lc && !d.name.toLowerCase().includes(lc) && !key.includes(lc) && !d.category.toLowerCase().includes(lc)) continue;
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = d.name;
      drugSelect.appendChild(opt);
    }
  }

  drugSearch.addEventListener("input", () => {
    populateSelect(drugSearch.value.trim());
    // Auto-select if exactly one match
    const opts = drugSelect.querySelectorAll("option:not([disabled])");
    if (opts.length === 1) {
      drugSelect.value = opts[0].value;
      drugSelect.dispatchEvent(new Event("change"));
    }
  });

  // ── Drug select ───────────────────────────────────────────────

  drugSelect.addEventListener("change", () => {
    const d = drugs[drugSelect.value];
    if (!d) return;

    drugCategory.textContent    = d.category;
    drugHalflife.textContent    = formatHours(d.half_life_hr);
    drugTypicalDose.textContent = d.typical_dose_mg + " mg";
    drugMaxDaily.textContent    = d.max_daily_mg + " mg";
    drugNotes.textContent       = d.notes;
    drugInfo.classList.remove("hidden");

    doseInput.placeholder = d.typical_dose_mg + " mg (typical)";
    calcBtn.disabled = false;
    takeDoseBtn.disabled = false;
  });

  // ── Calculate (single drug) ───────────────────────────────────

  calcBtn.addEventListener("click", calculate);
  doseInput.addEventListener("keydown", e => { if (e.key === "Enter") calculate(); });

  async function calculate() {
    const drugKey = drugSelect.value;
    if (!drugKey) return;

    calcBtn.disabled = true;
    calcBtn.textContent = "Calculating…";

    const payload = { drug: drugKey };
    const doseVal = parseFloat(doseInput.value);
    if (doseVal > 0) payload.dose_mg = doseVal;

    try {
      const res = await fetch("/api/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.error) { alert(data.error); return; }
      renderDecayChart(data);
      renderStats(data);
    } catch (err) {
      console.error(err);
      alert("Calculation failed — see console for details.");
    } finally {
      calcBtn.disabled = false;
      calcBtn.textContent = "Calculate";
    }
  }

  // ── Take Dose Now ─────────────────────────────────────────────

  takeDoseBtn.addEventListener("click", () => {
    const drugKey = drugSelect.value;
    if (!drugKey) return;
    const d = drugs[drugKey];
    const doseVal = parseFloat(doseInput.value) || d.typical_dose_mg;

    const color = COLORS[colorIndex % COLORS.length];
    colorIndex++;

    doseLog.push({
      id: Date.now() + Math.random(),
      drugKey,
      drugName: d.name,
      dose_mg: doseVal,
      half_life_hr: d.half_life_hr,
      category: d.category,
      takenAt: new Date(),
      color,
    });

    renderDoseTable();
    renderTimeline();
    startTimer();
  });

  // ── Clear log ─────────────────────────────────────────────────

  clearLogBtn.addEventListener("click", () => {
    doseLog = [];
    colorIndex = 0;
    renderDoseTable();
    renderTimeline();
  });

  // ── Timer — updates elapsed & remaining every second ──────────

  function startTimer() {
    if (timerInterval) return;
    timerInterval = setInterval(() => {
      if (doseLog.length === 0) { clearInterval(timerInterval); timerInterval = null; return; }
      renderDoseTable();
      renderTimeline();
    }, 1000);
  }

  // ── Dose table rendering ──────────────────────────────────────

  function renderDoseTable() {
    if (doseLog.length === 0) {
      doseLogEmpty.classList.remove("hidden");
      doseTableWrap.classList.add("hidden");
      clearLogBtn.classList.add("hidden");
      return;
    }
    doseLogEmpty.classList.add("hidden");
    doseTableWrap.classList.remove("hidden");
    clearLogBtn.classList.remove("hidden");

    const now = new Date();
    doseLogBody.innerHTML = "";

    for (const entry of doseLog) {
      const elapsed_ms = now - entry.takenAt;
      const elapsed_hr = elapsed_ms / 3600000;
      const remaining = entry.dose_mg * Math.pow(0.5, elapsed_hr / entry.half_life_hr);
      const pct = (remaining / entry.dose_mg) * 100;

      const tr = document.createElement("tr");
      tr.innerHTML =
        `<td><span class="color-dot" style="background:${entry.color.line}"></span>${entry.drugName}</td>` +
        `<td>${entry.dose_mg} mg</td>` +
        `<td>${formatTime(entry.takenAt)}</td>` +
        `<td class="mono">${formatElapsed(elapsed_ms)}</td>` +
        `<td>${formatHours(entry.half_life_hr)}</td>` +
        `<td class="mono">${remaining.toFixed(1)} mg</td>` +
        `<td><span class="pct-badge ${pct < 10 ? "pct-low" : pct < 50 ? "pct-mid" : "pct-high"}">${pct.toFixed(1)}%</span></td>` +
        `<td><button class="btn-icon" data-id="${entry.id}" title="Remove">×</button></td>`;
      doseLogBody.appendChild(tr);
    }

    // Remove buttons
    doseLogBody.querySelectorAll(".btn-icon").forEach(btn => {
      btn.addEventListener("click", () => {
        doseLog = doseLog.filter(e => e.id !== +btn.dataset.id);
        renderDoseTable();
        renderTimeline();
      });
    });
  }

  // ── 24-hour timeline chart ────────────────────────────────────

  function renderTimeline() {
    if (doseLog.length === 0) {
      timelinePlaceholder.classList.remove("hidden");
      legendDiv.innerHTML = "";
      if (timelineChart) { timelineChart.destroy(); timelineChart = null; }
      return;
    }
    timelinePlaceholder.classList.add("hidden");

    const now = new Date();
    // Window: earliest dose → earliest dose + 24h, but at least until now
    const earliestTaken = new Date(Math.min(...doseLog.map(e => e.takenAt.getTime())));
    const windowStart = earliestTaken;
    const windowEndMin = new Date(earliestTaken.getTime() + 24 * 3600000);
    const windowEnd = windowEndMin > now ? windowEndMin : new Date(now.getTime() + 2 * 3600000);
    const totalHours = (windowEnd - windowStart) / 3600000;

    const numPoints = 300;
    const step = totalHours / numPoints;

    // Build one dataset per dose entry
    const datasets = [];
    for (const entry of doseLog) {
      const offsetHr = (entry.takenAt - windowStart) / 3600000;
      const points = [];
      for (let i = 0; i <= numPoints; i++) {
        const t = i * step;
        const sinceEntry = t - offsetHr;
        const conc = sinceEntry < 0 ? 0 : entry.dose_mg * Math.pow(0.5, sinceEntry / entry.half_life_hr);
        points.push({ x: t, y: Math.round(conc * 100) / 100 });
      }

      datasets.push({
        label: entry.drugName + " (" + entry.dose_mg + " mg)",
        data: points,
        borderColor: entry.color.line,
        backgroundColor: entry.color.bg,
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        pointHitRadius: 6,
        borderWidth: 2,
      });
    }

    // Now-line as a vertical annotation via a scatter point
    const nowHr = (now - windowStart) / 3600000;

    if (timelineChart) timelineChart.destroy();

    const ctx = document.getElementById("timeline-chart").getContext("2d");
    timelineChart = new Chart(ctx, {
      type: "line",
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#1a1d24",
            titleFont: { family: "'Inter', sans-serif", size: 13 },
            bodyFont:  { family: "'Inter', sans-serif", size: 12 },
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              title: (items) => {
                const hrs = +items[0].parsed.x;
                const d = new Date(windowStart.getTime() + hrs * 3600000);
                return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
              },
              label: (item) => item.dataset.label + ": " + item.parsed.y.toFixed(1) + " mg",
            },
          },
          // Custom "now" line plugin
          nowLine: { nowHr },
        },
        scales: {
          x: {
            type: "linear",
            min: 0,
            max: totalHours,
            title: { display: true, text: "Hours from first dose", font: { weight: "600", size: 12 } },
            grid: { color: "rgba(0,0,0,0.04)" },
            ticks: {
              font: { size: 11 },
              callback: (v) => {
                const d = new Date(windowStart.getTime() + v * 3600000);
                return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
              },
              maxTicksLimit: 12,
            },
          },
          y: {
            title: { display: true, text: "Concentration (mg)", font: { weight: "600", size: 12 } },
            beginAtZero: true,
            grid: { color: "rgba(0,0,0,0.04)" },
            ticks: { font: { size: 11 } },
          },
        },
      },
      plugins: [{
        id: "nowLine",
        afterDraw(chart) {
          const nowVal = chart.options.plugins.nowLine?.nowHr;
          if (nowVal == null) return;
          const xAxis = chart.scales.x;
          const yAxis = chart.scales.y;
          const x = xAxis.getPixelForValue(nowVal);
          if (x < xAxis.left || x > xAxis.right) return;
          const ctx = chart.ctx;
          ctx.save();
          ctx.strokeStyle = "#ef4444";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(x, yAxis.top);
          ctx.lineTo(x, yAxis.bottom);
          ctx.stroke();
          // Label
          ctx.fillStyle = "#ef4444";
          ctx.font = "600 11px Inter, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText("NOW", x, yAxis.top - 6);
          ctx.restore();
        }
      }],
    });

    // Legend
    legendDiv.innerHTML = doseLog.map(e =>
      `<span class="legend-item"><span class="legend-dot" style="background:${e.color.line}"></span>${e.drugName}</span>`
    ).join("");
  }

  // ── Single-drug decay chart ───────────────────────────────────

  function renderDecayChart(data) {
    placeholder.classList.add("hidden");

    const labels = data.curve.map(p => p.t);
    const values = data.curve.map(p => p.concentration);

    const halfLifeHr = data.half_life_hr;
    const dose = data.initial_dose_mg;
    const annotations = [];
    let n = 1;
    while (halfLifeHr * n <= data.total_hours) {
      annotations.push({ t: halfLifeHr * n, c: dose * Math.pow(0.5, n) });
      n++;
    }

    if (decayChart) decayChart.destroy();

    const ctx = document.getElementById("decay-chart").getContext("2d");
    const gradient = ctx.createLinearGradient(0, 0, 0, 360);
    gradient.addColorStop(0, "rgba(79,110,247,0.25)");
    gradient.addColorStop(1, "rgba(79,110,247,0.01)");

    decayChart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: data.drug + " (mg)",
            data: values,
            borderColor: "#4f6ef7",
            backgroundColor: gradient,
            fill: true,
            tension: 0.35,
            pointRadius: 0,
            pointHitRadius: 8,
            borderWidth: 2.5,
          },
          {
            label: "Half-life markers",
            data: annotations.map(a => ({ x: a.t, y: a.c })),
            borderColor: "transparent",
            backgroundColor: "#4f6ef7",
            pointRadius: 6,
            pointBorderColor: "#fff",
            pointBorderWidth: 2,
            pointStyle: "circle",
            showLine: false,
            type: "scatter",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#1a1d24",
            titleFont: { family: "'Inter', sans-serif", size: 13 },
            bodyFont:  { family: "'Inter', sans-serif", size: 12 },
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              title: (items) => "t = " + (+items[0].parsed.x).toFixed(2) + " h",
              label: (item) => {
                if (item.datasetIndex === 1) {
                  const idx = Math.round(Math.log2(dose / item.parsed.y));
                  return "½-life #" + idx + ": " + item.parsed.y.toFixed(2) + " mg";
                }
                return item.parsed.y.toFixed(2) + " mg remaining";
              },
            },
          },
        },
        scales: {
          x: {
            type: "linear",
            title: { display: true, text: "Time (hours)", font: { weight: "600", size: 12 } },
            grid: { color: "rgba(0,0,0,0.04)" },
            ticks: { font: { size: 11 } },
          },
          y: {
            title: { display: true, text: "Concentration (mg)", font: { weight: "600", size: 12 } },
            beginAtZero: true,
            grid: { color: "rgba(0,0,0,0.04)" },
            ticks: { font: { size: 11 } },
          },
        },
      },
    });
  }

  // ── Stats ─────────────────────────────────────────────────────

  function renderStats(data) {
    const hl = data.half_life_hr;
    const dose = data.initial_dose_mg;
    document.getElementById("stat-initial").textContent  = dose + " mg";
    document.getElementById("stat-halflife").textContent  = formatHours(hl);
    document.getElementById("stat-quarter").textContent  = formatHours(hl * 2);
    document.getElementById("stat-ten").textContent      = formatHours(hl * Math.log2(10));
    statsDiv.classList.remove("hidden");
  }

  // ── Helpers ───────────────────────────────────────────────────

  function formatHours(h) {
    if (h < 1) return (h * 60).toFixed(0) + " min";
    if (h % 1 === 0) return h + " h";
    return h.toFixed(1) + " h";
  }

  function formatTime(date) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function formatElapsed(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }
})();
