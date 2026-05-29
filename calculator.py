"""Pharmacokinetic calculation logic.

Pure functions — no Flask dependency.
"""

from __future__ import annotations


def compute_adjusted_half_life(
    drug: dict,
    age: int | None,
    gender: str | None,
    weight_kg: float | None,
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


def generate_decay_curve(
    dose_mg: float,
    half_life_hr: float,
    total_hours: float,
    num_points: int = 200,
) -> list[dict[str, float]]:
    """Generate decay curve points: C(t) = C₀ × (½)^(t / t½).

    Returns a list of {"t": <hours>, "concentration": <mg>} dicts.
    """
    step = total_hours / num_points
    curve: list[dict[str, float]] = []
    for i in range(num_points + 1):
        t = round(i * step, 4)
        concentration = round(dose_mg * (0.5 ** (t / half_life_hr)), 4)
        curve.append({"t": t, "concentration": concentration})
    return curve
