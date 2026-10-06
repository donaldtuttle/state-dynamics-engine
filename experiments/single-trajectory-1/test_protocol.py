"""Synthetic tests only. No engine study trajectories are generated."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import analysis as a
import run as r

def synthetic_rows(split):
    # Seed integers are metadata for ingestion tests, never passed to an engine.
    rows=[]
    for index,seed in enumerate(r.SPLITS[split]):
        for b1,b2 in ((-1,-1),(-1,1),(1,-1),(1,1)):
            initial=[(index%7)/20]+[0]*11
            final=[b1*b2/4,b1/8,b2/8]+[0]*9
            inputs=np.zeros((64,12)); inputs[:8,0]=.5*b1; inputs[24:32,1]=.5*b2
            rows.append(dict(seed=seed,b1=b1,b2=b2,label=int(b1==b2),initial=initial,final=final,
                inputs=inputs.tolist(),integrators={format(rate,'g'):[b1/8,b2/8]+[0]*10 for rate in a.RATES}))
    return rows

class Algebra(unittest.TestCase):
    def test_gradient_and_hessian(self):
        x=np.array([[1.,0,1],[-1,2,1],[.5,-1,1],[0,2,1]])
        y=np.array([1,0,1,0]); theta=np.array([.2,-.3,.1]); eps=1e-5
        _,g,h=a.objective(theta,x,y,.1)
        for i in range(3):
            d=np.eye(3)[i]*eps
            np.testing.assert_allclose((a.objective(theta+d,x,y,.1)[0]-a.objective(theta-d,x,y,.1)[0])/(2*eps),g[i],atol=1e-9)
            np.testing.assert_allclose((a.objective(theta+d,x,y,.1)[1]-a.objective(theta-d,x,y,.1)[1])/(2*eps),h[:,i],atol=1e-9)

    def test_affine_correction_and_single_episode_inference(self):
        rows=synthetic_rows('train'); coef=a.correction_fit(rows,'corrected',None)
        f=a.feature(rows,'corrected',correction=coef)
        np.testing.assert_allclose(a.feature(rows[:1],'corrected',correction=coef),f[:1])
        np.testing.assert_allclose(f.mean(axis=0),0,atol=1e-14)
        # Altering validation endpoints cannot alter already fitted correction.
        saved=coef.copy(); other=synthetic_rows('validation'); other[0]['final'][0]=99
        a.feature(other,'corrected',correction=coef)
        np.testing.assert_array_equal(saved,coef)

    def test_constant_features_and_unpenalized_intercept(self):
        x=np.zeros((8,12)); y=np.array([1,1,1,1,1,1,0,0])
        m=a.fit(x,y,100)
        np.testing.assert_allclose(m['theta'][-1],np.log(3),atol=1e-6)
        self.assertEqual(m['sd'],[1]*12)
        self.assertEqual(m['theta'][:-1],[0]*12)

    def test_complete_selection_and_controls(self):
        selected,candidates=a.select(synthetic_rows('train'),synthetic_rows('validation'))
        self.assertEqual(len(candidates),112)
        self.assertEqual(selected['initial']['validation']['accuracy'],.5)
        self.assertEqual(selected['last_input']['validation']['accuracy'],.5)
        self.assertEqual(selected['integrator']['rate'],1)
        self.assertEqual(selected['integrator']['lambda'],100)
        self.assertEqual(selected['corrected']['validation']['accuracy'],1)
        self.assertEqual(set(a.evaluate(selected,synthetic_rows('test'))),set(a.ARMS))

    def test_fit_failure_is_not_skipped(self):
        with patch.object(a,'fit',side_effect=ValueError('required fit failed')):
            with self.assertRaisesRegex(ValueError,'fit failed'):
                a.select(synthetic_rows('train'),synthetic_rows('validation'))
        with self.assertRaises(ValueError): a.fit([[np.nan]],[0],.1)

    def test_paired_bootstrap_and_ceiling(self):
        scores={arm:{'correct':[1,0,1,0]*64,'accuracy':.5} for arm in a.ARMS}
        result=a.summarize(scores)
        self.assertEqual(result['difference_ci'],[0,0]); self.assertFalse(result['success'])
        scores['corrected']={'correct':[1]*256,'accuracy':1}
        result=a.summarize(scores)
        self.assertTrue(result['success']); self.assertEqual(result['difference_ci'],[.5,.5])
        self.assertEqual(result,a.summarize(scores))
        scores['integrator']={'correct':[1]*256,'accuracy':1}
        self.assertEqual(a.summarize(scores)['verdict'],'UNEXPECTED_TEST_CEILING')

class Guards(unittest.TestCase):
    def make_locked_fixture(self, root):
        # Test-only approval records live in a temporary directory. No real
        # experiment or generator is called; these exercise lifecycle plumbing.
        p=root/'run'; approval=root/'approval.json'; audit=root/'audit.json'
        r.write_new(approval,{'decision':'APPROVED','phase':'validation',
            'approved_by':'SYNTHETIC UNIT TEST','approved_at':'fixture',
            'registration_reference':'SYNTHETIC UNIT TEST', 'protocol_sha256':r.digest(r.PROTOCOL)})
        r.write_new(audit,{'decision':'NO_PRIOR_USE','reviewed_by':'SYNTHETIC UNIT TEST',
            'external_history_scope':'synthetic fixture only','owner_attests_unexamined':True,
            'conflicts':[],'splits':r.SPLITS,'development_seeds':r.DEV,
            'sources':{str(q.relative_to(r.ROOT)):r.digest(q) for q in r.HISTORICAL}})
        real_run=r.subprocess.run
        def parity_only(command, **kwargs):
            if '--input-type=module' in command:
                return r.subprocess.CompletedProcess(command,0,json.dumps({'status':'PASS','seeds':r.DEV,'steps':1152}), '')
            return real_run(command,**kwargs)
        with patch.object(r.subprocess,'run',side_effect=parity_only):
            r.create_validation_lock(p,approval,audit)
        return p

    def synthetic_generate(self, directory, split):
        r.authorize(directory,split)
        rows=synthetic_rows(split); r.check_rows(rows,split)
        r.write_new(directory/f'{split}.json',rows)
        return rows

    def test_two_locks_complete_synthetic_lifecycle_and_no_rerun(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); p=self.make_locked_fixture(root)
            with patch.object(r,'generate',side_effect=self.synthetic_generate):
                r.run_validation(p)
                with self.assertRaises(FileNotFoundError): r.run_test(p)
                approval=root/'test-approval.json'
                r.write_new(approval,{'decision':'APPROVED','phase':'test',
                    'approved_by':'SYNTHETIC UNIT TEST','approved_at':'fixture',
                    'registration_reference':'SYNTHETIC UNIT TEST','protocol_sha256':r.digest(r.PROTOCOL),
                    'validation_report_sha256':r.digest(p/'validation-report.json')})
                r.create_test_lock(p,approval)
                with self.assertRaises(ValueError): r.authorize(p,'train')
                r.run_test(p)
                self.assertEqual(r.load(p/'test-report.json')['status'],'COMPLETE')
                with self.assertRaises(FileExistsError): r.run_test(p)
                with self.assertRaises(ValueError): r.authorize(p,'test')
                (p/'selected.json').write_text('{}')
                with self.assertRaises(ValueError): r.verify_test(p)

    def test_ceiling_blocks_second_lock(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); p=self.make_locked_fixture(root)
            selected,candidates=a.select(synthetic_rows('train'),synthetic_rows('validation'))
            selected['integrator']['validation']['accuracy']=1
            with patch.object(r,'generate',side_effect=self.synthetic_generate), \
                 patch.object(a,'select',return_value=(selected,candidates)):
                r.run_validation(p)
            self.assertEqual(r.load(p/'validation-report.json')['status'],'TASK_UNINFORMATIVE')
            approval=root/'test-approval.json'
            r.write_new(approval,{'decision':'APPROVED','phase':'test',
                'approved_by':'SYNTHETIC UNIT TEST','approved_at':'fixture',
                'registration_reference':'SYNTHETIC UNIT TEST','protocol_sha256':r.digest(r.PROTOCOL),
                'validation_report_sha256':r.digest(p/'validation-report.json')})
            with self.assertRaisesRegex(ValueError,'gate failed'): r.create_test_lock(p,approval)
            self.assertFalse((p/'test-lock.json').exists())

    def test_seed_and_complete_block_guards(self):
        for seed in range(1040,1060):
            for split in r.SPLITS:
                with self.assertRaises(ValueError): r.check_seed(seed,split)
        for seed in (2048,'2000',True,2000.0,-1,2**32+2000):
            with self.assertRaises(ValueError): r.check_seed(seed,'train')
        rows=synthetic_rows('train'); r.check_rows(rows,'train')
        with self.assertRaises(ValueError): r.check_rows(rows[:-1],'train')
        rows[1]['label']=1
        with self.assertRaises(ValueError): r.check_rows(rows,'train')

    def test_reset_and_input_checks(self):
        rows=synthetic_rows('validation'); rows[1]['initial'][0]+=.01
        with self.assertRaisesRegex(ValueError,'reset'): r.check_rows(rows,'validation')
        rows=synthetic_rows('validation'); rows[0]['inputs'][-1][0]=.5
        with self.assertRaisesRegex(ValueError,'input'): r.check_rows(rows,'validation')

    def test_approval_requires_actual_decision_and_digest(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'approval.json'; r.write_new(p,{'decision':'DESIGN'})
            with self.assertRaises(ValueError): r.approval(p,'validation')

    def test_exclusive_files_and_manifest_tamper(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'lock.json'; r.write_new(p,r.seal({'a':1}))
            with self.assertRaises(FileExistsError): r.write_new(p,{'a':2})
            value=r.load(p); value['payload']['a']=2; p.write_text(json.dumps(value))
            with self.assertRaisesRegex(ValueError,'digest'): r.unseal(p)

    def test_missing_locks_fail_before_generation(self):
        with tempfile.TemporaryDirectory() as d, patch.object(r.subprocess,'run') as spawn:
            with self.assertRaises(FileNotFoundError): r.run_test(Path(d))
            with self.assertRaises(FileNotFoundError): r.run_validation(Path(d))
            spawn.assert_not_called()

    def test_generation_closed_after_report_or_failure(self):
        with tempfile.TemporaryDirectory() as d, patch.object(r,'verify_validation'):
            p=Path(d); r.write_new(p/'validation-lock.json',{})
            r.write_new(p/'validation-started.json',{'lock_sha256':r.digest(p/'validation-lock.json')})
            self.assertEqual(r.authorize(p,'train'),r.SPLITS['train'])
            r.write_new(p/'validation-failed.json',{'status':'INVALID'})
            with self.assertRaisesRegex(ValueError,'closed'): r.authorize(p,'train')

    def test_changed_runtime_or_source_invalidates_lock(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d); r.write_new(p/'validation-lock.json',r.seal({
                'schema':'single-trajectory-1/validation-lock/v1','sources':{},'environment':{},
                'splits':r.SPLITS,'engine_sha256':r.ENGINE_HASH}))
            with self.assertRaisesRegex(ValueError,'changed'): r.verify_validation(p)

    def test_validation_failure_is_terminal(self):
        with tempfile.TemporaryDirectory() as d, patch.object(r,'verify_validation'), \
             patch.object(r,'generate',side_effect=ValueError('synthetic reset defect')):
            p=Path(d); r.write_new(p/'validation-lock.json',{})
            with self.assertRaisesRegex(ValueError,'reset'): r.run_validation(p)
            self.assertEqual(r.load(p/'validation-failed.json')['status'],'INVALID')
            with self.assertRaises(FileExistsError): r.run_validation(p)

    def test_completion_receipt_detects_changed_coefficients(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)
            names=('validation-lock.json','validation-report.json','selected.json','train.json','validation.json','validation-started.json')
            for name in names: r.write_new(p/name,{})
            r.write_new(p/'validation-completed.json',r.seal({name:r.digest(p/name) for name in names}))
            r.verify_completion(p)
            (p/'selected.json').write_text('{"changed":true}')
            with self.assertRaisesRegex(ValueError,'changed'): r.verify_completion(p)

if __name__ == '__main__': unittest.main()
