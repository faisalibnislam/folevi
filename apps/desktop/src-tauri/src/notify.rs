//! Windows and Linux notifications (the Mac's Notifications.swift; keep the two in step). A click brings Folevi
//! forward at the page the notification is about; its buttons act without opening it:
//! - a comment or mention: Reply (typed in the notification, Windows) and Mark as Read;
//! - a task assigned: Open and Complete;
//! - a task's reminder: Complete, Snooze 1 Hour, Snooze Until This Evening, Snooze Until Tomorrow;
//! - anything else: Mark as Read.
//!
//! The page does the work (DesktopBridge.tsx useNotificationActions): the button reaches it as the command
//! `{ type: "notification", action, id, kind, path, text?, thread? }`.
//!
//! Windows: WinRT toasts tied to Folevi's AppUserModelID (the installer's Start menu shortcut carries it), grouped by
//! note in Action Center. Linux: the desktop's notification server through D-Bus, with its actions (no typed
//! replies there: the D-Bus protocol has none, so a comment offers Mark as Read and the click opens it).
use std::sync::Arc;

/// Runs when the person clicks the notification (None) or one of its buttons (Some(action id)), with what they
/// typed for Reply.
pub type OnAction = Arc<dyn Fn(Option<String>, Option<String>) + Send + Sync>;

/// What the page says of a notification (desktop.ts notify).
#[derive(Debug, Clone, Default)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub body: String,
    pub kind: String,
    /// The note it's about (grouping).
    pub thread: String,
    /// The comment thread it's in (Reply goes there).
    pub comment_thread: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Category {
    Comment,
    Task,
    Reminder,
    Plain,
}

/// The Mac's rule: reminders and due dates; tasks assigned; comments, mentions and replies that have a thread.
pub fn category(kind: &str, comment_thread: &str) -> Category {
    let k = kind.to_ascii_lowercase();
    if k.contains("remind") || k.contains("due") {
        Category::Reminder
    } else if k.contains("assign") || k.contains("task") {
        Category::Task
    } else if (k.contains("mention") || k.contains("comment") || k.contains("reply")) && !comment_thread.is_empty() {
        Category::Comment
    } else {
        Category::Plain
    }
}

/// The buttons, as (action id, title). `typed_replies`: whether this desktop can take a reply in the notification.
pub fn actions(c: Category, typed_replies: bool) -> Vec<(&'static str, &'static str)> {
    match c {
        Category::Comment if typed_replies => vec![("reply", "Reply"), ("read", "Mark as Read")],
        Category::Comment | Category::Plain => vec![("read", "Mark as Read")],
        Category::Task => vec![("open", "Open"), ("complete", "Complete")],
        Category::Reminder => vec![("complete", "Complete"), ("snooze-hour", "Snooze 1 Hour"), ("snooze-evening", "Snooze Until This Evening"), ("snooze-tomorrow", "Snooze Until Tomorrow")],
    }
}

/// Shows a plain notification whose click runs `on_click` (Folevi's own reminders).
pub fn show(app_id: &str, title: &str, body: &str, on_click: Arc<dyn Fn() + Send + Sync>) {
    let note = Note { title: title.into(), body: body.into(), ..Default::default() };
    show_note(app_id, &note, false, Arc::new(move |action, _| {
        if action.is_none() {
            on_click();
        }
    }));
}

/// Shows a notification with its category's buttons (`with_actions`), grouped by its note.
pub fn show_note(app_id: &str, note: &Note, with_actions: bool, on_action: OnAction) {
    let mut note = note.clone();
    note.title = truncate(&note.title, 200);
    note.body = truncate(&note.body, 400);
    let buttons = if with_actions { actions(category(&note.kind, &note.comment_thread), cfg!(windows)) } else { vec![] };
    #[cfg(windows)]
    {
        if let Err(e) = windows_toast::show(app_id, &note, &buttons, on_action) {
            log::warn!("Folevi: the notification didn't show: {e}");
        }
    }
    #[cfg(not(windows))]
    {
        let _ = app_id;
        std::thread::spawn(move || {
            let mut n = notify_rust::Notification::new();
            n.summary(&note.title).body(&note.body).appname("Folevi");
            #[cfg(all(unix, not(target_os = "macos")))]
            {
                n.action("default", "Open");
                for (id, title) in &buttons {
                    n.action(id, title);
                }
                if category(&note.kind, &note.comment_thread) == Category::Comment {
                    n.hint(notify_rust::Hint::Category("im.received".into()));
                }
                #[cfg(target_os = "linux")]
                n.icon(crate::linux::icon_name());
                if let Ok(handle) = n.show() {
                    handle.wait_for_action(|action| match action {
                        "default" => on_action(None, None),
                        "__closed" => {}
                        a => on_action(Some(a.to_string()), None),
                    });
                }
            }
            #[cfg(target_os = "macos")]
            {
                let _ = n.show();
                let _ = (on_action, buttons);
            }
        });
    }
}

/// A toast's XML: title, body, and the buttons (Reply with its text box).
pub fn toast_xml(note: &Note, buttons: &[(&str, &str)]) -> String {
    let mut actions = String::new();
    for (id, title) in buttons {
        if *id == "reply" {
            actions.push_str(r#"<input id="reply" type="text" placeHolderContent="Reply"/>"#);
            actions.push_str(&format!(r#"<action content="{}" arguments="reply" hint-inputId="reply"/>"#, esc(title)));
        } else {
            actions.push_str(&format!(r#"<action content="{}" arguments="{}"/>"#, esc(title), esc(id)));
        }
    }
    let body = if note.body.is_empty() { String::new() } else { format!("<text>{}</text>", esc(&note.body)) };
    let actions = if actions.is_empty() { String::new() } else { format!("<actions>{actions}</actions>") };
    format!(r#"<toast launch="open"><visual><binding template="ToastGeneric"><text>{}</text>{body}</binding></visual>{actions}</toast>"#, esc(&note.title))
}

/// Windows' Action Center groups a note's notifications together; others go under "folevi".
pub fn group_of(note: &Note) -> String {
    if note.thread.is_empty() {
        "folevi".into()
    } else {
        truncate(&format!("note-{}", note.thread), 64)
    }
}

fn esc(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_control() || *c == '\n')
        .map(|c| match c {
            '&' => "&amp;".to_string(),
            '<' => "&lt;".to_string(),
            '>' => "&gt;".to_string(),
            '"' => "&quot;".to_string(),
            '\'' => "&apos;".to_string(),
            c => c.to_string(),
        })
        .collect()
}

fn truncate(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

#[cfg(windows)]
mod windows_toast {
    use super::{group_of, toast_xml, truncate, Note, OnAction};
    use windows::core::{Interface, HSTRING};
    use windows::Data::Xml::Dom::XmlDocument;
    use windows::Foundation::TypedEventHandler;
    use windows::UI::Notifications::{ToastActivatedEventArgs, ToastNotification, ToastNotificationManager};

    /// Toasts stay referenced while Folevi runs so their buttons are heard (the newest 50).
    static KEPT: parking_lot::Mutex<Vec<ToastNotification>> = parking_lot::Mutex::new(Vec::new());

    pub fn show(app_id: &str, note: &Note, buttons: &[(&str, &str)], on_action: OnAction) -> windows::core::Result<()> {
        // An installed Folevi has its own id (the Start menu shortcut); a development run borrows PowerShell's,
        // which Windows always knows, so the toast still shows.
        let id = if std::env::var_os("FOLEVI_DEV_TOASTS").is_some() {
            "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe".to_string()
        } else {
            app_id.to_string()
        };
        let doc = XmlDocument::new()?;
        doc.LoadXml(&HSTRING::from(toast_xml(note, buttons)))?;
        let toast = ToastNotification::CreateToastNotification(&doc)?;
        if !note.id.is_empty() {
            toast.SetTag(&HSTRING::from(truncate(&note.id, 64)))?;
        }
        toast.SetGroup(&HSTRING::from(group_of(note)))?;
        toast.Activated(&TypedEventHandler::<ToastNotification, windows::core::IInspectable>::new(move |_, args| {
            let Some(args) = args.as_ref() else { return Ok(()) };
            let Ok(args) = args.cast::<ToastActivatedEventArgs>() else { return Ok(()) };
            let action = args.Arguments().map(|a| a.to_string()).unwrap_or_default();
            let text = args
                .UserInput()
                .ok()
                .and_then(|input| input.Lookup(&HSTRING::from("reply")).ok())
                .and_then(|v| v.cast::<windows::Foundation::IPropertyValue>().ok())
                .and_then(|v| v.GetString().ok())
                .map(|h| truncate(&h.to_string(), 4000));
            if action.is_empty() || action == "open" {
                on_action(None, None);
            } else {
                on_action(Some(action), text);
            }
            Ok(())
        }))?;
        ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(id))?.Show(&toast)?;
        let mut kept = KEPT.lock();
        kept.push(toast);
        let n = kept.len();
        if n > 50 {
            kept.drain(..n - 50);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_kind_gets_the_macs_buttons() {
        assert_eq!(category("Reminder", ""), Category::Reminder);
        assert_eq!(category("task.due", ""), Category::Reminder);
        assert_eq!(category("task.assigned", ""), Category::Task);
        assert_eq!(category("mention", "t1"), Category::Comment);
        assert_eq!(category("comment.reply", "t1"), Category::Comment);
        assert_eq!(category("mention", ""), Category::Plain, "no thread, nothing to reply in");
        assert_eq!(category("share", ""), Category::Plain);
        assert_eq!(actions(Category::Comment, true), vec![("reply", "Reply"), ("read", "Mark as Read")]);
        assert_eq!(actions(Category::Comment, false), vec![("read", "Mark as Read")]);
        assert_eq!(actions(Category::Task, true), vec![("open", "Open"), ("complete", "Complete")]);
        assert_eq!(actions(Category::Reminder, true).len(), 4);
    }

    #[test]
    fn a_toast_carries_its_buttons_and_the_reply_box() {
        let note = Note { id: "n1".into(), title: "Ana <ana@x> & co".into(), body: "\"Look\" at this".into(), kind: "mention".into(), thread: "doc1".into(), comment_thread: "t1".into() };
        let xml = toast_xml(&note, &actions(category(&note.kind, &note.comment_thread), true));
        assert!(xml.contains("<text>Ana &lt;ana@x&gt; &amp; co</text><text>&quot;Look&quot; at this</text>"));
        assert!(xml.contains(r#"<input id="reply" type="text" placeHolderContent="Reply"/><action content="Reply" arguments="reply" hint-inputId="reply"/>"#));
        assert!(xml.contains(r#"<action content="Mark as Read" arguments="read"/>"#));
        assert_eq!(group_of(&note), "note-doc1");
        assert_eq!(group_of(&Note::default()), "folevi");
        let plain = toast_xml(&Note { title: "Reminder".into(), ..Default::default() }, &[]);
        assert!(!plain.contains("<actions>") && !plain.contains("<text></text>"));
    }
}
