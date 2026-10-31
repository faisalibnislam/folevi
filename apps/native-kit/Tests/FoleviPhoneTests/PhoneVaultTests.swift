// The phone Vault's flex-wrap rows break where the web's do (the header's subtitle and Lock, the Files bar).
#if os(iOS)
import CoreGraphics
import Testing
@testable import FoleviPhone

@Suite("Vault on the iPhone")
struct PhoneVaultTests {
    @Test func headerWrapsLockUnderALongSubtitle() {
        // "Open on this device · locks after 5 idle minutes" (about 330) and Lock with ⋯ (about 130) in 362.
        #expect(PhoneVaultFlow.lines([330, 130], width: 362, gap: 8) == [[0], [1]])
        #expect(PhoneVaultFlow.lines([60, 130], width: 362, gap: 8) == [[0, 1]])
    }

    @Test func filesBarWrapsAsTheWeb() {
        // Files & Notes, Grid/Lines, Folder | Note, Upload (370 wide, gap 8).
        #expect(PhoneVaultFlow.lines([110, 92, 104, 84, 106], width: 370, gap: 8) == [[0, 1, 2], [3, 4]])
    }

    @Test func aChildWiderThanTheLineTakesALineOfItsOwn() {
        #expect(PhoneVaultFlow.lines([500, 40], width: 370, gap: 8) == [[0], [1]])
        #expect(PhoneVaultFlow.lines([], width: 370, gap: 8) == [])
    }
}
#endif
