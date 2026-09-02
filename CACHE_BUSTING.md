# Automatic asset cache busting

GitHub Pages is built from `main` by `.github/workflows/deploy-pages.yml`.

During deployment, `scripts/build-pages.py` copies the static site to `dist/` and rewrites every local CSS/JS reference that uses `?v=...` to the first 12 characters of the deployment commit SHA.

Example source:

```html
<link rel="stylesheet" href="library.css?v=1">
<script type="module" src="bootstrap.js?v=3"></script>
```

Example deployed artifact for commit `abcdef123456...`:

```html
<link rel="stylesheet" href="library.css?v=abcdef123456">
<script type="module" src="bootstrap.js?v=abcdef123456"></script>
```

Dynamic imports such as `import('./app.js?v=6')` are rewritten the same way.

This means developers no longer need to bump asset versions manually when CSS or JavaScript changes.
