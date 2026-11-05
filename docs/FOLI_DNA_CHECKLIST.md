# Foli DNA: checklist (5 November 2026, all built the same day)

Foli DNA is the page at `/graph` (called Graph until 5 November 2026): a space's notes, the links between them
and, on Pro, the people, projects, organizations, topics and decisions Foli AI finds in them. Web:
`apps/web/src/components/views/GraphView.tsx`. Mac and iPad: native SwiftUI Canvas,
`apps/native-kit/Sources/FoleviMac/Views/More/GraphScreen.swift`, fed by the engine's `graph` view (positions
from the web's own force layout, `lib/graph/layout.ts`). Engine, route, data and API names stay "graph".

Looked at: Obsidian (global and local graph, depth, filters, colour groups by search, forces, arrows,
time-lapse), Logseq (graph, journals and orphans toggles, page graph in the sidebar), Heptabase (whiteboards,
cards placed by hand, sections), Capacities (typed objects, object graph), Reflect (backlinks and a graph), Roam
(page graph). Common complaint: big global graphs are pretty but don't help you find anything. What helps is
the local view, filters and the "what should I link?" step.

What Foli DNA lacks today: no view around one note, nothing for one folder or tag, no colours by folder or tag,
no time view, no way to act on what it shows (link, merge, open beside), no saved views, it doesn't live
update while you write in a note beside it, and it's not on the iPhone in its own right (only through the
desk screen).

Everything below is built on the web, the Mac and the iPad (the iPhone gets the same screen in its phone layout).
Where the build differs from the line as first written:
- Clusters are named by what they share (the entity most of their notes mention, else their best-connected note),
  not by a Foli AI call: no credits are spent just by opening the map. "Ask Foli AI to sum up" sits beside each one.
- "Filter by place": the map follows the place picked in the sidebar's account menu, as every page does; there is
  no second place picker on the map.
- Colour groups: by folder or by first tag (not by a search, as Obsidian's are).
- Published pages show the note's own links only (never backlinks), and only pages its readers can open; it is
  off until turned on per link (Share > the link's "Foli DNA" chip).
- Very large spaces: up to 500 notes and 2,500 lines (was 300 and 1,500), drawn lighter past 400 nodes (one path
  for quiet lines, labels for hubs only). Metal drawing was not needed at this size.

Recommended order (as it was): top to bottom.

## 1. Around one note (highest value)
- [x] "Foli DNA of this note" in the note's ••• menu and Inspector: the note, its links and backlinks, depth 1 to 3
- [x] A small live Foli DNA panel in the Inspector that follows the open note (like Obsidian's local graph)
- [x] Open a node beside the current note (split or new tab) with ⌘-click / long press

## 2. Filters that answer questions
- [x] Filter by folder, tag, place and date edited (one custom Select, no OS menus)
- [x] Hide or show orphans (notes with no links) and a count of them, with "Link these" as a next step
- [x] Colour nodes by folder colour or by tag (colour groups), with a legend
- [x] Depth slider and "show only links" vs "links and Foli AI's finds"

## 3. Act from the map (turns a picture into a tool)
- [x] Missing connections: dashed suggested lines from `aiGraph.missingConnections`, accept with one click to add the link
- [x] Possible duplicates and contradictions marked on the map, opening the existing Related panel actions
- [x] Select several nodes (drag a box, Shift-click) then Move, Bookmark, Tag or Ask Foli AI about them
- [x] Ask Foli AI "what connects these?" or "sum up this cluster" from a selection

## 4. Clusters and meaning
- [x] Automatic clusters (communities) shaded behind nodes, each named by Foli AI ("Kyoto trip", "Hiring")
- [x] Bridge notes: highlight notes that join two clusters
- [x] Hubs list: the 10 best-connected notes and entities, as a side list

## 5. Time
- [x] Time-lapse: play the map growing by note creation date (Obsidian has it; good for marketing too)
- [x] "Since last week" highlight: new notes and new links glow

## 6. Layout and feel
- [x] Drag a node to pin it, double-click to unpin; pinned spots saved per space
- [x] Layout controls (spacing, pull to centre) in a small panel, with a Reset
- [x] Smooth animated zoom to a node on search Enter, and focus mode (dim everything 2 steps away)
- [x] Arrows on links (direction: which note links to which)
- [x] Live update while writing: a new [[link]] draws its line without reloading

## 7. Saved views and sharing
- [x] Save a view (filters, colours, zoom) by name; show saved views in the sidebar under Foli DNA
- [x] Export the map as PNG or SVG; copy as Markdown list (the List view already has the data)
- [x] Include a Foli DNA snapshot in a published page (read only)

## 8. Platforms and plans
- [x] iPhone: its own Foli DNA screen (phone layout, pinch and pan, sheet for an entity's notes) instead of the desk screen
- [x] Local mode (library on this Mac): links-only Foli DNA (planned L3 in `lib/local/registry.ts`)
- [x] Very large spaces: draw with Metal or a level-of-detail pass past 2,000 nodes; raise the `GRAPH_LIMITS` cap
- [x] Keyboard and VoiceOver pass on Mac and iPad (rotor of nodes, same as the web's List view)
- [x] folevi.com: a Foli DNA feature section with a moving picture (from the time-lapse)

## Fixes after the owner's report on 1.2.32 (5 November 2026, Mac)
"Foli DNA is really buggy, note shows up behind." Fixed on the Mac, iPad and iPhone (one SwiftUI screen):
- The note from another tab showed through: the screen's fill was the card's 90% glass over the waiting note page.
  It's now laid over the canvas (`ScreenRoot` in Screens.swift), which also fixes Help, Reviews and shared folders.
- The map wasn't fitted, and zooming and dragging only showed late: the Canvas drew from a body that never read the
  zoom and pan, so the fit was computed and thrown away. The body now reads what the drawing uses; the map also
  fits again when positions change (not only when the set of notes does), never to a zero size, and is clipped.
- Most notes were bare dots: labels now go on every note whose label has room (no overlap with another label or dot,
  inside the map), best-connected first; hubs may sit beside a dot when the map is near full size.
- Cluster names ran under the filter bar and were covered by dots: the fit takes in each cluster's wash and name,
  and names are drawn on top with a halo.
- Dotted rings on dots with no lines: a bridge is marked only when its lines on the map reach another cluster.
- The filter bar was two crowded rows: one row for Map or List, search, the count and the actions (play, layout,
  Insights, export, saved views as icons), and one short row of four filters and a Show menu holding the kinds and
  the on/off choices (it says how many differ from a fresh map; on the phone it comes first).
- Tests: `apps/native-kit/Tests/FoleviMacTests/DnaSnapshotTests.swift`, on the scripted engine's map
  (`Demo/DemoGraph.swift`, 44 notes like the report's): Mac, iPad and iPhone sizes, light and dark, a red stand-in
  note behind that must not show, and checks of labels, fit and bridges. Rendered on the Mac.
