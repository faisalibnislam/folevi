# Writes fixtures/merge-scenarios.json (the readable source of the golden scenarios).
# Checksums are filled in by: UPDATE_GOLDEN=1 npx vitest run test/merge-scenarios.test.ts
import json, os

R = {
  "doc_lww": "doc fields: last write wins by c",
  "doc_causal": "doc fields: causality first (a later edit wins even with an older clock)",
  "title": "concurrent title change: history version and notice",
  "tags": "tags: add-wins OR-set",
  "dominates": "content: cv(A) >= cv(B) takes A",
  "concurrent": "content: concurrent, newer c wins, loser to history, cv = max",
  "identical": "content: concurrent identical edits lose nothing",
  "delete": "delete counts as a content write (delete vs edit)",
  "position": "position: last write wins on (parentId, rank), no notice",
  "collapsed": "collapsed: last write wins, no notice",
  "maps": "files, fileText, versionNames, collections, row values: last write wins per key",
  "notices": "notices: union, dismissal last write wins",
  "seen": "seen: pointwise max",
  "stub": "permanent delete: the stub drops only edits it has seen",
  "restore": "permanent delete: an unseen edit brings the note back in Trash with a restored notice",
  "orphan": "after merge: a missing or deleted parent moves the block to the top level",
  "cycle": "after merge: a cycle from concurrent moves is re-rooted at the block moved last",
  "rank": "after merge: ranks tie-break by (rank, id)",
  "compacted": "compacted tombstones stay gone (a stale copy can't bring them back)",
  "stale": "stale copies and duplicates change nothing",
  "threeway": "three-way concurrency converges",
  "skew": "clock skew only changes which concurrent edit wins, never whether one is kept",
}

def op(on, o, at=None, **kw):
  d = {"on": on, "op": o}
  if at is not None: d["at"] = at
  d.update(kw)
  return d

def base(text="base", title="Trip"):
  return [op("A", "create", 1000, doc={"title": title}), op("A", "upsert", 1001, block={"id": "B1", "text": text}), {"send": "A", "to": "B"}]

def expect(on="A", **kw):
  return {"expect": kw, "on": on}

DAY = 24 * 3600 * 1000
FAR = 1_000_000_000_000  # a device clock years ahead

S = []
S.append({"name": "doc_field_concurrent_newer_wins_silently", "rule": R["doc_lww"], "steps": base() + [
  op("A", "field", 2000, name="folderId", value="F1"),
  op("B", "field", 3000, name="folderId", value="F2"),
  {"exchange": ["A", "B"]},
  expect(fields={"folderId": "F2"}, losses=[], notices=[], converged=["B"]),
]})
S.append({"name": "doc_field_causal_edit_beats_skewed_clock", "rule": R["doc_causal"], "steps": base() + [
  op("B", "field", FAR, name="folderId", value="F2"),
  {"send": "B", "to": "A"},
  op("A", "field", 2000, name="folderId", value="F3"),
  {"exchange": ["A", "B"]},
  expect(fields={"folderId": "F3"}, losses=[], notices=[], converged=["B"]),
]})
S.append({"name": "concurrent_title_change_keeps_both", "rule": R["title"], "steps": base() + [
  op("A", "field", 2000, name="title", value="Trip to Rome"),
  op("B", "field", 3000, name="title", value="Trip to Paris"),
  {"exchange": ["A", "B"]},
  expect(title="Trip to Paris", losses=[{"target": "doc.title", "from": "A"}],
         notices=[{"kind": "changed", "target": "doc.title", "from": "B", "other": "A", "dismissed": False}], converged=["B"]),
]})
S.append({"name": "sequential_title_changes_make_no_notice", "rule": R["title"], "steps": base() + [
  op("A", "field", 2000, name="title", value="Trip to Rome"),
  {"send": "A", "to": "B"},
  op("B", "field", 3000, name="title", value="Rome"),
  {"exchange": ["A", "B"]},
  expect(title="Rome", losses=[], notices=[]),
]})
S.append({"name": "tags_add_wins_over_concurrent_remove", "rule": R["tags"], "steps": [
  op("A", "create", 1000, doc={"title": "Trip"}),
  {"send": "A", "to": "B"}, {"send": "A", "to": "C"},
  op("A", "tag", 1100, id="T1"), op("A", "tag", 1101, id="T2"),
  {"send": "A", "to": "B"},
  op("B", "untag", 2000, id="T1"), op("B", "untag", 2001, id="T2"),
  op("C", "tag", 2500, id="T1"),
  {"exchange": ["B", "C"]}, {"exchange": ["A", "B"]}, {"exchange": ["A", "C"]},
  expect(tags=["T1"], converged=["B", "C"]),
]})
S.append({"name": "tag_re_added_after_remove", "rule": R["tags"], "steps": [
  op("A", "create", 1000, doc={"title": "Trip"}), op("A", "tag", 1100, id="T1"),
  {"send": "A", "to": "B"},
  op("B", "untag", 2000, id="T1"),
  op("A", "untag", 2100, id="T1"), op("A", "tag", 2200, id="T1"),
  {"exchange": ["A", "B"]},
  expect(tags=["T1"], converged=["B"]),
]})
S.append({"name": "edit_after_seeing_wins_without_conflict", "rule": R["dominates"], "steps": base() + [
  op("B", "text", 2000, block="B1", text="two"),
  {"send": "B", "to": "A"},
  op("A", "text", 3000, block="B1", text="three"),
  {"exchange": ["A", "B"]},
  expect(text={"B1": "three"}, losses=[], notices=[], converged=["B"]),
]})
S.append({"name": "edit_after_seeing_wins_over_skewed_newer_clock", "rule": R["skew"], "steps": base() + [
  op("B", "text", FAR, block="B1", text="from the future"),
  {"send": "B", "to": "A"},
  op("A", "text", 3000, block="B1", text="later, causally"),
  {"exchange": ["A", "B"]},
  expect(text={"B1": "later, causally"}, losses=[], notices=[], converged=["B"]),
]})
S.append({"name": "skewed_device_wins_only_a_concurrent_tie_and_the_other_is_kept", "rule": R["skew"], "steps": base() + [
  op("B", "text", FAR, block="B1", text="skewed"),
  op("A", "text", 5000, block="B1", text="honest"),
  {"exchange": ["A", "B"]},
  expect(text={"B1": "skewed"}, losses=[{"target": "B1", "from": "A"}],
         notices=[{"kind": "changed", "target": "B1", "from": "B", "other": "A", "dismissed": False}], converged=["B"]),
]})
S.append({"name": "concurrent_edits_newer_wins_older_to_history", "rule": R["concurrent"], "steps": base() + [
  op("A", "text", 2000, block="B1", text="from A"),
  op("B", "text", 3000, block="B1", text="from B"),
  {"exchange": ["A", "B"]},
  expect(text={"B1": "from B"}, losses=[{"target": "B1", "from": "A"}],
         notices=[{"kind": "changed", "target": "B1", "from": "B", "other": "A", "dismissed": False}], converged=["B"]),
  op("A", "text", 4000, block="B1", text="after the merge"),
  {"exchange": ["A", "B"]},
  expect(text={"B1": "after the merge"}, losses=[{"target": "B1", "from": "A"}], converged=["B"]),
]})
S.append({"name": "concurrent_identical_edits_lose_nothing", "rule": R["identical"], "steps": base() + [
  op("A", "text", 2000, block="B1", text="same"),
  op("B", "text", 3000, block="B1", text="same"),
  {"exchange": ["A", "B"]},
  expect(text={"B1": "same"}, losses=[], notices=[], converged=["B"]),
]})
S.append({"name": "delete_vs_newer_edit_edit_wins_deletion_to_history", "rule": R["delete"], "steps": base() + [
  op("A", "delete", 2000, block="B1"),
  op("B", "text", 3000, block="B1", text="edited"),
  {"exchange": ["A", "B"]},
  expect(text={"B1": "edited"}, losses=[{"target": "B1", "from": "A"}],
         notices=[{"kind": "changed", "target": "B1", "from": "B", "other": "A", "dismissed": False}], converged=["B"]),
]})
S.append({"name": "edit_vs_newer_delete_deleted_edit_to_history", "rule": R["delete"], "steps": base() + [
  op("A", "text", 2000, block="B1", text="edited"),
  op("B", "delete", 3000, block="B1"),
  {"exchange": ["A", "B"]},
  expect(text={"B1": None}, losses=[{"target": "B1", "from": "A"}],
         notices=[{"kind": "deleted", "target": "B1", "from": "B", "other": "A", "dismissed": False}], converged=["B"]),
]})
S.append({"name": "concurrent_deletes_lose_nothing", "rule": R["delete"], "steps": base() + [
  op("A", "delete", 2000, block="B1"),
  op("B", "delete", 3000, block="B1"),
  {"exchange": ["A", "B"]},
  expect(text={"B1": None}, losses=[], notices=[], converged=["B"]),
]})
S.append({"name": "restore_after_delete_is_a_content_write", "rule": R["delete"], "steps": base() + [
  op("A", "delete", 2000, block="B1"),
  {"send": "A", "to": "B"},
  op("B", "restore", 3000, block="B1"),
  {"exchange": ["A", "B"]},
  expect(text={"B1": "base"}, losses=[], notices=[], converged=["B"]),
]})
S.append({"name": "concurrent_moves_last_writer_wins_no_notice", "rule": R["position"], "steps": [
  op("A", "create", 1000, doc={"title": "Trip"}),
  op("A", "upsert", 1001, block={"id": "P1", "text": "one", "rank": "M"}),
  op("A", "upsert", 1002, block={"id": "P2", "text": "two", "rank": "T"}),
  op("A", "upsert", 1003, block={"id": "C1", "text": "child", "parentId": "P1", "rank": "V"}),
  {"send": "A", "to": "B"},
  op("A", "move", 2000, block="C1", parentId="P2", rank="V"),
  op("B", "move", 3000, block="C1", parentId=None, rank="Z"),
  {"exchange": ["A", "B"]},
  expect(parent={"C1": None}, losses=[], notices=[], tree=[["P1", None], ["P2", None], ["C1", None]], converged=["B"]),
]})
S.append({"name": "move_and_concurrent_edit_both_kept", "rule": R["position"], "steps": base() + [
  op("A", "move", 2000, block="B1", parentId=None, rank="Z"),
  op("B", "text", 3000, block="B1", text="edited"),
  {"exchange": ["A", "B"]},
  expect(text={"B1": "edited"}, losses=[], notices=[], converged=["B"]),
]})
S.append({"name": "collapsed_is_independent_of_text_and_last_writer_wins", "rule": R["collapsed"], "steps": [
  op("A", "create", 1000, doc={"title": "Trip"}),
  op("A", "upsert", 1001, block={"id": "T1", "type": "toggle", "text": "Details"}),
  {"send": "A", "to": "B"},
  op("A", "collapse", 2000, block="T1", value=True),
  op("B", "text", 2500, block="T1", text="More details"),
  {"exchange": ["A", "B"]},
  expect(text={"T1": "More details"}, collapsed={"T1": True}, losses=[], notices=[], converged=["B"]),
  op("A", "collapse", 3000, block="T1", value=False),
  op("B", "collapse", 4000, block="T1", value=True),
  {"exchange": ["A", "B"]},
  expect(collapsed={"T1": True}, losses=[], notices=[], converged=["B"]),
]})
S.append({"name": "side_maps_last_writer_wins_per_key", "rule": R["maps"], "steps": [
  op("A", "create", 1000, doc={"title": "Trip"}),
  op("A", "file", 1001, id="F1", palette=["#000000"]),
  {"send": "A", "to": "B"},
  op("A", "file", 2000, id="F1", palette=["#111111"]),
  op("B", "file", 3000, id="F1", palette=["#222222"]),
  op("A", "fileText", 3500, id="F1", text="alpha"),
  op("B", "fileText", 2500, id="F1", text="beta"),
  op("A", "versionName", 3600, file="v1.fver", name="Before trip"),
  op("B", "versionName", 3700, file="v2.fver", name="After trip"),
  op("A", "rowValue", 3800, property="P1", value="Rome"),
  op("B", "rowValue", 3900, property="P1", value="Paris"),
  op("B", "rowValue", 3950, property="P2", value=3),
  {"exchange": ["A", "B"]},
  expect(palette={"F1": ["#222222"]}, fileText={"F1": "alpha"}, versionNames={"v1.fver": "Before trip", "v2.fver": "After trip"},
         row={"P1": "Paris", "P2": 3}, losses=[], notices=[], converged=["B"]),
]})
S.append({"name": "notices_union_and_dismissal_spreads", "rule": R["notices"], "steps": [
  op("A", "create", 1000, doc={"title": "Trip"}),
  op("A", "upsert", 1001, block={"id": "B1", "text": "one", "rank": "M"}),
  op("A", "upsert", 1002, block={"id": "B2", "text": "two", "rank": "T"}),
  {"send": "A", "to": "B"}, {"send": "A", "to": "C"},
  op("A", "text", 2000, block="B1", text="A1"),
  op("B", "text", 3000, block="B1", text="B1"),
  op("A", "text", 2100, block="B2", text="A2"),
  op("C", "text", 3100, block="B2", text="C2"),
  {"exchange": ["A", "B"]}, {"exchange": ["A", "C"]}, {"exchange": ["B", "C"]},
  expect(notices=[
    {"kind": "changed", "target": "B1", "from": "B", "other": "A", "dismissed": False},
    {"kind": "changed", "target": "B2", "from": "C", "other": "A", "dismissed": False}], converged=["B", "C"]),
  op("A", "dismiss", 4000, target="B1"),
  {"exchange": ["A", "B"]}, {"exchange": ["B", "C"]},
  expect(on="C", notices=[
    {"kind": "changed", "target": "B1", "from": "B", "other": "A", "dismissed": True},
    {"kind": "changed", "target": "B2", "from": "C", "other": "A", "dismissed": False}], converged=["A", "B"]),
]})
S.append({"name": "three_way_concurrent_edits_converge", "rule": R["threeway"], "steps": [
  op("A", "create", 1000, doc={"title": "Trip"}),
  op("A", "upsert", 1001, block={"id": "B1", "text": "base"}),
  {"send": "A", "to": "B"}, {"send": "A", "to": "C"},
  op("A", "text", 2000, block="B1", text="A"),
  op("B", "text", 3000, block="B1", text="B"),
  op("C", "text", 4000, block="B1", text="C"),
  {"exchange": ["A", "B"]}, {"exchange": ["B", "C"]}, {"exchange": ["A", "C"]},
  expect(text={"B1": "C"}, losses=[{"target": "B1", "from": "A"}, {"target": "B1", "from": "B"}], seen=["A", "B", "C"], converged=["B", "C"]),
]})
S.append({"name": "seen_is_pointwise_max", "rule": R["seen"], "steps": [
  op("A", "create", 1000, doc={"title": "Trip"}),
  {"send": "A", "to": "B"}, {"send": "A", "to": "C"},
  op("B", "field", 2000, name="starred", value=True),
  op("C", "field", 3000, name="archivedAt", value=3000),
  {"exchange": ["A", "B"]},
  expect(seen=["A", "B"]),
  {"exchange": ["A", "C"]},
  expect(seen=["A", "B", "C"], fields={"starred": True, "archivedAt": 3000}),
]})
S.append({"name": "permanent_delete_drops_seen_edits", "rule": R["stub"], "steps": base() + [
  op("A", "text", 2000, block="B1", text="seen by B"),
  {"send": "A", "to": "B"},
  op("B", "permanentDelete", 3000),
  {"exchange": ["A", "B"]},
  expect(stub=True, converged=["B"]),
]})
S.append({"name": "two_permanent_deletes_merge_into_one_stub", "rule": R["stub"], "steps": base() + [
  op("A", "permanentDelete", 2000),
  op("B", "permanentDelete", 3000),
  {"exchange": ["A", "B"]},
  expect(stub=True, seen=["A", "B"], converged=["B"]),
]})
S.append({"name": "unseen_edit_brings_the_note_back_in_trash", "rule": R["restore"], "steps": base() + [
  op("A", "text", 2000, block="B1", text="written offline"),
  op("B", "permanentDelete", 3000),
  {"exchange": ["A", "B"]},
  expect(stub=False, trashed=True, text={"B1": "written offline"},
         notices=[{"kind": "restored", "target": "doc.", "from": "B", "dismissed": False}], converged=["B"]),
  {"exchange": ["A", "B"]},
  expect(stub=False, trashed=True, converged=["B"]),
]})
S.append({"name": "deleted_parent_moves_children_to_the_top", "rule": R["orphan"], "steps": [
  op("A", "create", 1000, doc={"title": "Trip"}),
  op("A", "upsert", 1001, block={"id": "P1", "text": "parent", "rank": "M"}),
  op("A", "upsert", 1002, block={"id": "C1", "text": "child", "parentId": "P1", "rank": "M"}),
  {"send": "A", "to": "B"},
  op("A", "delete", 2000, block="P1"),
  op("B", "upsert", 2500, block={"id": "C2", "text": "new child", "parentId": "P1", "rank": "T"}),
  op("B", "upsert", 2600, block={"id": "C3", "text": "lost parent", "parentId": "GONE", "rank": "Z"}),
  {"exchange": ["A", "B"]},
  expect(tree=[["C1", None], ["C2", None], ["C3", None]],
         repairs=[{"blockId": "C1", "reason": "deleted_parent"}, {"blockId": "C2", "reason": "deleted_parent"}, {"blockId": "C3", "reason": "missing_parent"}],
         converged=["B"]),
]})
S.append({"name": "concurrent_moves_cycle_rerooted_at_last_moved", "rule": R["cycle"], "steps": [
  op("A", "create", 1000, doc={"title": "Trip"}),
  op("A", "upsert", 1001, block={"id": "X", "text": "x", "rank": "M"}),
  op("A", "upsert", 1002, block={"id": "Y", "text": "y", "rank": "T"}),
  {"send": "A", "to": "B"},
  op("A", "move", 2000, block="X", parentId="Y", rank="V"),
  op("B", "move", 3000, block="Y", parentId="X", rank="V"),
  {"exchange": ["A", "B"]},
  expect(parent={"X": "Y", "Y": "X"}, tree=[["Y", None], ["X", "Y"]], repairs=[{"blockId": "Y", "reason": "cycle"}], converged=["B"]),
]})
S.append({"name": "equal_ranks_order_by_id", "rule": R["rank"], "steps": [
  op("A", "create", 1000, doc={"title": "Trip"}),
  {"send": "A", "to": "B"},
  op("A", "upsert", 2000, block={"id": "K2", "text": "second", "rank": "V"}),
  op("B", "upsert", 3000, block={"id": "K1", "text": "first", "rank": "V"}),
  op("B", "upsert", 3001, block={"id": "K0", "text": "before", "rank": "M"}),
  {"exchange": ["A", "B"]},
  expect(tree=[["K0", None], ["K1", None], ["K2", None]], repairs=[], converged=["B"]),
]})
S.append({"name": "compacted_tombstone_stays_gone", "rule": R["compacted"], "steps": [
  op("A", "create", 1000, doc={"title": "Trip"}),
  op("A", "upsert", 1001, block={"id": "B1", "text": "old", "rank": "M"}),
  op("A", "upsert", 1002, block={"id": "B2", "text": "kept", "rank": "T"}),
  {"send": "A", "to": "B"},
  {"snapshot": "stale", "of": "B"},
  op("A", "delete", 2000, block="B1"),
  {"exchange": ["A", "B"]},
  {"compact": "A", "at": 2000 + 91 * DAY},
  expect(absent=["B1"], text={"B2": "kept"}),
  {"deliver": "stale", "to": "A"},
  expect(absent=["B1"], text={"B2": "kept"}),
  {"exchange": ["A", "B"]},
  expect(on="B", absent=["B1"], converged=["A"]),
]})
S.append({"name": "young_tombstone_is_not_compacted", "rule": R["compacted"], "steps": base() + [
  op("A", "delete", 2000, block="B1"),
  {"compact": "A", "at": 2000 + 10 * DAY},
  expect(text={"B1": None}),
]})
S.append({"name": "stale_and_duplicate_copies_change_nothing", "rule": R["stale"], "steps": base(text="v1") + [
  {"snapshot": "v1", "of": "A"},
  op("A", "text", 2000, block="B1", text="v2"),
  {"send": "A", "to": "B"},
  {"deliver": "v1", "to": "B"},
  {"deliver": "v1", "to": "B"},
  {"send": "A", "to": "B"},
  expect(on="B", text={"B1": "v2"}, losses=[], notices=[], converged=["A"]),
]})

rules = list(R.values())
out = {
  "$description": "Golden merge scenarios for packages/local-store (docs/LOCAL_MODE_PLAN.md §3.4). Steps: {on, at, op, ...} edits a device's note; {send, to} merges one device's state into another; {exchange: [a, b]} merges both ways; {snapshot, of} / {deliver, to} replays an old copy; {compact, at} drops tombstones every device has seen; {expect, on} checks the state (sum is the golden checksum of the canonical file). Every merge is also checked for commutativity, idempotence and absorption. Edit this through scripts/merge-scenarios.py.",
  "rules": rules,
  "scenarios": S,
}
path = os.path.join(os.path.dirname(__file__), "..", "fixtures", "merge-scenarios.json")
old = None
if os.path.exists(path):
  old = json.load(open(path))
# keep golden sums already recorded
if old:
  sums = {}
  for s in old["scenarios"]:
    for i, st in enumerate(s["steps"]):
      if "expect" in st and "sum" in st["expect"]: sums[(s["name"], i)] = st["expect"]["sum"]
  for s in S:
    for i, st in enumerate(s["steps"]):
      if "expect" in st and (s["name"], i) in sums: st["expect"]["sum"] = sums[(s["name"], i)]
json.dump(out, open(path, "w"), indent=2, ensure_ascii=False)
open(path, "a").write("\n")
print(len(S), "scenarios")
