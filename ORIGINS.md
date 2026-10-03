# Origins

State Dynamics Engine is an independent software project derived from
[donaldtuttle/qoft-calculus](https://github.com/donaldtuttle/qoft-calculus/tree/1ab947e0cb75afaf0e7ecad11a8aa5e02b510ebc).

- Source commit: `1ab947e0cb75afaf0e7ecad11a8aa5e02b510ebc`.
- Source engine Git blob: `e492c1d51ff5f8bf4ee1b7a4ff5a1135440ce6d5`.
- Original author and copyright holder: Donald Tuttle.
- Original project: QOFT/QOSMOS, including its Public Typed Realization A and
  the separate Memory Weather implementation.
- License: MPL-2.0, retained without modification.

The historical repository remains the reference for its research notation,
operator contracts, adoption records, and development history. Those documents
are not rewritten or adopted as the specification of this successor.

The initial migration preserves numerical formulas, numeric defaults, seeded
random streams, and update order. It changes public names, basin labels,
documentation, application branding, export schemas, and identifiers used in
diagnostic hashes. Its numerical preservation claim is limited to the tested
cases described in [VERIFICATION.md](docs/VERIFICATION.md).

The successor's source history begins with the migration. Upstream history is
available through the pinned repository link. No claim of algorithmic novelty,
physical validity, or external-task advantage follows from renaming the software.

The original NOTICE is retained losslessly as an ASCII-escaped JSON string in
[docs/upstream-notice.json](docs/upstream-notice.json), with its SHA-256. Decoding
the `originalNotice` value reconstructs the original UTF-8 content. It is an
attribution record, not an active runtime contract.

Related experiments, maintained separately:

- [HME](https://github.com/donaldtuttle/HME): field and ledger memory experiments.
- [Historical source documentation and demo links](https://github.com/donaldtuttle/qoft-calculus/blob/1ab947e0cb75afaf0e7ecad11a8aa5e02b510ebc/README.md).

The original repository has not been archived or modified by this migration.
