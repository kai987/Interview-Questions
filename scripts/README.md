# Build scripts

- `build-pages.py`: creates the GitHub Pages artifact and rewrites CSS/JS `?v=` values to the current commit SHA.
- `verify-pages-build.py`: checks that the generated `dist/index.html` no longer contains the old hand-maintained numeric asset versions.
