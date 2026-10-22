// The places this device's token can save to (GET /api/v1/places), kept for the share sheet so it shows
// them at once (and offline): written by the app when it gets a token and on each launch, and by the share
// extension when it fetches them again. And the place chosen last time.
import Foundation

enum PlacesCache {
    private static let key = "places"
    private static let lastKey = "sharePlace"

    /// `userId`: with several places (SaveTargets) each account's own list; nil is the open account's.
    static func load(userId: String? = nil) -> [Place] {
        guard let data = Folevi.defaults.data(forKey: userId.map { "\(key).\($0)" } ?? key), let places = try? JSONDecoder().decode([Place].self, from: data), !places.isEmpty else { return [Place(id: "personal", name: "Personal")] }
        return places
    }

    static func save(_ places: [Place], userId: String? = nil) {
        Folevi.defaults.set(try? JSONEncoder().encode(places), forKey: userId.map { "\(key).\($0)" } ?? key)
    }

    static var lastPlace: String? {
        get { Folevi.defaults.string(forKey: lastKey) }
        set { Folevi.defaults.set(newValue, forKey: lastKey) }
    }
}
