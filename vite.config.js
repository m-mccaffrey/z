import { defineConfig } from 'vite';

// Relative base so the built site works from a GitHub Pages project
// path (https://<user>.github.io/<repo>/) without hard-coding the repo name.
export default defineConfig({
    base: './',
});
