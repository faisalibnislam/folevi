//! The library service through the page's calls: setting up each place, the files, the journal and change
//! batches, encryption on, locked, unlocked, the passphrase changed and encryption off (with the files readable
//! by the format's rules), moving the library and finishing a move that stopped, attachments, and a cloud
//! library's copy. Everything happens in temporary folders; `home` is one too.
use super::*;
use sha2::Digest;

const DOC: &str = "01J9ZDOC000000000000000001";

struct Kit {
    s: Arc<LibraryService>,
    home: PathBuf,
    user_data: PathBuf,
    events: Arc<Mutex<Vec<(String, Value)>>>,
    _dirs: Vec<tempfile::TempDir>,
}

fn make_with(home: Option<PathBuf>, user_data: Option<PathBuf>, pick: Option<PathBuf>) -> Kit {
    let mut dirs = Vec::new();
    let mut temp = || {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().to_path_buf();
        dirs.push(d);
        p
    };
    let home = home.unwrap_or_else(&mut temp);
    let user_data = user_data.unwrap_or_else(&mut temp);
    let events: Arc<Mutex<Vec<(String, Value)>>> = Arc::new(Mutex::new(Vec::new()));
    let ev = events.clone();
    let s = LibraryService::new(LibraryOptions {
        user_data: user_data.clone(),
        home: home.clone(),
        sealer: Arc::new(Sealer::with_key([1; 32])),
        choose_folder: Arc::new(move |_, _| pick.clone()),
        emit: Arc::new(move |name, payload| ev.lock().push((name.to_string(), payload))),
    });
    s.set_iterations(1000);
    Kit { s, home, user_data, events, _dirs: dirs }
}

fn make() -> Kit {
    make_with(None, None, None)
}

fn tempdir() -> (tempfile::TempDir, PathBuf) {
    let d = tempfile::tempdir().unwrap();
    let p = std::fs::canonicalize(d.path()).unwrap();
    (d, p)
}

async fn call(k: &Kit, method: &str, o: Value) -> ShellResult {
    k.s.call(method, &o).await
}

async fn ok(k: &Kit, method: &str, o: Value) -> Value {
    call(k, method, o).await.unwrap_or_else(|e| panic!("{method}: {e}"))
}

async fn write(k: &Kit, path: &str, bytes: &[u8]) -> String {
    let r = ok(k, "libWrite", json!({ "path": path, "bytes": b64(bytes), "mode": "any" })).await;
    r["etag"].as_str().unwrap().to_string()
}

async fn read(k: &Kit, path: &str) -> Vec<u8> {
    let r = ok(k, "libRead", json!({ "path": path })).await;
    base64::Engine::decode(&base64::engine::general_purpose::STANDARD, r["bytes"].as_str().unwrap()).unwrap()
}

async fn list(k: &Kit, dir: &str) -> Vec<String> {
    let r = ok(k, "libList", json!({ "dir": dir })).await;
    let mut v: Vec<String> = r["entries"].as_array().unwrap().iter().map(|e| e["path"].as_str().unwrap().to_string()).collect();
    v.sort();
    v
}

fn changes(k: &Kit) -> Vec<Value> {
    k.events.lock().iter().filter(|(n, _)| n == "libraryChanges").map(|(_, p)| p.clone()).collect()
}

fn names(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().into_string().unwrap()).collect();
    v.sort();
    v
}

#[tokio::test]
async fn before_setup_not_configured_and_file_calls_say_so() {
    let k = make();
    k.s.open().await;
    assert_eq!(k.s.info().await, json!({ "kind": "device", "displayPath": "", "available": false, "encrypted": false, "locked": false, "configured": false }));
    assert_eq!(call(&k, "libList", json!({ "dir": "" })).await.unwrap_err().code, "not_set_up");
    assert_eq!(call(&k, "journalRead", json!({})).await.unwrap_err().code, "not_set_up");
    // Places this PC doesn't have.
    let e = call(&k, "libSetup", json!({ "kind": "icloud" })).await.unwrap_err();
    assert_eq!((e.code.as_str(), e.data.unwrap()["path"].as_str().unwrap()), ("unavailable", "unsupported"));
    assert_eq!(call(&k, "nonsense", json!({})).await.unwrap_err().code, "unavailable");
}

#[tokio::test]
async fn this_device_only_makes_documents_folevi_library() {
    let k = make();
    let info = ok(&k, "libSetup", json!({ "kind": "device" })).await;
    let shown = if cfg!(windows) { "Documents › Folevi Library" } else { "~/Documents/Folevi Library" };
    assert_eq!(info, json!({ "kind": "device", "displayPath": shown, "available": true, "encrypted": false, "locked": false, "configured": true }));
    let root = device_location(&k.home);
    let m = decode_manifest(&std::fs::read(root.join(LIBRARY_FILE)).unwrap()).unwrap();
    let id = library_id_of(&m);
    assert_eq!(id.len(), 26);
    assert!(id.bytes().all(|b| b.is_ascii_digit() || b.is_ascii_uppercase()));
    let stored: Value = serde_json::from_slice(&std::fs::read(k.user_data.join("library.json")).unwrap()).unwrap();
    assert_eq!((stored["kind"].as_str(), stored["libraryId"].as_str()), (Some("device"), Some(id.as_str())));
    // The next launch finds it.
    let again = make_with(Some(k.home.clone()), Some(k.user_data.clone()), None);
    again.s.open().await;
    assert_eq!(again.s.info().await["configured"], json!(true));
    assert_eq!(again.s.info().await["available"], json!(true));
}

#[tokio::test]
async fn choose_a_folder_cancelled_empty_or_full() {
    assert_eq!(ok(&make(), "libSetup", json!({ "kind": "folder" })).await, json!({ "value": null }));
    let (_e, empty) = tempdir();
    let a = make_with(None, None, Some(empty.clone()));
    assert_eq!(ok(&a, "libSetup", json!({ "kind": "folder" })).await["kind"], json!("folder"));
    assert!(empty.join(LIBRARY_FILE).exists());
    let (_b, busy) = tempdir();
    std::fs::write(busy.join("Taxes.pdf"), "x").unwrap();
    let b = make_with(None, None, Some(busy.clone()));
    ok(&b, "libSetup", json!({ "kind": "folder" })).await;
    assert!(busy.join("Folevi Library").join(LIBRARY_FILE).exists());
    // A folder that already holds a library (from another device) is joined, not replaced.
    let c = make_with(None, None, Some(empty.clone()));
    ok(&c, "libSetup", json!({ "kind": "folder" })).await;
    let a_id: Value = serde_json::from_slice(&std::fs::read(a.user_data.join("library.json")).unwrap()).unwrap();
    let c_id: Value = serde_json::from_slice(&std::fs::read(c.user_data.join("library.json")).unwrap()).unwrap();
    assert_eq!(a_id["libraryId"], c_id["libraryId"]);
}

#[tokio::test]
async fn the_folder_going_away_makes_it_unavailable_not_broken() {
    let (_d, dir) = tempdir();
    let k = make_with(None, None, Some(dir.clone()));
    ok(&k, "libSetup", json!({ "kind": "folder" })).await;
    std::fs::remove_dir_all(&dir).unwrap();
    let fresh = make_with(Some(k.home.clone()), Some(k.user_data.clone()), None);
    fresh.s.open().await;
    let info = fresh.s.info().await;
    assert_eq!((info["configured"].clone(), info["available"].clone()), (json!(true), json!(false)));
    assert_eq!(call(&fresh, "libList", json!({ "dir": "" })).await.unwrap_err().code, "unavailable");
}

#[tokio::test]
async fn files_the_journal_and_change_batches() {
    let k = make();
    ok(&k, "libSetup", json!({ "kind": "device" })).await;
    let path = format!("notes/{DOC}.fnote");
    let w = ok(&k, "libWrite", json!({ "path": path, "bytes": b64(b"hello"), "mode": "create" })).await;
    let etag = w["etag"].as_str().unwrap().to_string();
    // Create-only again: a mismatch with the current etag.
    assert_eq!(ok(&k, "libWrite", json!({ "path": path, "bytes": b64(b"again"), "mode": "create" })).await, json!({ "mismatch": true, "etag": etag }));
    assert_eq!(ok(&k, "libWrite", json!({ "path": path, "bytes": b64(b"x"), "mode": "match", "ifMatch": "stale" })).await["mismatch"], json!(true));
    assert_eq!(call(&k, "libWrite", json!({ "path": path, "bytes": b64(b"x"), "mode": "match" })).await.unwrap_err().code, "invalid_argument");
    let r = ok(&k, "libRead", json!({ "path": path })).await;
    assert_eq!((r["bytes"].as_str().unwrap(), r["etag"].as_str().unwrap()), (b64(b"hello").as_str(), etag.as_str()));
    let entries = ok(&k, "libList", json!({ "dir": "notes" })).await;
    let e = &entries["entries"][0];
    assert_eq!((e["path"].as_str().unwrap(), e["size"].as_u64().unwrap(), e["downloaded"].as_bool().unwrap(), e["hasConflicts"].as_bool().unwrap()), (path.as_str(), 5, true, false));
    assert_eq!(ok(&k, "libConflictVersions", json!({ "path": path })).await, json!({ "versions": [] }));
    assert_eq!(ok(&k, "libResolveConflicts", json!({ "path": path, "ids": [] })).await, json!({ "value": null }));
    assert_eq!(ok(&k, "libStartDownload", json!({ "paths": [path] })).await, json!({ "value": null }));
    assert_eq!(call(&k, "libRead", json!({ "path": "../x" })).await.unwrap_err().code, "invalid_path");
    assert_eq!(call(&k, "libRead", json!({ "path": "notes/missing.fnote" })).await.unwrap_err().code, "not_found");

    ok(&k, "journalAppend", json!({ "record": b64(b"edit 1") })).await;
    ok(&k, "journalAppend", json!({ "record": b64(b"edit 2") })).await;
    assert_eq!(ok(&k, "journalRead", json!({})).await, json!({ "records": [b64(b"edit 1"), b64(b"edit 2")] }));
    ok(&k, "journalTruncate", json!({ "n": 1 })).await;
    assert_eq!(ok(&k, "journalRead", json!({})).await, json!({ "records": [b64(b"edit 2")] }));
    assert_eq!(call(&k, "journalTruncate", json!({ "n": -1 })).await.unwrap_err().code, "invalid_argument");
    assert_eq!(call(&k, "libRemove", json!({ "path": LIBRARY_FILE })).await.unwrap_err().code, "invalid_path");

    // Our own writes aren't echoed; another program's are.
    ok(&k, "libWatch", json!({})).await;
    k.s.rescan().await;
    assert!(changes(&k).is_empty(), "{:?}", changes(&k));
    let other = device_location(&k.home).join("notes").join("01J9ZDOC000000000000000002.fnote");
    std::fs::write(&other, "theirs").unwrap();
    k.s.rescan().await;
    assert_eq!(changes(&k), vec![json!({ "changes": [{ "path": "notes/01J9ZDOC000000000000000002.fnote", "kind": "changed" }] })]);
    ok(&k, "libRemove", json!({ "path": path, "ifMatch": etag })).await;
    std::fs::remove_file(&other).unwrap();
    k.s.rescan().await;
    assert_eq!(changes(&k).last().unwrap(), &json!({ "changes": [{ "path": "notes/01J9ZDOC000000000000000002.fnote", "kind": "removed" }] }));
    assert_eq!(changes(&k).len(), 2);
}

#[tokio::test]
async fn the_watcher_reports_outside_changes_by_itself() {
    let k = make();
    ok(&k, "libSetup", json!({ "kind": "device" })).await;
    ok(&k, "libWatch", json!({})).await;
    // Let the baseline settle.
    tokio::time::sleep(Duration::from_millis(300)).await;
    let notes = device_location(&k.home).join("notes");
    std::fs::create_dir_all(&notes).unwrap();
    std::fs::write(notes.join(format!("{DOC}.fnote")), "from another app").unwrap();
    for _ in 0..50 {
        if !changes(&k).is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert_eq!(changes(&k), vec![json!({ "changes": [{ "path": format!("notes/{DOC}.fnote"), "kind": "changed" }] })]);
    k.s.dispose();
}

#[tokio::test]
async fn encryption_on_locked_unlocked_passphrase_changed_off() {
    let k = make();
    ok(&k, "libSetup", json!({ "kind": "device" })).await;
    let root = device_location(&k.home);
    let note = format!(r#"{{"id":"{DOC}","words":"secret plans"}}"#);
    write(&k, &format!("notes/{DOC}.fnote"), note.as_bytes()).await;
    write(&k, "index/library.findex", b"{}").await;
    let asha = hex::encode(sha2::Sha256::digest(b"attachment bytes"));
    let apath = format!("files/{}/{asha}", &asha[..2]);
    write(&k, &apath, b"attachment bytes").await;
    ok(&k, "journalAppend", json!({ "record": b64(b"kept") })).await;

    assert_eq!(ok(&k, "libSetPassphrase", json!({ "passphrase": "correct horse" })).await, json!({ "value": null }));
    let info = k.s.info().await;
    assert_eq!((info["encrypted"].clone(), info["locked"].clone()), (json!(true), json!(false)));
    let on_disk = names(&root.join("notes"));
    assert_eq!(on_disk.len(), 1);
    assert!(on_disk[0].ends_with(".fnote") && on_disk[0].len() == 26 + 6 && on_disk[0] != format!("{DOC}.fnote"));
    let sealed = std::fs::read(root.join("notes").join(&on_disk[0])).unwrap();
    assert!(is_envelope(&sealed) && !String::from_utf8_lossy(&sealed).contains("secret"));
    assert!(is_envelope(&std::fs::read(root.join("index/library.findex")).unwrap()));
    // The page still sees plain names and bytes.
    assert_eq!(read(&k, &format!("notes/{DOC}.fnote")).await, note.as_bytes());
    assert_eq!(list(&k, "").await, vec![apath.clone(), LIBRARY_FILE.to_string(), "index/library.findex".to_string(), format!("notes/{DOC}.fnote")]);
    // Any Folevi app can open it from the library file and the passphrase alone.
    let m = decode_manifest(&std::fs::read(root.join(LIBRARY_FILE)).unwrap()).unwrap();
    let key = unlock_master_key(&header_of(&m).unwrap(), "correct horse").unwrap().unwrap();
    let opened = crypto::open_file(&key, &format!("notes/{}", on_disk[0]), &sealed).unwrap();
    assert_eq!(opened, note.as_bytes());

    // A new start: the key comes back, sealed on this PC.
    let second = make_with(Some(k.home.clone()), Some(k.user_data.clone()), None);
    second.s.open().await;
    assert_eq!(second.s.info().await["locked"], json!(false));
    // Without the cached key it's locked until the passphrase.
    second.s.lock_again();
    let third = make_with(Some(k.home.clone()), Some(k.user_data.clone()), None);
    third.s.open().await;
    assert_eq!(third.s.info().await["locked"], json!(true));
    assert_eq!(call(&third, "libRead", json!({ "path": format!("notes/{DOC}.fnote") })).await.unwrap_err().code, "locked");
    assert_eq!(third.s.attachment(&asha).await.unwrap(), None);
    assert_eq!(ok(&third, "libUnlock", json!({ "passphrase": "wrong" })).await, json!({ "value": false }));
    assert_eq!(ok(&third, "libUnlock", json!({ "passphrase": "correct horse" })).await, json!({ "value": true }));
    assert_eq!(third.s.info().await["locked"], json!(false));
    assert_eq!(ok(&third, "journalRead", json!({})).await, json!({ "records": [b64(b"kept")] }));
    assert_eq!(third.s.attachment(&asha).await.unwrap(), Some((b"attachment bytes".to_vec(), None)));

    assert_eq!(ok(&third, "libChangePassphrase", json!({ "old": "wrong", "new": "new one" })).await, json!({ "value": false }));
    assert_eq!(ok(&third, "libChangePassphrase", json!({ "old": "correct horse", "new": "new one" })).await, json!({ "value": true }));
    assert_eq!(names(&root.join("notes")), on_disk); // only the key was rewrapped
    third.s.lock_again();
    assert_eq!(ok(&third, "libUnlock", json!({ "passphrase": "correct horse" })).await, json!({ "value": false }));
    assert_eq!(ok(&third, "libUnlock", json!({ "passphrase": "new one" })).await, json!({ "value": true }));

    ok(&third, "libSetPassphrase", json!({})).await;
    let info = third.s.info().await;
    assert_eq!((info["encrypted"].clone(), info["locked"].clone()), (json!(false), json!(false)));
    assert_eq!(names(&root.join("notes")), vec![format!("{DOC}.fnote")]);
    assert_eq!(std::fs::read(root.join("notes").join(format!("{DOC}.fnote"))).unwrap(), note.as_bytes());
    assert_eq!(std::fs::read(root.join("files").join(&asha[..2]).join(&asha)).unwrap(), b"attachment bytes");
    assert!(!third.user_data.join("library-keys").join(format!("{}.key", library_id_of(&m))).exists());
    assert_eq!(call(&third, "libSetPassphrase", json!({ "passphrase": "" })).await.unwrap_err().code, "invalid_argument");
}

#[tokio::test]
async fn moving_to_a_chosen_folder_copies_checks_and_switches() {
    let (_t, target) = tempdir();
    let k = make_with(None, None, Some(target.clone()));
    ok(&k, "libSetup", json!({ "kind": "device" })).await;
    for i in 0..5 {
        write(&k, &format!("notes/01J9ZDOC00000000000000000{i}.fnote"), format!("note {i}").as_bytes()).await;
    }
    let info = ok(&k, "libMove", json!({ "kind": "folder" })).await;
    assert_eq!((info["kind"].clone(), info["available"].clone()), (json!("folder"), json!(true)));
    assert_eq!(names(&target.join("notes")).len(), 5);
    // The old copy stays.
    assert!(device_location(&k.home).join("notes").join("01J9ZDOC000000000000000000.fnote").exists());
    assert_eq!(read(&k, "notes/01J9ZDOC000000000000000003.fnote").await, b"note 3");
    write(&k, "notes/01J9ZDOC000000000000000009.fnote", b"new").await;
    assert!(target.join("notes").join("01J9ZDOC000000000000000009.fnote").exists());
}

#[tokio::test]
async fn a_move_that_stopped_part_way_finishes_when_asked_again() {
    let (_c, chosen) = tempdir();
    std::fs::write(chosen.join("Taxes.pdf"), "x").unwrap();
    let target = chosen.join("Folevi Library");
    let k = make_with(None, None, Some(chosen.clone()));
    ok(&k, "libSetup", json!({ "kind": "device" })).await;
    for i in 0..4 {
        write(&k, &format!("notes/01J9ZDOC00000000000000000{i}.fnote"), format!("note {i}").as_bytes()).await;
    }
    // A folder where the last note should go: that file can't be written yet.
    let blocker = target.join("notes").join("01J9ZDOC000000000000000003.fnote");
    std::fs::create_dir_all(&blocker).unwrap();
    assert!(call(&k, "libMove", json!({ "kind": "folder" })).await.is_err());
    assert_eq!(k.s.info().await["kind"], json!("device"));
    assert!(!target.join(LIBRARY_FILE).exists());
    let copied: Vec<String> = names(&target.join("notes")).into_iter().filter(|n| n != "01J9ZDOC000000000000000003.fnote").collect();
    assert_eq!(copied.len(), 3);
    let first = std::fs::metadata(target.join("notes").join(&copied[0])).unwrap().modified().unwrap();
    std::fs::remove_dir_all(&blocker).unwrap();
    // A restart finishes it too; here, moving again.
    assert_eq!(ok(&k, "libMove", json!({ "kind": "folder" })).await["kind"], json!("folder"));
    assert_eq!(names(&target.join("notes")).len(), 4);
    // Files that had arrived whole weren't written again.
    assert_eq!(std::fs::metadata(target.join("notes").join(&copied[0])).unwrap().modified().unwrap(), first);
}

#[tokio::test]
async fn a_move_left_half_done_finishes_on_the_next_start() {
    let (_t, target) = tempdir();
    let k = make_with(None, None, Some(target.clone()));
    ok(&k, "libSetup", json!({ "kind": "device" })).await;
    write(&k, &format!("notes/{DOC}.fnote"), b"n").await;
    // As if the app had stopped right after recording the move.
    let mut stored: Value = serde_json::from_slice(&std::fs::read(k.user_data.join("library.json")).unwrap()).unwrap();
    stored["move"] = json!({ "kind": "folder", "path": target.to_string_lossy(), "chosenFolder": target.to_string_lossy() });
    std::fs::write(k.user_data.join("library.json"), serde_json::to_vec(&stored).unwrap()).unwrap();
    let next = make_with(Some(k.home.clone()), Some(k.user_data.clone()), None);
    next.s.open().await;
    assert_eq!(next.s.info().await["kind"], json!("folder"));
    assert_eq!(read(&next, &format!("notes/{DOC}.fnote")).await, b"n");
    assert!(target.join(LIBRARY_FILE).exists());
}

#[tokio::test]
async fn not_into_a_folder_holding_another_library_nor_into_itself() {
    let (_o, other) = tempdir();
    ok(&make_with(None, None, Some(other.clone())), "libSetup", json!({ "kind": "folder" })).await;
    let k = make_with(None, None, Some(other.clone()));
    ok(&k, "libSetup", json!({ "kind": "device" })).await;
    assert_eq!(call(&k, "libMove", json!({ "kind": "folder" })).await.unwrap_err().code, "target_has_library");
    let inner = device_location(&k.home).join("notes");
    std::fs::create_dir_all(&inner).unwrap();
    let k2 = make_with(Some(k.home.clone()), Some(k.user_data.clone()), Some(inner));
    assert_eq!(call(&k2, "libMove", json!({ "kind": "folder" })).await.unwrap_err().code, "invalid_argument");
    // Cancelling the folder dialog leaves things as they were.
    let k3 = make_with(Some(k.home.clone()), Some(k.user_data.clone()), None);
    assert_eq!(ok(&k3, "libMove", json!({ "kind": "folder" })).await["kind"], json!("device"));
}

#[tokio::test]
async fn attachments_plain_and_encrypted_and_damaged() {
    let body: Vec<u8> = (0..300_000).map(|i| (i % 253) as u8).collect();
    let sha = hex::encode(sha2::Sha256::digest(&body));
    for encrypted in [false, true] {
        let k = make();
        ok(&k, "libSetup", json!({ "kind": "device" })).await;
        if encrypted {
            ok(&k, "libSetPassphrase", json!({ "passphrase": "pass" })).await;
        }
        write(&k, &format!("files/{}/{sha}", &sha[..2]), &body).await;
        assert_eq!(k.s.attachment(&sha).await.unwrap(), Some((body.clone(), None)));
        assert_eq!(k.s.attachment(&sha.to_uppercase()).await.unwrap().map(|a| a.0.len()), Some(body.len()));
        assert_eq!(k.s.attachment(&"0".repeat(64)).await.unwrap(), None);
        assert_eq!(k.s.attachment("../../etc/passwd").await.unwrap(), None);
        if encrypted {
            // Cut short: the final chunk's flag is missing, so it can't pass as a shorter file.
            let dir = device_location(&k.home).join("files");
            let sub = names(&dir).remove(0);
            let name = names(&dir.join(&sub)).remove(0);
            assert_ne!(name, sha);
            let f = dir.join(&sub).join(&name);
            let full = std::fs::read(&f).unwrap();
            std::fs::write(&f, &full[..full.len() - 100]).unwrap();
            assert_eq!(k.s.attachment(&sha).await.unwrap(), None);
        }
    }
}

#[tokio::test]
async fn a_cloud_library_is_recorded_and_its_copy_kept() {
    let k = make();
    assert_eq!(call(&k, "libSetCloud", json!({ "kind": "box", "libraryId": "X" })).await.unwrap_err().code, "invalid_argument");
    let info = ok(&k, "libSetCloud", json!({ "kind": "dropbox", "libraryId": "01J9ZLIB000000000000000001" })).await;
    assert_eq!(info, json!({ "kind": "dropbox", "displayPath": "Dropbox", "available": true, "encrypted": false, "locked": false, "configured": true }));
    // The journal is this PC's, whatever the place.
    ok(&k, "journalAppend", json!({ "record": b64(b"r") })).await;
    assert_eq!(call(&k, "libList", json!({ "dir": "" })).await.unwrap_err().code, "unavailable");
    ok(&k, "mirrorWrite", json!({ "provider": "dropbox", "path": "notes/A.fnote", "data": b64(b"a"), "etag": "rev1" })).await;
    assert_eq!(ok(&k, "mirrorRead", json!({ "provider": "dropbox", "path": "notes/A.fnote" })).await, json!({ "data": b64(b"a"), "etag": "rev1" }));
    assert_eq!(ok(&k, "mirrorRead", json!({ "provider": "dropbox", "path": "notes/B.fnote" })).await, json!({ "missing": true }));
    assert_eq!(ok(&k, "mirrorPaths", json!({ "provider": "dropbox" })).await, json!({ "paths": ["notes/A.fnote"] }));
    assert_eq!(ok(&k, "mirrorLoadState", json!({ "provider": "dropbox" })).await, json!({ "state": null }));
    ok(&k, "mirrorSaveState", json!({ "provider": "dropbox", "state": "{}" })).await;
    assert_eq!(ok(&k, "mirrorLoadState", json!({ "provider": "dropbox" })).await, json!({ "state": "{}" }));
    // An attachment from the copy here.
    let sha = hex::encode(sha2::Sha256::digest(b"pic"));
    ok(&k, "mirrorWrite", json!({ "provider": "dropbox", "path": format!("files/{}/{sha}", &sha[..2]), "data": b64(b"pic"), "etag": "r" })).await;
    assert_eq!(k.s.attachment(&sha).await.unwrap(), Some((b"pic".to_vec(), None)));
    assert_eq!(ok(&k, "cloudStatus", json!({})).await, json!({ "available": [], "provider": null, "state": "none", "account": null }));
    assert_eq!(call(&k, "cloudConnect", json!({ "provider": "dropbox" })).await.unwrap_err().code, "unavailable");
    // Moving it to this PC: the page copies into "device" first, then sets it up there.
    ok(&k, "libWrite", json!({ "root": "device", "path": "notes/A.fnote", "bytes": b64(b"a"), "mode": "any" })).await;
    assert_eq!(ok(&k, "libList", json!({ "root": "device", "dir": "" })).await["entries"][0]["path"], json!("notes/A.fnote"));
    ok(&k, "libSetup", json!({ "kind": "device" })).await;
    assert_eq!(list(&k, "").await, vec![LIBRARY_FILE.to_string(), "notes/A.fnote".to_string()]);
}

#[tokio::test]
async fn forgetting_keeps_the_folder_and_drops_this_pcs_journal() {
    let k = make();
    ok(&k, "libSetup", json!({ "kind": "device" })).await;
    write(&k, &format!("notes/{DOC}.fnote"), b"n").await;
    ok(&k, "journalAppend", json!({ "record": b64(b"r") })).await;
    k.s.forget().await.unwrap();
    assert_eq!(k.s.info().await["configured"], json!(false));
    assert!(!k.user_data.join("library.json").exists());
    assert!(device_location(&k.home).join("notes").join(format!("{DOC}.fnote")).exists());
    let journals = k.user_data.join("library");
    assert!(!journals.exists() || names(&journals).is_empty());
    // Setting the same place up again brings it back.
    ok(&k, "libSetup", json!({ "kind": "device" })).await;
    assert_eq!(read(&k, &format!("notes/{DOC}.fnote")).await, b"n");
}

#[test]
fn library_ids_and_manifests() {
    let id = new_library_id(1_760_000_000_000);
    assert_eq!(id.len(), 26);
    assert_eq!(&id[..10], &new_library_id(1_760_000_000_000)[..10]);
    assert!(decode_manifest(b"{}").is_err());
    assert!(decode_manifest(br#"{"format":"folevi-library","libraryId":"../x","createdAt":1,"minWriterVersion":1}"#).is_err());
    let m = decode_manifest(br#"{"format":"folevi-library","libraryId":"L1","createdAt":1,"minWriterVersion":1,"extra":true}"#).unwrap();
    assert_eq!((m["v"].clone(), m["encryption"].clone(), m["extra"].clone()), (json!(1), Value::Null, json!(true)));
    assert!(encode_manifest(&m).ends_with(b"}\n"));
    assert!(is_plain_attachment_path("files/9f/9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"));
    assert!(!is_plain_attachment_path("files/9f/abc"));
}

#[tokio::test]
async fn calls_wait_for_the_launch_open_instead_of_finding_it_unopened() {
    let k = make();
    ok(&k, "libSetup", json!({ "kind": "device" })).await;
    let sha = hex::encode(sha2::Sha256::digest(b"picture"));
    write(&k, &format!("files/{}/{sha}", &sha[..2]), b"picture").await;
    k.s.dispose();

    // The next launch opens in the background; calls made meanwhile see the library as configured.
    let again = make_with(Some(k.home.clone()), Some(k.user_data.clone()), None);
    assert!(!again.s.is_ready());
    let s2 = again.s.clone();
    let opening = tokio::spawn(async move { s2.open().await });
    let (info, file) = tokio::join!(again.s.info(), again.s.attachment(&sha));
    assert_eq!((info["configured"].clone(), info["available"].clone()), (json!(true), json!(true)));
    assert_eq!(file.unwrap(), Some((b"picture".to_vec(), None)));
    opening.await.unwrap();
    assert!(again.s.is_ready());

    // An attachment asked for before anything opened the library opens it itself.
    let third = make_with(Some(k.home.clone()), Some(k.user_data.clone()), None);
    assert_eq!(third.s.attachment(&sha).await.unwrap(), Some((b"picture".to_vec(), None)));
    assert!(third.s.is_ready());
    again.s.dispose();
    third.s.dispose();
}
