#!/usr/bin/env python3
"""Multinomial logistic readout for the predeclared baseline.

Reference class is quiet (index 0): its weights and bias stay 0.
Each other class has an unpenalized bias and weights penalized by
(lambda / 2) * sum of squares. The data term is the mean negative
log likelihood. Newton uses backtracking, at most 40 steps, and
stops when the infinity norm of the gradient is below 1e-8.
Prediction is the softmax argmax.

This parameterization was fixed before any engine score was read.
"""

import json
import sys

import numpy as np

CLASSES = ("quiet", "align", "periodic", "basin")
MAX_NEWTON = 40
GRAD_TOL = 1e-8
LAMBDAS = (0.01, 0.1, 1.0, 10.0, 100.0)
BASE_RATES = ("0.05", "0.1", "0.2", "0.32", "0.5")
# Extension values are predeclared. They become eligible only through the edge rule.
EDGE_NEXT = {"0.05": "0.025", "0.025": "0.0125", "0.5": "0.75", "0.75": "1.0"}


def pack_shapes(d):
    return 3 * (d + 1)


def unpack(theta, d):
    theta = np.asarray(theta, dtype=float)
    biases = np.zeros(4)
    weights = np.zeros((4, d))
    for k in range(1, 4):
        base = (k - 1) * (d + 1)
        biases[k] = theta[base]
        weights[k] = theta[base + 1 : base + 1 + d]
    return biases, weights


def pack(biases, weights):
    d = weights.shape[1]
    theta = np.zeros(pack_shapes(d))
    for k in range(1, 4):
        base = (k - 1) * (d + 1)
        theta[base] = biases[k]
        theta[base + 1 : base + 1 + d] = weights[k]
    return theta


def logits(theta, x):
    biases, weights = unpack(theta, x.shape[1])
    z = x @ weights.T + biases
    z[:, 0] = 0.0
    return z


def nll_and_grad_hess(theta, x, y, lam):
    n, d = x.shape
    z = logits(theta, x)
    z = z - z.max(axis=1, keepdims=True)
    expz = np.exp(z)
    p = expz / expz.sum(axis=1, keepdims=True)
    y = np.asarray(y, dtype=int)
    loss = float(-np.log(p[np.arange(n), y] + 1e-300).mean())
    _, weights = unpack(theta, d)
    penalty = 0.5 * lam * float(np.sum(weights[1:] ** 2))
    resid = p.copy()
    resid[np.arange(n), y] -= 1.0
    grad = np.zeros_like(theta)
    hess = np.zeros((theta.size, theta.size))
    for k in range(1, 4):
        base = (k - 1) * (d + 1)
        rk = resid[:, k]
        grad[base] = rk.mean()
        grad[base + 1 : base + 1 + d] = (x * rk[:, None]).mean(axis=0) + lam * weights[k]
        for m in range(1, 4):
            mbase = (m - 1) * (d + 1)
            # mean p_k (1_{km} - p_m)
            coeff = p[:, k] * ((1.0 if k == m else 0.0) - p[:, m])
            hess[base, mbase] = coeff.mean()
            gk = (x * coeff[:, None]).mean(axis=0)
            hess[base, mbase + 1 : mbase + 1 + d] = gk
            hess[mbase + 1 : mbase + 1 + d, base] = gk
            hess[base + 1 : base + 1 + d, mbase + 1 : mbase + 1 + d] = (x.T * coeff) @ x / n
            if k == m:
                hess[base + 1 : base + 1 + d, mbase + 1 : mbase + 1 + d] += lam * np.eye(d)
    return loss + penalty, grad, hess


def fit(x, y, lam):
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=int)
    theta = np.zeros(pack_shapes(x.shape[1]))
    value, grad, hess = nll_and_grad_hess(theta, x, y, lam)
    converged = False
    for _ in range(MAX_NEWTON):
        if np.max(np.abs(grad)) < GRAD_TOL:
            converged = True
            break
        step = np.linalg.solve(hess, grad)
        # Backtracking so a Newton step cannot increase the objective.
        t = 1.0
        accepted = False
        for _ls in range(20):
            trial = theta - t * step
            trial_value, trial_grad, trial_hess = nll_and_grad_hess(trial, x, y, lam)
            if trial_value <= value - 1e-4 * t * float(grad @ step):
                theta, value, grad, hess = trial, trial_value, trial_grad, trial_hess
                accepted = True
                break
            t *= 0.5
        if not accepted:
            break
    converged = converged or np.max(np.abs(grad)) < GRAD_TOL
    return {
        "theta": theta.tolist(),
        "objective": value,
        "grad_inf": float(np.max(np.abs(grad))),
        "converged": bool(converged),
    }


def predict(theta, x):
    z = logits(np.asarray(theta, dtype=float), np.asarray(x, dtype=float))
    return np.argmax(z, axis=1)


def accuracy(theta, x, y):
    pred = predict(theta, x)
    y = np.asarray(y, dtype=int)
    correct = int(np.sum(pred == y))
    return correct, int(y.size)


def self_check():
    rng = np.random.default_rng(0)
    d = 12
    x = rng.normal(size=(20, d))
    y = rng.integers(0, 4, size=20)
    theta = rng.normal(size=pack_shapes(d))
    _, grad, _ = nll_and_grad_hess(theta, x, y, 0.3)
    eps = 1e-6
    num = np.zeros_like(grad)
    base, _, _ = nll_and_grad_hess(theta, x, y, 0.3)
    for i in range(theta.size):
        bumped = theta.copy()
        bumped[i] += eps
        plus, _, _ = nll_and_grad_hess(bumped, x, y, 0.3)
        num[i] = (plus - base) / eps
    err = float(np.max(np.abs(num - grad)))
    if err > 1e-5:
        raise SystemExit(f"gradient check failed: {err}")
    centers = np.eye(4, d) * 3.0
    blobs = []
    labels = []
    for k in range(4):
        blobs.append(centers[k] + rng.normal(0, 0.05, size=(30, d)))
        labels.append(np.full(30, k))
    xb = np.vstack(blobs)
    yb = np.concatenate(labels)
    fitted = fit(xb, yb, 1.0)
    correct, total = accuracy(fitted["theta"], xb, yb)
    if not fitted["converged"] or correct != total:
        raise SystemExit(f"toy fit failed: {fitted['converged']} {correct}/{total} grad {fitted['grad_inf']}")
    print(f"self-check ok grad_err={err:.3e} toy={correct}/{total}")


def choose(records, rates, lambdas):
    """records: list of {a or None, split, x, y} for one model family."""
    best = None
    table = []
    for a in rates:
        for lam in lambdas:
            train = next(r for r in records if r["a"] == a and r["split"] == "train")
            valid = next(r for r in records if r["a"] == a and r["split"] == "validation")
            fitted = fit(train["x"], train["y"], lam)
            correct, total = accuracy(fitted["theta"], valid["x"], valid["y"])
            row = {
                "a": a,
                "lambda": lam,
                "correct": correct,
                "total": total,
                "converged": fitted["converged"],
                "grad_inf": fitted["grad_inf"],
                "theta": fitted["theta"],
            }
            table.append(row)
            if not fitted["converged"]:
                continue
            better = best is None or correct > best["correct"]
            tie = best is not None and correct == best["correct"]
            larger_lambda = best is not None and lam > best["lambda"]
            same_lambda = best is not None and lam == best["lambda"]
            larger_a = best is not None and a != "engine" and float(a) > float(best["a"])
            if better or (tie and (larger_lambda or (same_lambda and larger_a))):
                best = row
    return best, table


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: baseline-readout.py --self-check|--select|--score")
    mode = sys.argv[1]
    if mode == "--self-check":
        self_check()
        return
    payload = json.load(sys.stdin)
    if mode == "--select":
        lambdas = LAMBDAS
        out_horizons = []
        for horizon in payload["horizons"]:
            engine_best, engine_table = choose(horizon["engine"], ("engine",), lambdas)
            rates = list(BASE_RATES)
            extensions = 0
            cap_hit = False
            history = []
            integ_best = None
            integ_table = []
            while True:
                integ_best, integ_table = choose(horizon["integrator"], rates, lambdas)
                history.append({
                    "rates": list(rates),
                    "selected_a": None if integ_best is None else integ_best["a"],
                    "selected_lambda": None if integ_best is None else integ_best["lambda"],
                    "correct": None if integ_best is None else integ_best["correct"],
                })
                if integ_best is None:
                    break
                a = integ_best["a"]
                if a in ("0.0125", "1.0"):
                    cap_hit = True
                    break
                if extensions >= 2:
                    break
                added = EDGE_NEXT.get(a)
                if added is None or added in rates:
                    break
                rates.append(added)
                extensions += 1
            base_best, _base_table = choose(horizon["integrator"], BASE_RATES, lambdas)
            flips = []
            if base_best is not None:
                for dropped in BASE_RATES:
                    kept = tuple(r for r in BASE_RATES if r != dropped)
                    alt, _alt_table = choose(horizon["integrator"], kept, lambdas)
                    if alt is not None and alt["a"] != base_best["a"]:
                        flips.append({"dropped": dropped, "selected_a": alt["a"]})
            def public_table(table):
                return [{k: row[k] for k in ("a", "lambda", "correct", "total", "converged", "grad_inf")} for row in table]
            out_horizons.append({
                "H": horizon["H"],
                "engine": None if engine_best is None else {
                    "lambda": engine_best["lambda"],
                    "correct": engine_best["correct"],
                    "total": engine_best["total"],
                    "converged": engine_best["converged"],
                    "grad_inf": engine_best["grad_inf"],
                    "theta": engine_best["theta"],
                    "edge": engine_best["lambda"] in (lambdas[0], lambdas[-1]),
                },
                "integrator": None if integ_best is None else {
                    "a": integ_best["a"],
                    "lambda": integ_best["lambda"],
                    "correct": integ_best["correct"],
                    "total": integ_best["total"],
                    "converged": integ_best["converged"],
                    "grad_inf": integ_best["grad_inf"],
                    "theta": integ_best["theta"],
                    "extensions": extensions,
                    "cap_hit": cap_hit,
                    "edge": integ_best["lambda"] in (lambdas[0], lambdas[-1]),
                },
                "engine_table": public_table(engine_table),
                "integrator_final_table": public_table(integ_table),
                "extension_history": history,
                "base_selected_a": None if base_best is None else base_best["a"],
                "a_flips": flips,
            })
        json.dump({"horizons": out_horizons}, sys.stdout)
        return
    if mode == "--score":
        rng = np.random.default_rng(payload["bootstrap_seed"])
        engine_pred = predict(payload["engine_theta"], payload["engine_x"]).tolist()
        integ_pred = predict(payload["integrator_theta"], payload["integrator_x"]).tolist()
        y = payload["y"]
        seeds = payload["seeds"]
        modes = payload["modes"]
        by_seed = {}
        for pred_e, pred_i, yi, seed in zip(engine_pred, integ_pred, y, seeds):
            slot = by_seed.setdefault(seed, {"engine": 0, "integrator": 0, "n": 0})
            slot["n"] += 1
            slot["engine"] += int(pred_e == yi)
            slot["integrator"] += int(pred_i == yi)
        seed_ids = sorted(by_seed)
        diffs = []
        for seed in seed_ids:
            slot = by_seed[seed]
            diffs.append(slot["engine"] / slot["n"] - slot["integrator"] / slot["n"])
        diffs = np.asarray(diffs, dtype=float)
        b = payload["bootstrap_draws"]
        means = np.empty(b)
        n = diffs.size
        for i in range(b):
            take = rng.integers(0, n, size=n)
            means[i] = diffs[take].mean()
        lo, hi = np.quantile(means, [0.025, 0.975], method="linear")
        point = float(diffs.mean())
        lo = float(lo)
        hi = float(hi)
        if lo > 0.05:
            verdict = "benefit shown"
        elif hi < 0.05:
            verdict = "margin ruled out"
        else:
            verdict = "inconclusive"
        mode_rows = []
        y_arr = np.asarray(y)
        e_arr = np.asarray(engine_pred)
        i_arr = np.asarray(integ_pred)
        mode_arr = np.asarray(modes)
        for k, name in enumerate(CLASSES):
            mask = y_arr == k
            mode_rows.append({
                "mode": name,
                "engine_correct": int(np.sum(e_arr[mask] == y_arr[mask])),
                "integrator_correct": int(np.sum(i_arr[mask] == y_arr[mask])),
                "total": int(np.sum(mask)),
            })
        engine_correct = int(np.sum(e_arr == y_arr))
        integ_correct = int(np.sum(i_arr == y_arr))
        dist = payload["distances"]
        json.dump({
            "point": point,
            "low": lo,
            "high": hi,
            "width": hi - lo,
            "verdict": verdict,
            "entirely_below_zero": hi < 0,
            "diffs": diffs.tolist(),
            "engine_correct": engine_correct,
            "integrator_correct": integ_correct,
            "total": int(y_arr.size),
            "modes": mode_rows,
            "mean_distance": float(np.mean(dist)),
            "bootstrap_draws": b,
            "bootstrap_seed": payload["bootstrap_seed"],
        }, sys.stdout)
        return
    raise SystemExit(f"unknown mode {mode}")


if __name__ == "__main__":
    main()
