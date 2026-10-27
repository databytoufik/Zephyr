# Working on Zephyr

- Commits and pull requests are authored by the repository owner only. Do not add Claude as author or co-author:
  no `Co-Authored-By` lines, no `Claude-Session` links, no "Generated with Claude Code" lines.
- Static site, no build step. Keep it dependency-free.
- Run `npm test` before committing. After editing `js/palettes.js`, run `node tools/build-themes.mjs`.
- When you change any file the app loads, bump `VERSION` in `sw.js` and keep its file list complete (a test checks it).
- Keep the IndexedDB name `oscar` (existing users' documents live there).
- Theme names describe colours only.
