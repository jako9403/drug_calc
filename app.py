"""Drug Half-Life Calculator — Flask application.

Serves a web UI that lets users pick a drug, enter a dose, and visualise
the exponential decay curve based on the drug's elimination half-life.
"""

from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

# ---------------------------------------------------------------------------
# Drug database
#
# Each entry stores pharmacokinetic data sourced from standard references
# (Goodman & Gilman, DrugBank, FDA labels).  Half-life values represent
# typical adult elimination half-lives under normal hepatic/renal function.
# ---------------------------------------------------------------------------

DRUGS: dict[str, dict] = {
    "acetaminophen": {
        "name": "Acetaminophen (Paracetamol)",
        "half_life_hr": 2.5,
        "typical_dose_mg": 500,
        "max_daily_mg": 4000,
        "category": "Analgesic / Antipyretic",
        "notes": "Half-life may increase to 4+ hours in hepatic impairment.",
    },
    "caffeine": {
        "name": "Caffeine",
        "half_life_hr": 5.0,
        "typical_dose_mg": 100,
        "max_daily_mg": 400,
        "category": "Stimulant",
        "notes": "Half-life ranges 3-7 h; longer in neonates and pregnancy.",
    },
    "ibuprofen": {
        "name": "Ibuprofen",
        "half_life_hr": 2.0,
        "typical_dose_mg": 400,
        "max_daily_mg": 3200,
        "category": "NSAID",
        "notes": "Rapid absorption; peak plasma at ~1-2 h.",
    },
    "aspirin": {
        "name": "Aspirin (Acetylsalicylic Acid)",
        "half_life_hr": 3.5,
        "typical_dose_mg": 500,
        "max_daily_mg": 4000,
        "category": "NSAID / Antiplatelet",
        "notes": "Parent compound t½ ~15-20 min; salicylate t½ ~3.5 h.",
    },
    "amoxicillin": {
        "name": "Amoxicillin",
        "half_life_hr": 1.0,
        "typical_dose_mg": 500,
        "max_daily_mg": 3000,
        "category": "Antibiotic (Penicillin)",
        "notes": "Half-life prolonged in renal impairment.",
    },
    "loratadine": {
        "name": "Loratadine (Claritin)",
        "half_life_hr": 8.0,
        "typical_dose_mg": 10,
        "max_daily_mg": 10,
        "category": "Antihistamine",
        "notes": "Active metabolite desloratadine t½ ~28 h.",
    },
    "diphenhydramine": {
        "name": "Diphenhydramine (Benadryl)",
        "half_life_hr": 4.5,
        "typical_dose_mg": 25,
        "max_daily_mg": 300,
        "category": "Antihistamine",
        "notes": "Sedating first-generation antihistamine.",
    },
    "metformin": {
        "name": "Metformin",
        "half_life_hr": 5.0,
        "typical_dose_mg": 500,
        "max_daily_mg": 2550,
        "category": "Antidiabetic",
        "notes": "Eliminated renally; t½ increases in renal impairment.",
    },
    "omeprazole": {
        "name": "Omeprazole (Prilosec)",
        "half_life_hr": 1.0,
        "typical_dose_mg": 20,
        "max_daily_mg": 40,
        "category": "Proton Pump Inhibitor",
        "notes": "Short plasma t½ but prolonged pharmacodynamic effect.",
    },
    "melatonin": {
        "name": "Melatonin",
        "half_life_hr": 0.75,
        "typical_dose_mg": 3,
        "max_daily_mg": 10,
        "category": "Supplement / Sleep Aid",
        "notes": "Rapid first-pass metabolism; t½ ~40-50 min.",
    },
    "diazepam": {
        "name": "Diazepam (Valium)",
        "half_life_hr": 40.0,
        "typical_dose_mg": 5,
        "max_daily_mg": 40,
        "category": "Benzodiazepine",
        "notes": "Active metabolite desmethyldiazepam t½ up to 100 h.",
    },
    "sertraline": {
        "name": "Sertraline (Zoloft)",
        "half_life_hr": 26.0,
        "typical_dose_mg": 50,
        "max_daily_mg": 200,
        "category": "SSRI Antidepressant",
        "notes": "Steady state reached in ~1 week.",
    },
}


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.route("/")
def index():
    """Render the main calculator page."""
    return render_template("index.html")


@app.route("/api/drugs")
def get_drugs():
    """Return the full drug catalogue as JSON."""
    return jsonify(
        {
            key: {
                "name": d["name"],
                "half_life_hr": d["half_life_hr"],
                "typical_dose_mg": d["typical_dose_mg"],
                "max_daily_mg": d["max_daily_mg"],
                "category": d["category"],
                "notes": d["notes"],
            }
            for key, d in sorted(DRUGS.items(), key=lambda x: x[1]["name"])
        }
    )


@app.route("/api/calculate", methods=["POST"])
def calculate():
    """Calculate the decay curve for a given drug and dose.

    Expects JSON: {"drug": "<key>", "dose_mg": <number>, "hours": <number>}
    Returns JSON with an array of {t, concentration} points.
    """
    data = request.get_json(silent=True) or {}
    drug_key = data.get("drug", "")
    dose_mg = data.get("dose_mg")
    hours = data.get("hours")

    if drug_key not in DRUGS:
        return jsonify({"error": f"Unknown drug: {drug_key}"}), 400

    drug = DRUGS[drug_key]
    half_life = drug["half_life_hr"]

    if dose_mg is None or dose_mg <= 0:
        dose_mg = drug["typical_dose_mg"]
    if hours is None or hours <= 0:
        # Default to 6 half-lives (< 2 % remaining)
        hours = half_life * 6

    # Generate decay curve: C(t) = C₀ × (½)^(t / t½)
    num_points = 200
    step = hours / num_points
    curve = []
    for i in range(num_points + 1):
        t = round(i * step, 4)
        concentration = round(dose_mg * (0.5 ** (t / half_life)), 4)
        curve.append({"t": t, "concentration": concentration})

    return jsonify(
        {
            "drug": drug["name"],
            "half_life_hr": half_life,
            "initial_dose_mg": dose_mg,
            "total_hours": hours,
            "curve": curve,
        }
    )


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
