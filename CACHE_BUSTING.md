# Automatic asset cache busting

GitHub Pages is published directly from the `main` branch using GitHub's built-in Jekyll Pages pipeline.

`index.html` and `bootstrap.js` include YAML front matter so Jekyll processes them during the Pages build. They both use GitHub Pages' current build revision as a shared asset version.

As a result, deployed local CSS and JavaScript URLs receive the current commit SHA as their `v` query value. The same revision is also applied to the local dynamic imports loaded by `bootstrap.js`.

This means:

- CSS and JavaScript versions change automatically on every deployment.
- Manual `v=1`, `v=2`, and similar version bumps are no longer needed.
- The site uses only the built-in GitHub Pages deployment, so there is no second custom Pages workflow competing for the deployment slot.
- External URLs such as the Supabase CDN import are never rewritten.
