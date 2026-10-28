// The note page's own sidebar (WebNoteSidebar, bridge revision 14): what the note page says it shows
// (`note.tools`) lands in the frame model by note, and the sidebar's clicks go to the note as editor commands.
#if os(macOS)
import Foundation
import Testing
import FoleviDesign
import FoleviEngine
@testable import FoleviMac

@Suite("Note sidebar") @MainActor
struct NoteSidebarTests {
    func make() async -> (DemoEngine, FrameModel) {
        let demo = DemoEngine()
        let model = FrameModel(client: demo.client())
        await eventually("ready") { model.isEngineReady }
        return (demo, model)
    }

    static func tools(_ noteId: String, outline: [NoteOutlineItem] = []) -> NoteToolsEvent {
        NoteToolsEvent(
            noteId: noteId,
            title: "Kyoto in November",
            trail: [NoteToolsCrumb(href: "/folders/f1", label: "Travel"), NoteToolsCrumb(href: "/folders/f2", label: "Japan")],
            outline: outline,
            current: outline.first?.id,
            tasks: [NoteToolsTask(id: "t1", text: "Book", checked: false)],
            attachments: [],
            links: [],
            comments: NoteToolsComments(available: false, loaded: true, canComment: false, threads: []),
            pages: [],
            pagesTruncated: false,
            readOnly: false
        )
    }

    @Test func toolsArriveByNote() async throws {
        let (demo, model) = await make()
        demo.emit("note.tools", try .from(Self.tools("doc_kyoto")))
        await eventually("tools") { model.noteTools["doc_kyoto"] != nil }
        #expect(model.noteTools["doc_kyoto"]?.trail.map(\.label) == ["Travel", "Japan"])
        let heading = NoteOutlineItem(kind: .heading, id: "h1", text: "Temples", level: 1, documentId: nil)
        demo.emit("note.tools", try .from(Self.tools("doc_kyoto", outline: [heading])))
        await eventually("updated") { model.noteTools["doc_kyoto"]?.outline.count == 1 }
        #expect(model.noteTools["doc_kyoto"]?.current == "h1")
    }

    @Test func clicksGoToTheNote() async {
        let (demo, model) = await make()
        model.open(.note("doc_kyoto"))
        model.editor(.blockJump(blockId: "h1"))
        model.editor(.taskToggle(blockId: "t1"))
        model.editor(.threadOpen(threadId: "thr_1"))
        await eventually("sent") { ["block.jump", "task.toggle", "thread.open"].allSatisfy(demo.editorLog.contains) }
    }

    @Test func emptyFindClears() async {
        let (demo, model) = await make()
        model.open(.note("doc_kyoto"))
        let find = NoteFindModel()
        find.query = "  "
        find.search(model)
        await eventually("cleared") { demo.editorLog.contains("find.clear") }
        #expect(find.result == nil)
        find.query = "the"
        find.search(model, index: 1)
        await eventually("found") { demo.editorLog.contains("find") }
    }

    @Test func tabsInTheWebsOrder() {
        #expect(NoteToolTab.allCases.map(\.label) == ["Table of contents", "Comments", "Tasks in this page", "Attachments and links", "Find in page"])
        #expect(NoteToolTab(rawValue: "contents") == .contents)
    }

    @Test func linkHosts() {
        #expect(WebNoteSidebar.host("https://www.kyoto-nishiki.or.jp/en") == "kyoto-nishiki.or.jp")
        #expect(WebNoteSidebar.host("not a url") == "not a url")
    }
}
@Suite("Note sidebar text") @MainActor
struct NoteSidebarTextTests {
    @Test func prettyKeepsTheLineCountAndEvensTheLines() {
        let style = WebTextStyle.role(.subheadline)
        let text = "Tasks inside this document will appear here. Type “[]” or use Insert → To-do to add one."
        let broken = WebNoteSidebar.pretty(text, style, 220)
        #expect(broken.replacingOccurrences(of: "\n", with: " ") == text)
        let lines = broken.split(separator: "\n")
        #expect(lines.count == 3)
        #expect(lines.first == "Tasks inside this document")
        #expect(WebNoteSidebar.pretty("Two words", style, 220) == "Two words")
        #expect(!WebNoteSidebar.pretty("Short line here", style, 220).contains("\n"))
    }
}
#endif
