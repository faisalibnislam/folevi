# Changelog

Every Folevi release, newest first, written by `node scripts/version.mjs` from `CHANGELOG.json`.

Versions are MAJOR.UPDATE.PATCH, PATCH at least two digits: a Major release (2.0.00), a Big update (1.1.05 after 1.0.05) or a Small update (1.0.06 after 1.0.05).

## Version 1.5.62: Small update

Released 2026-11-21 10:46:15+06:00 (build 77, tag v1.5.62)

Folder cards fit their words on iPhone, Back always takes you back, and Home's picture in Show All Tabs is drawn properly with room to breathe.

### Improved

- iPhone Home: bigger note and folder cards, evenly spaced, with the next one peeking in.
- Show All Tabs on the web, Mac and iPad: Home is drawn as your latest notes and folders, with room between the rows, and other tabs' pictures fit without being cut off.

### Fixed

- iPhone and iPad folder cards: a long folder name no longer pushes the last-edited date off the card.
- Back now works in a tab you opened from a page, like Home's See all, a folder or a note in a list: it closes that tab and takes you back to where you were, on the web, Mac and iPad.

## Version 1.5.61: Small update

Released 2026-11-21 10:25:19+06:00 (build 76, tag v1.5.61)

Folder cards fit their words on iPhone, and Home's picture in Show All Tabs has room to breathe.

### Improved

- iPhone Home: bigger note and folder cards, evenly spaced, with the next one peeking in.
- Show All Tabs: Home is drawn with its latest notes and folders on the web too, with more room between the rows.

### Fixed

- iPhone and iPad folder cards: a long folder name no longer pushes the last-edited date off the card.

## Version 1.5.60: Small update

Released 2026-11-21 10:02:53+06:00 (build 75, tag v1.5.60)

Back always takes you back, and Show All Tabs pictures Home properly.

### Improved

- Show All Tabs on the Mac and iPad: Home is drawn as your latest notes and folders, whole, and other tabs' pictures fit without being cut off.

### Fixed

- Back now works in a tab you opened from a page, like Home's See all, a folder or a note in a list: it closes that tab and takes you back to where you were, on the web, Mac and iPad.

## Version 1.5.59: Small update

Released 2026-11-21 09:35:05+06:00 (build 74, tag v1.5.59)

Folder cards look cleaner: corners that line up, a fully frosted front so names read clearly, and tighter rows on Home.

### Improved

- Folder cards on the web, Mac, iPad and iPhone: the front is fully frosted, so a folder's name, counts and last change read clearly over the notes inside.
- Home on the Mac and the web: less space between a section's title and its cards, and between sections.

### Fixed

- Folder cards: the folder's back no longer peeks out past the front's bottom corners, and a subfolder's outline no longer shows through the folder.

## Version 1.5.58: Small update

Released 2026-11-20 17:43:36+06:00 (build 73, tag v1.5.58)

Folders get a new look: frosted fronts with the notes inside, subfolders stacked behind, and smaller cards on the web and the Mac.

### Improved

- Folder cards on the web, Mac, iPad and iPhone: up to five notes inside drawn as note cards, up to two subfolders stacked behind, and a see-through front with the name, counts and last change.
- Folder and note cards are 25% smaller on the web and the Mac, so more fit in a row.
- The folder icon in the sidebar shows a page inside, or a stack when the folder has subfolders.

## Version 1.5.57: Small update

Released 2026-11-20 11:04:41+06:00 (build 72, tag v1.5.57)

Offline & sync works properly again, Catch me up explains itself, and the iPhone gets a round of polish.

### Improved

- Catch me up: one clear page with Foli AI's flower, what it reads and what the brief holds, and a Write my brief button
- iPhone: the sync details show each state with its own mark and a tidy list, and a button only when there's something to do
- iPhone: Foli AI's message box sits on its own card, apart from the replies, and Send shows once you've typed
- iPhone and iPad: Quick add has a full-width Task / Note switch, and its add button shows once you've typed
- iPhone: a sheet's round buttons have room between them, and Home's counts are quieter badges
- Settings: App lock (Face ID or passcode) is named for what it is and sits with Security; Devices is Signed-in devices

### Fixed

- Offline & sync: Notes kept and Space used show again on iPhone, iPad and Mac, and Download everything now shows its progress

## Version 1.5.56: Small update

Released 2026-11-20 08:47:32+06:00 (build 71, tag v1.5.56)

On iPhone, a note's own bars are back, and they now trade places smoothly with the tab bar.

### Improved

- iPhone: a note's bars are Folevi's again (the place at the top, the tools, Foli AI and + at the bottom)
- iPhone: opening or closing a note swaps the tab bar and the note's bars in place, instead of the bars sliding in and out with the page

## Version 1.5.55: Small update

Released 2026-11-20 08:01:46+06:00 (build 70, tag v1.5.55)

On iPhone, a note now uses iOS's own bars, so moving between your lists and a note feels smooth.

### Improved

- iPhone: opening or closing a note turns the tab bar into the note's toolbar in place, instead of the note's buttons sliding in and out with the page
- iPhone: a note's Back, place, Share and menu sit in iOS's own top bar, and its tools in iOS's own bottom bar

## Version 1.5.54: Small update

Released 2026-11-19 22:59:23+06:00 (build 69, tag v1.5.54)

New note moves to the top bar on Mac and iPad, the iPhone shows whether your notes are synced, and the iPad gets a round of fixes.

### Added

- iPhone: a cloud beside the bell on Home shows whether everything is synced. Tap it for the details and Retry

### Improved

- Mac and iPad: New note is a black button in the top bar, right after your tabs, and no longer in the sidebar
- iPad: your account sits in the top left corner, and the sidebar starts with the page you're on
- iPad: the menu button on note and folder cards is lighter
- iPad: smoother on big libraries: card pictures load in the background, and the window redraws less
- iPhone Duo: with the phone open, the note beside the list is the last one you opened, and card titles no longer break mid-word

### Fixed

- iPad: tapping the cloud now shows the sync details, and no longer blocks your next tap
- iPad: closing a note's Style or Format panel no longer leaves a ring or a tooltip behind
- Phones: the first-launch screens no longer slide sideways
- Notes: closing the tools panel keeps your cursor where you were typing

## Version 1.5.53: Small update

Released 2026-11-19 19:37:45+06:00 (build 68, tag v1.5.53)

Foli AI is in the iPhone's tab bar, Folevi works on iPhone Duo, and the first screens say less.

### Added

- iPhone Duo: open, the tabs become a sidebar and a note opens beside its list; closed, the note's buttons sit in iOS's side bars. Folding or unfolding keeps the note open, with your text and the keyboard where they were

### Improved

- iPhone: Foli AI is a tab, after Calendar, for people who have it, and opens over the screen you're on. The + button sits on its own at the top
- Every platform: the first-launch screens have much less small print
- Website: the product pages show what changed in 1.5.50 to 1.5.52

## Version 1.5.52: Small update

Released 2026-11-19 17:43:27+06:00 (build 67, tag v1.5.52)

Note lists on the Mac, iPad and web have a Filter notes field you can always see.

### Added

- Mac, iPad and web: All notes, Bookmarks, Drafts, Archive, Trash, Templates, folders and tags have a Filter notes field with a filter icon. It narrows the list by title or text, and Escape clears it

## Version 1.5.51: Small update

Released 2026-11-19 15:26:19+06:00 (build 66, tag v1.5.51)

A calmer iPhone Home and top bar, a list filter you can always see, and a long round of note editor fixes on every platform.

### Improved

- iPhone: no bar over the tab bar. Foli AI and + sit together in the top bar, and the flower shows only where Foli AI is on
- iPhone: the account button has no glass circle, and a workspace's logo shows your picture small on its corner
- iPhone: All folders and Foli DNA are on Home instead of in a menu
- iPhone: Notifications has no settings button, and Unread shows its count in full
- Every platform: the field that filters a list says Filter notes, Filter folders or Filter tags, with a filter icon. On iPhone it's always at the top of the list, with no pull needed
- Editor: Enter, Backspace and Tab stay fast in a long note, moving between lines no longer redraws the page, and long notes save with less work
- Editor: paste, copy and cut, pictures, recordings, code, columns, tables and databases, from the audit of 19 November
- Canvases: undo keeps what others drew, nothing is lost at the size limit, and touch behaves
- iPhone and iPad: the line you're writing stays above the keyboard

### Fixed

- iPhone: closing Search takes you back to where you opened it
- iPhone and iPad: Return in a to-do or a toggle keeps the words after the caret
- iPhone and iPad: typing is saved as the app goes to the background
- Editor: a note changed on another device opens with the newer text, and an edit never replaces it unseen
- Sync: a resent edit never replaces another device's change, and a long queue of edits drains
- Editor: a field being typed in inside a block is saved as you go, and a Vault note asks before discarding
- Editor: a new note's title keeps the caret when the tools panel opens
- Touch: a block dragged with a finger always lands or goes back, and a long press while writing is iOS's own

## Version 1.5.50: Big update

Released 2026-11-19 14:17:51+06:00 (build 65, tag v1.5.50)

iPhone and iPad: Folevi looks like an iOS 26 app now. The iPhone uses the system tab bar, bars, menus and sheets, and the iPad's wide layout is laid out like Folevi for Mac. Notes keep their own fonts.

### Added

- iPhone: Search is its own tab, next to Home, Tasks and Calendar
- iPhone: Ask Foli AI and the + button sit in a bar just above the tab bar
- iPhone: Settings has a search field, and Appearance shows the theme as three pictures of the iPhone
- iPad: in the wide layout, tabs along the top, the sidebar, and each screen in a rounded card with its controls floating in glass, as on the Mac
- iPad: Settings opens in a sheet with a list of categories on the left and a working search field

### Improved

- iPhone: large titles that shrink as you scroll, the system Back button and edge swipe, and glass buttons in the bars
- iPhone: the system's menus, with Folevi's icons, for "…" buttons, the Create menu and a long press on a note or row
- iPhone: sheets are the system's glass sheets, with a drag handle and a round close button
- iPhone: interface text is SF Pro at Apple's text sizes and follows your text size setting; notes, note cards and the editor keep Instrument Sans and Spectral
- iPhone: a task's status is a segmented control, and its priority and assignee are menus
- iPhone: the Vault shows its state under its title, with Lock and "…" in the bar
- iPhone and iPad: no lines between the rows of a list, with the same spacing
- iPad: Home, the lists, folders, Tasks, Calendar, the Vault, a note's tools, notifications and Help use the Mac's native screens
- iPad: dialogs open as sheets, the bell opens a popover, and confirmations are system alerts
- iPhone and iPad: Folevi lets go of note covers and card text when the device runs low on memory, and lists scroll more smoothly

### Fixed

- iPhone and iPad: in dark mode a switch that was on was hard to see; it's now graphite, so the white knob shows

## Version 1.4.50: Small update

Released 2026-11-19 11:15:21+06:00 (build 64, tag v1.4.50)

Mac: smoother scrolling in lists, cleaner lists with no lines between rows, and a tab's close button always at the tab's left edge.

### Improved

- Mac: lists scroll more smoothly with the pointer over them (Home, notes, folders, tasks); rows show no hover while a list is moving
- Mac: no lines between the rows of a list (tasks, notes and folders in list view, the Vault's passwords, calendars, Help's shortcuts), with the same spacing
- Mac: a tab's close button is always at the tab's left edge, whatever the tab's width
- Mac: no blur at the bottom of the Foli AI panel
- Mac: Folevi lets go of more memory when the Mac runs low
- Web: the Vault, the theme picker, text fields, Tasks and Calendar take the polish the Mac got in 1.4.49

### Fixed

- Mac: the date picker, the list of times and the time zone list stayed in memory after they closed
- Mac: with more than one window, note covers and card text could stop loading after the first window was closed
- Mac: the title bar's tabs were drawn again at every move of the caret in a note

## Version 1.4.49: Small update

Released 2026-11-19 08:03:11+06:00 (build 63, tag v1.4.49)

Mac: a calmer, more consistent look across menus, fields, shadows, the Vault, Tasks and Calendar, and task dialogs that show their panel again.

### Improved

- Mac: menus, popovers and the bar over a note are glass, and every menu has taller rows with icons
- Mac: one text field everywhere, taller, with a visible edge and a clear active state
- Mac: one segmented control, the pill, at one size
- Mac: lighter shadows, the same everywhere
- Mac: Settings shows the theme as three pictures of the window
- Mac: the Vault's Add dialog and its settings are redesigned, with named groups and one control per row
- Mac: the month in Calendar fits the window, and its side list scrolls on its own
- Mac: Tasks has a magnifier in its filter, even spacing between a task's details and matching day headings
- Mac: the task dialogs use one kind of control, and calendar colors are a row of dots

### Fixed

- Mac: Edit task, Move task, Quick add and Subscribe opened with no panel behind their fields
- Mac: a done task's checkbox was invisible in Completed, the Calendar's day list and Agenda
- Mac: the list of times in a task dialog was see-through
- Mac: a note's panel covered the note's words in windows narrower than about 1490 points
- Mac: the open tab could end up under the arrows when the tabs first overflowed
- Mac: Notes was cut off in the Vault's Add dialog
- Mac: words in the Style panel sat against the edge of their highlight
- Mac: every day heading in Agenda was red; now only Overdue is

## Version 1.4.48: Small update

Released 2026-11-18 21:48:57+06:00 (build 62, tag v1.4.48)

iPhone and iPad: plain notes with page breaks show each page as a card, as on the web and Mac.

### Improved

- iPhone: a plain note with page breaks shows its pages as cards on a light grey background with a soft shadow

### Fixed

- iPhone and iPad: in dark mode, page cards stand out from the background

## Version 1.4.47: Small update

Released 2026-11-18 21:29:47+06:00 (build 61, tag v1.4.47)

Notes open with Foli AI ready beside them, tab thumbnails show each note's real card, and the Mac's two sidebars match.

### Improved

- Every note opens with Foli AI on the right, or Insert when Foli AI is off; close it and it stays closed until you open a panel again
- Mac: Show All Tabs and the tab preview show each note as its card, with its colors, cover, title and folder, never cut off
- Mac: the left sidebar and the right panel are the same width
- A lighter, softer shadow under the note's bottom bar

### Fixed

- Mac: the tab preview sometimes didn't show when moving from one tab to the next
- Mac: the bottom of the right panel looked cut off

## Version 1.4.46: Small update

Released 2026-11-18 20:55:50+06:00 (build 60, tag v1.4.46)

Notes look cleaner and the Mac works more like the web: a plain note is one flat page, every tab is the same width, and the note's tools sit in the sidebar.

### Improved

- A note with no style is one flat page with no card around it; with page breaks, its pages become cards on a light grey background
- Softer shadows under note pages
- The space around a note grows and shrinks smoothly with the window
- Mac: every tab in the title bar is the same width, and together they fill the bar
- Mac: Show All Tabs shows each tab as you last saw it, notes in their colors and folders with their notes
- Mac: on a note the sidebar shows its contents, comments, tasks, attachments and find, with a switch back to your folders beside the sidebar button; Style, Format, Insert and Foli AI stay on the right
- Mac: Sort comes before the view switch on folder pages, as on the web

### Fixed

- Mac: the sync status opened its details far below its button
- Mac: the view switch, Sort and More buttons on folder pages did nothing when clicked

## Version 1.4.45: Small update

Released 2026-11-18 18:36:09+06:00 (build 59, tag v1.4.45)

Folevi for Mac uses less memory and battery, keeps tabs tidy and fixes a few rare glitches.

### Improved

- Short tabs are only as wide as their title
- Show All Tabs sits right after Home
- Closed tabs and windows give their memory back
- Less battery use while Folevi sits idle or in the background
- Foli DNA stays smooth while you pan and hover over large maps
- Smoother scrolling through Home's cards

### Fixed

- A note could stay covered, or Folevi could keep connecting, after one unreadable update from the editor
- Switching tabs quickly while the editor reloaded could show the wrong note
- Pressing the Quick Add shortcut twice quickly made the panel disappear

## Version 1.4.44: Big update

Released 2026-11-18 13:23:31+06:00 (build 58, tag v1.4.44)

Folevi for Mac looks and feels like a native macOS app: tabs in the title bar like Finder, Liquid Glass controls, a roomier sidebar, a new Settings window and the system font throughout, with notes keeping their own fonts.

### Added

- Tabs in the title bar like Finder's, the open tab in Liquid Glass, with Back, Forward and Show All Tabs beside them
- A Settings window of its own, with a category list and search
- The sync status in the title bar, beside notifications

### Improved

- A roomier sidebar with taller rows and clearer sections
- One button size and the system font across the app; notes and folders keep their own fonts
- Folevi's own icons throughout, and the Foli AI flower for Foli AI
- The floating Foli AI chat on Liquid Glass, with answers easier to read
- Nothing floats over a note, so the page starts right at the top
- Quieter title bar while switching tabs

### Fixed

- The open tab's shadow was cut off
- Lines of a Foli AI answer could be drawn over each other
- The Stop button was cut off while Foli AI was writing
- The Vault showed a light band across its top

### Breaking changes

- Folevi for Mac now needs macOS 26 or later; Macs on earlier versions keep Folevi 1.3.44

## Version 1.3.44: Small update

Released 2026-11-17 14:51:01+06:00 (build 57, tag v1.3.44)

iPhone and iPad catch up with the web and Mac: the note menu, tags, sharing, the iPad menu bar, a calmer Home and note bars that match the page

### Added

- iPhone: the Vault is on Home, in the card with Templates, Archive and Trash, once you have one
- iPhone: a note's menu has everything the web's has, including Info, Related notes, Save as template, Move to the Vault, Review this note, Show editors and Print
- iPhone: add tags to notes from Info or by selecting notes, and rename, recolour or delete a tag by holding it on Home
- iPhone: a Tags page, and folders shared with you in Shared with Me
- iPhone: Share and Invite people in a folder's menu, and moving notes or folders to another place
- iPhone: Foli DNA's saved views in Home's menu
- iPad: the menu bar, with the Mac's menus and keyboard shortcuts, including New Tab, New Folder, Move to, Copy Link, Find and Print
- iPad: Settings > This device, for the Face ID lock, in the wide layout
- iPad: a right-click menu on empty space, ⌘-click or middle-click a folder to open it in a background tab, and box select and scroll zoom in Foli DNA

### Improved

- iPhone and iPad: a note's top and bottom bars take the page's own colour, light or dark, instead of a dark band over light notes
- iPhone: Home is calmer, with no lines inside its cards and a lighter grey
- iPad: your tabs and the open page come back after the app restarts
- iPad: downloads from a notification can be saved to Files

### Fixed

- iPad: Import, profile photo, Vault upload and download, saving the Vault recovery key and Foli AI's Download Markdown now work in the wide layout
- iPhone: Move to Trash moves a note to Trash, with Undo, instead of asking to delete it permanently
- iPhone: a note in Trash offers Restore and Delete permanently
- iPhone and iPad: Reviews opened from a note or Foli AI, Create a workspace, the Inbox link and Foli DNA links from a note open the right page
- iPhone: Help from the account sheet opens in the app

## Version 1.3.43: Small update

Released 2026-11-16 09:19:04+06:00 (build 56, tag v1.3.43)

A new iPhone Home with tiles and rounded cards, the folder menu in each card's corner, and a polish pass on every platform

### Improved

- iPhone Home: Catch me up is its own card, All notes, Drafts, Shared with Me and Changes are tiles, and Bookmarks, Tags and the rest sit in rounded cards without long hairline lists
- Folder cards on the web, Mac and iPad: the "..." button sits in the front pocket's top-right corner, clear of the folder name
- iPhone and iPad: Reduce Motion is respected everywhere, including Foli AI answers, which appear whole
- Every platform: buttons press the same gentle way, numbers that change (counts, timers, task times) no longer shift their neighbours, and small buttons are easier to tap
- iPad: icon buttons are full 44-point targets, and note and folder card menus stay clear of their titles
- Menus and popovers open faster on the web and Mac, and close with a short fade on iPhone
- Pictures, avatars and workspace logos get a soft outline that works in light and dark
- Toasts fade out gently, and the selection bar leaves with a fade instead of sliding off
- Mac: Ask Foli AI and Catch me up no longer lift on hover

### Fixed

- PDF text is searchable on the web again
- Full-screen canvases at phone width: tools fold into More instead of scrolling sideways
- Switching to a recent tab after a reload shows its note right away instead of a loading placeholder

## Version 1.3.42: Small update

Released 2026-11-16 05:27:29+06:00 (build 55, tag v1.3.42)

Steadier Foli AI and Quick Add: replies stay in their own chat, failed sends keep your words, and late saves never clear newer typing

### Fixed

- Foli AI on iPhone, iPad and Mac: an answer that arrives after you open another chat stays in its own conversation
- Foli AI: a question or edit that fails to send is put back in the box, ready to try again
- Quick Add: a save that finishes late no longer closes or clears what you typed after it
- Quick Add on iPhone, iPad and Mac: if a capture can't be kept on the device, it says so and keeps your draft
- Mac: Foli AI keeps following a long answer to its end while it streams
- iPhone and iPad: less scrolling work while a Foli AI answer streams

## Version 1.3.41: Small update

Released 2026-11-15 18:17:40+06:00 (build 54, tag v1.3.41)

Shared folder invitations on iPhone and iPad, and encrypted notes that keep their card's look

### Fixed

- iPhone and iPad: an invitation to a shared folder can be accepted or declined from Notifications, and accepting opens it under Shared with Me
- End-to-end encrypted notes keep their card's look on every device

## Version 1.3.40: Small update

Released 2026-11-15 13:47:35+06:00 (build 53, tag v1.3.40)

Steadier capture, sharing and Foli AI on iPhone and iPad, and interrupted gestures that no longer act on their own

### Improved

- Foli AI: long answers stream with less work per word, and the chat follows new text at the end but keeps your place when you scroll up to read
- iPad: the open screen stays when Split View or Stage Manager moves the window between the narrow and wide layouts
- iPhone tables: the add-row and add-column buttons are a full finger's size

### Fixed

- iPhone and iPad: New folder and Quick task in the Create menu work, and Quick Add from a widget, the control, a link or Cmd+Shift+A opens the capture sheet
- iPhone: Share on a note opens sharing instead of a placeholder
- iPhone: going back to a note's tab shows that note again
- Quick capture keeps words typed while a task is saving, and an item saved on the device for later is sent only once
- Website: pressing Add twice quickly makes one task
- Tasks: tapping a task again while it is being checked off leaves it open
- Tasks you can only view can no longer be marked done from the task sheet
- Swipe rows and sheets: an interrupted swipe or drag, or a second finger, no longer runs the swipe action or closes the sheet with your typing
- iPad: a floating keyboard, or one in another window, no longer pushes the note up
- Mac: reopening Quick Add brings back what you had started typing

## Version 1.3.39: Big update

Released 2026-11-13 07:01:29+06:00 (build 52, tag v1.3.39)

A sturdier note editor: nothing typed or drawn is lost, one undo, tables that work like a grid, and spell check

### Added

- Spell check in notes: misspelt words are underlined, with guesses, Learn and Ignore in the text menu (on from the start on the Mac; English on the website)
- Tables: select a range of cells, copy and paste with spreadsheets, drag a column's edge to resize it, and drag rows and columns to a new place
- Flowcharts: copy, cut and paste shapes, pinch to zoom on a trackpad, and the canvas follows when you drag to its edge
- Images resize by dragging their edges
- The arrow keys move into and out of a synced block

### Improved

- Undo: a flowchart, mind map or wireframe shares one undo with its note, Cmd+Z in a label takes back the typing first, and undo still works after switching tabs or notes
- Pasted text joins the line you are on, and Cmd+Shift+V pastes plain text
- The / and @ menus open only when typed and close when nothing matches
- Mac: Edit > Undo and Redo use the note's own history, the keyboard returns to the note with the caret where it was after the Cmd+K palette or a dialog, and Paste from the right-click menu keeps files and Folevi blocks

### Fixed

- Mac: what you just typed or drew is saved before the app quits or a window closes
- Text being typed in a flowchart, mind map, sticky note or wireframe is saved as you type and when you leave
- Changes to a canvas from another device merge with yours instead of replacing them
- A recording is kept when you leave its note
- Table rows no longer jump or vanish while you type under a sort or filter
- Format shortcuts no longer change the note while you are working in a canvas or another field
- Tab in a code block no longer deletes a selection, and Turn into To-do keeps a task's details

## Version 1.2.39: Small update

Released 2026-11-08 17:50:18+06:00 (build 51, tag v1.2.39)

Less work while scrolling on iPhone and iPad

### Improved

- iPhone and iPad: less work while scrolling notes, cards and long notes, and the app now rests when the keyboard is up and nothing is moving

## Version 1.2.38: Small update

Released 2026-11-08 12:53:34+06:00 (build 50, tag v1.2.38)

Folders look like real folders, and folevi.com shows the real app

### Improved

- Folder cards on the web, Mac, iPhone and iPad look like a folder: a tab with a sloped shoulder, softer colour, and the name with how many notes and when it last changed under it
- Home: the AI credits note under Catch me up runs the full width
- folevi.com: a new home page with the Mac and iPhone apps playing in the hero, plus updated features, pricing, apps and compare pages

## Version 1.2.37: Small update

Released 2026-11-06 11:08:28+06:00 (build 49, tag v1.2.37)

A shorter Share dialog with real folevi.com links, a polished Foli DNA with a floating card and a time-lapse bar, folder paths like Finder, and a hover on every button.

### Added

- Foli DNA plays how your notes grew with a time-lapse bar: play and pause, drag to any date, and see how many notes existed then.
- In a subfolder, a path button lists the folders above it, as Finder does, and opens any of them.

### Improved

- The Share dialog is about half as tall: access is one dropdown, the public link is a switch, and its settings fold away.
- Foli DNA shows connections and Insights in one floating card grouped by reason, with zoom controls in a small bar.
- List pages have more room at the top, and their controls sit in one quiet tray.
- Every button and control shows a hover effect.

### Fixed

- Public links are always folevi.com addresses, including links copied in the Mac app.
- Insights in Foli DNA did nothing while the map was centred on a note.
- Pointing at a note in Foli DNA no longer hides the names of the notes around it, and its card no longer covers the dot.
- Notes no longer offer Open in new tab, since they always open in a tab of their own.

## Version 1.2.36: Small update

Released 2026-11-06 06:28:32+06:00 (build 48, tag v1.2.36)

Finder-style folders and multi-select, a note-centred Foli DNA map, a compact one-row list header, a tidier note menu, and fixes from a full review of the Mac, web, iPad and iPhone apps.

### Added

- Folder tabs work like Finder: opening a folder reuses its tab or switches to one already open, and each tab keeps its own back and forward.
- Select several notes or folders with Command-click or Shift-click, then move, copy, archive, trash, bookmark, colour, tag or open them in new tabs together.
- Foli DNA opens centred on the note you are reading, with a legend, a short tour and a panel that explains why notes are connected.

### Improved

- List pages use one compact header row with the sort and view controls beside the title.
- The note menu groups its items into Connections, History, Move and copy, Share and export, and Note settings.
- Move and copy dialogs can create a folder and use Folevi's own dropdowns.
- Settings and Foli AI fit tablet widths, dialogs dim the page behind them, and the sidebar starts folded on narrow windows.
- Mac switches, sliders, checkboxes and dialogs match the rest of Folevi, and the first click in a window works.
- On the iPad, the note dock appears in the wide layout and row actions are easier to reach by touch.

### Fixed

- Clicking anywhere on a tab now opens it.
- Foli DNA no longer opens empty or on the wrong notes.
- Foli AI no longer always says a message was sent to Google.
- The Tasks view switcher no longer overflows on narrow screens.
- Popovers no longer cover the line you are typing.

## Version 1.2.35: Small update

Released 2026-11-06 02:47:02+06:00 (build 47, tag v1.2.35)

Folder page headers, a sidebar order of your own, folders in new tabs, a new Mac Settings window and Spotlight fixes

### Added

- Folder pages show the folder's name, note count and last edit at the top, with Share, a menu and New note beside it; nested folders show their path.
- The sidebar keeps its own folder order, synced with your account: drag folders there to arrange them without changing the Folders page.
- Open in new tab in a folder's menu, and Cmd-click or middle-click a folder, to open it in a tab behind the one you're on.

### Improved

- Mac Settings lists its sections down the left and always fits the screen.
- The Folders page has a title with the folder count; subfolders sit under their own heading.

### Fixed

- Mac: Spotlight results open the right note even when Folevi was closed or the note is in another account, and locked or trashed notes leave Spotlight at once.
- Mac: Undo in a toast is no longer cut off.
- The theme gallery's search field is as tall as the buttons beside it, and the note toolbar's divider is light in dark mode.

## Version 1.2.34: Small update

Released 2026-11-06 00:32:50+06:00 (build 46, tag v1.2.34)

Folders on iPhone scroll again

### Fixed

- On iPhone, the Folders list scrolls again when you swipe on the folder cards. Hold a card still to move it.

## Version 1.2.33: Small update

Released 2026-11-05 14:20:04+06:00 (build 45, tag v1.2.33)

Foli DNA works properly on every device, folders are easier to organise, and 22 fixes from a full QA audit.

### Added

- Folders page sort: Manual, Name or Recent, with Home Screen style dragging to put folders in order
- Sidebar folders show the first five with Show more, and have their own sort

### Improved

- Foli DNA: the map fits the window, labels every note with room, and no longer shows another note behind it
- Lighter folder cards with a clearer page count, and a brighter bookmark ribbon in dark mode
- Accessibility: search results, calendar days, row menus and dark checkboxes work properly with VoiceOver
- Joined notes stay readable with Format, Style or Info open, and the editor toolbar always fits

### Fixed

- Typing straight after Command K no longer loses letters
- A workspace note no longer briefly shows as private
- Empty template checkboxes no longer become Untitled tasks
- HTML export keeps task due dates
- File > Import on the Mac opens Import and Export
- Offline storage figures no longer stay at ...

## Version 1.2.32: Small update

Released 2026-11-05 11:27:09+06:00 (build 44, tag v1.2.32)

Graph is now Foli DNA, on the web, Mac, iPhone and iPad, with a view around one note, filters, colours, saved views and more.

### Added

- Foli DNA of one note, from the note's menu and the Inspector, with a live panel that follows the open note
- Filters by folder, tag and date edited, colours by folder or tag, and saved views in the sidebar
- Foli DNA on published pages, off until turned on per link

### Improved

- Graph is renamed Foli DNA everywhere, with Go to Foli DNA in the command palette and the Mac's Go menu
- Bigger spaces draw smoothly, up to 500 notes

## Version 1.2.31: Small update

Released 2026-11-05 09:47:07+06:00 (build 43, tag v1.2.31)

Every note in Spotlight on the Mac, and a polish pass

### Improved

- On the Mac, Spotlight finds every note, archived ones too, by any word in it (Settings has a switch to turn it off)
- Note cards have lighter shadows and less rounded corners, and folders are flat
- Menus highlight the row under the pointer on the Mac and iPad, and dialogs open in the middle of the window
- New folder is in the right-click menu on folder pages, and the note and folder … buttons look the same

### Fixed

- Dragging a note or folder onto a folder didn't move it on the Mac and iPad
- The … on a note card opened the note instead of its menu

## Version 1.2.30: Small update

Released 2026-11-04 12:12:30+06:00 (build 42, tag v1.2.30)

Docked is now Bookmarks

### Improved

- Docked is now Bookmarks, with Bookmark and Remove bookmark in menus, a bookmark icon, and a ribbon on bookmarked cards

### Fixed

- Dropping a note on a folder card didn't move it on the Mac and iPad

## Version 1.2.29: Small update

Released 2026-11-04 07:30:05+06:00 (build 41, tag v1.2.29)

Folders work like Finder

### Improved

- Drag a folder onto another folder to put it inside, on the Mac and iPad as on the web
- The Folders page shows only top-level folders; search still finds folders inside others and says where they are
- New folder sits next to New note on the Folders page and on every folder's page

## Version 1.2.28: Small update

Released 2026-11-03 20:27:49+06:00 (build 40, tag v1.2.28)

Starred is now Docked, with a foldback clip icon

### Improved

- Starred is now called Docked everywhere, with Dock and Undock in menus and a new foldback clip icon
- On iPhone a note's colour runs all the way to the bottom of the screen
- Foli AI's message box has matching rounded corners top and bottom

### Fixed

- A table's Header row, Totals row and Foli AI buttons were cut off at the bottom

## Version 1.2.27: Small update

Released 2026-11-03 17:40:15+06:00 (build 39, tag v1.2.27)

A smoother editor: leaving columns, canvases in narrow columns, and clearer insert names

### Improved

- Enter on an empty last line of the last column moves below the columns; Insert below columns in the block menu
- Flowcharts, mind maps, whiteboards and wireframes in narrow columns show a preview with Open canvas
- New flowchart shapes go beside the selected shape instead of on top of it
- Table is now Database and Quick table is Simple table, each with a short description
- New gallery, board, table and calendar cards start with the cursor in their title
- The recorder asks you to allow the microphone, and explains how to turn it back on
- Screen readers hear bullets as lists, and images get a Description separate from the caption

### Fixed

- The bottom note bar no longer covers the line or table cell you're typing in
- Image from Unsplash no longer shows when photo search isn't available

## Version 1.2.26: Small update

Released 2026-11-03 14:10:29+06:00 (build 38, tag v1.2.26)

New workspaces from the apps, and tabs for each workspace

### Added

- New workspace on the Mac, iPad and iPhone asks for a name, makes the workspace and opens it

### Improved

- Mac and iPad: each workspace keeps its own tabs, which come back when you switch back and after a relaunch
- Shared links that anyone can open show the note's title, first lines and card in link previews

## Version 1.2.25: Small update

Released 2026-11-03 12:27:19+06:00 (build 37, tag v1.2.25)

Sheets that match your iPhone's corners

### Improved

- Sheets on iPhone round their corners with the screen's, so their foot follows its curve; Foli AI's box inside matches

## Version 1.2.24: Small update

Released 2026-11-03 10:03:29+06:00 (build 36, tag v1.2.24)

Smoother iPhone and iPad, and Foli AI everywhere

### Improved

- Scrolling and animations are smoother: a hidden screen no longer keeps the app busy while nothing moves
- Foli AI's own flower and name wherever the assistant appears
- A note's suggestions and links sit on the note's own page; roomier Account sheet; more room under the top bar

### Fixed

- A table cell saved as plain text no longer stops its note from opening

## Version 1.2.23: Small update

Released 2026-11-03 07:40:43+06:00 (build 35, tag v1.2.23)

Float a note above every other window

### Added

- Mac: Float note, in a note tab's menu and Window > Float Note, pops the note into its own small window that stays on top of other apps until you turn its pin off; several notes can float at once and they come back after a relaunch

## Version 1.2.22: Small update

Released 2026-11-03 06:13:58+06:00 (build 34, tag v1.2.22)

Note cards take a look from what the note is

### Improved

- Note cards take a stationery look from what the note is: a binder clip when starred, fanned sheets with pages inside, a tab divider, a pocket for attachments, graph paper for canvases, an index card for lists, a typed memo for templates, and a spiral page otherwise

## Version 1.2.21: Small update

Released 2026-11-02 10:31:44+06:00 (build 33, tag v1.2.21)

Softer sheets on iPhone

### Improved

- Sheets have gentler corners at the top
- Foli AI's message box and its buttons have matching corners

### Fixed

- The Notifications list reaches the bottom of its sheet, with no grey band

## Version 1.2.20: Small update

Released 2026-11-02 09:57:35+06:00 (build 32, tag v1.2.20)

Rearrange notes from any sort

### Improved

- Rearrange in a note's menu works in any sort, and Done switches the list to Manual order

## Version 1.2.19: Small update

Released 2026-11-02 09:50:28+06:00 (build 31, tag v1.2.19)

Smoother iPhone notes and sheets

### Added

- Arrange notes in a note's menu lets you drag your notes into place in Manual order

### Improved

- The note's top bar blurs what scrolls under it
- More room between the note and the buttons above it
- Sheet buttons sit further in from the rounded corners
- The Insert sheet's tiles are all grey, with tidier names
- A note theme shows it's loading as soon as you tap it
- The keyboard toolbar fades out before the hide-keyboard button

### Fixed

- Swiping from the left edge goes back again in Manual order
- The folder above a note opens on the first tap

## Version 1.2.18: Small update

Released 2026-11-02 08:46:16+06:00 (build 30, tag v1.2.18)

Arrange your notes like your Home Screen

### Added

- In Manual order on iPhone, hold a note and drag it into place; the others make room until you tap Done

### Improved

- Sheets on iPhone follow the screen's rounded corners
- The Foli AI sheet's message box sits at the bottom of the sheet

## Version 1.2.17: Small update

Released 2026-11-02 06:30:40+06:00 (build 29, tag v1.2.17)

Note cards that work everywhere

### Improved

- The whiteboard fills the screen in full screen on iPhone, with its tools in two rows
- A full-screen chart sits between its tools and Done

### Fixed

- YouTube and other videos play inside notes in the app
- A note with a missing collection opens, and that card says the collection is unavailable
- Done on a full-screen card no longer brings up the keyboard
- A mind map opens centred in its card on iPad
- Show all tabs opens the tab overview again on iPad

## Version 1.2.16: Small update

Released 2026-11-02 05:42:18+06:00 (build 28, tag v1.2.16)

iPhone polish: calendar views, toggles, gestures and full-screen canvases

### Improved

- The Chat and Research switch has room and slides between its two sides
- Long folder names that are one word stay on one line with an ellipsis
- Long-press a note on Home for its menu, like folder cards
- Swipe from the left edge to go back
- The top-left button shows your workspace's logo with your photo in its corner
- Swipe up or down on a sheet's list to resize it
- Every toggle matches the web and Mac's rounded switch
- The month view lines each date up under its weekday
- A redesigned week view on iPhone, iPad, Mac and the web
- The calendar menu has Subscribe, with one-tap Add to Apple Calendar and Add to Google, and Calendars
- Full-screen canvases use the whole screen, with Done and the zoom clear of the edges

## Version 1.2.15: Small update

Released 2026-11-01 12:59:10+06:00 (build 27, tag v1.2.15)

Playful motion

### Improved

- Sheets and menus grow from the button you tapped, the tab selection slides, search rises to the top, and buttons and cards press like real ones; with Reduce Motion on, everything simply fades

## Version 1.2.14: Small update

Released 2026-11-01 10:49:08+06:00 (build 26, tag v1.2.14)

iPad polish and About

### Added

- Drag notes and folders onto folders in the iPad sidebar
- Settings > About with the version and Folevi's policies, on every platform

### Improved

- iPad: the Mac's tab rules, tab names up to the close button, no white band behind the tab bar, shadows that aren't cut off, and bigger fields and buttons

## Version 1.2.13: Small update

Released 2026-11-01 10:21:27+06:00 (build 25, tag v1.2.13)

A better iPad

### Improved

- iPad in portrait and Split View: the sidebar slides over the content instead of squeezing it
- Writing on iPad: the note scrolls to keep what you type above the keyboard, with a formatting bar on the keyboard
- The iPad's Home tab, note page and wording fit the iPad, with the Mac's keyboard shortcuts for tabs and Settings

## Version 1.2.12: Small update

Released 2026-11-01 05:24:39+06:00 (build 24, tag v1.2.12)

Copy code in one tap

### Added

- A Copy button in the corner of every code block: always shown on iPhone and iPad, on hover on web and Mac

## Version 1.2.11: Small update

Released 2026-10-31 23:11:14+06:00 (build 23, tag v1.2.11)

Notes look like themselves, and a better iPhone editor

### Improved

- On iPhone, charts, mind maps, flowcharts, sticky notes, wireframes and whiteboards show as preview cards that open full screen
- Tables on iPhone are easier to read, with even rows and columns that fit their text
- The / menu on iPhone spans the screen and stays clear of the keyboard
- The notes peeking out of folders on Mac show more of their text, as on the web

### Fixed

- On Mac, iPhone and iPad, notes with a style show it on their cards and in folders: the style's image down the side, and its page and text colours
- Notes with your own style image show that image and its colours on their cards

## Version 1.2.10: Small update

Released 2026-10-31 21:03:47+06:00 (build 22, tag v1.2.10)

Gentle motion on Mac

### Improved

- Dialogs and popovers on Mac slide in gently, and menus, popovers and dialogs fade as they close
- Sections and folders in the sidebar open and close smoothly, with their arrow turning
- Switching between Grid, Compact and List, or between Month, Week and Agenda, crossfades
- Tabs ease into place as you open, close or move them
- A task's check mark settles in when you tick it, and Quick Add fades in like Spotlight
- With Reduce Motion on, everything simply fades

## Version 1.2.09: Small update

Released 2026-10-31 20:21:47+06:00 (build 21, tag v1.2.09)

Roomier menus and a cleaner Mac

### Improved

- Menus on Mac have more room: taller rows and more space around their icons and separators
- Editor text size in Settings is a slider, as on the web
- Text in cards, dialogs, empty pages and tasks breaks onto lines where the web breaks it
- The sidebar shows where you are on every view of a page: Tasks on any list, the Calendar on any day, the Vault on any section, and Folders or Tags while their page is open

### Fixed

- Move folder and other dialogs with a long description no longer cut off what's inside them
- A tab's preview shows under its tab, not beside it
- The Vault's Add dialog shows every field with room to type, and its kind picker spans the dialog
- Dialogs on Mac have a Close button
- Help, Graph, Reviews, Shared with Me and Changes have the white background they have on the web
- Tags show their full page count

## Version 1.2.08: Small update

Released 2026-10-31 15:15:16+06:00 (build 20, tag v1.2.08)

Menus on Mac match the web

### Added

- Right-click anywhere on Mac for New note, Search, Ask Foli AI, Back, Forward and Reload; text fields get Cut, Copy, Paste, spelling suggestions and Look Up
- Edit, recolour and delete tags from the Mac sidebar, and sort the Tags page
- Share Foli AI conversations with your workspace and export them as Markdown on Mac

### Improved

- Right-click and button menus on Mac look and work like the web's: their size, placement, checkmarks, icons and blurred background
- Home and Folders scroll more smoothly on Mac

### Fixed

- Ask Foli AI about this folder opens the chat about that folder on Mac
- Folder dialogs on Mac are Folevi's own instead of the system's alerts

## Version 1.2.07: Small update

Released 2026-10-30 22:06:26+06:00 (build 18, tag v1.2.07)

Scrolling on Mac is smooth

### Improved

- Home and Folders scroll smoothly on Mac, without dropped frames

### Fixed

- Note cards on Mac have soft shadows like the web

## Version 1.2.06: Small update

Released 2026-10-30 17:49:25+06:00 (build 17, tag v1.2.06)

Folevi for Mac feels quicker: notes open without a blank page, typing is smoother, and Home stays at the start of the tabs.

### Improved

- Mac: opening a note keeps what was on screen until the note is drawn, instead of showing a blank page first.
- Typing in long notes is smoother: saving no longer redraws the whole page or the sidebar's outline, tasks and links when nothing they show changed.
- Mac: Home stays at the start of the tab strip; only the tabs after it scroll.

### Fixed

- Mac: a joined tab's preview no longer runs under its name.

## Version 1.2.05: Small update

Released 2026-10-30 10:05:05+06:00 (build 16, tag v1.2.05)

Foli AI on your Mac follows the same safety rules everywhere, notes feel quicker, and two fixes.

### Improved

- Foli AI with Apple Intelligence or your own key follows the same safety rules as Foli AI in your account, and says so plainly when it won't help with something.
- Notes, tabs and joined notes respond faster: a note isn't redrawn on every save, and the block handle follows the pointer without slowing typing.

### Fixed

- Settings shows your time zone when it's UTC (it was empty).
- Encrypted notes no longer stop with "This page couldn't load" while they unlock.

## Version 1.2.04: Big update

Released 2026-10-29 10:21:13+06:00 (build 15, tag v1.2.04)

Tabs that do more, on the web and the Mac: pin tabs, see a tab's page before you open it, see every tab at once, and work on up to three notes side by side.

### Added

- Pinned tabs: pin a tab from its pin or its menu; it stays at the start of the strip, half as wide, and closing other tabs keeps it.
- Tab previews: rest on a tab to see a picture of its page, then move along the strip to see the others at once.
- Tab Overview: every open tab as a picture, with search, close and a new note (the grid button, or Shift-Command-\).
- Joined notes: up to three notes side by side in one tab, resized with snapping, rearranged by their bars, folded into slim spines on narrow windows.
- Mac: editor text in five sizes, from Smaller to Larger.

### Improved

- Home is a single house icon at the start of the tabs.
- Tabs keep the same width whether they're open or not.
- Mac: the tab strip is glass over the page, with thin scroll bars that show only while scrolling.
- Mac: Settings is redesigned, with Folevi's own icons, each pane as tall as it needs and the version shown once.
- Mac: Vault passwords show the list and the open item side by side on wide windows.
- Tooltips are Folevi's own everywhere and never repeat what a button already says.
- Mac: Focus Mode is now Option-Command-\ (Shift-Command-\ shows all tabs).

## Version 1.1.04: Small update

Released 2026-10-29 06:18:23+06:00 (build 14, tag mac-v1.1.04, commit f6fd7767)

Mac tab strip and note card polish.

### Improved

- Mac tab strip: Home is pinned after Back and Forward, and only the tabs after it scroll
- Mac tab strip: New note sits as far from the right edge as the Back arrow from the left

### Fixed

- Note cards: the shadow animates with the card, so no pale band shows under a card as the hover ends

## Version 1.1.03: Small update

Released 2026-10-28 23:24:46+06:00 (build 13, tag mac-v1.1.03, commit e60b655f)

The Mac tab strip matches the web's, and the Vault unlocks encryption in place.

### Improved

- Mac tab strip matches the web's: only the tabs scroll, New note 4 pt from the edge
- The Vault unlocks encryption in place: one card, the ways to unlock, then the passcode (web and Mac)

## Version 1.1.02: Small update

Released 2026-10-28 20:40:07+06:00 (build 12, tag mac-v1.1.02, commit 0ebfebf8)

The Mac window and account button follow the web, and the note card star moves to the cover's corner.

### Improved

- Mac: the window follows the place's Settings > Appearance, as its page does
- Note cards: the star's tab sits in the cover's corner, as on the web
- Mac: the account button shows the profile picture or the workspace's logo, as on the web

## Version 1.1.01: Small update

Released 2026-10-28 14:07:22+06:00 (build 11, tag mac-v1.1.01, commit c12e62f4)

Mac tabs open, close and reorder as on the web.

### Improved

- Mac tabs: the whole tab opens it, a middle-click closes it, and tabs drag to reorder, as on the web

## Version 1.1.00: Big update

Released 2026-10-28 13:11:47+06:00 (build 10, tag mac-v1.1.00, commit fd5390b7)

Folevi for Mac rebuilt as a native app that matches the web.

### Added

- Folevi for Mac rebuilt as a native app that matches the web: the window frame, sidebar, top bar, tabs and menus drawn natively from the web's styles
- Native Home, note lists, folders, Tasks, Calendar, Search, Notifications, Settings, sharing, invitations and Quick Add on the Mac
- Every screen before the app (first launch, library setup, sign-in, offline, the Touch ID cover) native on the Mac
- Notes dragged from the Mac's lists to Finder go as Markdown files
- Decline a workspace or page invitation

### Improved

- Foli AI chat streams within its frame budget
- Editor text size applies on every page
- iPhone: 120 Hz on ProMotion iPhones and Folevi's own web view host instead of Capacitor

## Version 1.0.05: Small update

Released 2026-10-27 08:39:35+06:00 (build 9, commit 65af5aed)

The Vault, folder sharing on the web, and security hardening.

### Added

- The Vault: passwords and credentials, Files & Notes, people and roles, sharing items and one-time secret links, Health, notifications, item history, import and export
- Folder sharing on the web: Share in the folder menu and toolbar, shared folder and invitation pages, Shared with Me

### Improved

- A folder page shows its subfolders as folder cards
- The Ask Foli AI flower blooms now and then and while Foli AI works
- Security: patched libraries, Foli AI can't be steered into sending data out, a daily encrypted backup, sessions end after a password reset
- iPhone: sheets reach the screen's bottom edge, and a themed note's cover band has rounded corners

## Version 1.0.04: Small update

Released 2026-10-24 10:53:13+06:00 (build 8, commit f5f00a26)

Every note kept on the device.

### Added

- Every note kept on the device: background fill, instant opening, prefetch on intent, attachments, encrypted copies sealed at rest

### Improved

- A faster device copy feed from the server

## Version 1.0.03: Small update

Released 2026-10-24 10:15:13+06:00 (build 7, commit 5b64098b)

Foli AI for long notes, offline notes everywhere, and faster iPhone and iPad apps.

### Added

- Foli AI handles long notes: an outline, paged reading, batched edits and Continue

### Improved

- Foli AI's Ask chat fills the note's panel, with the composer at the bottom
- Notes written offline show at once everywhere and reach the server after reconnecting
- iPhone and iPad: faster taps and typing, a note zooms out of its card and back, sheets slide in from below, a sync status for touch
- The apps open the last-known folio at once, and their first screen loads 14 % less code

### Fixed

- Big pastes save reliably
- folevi.com opens your notes even without the signed-in hint cookie

## Version 1.0.02: Small update

Released 2026-10-23 13:26:12+06:00 (build 6, commit 5b7fc87d)

Faster sign-in with Google or Apple in the apps.

### Improved

- Sign-in in the apps: Continue with Google or Apple goes straight to that provider's page

## Version 1.0.01: Small update

Released 2026-10-23 10:53:55+06:00 (build 5, commit f94212bd)

Folevi for Mac is native only, uses less memory, and folders drag and drop.

### Added

- Sidebar folders: drag and drop for notes and folders (web, Mac, iPad)

### Improved

- Folevi for Mac is the native app only, downloaded from folevi.com and updated by Sparkle
- Mac memory: background places, Quick Add and hidden windows let go of what they don't need, and memory warnings are answered
- The account menu: places first, the rest in Settings
- First launch: Sign in to Folevi is the suggested choice

### Fixed

- Flowchart connectors: Reverse direction turns the arrow, and lines between close shapes stay straight

## Version 1.0.00: Major release

Released 2026-10-23 06:50:15+06:00 (build 4, tag mac-v1.0.00, commit 3832da01)

One version for every platform, and the first native Folevi for Mac.

### Added

- One version for every platform: the web, Folevi for Mac, iPhone and iPad and Android all show Folevi 1.0.00, never a build number
- The first native Folevi for Mac release
