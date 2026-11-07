# App components

Review the interactive library at `/components`. Its sample tender and form are local previews. The ranking uses the recorded testnet result from `config/evidence.ts`.

The header's Typography button opens a comparison of Public Sans, Barlow and the original Inter pairing across the review page while retaining form values. The tender app now uses locally hosted Public Sans for UI and IBM Plex Mono for technical references, reusing the licensed assets in `app/components/fonts/`. The landing page keeps its original typography.

The tender app places a light workspace inside the dark frame. Inside `.app-workspace`, `.ui-paper` panels use white surfaces. Layout and responsive rules live in `app/tenders/app.css`; shared component tokens remain here. `FlowSteps` describes the real creation and bid sequences. Creation keeps editable values in component state between steps; bid plaintext stays in memory and is never persisted by the UI. Read-only browsing does not initialize the wallet connector for a visitor without a saved wallet session.

Import `components/ui/ui.css` in the app route's layout and wrap the app in `.app-theme`. Tokens are scoped to that class so app styling can develop independently of the landing page. Import components directly from their files.

Use `.ui-paper` inside that wrapper for white working surfaces. It provides dark text, light input fills, dark primary actions, and status colors with sufficient contrast on paper. Tender cards, the sample bid form, evaluation results and dialogs use this surface. The dark canvas frames those working areas. Controls use filled surfaces instead of permanent outlines; keyboard focus remains a visible 3px ring. UI text starts at 13px, body text at 14px to 15px, with weights 500 and 600.

Avoid leading accent stripes on controls or menu rows. Invalid fields use the danger surface fill and an associated error message. Dropdown rows have 4px of space between their fills so hovered and selected options stay visually separate.

Functional icons use a selected Remix Icon subset in `icons/`, with filled domain symbols and matching action symbols. Labels generally stand alone; add an icon where it conveys an action or status. The upstream license and source manifest are retained alongside the paths.

```tsx
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

<Button onClick={openCreateDialog}>
  <Icon name="plus" />
  Create tender
</Button>;
```

| Component                    | Contract                                                                                                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`, `ButtonLink`       | Primary, secondary, ghost, danger. Small or medium. Loading disables repeated activation. Use links for navigation.                                                                 |
| `TextField`, `TextAreaField` | Visible labels, associated hints and errors, native input attributes. Callers supply validation.                                                                                    |
| `SelectField`                | Controlled Radix select with an `options` array, `value` and `onValueChange`. Supports keyboard navigation, typeahead, disabled options, named form values and required validation. |
| `Badge`                      | Neutral, violet, success, warning, danger. Text and optional icons express meaning alongside color.                                                                                 |
| `Tabs`                       | Controlled selection, associated panels, arrow keys, Home and End, one tab stop in the tab list.                                                                                    |
| `Dialog`                     | Controlled native modal with labelled title and description, Escape, backdrop dismissal, contained tab focus, and focus restoration.                                                |
| `CopyButton`                 | Copies the supplied full value, reports success or failure, and clears its timer on unmount.                                                                                        |
| `EmptyState`, `SkeletonRows` | An explicit next action when empty and a named loading status.                                                                                                                      |

Domain components live in `components/app/`: `TenderCard`, `Lifecycle`, `RankingTable`, `Notice`, and `TransactionNotice`. Feed them typed data and actions. RPC, wallet signing, encryption, and verification belong outside the presentation components. Flag wording comes from `@tender/shared`.

Import `SelectField` from `ui/select-field.tsx` (also re-exported by `ui/field.tsx`). Each option has a non-empty `value`, a `label` and an optional `disabled` flag. Use `value=""` with `placeholder` for an empty selection; pass `name` for native `FormData`. The menu inherits its field's light or dark surface, matches the trigger width and stays inside the viewport. Its portal stays inside the field so it also works in a native `Dialog`. The selected row uses an inset dark fill on white surfaces and an inverse fill on dark surfaces, with a check icon. Keyboard focus and pointer hover have their own fill treatment.

Keep preview fixtures in `content/component-preview.ts`. Do not reuse them as production defaults. Production amounts, hashes, account IDs, and network values must come from validated data and app configuration.

Local browser review: `python scratch/component-review/qa.py`. Its screenshots, receipt download, and check report are in the ignored `scratch/component-review/` directory. It covers controls, validation, focus, clipboard failure, downloads, five viewport sizes, reduced motion, and server-rendered content.

Select review: `python scratch/component-review/qa-select.py`. The isolated fixture is bundled by `node scratch/component-review/select/build-fixture.mjs` before running it. This checks pointer/touch selection, keyboard navigation, native form values and required validation, disabled options, long lists and use inside a dialog. Open-menu screenshots and the report are in `scratch/component-review/select/`.
