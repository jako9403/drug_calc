"""Drug Half-Life Calculator — Flask application.

Thin routing layer.  Drug data lives in drugs.py; calculation logic in
calculator.py.  All inputs are validated before use.
"""

from __future__ import annotations

from flask import Flask, jsonify, render_template, request

from calculator import compute_adjusted_half_life, generate_decay_curve
from drugs import DRUGS

# ---------------------------------------------------------------------------
# Validation constants
# ---------------------------------------------------------------------------
MAX_DOSE_MG = 100_000       # absolute sanity ceiling
MAX_HOURS = 720              # 30 days
MAX_AGE = 150
MAX_WEIGHT_KG = 500
VALID_GENDERS = {"male", "female"}

app = Flask(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _validate_optional_number(
    raw, *, name: str, min_val: float, max_val: float, as_int: bool = False,
) -> tuple[int | float | None, str | None]:
    """Return (parsed_value_or_None, error_string_or_None)."""
    if raw is None:
        return None, None
    try:
        val = int(raw) if as_int else float(raw)
    except (TypeError, ValueError):
        return None, f"{name} must be a number."
    if val < min_val or val > max_val:
        return None, f"{name} must be between {min_val} and {max_val}."
    return val, None


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
            "hl_range_hr": d.get("hl_range_hr"),
            "typical_dose_mg": d["typical_dose_mg"],
            "max_daily_mg": d["max_daily_mg"],
            "category": d["category"],
            "notes": d["notes"],
            "sources": d.get("sources", []),
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

    Expects JSON body.  All fields except ``drug`` are optional.
    Returns 400 with ``{"error": "..."}`` on invalid input.
    """
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "Request body must be a JSON object."}), 400

    # --- drug (required, must be a known key) ---
    drug_key = data.get("drug")
    if not isinstance(drug_key, str) or drug_key not in DRUGS:
        return jsonify({"error": f"Unknown or missing drug key."}), 400

    drug = DRUGS[drug_key]
    base_half_life = drug["half_life_hr"]

    # --- dose_mg (optional, positive number, capped) ---
    dose_mg, err = _validate_optional_number(
        data.get("dose_mg"), name="dose_mg", min_val=0.01, max_val=MAX_DOSE_MG,
    )
    if err:
        return jsonify({"error": err}), 400
    if dose_mg is None:
        dose_mg = drug["typical_dose_mg"]

    # --- hours (optional, positive number, capped) ---
    hours, err = _validate_optional_number(
        data.get("hours"), name="hours", min_val=0.01, max_val=MAX_HOURS,
    )
    if err:
        return jsonify({"error": err}), 400

    # --- age (optional, 1-150 integer) ---
    age, err = _validate_optional_number(
        data.get("age"), name="age", min_val=1, max_val=MAX_AGE, as_int=True,
    )
    if err:
        return jsonify({"error": err}), 400

    # --- gender (optional, must be "male" or "female") ---
    gender = data.get("gender")
    if gender is not None:
        if not isinstance(gender, str) or gender not in VALID_GENDERS:
            return jsonify({"error": "gender must be 'male' or 'female'."}), 400

    # --- weight_kg (optional, 0.5-500) ---
    weight_kg, err = _validate_optional_number(
        data.get("weight_kg"), name="weight_kg", min_val=0.5, max_val=MAX_WEIGHT_KG,
    )
    if err:
        return jsonify({"error": err}), 400

    # --- Compute ---
    half_life, adj_notes = compute_adjusted_half_life(drug, age, gender, weight_kg)

    if hours is None:
        hours = half_life * 6

    curve = generate_decay_curve(dose_mg, half_life, hours)

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
    app.run(debug=False, host="127.0.0.1", port=5000)
