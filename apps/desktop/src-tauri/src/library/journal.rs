//! The native journal (docs/LOCAL_MODE_PLAN.md §3.6, `shell.library.journal`): every local edit is appended here,
//! flushed to disk, before the page calls it saved, so an edit survives the app stopping before the note file is
//! written. It lives in the app's data folder, never in the library (a sync app must not see it).
//!
//! The file is the Mac's and the iPhone's format: "FLVJ" 0x01, then frames of u32 BE length ‖ u32 BE CRC-32 ‖ the
//! record. A torn last frame (the app stopped mid-append) fails its length or CRC: reading stops there, and the
//! next append first cuts the file back to the last whole frame, so nothing after a tear is ever lost behind it.
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use super::fs::{fsync_dir, rename_retry};
use crate::shell::ShellError;

const MAGIC: &[u8; 5] = &[0x46, 0x4c, 0x56, 0x4a, 0x01];
const FRAME_HEADER: usize = 8;
/// The largest record the journal takes (a note delta with a pasted image's text is well under this).
pub const MAX_RECORD: usize = 16 * 1024 * 1024;

static CRC_TABLE: once_cell::sync::Lazy<[u32; 256]> = once_cell::sync::Lazy::new(|| {
    let mut t = [0u32; 256];
    for (n, slot) in t.iter_mut().enumerate() {
        let mut c = n as u32;
        for _ in 0..8 {
            c = if c & 1 != 0 { 0xedb8_8320 ^ (c >> 1) } else { c >> 1 };
        }
        *slot = c;
    }
    t
});

pub fn crc32(bytes: &[u8]) -> u32 {
    let mut c = 0xffff_ffffu32;
    for &b in bytes {
        c = CRC_TABLE[((c ^ b as u32) & 0xff) as usize] ^ (c >> 8);
    }
    c ^ 0xffff_ffff
}

fn frame(record: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(FRAME_HEADER + record.len());
    out.extend_from_slice(&(record.len() as u32).to_be_bytes());
    out.extend_from_slice(&crc32(record).to_be_bytes());
    out.extend_from_slice(record);
    out
}

pub struct Parsed {
    pub records: Vec<Vec<u8>>,
    pub valid_length: usize,
    pub torn: bool,
}

/// The whole frames in a journal file's bytes, and where the last one ends.
pub fn parse_journal(b: &[u8]) -> Parsed {
    if b.is_empty() {
        return Parsed { records: vec![], valid_length: 0, torn: false };
    }
    if b.len() < MAGIC.len() || &b[..MAGIC.len()] != MAGIC {
        return Parsed { records: vec![], valid_length: 0, torn: true };
    }
    let mut records = Vec::new();
    let mut off = MAGIC.len();
    while off < b.len() {
        if b.len() - off < FRAME_HEADER {
            break;
        }
        let len = u32::from_be_bytes(b[off..off + 4].try_into().unwrap()) as usize;
        let crc = u32::from_be_bytes(b[off + 4..off + 8].try_into().unwrap());
        if len > MAX_RECORD || off + FRAME_HEADER + len > b.len() {
            break;
        }
        let rec = &b[off + FRAME_HEADER..off + FRAME_HEADER + len];
        if crc32(rec) != crc {
            break;
        }
        records.push(rec.to_vec());
        off += FRAME_HEADER + len;
    }
    Parsed { records, valid_length: off, torn: off < b.len() }
}

fn read_all_bytes(path: &Path) -> io::Result<Vec<u8>> {
    match File::open(path) {
        Ok(mut f) => {
            let mut b = Vec::new();
            f.read_to_end(&mut b)?;
            Ok(b)
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(e),
    }
}

fn io_err(e: io::Error) -> ShellError {
    ShellError::io(format!("Folevi couldn't use its edit journal ({e})."))
}

/// local-store's `JournalStore`, on disk. One per library; the service runs its calls one at a time.
pub struct FileJournal {
    pub path: PathBuf,
    file: Option<File>,
    /// Where appends go: the end of the last whole frame.
    end: u64,
}

impl FileJournal {
    pub fn new(path: PathBuf) -> Self {
        Self { path, file: None, end: 0 }
    }

    fn handle(&mut self) -> io::Result<&mut File> {
        if self.file.is_none() {
            if let Some(dir) = self.path.parent() {
                fs::create_dir_all(dir)?;
            }
            let parsed = parse_journal(&read_all_bytes(&self.path)?);
            let mut f = OpenOptions::new().read(true).write(true).create(true).truncate(false).open(&self.path)?;
            crate::secrets::restrict(&self.path);
            if parsed.valid_length == 0 {
                f.set_len(0)?;
                f.seek(SeekFrom::Start(0))?;
                f.write_all(MAGIC)?;
                f.sync_all()?;
                if let Some(dir) = self.path.parent() {
                    fsync_dir(dir);
                }
                self.end = MAGIC.len() as u64;
            } else {
                // Cut a torn tail off before anything is appended after it.
                if parsed.torn {
                    f.set_len(parsed.valid_length as u64)?;
                    f.sync_all()?;
                }
                self.end = parsed.valid_length as u64;
            }
            self.file = Some(f);
        }
        Ok(self.file.as_mut().unwrap())
    }

    /// Appends one record and returns once it is on disk.
    pub fn append(&mut self, record: &[u8]) -> Result<(), ShellError> {
        if record.len() > MAX_RECORD {
            return Err(ShellError::invalid("A journal record is at most 16 MB."));
        }
        let f = frame(record);
        let result = (|| -> io::Result<()> {
            let end = {
                self.handle()?;
                self.end
            };
            let file = self.file.as_mut().unwrap();
            file.seek(SeekFrom::Start(end))?;
            file.write_all(&f)?;
            file.sync_data()?;
            Ok(())
        })();
        match result {
            Ok(()) => {
                self.end += f.len() as u64;
                Ok(())
            }
            Err(e) => {
                // Start again from what's on disk next time.
                self.file = None;
                Err(io_err(e))
            }
        }
    }

    /// Every whole record, oldest first (a torn last append is left out).
    pub fn read_all(&mut self) -> Result<Vec<Vec<u8>>, ShellError> {
        Ok(parse_journal(&read_all_bytes(&self.path).map_err(io_err)?).records)
    }

    /// Drops the first `n` records (the library files hold them now): the rest are rewritten atomically.
    pub fn truncate(&mut self, n: usize) -> Result<(), ShellError> {
        if n == 0 {
            return Ok(());
        }
        let records = parse_journal(&read_all_bytes(&self.path).map_err(io_err)?).records;
        let keep = &records[n.min(records.len())..];
        let mut body = MAGIC.to_vec();
        for r in keep {
            body.extend_from_slice(&frame(r));
        }
        let tmp = self.path.with_extension("bin.tmp");
        (|| -> io::Result<()> {
            let mut out = OpenOptions::new().write(true).create(true).truncate(true).open(&tmp)?;
            out.write_all(&body)?;
            out.sync_all()?;
            drop(out);
            // Windows can't rename over a file that's open: close ours first.
            self.file = None;
            rename_retry(&tmp, &self.path)?;
            crate::secrets::restrict(&self.path);
            if let Some(dir) = self.path.parent() {
                fsync_dir(dir);
            }
            Ok(())
        })()
        .map_err(|e| {
            let _ = fs::remove_file(&tmp);
            io_err(e)
        })
    }

    /// Removes the journal (the library was forgotten on this PC).
    pub fn destroy(&mut self) {
        self.file = None;
        let _ = fs::remove_file(&self.path);
    }

    pub fn close(&mut self) {
        self.file = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(r: Vec<Vec<u8>>) -> Vec<String> {
        r.into_iter().map(|b| String::from_utf8(b).unwrap()).collect()
    }

    #[test]
    fn appends_reads_back_in_order_and_survives_reopening() {
        let d = tempfile::tempdir().unwrap();
        let path = d.path().join("j").join("journal.bin");
        let mut j = FileJournal::new(path.clone());
        for r in ["a", "b", "c"] {
            j.append(r.as_bytes()).unwrap();
        }
        assert_eq!(texts(j.read_all().unwrap()), ["a", "b", "c"]);
        j.close();
        let mut again = FileJournal::new(path);
        again.append(b"d").unwrap();
        assert_eq!(texts(again.read_all().unwrap()), ["a", "b", "c", "d"]);
    }

    #[test]
    fn truncate_drops_the_first_n_atomically() {
        let d = tempfile::tempdir().unwrap();
        let mut j = FileJournal::new(d.path().join("journal.bin"));
        for r in ["1", "2", "3", "4"] {
            j.append(r.as_bytes()).unwrap();
        }
        j.truncate(2).unwrap();
        assert_eq!(texts(j.read_all().unwrap()), ["3", "4"]);
        j.append(b"5").unwrap();
        j.truncate(10).unwrap();
        assert!(j.read_all().unwrap().is_empty());
        j.append(b"6").unwrap();
        assert_eq!(texts(j.read_all().unwrap()), ["6"]);
        assert!(!d.path().join("journal.bin.tmp").exists());
    }

    #[test]
    fn a_torn_last_append_is_skipped_and_cut_off_before_the_next() {
        let d = tempfile::tempdir().unwrap();
        let path = d.path().join("journal.bin");
        let mut j = FileJournal::new(path.clone());
        for r in ["one", "two", "three"] {
            j.append(r.as_bytes()).unwrap();
        }
        j.close();
        // The app stopped half way through writing "three".
        let full = fs::metadata(&path).unwrap().len();
        OpenOptions::new().write(true).open(&path).unwrap().set_len(full - 2).unwrap();
        let mut k = FileJournal::new(path);
        assert_eq!(texts(k.read_all().unwrap()), ["one", "two"]);
        k.append(b"four").unwrap();
        assert_eq!(texts(k.read_all().unwrap()), ["one", "two", "four"]);
    }

    #[test]
    fn garbage_or_a_damaged_record_ends_the_readable_part() {
        let d = tempfile::tempdir().unwrap();
        let path = d.path().join("journal.bin");
        let mut j = FileJournal::new(path.clone());
        for r in ["one", "two"] {
            j.append(r.as_bytes()).unwrap();
        }
        j.close();
        let mut b = fs::read(&path).unwrap();
        b.extend_from_slice(&[0, 0, 0, 3, 1, 2, 3, 4, 120, 121, 122]);
        let p = parse_journal(&b);
        assert_eq!(texts(p.records), ["one", "two"]);
        assert!(p.torn);
        // A flipped byte inside "one": its CRC fails and nothing after it is trusted.
        b[5 + 8] ^= 0xff;
        assert!(parse_journal(&b).records.is_empty());
        assert_eq!(crc32(b"123456789"), 0xcbf4_3926);
        // A file that isn't a journal reads as empty and is started over.
        fs::write(&path, b"nonsense").unwrap();
        let mut k = FileJournal::new(path);
        assert!(k.read_all().unwrap().is_empty());
        k.append(b"x").unwrap();
        assert_eq!(texts(k.read_all().unwrap()), ["x"]);
    }

    #[test]
    fn every_acknowledged_append_is_on_disk_for_another_reader() {
        // What a new process would see right after each append returned.
        let d = tempfile::tempdir().unwrap();
        let path = d.path().join("journal.bin");
        let mut j = FileJournal::new(path.clone());
        for i in 0..200 {
            j.append(format!("record {i}").as_bytes()).unwrap();
            let seen = parse_journal(&fs::read(&path).unwrap());
            assert_eq!(seen.records.len(), i + 1);
            assert!(!seen.torn);
        }
        assert!(j.append(&vec![0u8; MAX_RECORD + 1]).is_err());
    }
}
