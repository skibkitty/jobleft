# Spec: Ship browser extension as a release asset

## Context
The browser extension exists and works (apps/extension/*, server side pairing/extension services, UI tab in Settings), but it is not distributed. The extension is built into dist/ locally but not shipped in releases; the Chrome Web Store submission remains open. This spec proposes releasing the extension as a zip asset attached to GitHub releases and adding install instructions in the app.

## Goals
- Ship `jobleft-autofill-<app-version>.zip` as a release asset (platform-independent) so users can load unpacked in Chrome.
- Pin the extension ID with a `key` in `manifest.json` so the ID is stable regardless of extraction path.
- Update Settings UI to show clear install instructions linking to latest release.
- Update relevant docs to reflect the new distribution method.
- Do not change Tauri/Rust/NSIS installer (no bundling in installer in this iteration; see deferred).

## Constraints
- Branch off `main` (not build-windows-script). Open a separate PR.
- Keep existing behavior: extension still uses pairing code flow; no new server routes.
- Do not commit private keys.
- The asset version name uses app version from `apps/server/package.json` (e.g. 0.1.3). Extension package.json can remain as-is.
- Keep phrasing consistent with repo (e.g. "It fills; you review; you submit.").

## Changes

### 1) Pin extension ID in manifest
File: `apps/extension/manifest.json`
- Add top-level field `key` with base64 DER of an RSA-2048 SubjectPublicKeyInfo (public key only).
  - Generate: `node -e "const{generateKeyPairSync}=require('node:crypto');const k=generateKeyPairSync('rsa',{modulusLength:2048});console.log(k.publicKey.export({type:'spki',format:'der'}).toString('base64'))"`
- The build script (`apps/extension/scripts/build.ts`) already serializes manifest and only overwrites `version` (and may adjust host_permissions/name for test builds) so `key` passes through unchanged.

### 2) Update extension README
File: `apps/extension/README.md`
- Section 3: Add a "Downloaded zip" path (load unpacked from extracted dist) before/alongside existing from-source instructions.
- Section 5: Add a rule: "The extension id never changes (pinned via manifest.key)."

### 3) Update Settings UI with install instructions
File: `apps/ui/src/screens/Settings.tsx`
- In `ExtensionTab()`:
  - Keep existing panel description and pairing UI.
  - Add clear install steps below pairing/button area:
    1. Download `jobleft-autofill-<your version>.zip` from the jobleft releases page: `https://github.com/Blueturboguy07/jobleft/releases/latest`.
    2. Unzip it.
    3. Open `chrome://extensions`, turn on Developer mode, click Load unpacked.
    4. Choose the folder that contains `manifest.json`.
    5. Pin the extension, then click "Show a pairing code" and enter code+port in the popup.
- No new server routes; no mock changes required. Hardcode the releases URL as precedent shows.

Note: `evals/gate7-ui/shots/text.json` snapshot may need regeneration if UI text changes; this is expected.

### 4) Update workflow to build/zip/attach extension
File: `.github/workflows/windows.yml`
- After "Build the UI" step, add:
```yaml
      - name: Build the extension and zip it
        shell: pwsh
        run: |
          pnpm --filter @jobleft/extension build
          $v = (Get-Content apps/server/package.json -Raw | ConvertFrom-Json).version
          Compress-Archive -Path apps/extension/dist/* -DestinationPath "jobleft-autofill-$v.zip" -Force
          "asset: jobleft-autofill-$v.zip"
```
- After "Keep the installer", add artifact upload:
```yaml
      - name: Keep the extension zip
        uses: actions/upload-artifact@v4
        with:
          name: jobleft-extension
          path: jobleft-autofill-*.zip
          if-no-files-found: error
```
- In "Attach to the release" step (runs on workflow_dispatch with release_tag), add second upload:
```bash
gh release upload "$TAG" "jobleft-autofill-$VERSION.zip" --clobber
```
(derive VERSION from apps/server/package.json same way, or reuse).

### 5) Update docs
- `README.md`: add note that extension can be downloaded from releases and loaded unpacked in Chrome.
- `apps/extension/README.md`: as above.
- `docs/INTERFACES.md`: update note about Chrome Web Store submission (still open, but zip ships with releases).
- `docs/BUILD-REPORT.md`: reflect zip asset and build command.
- `docs/PLAN.md`: keep G-store as approved-to-submit context (or clarify).
- Also consider `docs/outcomes/sys-licence.md` obligations if wording changes (keep "fills; you review; you submit" and don't imply autofill submits).

## Verification
1. Build extension: `pnpm --filter @jobleft/extension build` -> `apps/extension/dist/manifest.json` has `key` and correct `version`.
2. Unzip dist to two different paths, load both in Chrome -> same extension ID (proves pinned key works).
3. Pair with local app (`pnpm app:up`), test fill; moving folder doesn't break pairing.
4. Tests: `pnpm --filter @jobleft/extension test`, typecheck; run extension scenario if Chrome available: `node qa/bin/run-all.mjs extension`.
5. PR checks: new artifact uploads; existing replay/CI still green.

## Deferred (not in this PR)
- Bundle extension into Tauri installer/resources (PR 2). Would require copying dist to resources/extension, updating tauri.conf.json bundle.resources, and updating build scripts; Settings could optionally show resource path. Not needed now.

## Implementation notes
- No server API changes. No changes to contracts beyond none.
- UI text must not claim versions match exactly; say zip name matches app version.
- Chrome dev-mode unpacked extensions may be disabled on restart on some systems - Settings copy can note this if observed, but don't overstate. Keep copy simple.
