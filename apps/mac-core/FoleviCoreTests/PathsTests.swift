import Testing
@testable import FoleviCore

struct PathsTests {
    @Test func keychainNamesAreCoresOwn() {
        #expect(Paths.keychainService("com.folevi.e2ee").hasPrefix("app.folevicore."))
        #expect(!Paths.keychainService("com.folevi.e2ee").hasPrefix("com.folevi."))
    }
}
