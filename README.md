# wafflewealth-app
WaffleWealth: Net Worth Projection

The app's website, served by GitHub Pages. No source code lives here.

- `index.html` + `assets/` — the landing page, edited here: this repository is the only copy
- `try/` — the demo in the browser
- `statements/` — read a bank statement in the browser (under development; reads on the device, connects nowhere)
- `web/` — WaffleWealth on the web: sign in with an Apple ID, upload statements and add transactions to the user's own private iCloud (CloudKit JS). The CloudKit web token goes in `web/app.js` (`CONFIG.apiToken`); until then the page offers the example only. Tests: `node --test web/tests/*.test.mjs`, and with jsdom installed `node web/tests/page.test.cjs`
- `support.md` — support page, the App Store's support URL target (`/support`)
- `privacy.md` — privacy policy (`/privacy`)
