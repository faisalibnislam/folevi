// A view's model, made once for as long as the view is in the tree.
//
// SwiftUI runs a view's `init` every time its parent's body runs, and `State(initialValue:)` evaluates its value
// each time even though it keeps only the first. A screen model made that way starts its engine subscriptions
// (`client.watch`) on every redraw of the frame, and their answers redraw the frame again: the main thread never
// rests, and scrolling anywhere in the app drops frames (2026-11-03, the Calendar tab kept alive under a note
// held the main thread at about 64% busy while nothing moved). `@MadeOnce` takes the model as an autoclosure and
// makes it the first time the view reads it.
import SwiftUI

@MainActor
@propertyWrapper
public struct MadeOnce<Value: AnyObject>: DynamicProperty {
    private final class Box {
        var value: Value?
    }

    @State private var box = Box()
    private let make: () -> Value

    public init(wrappedValue: @autoclosure @escaping () -> Value) {
        make = wrappedValue
    }

    public var wrappedValue: Value {
        if let value = box.value { return value }
        let value = make()
        box.value = value
        return value
    }
}
