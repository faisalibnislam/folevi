//! The Jump List on Windows (right-click Folevi in the taskbar or the Start menu): New Note, Quick Add Task and
//! Today's Tasks, as the Linux launcher's actions (packaging/linux/folevi.desktop.hbs) and the Mac's Dock menu.
//! Each starts Folevi with a folevi:// link; a running Folevi gets it through the single-instance plugin
//! (lib.rs open_link).

/// The tasks: title and the link each opens.
pub const TASKS: [(&str, &str); 3] = [("New Note", "folevi://new"), ("Quick Add Task", "folevi://quick-add"), ("Today's Tasks", "folevi://tasks/today")];

#[cfg(windows)]
pub fn set_tasks(app_id: &str) -> windows::core::Result<()> {
    use windows::core::{Interface, HSTRING};
    use windows::Win32::Storage::EnhancedStorage::PKEY_Title;
    use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::Common::{IObjectArray, IObjectCollection};
    use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
    use windows::Win32::UI::Shell::{DestinationList, EnumerableObjectCollection, ICustomDestinationList, IShellLinkW, ShellLink};

    let exe = std::env::current_exe().map_err(|_| windows::core::Error::from(windows::Win32::Foundation::E_FAIL))?;
    let exe = HSTRING::from(exe.as_os_str());
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let list: ICustomDestinationList = CoCreateInstance(&DestinationList, None, CLSCTX_INPROC_SERVER)?;
        list.SetAppID(&HSTRING::from(app_id))?;
        let mut slots = 0u32;
        let _removed: IObjectArray = list.BeginList(&mut slots)?;
        let tasks: IObjectCollection = CoCreateInstance(&EnumerableObjectCollection, None, CLSCTX_INPROC_SERVER)?;
        for (title, link) in TASKS {
            let item: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
            item.SetPath(&exe)?;
            item.SetArguments(&HSTRING::from(link))?;
            item.SetIconLocation(&exe, 0)?;
            let store: IPropertyStore = item.cast()?;
            store.SetValue(&PKEY_Title, &PROPVARIANT::from(title))?;
            store.Commit()?;
            tasks.AddObject(&item)?;
        }
        list.AddUserTasks(&tasks.cast::<IObjectArray>()?)?;
        list.CommitList()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_task_is_a_link_folevi_opens() {
        for (_, link) in TASKS {
            let url = tauri::Url::parse(link).unwrap();
            assert!(crate::deep_link_path(&url).is_some(), "{link}");
        }
    }
}
