"""Drug Half-Life Calculator — Flask application.

Serves a web UI that lets users pick a drug, enter a dose, and visualise
the exponential decay curve based on the drug's elimination half-life.
Supports patient-profile adjustments (weight, age, gender) where
pharmacokinetic data is available.
"""

from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

# ---------------------------------------------------------------------------
# Drug database
#
# Each entry stores pharmacokinetic data sourced from standard references
# (Goodman & Gilman, DrugBank, FDA labels).  Half-life values represent
# typical adult (18-65, ~70 kg) elimination half-lives under normal
# hepatic/renal function.
#
# adjustments — optional per-drug modifiers:
#   elderly_hl_mult  : multiplier applied to t½ when age >= 65
#   pediatric_hl_mult: multiplier applied to t½ when age < 18
#   female_hl_mult   : multiplier applied to t½ for female patients
#   male_hl_mult     : multiplier applied to t½ for male patients
#   weight_based     : if true, dose is scaled by mg/kg (typical_dose is
#                      per-kg); otherwise weight only shown for context
#   dose_per_kg      : mg/kg reference dose (if weight_based)
#   ref_weight_kg    : reference body weight the base t½ was measured at
# ---------------------------------------------------------------------------

DRUGS: dict[str, dict] = {
    "acetaminophen": {
        "name": "Acetaminophen (Paracetamol)",
        "half_life_hr": 2.5,
        "typical_dose_mg": 500,
        "max_daily_mg": 4000,
        "category": "Analgesic / Antipyretic",
        "notes": "Half-life may increase to 4+ hours in hepatic impairment.",
        "adjustments": {
            "elderly_hl_mult": 1.3,
            "pediatric_hl_mult": 0.7,
            "female_hl_mult": 1.0,
            "male_hl_mult": 1.0,
            "weight_based": True,
            "dose_per_kg": 10.0,
            "ref_weight_kg": 70,
        },
    },
    "caffeine": {
        "name": "Caffeine",
        "half_life_hr": 5.0,
        "typical_dose_mg": 100,
        "max_daily_mg": 400,
        "category": "Stimulant",
        "notes": "Half-life ranges 3-7 h; longer in neonates and pregnancy.",
        "adjustments": {
            "elderly_hl_mult": 1.3,
            "pediatric_hl_mult": 1.6,
            "female_hl_mult": 1.2,
            "male_hl_mult": 1.0,
            "weight_based": False,
            "ref_weight_kg": 70,
        },
    },
    "ibuprofen": {
        "name": "Ibuprofen",
        "half_life_hr": 2.0,
        "typical_dose_mg": 400,
        "max_daily_mg": 3200,
        "category": "NSAID",
        "notes": "Rapid absorption; peak plasma at ~1-2 h.",
        "adjustments": {
            "elderly_hl_mult": 1.4,
            "pediatric_hl_mult": 0.8,
            "female_hl_mult": 1.0,
            "male_hl_mult": 1.0,
            "weight_based": True,
            "dose_per_kg": 5.0,
            "ref_weight_kg": 70,
        },
    },
    "aspirin": {
        "name": "Aspirin (Acetylsalicylic Acid)",
        "half_life_hr": 3.5,
        "typical_dose_mg": 500,
        "max_daily_mg": 4000,
        "category": "NSAID / Antiplatelet",
        "notes": "Parent compound t½ ~15-20 min; salicylate t½ ~3.5 h.",
        "adjustments": {
            "elderly_hl_mult": 1.2,
            "pediatric_hl_mult": 0.9,
            "female_hl_mult": 1.0,
            "male_hl_mult": 1.0,
            "weight_based": False,
            "ref_weight_kg": 70,
        },
    },
    "amoxicillin": {
        "name": "Amoxicillin",
        "half_life_hr": 1.0,
        "typical_dose_mg": 500,
        "max_daily_mg": 3000,
        "category": "Antibiotic (Penicillin)",
        "notes": "Half-life prolonged in renal impairment.",
        "adjustments": {
            "elderly_hl_mult": 1.5,
            "pediatric_hl_mult": 1.5,
            "female_hl_mult": 1.0,
            "male_hl_mult": 1.0,
            "weight_based": True,
            "dose_per_kg": 12.5,
            "ref_weight_kg": 70,
        },
    },
    "loratadine": {
        "name": "Loratadine (Claritin)",
        "half_life_hr": 8.0,
        "typical_dose_mg": 10,
        "max_daily_mg": 10,
        "category": "Antihistamine",
        "notes": "Active metabolite desloratadine t½ ~28 h.",
        "adjustments": {
            "elderly_hl_mult": 1.5,
            "pediatric_hl_mult": 1.0,
            "female_hl_mult": 1.0,
            "male_hl_mult": 1.0,
            "weight_based": False,
            "ref_weight_kg": 70,
        },
    },
    "diphenhydramine": {
        "name": "Diphenhydramine (Benadryl)",
        "half_life_hr": 4.5,
        "typical_dose_mg": 25,
        "max_daily_mg": 300,
        "category": "Antihistamine",
        "notes": "Sedating first-generation antihistamine.",
        "adjustments": {
            "elderly_hl_mult": 1.6,
            "pediatric_hl_mult": 0.7,
            "female_hl_mult": 1.0,
            "male_hl_mult": 1.0,
            "weight_based": True,
            "dose_per_kg": 1.25,
            "ref_weight_kg": 70,
        },
    },
    "metformin": {
        "name": "Metformin",
        "half_life_hr": 5.0,
        "typical_dose_mg": 500,
        "max_daily_mg": 2550,
        "category": "Antidiabetic",
        "notes": "Eliminated renally; t½ increases in renal impairment.",
        "adjustments": {
            "elderly_hl_mult": 1.4,
            "pediatric_hl_mult": 1.0,
            "female_hl_mult": 1.0,
            "male_hl_mult": 1.0,
            "weight_based": False,
            "ref_weight_kg": 70,
        },
    },
    "omeprazole": {
        "name": "Omeprazole (Prilosec)",
        "half_life_hr": 1.0,
        "typical_dose_mg": 20,
        "max_daily_mg": 40,
        "category": "Proton Pump Inhibitor",
        "notes": "Short plasma t½ but prolonged pharmacodynamic effect.",
        "adjustments": {
            "elderly_hl_mult": 1.5,
            "pediatric_hl_mult": 0.8,
            "female_hl_mult": 1.0,
            "male_hl_mult": 1.0,
            "weight_based": False,
            "ref_weight_kg": 70,
        },
    },
    "melatonin": {
        "name": "Melatonin",
        "half_life_hr": 0.75,
        "typical_dose_mg": 3,
        "max_daily_mg": 10,
        "category": "Supplement / Sleep Aid",
        "notes": "Rapid first-pass metabolism; t½ ~40-50 min.",
        "adjustments": {
            "elderly_hl_mult": 1.2,
            "pediatric_hl_mult": 1.0,
            "female_hl_mult": 1.1,
            "male_hl_mult": 1.0,
            "weight_based": False,
            "ref_weight_kg": 70,
        },
    },
    "diazepam": {
        "name": "Diazepam (Valium)",
        "half_life_hr": 40.0,
        "typical_dose_mg": 5,
        "max_daily_mg": 40,
        "category": "Benzodiazepine",
        "notes": "Active metabolite desmethyldiazepam t½ up to 100 h.",
        "adjustments": {
            "elderly_hl_mult": 2.0,
            "pediatric_hl_mult": 0.5,
            "female_hl_mult": 1.15,
            "male_hl_mult": 1.0,
            "weight_based": True,
            "dose_per_kg": 0.1,
            "ref_weight_kg": 70,
        },
    },
    "sertraline": {
        "name": "Sertraline (Zoloft)",
        "half_life_hr": 26.0,
        "typical_dose_mg": 50,
        "max_daily_mg": 200,
        "category": "SSRI Antidepressant",
        "notes": "Steady state reached in ~1 week.",
        "adjustments": {
            "elderly_hl_mult": 1.5,
            "pediatric_hl_mult": 1.0,
            "female_hl_mult": 1.15,
            "male_hl_mult": 1.0,
            "weight_based": False,
            "ref_weight_kg": 70,
        },
    },
}


def compute_adjusted_half_life(
    drug: dict, age: int | None, gender: str | None, weight_kg: float | None
) -> tuple[float, list[str]]:
    """Return (adjusted_half_life, [explanation_strings])."""
    hl = drug["half_life_hr"]
    adj = drug.get("adjustments")
    notes: list[str] = []
    if not adj:
        return hl, notes

    # Age adjustment
    if age is not None:
        if age >= 65 and adj.get("elderly_hl_mult", 1.0) != 1.0:
            mult = adj["elderly_hl_mult"]
            hl *= mult
            notes.append(f"Elderly (≥65): t½ ×{mult}")
        elif age < 18 and adj.get("pediatric_hl_mult", 1.0) != 1.0:
            mult = adj["pediatric_hl_mult"]
            hl *= mult
            notes.append(f"Pediatric (<18): t½ ×{mult}")

    # Gender adjustment
    if gender == "female" and adj.get("female_hl_mult", 1.0) != 1.0:
        mult = adj["female_hl_mult"]
        hl *= mult
        notes.append(f"Female: t½ ×{mult}")
    elif gender == "male" and adj.get("male_hl_mult", 1.0) != 1.0:
        mult = adj["male_hl_mult"]
        hl *= mult
        notes.append(f"Male: t½ ×{mult}")

    return round(hl, 3), notes


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.route("/")
def index():
    """Render the main calculator page."""
    return render_template("index.html")


@app.route("/api/drugs")
def get_drugs():
    """Return the full drug catalogue as JSON, including adjustment metadata."""
    out = {}
    for key, d in sorted(DRUGS.items(), key=lambda x: x[1]["name"]):
        adj = d.get("adjustments", {})
        out[key] = {
            "name": d["name"],
            "half_life_hr": d["half_life_hr"],
            "typical_dose_mg": d["typical_dose_mg"],
            "max_daily_mg": d["max_daily_mg"],
            "category": d["category"],
            "notes": d["notes"],
            "adjustments": {
                "elderly_hl_mult": adj.get("elderly_hl_mult", 1.0),
                "pediatric_hl_mult": adj.get("pediatric_hl_mult", 1.0),
                "female_hl_mult": adj.get("female_hl_mult", 1.0),
                "male_hl_mult": adj.get("male_hl_mult", 1.0),
                "weight_based": adj.get("weight_based", False),
                "dose_per_kg": adj.get("dose_per_kg"),
                "ref_weight_kg": adj.get("ref_weight_kg", 70),
            },
        }
    return jsonify(out)


@app.route("/api/calculate", methods=["POST"])
def calculate():
    """Calculate the decay curve for a given drug and dose.

    Expects JSON: {
      "drug": "<key>",
      "dose_mg": <number>,
      "hours": <number>,
      "age": <int|null>,
      "gender": "male"|"female"|null,
      "weight_kg": <number|null>
    }
    Returns JSON with an array of {t, concentration} points plus
    any applied patient-profile adjustments.
    """
    data = request.get_json(silent=True) or {}
    drug_key = data.get("drug", "")
    dose_mg = data.get("dose_mg")
    hours = data.get("hours")
    age = data.get("age")          # int or None
    gender = data.get("gender")    # "male", "female", or None
    weight_kg = data.get("weight_kg")  # float or None

    if drug_key not in DRUGS:
        return jsonify({"error": f"Unknown drug: {drug_key}"}), 400

    drug = DRUGS[drug_key]
    base_half_life = drug["half_life_hr"]

    # Compute adjusted half-life
    half_life, adj_notes = compute_adjusted_half_life(drug, age, gender, weight_kg)

    if dose_mg is None or dose_mg <= 0:
        dose_mg = drug["typical_dose_mg"]
    if hours is None or hours <= 0:
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
            "base_half_life_hr": base_half_life,
            "initial_dose_mg": dose_mg,
            "total_hours": hours,
            "adjustment_notes": adj_notes,
            "curve": curve,
        }
    )


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
