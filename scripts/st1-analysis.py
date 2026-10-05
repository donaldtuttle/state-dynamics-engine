#!/usr/bin/env python3
"""SINGLE-TRAJECTORY-1 correction, readout, selection, and bootstrap.

The solver below is frozen by docs/SINGLE_TRAJECTORY_1.md section 6.
This program does not load a split it was not given.
Synthetic self-checks do not use experiment seeds.
"""

import json
import sys

import numpy as np

LAMBDAS = (0.0001, 0.001, 0.01, 0.1, 1.0, 10.0, 100.0)
RATES = (
    "0.003125", "0.00625", "0.0125", "0.025", "0.05", "0.1",
    "0.2", "0.32", "0.5", "0.75", "1.0",
)
SIGNS = ((1, 1), (1, -1), (-1, 1), (-1, -1))
MAX_NEWTON = 40
GRAD_TOL = 1e-8
ARMIJO_C = 1e-4
MAX_BACKTRACK = 20
SD_FLOOR = 1e-12
RCOND = 1e-12
BOOTSTRAP_DRAWS = 50000
BOOTSTRAP_SEED = 20261005


def decode_vec(text):
    raw = bytes.fromhex(text)
    if len(raw) % 8 != 0:
        raise ValueError("float hex length")
    return np.frombuffer(raw, dtype="<f8").astype(np.float64, copy=True)


def encode_vec(values):
    arr = np.ascontiguousarray(np.asarray(values, dtype=np.float64).reshape(-1))
    return arr.tobytes().hex()


def require_finite(name, arr):
    if not np.all(np.isfinite(arr)):
        raise RuntimeError(f"nonfinite {name}")


def sigmoid(eta):
    eta = np.asarray(eta, dtype=np.float64)
    out = np.empty_like(eta)
    pos = eta >= 0
    out[pos] = 1.0 / (1.0 + np.exp(-eta[pos]))
    exp_eta = np.exp(eta[~pos])
    out[~pos] = exp_eta / (1.0 + exp_eta)
    return out


def mean_nll(eta, y):
    # softplus(eta) - y * eta, stable.
    return float(np.mean(np.maximum(eta, 0.0) + np.log1p(np.exp(-np.abs(eta))) - y * eta))


def objective_grad_hess(w, b, z, y, lam):
    n, d = z.shape
    eta = z @ w + b
    p = sigmoid(eta)
    nll = mean_nll(eta, y)
    penalty = 0.5 * lam * float(w @ w)
    resid = p - y
    weight = p * (1.0 - p)
    grad_w = (z.T @ resid) / n + lam * w
    grad_b = float(resid.mean())
    hess_ww = (z.T * weight) @ z / n + lam * np.eye(d)
    hess_wb = (z.T @ weight) / n
    hess_bb = float(weight.mean())
    hess = np.empty((d + 1, d + 1), dtype=np.float64)
    hess[:d, :d] = hess_ww
    hess[:d, d] = hess_wb
    hess[d, :d] = hess_wb
    hess[d, d] = hess_bb
    grad = np.concatenate([grad_w, np.array([grad_b], dtype=np.float64)])
    return nll + penalty, nll, grad, hess


def fit_logistic(z, y, lam):
    z = np.asarray(z, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    require_finite("features", z)
    require_finite("labels", y)
    d = z.shape[1]
    w = np.zeros(d, dtype=np.float64)
    b = 0.0
    value, nll, grad, hess = objective_grad_hess(w, b, z, y, lam)
    converged = False
    for _ in range(MAX_NEWTON):
        if np.max(np.abs(grad)) < GRAD_TOL:
            converged = True
            break
        try:
            step = np.linalg.solve(hess, grad)
        except np.linalg.LinAlgError:
            break
        direction = float(grad @ step)
        if not np.isfinite(direction) or direction <= 0.0:
            break
        t = 1.0
        accepted = False
        for _ls in range(MAX_BACKTRACK):
            trial_w = w - t * step[:d]
            trial_b = float(b - t * step[d])
            trial_value, trial_nll, trial_grad, trial_hess = objective_grad_hess(trial_w, trial_b, z, y, lam)
            if np.isfinite(trial_value) and trial_value <= value - ARMIJO_C * t * direction:
                w, b = trial_w, trial_b
                value, nll, grad, hess = trial_value, trial_nll, trial_grad, trial_hess
                accepted = True
                break
            t *= 0.5
        if not accepted:
            break
    converged = converged or bool(np.max(np.abs(grad)) < GRAD_TOL)
    if not np.all(np.isfinite(w)) or not np.isfinite(b) or not np.isfinite(value):
        converged = False
    return {
        "w": w,
        "b": b,
        "converged": bool(converged),
        "grad_inf": float(np.max(np.abs(grad))),
        "objective": float(value),
        "train_nll": float(nll),
    }


def predict_stats(w, b, z, y):
    eta = z @ w + b
    p = sigmoid(eta)
    pred = (p >= 0.5).astype(np.int64)
    y = np.asarray(y, dtype=np.int64)
    correct = int(np.sum(pred == y))
    return correct, int(y.size), mean_nll(eta, y.astype(np.float64))


def standardize_fit(x):
    x = np.asarray(x, dtype=np.float64)
    mean = x.mean(axis=0)
    sd = x.std(axis=0, ddof=0)
    sd = np.where(sd < SD_FLOOR, 1.0, sd)
    return mean, sd


def apply_standard(x, mean, sd):
    return (np.asarray(x, dtype=np.float64) - mean) / sd


def fit_affine(initial, final):
    x = np.asarray(initial, dtype=np.float64)
    y = np.asarray(final, dtype=np.float64)
    require_finite("initial", x)
    require_finite("final", y)
    design = np.concatenate([x, np.ones((x.shape[0], 1), dtype=np.float64)], axis=1)
    weight = np.linalg.pinv(design, rcond=RCOND) @ y
    b_matrix = weight[:-1].T.copy()
    intercept = weight[-1].copy()
    return b_matrix, intercept


def apply_affine(initial, b_matrix, intercept):
    return np.asarray(initial, dtype=np.float64) @ b_matrix.T + intercept


def stack_episodes(episodes):
    check_order(episodes)
    initial = np.vstack([decode_vec(ep["initial"]) for ep in episodes])
    engine = np.vstack([decode_vec(ep["engine"]) for ep in episodes])
    final_input = np.vstack([decode_vec(ep["final_input"]) for ep in episodes])
    y = np.array([int(ep["y"]) for ep in episodes], dtype=np.int64)
    seeds = np.array([int(ep["seed"]) for ep in episodes], dtype=np.int64)
    integrators = {}
    for rate in RATES:
        integrators[rate] = np.vstack([decode_vec(ep["integrator"][rate]) for ep in episodes])
    return {
        "initial": initial,
        "engine": engine,
        "final_input": final_input,
        "y": y,
        "seeds": seeds,
        "integrator": integrators,
    }


def check_order(episodes):
    expected_signs = list(SIGNS)
    previous = None
    index = 0
    for ep in episodes:
        sign = (int(ep["b1"]), int(ep["b2"]))
        if sign != expected_signs[index % 4]:
            raise RuntimeError("episode sign order is not the frozen block order")
        if int(ep["y"]) != (1 if sign[0] == sign[1] else 0):
            raise RuntimeError("label does not match the cue rule")
        if index % 4 == 0:
            if previous is not None and int(ep["seed"]) <= previous:
                raise RuntimeError("seeds are not strictly increasing by block")
            previous = int(ep["seed"])
        elif int(ep["seed"]) != previous:
            raise RuntimeError("a block was split")
        index += 1
    if index == 0 or index % 4 != 0:
        raise RuntimeError("episodes do not form complete blocks")


def pack_fit(fitted, correct, total, val_nll, mean, sd, b_matrix=None, intercept=None):
    row = {
        "converged": fitted["converged"],
        "grad_inf": fitted["grad_inf"],
        "train_nll": fitted["train_nll"],
        "val_correct": correct,
        "val_total": total,
        "val_nll": val_nll,
        "weights_hex": encode_vec(fitted["w"]),
        "intercept_hex": encode_vec([fitted["b"]]),
        "mean_hex": encode_vec(mean),
        "sd_hex": encode_vec(sd),
    }
    if b_matrix is not None:
        row["B_hex"] = encode_vec(b_matrix)
        row["c_hex"] = encode_vec(intercept)
    return row


def evaluate_arm(train_x, valid_x, y_train, y_valid, lam, b_matrix=None, intercept=None):
    mean, sd = standardize_fit(train_x)
    z_train = apply_standard(train_x, mean, sd)
    z_valid = apply_standard(valid_x, mean, sd)
    fitted = fit_logistic(z_train, y_train, lam)
    if not fitted["converged"]:
        correct, total, val_nll = 0, int(y_valid.size), None
        train_correct, train_total = 0, int(y_train.size)
    else:
        correct, total, val_nll = predict_stats(fitted["w"], fitted["b"], z_valid, y_valid)
        train_correct, train_total, _train_nll = predict_stats(fitted["w"], fitted["b"], z_train, y_train)
    packed = pack_fit(fitted, correct, total, val_nll, mean, sd, b_matrix, intercept)
    packed["train_correct"] = train_correct
    packed["train_total"] = train_total
    return packed


def better(row, best, has_rate):
    if not row["converged"]:
        return False
    if best is None:
        return True
    if row["val_correct"] != best["val_correct"]:
        return row["val_correct"] > best["val_correct"]
    if row["val_nll"] != best["val_nll"]:
        return row["val_nll"] < best["val_nll"]
    if row["lambda"] != best["lambda"]:
        return row["lambda"] > best["lambda"]
    if not has_rate:
        return False
    return float(row["a"]) > float(best["a"])


def select_grid(rows, has_rate):
    best = None
    for row in rows:
        if better(row, best, has_rate):
            best = row
    return best


def edge_flags(selected, has_rate):
    lam = selected["lambda"]
    flags = {
        "lambda_edge": lam == LAMBDAS[0] or lam == LAMBDAS[-1],
    }
    if has_rate:
        flags["rate_edge"] = selected["a"] == RATES[0] or selected["a"] == RATES[-1]
    return flags


def features_from_states(split, correction):
    if correction is None:
        raise RuntimeError("missing correction")
    b_matrix, intercept = correction
    return split["engine"] - apply_affine(split["initial"], b_matrix, intercept)


def run_select(payload):
    train = stack_episodes(payload["train"])
    valid = stack_episodes(payload["validation"])
    failures = []
    engine_bc = fit_affine(train["initial"], train["engine"])
    rate_bc = {rate: fit_affine(train["initial"], train["integrator"][rate]) for rate in RATES}

    def arm_rows(name, train_x, valid_x, rates, correction_for):
        rows = []
        rate_list = rates if rates is not None else (None,)
        for rate in rate_list:
            tx = train_x if rate is None else train_x[rate]
            vx = valid_x if rate is None else valid_x[rate]
            correction = None if correction_for is None else correction_for(rate)
            for lam in LAMBDAS:
                fitted = evaluate_arm(tx, vx, train["y"], valid["y"], lam, None if correction is None else correction[0], None if correction is None else correction[1])
                fitted["arm"] = name
                fitted["lambda"] = lam
                fitted["a"] = "engine" if rate is None else rate
                rows.append(fitted)
                if not fitted["converged"] or fitted["val_nll"] is None or not np.isfinite(fitted["val_nll"]):
                    failures.append(f"{name} a={fitted['a']} lambda={lam}")
        return rows

    engine_train = features_from_states(train, engine_bc)
    engine_valid = valid["engine"] - apply_affine(valid["initial"], engine_bc[0], engine_bc[1])
    integrator_train = {rate: train["integrator"][rate] - apply_affine(train["initial"], *rate_bc[rate]) for rate in RATES}
    integrator_valid = {rate: valid["integrator"][rate] - apply_affine(valid["initial"], *rate_bc[rate]) for rate in RATES}

    engine_rows = arm_rows("engine_corrected", engine_train, engine_valid, None, lambda _rate: engine_bc)
    integrator_rows = arm_rows("integrator_corrected", integrator_train, integrator_valid, RATES, lambda rate: rate_bc[rate])

    def control_rows(name, train_x, valid_x):
        rows = []
        for lam in LAMBDAS:
            fitted = evaluate_arm(train_x, valid_x, train["y"], valid["y"], lam)
            fitted["arm"] = name
            fitted["lambda"] = lam
            fitted["a"] = "engine"
            rows.append(fitted)
            if not fitted["converged"] or fitted["val_nll"] is None or not np.isfinite(fitted["val_nll"]):
                failures.append(f"{name} lambda={lam}")
        return rows

    raw_rows = control_rows("raw", train["engine"], valid["engine"])
    delta_rows = control_rows("delta", train["engine"] - train["initial"], valid["engine"] - valid["initial"])
    initial_rows = control_rows("initial", train["initial"], valid["initial"])
    final_rows = control_rows("final_input", train["final_input"], valid["final_input"])

    selected_engine = None if failures else select_grid(engine_rows, False)
    selected_integrator = None if failures else select_grid(integrator_rows, True)
    selected_controls = None if failures else {
        "raw": select_grid(raw_rows, False),
        "delta": select_grid(delta_rows, False),
        "initial": select_grid(initial_rows, False),
        "final_input": select_grid(final_rows, False),
    }
    return {
        "failures": failures,
        "engine_rows": public_rows(engine_rows),
        "integrator_rows": public_rows(integrator_rows),
        "control_rows": {
            "raw": public_rows(raw_rows),
            "delta": public_rows(delta_rows),
            "initial": public_rows(initial_rows),
            "final_input": public_rows(final_rows),
        },
        "selected_engine": None if selected_engine is None else public_selected(selected_engine),
        "selected_integrator": None if selected_integrator is None else public_selected(selected_integrator),
        "selected_controls": None if selected_controls is None else {k: public_selected(v) for k, v in selected_controls.items()},
        "edges": None if selected_engine is None else {
            "engine": edge_flags(selected_engine, False),
            "integrator": edge_flags(selected_integrator, True),
        },
    }


def public_rows(rows):
    out = []
    for row in rows:
        out.append({
            "arm": row["arm"],
            "a": row["a"],
            "lambda": row["lambda"],
            "val_correct": row["val_correct"],
            "val_total": row["val_total"],
            "val_nll": row["val_nll"],
            "train_nll": row["train_nll"],
            "grad_inf": row["grad_inf"],
            "converged": row["converged"],
            "train_correct": row["train_correct"],
            "train_total": row["train_total"],
        })
    return out


def public_selected(row):
    kept = {
        "arm": row["arm"],
        "a": row["a"],
        "lambda": row["lambda"],
        "val_correct": row["val_correct"],
        "val_total": row["val_total"],
        "val_nll": row["val_nll"],
        "train_nll": row["train_nll"],
        "grad_inf": row["grad_inf"],
        "converged": row["converged"],
        "train_correct": row["train_correct"],
        "train_total": row["train_total"],
        "weights_hex": row["weights_hex"],
        "intercept_hex": row["intercept_hex"],
        "mean_hex": row["mean_hex"],
        "sd_hex": row["sd_hex"],
    }
    if "B_hex" in row:
        kept["B_hex"] = row["B_hex"]
        kept["c_hex"] = row["c_hex"]
    return kept


def load_selected(row):
    w = decode_vec(row["weights_hex"])
    b = float(decode_vec(row["intercept_hex"])[0])
    mean = decode_vec(row["mean_hex"])
    sd = decode_vec(row["sd_hex"])
    correction = None
    if "B_hex" in row:
        correction = (decode_vec(row["B_hex"]).reshape(12, 12), decode_vec(row["c_hex"]))
    return w, b, mean, sd, correction


def score_arm(episodes, row, feature_fn):
    w, b, mean, sd, _correction = load_selected(row)
    x = feature_fn(episodes, row)
    z = apply_standard(x, mean, sd)
    correct, total, nll = predict_stats(w, b, z, episodes["y"])
    pred = (sigmoid(z @ w + b) >= 0.5).astype(np.int64)
    return pred, correct, total, nll


def run_score(payload):
    test = stack_episodes(payload["test"])
    lock = payload["lock"]
    engine_row = lock["selected_engine"]
    integrator_row = lock["selected_integrator"]
    controls = lock["selected_controls"]

    def corrected_engine(episodes, row):
        _w, _b, _mean, _sd, correction = load_selected(row)
        return episodes["engine"] - apply_affine(episodes["initial"], correction[0], correction[1])

    def corrected_integrator(episodes, row):
        _w, _b, _mean, _sd, correction = load_selected(row)
        rate = row["a"]
        return episodes["integrator"][rate] - apply_affine(episodes["initial"], correction[0], correction[1])

    def raw(episodes, _row):
        return episodes["engine"]

    def delta(episodes, _row):
        return episodes["engine"] - episodes["initial"]

    def initial(episodes, _row):
        return episodes["initial"]

    def final_input(episodes, _row):
        return episodes["final_input"]

    arms = {
        "engine": (engine_row, corrected_engine),
        "integrator": (integrator_row, corrected_integrator),
        "raw": (controls["raw"], raw),
        "delta": (controls["delta"], delta),
        "initial": (controls["initial"], initial),
        "final_input": (controls["final_input"], final_input),
    }
    predictions = {}
    summaries = {}
    for name, (row, fn) in arms.items():
        pred, correct, total, nll = score_arm(test, row, fn)
        predictions[name] = pred
        summaries[name] = {"correct": correct, "total": total, "accuracy": correct / total, "nll": nll}

    seeds = []
    seen = []
    for seed in test["seeds"].tolist():
        if not seen or seen[-1] != seed:
            seen.append(seed)
            seeds.append(seed)
    if len(seeds) != 64:
        raise RuntimeError(f"expected 64 test blocks, found {len(seeds)}")
    y = test["y"]
    block_rows = []
    for seed in seeds:
        mask = test["seeds"] == seed
        if int(mask.sum()) != 4:
            raise RuntimeError("incomplete test block")
        eng = float(np.mean(predictions["engine"][mask] == y[mask]))
        integ = float(np.mean(predictions["integrator"][mask] == y[mask]))
        raw_acc = float(np.mean(predictions["raw"][mask] == y[mask]))
        delta_acc = float(np.mean(predictions["delta"][mask] == y[mask]))
        block_rows.append({
            "seed": int(seed),
            "engine": eng,
            "integrator": integ,
            "difference": eng - integ,
            "raw": raw_acc,
            "delta": delta_acc,
        })

    eng = np.array([row["engine"] for row in block_rows], dtype=np.float64)
    integ = np.array([row["integrator"] for row in block_rows], dtype=np.float64)
    raw_b = np.array([row["raw"] for row in block_rows], dtype=np.float64)
    delta_b = np.array([row["delta"] for row in block_rows], dtype=np.float64)
    rng = np.random.Generator(np.random.PCG64(BOOTSTRAP_SEED))
    draws = rng.integers(0, eng.size, size=(BOOTSTRAP_DRAWS, eng.size))
    eng_boot = eng[draws].mean(axis=1)
    integ_boot = integ[draws].mean(axis=1)
    diff_boot = eng_boot - integ_boot
    raw_boot = raw_b[draws].mean(axis=1)
    delta_boot = delta_b[draws].mean(axis=1)

    def interval(samples):
        lo, hi = np.quantile(samples, [0.025, 0.975], method="linear")
        return {"low": float(lo), "high": float(hi), "width": float(hi - lo)}

    diff_interval = interval(diff_boot)
    eng_interval = interval(eng_boot)
    integ_interval = interval(integ_boot)
    raw_interval = interval(raw_boot)
    delta_interval = interval(delta_boot)
    cue_ok = bool(np.all(y == np.array([1 if int(ep["b1"]) == int(ep["b2"]) else 0 for ep in payload["test"]], dtype=np.int64)))
    leakage_ok = summaries["initial"]["correct"] * 2 == summaries["initial"]["total"] and summaries["final_input"]["correct"] * 2 == summaries["final_input"]["total"]
    return {
        "blocks": block_rows,
        "summaries": summaries,
        "intervals": {
            "difference": diff_interval,
            "engine": eng_interval,
            "integrator": integ_interval,
            "raw": raw_interval,
            "delta": delta_interval,
        },
        "cue_rule_perfect": cue_ok,
        "leakage_exact_half": leakage_ok,
        "bootstrap": {"draws": BOOTSTRAP_DRAWS, "seed": BOOTSTRAP_SEED, "method": "linear", "generator": "PCG64"},
    }


def self_check():
    rng = np.random.default_rng(0)
    z = rng.normal(size=(25, 12))
    y = rng.integers(0, 2, size=25).astype(np.float64)
    w = rng.normal(size=12)
    b = 0.3
    lam = 0.2
    _value, _nll, grad, _hess = objective_grad_hess(w, b, z, y, lam)
    eps = 1e-6
    num = np.zeros_like(grad)
    base, _nll, _grad, _hess = objective_grad_hess(w, b, z, y, lam)
    for i in range(w.size):
        bumped = w.copy()
        bumped[i] += eps
        plus, _, _, _ = objective_grad_hess(bumped, b, z, y, lam)
        num[i] = (plus - base) / eps
    plus_b, _, _, _ = objective_grad_hess(w, b + eps, z, y, lam)
    num[-1] = (plus_b - base) / eps
    err = float(np.max(np.abs(num - grad)))
    if err > 1e-5:
        raise SystemExit(f"gradient check failed: {err}")

    design = rng.normal(size=(40, 13))
    design[:, -1] = 1.0
    true = rng.normal(size=(13, 12))
    target = design @ true
    weight = np.linalg.pinv(design, rcond=RCOND) @ target
    if not np.allclose(weight, true, atol=1e-8):
        raise SystemExit("pseudoinverse check failed")

    centers = np.vstack([np.full(12, -2.0), np.full(12, 2.0)])
    blobs = []
    labels = []
    for k in range(2):
        blobs.append(centers[k] + rng.normal(0, 0.05, size=(40, 12)))
        labels.append(np.full(40, k))
    xb = np.vstack(blobs)
    yb = np.concatenate(labels).astype(np.float64)
    mean, sd = standardize_fit(xb)
    fitted = fit_logistic(apply_standard(xb, mean, sd), yb, 0.01)
    correct, total, _nll = predict_stats(fitted["w"], fitted["b"], apply_standard(xb, mean, sd), yb)
    if not fitted["converged"] or correct != total:
        raise SystemExit(f"toy fit failed: {fitted['converged']} {correct}/{total} grad {fitted['grad_inf']}")

    z0 = np.zeros((8, 12), dtype=np.float64)
    y0 = np.array([0, 1, 0, 1, 0, 1, 0, 1], dtype=np.float64)
    mean0, sd0 = standardize_fit(z0)
    fitted0 = fit_logistic(apply_standard(z0, mean0, sd0), y0, 0.1)
    correct0, total0, _nll = predict_stats(fitted0["w"], fitted0["b"], apply_standard(z0, mean0, sd0), y0)
    if not fitted0["converged"] or correct0 * 2 != total0:
        raise SystemExit(f"balanced constant fit failed: {correct0}/{total0}")
    print(f"self-check ok grad_err={err:.3e} toy={correct}/{total} constant={correct0}/{total0}")


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode == "--self-check":
        self_check()
        return
    payload = json.load(sys.stdin)
    if mode == "--select":
        json.dump(run_select(payload), sys.stdout)
        return
    if mode == "--score":
        json.dump(run_score(payload), sys.stdout)
        return
    raise SystemExit(f"unknown mode {mode}")


if __name__ == "__main__":
    main()
