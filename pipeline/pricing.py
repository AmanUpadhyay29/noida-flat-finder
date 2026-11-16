"""Buy and rent prices per society and BHK, from live listings, plus labelled estimates where listings are missing.

Estimates (never shown as listing data):
  - rent from sale price, or sale from rent, using the rental yield (annual rent / price) measured on
    societies that have both, taken from the same locality when it has enough pairs, else the city per BHK;
  - when a society has neither, sale = unit size x the project's price per sq ft, then rent via yield.
"""
import math
import statistics
from collections import defaultdict

MIN_LOCALITY_PAIRS = 4


def stats(values):
    v = sorted(x for x in values if x)
    if not v:
        return None
    return {"median": round(statistics.median(v)), "min": round(v[0]), "max": round(v[-1]), "n": len(v)}


def listing_stats(project):
    """{bhk: {"buy": stats, "rent": stats, "psf": median price per sq ft}} from the sample listings."""
    out = defaultdict(dict)
    for kind, key in (("buy", "sale_listings"), ("rent", "rent_listings")):
        by = defaultdict(list)
        for l in project.get(key) or []:
            if l.get("bhk") and l.get("price"):
                by[l["bhk"]].append(l)
        for bhk, ls in by.items():
            out[bhk][kind] = stats(l["price"] for l in ls)
            if kind == "buy":
                psf = [l["psf"] for l in ls if l.get("psf")]
                if psf:
                    out[bhk]["psf"] = round(statistics.median(psf))
    return dict(out)


def fit_yields(societies):
    """Rental yields from societies with both buy and rent medians for the same BHK."""
    pairs = []
    for s in societies:
        for bhk, p in s["prices"].items():
            if p.get("buy") and p.get("rent"):
                y = p["rent"]["median"] * 12 / p["buy"]["median"]
                if 0.005 < y < 0.12:  # drop obvious listing mistakes (e.g. rent typed as yearly)
                    pairs.append((s.get("locality"), bhk, y, p["buy"]["median"], p["rent"]["median"]))
    by_loc, by_bhk = defaultdict(list), defaultdict(list)
    for loc, bhk, y, _, _ in pairs:
        by_loc[loc].append(y)
        by_bhk[bhk].append(y)
    city = statistics.median([p[2] for p in pairs]) if pairs else 0.03
    corr = None
    if len(pairs) > 3:
        xs, ys = [math.log(p[3]) for p in pairs], [math.log(p[4]) for p in pairs]
        mx, my = statistics.mean(xs), statistics.mean(ys)
        cov = sum((a - mx) * (b - my) for a, b in zip(xs, ys))
        den = math.sqrt(sum((a - mx) ** 2 for a in xs) * sum((b - my) ** 2 for b in ys))
        corr = cov / den if den else None
    model = {
        "pairs": len(pairs),
        "city_yield": round(city, 4),
        "bhk_yield": {b: round(statistics.median(v), 4) for b, v in by_bhk.items() if len(v) >= 3},
        "locality_yield": {l: round(statistics.median(v), 4) for l, v in by_loc.items() if len(v) >= MIN_LOCALITY_PAIRS and l},
        "log_price_rent_correlation": round(corr, 3) if corr is not None else None,
    }
    return model


def yield_for(model, locality, bhk):
    if locality in model["locality_yield"]:
        return model["locality_yield"][locality], f"rental yield in {locality}"
    if bhk in model["bhk_yield"]:
        return model["bhk_yield"][bhk], f"city rental yield for {bhk} BHK"
    return model["city_yield"], "city rental yield"


def add_estimates(s, model, sizes_by_bhk, psf_fallback):
    """Fill buy_est / rent_est for each BHK of a society that lacks listings."""
    bhks = set(s["prices"]) | set(sizes_by_bhk)
    for bhk in bhks:
        p = s["prices"].setdefault(bhk, {})
        y, why = yield_for(model, s.get("locality"), bhk)
        buy = p.get("buy", {}) and p["buy"]["median"]
        rent = p.get("rent", {}) and p["rent"]["median"]
        if not buy and rent:
            p["buy_est"] = {"value": round(rent * 12 / y, -4), "basis": f"rent ÷ {why} ({y:.1%})"}
            buy = p["buy_est"]["value"]
        if not buy and sizes_by_bhk.get(bhk) and psf_fallback:
            p["buy_est"] = {"value": round(sizes_by_bhk[bhk] * psf_fallback, -4),
                            "basis": f"{int(sizes_by_bhk[bhk]):,} sq ft × ₹{int(psf_fallback):,}/sq ft"}
            buy = p["buy_est"]["value"]
        if not rent and buy:
            p["rent_est"] = {"value": round(buy * y / 12, -2), "basis": f"price × {why} ({y:.1%})"}
        if not p:
            del s["prices"][bhk]
