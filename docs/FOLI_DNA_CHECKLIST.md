# Foli DNA: what's next (checklist, 5 November 2026)

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

Recommended order: top to bottom.

## 1. Around one note (highest value)
- [ ] "Foli DNA of this note" in the note's ••• menu and Inspector: the note, its links and backlinks, depth 1 to 3
- [ ] A small live Foli DNA panel in the Inspector that follows the open note (like Obsidian's local graph)
- [ ] Open a node beside the current note (split or new tab) with ⌘-click / long press

## 2. Filters that answer questions
- [ ] Filter by folder, tag, place and date edited (one custom Select, no OS menus)
- [ ] Hide or show orphans (notes with no links) and a count of them, with "Link these" as a next step
- [ ] Colour nodes by folder colour or by tag (colour groups), with a legend
- [ ] Depth slider and "show only links" vs "links and Foli AI's finds"

## 3. Act from the map (turns a picture into a tool)
- [ ] Missing connections: dashed suggested lines from `aiGraph.missingConnections`, accept with one click to add the link
- [ ] Possible duplicates and contradictions marked on the map, opening the existing Related panel actions
- [ ] Select several nodes (drag a box, Shift-click) then Move, Bookmark, Tag or Ask Foli AI about them
- [ ] Ask Foli AI "what connects these?" or "sum up this cluster" from a selection

## 4. Clusters and meaning
- [ ] Automatic clusters (communities) shaded behind nodes, each named by Foli AI ("Kyoto trip", "Hiring")
- [ ] Bridge notes: highlight notes that join two clusters
- [ ] Hubs list: the 10 best-connected notes and entities, as a side list

## 5. Time
- [ ] Time-lapse: play the map growing by note creation date (Obsidian has it; good for marketing too)
- [ ] "Since last week" highlight: new notes and new links glow

## 6. Layout and feel
- [ ] Drag a node to pin it, double-click to unpin; pinned spots saved per space
- [ ] Layout controls (spacing, pull to centre) in a small panel, with a Reset
- [ ] Smooth animated zoom to a node on search Enter, and focus mode (dim everything 2 steps away)
- [ ] Arrows on links (direction: which note links to which)
- [ ] Live update while writing: a new [[link]] draws its line without reloading

## 7. Saved views and sharing
- [ ] Save a view (filters, colours, zoom) by name; show saved views in the sidebar under Foli DNA
- [ ] Export the map as PNG or SVG; copy as Markdown list (the List view already has the data)
- [ ] Include a Foli DNA snapshot in a published page (read only)

## 8. Platforms and plans
- [ ] iPhone: its own Foli DNA screen (phone layout, pinch and pan, sheet for an entity's notes) instead of the desk screen
- [ ] Local mode (library on this Mac): links-only Foli DNA (planned L3 in `lib/local/registry.ts`)
- [ ] Very large spaces: draw with Metal or a level-of-detail pass past 2,000 nodes; raise the `GRAPH_LIMITS` cap
- [ ] Keyboard and VoiceOver pass on Mac and iPad (rotor of nodes, same as the web's List view)
- [ ] folevi.com: a Foli DNA feature section with a moving picture (from the time-lapse)
