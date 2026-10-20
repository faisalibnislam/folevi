# Flowchart v2 plan (2026-10-21)

The owner wants the flowchart block to be as capable as Miro's flowcharts, and smarter. Everything below was chosen by the owner; nothing is optional. Existing flowcharts must open unchanged (v1 data is migrated on read, never lost), and the read-only view, share pages, exports (PNG, SVG, PDF, Copy as image), Mermaid conversion, full canvas, local mode and the Mac app keep working.

## Connectors
- Connection points on every side of every shape; any number of connectors per shape and per side, spread evenly along the side so they never stack. Dragging a connector end near a shape snaps to its nearest side or point.
- Smart routing: elbow (right-angle, the default), curved and straight. Routes go around other shapes, re-route live as shapes move, avoid overlapping other connectors where possible, and draw small hops where two lines cross.
- Bend points: drag a connector's middle to add a bend point, drag points to reshape, double-click a point to remove it.
- Styling: arrowheads at the start, end, both or neither (several heads: arrow, open arrow, circle, diamond, bar); solid, dashed or dotted; thickness; colour; labels that can sit anywhere along the line (drag to move) and several labels per connector.
- Reconnect and detach: drag either end to another shape or point; an end can float loose on the canvas; select several connectors and change their style together.

## Building faster
- Quick add arrows: hovering a shape shows a + arrow on each side. Click to add the next shape, already connected and placed neatly (no overlaps, aligned to the flow); drag it out to choose the shape type at the drop point.
- Keyboard flow: Tab adds a connected next shape, Shift+Tab a sibling branch, arrow keys move between shapes, Enter edits, typing replaces the text, Esc steps back. A whole flow can be written without the mouse.
- Drop a connector in empty space: a small shape picker appears where it was let go, creating the shape it points to.
- Containers and swimlanes: frames that group shapes and move with them; swimlanes with titled rows or columns that shapes snap into; resizing a lane reflows its shapes.

## Shapes and content
- Full flowchart library: terminator, process, decision, data (input/output), document, multiple documents, database (stored data), manual input, manual operation, predefined process, delay, preparation, merge, extract, off-page link, on-page connector, display, internal storage, and more, in a searchable panel (custom panel, not an OS control).
- Basic shapes (rectangle, rounded rectangle, circle, ellipse, triangle, diamond, hexagon, parallelogram, star, arrows, callouts, cloud, cylinder) and an icon set to place inside or beside shapes.
- Rich text in shapes: bold, italic, underline, strike, lists, links, alignment; text fits the shape and the shape can grow with its text (auto-height option).
- Images in shapes (drop or paste an image; uses Folevi's file storage, and the local library in local mode), and a longer note or a link to a Folevi page on any shape (shown as a small badge; opens on click).

## Intelligence
- Foli AI builds and extends: describe a process and Foli AI draws it; select a shape and ask for the next steps or missing branches; turn a note, list or selection into a flowchart.
- Foli AI checks and explains: finds dead ends, unlabelled decision branches, unreachable shapes and loops; explains the diagram in words; suggests clearer labels. Results are previewed and applied as one undo step; credits as other Foli AI actions; hidden when AI is off; works in local mode through the local AI layer where the model allows.
- Very good Tidy up: a layered layout (top-down or left-right) that keeps branches balanced, keeps decision branches readable (yes/no on consistent sides), minimises crossings, respects containers and swimlanes, and keeps manual tweaks where possible. Align and distribute for selections, and smart guides while dragging. When the deterministic layout can't make a diagram readable (many crossings, odd structure), offer "Tidy up with Foli AI", which asks the model for a better arrangement and applies it through the same layout engine.
- Present and follow a path: step through the flow shape by shape (full canvas, arrow keys), or highlight one path from a start to an end for walkthroughs.

## How it is built
- Data and geometry live in packages/editor-schema (flowchart.ts, flowchartGeometry.ts, flowchartLayout.ts, a new flowchartRouting.ts, flowchartSvg.ts), pure and heavily tested, shared by the editor, read-only views, exports, the server (Foli AI) and local mode.
- The editor in apps/web/src/components/editor/flowchart/ is split into focused modules (selection, dragging, connecting, text editing, quick add, keyboard, panels) so several builders can work in parallel.
- House rules: neutral chrome, custom controls only, corner tokens, no emoji, no em dashes, "Foli AI" by name, 44 pt targets on touch, light and dark.
