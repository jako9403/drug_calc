/* Drug Half-Life Calculator — front-end logic */

(() => {
  "use strict";

  // DOM refs
  const drugSelect  = document.getElementById("drug-select");
  const drugInfo    = document.getElementById("drug-info");
  const drugCategory    = document.getElementById("drug-category");
  const drugHalflife    = document.getElementById("drug-halflife");
  const drugTypicalDose = document.getElementById("drug-typical-dose");
  const drugMaxDaily    = document.getElementById("drug-max-daily");
  const drugNotes       = document.getElementById("drug-notes");
  const doseInput   = document.getElementById("dose-input");
  const hoursInput  = document.getElementById("hours-input");
  const calcBtn     = document.getElementById("calculate-btn");
  const placeholder = document.getElementById("chart-placeholder");
  const statsDiv    = document.getElementById("stats");

  let drugs = {};   // keyed by slug
  let chart = null; // Chart.js instance

  // ── Initialise ────────────────────────────────────────────────

  fetch("/api/drugs")
    .then(r => r.json())
    .then(data => {
      drugs = data;
      drugSelect.innerHTML = '<option value="" disabled selected>Choose a drug…</option>';
      for (const [key, d] of Object.entries(data)) {
        const opt = document.createElement("option");
        opt.value = key;
        opt.textContent = d.name;
        drugSelect.appendChild(opt);
      }
    });

  // ── Event listeners ───────────────────────────────────────────

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
    hoursInput.placeholder = "Auto (" + (d.half_life_hr * 6).toFixed(1) + " h)";
    calcBtn.disabled = false;
  });

  calcBtn.addEventListener("click", calculate);

  // Also calculate on Enter inside inputs
  doseInput.addEventListener("keydown",  e => { if (e.key === "Enter") calculate(); });
  hoursInput.addEventListener("keydown", e => { if (e.key === "Enter") calculate(); });

  // ── Calculation ───────────────────────────────────────────────

  async function calculate() {
    const drugKey = drugSelect.value;
    if (!drugKey) return;

    calcBtn.disabled = true;
    calcBtn.textContent = "Calculating…";

    const payload = { drug: drugKey };
    const doseVal = parseFloat(doseInput.value);
    const hoursVal = parseFloat(hoursInput.value);
    if (doseVal > 0) payload.dose_mg = doseVal;
    if (hoursVal > 0) payload.hours = hoursVal;

    try {
      const res = await fetch("/api/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.error) { alert(data.error); return; }
      renderChart(data);
      renderStats(data);
    } catch (err) {
      console.error(err);
      alert("Calculation failed — see console for details.");
    } finally {
      calcBtn.disabled = false;
      calcBtn.textContent = "Calculate";
    }
  }

  // ── Chart rendering ───────────────────────────────────────────

  function renderChart(data) {
    placeholder.classList.add("hidden");

    const labels = data.curve.map(p => p.t);
    const values = data.curve.map(p => p.concentration);

    // Half-life annotation points
    const halfLifeHr = data.half_life_hr;
    const dose = data.initial_dose_mg;
    const annotations = [];
    let n = 1;
    while (halfLifeHr * n <= data.total_hours) {
      annotations.push({ t: halfLifeHr * n, c: dose * Math.pow(0.5, n) });
      n++;
    }

    if (chart) chart.destroy();

    const ctx = document.getElementById("decay-chart").getContext("2d");

    // Gradient fill
    const gradient = ctx.createLinearGradient(0, 0, 0, 360);
    gradient.addColorStop(0, "rgba(79,110,247,0.25)");
    gradient.addColorStop(1, "rgba(79,110,247,0.01)");

    chart = new Chart(ctx, {
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
    // Time to 25 %: C₀×0.25 = C₀×0.5^(t/hl) → t = 2×hl
    document.getElementById("stat-quarter").textContent  = formatHours(hl * 2);
    // Time to 10 %: 0.1 = 0.5^(t/hl) → t = hl × log2(10)
    document.getElementById("stat-ten").textContent      = formatHours(hl * Math.log2(10));

    statsDiv.classList.remove("hidden");
  }

  // ── Helpers ───────────────────────────────────────────────────

  function formatHours(h) {
    if (h < 1) return (h * 60).toFixed(0) + " min";
    if (h % 1 === 0) return h + " h";
    return h.toFixed(1) + " h";
  }
})();
