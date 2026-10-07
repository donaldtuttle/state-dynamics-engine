#!/usr/bin/env python3
"""Fail-closed lifecycle for SINGLE-TRAJECTORY-1. No implicit registration."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys

# Fix linear algebra thread counts before importing NumPy.
for variable in ('OPENBLAS_NUM_THREADS','OMP_NUM_THREADS','MKL_NUM_THREADS'):
    os.environ[variable] = '1'
import numpy as np
import analysis

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
PROTOCOL = HERE / 'PROTOCOL.md'
ENGINE_PATH = HERE / 'reference-engine.ts'
ENGINE_HASH = 'db7c664d2fc14b8560ef2e6975f69aca3f640a89d994881baa140dbb7ae6804f'
SPLITS = {'train':list(range(2000,2032)), 'validation':list(range(2032,2048)), 'test':list(range(2048,2112))}
DEV = [9000001,9000002,9000003]
HISTORICAL = sorted(list((ROOT/'docs').glob('*BASELINE*')) +
                    [ROOT/'docs/baseline-result.json'] + list((ROOT/'scripts').glob('baseline-*')))

def digest(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()

def value_hash(value): return hashlib.sha256(canonical(value)).hexdigest()

def load(path):
    def pairs(items):
        result = {}
        for k,v in items:
            if k in result: raise ValueError('duplicate JSON key')
            result[k] = v
        return result
    return json.loads(Path(path).read_text(), object_pairs_hook=pairs,
                      parse_constant=lambda s: (_ for _ in ()).throw(ValueError('nonfinite JSON')))

def write_new(path, value):
    data = canonical(value)
    # Exclusive creation prevents an accidental overwrite/retry of a scored run.
    with Path(path).open('xb') as f:
        f.write(data); f.flush(); os.fsync(f.fileno())

def environment():
    return {'python':platform.python_version(),'numpy':np.__version__,
            'node':subprocess.check_output(['node','--version'],text=True).strip(),
            'platform':platform.platform(),'machine':platform.machine(),
            'numpy_build':str(np.__config__.CONFIG), 'threads':1}

def sources():
    paths = sorted(p for p in HERE.iterdir() if p.suffix in ('.md','.py','.mjs','.txt'))
    paths += [ENGINE_PATH,ROOT/'package-lock.json'] + HISTORICAL
    return {str(p.relative_to(ROOT)):digest(p) for p in paths}

def check_seed(seed, split):
    if type(seed) is not int or not 0 <= seed <= 0xffffffff:
        raise ValueError('numeric uint32 seed required')
    if 1040 <= seed <= 1059: raise ValueError('prohibited seed')
    if split not in SPLITS or seed not in SPLITS[split]:
        raise ValueError('seed outside phase allowlist')

def check_rows(rows, split):
    seeds = SPLITS[split]
    signs = [(-1,-1),(-1,1),(1,-1),(1,1)]
    if len(rows) != 4*len(seeds): raise ValueError('missing or extra episodes')
    for index,r in enumerate(rows):
        seed = seeds[index//4]; pair = signs[index%4]
        check_seed(r['seed'],split)
        if r['seed'] != seed or (r['b1'],r['b2']) != pair or r['label'] != int(pair[0]==pair[1]):
            raise ValueError('block order or label mismatch')
        for name in ('initial','final'):
            x = analysis.finite(r[name])
            if x.shape != (12,) or np.linalg.norm(x) > 2+1e-12: raise ValueError('invalid state')
        if r['initial'] != rows[index-index%4]['initial']: raise ValueError('reset mismatch')
        expected = np.zeros((64,12))
        expected[:8,0] = .5*pair[0]; expected[24:32,1] = .5*pair[1]
        if not np.array_equal(analysis.finite(r['inputs']),expected): raise ValueError('input replay mismatch')
        if set(r['integrators']) != {format(a,'g') for a in analysis.RATES}:
            raise ValueError('rate grid mismatch')
        for endpoint in r['integrators'].values():
            x = analysis.finite(endpoint)
            if x.shape != (12,) or np.linalg.norm(x) > 2+1e-12: raise ValueError('invalid baseline state')
        # Independent label oracle consumes only the two original cue signs.
        if int(r['inputs'][0][0]*r['inputs'][24][1] > 0) != r['label']:
            raise ValueError('cue oracle failed')

def approval(path, phase):
    data = load(path)
    if (data.get('decision') != 'APPROVED' or data.get('phase') != phase or
        data.get('protocol_sha256') != digest(PROTOCOL) or
        not data.get('approved_by') or not data.get('approved_at') or
        not data.get('registration_reference')):
        raise ValueError('explicit approval and registration reference required')
    return data

def audit(path):
    data = load(path)
    expected = {str(p.relative_to(ROOT)):digest(p) for p in HISTORICAL}
    if (data.get('decision') != 'NO_PRIOR_USE' or data.get('splits') != SPLITS or
        data.get('development_seeds') != DEV or data.get('sources') != expected or
        data.get('conflicts') != [] or data.get('owner_attests_unexamined') is not True or
        not data.get('reviewed_by') or not data.get('external_history_scope')):
        raise ValueError('completed seed audit and owner attestation required')
    return data

def seal(value):
    return {'payload':value,'sha256':value_hash(value)}

def unseal(path):
    value = load(path)
    if set(value) != {'payload','sha256'} or value_hash(value['payload']) != value['sha256']:
        raise ValueError('manifest digest mismatch')
    return value['payload']

def verify_validation(directory):
    lock = unseal(directory/'validation-lock.json')
    if (lock.get('schema') != 'single-trajectory-1/validation-lock/v1' or
        lock.get('sources') != sources() or lock.get('environment') != environment() or
        lock.get('splits') != SPLITS or lock.get('engine_sha256') != ENGINE_HASH or
        digest(ENGINE_PATH) != ENGINE_HASH):
        raise ValueError('code, seeds, runtime or engine changed after lock')
    if lock['approval'] != approval(directory/'validation-approval.json','validation'):
        raise ValueError('approval changed')
    if lock['seed_audit'] != audit(directory/'seed-audit.json'): raise ValueError('seed audit changed')
    return lock

def verify_test(directory):
    verify_validation(directory)
    lock = unseal(directory/'test-lock.json')
    expected = {name:digest(directory/name) for name in
                ('validation-lock.json','validation-report.json','selected.json','train.json','validation.json','validation-started.json','validation-completed.json')}
    if (lock.get('schema') != 'single-trajectory-1/test-lock/v1' or lock.get('artifacts') != expected or
        lock.get('approval') != approval(directory/'test-approval.json','test')):
        raise ValueError('fitted artifacts or test approval changed')
    report = load(directory/'validation-report.json')
    if report.get('status') != 'PASS' or (directory/'validation-failed.json').exists():
        raise ValueError('validation did not pass')
    return lock

def verify_completion(directory):
    receipt = unseal(directory/'validation-completed.json')
    expected = {name:digest(directory/name) for name in
                ('validation-lock.json','validation-report.json','selected.json','train.json','validation.json','validation-started.json')}
    if receipt != expected: raise ValueError('validation artifacts changed after completion')

def authorize(directory, split):
    if split not in SPLITS: raise ValueError('unknown split')
    stage = 'test' if split == 'test' else 'validation'
    if stage == 'test': verify_test(directory)
    else: verify_validation(directory)
    attempt = load(directory/f'{stage}-started.json')
    if attempt != {'lock_sha256':digest(directory/f'{stage}-lock.json')}:
        raise ValueError('active attempt does not match lock')
    if any((directory/name).exists() for name in (f'{stage}-report.json', f'{stage}-failed.json')):
        raise ValueError('stage already closed')
    if stage == 'validation' and (directory/'test-lock.json').exists():
        raise ValueError('training and validation closed before test')
    return SPLITS[split]

def generate(directory, split):
    authorize(directory,split)
    result = subprocess.run(['node','--experimental-strip-types',str(HERE/'adapter.mjs'),split,str(directory)],
                            capture_output=True,text=True,check=True)
    rows = json.loads(result.stdout)
    check_rows(rows,split)
    write_new(directory/f'{split}.json',rows)
    return rows

def create_validation_lock(directory, approval_path, audit_path):
    accepted = approval(approval_path,'validation'); reviewed = audit(audit_path)
    if digest(ENGINE_PATH) != ENGINE_HASH: raise ValueError('engine pin changed')
    # An isolated new run directory is required; no reusable locks over old data.
    directory.mkdir(parents=True,exist_ok=False)
    result = subprocess.run(['node','--experimental-strip-types','--input-type=module','-e',
        "import {parity} from './experiments/single-trajectory-1/adapter.mjs'; console.log(JSON.stringify(parity()));"],
        cwd=ROOT,capture_output=True,text=True,check=True)
    parity = json.loads(result.stdout)
    if parity != {'status':'PASS','seeds':DEV,'steps':1152}: raise ValueError('parity failed')
    write_new(directory/'validation-approval.json',accepted)
    write_new(directory/'seed-audit.json',reviewed)
    write_new(directory/'validation-lock.json',seal({
        'schema':'single-trajectory-1/validation-lock/v1','sources':sources(),
        'environment':environment(),'splits':SPLITS,'engine_sha256':ENGINE_HASH,
        'approval':accepted,'seed_audit':reviewed,'parity':parity}))

def run_validation(directory):
    verify_validation(directory)
    write_new(directory/'validation-started.json',{'lock_sha256':digest(directory/'validation-lock.json')})
    try:
        train = generate(directory,'train'); validation = generate(directory,'validation')
        selected,candidates = analysis.select(train,validation)
        status = 'TASK_UNINFORMATIVE' if selected['integrator']['validation']['accuracy'] > .85 else 'PASS'
        write_new(directory/'selected.json',selected)
        write_new(directory/'validation-report.json',{'status':status,'candidates':candidates,
                  'candidate_count':len(candidates),'selected':selected,'test_generated':False})
        write_new(directory/'validation-completed.json',seal({name:digest(directory/name) for name in
                  ('validation-lock.json','validation-report.json','selected.json','train.json','validation.json','validation-started.json')}))
    except Exception as exc:
        write_new(directory/'validation-failed.json',{'status':'INVALID','reason':str(exc)})
        raise

def create_test_lock(directory, approval_path):
    verify_validation(directory)
    verify_completion(directory)
    accepted = approval(approval_path,'test')
    if accepted.get('validation_report_sha256') != digest(directory/'validation-report.json'):
        raise ValueError('test approval must bind the validation report')
    report = load(directory/'validation-report.json')
    if (report.get('status') != 'PASS' or report.get('candidate_count') != 112 or
        report.get('selected') != load(directory/'selected.json') or
        (directory/'validation-failed.json').exists()):
        raise ValueError('validation gate failed')
    if (directory/'test-started.json').exists(): raise ValueError('test already started')
    write_new(directory/'test-approval.json',accepted)
    write_new(directory/'test-lock.json',seal({'schema':'single-trajectory-1/test-lock/v1',
        'approval':accepted,'artifacts':{name:digest(directory/name) for name in
        ('validation-lock.json','validation-report.json','selected.json','train.json','validation.json','validation-started.json','validation-completed.json')}}))

def run_test(directory):
    verify_test(directory)
    write_new(directory/'test-started.json',{'lock_sha256':digest(directory/'test-lock.json')})
    try:
        rows = generate(directory,'test')
        scores = analysis.evaluate(load(directory/'selected.json'),rows)
        write_new(directory/'test-report.json',{'status':'COMPLETE','scores':scores,**analysis.summarize(scores)})
    except Exception as exc:
        write_new(directory/'test-failed.json',{'status':'INVALID','reason':str(exc)})
        raise

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['design-check','lock-validation','run-validation','lock-test','run-test','authorize-generation'])
    parser.add_argument('--directory',type=Path)
    parser.add_argument('--approval',type=Path)
    parser.add_argument('--seed-audit',type=Path)
    parser.add_argument('--split',choices=list(SPLITS))
    args = parser.parse_args()
    if args.command == 'design-check':
        if digest(ENGINE_PATH) != ENGINE_HASH: raise ValueError('engine pin changed')
        print(json.dumps({'status':'DESIGN','protocol_sha256':digest(PROTOCOL),
                          'sources':sources(),'environment':environment(),'generated_trajectories':0},indent=2)); return
    if args.directory is None: raise ValueError('--directory required')
    directory = args.directory.resolve()
    if args.command == 'lock-validation': create_validation_lock(directory,args.approval,args.seed_audit)
    elif args.command == 'run-validation': run_validation(directory)
    elif args.command == 'lock-test': create_test_lock(directory,args.approval)
    elif args.command == 'run-test': run_test(directory)
    elif args.command == 'authorize-generation': print(json.dumps(authorize(directory,args.split)))

if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(f'SINGLE-TRAJECTORY-1 blocked: {error}',file=sys.stderr)
        sys.exit(1)
