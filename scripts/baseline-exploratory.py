#!/usr/bin/env python3
"""Exploratory geometry and readout checks. Validation seeds only.

Not a verdict. Does not read test seeds. Imports the same readout
objective as scripts/baseline-readout.py.
"""

import json
import sys
from pathlib import Path

import numpy as np

CLASSES = ("quiet", "align", "periodic", "basin")


def load_fitters():
    import importlib.util
    spec = importlib.util.spec_from_file_location("baseline_readout", Path(__file__).resolve().parent / "baseline-readout.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def scatter(x, y):
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=int)
    grand = x.mean(axis=0)
    sst = float(np.sum((x - grand) ** 2))
    ss_class = 0.0
    within = []
    means = []
    norms = []
    for k in range(4):
        block = x[y == k]
        mu = block.mean(axis=0)
        means.append(mu)
        ss_class += float(block.shape[0] * np.sum((mu - grand) ** 2))
        within.append(float(np.sqrt(np.mean(np.sum((block - mu) ** 2, axis=1)))))
        norms.append(float(np.mean(np.linalg.norm(block, axis=1))))
    means = np.vstack(means)
    gaps = []
    for i in range(4):
        for j in range(i + 1, 4):
            gaps.append(float(np.linalg.norm(means[i] - means[j])))
    return {
        "class_ss_fraction": 0.0 if sst == 0 else ss_class / sst,
        "mean_within_rms": float(np.mean(within)),
        "mean_between_means": float(np.mean(gaps)),
        "min_between_means": float(np.min(gaps)),
        "mean_norm": float(np.mean(np.linalg.norm(x, axis=1))),
        "min_norm": float(np.min(np.linalg.norm(x, axis=1))),
        "max_norm": float(np.max(np.linalg.norm(x, axis=1))),
        "class_mean_norms": norms,
    }


def seed_fraction(x, seeds):
    x = np.asarray(x, dtype=float)
    seeds = np.asarray(seeds)
    grand = x.mean(axis=0)
    sst = float(np.sum((x - grand) ** 2))
    ss_seed = 0.0
    for seed in np.unique(seeds):
        block = x[seeds == seed]
        ss_seed += float(block.shape[0] * np.sum((block.mean(axis=0) - grand) ** 2))
    return 0.0 if sst == 0 else ss_seed / sst


def initial_alignment(final, initial):
    final = np.asarray(final, dtype=float)
    initial = np.asarray(initial, dtype=float)
    cos = []
    moved = []
    for a, b in zip(final, initial):
        na = np.linalg.norm(a)
        nb = np.linalg.norm(b)
        cos.append(0.0 if na < 1e-12 or nb < 1e-12 else float(np.dot(a, b) / (na * nb)))
        moved.append(float(np.linalg.norm(a - b)))
    return {
        "mean_cosine_with_initial": float(np.mean(cos)),
        "mean_distance_from_initial": float(np.mean(moved)),
        "mean_initial_norm": float(np.mean(np.linalg.norm(initial, axis=1))),
    }


def confusion(mod, theta, x, y):
    pred = mod.predict(theta, x)
    y = np.asarray(y, dtype=int)
    table = []
    for k, name in enumerate(CLASSES):
        mask = y == k
        row = {"true": name, "n": int(np.sum(mask))}
        for j, pred_name in enumerate(CLASSES):
            row[pred_name] = int(np.sum(pred[mask] == j))
        table.append(row)
    return table


def main():
    mod = load_fitters()
    payload = json.load(sys.stdin)
    out = []
    for horizon in payload["horizons"]:
        ev = horizon["engineVal"]
        iv = horizon["integVal"]
        x = np.asarray(ev["x"], dtype=float)
        y = np.asarray(ev["y"], dtype=int)
        theta0 = np.zeros(mod.pack_shapes(x.shape[1]))
        _, grad0, _ = mod.nll_and_grad_hess(theta0, x, y, 1.0)
        fitted = {}
        for lam in (0.0, 0.01, 0.1, 1.0, 10.0, 100.0):
            # Train fit from the origin, same objective as the closed run, plus an exploratory lambda of 0.
            train = horizon["engineTrain"]
            result = mod.fit(train["x"], train["y"], lam)
            correct, total = mod.accuracy(result["theta"], ev["x"], ev["y"])
            fitted[str(lam)] = {
                "val_correct": correct,
                "val_total": total,
                "grad_inf": result["grad_inf"],
                "converged": result["converged"],
                "weight_rms": float(np.sqrt(np.mean(np.asarray(result["theta"]) ** 2))),
            }
        # Exploratory restarts. Selection is by training objective, not by validation accuracy.
        rng = np.random.default_rng(20261004)
        restarts = []
        train_x = np.asarray(horizon["engineTrain"]["x"], dtype=float)
        train_y = np.asarray(horizon["engineTrain"]["y"], dtype=int)
        for lam in (0.0, 0.01):
            best = None
            for _ in range(5):
                theta = rng.normal(scale=0.01, size=mod.pack_shapes(train_x.shape[1]))
                # Continue Newton from this start by seeding fit's first point through a local loop.
                value, grad, hess = mod.nll_and_grad_hess(theta, train_x, train_y, lam)
                for _step in range(mod.MAX_NEWTON):
                    if np.max(np.abs(grad)) < mod.GRAD_TOL:
                        break
                    step = np.linalg.solve(hess, grad)
                    t = 1.0
                    accepted = False
                    for _ls in range(20):
                        trial = theta - t * step
                        tv, tg, th = mod.nll_and_grad_hess(trial, train_x, train_y, lam)
                        if tv <= value - 1e-4 * t * float(grad @ step):
                            theta, value, grad, hess = trial, tv, tg, th
                            accepted = True
                            break
                        t *= 0.5
                    if not accepted:
                        break
                correct, total = mod.accuracy(theta, ev["x"], ev["y"])
                row = {"lambda": lam, "train_objective": value, "val_correct": correct, "grad_inf": float(np.max(np.abs(grad)))}
                restarts.append(row)
                if best is None or value < best["train_objective"]:
                    best = {**row, "theta": theta}
            fitted[f"restart_best_lambda_{lam}"] = {
                "val_correct": best["val_correct"],
                "train_objective": best["train_objective"],
                "grad_inf": best["grad_inf"],
            }
        origin_fit = mod.fit(horizon["engineTrain"]["x"], horizon["engineTrain"]["y"], 0.01)
        out.append({
            "H": horizon["H"],
            "integrator_a": horizon["integratorA"],
            "engine_scatter": scatter(ev["x"], ev["y"]),
            "integrator_scatter": scatter(iv["x"], iv["y"]),
            "engine_seed_ss_fraction": seed_fraction(ev["x"], ev["seeds"]),
            "integrator_seed_ss_fraction": seed_fraction(iv["x"], iv["seeds"]),
            "engine_vs_initial": initial_alignment(ev["x"], horizon["initialVal"]["x"]),
            "grad_inf_at_zero_lambda_1": float(np.max(np.abs(grad0))),
            "origin_confusion_lambda_0.01": confusion(mod, origin_fit["theta"], ev["x"], ev["y"]),
            "fits": fitted,
            "restarts": restarts,
        })
    json.dump(out, sys.stdout, indent=2)


if __name__ == "__main__":
    main()
