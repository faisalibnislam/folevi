import Foundation

/// Plan & billing on the server (convex/billing.ts, convex/workspaceBilling.ts): the same functions the web
/// calls. Paying itself happens on Polar's pages, so checkout, the billing portal and buying credits return a
/// URL to open in the browser; everything else (test purchases, cancel, resume, plan changes) runs here.
struct BillingRepository: Sendable {
    let convex: ConvexService

    private struct URLResult: Decodable, Sendable { var url: String? }

    /// Where bought credits go: your Personal, or your own seat in a paid workspace (its public id).
    enum CreditTarget: Sendable, Equatable {
        case personal
        case workspace(String)

        var arg: JSONValue {
            switch self {
            case .personal: return .object(["kind": "personal"])
            case .workspace(let id): return .object(["kind": "workspace", "workspaceId": .string(id)])
            }
        }
    }

    // MARK: Personal

    func mineUpdates() -> AsyncThrowingStream<BillingSummary, Error> { convex.subscribe("billing:mine") }
    func creditAccountsUpdates() -> AsyncThrowingStream<CreditAccountsResponse, Error> { convex.subscribe("billing:creditAccounts") }

    /// Polar Checkout for a Personal plan; nil when the running Polar subscription was switched instead.
    func checkout(plan: String, yearly: Bool) async throws -> URL? {
        let r: URLResult = try await convex.action("billing:checkout", ["plan": .string(plan), "interval": .string(yearly ? "year" : "month")])
        return r.url.flatMap(URL.init(string:))
    }

    func portal() async throws -> URL? {
        let r: URLResult = try await convex.action("billing:portal")
        return r.url.flatMap(URL.init(string:))
    }

    func testPurchase(plan: String, yearly: Bool) async throws {
        try await convex.mutationVoid("billing:testPurchase", ["plan": .string(plan), "interval": .string(yearly ? "year" : "month")])
    }

    func cancelPlan() async throws { try await convex.mutationVoid("billing:cancelPlan") }
    func resumePlan() async throws { try await convex.mutationVoid("billing:resumePlan") }

    func buyCredits(pack: String, for target: CreditTarget) async throws -> URL? {
        let r: URLResult = try await convex.action("billing:buyCredits", ["pack": .string(pack), "scope": target.arg])
        return r.url.flatMap(URL.init(string:))
    }

    func testBuyCredits(pack: String, for target: CreditTarget) async throws {
        try await convex.mutationVoid("billing:testBuyCredits", ["pack": .string(pack), "scope": target.arg])
    }

    // MARK: Workspace

    func workspaceUpdates(_ workspaceId: String) -> AsyncThrowingStream<WorkspaceBillingSummary, Error> {
        convex.subscribe("workspaceBilling:summary", ["workspaceId": .string(workspaceId)])
    }

    func workspaceCheckout(_ workspaceId: String, planId: String) async throws -> URL? {
        let r: URLResult = try await convex.action("workspaceBilling:checkout", ["workspaceId": .string(workspaceId), "planId": .string(planId)])
        return r.url.flatMap(URL.init(string:))
    }

    func workspacePortal(_ workspaceId: String) async throws -> URL? {
        let r: URLResult = try await convex.action("workspaceBilling:portal", ["workspaceId": .string(workspaceId)])
        return r.url.flatMap(URL.init(string:))
    }

    func workspaceChangePlan(_ workspaceId: String, planId: String) async throws {
        let _: JSONValue = try await convex.action("workspaceBilling:changePlan", ["workspaceId": .string(workspaceId), "planId": .string(planId)])
    }

    func workspaceCancel(_ workspaceId: String) async throws {
        let _: JSONValue = try await convex.action("workspaceBilling:cancel", ["workspaceId": .string(workspaceId)])
    }

    func workspaceResume(_ workspaceId: String) async throws {
        let _: JSONValue = try await convex.action("workspaceBilling:resume", ["workspaceId": .string(workspaceId)])
    }

    func workspaceTestPurchase(_ workspaceId: String, planId: String) async throws {
        try await convex.mutationVoid("workspaceBilling:testPurchase", ["workspaceId": .string(workspaceId), "planId": .string(planId)])
    }
}
