# Publishing the independent repository

Suggested repository name: `state-dynamics-engine`.
The source is ready for a new repository. No remote repository or live URL is
assumed by the README or application.

From an authenticated GitHub CLI on your machine:

```bash
gh repo create donaldtuttle/state-dynamics-engine --public --source=. --remote=origin --push
```

Use `--private` instead if desired. The prepared repository has a `main` branch
and a `v0.1.0` tag. Push the tag explicitly after reviewing the source:

```bash
git push origin v0.1.0
```

The CI workflow verifies each push and pull request. For hosted demos, set
Settings > Pages > Source to GitHub Actions, then run the **Deploy demos** workflow.
Deployment is manual, so importing the repository does not automatically publish
the applications. The workflow builds and verifies before deploying.

The site uses relative asset paths and works under a GitHub project subpath.
The root page introduces the project and links to the four interfaces.

After the successor has been published and checked, the historical README can
link to it. Archiving the historical repository is a separate later action;
this migration neither archives it nor rewrites its history.
