# Localization (web)

Folevi ships in English only, but UI strings are moving into a catalog so other languages can be added
without touching components. The mechanism lives in `apps/web/src/i18n/`.

## Pieces

| File | What it does |
| --- | --- |
| `i18n/messages/en.ts` | The English source catalog: `key → ICU-style message`. Keys are namespaced by surface (`sync.*`, `admin.*`, `share.*`). |
| `i18n/icu.ts` | A small ICU MessageFormat subset: `{name}`, `{n, plural, =0 {…} one {# …} other {# …}}`, `{x, select, a {…} other {…}}`, `{n, number}`, `''` for an apostrophe, `'{…}'` for literal braces. Plural categories come from `Intl.PluralRules`. |
| `i18n/index.ts` | `t(key, values)`, `tFor(locale, key, values)` for server components, `setLocale()`, and Intl helpers: `formatDate`, `formatDateTime`, `formatCalendarDate`, `formatNumber`, `formatList`, `localeFromAcceptLanguage`. |

Two locales are tracked separately:

- the **catalog language** (which messages and which plural rules), today always English, and
- the **formatting locale** for dates and numbers: the runtime default in the browser (or an explicit
  `setLocale(tag)` once people can choose a language), and the `Accept-Language` locale in server
  components such as the public share page.

Never hard-code `"en-US"` (or any locale) in `toLocaleDateString`/`Intl.*` calls; use the helpers.

## Migrating a string

1. Add a key to `messages/en.ts` with the **whole sentence**, including every plural or select branch:

   ```ts
   "documents.count": "{count, plural, =0 {No documents} one {# document} other {# documents}}",
   ```

2. Replace the literal in the component: `t("documents.count", { count: docs.length })`.
3. Server components: `tFor(locale, key, values)` with `locale = localeFromAcceptLanguage(headers.get("accept-language"))`.

Rules:

- No hand-built plurals (`n === 1 ? "" : "s"`, `"file(s)"`) and no sentence concatenation
  (`"Imported " + a + " of " + b`). Word order differs between languages; put the whole sentence in one
  message with placeholders.
- `#` in a plural branch prints the locale-formatted number; don't pass pre-formatted numbers to plurals.
- Always include an `other` branch (the parser rejects messages without one). `test/i18n.test.ts`
  parses every catalog entry, so a malformed message fails CI.
- Keep names, titles and other user content as placeholders; never translate them.
- Emails are English-only for now: their copy is authored in `packages/email/scripts/build-templates.ts`
  and doesn't use this catalog.

## Adding a language

Add `messages/<lang>.ts` exporting `Partial<Messages>` with the same keys, register it in `CATALOGS` in
`i18n/index.ts`, and call `setLocale()` with the person's chosen locale. Missing keys fall back to English.

## Status

Migrated: sync status and pending-changes list, the notifications button label, admin workspace member
and session counts, the share page "Last updated" date, and the organization surfaces (document list
counts, command palette results, calendar and task dates, collection filter/row/card counts and dates,
Settings › Sync). Remaining hand-built plurals and
concatenations (owned by other areas, to migrate with the pattern above):

- `components/editor/EditorMenus.tsx`: "`N suggestion(s)`"
- `components/doc/ShareDialog.tsx`: "`N view(s)`"
- `components/doc/ReadOnlyBlocks.tsx`: date mention formatted with a hard-coded `"en-US"` (use `formatCalendarDate`)
- `components/views/settings/DataSection.tsx`: "`Imported X of Y file(s)`"
- `components/marketing/demos/ConnectDemo.tsx`: "`N backlink(s)`"; `ReturnDemo.tsx`: "`N page(s) match(es)`"
