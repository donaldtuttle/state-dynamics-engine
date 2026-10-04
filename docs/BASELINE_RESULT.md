# Baseline result

Status: RUN once. The rules in [docs/BASELINE_PROPOSAL.md](BASELINE_PROPOSAL.md) were not changed after these scores.

Primary arm only: projection, memory, summaries, and noise off. This result says nothing about memory or basin projection.

## Lock

Horizon walk, in order, using validation seeds 1030-1039 only. A horizon above 0.90 was not scored on the test seeds. The next shorter prefix was tried, and then one more. Nothing was locked for a test score.

- H=64: integrator 40/40 at a=0.32, lambda=100. Engine 11/40 at lambda=100. No rate extension. Original-grid choice a=0.32 flipped to 0.2 when 0.32 was removed. Both chosen lambdas sat on the grid edge (100). The lambda grid was not extended.
- H=32: integrator 40/40. The original five rates chose a=0.5, lambda=0.01, then the edge rule added 0.75 and 1.0. The cap was hit at a=1.0. Engine 11/40 at lambda=100, a grid edge. Dropping 0.5 from the original grid would have chosen 0.32. The selected rate was not replaced.
- H=16: integrator 40/40. Same edge path, cap hit at a=1.0, lambda=0.01. Engine 11/40 at lambda=0.1, not a lambda edge. Dropping 0.5 from the original grid would have chosen 0.32. The selected rate was not replaced.

Mean Euclidean distance between the two final states on the validation sequences: 0.807094 at H=64, 0.922644 at H=32, and 0.994599 at H=16.

The H=16 grids are the last pilot, not a test setting.

Engine validation grid at H=16:

| a | lambda | validation correct | converged |
| --- | --- | --- | --- |
| engine | 0.01 | 10/40 | yes |
| engine | 0.1 | 11/40 | yes |
| engine | 1 | 10/40 | yes |
| engine | 10 | 10/40 | yes |
| engine | 100 | 10/40 | yes |

Integrator validation grid at H=16, after the two allowed extensions:

| a | lambda | validation correct | converged |
| --- | --- | --- | --- |
| 0.05 | 0.01 | 30/40 | yes |
| 0.05 | 0.1 | 30/40 | yes |
| 0.05 | 1 | 30/40 | yes |
| 0.05 | 10 | 30/40 | yes |
| 0.05 | 100 | 30/40 | yes |
| 0.1 | 0.01 | 30/40 | yes |
| 0.1 | 0.1 | 30/40 | yes |
| 0.1 | 1 | 30/40 | yes |
| 0.1 | 10 | 30/40 | yes |
| 0.1 | 100 | 30/40 | yes |
| 0.2 | 0.01 | 30/40 | yes |
| 0.2 | 0.1 | 30/40 | yes |
| 0.2 | 1 | 30/40 | yes |
| 0.2 | 10 | 30/40 | yes |
| 0.2 | 100 | 30/40 | yes |
| 0.32 | 0.01 | 40/40 | yes |
| 0.32 | 0.1 | 30/40 | yes |
| 0.32 | 1 | 30/40 | yes |
| 0.32 | 10 | 30/40 | yes |
| 0.32 | 100 | 30/40 | yes |
| 0.5 | 0.01 | 40/40 | yes |
| 0.5 | 0.1 | 30/40 | yes |
| 0.5 | 1 | 30/40 | yes |
| 0.5 | 10 | 30/40 | yes |
| 0.5 | 100 | 30/40 | yes |
| 0.75 | 0.01 | 40/40 | yes |
| 0.75 | 0.1 | 30/40 | yes |
| 0.75 | 1 | 30/40 | yes |
| 0.75 | 10 | 30/40 | yes |
| 0.75 | 100 | 30/40 | yes |
| 1.0 | 0.01 | 40/40 | yes |
| 1.0 | 0.1 | 30/40 | yes |
| 1.0 | 1 | 30/40 | yes |
| 1.0 | 10 | 30/40 | yes |
| 1.0 | 100 | 30/40 | yes |

## Inputs

For every training and validation seed, the recorded `sampleInput` vectors matched the input strength of `run()` at the same mode, seed, and tick, and the final 12-number state matched `run()`. The four generators did not depend on the seed. `quiet` was the zero vector. No projection events fired. Test seeds were not loaded.

## Readout

Multinomial logistic regression, reference class `quiet` fixed at zero weights and zero bias. Other classes have an unpenalized bias. The penalty is `(lambda / 2)` times the sum of squared weights. The data term is the mean negative log likelihood on the training rows. Newton stopped below a gradient infinity norm of `1e-8`. The same training coefficients scored validation. Bootstrap settings were fixed in the scorer and were not used, because the test seeds were not scored.

## Verdict

The tuned integrator's validation accuracy was 40/40 at 64, 32, and 16 ticks. The predeclared ceiling is 0.90, so each of those horizons was uninformative. Test seeds were not scored. There is no benefit verdict, and there is no interval.

The engine's validation accuracy stayed at 11/40, or 10/40 at the other penalties. That is the pilot, not a test result. The stop rule does not turn it into evidence that the engine is worse, and it does not permit scoring the test seeds after seeing it.

The original five-rate choice of `a` flipped when its winning rate was removed, at every horizon. Those choices were not replaced. Memory and projection were not run. This result says nothing about them.

No second run was used to replace these numbers.
