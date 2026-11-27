// The company that operates Folevi (the owner, 2026-11-27), for the Mac and the iPhone and iPad apps: About and
// Settings > About name it with a link to its website, the postal address and the copyright line. The website keeps
// the same details in apps/web/src/components/marketing/site.ts (OPERATOR); tests/convex/static/operator.test.ts
// fails if the two ever differ.
import Foundation

public enum FoleviOperator {
    public static let name = "Space Cherries LLC"
    public static let website = URL(string: "https://www.spacecherries.com")!
    /// The postal address. Only legal places show it (Settings > About next to the terms and privacy links).
    public static let address = "5242 Elbetee Lane, Alexandria, VA 22312, USA"
    /// "© 2026 Space Cherries LLC" (the Info.plist's NSHumanReadableCopyright says the same).
    public static let copyright = "© 2026 \(name)"
    /// "Operated by Space Cherries LLC"
    public static let operatedBy = "Operated by \(name)"
    /// The sign-up screen's line under the terms: "Folevi is operated by [Space Cherries LLC](https://…)." as Markdown.
    public static let signUpMarkdown = "Folevi is operated by [\(name)](\(website.absoluteString))."
}
