# Android platform research for a native Kotlin + Compose notes app (as of 2026-11-23)

Research date: 2026-11-23. Primary sources were fetched and read where linked (developer.android.com release notes, Android Developers blog, Play Console Help, blog.google, kotlinlang.org). Secondary sources (press, Wikipedia, third-party trackers) are labelled as such. Anything not confirmed against a primary source is marked **unverified**.

Quick version table (all verified on the AndroidX releases index, last updated 2026-11-18: https://developer.android.com/jetpack/androidx/versions)

| Item | Stable | Pre-release |
|---|---|---|
| Android platform | Android 17, API 37 (2026-06-16); QPR1 = API 37.1 | Android 17 QPR2 Beta 7.1 (API 37.2) |
| Compose BOM | 2026.11.01 (Compose 1.13.0) | Compose 1.14.0-alpha01 |
| Compose Material 3 | 1.5.0 (2026-11-18) | 1.6.0-alpha01 |
| Material 3 Adaptive | 1.3.0 (2026-08-12) | 1.4.0-alpha03 (2026-10-07) |
| Navigation 3 | 1.2.2 (2026-11-18) | 1.3.0-alpha05 |
| WindowManager | 1.5.1 | 1.6.0-alpha05 (2026-06-17) |
| androidx.webkit | 1.18.0 (2026-10-21) | 1.19.0-alpha02 (2026-11-18) |
| androidx.web (Compose web) | none | 1.0.0-alpha01 (2026-11-04) |
| Room 2.x / Room 3 | 2.8.5 / 3.0.3 | room3 3.1.0-alpha04 |
| DataStore | 1.3.0 (2026-10-21) | none |
| Glance | 1.2.0 (2026-08-26) | 1.3.0-alpha02 |
| Credentials | 1.6.0 (2026-04-08) | 1.7.0-alpha03 (2026-07-29) |
| Browser (Custom Tabs, Auth Tab) | 1.10.0 (2026-03-25) | none |
| Ink (stylus) | 1.0.0 | 1.1.0-alpha12 |
| AppFunctions | 1.0.0 (2026-11-18 index) | none |
| kotlinx.serialization | 1.13.0 (2026-11-11, Kotlin 2.4.10) | none |

---

## 1. Current Android version, API levels, and what matters for a notes app

### Facts
- **Android 17 (API level 37) is the current stable release**, released 2026-06-16 to most supported Pixels, with AOSP source drop the same day. Source: "Android 17 is Here", Android Developers Blog, 2026-06-16, https://developer.android.com/blog/posts/android-17-is-here
- Android 17 reached platform stability (API surface locked) with Beta 3 on 2026-03-26. Source: https://developer.android.com/blog/posts/the-third-beta-of-android-17 (title and date seen in the blog index on the Android 17 post).
- **Android 17 QPR2 is in beta**: "Beta 7.1 of QPR2 is now available", minor SDK **API 37.2**; the page was last updated 2026-10-16. QPR1 is API 37.1. Source: https://developer.android.com/about/versions/17/qpr2 . Final QPR2 release "expected December 2026" comes only from press (**unverified**): https://www.androidauthority.com/android-17-qpr2-beta-5-3712182/
- **Compose BOM 2026.11.01 requires `compileSdk 37.1` and Kotlin 2.2+.** Source: Compose November '26 release post, 2026-11-18, https://developer.android.com/blog/posts/jetpack-compose-november-2026-release
- Compose `compileSdk` 37 means a minimum **AGP 9.2.0**. Source: WindowManager 1.6.0-alpha03 notes, https://developer.android.com/jetpack/androidx/releases/window
- **Android 18**: no developer beta found as of late October 2026. Google replaced Developer Previews with year-round Canary builds (Android 17 Beta 1 was 2026-02-13). Android 18 was referenced at Android Dev Summit 2026 for "powerful new graphics features". Projections of Beta 1 around Feb 2027 and stable around June 2027 are press estimates (**unverified**). Sources: https://9to5google.com/2026/09/25/android-dev-summit-android-18/ , https://www.heise.de/en/news/Android-18-Developers-get-first-insights-at-the-end-of-October-11467704.html , https://en.wikipedia.org/wiki/Android_17
- The Android Dev Summit keynote (2026-10-28) did not announce an Android 18 beta. Source: https://developer.android.com/blog/posts/build-it-your-way-a-next-era-of-android-development

**Android 17 changes relevant to a notes app** (all from the 2026-06-16 Android 17 post unless noted):
- **No orientation/resizability opt-out on large screens (sw >= 600dp) for apps targeting API 37.** The system ignores `screenOrientation`, `setRequestedOrientation()`, `resizeableActivity=false`, `minAspectRatio`, `maxAspectRatio`. Games (by Play category) are exempt. Phones (< sw600dp) are not affected.
- **Activity recreation changes**: by default the system no longer recreates activities for `CONFIG_KEYBOARD`, `CONFIG_KEYBOARD_HIDDEN`, `CONFIG_NAVIGATION`, `CONFIG_TOUCHSCREEN`, `CONFIG_COLOR_MODE`; apps get `onConfigurationChanged()`. Opt back in with the `android:recreateOnConfigChanges` manifest attribute. (Relevant when a keyboard is attached/detached on tablets and Googlebooks.)
- **App Bubbles** (any app can become a floating bubble from the launcher), **Bubble Bar** on large screens, and **interactive desktop PiP**. Apps must work at very small window sizes.
- **Continue On** (cross-device handoff): `setHandoffEnabled(true, null)` and override `onHandoffActivityDataRequested(...)` returning `HandoffActivityData`; supports app-to-web fallback.
- **AppFunctions** (on-device tool calling, "Android MCP"); the blog's own example is a note app's `createNote` function. Jetpack `appfunctions` is now **1.0.0 stable** per the AndroidX index (2026-11-18); ADS (2026-10-28) described it as beta at that time.
- **Memory limits** enforced by device RAM; killed apps report `"MemoryLimiter:AnonSwap"` in `ApplicationExitInfo.getDescription()`.
- **Lock-free `MessageQueue`** for apps targeting 37 (breaks reflection on private MessageQueue fields).
- **`static final` fields can no longer be modified** via reflection for apps targeting 37.
- **Local network access** blocked by default for apps targeting 37; needs `ACCESS_LOCAL_NETWORK` (in the `NEARBY_DEVICES` group). WebView traffic inherits the host app's permission (Android 16 behavior page).
- **Certificate Transparency on by default**.
- **Safer native code loading**: files loaded with `System.load` must be read-only (targeting 37).
- **Background audio hardening**; NPU access requires declaring `FEATURE_NEURAL_PROCESSING_UNIT`.
- **System contact picker** `ACTION_PICK_CONTACTS`, **EyeDropper** `ACTION_OPEN_EYE_DROPPER` (useful for a color picker in a notes editor), photo picker customization.
- Physical-keyboard password entry no longer echoes the last character by default.
- **"Android is Compose-first"**: all new APIs, libraries and guidance are Compose-only; View widgets and View-based Jetpack libraries (Fragments, RecyclerView, ViewPager) are in maintenance mode.

**Android 16 (API 36) changes that already apply because Play requires targeting 36** (source: https://developer.android.com/about/versions/16/behavior-changes-16):
- **Edge-to-edge is mandatory**: `R.attr#windowOptOutEdgeToEdgeEnforcement` is deprecated and disabled for apps targeting 36 on Android 16 devices.
- **Predictive back**: system animations (back-to-home, cross-task, cross-activity) are on by default; `onBackPressed` is not called and `KEYCODE_BACK` is not dispatched. Temporary opt-out: `android:enableOnBackInvokedCallback="false"`.
- **Orientation/resizability ignored on sw600dp+** with a temporary opt-out `android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY`, which the page states "won't apply when targeting API level 37".
- `elegantTextHeight` deprecated/ignored; fixed-rate scheduling change; opt-in Safer Intents (`android:intentMatchingFlags`).

**16 KB page size**: see section 5.

### Implications for a native notes app
- Build against `compileSdk 37.1`, AGP 9.2+, Kotlin 2.2+ (Kotlin 2.4.x is current for kotlinx.serialization); target API 36 now, plan for 37 well before the next Play deadline.
- Design adaptive from day one: phones, foldables, tablets, Googlebook windows, bubbles and PiP. Never lock orientation; it is ignored anyway on large screens once you target 37.
- Edge-to-edge and predictive back are table stakes. Use `enableEdgeToEdge()` and the Compose insets APIs, and Navigation 3 / `NavigationBackHandler` for back.
- Handle keyboard attach/detach without recreation (Android 17 default) and keep editor state in a retained holder.
- Consider AppFunctions (create/search note) and Continue On (resume the open note on a tablet/Googlebook) as differentiators.

---

## 2. Design system: Material 3 and Material 3 Expressive

### Facts
- **Compose Material 3 1.5.0 is stable (2026-11-18)** and "graduated almost every new expressive component to stable"; experimental annotations cut 52% (120 to 58). Compose Material 2 is deprecated and no longer actively maintained. Source: https://developer.android.com/blog/posts/jetpack-compose-november-2026-release
- Release channels: 1.5.0 stable (2026-11-18), 1.5.0-rc01 (2026-11-04), 1.6.0-alpha01 (2026-11-18). Source: https://developer.android.com/jetpack/androidx/releases/compose-material3
- **Expressive components in 1.5.0 (stable unless noted)**, quoted from the 1.5.0 "Important changes since 1.4.0" section of the same release-notes page:
  - Buttons: `ToggleButton`, `ElevatedToggleButton`, `FilledTonalToggleButton`, `OutlinedToggleButton` (shape morphing, `ButtonSize`), `SplitButton` (replaces `SplitButtonLayout`), `ButtonGroup` (with `Modifier.animateWidth(compressionLimit = ...)` and overflow).
  - Toolbars: `FloatingToolbar`, `HorizontalFloatingToolbar` with built-in overflow. `FlexibleBottomAppBar` graduated in 1.5.0-alpha23 (per the release-note history).
  - Text fields: expressive `TextFieldDefaults.roundedShape`, `tonalColors()`, `TextFieldLabelPosition.Inside` / `Cutout`.
  - Chips with shape-morphing selection; expressive menus `SelectableDropdownMenuItem`, `CheckableDropdownMenuItem`, cascading submenus via `DropdownMenuPopupPositionProvider`.
  - `WavyLinearProgressIndicator`, `WavyCircularProgressIndicator`; `VibrantTimePickerDialog`, `ScrollField`.
  - Expressive and segmented `ListItem`; search variants `ExpandedDockedSearchBarWithGap`, `ExpandedFullScreenContainedSearchBar`.
  - Standalone `Scrim`; new `material3-ripple` artifact with inset focus rings.
  - Motion: `LocalMotionScheme` deprecated in favor of **`MaterialTheme.motionScheme`**; sheets respect `motionScheme` during drag.
  - Theming: release notes say Expressive theming graduated, printed as "`MaterialTheme.expressiveLightColorScheme`, `MaterialTheme.materialExpressTheme`". The exact public symbol names (for example whether it is `MaterialExpressiveTheme`) are **unverified**; check the API reference before coding.
- **Still experimental in 1.5.0**: `LoadingIndicator`, `ContainedLoadingIndicator`, `LoadingIndicatorDefaults`, `PullToRefreshDefaults.LoadingIndicator`; `MaterialShapes` and `toShape` / `toPath`; `AppBarWithSearch`, `AppBarWithSearchColors`; `Modifier.carouselParallaxScrollEffect`; standalone static `BottomSheet`/`Sheet`. Same source.
- Compose foundation 1.13 adds `PolygonShape` and `MorphPolygonShape` (shape morphing without `graphics-shapes`), **progressive blur** (`Modifier.blur { blurRadiusSpec = BlurRadiusSpec.linearGradient(...) }`), dialog/popup blur properties. Source: Compose Nov '26 post.
- The **Styles API remains experimental** in Compose 1.13 (docs and skill temporarily removed). Same source.
- `FlexBox` and `Grid` layouts are **stable** in 1.13; FlexBox supersedes `FlowRow`/`FlowColumn`. ConstraintLayout/MotionLayout for Compose are **deprecated**. Same source.
- Value-based `BasicTextField` and M2 `TextField` are deprecated; migrate to state-based `TextFieldState`. Undo/redo (`UndoState`) and `TextFieldBuffer.ChangeList` are no longer experimental. `VisualTransformation` deprecated in favor of `InputTransformation` / `OutputTransformation`. Same source.
- **Dynamic color**: `dynamicLightColorScheme` / `dynamicDarkColorScheme` (Android 12, API 31+) remain the Compose M3 dynamic color API. Not re-verified for 2026 changes (**unverified for any 2026 change**). Reference: https://developer.android.com/develop/ui/compose/designsystems/material3

### Implications for a native notes app
- Use Material 3 1.5.0 via BOM 2026.11.01. The Expressive set you need for a notes app (floating formatting toolbar, button groups, split "new note" button, toggle buttons for bold/italic, expressive list items, search bars) is stable.
- Avoid shipping production UI on the still-experimental pieces (`LoadingIndicator`, `MaterialShapes`, `AppBarWithSearch`) or isolate them behind your own wrappers.
- If the brand look must match the existing Folevi web/Apple apps more than stock Material, build a thin custom design layer over M3 tokens; do not depend on the experimental Styles API yet.
- Plain Compose text fields are not a rich-text editor; for a block editor you either build on `BasicTextField` + `TextFieldState` (with undo) or embed the web editor (section 6).

---

## 3. Compose adaptive layouts, navigation, input and windowing

### Facts
- **Compose 1.13 / BOM 2026.11.01 stable (2026-11-18).** Source: https://developer.android.com/blog/posts/jetpack-compose-november-2026-release
- **Window size classes now have five width classes**: Compact < 600dp, Medium 600 to 840dp, Expanded 840 to 1200dp, **Large 1200 to 1600dp ("Large tablet displays")**, **Extra-large >= 1600dp ("Desktop displays")**. Height: Compact < 480, Medium 480 to 900, Expanded >= 900. Get it with `currentWindowAdaptiveInfo(supportLargeAndXLargeWidth = true).windowSizeClass`; test with `isWidthAtLeastBreakpoint(...)` / `isHeightAtLeastBreakpoint(WindowSizeClass.HEIGHT_DP_MEDIUM_LOWER_BOUND)`. Source: https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes
- Large/XLarge breakpoints were added in **androidx.window 1.5.0** (2025-09-24); latest window stable 1.5.1, alpha 1.6.0-alpha05 (2026-06-17) adds `WindowEngagementInfo` / `EngagementMode.PRECISE_POINTER` (detect mouse/trackpad engagement) via `WindowInfoTracker.windowEngagementInfo()`. Postures: `WindowInfoTracker#supportedPostures`, `FoldingFeature`. Source: https://developer.android.com/jetpack/androidx/releases/window
- **Material 3 Adaptive 1.3.0 stable (2026-08-12)**: ships `adaptive-navigation3` with `ListDetailSceneStrategy` / `rememberListDetailSceneStrategy` and `SupportingPaneSceneStrategy` / `rememberSupportingPaneSceneStrategy`; `ListDetailPaneScaffold` and `SupportingPaneScaffold` support margins and edge-to-edge; RTL pane expansion anchors. 1.2.0 added **reflow** and **levitate** adapt strategies (pane as floating popup with scrim, drag-to-resize), and made `currentWindowAdaptiveInfo()` support large/extra-large. 1.4.0-alpha01 adds shapes in `AnimatedPane`. Source: https://developer.android.com/jetpack/androidx/releases/compose-material3-adaptive
- **`NavigationSuiteScaffold`** (artifact `material3-adaptive-navigation-suite`, versioned with Material 3) switches bottom bar on phones to navigation rail on large screens. Source: Android 17 post and https://developer.android.com/jetpack/androidx/releases/compose-material3
- **Navigation 3 is stable: 1.2.2 (2026-11-18)**; 1.2.0 stable 2026-09-23; alpha 1.3.0-alpha05. 1.2 added a **Result API** (`ResultEventBus`), **KMP deep links** (`DeepLinkRequest`, `DeepLinkUri`, `DeepLinkMatcher`, `UriDeepLinkMatcher`, `BackStackMatcher`), **predictive back helpers** (`NavigationBackHandler`, `rememberNavigationEventState`). 1.1 added shared elements between scenes, `SceneDecoratorStrategy`, `OverlayScene.onRemoved`. 1.3.0-alpha adds `SceneInfo.title`/`url` from entry metadata (`TitleMetadataKey`, `UrlMetadataKey`). Sources: https://developer.android.com/jetpack/androidx/releases/navigation3 and ADS post "Navigation 3 1.2 is stable with deep links support and richer Predictive back handling", 2026-10-28, https://developer.android.com/blog/posts/build-it-your-way-a-next-era-of-android-development
- Google's Googlebook guidance recommends Navigation 3 `ListDetailSceneStrategy` / `SupportingPaneSceneStrategy` for side-by-side panes and **scene decorators** for persistent desktop navigation rails, plus `Grid`, `FlexBox`, experimental `mediaQuery`. Source: https://developer.android.com/develop/adaptive-apps/guides/googlebook/overview
- **Input on large screens / desktop** (Googlebook guidance): contextual cursors (https://developer.android.com/guide/topics/large-screens/cursors), right-click context menus and hover states, discoverable shortcuts via the **Keyboard Shortcuts Helper** (https://developer.android.com/develop/ui/compose/touch-input/keyboard-input/keyboard-shortcuts-helper), keyboard actions (https://developer.android.com/develop/ui/compose/touch-input/keyboard-input/commands). Compose 1.11 added trackpad APIs and test helpers (`TrackpadInjectionScope`, `performTrackpadInput`). Sources: Googlebook overview page; Android 17 post.
- **Multi-instance and cross-window drag and drop** are recommended for Googlebook (multiple windows of the same app; drop text/images/files between windows). Compose drag and drop guide: https://developer.android.com/develop/ui/compose/touch-input/user-interactions/drag-and-drop . Source: Googlebook overview.
- **Desktop windowing / connected displays** guides: https://developer.android.com/develop/adaptive-apps/guides/support-desktop-windowing , https://developer.android.com/develop/adaptive-apps/guides/support-multi-window-mode , https://developer.android.com/develop/adaptive-apps/guides/support-connected-displays . Customizable header bars inside the desktop caption bar are supported. Source: Googlebook overview.
- **Stylus**: `androidx.ink` is **1.0.0 stable** (low-latency ink, per AndroidX index 2026-11-18). https://developer.android.com/jetpack/androidx/releases/ink
- Compose 1.13 also stabilizes `LazyLayoutCacheWindow`, adds `CapturedAnimatedVisibility` (good for detail panes whose selected item goes null), `computedStateOf`. Source: Compose Nov '26 post.
- New **AppState** library (alpha) for Compose-first state preservation across configurations; `appstate.statestore` 1.0.0-alpha03. Sources: ADS post; AndroidX index.

### Implications for a native notes app
- Architecture: Navigation 3 back stack + `ListDetailSceneStrategy` (folder/note list | note) + optional `SupportingPaneSceneStrategy` (outline, backlinks, AI panel), wrapped by `NavigationSuiteScaffold` or a scene decorator rail. This is exactly Google's recommended Googlebook/tablet pattern.
- Use five width classes: Compact = single pane; Medium/Expanded = list + note; Large/XLarge = sidebar + list + note (three columns, matching the iPad/Mac Folevi layout).
- Ship full keyboard shortcuts (new note, search, bold/italic, navigate list), right-click menus, hover states and text cursors; register them with the Keyboard Shortcuts Helper.
- Support multi-instance (open a note in a new window) and drag and drop of text/images/files in and out of notes.
- For handwriting/sketch blocks consider `androidx.ink` 1.0.

---

## 4. "Google Book": what it most likely means (Googlebook)

### Facts
- "Google Book" almost certainly refers to **Googlebook**, Google's new laptop category built on the Android stack, successor positioning to Chromebook.
- **Announced 2026-05-12** by Alex Kuscher (Senior Director, Laptops & Tablets) on The Keyword: "a new category of laptops designed for Gemini Intelligence", drawing on "the best of Android", including Google Play apps, and on ChromeOS (Chrome browser); OEMs **Acer, ASUS, Dell, HP, Lenovo**; devices "this fall"; features Magic Pointer, Create your Widget, phone app access and Quick Access to phone files. Source: https://blog.google/products-and-platforms/platforms/android/meet-googlebook/
- Google's developer docs: "Googlebooks are built on the Android technology stack and ChromeOS desktop foundations", with touchscreens, keyboards, precision trackpads, Gemini integration; apps run in **free-form resizable windows**, multi-instance, cross-window drag and drop; Play shows **"Optimized for desktop"** badges and dedicated collections; setup transfer from an Android phone highlights optimized apps; on-device **Linux terminal** (pKVM) and Antigravity dev tools; **desktop emulator** in Android Studio preview/Canary; connected phone features **Cast My Apps** and Files cross-device access. Source: https://developer.android.com/develop/adaptive-apps/guides/googlebook/overview
- Developer blog "Land your apps on Googlebook with adaptive development", 2026-09-22: OEMs HP, Dell, Lenovo, Acer, Asus; OLED touchscreens; Navigation 3 scenes, Grid/FlexBox; Keyboard Shortcuts Helper; **Apps Experience Program (AEP)** rate card for optimized apps. Source: https://android-developers.googleblog.com/2026/09/adaptive-development-scale-app-googlebook.html
- **Shipped**: preorders and hands-on 2026-09-21; US release **2026-10-04**, then AU, CA, FR, DE, IE, UK on 2026-10-05 (first model listed: Lenovo Googlebook 15). Source: Wikipedia (secondary, citing blog.google "Googlebook's built-in intelligence reinvents the way you use your laptop"): https://en.wikipedia.org/wiki/Googlebook . Exact dates **unverified** against Google directly.
- **OS name**: Google said "Aluminium OS" was only a development codename; the shipping OS is reported as **"Googlebook OS"** (from a Lenovo leak reported by ChromeUnboxed, 2026-09-11). Source: Wikipedia Googlebook article citing https://chromeunboxed.com/lenovo-googlebook-leak-reveals-the-name-of-googles-new-laptop-operating-system/ (**secondary**).
- **Existing Chromebooks**: ChromeOS keeps updates and security patches through mid-2034; "many" newer commercial Chromebooks with 10-year support past 2034 will be eligible to migrate to Googlebook OS; Googlebook fleet management in H2 2027. Source: 9to5Google, 2026-09-28, https://9to5google.com/2026/09/28/google-details-chromebook-updates-through-2034-many-models-move-to-googlebook-os/ , citing Google support page https://support.google.com/chrome/a/answer/16634428?hl=en
- **How Android apps run**: On Googlebook OS, Play apps run as **native Android apps** rather than in ARCVM as on today's Chromebooks (**secondary**, Notebookcheck / StarryHope; **unverified** against Google docs): https://www.notebookcheck.net/Google-s-new-laptop-OS-is-Android-ChromeOS-and-Linux-mashed-into-one.1404958.0.html . Today's ChromeOS runs Android apps via ARCVM (Chromebook Help: https://support.google.com/chromebook/answer/7021273).
- **Intel Googlebooks** run ARM app code through a translation layer; Google told Android Authority that most apps run smoothly but "a small number of complex apps or games" need "developer tuning". Source: XDA, 2026-10-05, https://www.xda-developers.com/google-warns-some-android-apps-wont-run-well-on-intel-googlebooks-at-launch/ (secondary).
- Android 17 post calls Googlebooks "the next generation of ChromeOS built on the Android stack". Source: https://developer.android.com/blog/posts/android-17-is-here
- ADS 2026-10-28: "With the arrival of Googlebook, your apps can now scale seamlessly across phones and laptops without requiring a separate codebase"; the Compose adaptive skill now audits for keyboard shortcuts, pointer cursors, hover, tooltips; "Next year Google Play will be looking closely at how your app or game runs on a foldable... We'll announce details on what is required for the Google Play store later this year." Source: https://developer.android.com/blog/posts/build-it-your-way-a-next-era-of-android-development
- A claim that AEP lists Googlebook as a required form factor by 2027-03-01 appears only in secondary coverage (**unverified**).
- No separate "Googlebook SDK" or manifest flag was found; targeting is the normal Android APK/AAB plus adaptive quality. Desktop quality checklist: https://developer.android.com/develop/adaptive-apps/quality-guidelines/adaptive-app-quality/experiences/desktop

### Announced vs rumored
- Announced and shipped: Googlebook category, OEMs, fall 2026 availability, developer guidance, Play badging.
- Reported (secondary): exact launch dates, "Googlebook OS" name, native (non-ARCVM) Android runtime, Intel translation layer details, AEP 2027 deadline.

### Implications for a native notes app
- One Android app covers phones, tablets, foldables and Googlebooks. Treat Googlebook as a desktop: resizable windows from tiny to 1600dp+, keyboard and trackpad first, multiple windows, drag and drop.
- Test on the Android Studio **Desktop** emulator and at Extra-large width.
- If you ship any native code (for example `BundledSQLiteDriver`), include `x86_64` and `arm64-v8a` so Intel Googlebooks do not rely on translation.
- Aim for Tier 2 (Adaptive optimized) at launch and Tier 1 for the Play large-screen badge and "Optimized for desktop" placement.

---

## 5. Google Play requirements

### Facts
- **Target API**: new apps and app updates must target **Android 16 (API 36)** since **2026-08-31** (extension available to 2026-11-01, now passed). Existing apps must target **API 35+** to stay available to new users on newer Android versions. Wear OS and Automotive API 35, Android XR API 34. The page does **not** mention API 37 or a 2027 date. Source: https://support.google.com/googleplay/android-developer/answer/11926878?hl=en
- **Next deadline (API 37 by 2027-08-31)**: follows Google's yearly pattern but is **unverified** (only third-party sources).
- **Large-screen orientation/resizability**: this is a **platform** behavior (Android 16 with temporary opt-out; Android 17/API 37 with no opt-out on sw600dp+), not a separate Play policy line. Sources: Android 16 behavior changes and Android 17 post (section 1). Google said Play will announce foldable/adaptive requirements "later this year" (ADS 2026-10-28); none found yet (**unverified** whether published).
- **Adaptive app quality guidelines** (replace the "large screen app quality guidelines", archived 2026-01-21; Tier 2 revision archived 2026-04-07): **Tier 3 Adaptive ready** (baseline: full screen/full window, not letterboxed, basic keyboard/mouse/trackpad/stylus), **Tier 2 Adaptive optimized** (layouts for all sizes, enhanced input), **Tier 1 Adaptive differentiated** (multitasking, postures, drag and drop, stylus). Complete Tier 2 (or Tier 1) to apply for the **Google Play Large Screen Badge**. Recommended test devices include **Googlebook (160 ppi)**, foldables 802x802dp and 1024x768dp, 8" and 10.5" tablets, 13" Chromebook 1600x900dp; emulators include Desktop (Preview). Source: https://developer.android.com/docs/quality-guidelines/adaptive-app-quality
- **16 KB page size**: all apps targeting Android 15+ must support 16 KB pages on 64-bit devices; **from 2027-02-01, app updates that don't support 16 KB can't be released**. Pure Kotlin/Java apps are already compatible; native code needs AGP 8.5.1+ and NDK r28+ (or linker flags). `android:pageSizeCompat` manifest property controls backcompat mode. Source: https://developer.android.com/guide/practices/page-sizes
- **New personal developer accounts** (created after 2023-11-13) must run a **closed test with at least 12 testers opted in continuously for 14 days** before applying for production; internal testing does not count; organization accounts are exempt. Source: https://support.google.com/googleplay/android-developer/answer/14151465?hl=en (no 2026 change found).
- **Data safety form**: required for every app on closed/open/production tracks, even apps collecting no data (must link a privacy policy). Declare collection (data leaving the device, including via SDKs and **WebViews your app controls**), sharing, purposes, encryption in transit, and a deletion mechanism. Source: https://support.google.com/googleplay/android-developer/answer/10787469?hl=en
- **Account deletion**: apps that allow account creation must offer an in-app deletion path and a web link resource declared in the Data safety "Data deletion" questions. Source: https://support.google.com/googleplay/android-developer/answer/13327111?hl=en
- **Android developer verification** is expanding in 2027 (live for participating stores in Brazil, Indonesia, Singapore, Thailand since 2026-09-30). Source: blog index entry "Expanding Android developer verification in 2027", 2026-11-19, https://developer.android.com/blog/posts/android-developer-verification-2027 (details not read; **unverified** scope for Play apps).
- Jetpack libraries send no user data and do not affect the Data safety form. Source: https://developer.android.com/jetpack/androidx/versions

### Implications for a native notes app
- Target 36 at launch; schedule the move to 37 (no large-screen opt-out) so it is not forced by the next deadline.
- If the account is a personal Play account, budget at least 14 days of closed testing with 12+ testers before the first production release.
- Data safety: notes content synced to Convex counts as collected user data (user content, account info, possibly diagnostics). Declare encryption in transit, provide in-app account deletion and a web deletion URL.
- Keep native libraries 16 KB aligned (current AGP/NDK handle it).

---

## 6. Embedding a web editor natively (WebView in 2026)

### Facts
- **Recommended bridge: `WebViewCompat.addWebMessageListener`** with an explicit `allowedOriginRules` set; the JS object (`window.<name>`) is injected from page start; the callback gets `sourceOrigin`, `isMainFrame` and a **`JavaScriptReplyProxy`** you can keep and use to push any number of messages; callbacks run on the **main thread** (offload JSON parsing); supports **`byte[]` / ArrayBuffer** (`WebMessageCompat.TYPE_ARRAY_BUFFER`, check `WebViewFeature.WEB_MESSAGE_ARRAY_BUFFER`); requires WebView 82+. Register it **before** navigating. `postWebMessage` is an alternative (main frame only); **`addJavascriptInterface` is legacy** (no origin checks, synchronous, available to all frames) and "not recommended". Large payloads: stream via `shouldInterceptRequest`. Always gate with `WebViewFeature.isFeatureSupported`. Source: https://developer.android.com/develop/ui/views/layout/webapps/native-api-access-jsbridge
- **`addDocumentStartJavaScript`** (inject scripts before any page script, origin-scoped) is documented as the way for native to initiate the bridge. Same source. It first appeared in webkit 1.9.0; 1.16.0-alpha03 added isolated-world support (`WebViewCompat#addJavaScriptOnEvent`). Source: https://developer.android.com/jetpack/androidx/releases/webkit
- **androidx.webkit 1.18.0 stable (2026-10-21)**, 1.19.0-alpha02 (2026-11-18). minSdk raised to **24** in 1.16.0. Same source.
- **Startup/warmup**: `WebViewCompat.startUpWebView(Context, WebViewStartUpConfig, WebViewOutcomeReceiver<...>)` graduated to stable in **1.16.0 (2026-05-06)**; `Profile#warmUpRendererProcess` (1.15.0-alpha01). **Prerender**: `WebViewCompat#prerenderUrlAsync` non-experimental since 1.15.0-alpha02. Same source.
- **Multi-profile**: `Profile` / `ProfileStore`, `WebViewCompat#setProfile` / `getProfile` (1.9.0+). Useful to separate accounts' cookies/storage. Same source.
- **Navigation callbacks**: `WebViewCompat#addNavigationListener` (`NavigationListener`, `Navigation`, `Page` stable in 1.16.0); `WebViewCompat#navigate` replaces `loadUrl` (1.17.0-alpha01); `NavigationState`/`PageState` snapshots (1.19.0-alpha01). Same source.
- **Local assets over https**: `WebViewAssetLoader` serving bundled assets from `https://appassets.androidplatform.net/...` (avoid `file://`). Guide: https://developer.android.com/develop/ui/views/layout/webapps/load-local-content (long-standing API; page not re-fetched in this session, **unverified for 2026 changes**). Using a real https origin lets you set `allowedOriginRules = setOf("https://appassets.androidplatform.net")`.
- **Compose wrapping**: `AndroidView` is the current way. New **`androidx.web:web:1.0.0-alpha01`** (2026-11-04) adds **`WebContent`**, a state holder that keeps scroll position, form inputs, history and JS state across configuration changes and navigation without leaking the Activity (`webContent.attach(context, ::WebContentView)` inside `AndroidView`, `detach()` in `onRelease`); a dedicated **`WebSurface`** composable that bypasses `AndroidView` interop is "available soon". Source: https://developer.android.com/blog/posts/jetpack-compose-november-2026-release and https://developer.android.com/jetpack/androidx/releases/web
- **IME insets**: with mandatory edge-to-edge, the host must handle `WindowInsets.ime` (for example `Modifier.imePadding()` or `windowInsetsPadding(WindowInsets.ime)`) around the `AndroidView`; standard Compose insets guidance: https://developer.android.com/develop/ui/compose/layouts/insets . WebView-specific IME behavior inside Compose was not verified in a 2026 source (**unverified**).
- Android 17 Data safety note: data sent by WebViews your app controls counts as collected (section 5).

### Implications for a native notes app
- If the shared TypeScript editor (from the web app) is embedded: bundle it as app assets, serve via `WebViewAssetLoader` on `https://appassets.androidplatform.net`, bridge with `addWebMessageListener` restricted to that origin, push native-initiated messages with the retained `JavaScriptReplyProxy`, and bootstrap with `addDocumentStartJavaScript`.
- Pre-warm with `startUpWebView` at app start and keep one WebView per window alive via `androidx.web` `WebContent` (alpha) or your own retained holder, so opening a note does not pay WebView cold start.
- Parse bridge JSON off the main thread; send attachments as `byte[]` or stream them through `shouldInterceptRequest`.
- Watch `WebSurface` (coming) as the long-term Compose-native host; for now `AndroidView` + `WebContent`.
- Native chrome (toolbars, Expressive floating toolbar, lists, navigation) stays Compose; only the editing surface is web.

---

## 7. Storage, sign-in, push, widgets, sharing, tiles, shortcuts, scanning

### Facts
**Storage**
- **Room 3.0** (`androidx.room3`, new Maven group) **stable 3.0.0 on 2026-07-01**, latest 3.0.3; 3.1.0-alpha04 (2026-11-18). Kotlin-only codegen, **KSP required**, coroutines-first (DAO functions suspend or reactive), **`SQLiteDriver` required** (no SupportSQLite unless `room3-sqlite-wrapper`), KMP incl. **JS and WasmJS**, **FTS5** via `@Fts5` (tokenizers incl. `TOKENIZER_TRIGRAM`), custom DAO return types, `@TypeConverter` renamed `@ColumnTypeConverter`, Flow-based `InvalidationTracker.createFlow()`. 3.1.0-alpha03 requires Kotlin 2.2 and adds `allowDataLossOnRecovery()`. Room 2.x is in maintenance mode. Source: https://developer.android.com/jetpack/androidx/releases/room3
- Room 2.x latest stable 2.8.5 (2026-09-09); KMP since 2.7.0; minSdk 23 since 2.8.0. Source: https://developer.android.com/jetpack/androidx/releases/room
- **DataStore 1.3.0 stable (2026-10-21)** adds KMP web storage (`WebSessionStorage`, `WebLocalStorage`, `WebOpfsStorage`). Source: https://developer.android.com/jetpack/androidx/releases/datastore
- `androidx.sqlite` 2.7.1 stable, 2.8.0-alpha04. Source: AndroidX index.

**Sign-in**
- **Credential Manager** `androidx.credentials` **1.6.0 stable (2026-04-08)**, 1.7.0-alpha03 (2026-07-29: multiple credentials in `GetCredentialResponse`). Features accumulated: passkeys incl. **conditional create** (`isConditional`), **Restore Credentials** (`RestoreCredential` for device migration), Signal API (credential state signals to providers), secondary autofill-like UI via `PendingGetCredentialRequest`, Digital Credentials; `credentials-play-services-auth` for API <= 33; minSdk 23. Sign in with Google uses `com.google.android.libraries.identity.googleid` with Credential Manager (googleid current version **unverified**). Source: https://developer.android.com/jetpack/androidx/releases/credentials
- **Auth Tab** (`AuthTabIntent`) for OAuth in a Custom Tab with a dedicated result contract: experimental in browser 1.9.0-alpha01, **non-experimental since 1.9.0-alpha03**, stable in **browser 1.9.0 (2025-07-30)**; `AuthTabIntent.AuthenticateUserResultContract` made public in 1.10.0; capability check API and ephemeral browsing (`CustomTabsSession#isEphemeralBrowsingSupported`) also landed. Latest **browser 1.10.0 (2026-03-25)**. Source: https://developer.android.com/jetpack/androidx/releases/browser

**Push**
- **FCM HTTP v1** is the only server API: legacy HTTP/XMPP APIs were deprecated 2023-06-20 and shutdown began **2024-07-22**; v1 uses short-lived OAuth2 tokens from a service account and the endpoint `https://fcm.googleapis.com/v1/projects/{project-id}/messages:send`. Source: https://firebase.google.com/docs/cloud-messaging/migrate-v1 (dates taken from a localized copy of this page via search; English page fetch returned 404 for one URL variant, so dates are **partly unverified**). Android 13+ requires the `POST_NOTIFICATIONS` runtime permission (long-standing, not re-verified).

**Widgets**
- **Glance 1.2.0 stable (2026-08-26)**: generated previews (`GlanceAppWidget.providePreview` + `GlanceAppWidgetManager.setWidgetPreview`, Android 15+), `MultiProcessGlanceAppWidget`, `previewSize` in `requestPinGlanceAppWidget`, minSdk 23; legacy Glance wear tiles deprecated. 1.3.0-alpha02 (2026-07-01) adds Remote Compose snap scrolling. New `glance.adaptive` 1.0.0-alpha05. `glance-material3` provides M3 theming interop. Source: https://developer.android.com/jetpack/androidx/releases/glance and AndroidX index.
- Googlebook guidance promotes **desktop widgets** alongside Gemini "Create My Widget". Source: Googlebook overview page.

**Sharing, tiles, shortcuts** (long-standing APIs; no 2026-specific change found, **not re-verified**)
- Receive shares with `ACTION_SEND` / `ACTION_SEND_MULTIPLE` intent filters; Direct Share via **Sharing Shortcuts** (`ShortcutManagerCompat.pushDynamicShortcut`, `androidx.sharetarget` 1.2.0, last released 2022-10-05 per AndroidX index). Guide: https://developer.android.com/training/sharing/receive
- App shortcuts (static, dynamic, pinned): https://developer.android.com/develop/ui/views/launch/shortcuts
- Quick Settings tile (`TileService`, `StatusBarManager.requestAddTileService` on API 33+): https://developer.android.com/develop/ui/views/quicksettings-tiles

**Document scanning**
- **ML Kit Document Scanner**: Google-provided UI flow, models and resources delivered via Google Play services, **no camera permission needed**, fully on-device, three modes (Base, Base with Filter, Full with ML cleanup), page limit and gallery import configurable. Source: https://developers.google.com/ml-kit/vision/doc-scanner . Artifact version, GA status and output formats were not shown on the page (**unverified**; historically `com.google.android.gms:play-services-mlkit-document-scanner` with JPEG and PDF output).
- ML Kit GenAI **Prompt API / Agentic API with Gemini Nano 4** in alpha (ADS 2026-10-28), relevant for on-device summarization. Source: ADS post.

### Implications for a native notes app
- Local store: **Room 3** (KSP, `BundledSQLiteDriver` or `AndroidSQLiteDriver`, FTS5 trigram for fast substring search) for notes, blocks, sync queue; **DataStore** for preferences. If a future KMP/web reuse is wanted, Room 3 already targets JS/Wasm.
- Sign-in: Credential Manager for passkeys + Sign in with Google + passwords; Auth Tab (fallback Custom Tab) for any OAuth provider; use `RestoreCredential` so users stay signed in after moving to a new phone.
- Push: FCM HTTP v1 from the backend (Convex action) with a service account secret stored server-side.
- Glance widgets (recent notes, quick capture) with generated previews; QS tile and launcher shortcut for "new note"; share target for text/links/images; ML Kit document scanner to create scan notes without camera permission.

---

## 8. Kotlin serialization of a large typed JSON protocol

### Facts
- **kotlinx.serialization 1.13.0** released 2026-11-11 (based on **Kotlin 2.4.10**): reverts the 1.12.0 exception-wrapping change, faster `JsonElement.toString`. **1.12.0** (2026-10-19): stabilizes `@KeepGeneratedSerializer`, `JsonNamingStrategy`, `ContextualSerializer`, `kotlin.uuid.Uuid` and `kotlin.time.Instant` serializers; JSON path context in `JsonDecodingException`. **1.11.0** (2026-04-09, Kotlin 2.3.20): public experimental `JsonException` API and `exceptionsWithDebugInfo` to hide user input in messages. Sources: https://github.com/Kotlin/kotlinx.serialization/releases ; Maven listing https://mvnrepository.com/artifact/org.jetbrains.kotlinx/kotlinx-serialization-json-jvm
- **Unknown polymorphic subtypes**: register a fallback with `defaultDeserializer { Unknown.serializer() }` inside `polymorphic(Base::class) { ... }` in a `SerializersModule` (also exposed as `polymorphicDefaultDeserializer`); without it, an unregistered subtype throws `SerializationException`. Source: https://kotlinlang.org/docs/serialization-polymorphism.html . Whether a **sealed** hierarchy accepts a default deserializer is not stated on the page (**unverified**); common practice is to model the protocol with an open/abstract base or a custom `JsonContentPolymorphicSerializer` (**unverified**, community guidance: https://slack-chats.kotlinlang.org/t/30210462/is-there-a-way-to-have-a-sort-of-unknown-sealed-class-child- ).
- **Unknown enum values**: `coerceInputValues = true` treats unknown enum values (and nulls for non-null types) as missing, so the property default is used (or null when no default, `explicitNulls = false` and nullable). Also `decodeEnumsCaseInsensitive`, `ignoreUnknownKeys`, experimental per-class `@JsonIgnoreUnknownKeys`, `classDiscriminator`, `classDiscriminatorMode` (`POLYMORPHIC`, `ALL_JSON_OBJECTS`, `NONE`), experimental `@JsonClassDiscriminator` (one discriminator per sealed base), `namingStrategy`. Source: https://kotlinlang.org/docs/serialization-json-configuration.html
- Alternatively, a custom `KSerializer` can map unknown strings to an `UNKNOWN` constant (community pattern, **unverified** as official guidance).
- **Codegen from TypeScript**: no mainstream, maintained TS to kotlinx.serialization generator was found. Options found: **Martok** (npm, converts TypeScript schemas to kotlinx.serialization classes; maintenance **unverified**): https://npmjs.com/package/martok . The reverse direction (Kotlin to TS) exists: https://github.com/adamko-dev/kotlinx-serialization-typescript-generator . A common alternative is emitting **JSON Schema** from TS (or Zod) and generating Kotlin with quicktype (**unverified** for 2026 quality; not checked in this session).

### Implications for a native notes app
- Use `Json { ignoreUnknownKeys = true; coerceInputValues = true; explicitNulls = false; classDiscriminator = "type" }` (match the TS protocol's discriminator key) so older app builds survive new server fields and enum values.
- For every union type in the protocol, register a `defaultDeserializer` fallback (or use `JsonContentPolymorphicSerializer`) so unknown block types render as a placeholder instead of crashing or dropping data. Preserve unknown payloads as `JsonObject` so they round-trip unchanged.
- Prefer a single source of truth: generate Kotlin from the TypeScript (or from a JSON Schema derived from it) in CI, and add golden-JSON contract tests shared with the web app. Expect to own a small generator script, since no off-the-shelf tool is clearly maintained.

---

## 9. Min SDK guidance for a new app in late 2026

### Facts
- **Cumulative device coverage** (StatCounter, October 2026 data, compiled by apilevels.com, updated 2026-11-03; third-party calculation, not an official Google figure): API 37: 4.0%, **36: 41.6%**, **35: 57.9%**, 34: 69.4%, 33: 80.3%, 31/32: 87.4%, 30: 93.5%, **29: 96.6%**, **28: 98.2%**, 27: 99.0%, **26: 99.2%**, 24: 99.5%, 23: 99.7%. Source: https://apilevels.com/
- **AndroidX default minSdk is 24** for new library releases ("updated at a yearly cadence", meant to cover 99% of users). Source: https://developer.android.com/jetpack/androidx/versions . apilevels.com dates the move to 24 at July 2026 (23 since Aug 2025, 21 since Apr 2024).
- **Jetpack Compose requires minSdk 23 since Compose 1.10.** Source: https://apilevels.com/ (secondary); consistent with Compose foundation notes moving default minSdk 21 to 23.
- Library floors seen this session: androidx.webkit 1.16+ minSdk 24; Room 2.8 minSdk 23; Glance 1.2 and Credentials 1.6 minSdk 23. Sources: release notes linked above.
- Android Studio's New Project wizard shows Play check-in distribution (official, not fetched here).

### Implications for a native notes app
- Practical floor: **minSdk 24** (AndroidX default, about 99.5%). Recommended: **minSdk 26** (about 99.2%; adaptive icons, notification channels, `java.time` without desugaring, fewer code paths) unless there is a reason to reach the last ~0.3%.
- A more aggressive **minSdk 29** (about 96.6%) simplifies scoped storage, gesture navigation insets and dark theme handling, at the cost of about 3% of devices. For a premium notes app that ships Googlebook/tablet polish, 26 or 28 is a reasonable balance.
- Gate newer features at runtime: dynamic color (31+), photo picker backport, predictive back (33+ behavior, 36 default), generated widget previews (35+), Continue On / EyeDropper / contact picker (37).

---

## Sources consulted (primary unless noted)
- Android 17 is Here (2026-06-16): https://developer.android.com/blog/posts/android-17-is-here
- Android 17 QPR2 page (updated 2026-10-16): https://developer.android.com/about/versions/17/qpr2
- Android 16 behavior changes (targeting 36): https://developer.android.com/about/versions/16/behavior-changes-16
- Compose November '26 release (2026-11-18): https://developer.android.com/blog/posts/jetpack-compose-november-2026-release
- Android Dev Summit keynote post (2026-10-28): https://developer.android.com/blog/posts/build-it-your-way-a-next-era-of-android-development
- AndroidX releases index (2026-11-18): https://developer.android.com/jetpack/androidx/versions
- Release notes: compose-material3, compose-material3-adaptive, navigation3, window, webkit, web, room, room3, datastore, glance, credentials, browser (all under https://developer.android.com/jetpack/androidx/releases/)
- Window size classes: https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes
- Adaptive app quality guidelines: https://developer.android.com/docs/quality-guidelines/adaptive-app-quality
- Googlebook developer overview: https://developer.android.com/develop/adaptive-apps/guides/googlebook/overview
- Googlebook developer blog (2026-09-22): https://android-developers.googleblog.com/2026/09/adaptive-development-scale-app-googlebook.html
- Meet Googlebook (2026-05-12): https://blog.google/products-and-platforms/platforms/android/meet-googlebook/
- 16 KB page sizes: https://developer.android.com/guide/practices/page-sizes
- Play target API: https://support.google.com/googleplay/android-developer/answer/11926878
- Play testing requirement: https://support.google.com/googleplay/android-developer/answer/14151465
- Play Data safety: https://support.google.com/googleplay/android-developer/answer/10787469
- Play account deletion: https://support.google.com/googleplay/android-developer/answer/13327111
- WebView JS bridge: https://developer.android.com/develop/ui/views/layout/webapps/native-api-access-jsbridge
- ML Kit document scanner: https://developers.google.com/ml-kit/vision/doc-scanner
- kotlinx.serialization: https://github.com/Kotlin/kotlinx.serialization/releases , https://kotlinlang.org/docs/serialization-polymorphism.html , https://kotlinlang.org/docs/serialization-json-configuration.html
- Secondary: https://en.wikipedia.org/wiki/Googlebook , https://9to5google.com/2026/09/28/google-details-chromebook-updates-through-2034-many-models-move-to-googlebook-os/ , https://www.xda-developers.com/google-warns-some-android-apps-wont-run-well-on-intel-googlebooks-at-launch/ , https://apilevels.com/ , https://www.androidauthority.com/android-17-qpr2-beta-5-3712182/
