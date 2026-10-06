"""Frozen candidate analysis; no file access or trajectory generation."""
import numpy as np

RATES = (0.003125, 0.00625, 0.0125, 0.025, 0.05, 0.1, 0.2, 0.32, 0.5, 0.75, 1.0)
LAMBDAS = (0.0001, 0.001, 0.01, 0.1, 1.0, 10.0, 100.0)
ARMS = ('corrected', 'raw', 'delta', 'initial', 'last_input', 'integrator')

def finite(x):
    x = np.asarray(x, dtype=np.float64)
    if not np.isfinite(x).all():
        raise ValueError('nonfinite values')
    return x

def feature(rows, arm, rate=None, correction=None):
    initial = finite([r['initial'] for r in rows])
    final = finite([r['integrators'][format(rate, 'g')] if arm == 'integrator' else r['final'] for r in rows])
    if arm in ('corrected', 'integrator'):
        if correction is None:
            raise ValueError('frozen correction required')
        return final - np.column_stack((initial, np.ones(len(rows)))) @ finite(correction)
    if arm == 'raw': return final
    if arm == 'delta': return final-initial
    if arm == 'initial': return initial
    if arm == 'last_input': return finite([r['inputs'][-1] for r in rows])
    raise ValueError('unknown arm')

def correction_fit(rows, arm, rate):
    initial = finite([r['initial'] for r in rows])
    final = finite([r['integrators'][format(rate, 'g')] if arm == 'integrator' else r['final'] for r in rows])
    return finite(np.linalg.pinv(np.column_stack((initial,np.ones(len(rows)))), rcond=1e-12) @ final)

def objective(theta, x, y, penalty):
    z = x @ theta
    # Stable probabilities without adding epsilon to the loss.
    p = np.exp(-np.logaddexp(0, -z))
    reg = np.full(len(theta), penalty); reg[-1] = 0
    value = np.mean(np.logaddexp(0,z)-y*z) + .5*np.sum(reg*theta*theta)
    if not np.isfinite(value): raise ValueError('nonfinite objective')
    grad = x.T@(p-y)/len(y) + reg*theta
    hess = (x.T*(p*(1-p)))@x/len(y) + np.diag(reg)
    return float(value), finite(grad), finite(hess)

def fit(x, y, penalty):
    x = finite(x); y = finite(y)
    mean = x.mean(axis=0); sd = x.std(axis=0,ddof=0)
    sd[sd < 1e-12] = 1
    design = np.column_stack(((x-mean)/sd,np.ones(len(x))))
    theta = np.zeros(design.shape[1])
    for iteration in range(101):
        value, grad, hess = objective(theta,design,y,penalty)
        if np.max(np.abs(grad)) < 1e-8:
            return {'mean':mean.tolist(),'sd':sd.tolist(),'theta':theta.tolist(),
                    'gradient_inf':float(np.max(np.abs(grad))),'iterations':iteration}
        if iteration == 100: break
        direction = np.linalg.solve(hess,grad)
        slope = float(grad@direction)
        if not np.isfinite(slope) or slope <= 0: raise ValueError('invalid Newton direction')
        for j in range(60):
            step = 2.0**(-j)
            proposed = theta-step*direction
            if objective(proposed,design,y,penalty)[0] <= value-1e-4*step*slope:
                theta = proposed
                break
        else: raise ValueError('line search failed')
    raise ValueError('required fit did not converge')

def score(model, x, y):
    x = finite(x); y = finite(y)
    z = np.column_stack(((x-finite(model['mean']))/finite(model['sd']),np.ones(len(x)))) @ finite(model['theta'])
    finite(z)
    correct = (z >= 0) == y
    return {'accuracy':float(correct.mean()),'log_loss':float(np.mean(np.logaddexp(0,z)-y*z)),
            'correct':correct.astype(int).tolist()}

def select(train, validation):
    y = finite([r['label'] for r in train]); vy = finite([r['label'] for r in validation])
    selected, candidates = {}, []
    for arm in ARMS:
        choices = []
        for rate in (RATES if arm == 'integrator' else (None,)):
            correction = correction_fit(train,arm,rate).tolist() if arm in ('corrected','integrator') else None
            tx = feature(train,arm,rate,correction); vx = feature(validation,arm,rate,correction)
            for penalty in LAMBDAS:
                model = fit(tx,y,penalty)
                result = score(model,vx,vy)
                if arm in ('initial','last_input') and result['accuracy'] != .5:
                    raise ValueError('leakage control failed')
                entry = {'arm':arm,'rate':rate,'lambda':penalty,'correction':correction,
                         'model':model,'validation':result}
                choices.append(entry)
                candidates.append({k:v for k,v in entry.items() if k not in ('model','correction')})
        # Exact float ordering, no unspecified near-tie tolerance.
        selected[arm] = min(choices,key=lambda c:(-c['validation']['accuracy'],c['validation']['log_loss'],
                                                -c['lambda'],-(c['rate'] or 0)))
        selected[arm]['grid_edge'] = {'lambda':selected[arm]['lambda'] in (LAMBDAS[0],LAMBDAS[-1]),
                                     'rate':arm == 'integrator' and selected[arm]['rate'] in (RATES[0],RATES[-1])}
    return selected,candidates

def evaluate(selected, rows):
    y = finite([r['label'] for r in rows]); scores = {}
    if set(selected) != set(ARMS): raise ValueError('missing declared arm')
    for arm,c in selected.items():
        scores[arm] = score(c['model'],feature(rows,arm,c['rate'],c['correction']),y)
        if arm in ('initial','last_input') and scores[arm]['accuracy'] != .5:
            raise ValueError('leakage control failed')
    return scores

def summarize(scores):
    blocks = {arm:finite(s['correct']).reshape(64,4).mean(axis=1) for arm,s in scores.items()}
    if set(blocks) != set(ARMS): raise ValueError('missing declared arm')
    rng = np.random.Generator(np.random.PCG64(20261005))
    indices = rng.integers(0,64,size=(50000,64))
    ci = lambda a: np.quantile(a[indices].mean(axis=1),[.025,.975],method='linear').tolist()
    intervals = {arm:ci(b) for arm,b in blocks.items()}
    delta = blocks['corrected']-blocks['integrator']; interval = ci(delta)
    ceiling = scores['integrator']['accuracy'] > .85
    success = not ceiling and interval[0] > .05 and intervals['corrected'][0] > .5
    verdict = ('UNEXPECTED_TEST_CEILING' if ceiling else 'SUCCESS' if success else
               'MARGIN_RULED_OUT' if interval[1] < .05 else 'NO_BENEFIT_VERDICT')
    return {'verdict':verdict,'success':success,'difference':float(delta.mean()),
            'difference_ci':interval,'difference_ci_width':interval[1]-interval[0],
            'accuracy_intervals':intervals,'paired_block_differences':delta.tolist(),
            'accuracy_interval_widths':{k:v[1]-v[0] for k,v in intervals.items()},
            'block_accuracies':{k:v.tolist() for k,v in blocks.items()},
            'interval_scope':'Approximate percentile coverage; conditional on frozen training and selection.'}
