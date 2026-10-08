# GoatEdit Templates

Whole edits made in [GoatEdit](https://ai.goatedit.com) — the timeline, effects,
3D models, pictures and footage — that anyone can watch, open in the editor and
make their own.

Nothing is downloaded to use one. Every file a template uses lives in this
repository, and the editor streams it straight from here through a CDN.

## How it fits together

```
templates/<id>/
  template.json   name, author, licence, tags, size — what the gallery shows
  project.json    the GoatEdit project; its files are named "./assets/…"
  assets/…        the footage, pictures, audio and 3D models it uses
  preview.mp4     the video the gallery plays
  thumb.jpg       optional still for the card
```

On every push to `main`, the `Publish` workflow runs `scripts/build.mjs`, which:

1. checks every template (see `npm run validate`);
2. writes `index.json`, the list the gallery page and the editor both read;
3. writes each project to `t/<id>.json` with every `./assets/…` turned into a
   link pinned to that exact commit:
   - files up to 20 MB: `https://cdn.jsdelivr.net/gh/<owner>/<repo>@<sha>/templates/<id>/…`
   - larger files: `https://raw.githubusercontent.com/<owner>/<repo>/<sha>/templates/<id>/…`
4. deploys the gallery page, `index.json` and `t/` to GitHub Pages.

A link pinned to a commit never changes, so the CDN keeps it forever and an old
template keeps working however the repository changes later.

## Adding a template

In GoatEdit: **File ▸ Publish as Template**. Fill in the name, author, tags and
licence, choose the preview video (the edit exported as MP4), and press
Publish. The editor uploads the files to a private staging store, and the
editor's `/api/templates/publish` route commits `templates/<id>/` here:

- straight to `main` for an admin (emails listed in the editor deployment's
  `TEMPLATES_ADMIN_EMAILS`) — live a couple of minutes later;
- as a pull request for anyone else — merge it to publish.

Maintainers can still add one by hand: in the dialog, **Save as folder
instead** writes the same folder; put it in `templates/`, check it with
`npm run validate`, commit and push.

## View-only templates

To show an edit without giving away the project — say, to sell it — publish
only the preview and mark it view-only:

```json
{ "access": "view", "buyUrl": "https://your-shop.example/item", "preview": "preview.mp4", … }
```

The folder holds `template.json`, `preview.mp4` and an optional thumbnail —
**no `project.json` and no `assets/`**. This repository is public, so anything
committed here can be downloaded; the build refuses a view-only template that
has either. The gallery plays the preview, marks the card *View only*, and the
viewer's button goes to `buyUrl` (or `authorUrl`). The editor does not list it.
The buyer gets the project from the seller, not from here.

## Removing a template

Delete its folder and push:

```bash
git rm -r templates/<id>
git commit -m "Remove <id>"
git push
```

The next `Publish` run drops it from `index.json` and the gallery. Two things
stay: the files in git history, and the commit-pinned CDN links, so projects
people already opened from it keep working. To purge a file that should never
have been public (personal information, a licence problem), rewrite history
with `git filter-repo` and ask jsDelivr to purge the paths.

## Limits

- **100 MB a file.** GitHub refuses anything bigger. Export footage at the size
  the template needs, as web MP4 (H.264). Most clips end up well under that.
- **20 MB a file for the fast CDN.** Bigger files still work, streamed from
  raw GitHub, but they seek more slowly and are not cached as widely.
- **About 1 GB for the whole repository**, which GitHub recommends. When it
  fills up, start a second repository with this same setup; the editor can read
  more than one gallery.
- **Custom fonts** imported into GoatEdit are not included in a template yet.
  Fonts from GoatEdit's own font list work.

## Rules

- Publish only footage, music, pictures and models you have the right to share
  under the licence you choose. `CC-BY-4.0`, `CC0-1.0`, `CC-BY-NC-4.0` and `MIT`
  are accepted.
- No personal information in the project: names, faces or voices of people who
  have not agreed to it.
- Maintainers may remove any template, at any time.

## Local preview

Node 20 or newer, no dependencies.

```bash
npm run validate   # the checks pull requests run
npm run preview    # build for localhost and serve at http://localhost:4174
```

To open the local templates in a local editor, start the editor with
`VITE_PROJECT_TEMPLATES=http://localhost:4174 npm run dev`.

## Setup (once)

1. Push this repository to GitHub.
2. **Settings ▸ Pages ▸ Build and deployment ▸ Source: GitHub Actions.**
3. Push to `main` (or run the `Publish` workflow). The gallery appears at
   `https://<owner>.github.io/<repo>/`.
4. If it is published anywhere else (a custom domain), set the repository
   variable `PAGES_URL` to that address.
5. The editor reads the gallery from `VITE_PROJECT_TEMPLATES`, which defaults to
   the address in `src/core/project-templates.ts`.
