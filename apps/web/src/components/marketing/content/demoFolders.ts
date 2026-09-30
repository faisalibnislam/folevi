/*
 * The demo folders in the site's pictures of Folevi: the Folders page replica (product/FoldersPageReplica.tsx)
 * and the Move to folder replica (product/MoveToFolderReplica.tsx), so both show the same folders in the
 * same colours.
 *
 * Folders are listed in the order they were made, which is the sidebar's order. `color` is a FOLDER_COLORS
 * id and `age` is the folder card's "last update" text. Notes are listed oldest first, so the last three are
 * the ones a folder card shows through its cover. A note's `style` is a note style's name, or none for Plain.
 */

export type DemoNote = { title: string; lines: [string, string]; style?: string };
export type DemoFolder = { name: string; color: string; age: string; notes: DemoNote[] };

export const DEMO_FOLDERS: DemoFolder[] = [
  {
    name: "Projects",
    color: "summer-sky",
    age: "2 hours ago",
    notes: [
      { title: "Launch checklist", style: "Harbor blue", lines: ["Final copy, then the press kit.", "Everyone signs off by Wednesday."] },
      { title: "Website refresh", style: "Blue haze", lines: ["New pricing page live by the 14th.", "Photos from the studio shoot go on the About page."] },
      { title: "Spring newsletter", style: "Blossoms", lines: ["Three short stories and one recipe.", "Draft due Thursday, send on the 1st."] },
    ],
  },
  {
    name: "Personal",
    color: "peach-haze",
    age: "Sep 21",
    notes: [
      { title: "Weekly reset", lines: ["Clear the inbox, plan the week, water the plants.", "Sunday evening, twenty minutes."] },
      { title: "Running plan", style: "Aurora", lines: ["Three short runs and one long one each week.", "Rest day after the long run."] },
      { title: "Birthday ideas", lines: ["A pottery class, or the long walk by the river.", "Book a table either way."] },
    ],
  },
  {
    name: "Clients",
    color: "ultramarine",
    age: "12 mins ago",
    notes: [
      { title: "Bakery rebrand: kickoff", style: "Wood thrush", lines: ["New logo and menu boards before the summer opening.", "Next call on Tuesday at 10."] },
      { title: "Bookshop website", style: "Ultramarine", lines: ["An events calendar and a gift card page.", "First mockups go out on Friday."] },
      { title: "Invoices to send", lines: ["September for the bakery, half up front for the bookshop.", "Check the new bank details first."] },
      { title: "Studio photo brief", style: "Grey sand", lines: ["Natural light, plain backgrounds, no people.", "Twelve images for the new site."] },
    ],
  },
  {
    name: "Reading",
    color: "irises",
    age: "3 days ago",
    notes: [
      { title: "Reading shelf", style: "Poppy print", lines: ["Books in progress, books waiting, books finished.", "Two library copies due back soon."] },
      { title: "Highlights this month", style: "Parchment", lines: ["Short passages worth keeping, with the page number next to each.", "Copy the good ones into the commonplace note."] },
      { title: "Articles to finish", lines: ["The long piece on city gardens.", "An essay on slow letters and the people who still write them."] },
    ],
  },
  {
    name: "Travel",
    color: "neon-silk",
    age: "1 hour ago",
    notes: [
      { title: "Coastal weekend", style: "Watercolour marsh", lines: ["A long weekend by the sea in October.", "Book the ferry for Friday morning."] },
      { title: "Train times", style: "Old street", lines: ["The 8:40 to the coast gets in before lunch.", "Last train back leaves at 22:15."] },
      { title: "Places to eat", style: "Irises", lines: ["The fish place by the market, closed on Mondays.", "Pastries near the tram stop."] },
      { title: "Packing list", style: "Peach haze", lines: ["Adapters, a light rain jacket and the small camera.", "Walking shoes that are already broken in."] },
      { title: "Lisbon in April", style: "Summer sky", lines: ["Four days in Alfama, flying back on the 21st.", "Book the tram tour and a table for the first night."] },
    ],
  },
  {
    name: "Recipes",
    color: "red-lacquer",
    age: "5 days ago",
    notes: [
      { title: "Soups for winter", lines: ["Leek and potato, then the red lentil one.", "Freeze half of each batch."] },
      { title: "Sourdough schedule", style: "Kraft", lines: ["Feed the starter at 9, mix at 1.", "Shape before bed and bake first thing."] },
      { title: "Weeknight dinners", style: "Terracotta", lines: ["Tray bakes on Monday and Thursday.", "Keep a jar of pesto in the fridge."] },
    ],
  },
  {
    name: "Research",
    color: "galvanized",
    age: "Sep 18",
    notes: [
      { title: "Interview notes", lines: ["Five calls so far, two more next week.", "Most people keep notes in more than one place."] },
      { title: "Survey questions", style: "Ruled page", lines: ["Ten questions, none longer than a line.", "Test it on three people first."] },
      { title: "Pricing notes", style: "Galvanized", lines: ["Most plans start between 4 and 10 a month.", "Yearly plans save about two months."] },
    ],
  },
  {
    name: "Meetings",
    color: "weathered-wood",
    age: "4 hours ago",
    notes: [
      { title: "Design review", lines: ["Tighter spacing on the cards.", "Try the lighter grey for the sidebar."] },
      { title: "Team offsite agenda", style: "Festival", lines: ["Morning for the roadmap, afternoon for the walk.", "Lunch is booked for twelve."] },
      { title: "Monday planning", style: "Folded mist", lines: ["What shipped last week and what's next.", "Keep it to twenty minutes."] },
    ],
  },
  {
    name: "Ideas",
    color: "runners",
    age: "2 days ago",
    notes: [
      { title: "Weekend workshop", lines: ["A half-day on binding small notebooks.", "Ask the library about the back room."] },
      { title: "Names for the studio", style: "Deco", lines: ["Something short that works as a web address.", "Say each one out loud before deciding."] },
      { title: "Side project ideas", style: "Poppy print", lines: ["A map of the best benches in town.", "A weekly letter about one good tool."] },
    ],
  },
  {
    name: "Garden",
    color: "crackle-green",
    age: "6 days ago",
    notes: [
      { title: "Compost notes", lines: ["Turn it every two weeks.", "More dry leaves when it gets wet."] },
      { title: "Seed order", style: "Cypresses", lines: ["Beans, chard and two kinds of tomato.", "Order before the end of the month."] },
      { title: "Planting calendar", style: "Crackle green", lines: ["Peas in March, tomatoes after the last frost.", "Garlic goes in with the October rain."] },
    ],
  },
  {
    name: "Health",
    color: "seafoam-drift",
    age: "Sep 12",
    notes: [
      { title: "Appointments", lines: ["Dentist on the 3rd at 9:30.", "Eye test some time in November."] },
      { title: "Stretching routine", style: "Seafoam drift", lines: ["Ten minutes after each run.", "Hips, calves, then the lower back."] },
    ],
  },
  {
    name: "Finance",
    color: "kraft",
    age: "1 day ago",
    notes: [
      { title: "Tax documents", lines: ["Receipts in the blue folder.", "Send everything to the accountant by the 31st."] },
      { title: "Savings goals", style: "Harbor blue", lines: ["A new bike by spring.", "Three months of rent put aside."] },
      { title: "Monthly budget", style: "Amber mint", lines: ["Rent, bills and food first.", "What's left splits between savings and fun."] },
    ],
  },
];

/** A note left in Drafts; the Move to folder replica shows it being filed. */
export const DEMO_DRAFT: DemoNote = { title: "Ideas for the balcony", lines: ["Herbs in the window box, tomatoes by the rail.", "Ask about the watering can at the hardware store."] };
