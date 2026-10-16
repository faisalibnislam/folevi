// The places this device's token can save to (GET /api/v1/places), kept for the share sheet so it shows
// them at once (and offline): written by the app when it gets a token and on each launch, and by the share
// extension when it fetches them again. And the place chosen last time.
import Foundation

enum PlacesCache {
    private static let key = "places"
    private static let lastKey = "sharePlace"

    static func load() -> [Place] {
        guard let data = Folevi.defaults.data(forKey: key), let places = try? JSONDecoder().decode([Place].self, from: data), !places.isEmpty else { return [Place(id: "personal", name: "Personal")] }
        return places
    }

    static func save(_ places: [Place]) {
        Folevi.defaults.set(try? JSONEncoder().encode(places), forKey: key)
    }

    static var lastPlace: String? {
        get { Folevi.defaults.string(forKey: lastKey) }
        set { Folevi.defaults.set(newValue, forKey: lastKey) }
    }
}
