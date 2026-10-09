# Publishing the independent repository

The repository is published at `https://github.com/donaldtuttle/state-dynamics-engine`.
The demos are hosted at `https://donaldtuttle.github.io/state-dynamics-engine/`.

To publish an independent copy to a new repository, replace `OWNER/REPOSITORY`
with its destination. Use an authenticated GitHub CLI from a checkout without
an `origin` remote:

```bash
gh repo create OWNER/REPOSITORY --public --source=. --remote=origin --push
```

Use `--private` instead if desired. The source includes the `v0.1.0` release tag.
To publish that tag to the independent copy after reviewing the source:

```bash
git push origin v0.1.0
```

The CI workflow verifies each push and pull request. The **Deploy demos**
workflow manually builds, verifies, and deploys the hosted demos to GitHub Pages.
For an independent deployment, set Settings > Pages > Source to GitHub Actions,
then run **Deploy demos** on `main`. Importing the repository does not
automatically publish the applications.

The site uses relative asset paths and works under a GitHub project subpath.
The root page introduces the project and links to the four interfaces.
