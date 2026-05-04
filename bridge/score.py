# Per-minute score deltas. Tune these — they're the heart of the product.
WEIGHTS_PER_MIN = {
    "spike": -1.5,
    "neutral": -0.2,
    "productive": 0.3,
    "break": 0.5,
}

SAMPLE_SECONDS = 30
START_SCORE = 100.0
MIN_SCORE = 0.0
MAX_SCORE = 100.0


def _delta(category):
    return WEIGHTS_PER_MIN.get(category, 0.0) * (SAMPLE_SECONDS / 60.0)


def compute_score(samples, start=START_SCORE):
    score = start
    for s in samples:
        score += _delta(s["category"])
        if score < MIN_SCORE:
            score = MIN_SCORE
        elif score > MAX_SCORE:
            score = MAX_SCORE
    return score


def color_for(score):
    if score >= 70:
        return "green"
    if score >= 40:
        return "yellow"
    return "red"


def minutes_by_category(samples):
    out = {}
    for s in samples:
        out[s["category"]] = out.get(s["category"], 0) + SAMPLE_SECONDS / 60.0
    return out
