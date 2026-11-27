/*
 * Release notes, newest first. The changelog page renders them, each release is an Article in its
 * structured data, and the newest date is the changelog's lastModified in the sitemap.
 */
export type Release = {
  version: string;
  name: string;
  /** YYYY-MM-DD */
  date: string;
  label: string;
  intro: string;
  groups: Array<{ title: string; items: string[] }>;
};

export const RELEASES: Release[] = [
  {
    version: "1.8.79",
    name: "Spell check that knows English, and Writing settings on the Mac",
    date: "2026-11-26",
    label: "November 26, 2026",
    intro: "A spell check fix for the web and the Mac, a new Writing section in the Mac app’s Settings, and Folevi for Android as a download from folevi.com.",
    groups: [
      {
        title: "Web and Mac",
        items: [
          "English headings and short lines are no longer checked as Portuguese or another language, so correct words stay unmarked and suggestions make sense",
          "Spell check reads long notes faster",
        ],
      },
      {
        title: "Mac",
        items: [
          "Settings > Writing turns spell check and next-word prediction on or off, picks American or British English, and holds your dictionary and ignored words",
        ],
      },
      {
        title: "Android",
        items: ["Folevi for Android is a download from folevi.com/downloads, for Android 13 or later on phones and tablets"],
      },
    ],
  },
  {
    version: "1.8.78",
    name: "Spell check and next-word prediction",
    date: "2026-11-26",
    label: "November 26, 2026",
    intro: "Folevi checks your spelling and suggests the next word as you write. Apple Notes import brings more across, and the interface is more consistent everywhere.",
    groups: [
      {
        title: "Writing",
        items: [
          "Spell check in every app, in nine languages, with suggestions in the right-click menu, on a click and above the phone keyboard",
          "Next-word prediction: press Tab to take the suggested word, and again for the next one",
        ],
      },
      {
        title: "Everywhere",
        items: [
          "Apple Notes import brings every attachment, tags, empty folders and the original dates",
          "Buttons, fields and menus share one size and spacing system, and menus have one clear separator style",
          "Home always stays in view in the tab strip",
          "Floating notes show the note’s color from edge to edge",
          "Clicks show at once, and signing in is quicker on the web and the Mac",
          "Folevi for Linux and signing in to your own server are marked Beta",
          "Security fixes across the apps",
        ],
      },
      {
        title: "Fixes",
        items: [
          "Pickers such as Move to folder no longer cut off their last row in a short window",
          "Version history’s top bar no longer sits under the window’s buttons",
          "The typing cursor shows in the Vault’s passcode field and other dark fields",
          "Folevi for Windows can reach a server on your home network over plain http",
        ],
      },
    ],
  },
  {
    version: "1.7.78",
    name: "Float any note, and much more for Windows and Linux",
    date: "2026-11-26",
    label: "November 26, 2026",
    intro: "Keep a note on top of everything in its own small window. Folevi for Windows and Folevi for Linux (Beta) catch up on many features.",
    groups: [
      {
        title: "Floating notes",
        items: [
          "Float this note opens a note in a small window that stays on top, from a tab or a note’s right-click menu",
          "It works on the Mac, on Windows, and in Chrome or Edge",
        ],
      },
      {
        title: "Windows and Linux",
        items: [
          "Automatic updates, app lock with Windows Hello, and background sync",
          "Sign in to your own server (Beta), and on Windows, call recording and text in pictures",
          "The Jump List, notification actions, Windows Share, and windows that reopen where you left them",
          "The apps call themselves by their own names",
        ],
      },
      {
        title: "Tabs",
        items: [
          "Joined notes stay in their own tab group when you switch between them",
          "The pin on a long tab name stays visible on hover, and New note has room on the right",
          "Table text no longer rewraps when you click into a note",
        ],
      },
    ],
  },
  {
    version: "1.6.78",
    name: "Sign in to your own server",
    date: "2026-11-25",
    label: "November 25, 2026",
    intro: "Every Folevi app can sign in to Folevi Server (Beta), the self-hosted Folevi for a NAS or a Linux server. The web and Mac apps are faster, and Foli AI can run on more models.",
    groups: [
      {
        title: "Your own server (Beta)",
        items: [
          "“Your own server” sign-in on the web, Mac, iPhone, iPad, Android, Windows and Linux",
          "Connect by address, by QR code, or by finding the server on your home network",
        ],
      },
      {
        title: "Downloads",
        items: [
          "A Downloads page with every Folevi download in one place",
          "Folevi for Linux (Beta) has apt and dnf repositories, so it updates with the rest of your system",
        ],
      },
      {
        title: "Foli AI",
        items: [
          "An administrator can choose Google Gemini, OpenAI or Anthropic models for each feature",
        ],
      },
      {
        title: "Faster",
        items: [
          "All notes and Home answer a click in under a fifth of a second on the web",
          "Lists, search and long notes load less, so they open sooner",
          "Folevi for Mac starts faster and uses less energy in the background",
          "On the Mac, Home scrolls smoothly and Show all tabs has a new look",
          "Dialogs and the command palette fade out when they close",
          "On iPhone and iPad, a sign-in that was waiting is still there after the app restarts",
        ],
      },
    ],
  },
  {
    version: "1.5.78",
    name: "Widgets and Siri are back on iPhone and iPad",
    date: "2026-11-25",
    label: "November 25, 2026",
    intro: "Widgets, Siri and Shortcuts return to iPhone and iPad, sync is easier to read, and iPhone Duo keeps clear of the fold.",
    groups: [
      {
        title: "iPhone and iPad",
        items: [
          "Widgets, the Control Center control, Siri and Shortcuts, and Spotlight search",
          "The sync sheet shows its status, when it last synced and what is waiting, on one card",
          "Screens show their last-known lists right away, and pages you’ve seen before appear at once",
          "Finished tasks and swiped-away notes slide out, and scrolling and opening notes feel quicker",
          "On iPad, the sidebar slides with the page, and the note’s tool bar rides up with the keyboard",
          "Foli AI’s message box stays above the keyboard, and closing Foli AI takes the keyboard with it",
        ],
      },
      {
        title: "iPhone Duo",
        items: [
          "Folding and unfolding keeps the open note, where you were typing and the keyboard",
          "The sidebar, dialogs, menus and toasts stay clear of the fold",
        ],
      },
      {
        title: "Everywhere",
        items: [
          "Sync status uses the same words on every screen",
          "A list that fails to load says so and tries again",
          "Links from widgets and Shortcuts open the right page",
        ],
      },
    ],
  },
  {
    version: "1.5.77",
    name: "A lighter Folevi for Windows",
    date: "2026-11-25",
    label: "November 25, 2026",
    intro: "Folevi for Windows uses about a quarter less memory than before.",
    groups: [
      {
        title: "Windows",
        items: ["Quick Add opens its window the first time you use it, so less is kept in memory"],
      },
    ],
  },
  {
    version: "1.5.76",
    name: "Less memory on iPhone",
    date: "2026-11-25",
    label: "November 25, 2026",
    intro: "Folevi on iPhone no longer builds up memory as you open notes.",
    groups: [
      {
        title: "iPhone",
        items: ["A note you open and close is let go from memory"],
      },
    ],
  },
  {
    version: "1.5.75",
    name: "Steadier memory on iPhone",
    date: "2026-11-24",
    label: "November 24, 2026",
    intro: "Folevi on iPhone uses less memory as you move around.",
    groups: [
      {
        title: "iPhone",
        items: ["Moving between screens keeps less in memory afterward"],
      },
    ],
  },
  {
    version: "1.5.74",
    name: "Easier taps on iPhone and iPad",
    date: "2026-11-24",
    label: "November 24, 2026",
    intro: "A tidier, steadier Folevi on iPhone and iPad.",
    groups: [
      {
        title: "iPhone and iPad",
        items: [
          "Calendar’s month handle, a note’s folder chip and Foli AI’s Add button are easier to tap",
          "Keep notes on my devices keeps Folevi’s servers out from the moment the app opens",
        ],
      },
    ],
  },
  {
    version: "1.5.73",
    name: "A lighter Mac app, and a first Windows build",
    date: "2026-11-24",
    label: "November 24, 2026",
    intro: "Folevi for Mac shares the web app’s window again, smaller and lighter. Folevi for Windows arrives as a test build.",
    groups: [
      {
        title: "Windows",
        items: [
          "A test build for Arm PCs and for Intel and AMD PCs, each native",
          "It isn’t signed yet, so Windows asks you to confirm before it opens, and it doesn’t update itself yet",
        ],
      },
      {
        title: "Mac",
        items: [
          "The window shows Folevi’s own sidebar, tabs and top bar, the same as on the web, Windows and Linux",
          "Settings opens in the main window",
          "The menu bar icon, Quick Add from any app, Spotlight, Shortcuts, Share and Services stay",
          "Floating note windows are gone for now, and notes open in tabs",
        ],
      },
    ],
  },
  {
    version: "1.5.72",
    name: "One app for iPhone, iPad and Android",
    date: "2026-11-24",
    label: "November 24, 2026",
    intro: "Folevi for iPhone, iPad and Android is now one app, with the same screens as the web app.",
    groups: [
      {
        title: "Phones and tablets",
        items: [
          "iPhone, iPad, iPhone Duo and Android share the web app’s screens and layouts",
          "The iPhone and iPad app is about half the size",
        ],
      },
    ],
  },
  {
    version: "1.5.71",
    name: "Tabs on the Mac, like the web",
    date: "2026-11-24",
    label: "November 24, 2026",
    intro: "Folevi for Mac opens pages in tabs the way the web app does.",
    groups: [
      {
        title: "Mac",
        items: [
          "Notes, folders and lists open in a new tab, and Back and Forward move inside a tab",
          "Ask Foli AI sits in the toolbar",
          "New Folder is ⇧⌘N",
          "Star is now Bookmark, as on the web",
          "Calmer motion with no bounce, plus menu and speed fixes",
        ],
      },
    ],
  },
  {
    version: "1.5.70",
    name: "iPhone and iPad share more with the other apps",
    date: "2026-11-24",
    label: "November 24, 2026",
    intro: "The iPhone and iPad app now shares its redesign with Folevi for Mac and Android.",
    groups: [
      {
        title: "iPhone and iPad",
        items: ["The redesign and the iPhone Duo window are the same as in Folevi for Mac and Android"],
      },
    ],
  },
  {
    version: "1.5.69",
    name: "iPhone Duo, open and closed",
    date: "2026-11-24",
    label: "November 24, 2026",
    intro: "Open, iPhone Duo shows the iPad’s window. Closed, it shows the iPhone’s.",
    groups: [
      {
        title: "iPhone Duo",
        items: [
          "Open, Folevi shows the iPad’s window, with the toolbar and the note’s tools in the column at the side",
          "The sidebar stays beside your note, and partly folded it reaches the fold, so the list and the note each have a side",
          "Fold or unfold while you type, and your note, text, cursor and keyboard come along",
          "The sidebar no longer stays hidden after you fold and unfold the phone",
        ],
      },
    ],
  },
  {
    version: "1.5.68",
    name: "The Mac app opens again for signed-in accounts",
    date: "2026-11-24",
    label: "November 24, 2026",
    intro: "A fix for Folevi for Mac after 1.5.66.",
    groups: [
      {
        title: "Mac",
        items: ["A Mac signed in to a Folevi account no longer stays on the loading screen after updating"],
      },
    ],
  },
  {
    version: "1.5.67",
    name: "A native iPad window",
    date: "2026-11-24",
    label: "November 24, 2026",
    intro: "iPhone and iPad use more of the system’s own controls.",
    groups: [
      {
        title: "iPad",
        items: [
          "The system sidebar and toolbar, with New note and search, and your tabs in a row under it, as Safari has them",
          "A note’s Style, Format, Insert and Foli AI open in the side panel",
        ],
      },
      {
        title: "iPhone",
        items: ["Settings, Tasks, Calendar, Search, Tags and note and folder lists use the system’s own lists and swipe actions"],
      },
    ],
  },
  {
    version: "1.5.66",
    name: "Folevi for Mac, rebuilt with the Mac’s own controls",
    date: "2026-11-24",
    label: "November 24, 2026",
    intro: "The Mac app gets the Mac’s own window, sidebar, toolbar and inspector. Your notes, settings, sign-in and encryption keys carry over.",
    groups: [
      {
        title: "Mac",
        items: [
          "Hide the sidebar, search from the toolbar, and open a note’s tools in a panel beside it",
          "Each screen’s actions sit in the toolbar next to New Note, with Back and Forward at its start",
          "View choices such as list or grid use the standard segmented control",
        ],
      },
      {
        title: "iPhone and iPad",
        items: ["The + button uses the system’s glass, and tag chips and the iPad’s Back and Forward are easier to tap"],
      },
    ],
  },
  {
    version: "1.5.65",
    name: "A new look for iPhone and iPad",
    date: "2026-11-23",
    label: "November 23, 2026",
    intro: "iPhone and iPad take on a calmer look, in step with Folevi for Mac.",
    groups: [
      {
        title: "iPhone",
        items: [
          "Every screen sits on a soft gray, with lists on rounded cards and no lines between rows",
          "Each top bar ends the same way, with the screen’s actions, + for something new and search",
          "Home starts with your places and Catch me up, then Recent, Bookmarks, Folders and tags",
          "Tasks and Calendar keep each day’s tasks together on a card",
          "Home no longer slides to one side while it loads",
        ],
      },
      {
        title: "iPad",
        items: [
          "Each screen has its own top bar with Back, Forward, New note and search",
          "A note’s tools sit in a flat panel beside it, and the sidebar is slimmer",
        ],
      },
    ],
  },
  {
    version: "1.5.64",
    name: "Smoother scrolling on the Mac",
    date: "2026-11-22",
    label: "November 22, 2026",
    intro: "Folders, Home and All Notes scroll more smoothly on the Mac.",
    groups: [
      {
        title: "Mac",
        items: [
          "A large folder grid and Home scroll with far fewer dropped frames",
          "All Notes drops about half as many frames while scrolling",
        ],
      },
      {
        title: "iPhone",
        items: ["Home’s Folders menu > All Folders opens the folders grid"],
      },
    ],
  },
  {
    version: "1.5.63",
    name: "Search at the bottom of the iPhone",
    date: "2026-11-21",
    label: "November 21, 2026",
    intro: "Search moves to the bottom of the iPhone, motion feels smoother, and card shadows are never cut off.",
    groups: [
      {
        title: "iPhone",
        items: [
          "The search field sits at the bottom and rises with the keyboard, with the filters just above, as iOS 26 does",
          "The toast and the graph’s camera move respect Reduce Motion",
        ],
      },
      {
        title: "Mac, iPhone and iPad",
        items: [
          "Smoother motion: glass appears and leaves softly, presses spring back without wobble, and swipe rows follow a quick flick",
          "Quick add’s Task and Note switch matches the one in Foli AI",
          "Card shadows fade out naturally instead of stopping in a straight line",
        ],
      },
    ],
  },
  {
    version: "1.5.62",
    name: "Back always takes you back",
    date: "2026-11-21",
    label: "November 21, 2026",
    intro: "Back works in tabs you opened from a page, and Show All Tabs draws Home properly.",
    groups: [
      {
        title: "Web, Mac and iPad",
        items: [
          "Back in a tab you opened from a page, such as Home’s See all, a folder or a note in a list, closes that tab and takes you back",
          "Show All Tabs draws Home as your latest notes and folders, and other tabs’ pictures fit without being cut off",
        ],
      },
      {
        title: "iPhone and iPad",
        items: [
          "Bigger, evenly spaced note and folder cards on the iPhone’s Home, with the next one peeking in",
          "A long folder name no longer pushes the last-edited date off the card",
        ],
      },
    ],
  },
  {
    version: "1.5.61",
    name: "Folder cards that fit their words",
    date: "2026-11-21",
    label: "November 21, 2026",
    intro: "Folder cards on iPhone fit their names, and Home in Show All Tabs has room to breathe.",
    groups: [
      {
        title: "iPhone and iPad",
        items: [
          "Bigger, evenly spaced note and folder cards on the iPhone’s Home",
          "A long folder name no longer pushes the last-edited date off the card",
        ],
      },
      {
        title: "Web",
        items: ["Show All Tabs draws Home with its latest notes and folders, with more room between the rows"],
      },
    ],
  },
  {
    version: "1.5.60",
    name: "Back in tabs, and Home in Show All Tabs",
    date: "2026-11-21",
    label: "November 21, 2026",
    intro: "Back works in tabs you opened from a page, and Show All Tabs pictures Home properly.",
    groups: [
      {
        title: "Web, Mac and iPad",
        items: [
          "Back in a tab you opened from a page closes that tab and takes you back to where you were",
          "On the Mac and iPad, Show All Tabs draws Home whole, and other tabs’ pictures fit",
        ],
      },
    ],
  },
  {
    version: "1.5.59",
    name: "Cleaner folder cards",
    date: "2026-11-21",
    label: "November 21, 2026",
    intro: "Folder cards have corners that line up and a frosted front that reads clearly.",
    groups: [
      {
        title: "Every platform",
        items: [
          "A folder’s front is fully frosted, so its name, counts and last change read clearly",
          "The folder’s back no longer peeks out past the front, and a subfolder’s outline no longer shows through",
          "On the Mac and the web, Home has less space between a section’s title and its cards",
        ],
      },
    ],
  },
  {
    version: "1.5.58",
    name: "A new look for folders",
    date: "2026-11-20",
    label: "November 20, 2026",
    intro: "Folders get frosted fronts with the notes inside, subfolders stacked behind, and smaller cards on the web and the Mac.",
    groups: [
      {
        title: "Every platform",
        items: [
          "Folder cards show up to five notes inside and up to two subfolders stacked behind, under a see-through front",
          "The sidebar’s folder icon shows a page inside, or a stack when the folder has subfolders",
        ],
      },
      {
        title: "Web and Mac",
        items: ["Folder and note cards are 25% smaller, so more fit in a row"],
      },
    ],
  },
  {
    version: "1.5.57",
    name: "Offline and sync, fixed",
    date: "2026-11-20",
    label: "November 20, 2026",
    intro: "Offline & sync works properly again, Catch me up explains itself, and the iPhone gets a round of polish.",
    groups: [
      {
        title: "Everywhere",
        items: [
          "Offline & sync shows Notes kept and Space used again, and Download everything shows its progress",
          "Catch me up is one clear page that says what Foli AI reads and what the brief holds, with a Write my brief button",
          "In Settings, App lock sits with Security, and Devices is now Signed-in devices",
        ],
      },
      {
        title: "iPhone and iPad",
        items: [
          "The sync details show each state with its own mark, and a button only when there’s something to do",
          "Foli AI’s message box sits on its own card, and Send shows once you’ve typed",
          "Quick add has a full-width Task and Note switch",
        ],
      },
    ],
  },
  {
    version: "1.5.56",
    name: "A note’s own bars on iPhone",
    date: "2026-11-20",
    label: "November 20, 2026",
    intro: "On iPhone, a note’s own bars are back, and they trade places smoothly with the tab bar.",
    groups: [
      {
        title: "iPhone",
        items: [
          "A note has Folevi’s bars again: the place at the top, and the tools, Foli AI and + at the bottom",
          "Opening or closing a note swaps the tab bar and the note’s bars in place",
        ],
      },
    ],
  },
  {
    version: "1.5.55",
    name: "Smoother moves between lists and notes on iPhone",
    date: "2026-11-20",
    label: "November 20, 2026",
    intro: "On iPhone, a note uses iOS’s own bars, so moving between your lists and a note feels smooth.",
    groups: [
      {
        title: "iPhone",
        items: [
          "Opening or closing a note turns the tab bar into the note’s toolbar in place",
          "A note’s Back, place, Share and menu sit in iOS’s own top bar, and its tools in the bottom bar",
        ],
      },
    ],
  },
  {
    version: "1.5.54",
    name: "New note in the top bar, and sync at a glance",
    date: "2026-11-19",
    label: "November 19, 2026",
    intro: "New note moves to the top bar on the Mac and iPad, the iPhone shows whether your notes are synced, and the iPad gets a round of fixes.",
    groups: [
      {
        title: "Mac and iPad",
        items: ["New note is a button in the top bar, right after your tabs"],
      },
      {
        title: "iPhone",
        items: ["A cloud beside the bell on Home shows whether everything is synced. Tap it for the details and Retry"],
      },
      {
        title: "iPad",
        items: [
          "Your account sits in the top left corner, and the sidebar starts with the page you’re on",
          "Smoother with big libraries, and tapping the cloud shows the sync details",
          "Closing a note’s Style or Format panel no longer leaves a ring or a tooltip behind",
        ],
      },
      {
        title: "Everywhere",
        items: [
          "Closing the tools panel keeps your cursor where you were typing",
          "The first-launch screens on phones no longer slide sideways",
        ],
      },
    ],
  },
  {
    version: "1.5.53",
    name: "Foli AI in the iPhone’s tab bar, and iPhone Duo",
    date: "2026-11-19",
    label: "November 19, 2026",
    intro: "Foli AI gets its own tab on iPhone, Folevi works on iPhone Duo, and the first screens say less.",
    groups: [
      {
        title: "iPhone",
        items: ["Foli AI is a tab after Calendar for people who have it, and opens over the screen you’re on"],
      },
      {
        title: "iPhone Duo",
        items: [
          "Open, the tabs become a sidebar and a note opens beside its list",
          "Closed, the note’s buttons sit in the side bars, and folding or unfolding keeps your note, text and keyboard where they were",
        ],
      },
      {
        title: "Every platform",
        items: ["The first-launch screens have much less small print"],
      },
    ],
  },
  {
    version: "1.5.52",
    name: "Filter notes on the Mac and the web",
    date: "2026-11-19",
    label: "November 19, 2026",
    intro: "Every list of notes on the Mac and the web now has a Filter notes field at the top.",
    groups: [
      {
        title: "Mac and web",
        items: [
          "All notes, Bookmarks, Drafts, Archive, Trash, Templates, a folder and a tag show Filter notes, always in sight",
          "It narrows the list by title or text as you type, and the count says how many match, such as “2 of 19 notes”",
          "On the web, Escape clears it",
          "The iPad’s lists have it too",
        ],
      },
    ],
  },
  {
    version: "1.5.51",
    name: "A calmer iPhone, and a steadier editor",
    date: "2026-11-19",
    label: "November 19, 2026",
    intro: "Fixes from the first day with the new iPhone look, and a long pass over the note editor on every platform.",
    groups: [
      {
        title: "iPhone",
        items: [
          "Each tab’s first screen has + in its top bar, beside Foli AI when it’s on, and nothing sits over the tab bar",
          "All folders and Foli DNA are rows on Home",
          "Search’s close button takes you back to where you opened it",
          "The account button has no glass around it",
        ],
      },
      {
        title: "Every platform",
        items: [
          "Fields that narrow a list read Filter notes, Filter folders or Filter tags, and on the iPhone they stay in sight at the top of the list",
        ],
      },
      {
        title: "The editor",
        items: [
          "Enter, Backspace and Tab stay fast in long notes, and a long paste saves at once",
          "A note changed on another device opens with the newer text, and an edit never replaces it unseen",
          "On iPhone and iPad, the line you’re writing stays above the keyboard, and typing is saved when you leave the app",
          "On iPhone and iPad, Return in a to-do or a toggle keeps the words after the caret",
          "Fixes for paste, copy and cut, tables, pictures, recordings, code and columns",
        ],
      },
    ],
  },
  {
    version: "1.5.50",
    name: "Folevi for iPhone and iPad, native to iOS 26",
    date: "2026-11-19",
    label: "November 19, 2026",
    intro: "The iPhone app takes on iOS 26’s own look, and the iPad’s wide layout becomes the Mac app’s. Notes and note cards keep Folevi’s fonts.",
    groups: [
      {
        title: "iPhone",
        items: [
          "iOS 26’s tab bar in Liquid Glass, with Home, Tasks and Calendar, and Search as a tab of its own",
          "Large titles, Back with the edge swipe, and iOS’s own menus, context menus and sheets",
          "Interface text in the system font, following your text size",
          "On iOS 18, the tab bar stays as it was",
        ],
      },
      {
        title: "iPad",
        items: [
          "The wide layout is the Mac app’s: tabs along the top, the sidebar, and the list or note in its card with glass controls",
          "Settings opens as the Mac’s Settings, in a sheet",
        ],
      },
      {
        title: "Everywhere",
        items: ["In dark mode, a switch that’s on is graphite, so its white knob shows", "No lines between the rows of a list"],
      },
    ],
  },
  {
    version: "0.4",
    name: "Folevi for Mac runs the web app",
    date: "2026-10-09",
    label: "October 9, 2026",
    intro: "Folevi for Mac now runs the same app as the web, so every feature reaches the Mac the day it ships. It isn't available to download yet.",
    groups: [
      {
        title: "Folevi for Mac",
        items: [
          "Quick Add from any app with ⌥Space (you can change the shortcut)",
          "A menu bar icon with Quick Add, a new note, recent notes and the save state",
          "Mac notifications for comments, mentions and reminders, and the unread count on the Dock icon",
          "A window with no title bar, ⌘N for a new note, and opening at login",
          "Requires macOS 13 or later on Apple silicon",
        ],
      },
    ],
  },
  {
    version: "0.3",
    name: "New plans and AI credits",
    date: "2026-09-30",
    label: "September 30, 2026",
    intro: "Four plans, the same for you and for your team, and AI counted in credits so every plan can say exactly what it includes.",
    groups: [
      {
        title: "Plans",
        items: [
          "Free (1 GB shared with the free workspaces you own, 25 AI credits a month, 2 devices)",
          "Core (20 GB, unlimited devices, and no AI: nothing is sent to an AI model)",
          "Pro (20 GB, 180 AI credits a month, unlimited devices)",
          "Pro AI (50 GB, unlimited AI with fair use: 550 credits a month, unlimited devices)",
          "The same four plans for workspaces, billed per member; guests are free",
          "Basic is now Core, the old Pro is now Pro AI, and workspaces on Team or Business move to Pro or Pro AI",
        ],
      },
      {
        title: "AI credits",
        items: [
          "Every AI request uses credits: a rewrite about 1, Ask AI about 2, a flowchart 3 to 5",
          "Monthly credits reset each billing month (on Free, each calendar month)",
          "Credit packs for Pro and Pro AI: 500 or 1,000 credits, one-time, valid for 12 months",
          "The 7-day trial for new accounts is now Pro AI, with 100 AI credits and no card",
        ],
      },
    ],
  },
  {
    version: "0.2",
    name: "Plans, AI and a new look",
    date: "2026-09-28",
    label: "September 28, 2026",
    intro: "Folevi gets plans, an AI Assistant and a lighter, glassier look. They're on the web now, and the Mac app will follow.",
    groups: [
      {
        title: "Plans",
        items: [
          "Free (1 GB, 2 devices), Basic (20 GB, unlimited devices) and Pro (100 GB, unlimited devices, the AI Assistant)",
          "A 7-day Pro trial for every new account, with no card",
          "Settings → Plan & billing: your plan, storage, devices and history in one place",
          "Settings → Devices: every browser and app signed in, with one-click sign-out",
        ],
      },
      {
        title: "AI Assistant",
        items: [
          "Ask questions of your notes, with links to the notes it used",
          "Write, rewrite, summarize and continue from the slash menu, the selection toolbar or ⌘J",
          "Catch me up: a short brief of your week on Home",
          "Answers appear word by word; turn the assistant off anytime in settings",
        ],
      },
      {
        title: "Look and feel",
        items: [
          "A new logo and app icon",
          "Translucent, glassy chrome with a calmer, neutral palette so your notes carry the color",
          "57 note styles, each coloring text, highlights and blocks from its image, or upload your own",
          "26 built-in templates with their own icons",
          "Folders that show the notes inside them",
        ],
      },
      {
        title: "Account",
        items: ["Two-step verification is now optional: turn it on or off anytime in Settings → Security"],
      },
    ],
  },
  {
    version: "0.1",
    name: "Preview",
    date: "2026-09-25",
    label: "September 25, 2026",
    intro: "The first public preview of Folevi, on the web and (for preview accounts) on the Mac.",
    groups: [
      {
        title: "Writing",
        items: [
          "Block documents: text, headings (three levels), bulleted and numbered lists, checklists, toggles, quotes, callouts, dividers, code, tables, images, files and bookmarks",
          "Slash menu to insert or turn a block into any type, plus keyboard shortcuts for headings and checklists",
          "Drag or use ⌥⇧↑ / ⌥⇧↓ to move blocks; nest blocks to build outlines",
          "Inline formatting, text colors and highlights, links, dates and mentions",
          "Page style: sans, serif or mono type; narrow, default or wide width; paper, plain, tinted or grid backgrounds; five accent colors; color, gradient and 20 artwork covers; icons",
        ],
      },
      {
        title: "Organizing",
        items: [
          "Nested pages, shown as links or cards",
          "Links between pages with [[, and backlinks on the linked page",
          "Drafts for loose notes, folders, tags and starred pages",
          "Templates",
          "Search across titles and text with ⌘K",
        ],
      },
      {
        title: "Tasks",
        items: ["Checklist items with due dates, times and priority", "Today view for due and overdue tasks", "Quick Add into your Inbox page", "Calendar"],
      },
      {
        title: "Sync, offline and sharing",
        items: [
          "Offline editing on the web and the Mac, with a clear status: Saved, Saving, Offline, Syncing, Conflict or Error",
          "Real-time sync between devices, with version snapshots",
          "Private by default; public links with optional expiry and password, revocable at any time",
          "Export any page to Markdown, HTML or PDF, or the whole workspace as a ZIP",
        ],
      },
      {
        title: "Mac app (private preview)",
        items: [
          "Native menus and shortcuts, multiple windows, sidebar and inspector",
          "Quick Look, drag from Finder and menu bar Quick Add",
          "Liquid Glass on macOS 26; supports macOS 15 and later",
        ],
      },
      {
        title: "Account security",
        items: [
          "Email verification before workspace access",
          "Required two-step verification with an authenticator app, plus one-time recovery codes",
          "Account deletion with a 7-day grace period",
        ],
      },
    ],
  },
];

/** The newest release date (YYYY-MM-DD). */
export const LATEST_RELEASE_DATE = RELEASES.reduce((latest, r) => (r.date > latest ? r.date : latest), RELEASES[0]!.date);
