//! Managed local attachment storage for receipts and retained import sources.
//! Bytes live under `{app_data}/attachments/{storage_key}`; SQLite holds metadata only.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, State};
use uuid::Uuid;

pub const MAX_ATTACHMENT_BYTES: usize = 10 * 1024 * 1024;
pub const ATTACHMENTS_DIR_NAME: &str = "attachments";

const ALLOWED_EXTENSIONS: &[&str] = &[
    "pdf", "png", "jpg", "jpeg", "tif", "tiff", "webp", "xls", "xlsx", "csv", "tsv", "txt", "ofx", "qfx", "qif", "xml",
];

#[derive(Clone)]
pub struct AttachmentStore {
    root: PathBuf,
}

impl AttachmentStore {
    pub fn new(data_dir: &Path) -> Result<Self, String> {
        Self::from_root(data_dir.join(ATTACHMENTS_DIR_NAME))
    }

    pub fn from_root(root: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn path_for_key(&self, storage_key: &str) -> Result<PathBuf, String> {
        let key = validate_storage_key(storage_key)?;
        Ok(self.root.join(key))
    }
}

pub struct AttachmentState(pub Mutex<AttachmentStore>);

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentRecord {
    pub id: String,
    pub storage_key: String,
    pub original_filename: String,
    pub media_type: String,
    pub byte_size: i64,
    pub sha256_hex: String,
    pub source_kind: String,
    pub created_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachBytesRequest {
    pub transaction_id: String,
    pub original_filename: String,
    pub media_type: Option<String>,
    pub content_base64: String,
    #[serde(default)]
    pub source_kind: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RetainImportSourceRequest {
    pub import_batch_id: String,
    pub transaction_ids: Vec<String>,
    pub original_filename: String,
    pub media_type: Option<String>,
    pub content_base64: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupAttachmentPayload {
    pub storage_key: String,
    pub sha256_hex: String,
    pub byte_size: i64,
    pub content_base64: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerBackupPackage {
    pub kind: String,
    pub version: u32,
    pub database_base64: String,
    pub attachments: Vec<BackupAttachmentPayload>,
}

pub const LEDGER_PACKAGE_KIND: &str = "homeledger-ledger-package";
pub const LEDGER_PACKAGE_VERSION: u32 = 1;

fn validate_storage_key(value: &str) -> Result<&str, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > 80 {
        return Err("Attachment storage key is invalid".into());
    }
    if trimmed.contains('/') || trimmed.contains('\\') || trimmed.contains("..") {
        return Err("Attachment storage key is unsafe".into());
    }
    if !trimmed.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_') {
        return Err("Attachment storage key is invalid".into());
    }
    Ok(trimmed)
}

fn sanitize_original_filename(value: &str) -> Result<String, String> {
    let name = value.trim().replace(['\\', '/'], "_");
    let name = name.trim_matches('.').trim().to_string();
    if name.is_empty() {
        return Err("Original filename is required".into());
    }
    if name.chars().count() > 260 {
        return Err("Original filename is too long".into());
    }
    if name.contains('\0') {
        return Err("Original filename is invalid".into());
    }
    Ok(name)
}

fn extension_of(filename: &str) -> String {
    Path::new(filename)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn infer_media_type(filename: &str, provided: Option<&str>) -> Result<String, String> {
    if let Some(value) = provided.map(str::trim).filter(|v| !v.is_empty()) {
        if value.chars().count() > 120 {
            return Err("Media type is too long".into());
        }
        return Ok(value.to_string());
    }
    Ok(match extension_of(filename).as_str() {
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "tif" | "tiff" => "image/tiff",
        "webp" => "image/webp",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "csv" => "text/csv",
        "tsv" => "text/tab-separated-values",
        "txt" => "text/plain",
        "ofx" | "qfx" => "application/x-ofx",
        "qif" => "application/qif",
        "xml" => "application/xml",
        _ => "application/octet-stream",
    }
    .into())
}

fn validate_supported_type(filename: &str, bytes: &[u8]) -> Result<(), String> {
    let ext = extension_of(filename);
    if !ALLOWED_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!("Unsupported attachment type .{ext}"));
    }
    // Fail closed on obvious signature mismatches for common binary types.
    match ext.as_str() {
        "png" if !(bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A])) => {
            return Err("PNG attachment content does not match its type".into());
        }
        "jpg" | "jpeg" if !(bytes.starts_with(&[0xFF, 0xD8, 0xFF])) => {
            return Err("JPEG attachment content does not match its type".into());
        }
        "pdf" if !(bytes.starts_with(b"%PDF")) => {
            return Err("PDF attachment content does not match its type".into());
        }
        "xlsx" | "xls" if ext == "xlsx" && !(bytes.starts_with(&[0x50, 0x4B])) => {
            return Err("Excel attachment content does not match its type".into());
        }
        _ => {}
    }
    Ok(())
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

fn decode_content(content_base64: &str) -> Result<Vec<u8>, String> {
    let bytes = BASE64.decode(content_base64.trim()).map_err(|_| "Attachment content is not valid base64".to_string())?;
    if bytes.is_empty() {
        return Err("Attachment content is empty".into());
    }
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err("Attachment exceeds the 10 MB size limit".into());
    }
    Ok(bytes)
}

fn write_bytes_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let temp = path.with_extension(format!("tmp-{}", Uuid::new_v4()));
    std::fs::write(&temp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&temp, path).map_err(|e| {
        let _ = std::fs::remove_file(&temp);
        e.to_string()
    })?;
    Ok(())
}

fn load_attachment(connection: &Connection, attachment_id: &str) -> Result<AttachmentRecord, String> {
    connection
        .query_row(
            "SELECT id, storage_key, original_filename, media_type, byte_size, sha256_hex, source_kind, created_at FROM attachments WHERE id = ?1",
            params![attachment_id],
            |row| {
                Ok(AttachmentRecord {
                    id: row.get(0)?,
                    storage_key: row.get(1)?,
                    original_filename: row.get(2)?,
                    media_type: row.get(3)?,
                    byte_size: row.get(4)?,
                    sha256_hex: row.get(5)?,
                    source_kind: row.get(6)?,
                    created_at: row.get(7)?,
                })
            },
        )
        .map_err(|_| "Attachment does not exist".to_string())
}

fn attachment_reference_count(connection: &Connection, attachment_id: &str) -> Result<i64, String> {
    let txn: i64 = connection
        .query_row("SELECT COUNT(*) FROM transaction_attachments WHERE attachment_id = ?1", params![attachment_id], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let batch: i64 = connection
        .query_row("SELECT COUNT(*) FROM import_batch_attachments WHERE attachment_id = ?1", params![attachment_id], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    Ok(txn + batch)
}

fn delete_attachment_if_unreferenced(connection: &Connection, store: &AttachmentStore, attachment_id: &str) -> Result<bool, String> {
    if attachment_reference_count(connection, attachment_id)? > 0 {
        return Ok(false);
    }
    let record = load_attachment(connection, attachment_id)?;
    connection
        .execute("DELETE FROM attachments WHERE id = ?1", params![attachment_id])
        .map_err(|e| e.to_string())?;
    let path = store.path_for_key(&record.storage_key)?;
    let _ = std::fs::remove_file(path);
    Ok(true)
}

fn find_attachment_by_hash(connection: &Connection, sha256_hex: &str) -> Result<Option<AttachmentRecord>, String> {
    connection
        .query_row(
            "SELECT id, storage_key, original_filename, media_type, byte_size, sha256_hex, source_kind, created_at FROM attachments WHERE sha256_hex = ?1 LIMIT 1",
            params![sha256_hex],
            |row| {
                Ok(AttachmentRecord {
                    id: row.get(0)?,
                    storage_key: row.get(1)?,
                    original_filename: row.get(2)?,
                    media_type: row.get(3)?,
                    byte_size: row.get(4)?,
                    sha256_hex: row.get(5)?,
                    source_kind: row.get(6)?,
                    created_at: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())
}

fn insert_attachment_bytes(
    connection: &Connection,
    store: &AttachmentStore,
    original_filename: String,
    media_type: Option<String>,
    content_base64: &str,
    source_kind: &str,
) -> Result<AttachmentWriteOutcome, String> {
    let filename = sanitize_original_filename(&original_filename)?;
    let bytes = decode_content(content_base64)?;
    validate_supported_type(&filename, &bytes)?;
    let media = infer_media_type(&filename, media_type.as_deref())?;
    let hash = sha256_hex(&bytes);
    if let Some(existing) = find_attachment_by_hash(connection, &hash)? {
        // Reuse physical object; never rewrite or delete shared bytes.
        return Ok(AttachmentWriteOutcome {
            record: existing,
            created_new_file: false,
            path: None,
        });
    }
    let id = Uuid::new_v4().to_string();
    let storage_key = id.clone();
    let path = store.path_for_key(&storage_key)?;
    write_bytes_atomic(&path, &bytes)?;
    let inserted = connection.execute(
        "INSERT INTO attachments(id, storage_key, original_filename, media_type, byte_size, sha256_hex, source_kind) VALUES(?1,?2,?3,?4,?5,?6,?7)",
        params![id, storage_key, filename, media, bytes.len() as i64, hash, source_kind],
    );
    if let Err(error) = inserted {
        let _ = std::fs::remove_file(&path);
        return Err(error.to_string());
    }
    let record = load_attachment(connection, &id)?;
    Ok(AttachmentWriteOutcome {
        record,
        created_new_file: true,
        path: Some(path),
    })
}

/// Result of staging attachment bytes. Only `created_new_file` paths may be deleted on rollback.
pub struct AttachmentWriteOutcome {
    pub record: AttachmentRecord,
    pub created_new_file: bool,
    pub path: Option<PathBuf>,
}

// Test-only force-fail hook. Thread-local so parallel cargo tests cannot leak the flag across threads.
#[cfg(test)]
thread_local! {
    static FAIL_IMPORT_RETENTION_AFTER_ATTACHMENT: std::cell::Cell<bool> =
        const { std::cell::Cell::new(false) };
}

#[cfg(test)]
struct ForceImportRetentionFailGuard;

#[cfg(test)]
impl ForceImportRetentionFailGuard {
    fn enable() -> Self {
        FAIL_IMPORT_RETENTION_AFTER_ATTACHMENT.with(|flag| flag.set(true));
        Self
    }
}

#[cfg(test)]
impl Drop for ForceImportRetentionFailGuard {
    fn drop(&mut self) {
        FAIL_IMPORT_RETENTION_AFTER_ATTACHMENT.with(|flag| flag.set(false));
    }
}

fn maybe_fail_after_attachment_before_links() -> Result<(), String> {
    #[cfg(test)]
    {
        if FAIL_IMPORT_RETENTION_AFTER_ATTACHMENT.with(|flag| flag.get()) {
            return Err("forced post-attachment linking failure".into());
        }
    }
    Ok(())
}

/// Link an attachment to an import batch and its transactions. Caller owns the SQLite transaction.
pub fn link_attachment_to_import_batch(
    connection: &Connection,
    batch_id: &str,
    transaction_ids: &[String],
    attachment_id: &str,
) -> Result<(), String> {
    connection
        .execute(
            "INSERT OR IGNORE INTO import_batch_attachments(import_batch_id, attachment_id) VALUES(?1, ?2)",
            params![batch_id, attachment_id],
        )
        .map_err(|e| e.to_string())?;
    for transaction_id in transaction_ids {
        connection
            .execute(
                "INSERT OR IGNORE INTO transaction_attachments(transaction_id, attachment_id) VALUES(?1, ?2)",
                params![transaction_id, attachment_id],
            )
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Stage + link retained import source inside the caller's open transaction.
/// On error, the caller must roll back the SQLite transaction and delete `outcome.path`
/// only when `outcome.created_new_file` is true (never delete a pre-existing shared file).
pub fn retain_import_source_in_transaction(
    connection: &Connection,
    store: &AttachmentStore,
    batch_id: &str,
    transaction_ids: &[String],
    original_filename: String,
    media_type: Option<String>,
    content_base64: &str,
) -> Result<AttachmentWriteOutcome, String> {
    if transaction_ids.is_empty() {
        return Err("Select at least one imported transaction".into());
    }
    for transaction_id in transaction_ids {
        let linked: Option<i64> = connection
            .query_row(
                "SELECT 1 FROM transactions WHERE id = ?1 AND import_batch_id = ?2",
                params![transaction_id, batch_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if linked.is_none() {
            return Err("A selected transaction does not belong to this import batch".into());
        }
    }
    let outcome = insert_attachment_bytes(
        connection,
        store,
        original_filename,
        media_type,
        content_base64,
        "import_retention",
    )?;
    let finish = (|| {
        maybe_fail_after_attachment_before_links()?;
        link_attachment_to_import_batch(connection, batch_id, transaction_ids, &outcome.record.id)?;
        Ok(())
    })();
    if let Err(error) = finish {
        // Roll back only bytes we just created. Never delete a pre-existing shared object.
        if outcome.created_new_file {
            if let Some(path) = &outcome.path {
                let _ = std::fs::remove_file(path);
            }
        }
        return Err(error);
    }
    Ok(outcome)
}

pub fn list_transaction_attachments_inner(connection: &Connection, transaction_id: &str) -> Result<Vec<AttachmentRecord>, String> {
    let exists: Option<i64> = connection
        .query_row("SELECT 1 FROM transactions WHERE id = ?1", params![transaction_id], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    if exists.is_none() {
        return Err("Transaction does not exist".into());
    }
    let mut statement = connection
        .prepare(
            "SELECT a.id, a.storage_key, a.original_filename, a.media_type, a.byte_size, a.sha256_hex, a.source_kind, a.created_at
             FROM attachments a
             JOIN transaction_attachments link ON link.attachment_id = a.id
             WHERE link.transaction_id = ?1
             ORDER BY link.attached_at, a.id",
        )
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map(params![transaction_id], |row| {
            Ok(AttachmentRecord {
                id: row.get(0)?,
                storage_key: row.get(1)?,
                original_filename: row.get(2)?,
                media_type: row.get(3)?,
                byte_size: row.get(4)?,
                sha256_hex: row.get(5)?,
                source_kind: row.get(6)?,
                created_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn attach_bytes_to_transaction_inner(
    connection: &mut Connection,
    store: &AttachmentStore,
    request: AttachBytesRequest,
) -> Result<AttachmentRecord, String> {
    let transaction_id = request.transaction_id.trim().to_string();
    if transaction_id.is_empty() {
        return Err("Transaction is required".into());
    }
    let exists: Option<i64> = connection
        .query_row("SELECT 1 FROM transactions WHERE id = ?1", params![transaction_id], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    if exists.is_none() {
        return Err("Transaction does not exist".into());
    }
    let source_kind = match request.source_kind.as_deref().unwrap_or("manual") {
        "manual" => "manual",
        "import_retention" => "import_retention",
        _ => return Err("Unsupported attachment source".into()),
    };
    let tx = connection.transaction().map_err(|e| e.to_string())?;
    let outcome = insert_attachment_bytes(
        &tx,
        store,
        request.original_filename,
        request.media_type,
        &request.content_base64,
        source_kind,
    )?;
    let link_result = tx.execute(
        "INSERT OR IGNORE INTO transaction_attachments(transaction_id, attachment_id) VALUES(?1, ?2)",
        params![transaction_id, outcome.record.id],
    );
    if let Err(error) = link_result {
        if outcome.created_new_file {
            if let Some(path) = &outcome.path {
                let _ = std::fs::remove_file(path);
            }
        }
        return Err(error.to_string());
    }
    if let Err(error) = tx.commit() {
        if outcome.created_new_file {
            if let Some(path) = &outcome.path {
                let _ = std::fs::remove_file(path);
            }
        }
        return Err(error.to_string());
    }
    Ok(outcome.record)
}

pub fn detach_transaction_attachment_inner(
    connection: &mut Connection,
    store: &AttachmentStore,
    transaction_id: &str,
    attachment_id: &str,
) -> Result<(), String> {
    let removed = connection
        .execute(
            "DELETE FROM transaction_attachments WHERE transaction_id = ?1 AND attachment_id = ?2",
            params![transaction_id, attachment_id],
        )
        .map_err(|e| e.to_string())?;
    if removed == 0 {
        return Err("Attachment is not linked to this transaction".into());
    }
    let _ = delete_attachment_if_unreferenced(connection, store, attachment_id)?;
    Ok(())
}

pub fn retain_import_source_inner(
    connection: &mut Connection,
    store: &AttachmentStore,
    request: RetainImportSourceRequest,
) -> Result<AttachmentRecord, String> {
    let batch_id = request.import_batch_id.trim().to_string();
    if batch_id.is_empty() {
        return Err("Import batch is required".into());
    }
    let batch_ok: Option<i64> = connection
        .query_row("SELECT 1 FROM import_batches WHERE id = ?1 AND undone_at IS NULL", params![batch_id], |r| r.get(0))
        .optional()
        .map_err(|e| e.to_string())?;
    if batch_ok.is_none() {
        return Err("Import batch does not exist".into());
    }
    let tx = connection.transaction().map_err(|e| e.to_string())?;
    let outcome = match retain_import_source_in_transaction(
        &tx,
        store,
        &batch_id,
        &request.transaction_ids,
        request.original_filename,
        request.media_type,
        &request.content_base64,
    ) {
        Ok(value) => value,
        Err(error) => {
            drop(tx);
            // SQLite rolled back on drop; remove only a newly created file.
            // (outcome unavailable on Err — retain_import_source_in_transaction cleans nothing for shared.)
            return Err(error);
        }
    };
    if let Err(error) = tx.commit() {
        if outcome.created_new_file {
            if let Some(path) = &outcome.path {
                let _ = std::fs::remove_file(path);
            }
        }
        return Err(error.to_string());
    }
    Ok(outcome.record)
}

pub fn open_attachment_inner(connection: &Connection, store: &AttachmentStore, attachment_id: &str) -> Result<(), String> {
    let record = load_attachment(connection, attachment_id)?;
    let path = store.path_for_key(&record.storage_key)?;
    if !path.exists() {
        return Err("Attachment file is missing from managed storage".into());
    }
    // Absolute managed path only — never shell-interpolate untrusted names.
    open_path(&path)
}

fn open_path(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .arg("/C")
            .arg("start")
            .arg("")
            .arg(path.as_os_str())
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(path.as_os_str()).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open").arg(path.as_os_str()).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn garbage_collect_unreferenced_attachments(
    connection: &mut Connection,
    store: &AttachmentStore,
) -> Result<usize, String> {
    let ids: Vec<String> = {
        let mut statement = connection
            .prepare(
                "SELECT id FROM attachments a
                 WHERE NOT EXISTS (SELECT 1 FROM transaction_attachments t WHERE t.attachment_id = a.id)
                   AND NOT EXISTS (SELECT 1 FROM import_batch_attachments b WHERE b.attachment_id = a.id)",
            )
            .map_err(|e| e.to_string())?;
        let rows = statement.query_map([], |row| row.get(0)).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    };
    let mut removed = 0usize;
    for attachment_id in ids {
        if delete_attachment_if_unreferenced(connection, store, &attachment_id)? {
            removed += 1;
        }
    }
    Ok(removed)
}

pub fn cleanup_import_batch_attachments_inner(connection: &mut Connection, store: &AttachmentStore, batch_id: &str) -> Result<(), String> {
    let ids: Vec<String> = {
        let mut statement = connection
            .prepare("SELECT attachment_id FROM import_batch_attachments WHERE import_batch_id = ?1")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map(params![batch_id], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    };
    connection
        .execute("DELETE FROM import_batch_attachments WHERE import_batch_id = ?1", params![batch_id])
        .map_err(|e| e.to_string())?;
    for attachment_id in ids {
        let _ = delete_attachment_if_unreferenced(connection, store, &attachment_id)?;
    }
    Ok(())
}

pub fn collect_backup_attachments(connection: &Connection, store: &AttachmentStore) -> Result<Vec<BackupAttachmentPayload>, String> {
    let mut statement = connection
        .prepare("SELECT storage_key, sha256_hex, byte_size FROM attachments ORDER BY id")
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?)))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        let (storage_key, sha, size) = row.map_err(|e| e.to_string())?;
        let path = store.path_for_key(&storage_key)?;
        let bytes = std::fs::read(&path).map_err(|_| format!("Attachment file missing for storage key {storage_key}"))?;
        if bytes.len() as i64 != size {
            return Err(format!("Attachment size mismatch for {storage_key}"));
        }
        if sha256_hex(&bytes) != sha {
            return Err(format!("Attachment hash mismatch for {storage_key}"));
        }
        out.push(BackupAttachmentPayload {
            storage_key,
            sha256_hex: sha,
            byte_size: size,
            content_base64: BASE64.encode(bytes),
        });
    }
    Ok(out)
}

pub fn restore_attachment_payloads(store: &AttachmentStore, attachments: &[BackupAttachmentPayload]) -> Result<(), String> {
    // Replace managed store contents with restored payloads.
    if store.root().exists() {
        std::fs::remove_dir_all(store.root()).map_err(|e| e.to_string())?;
    }
    std::fs::create_dir_all(store.root()).map_err(|e| e.to_string())?;
    for item in attachments {
        validate_storage_key(&item.storage_key)?;
        let bytes = decode_content(&item.content_base64)?;
        if bytes.len() as i64 != item.byte_size {
            return Err(format!("Restored attachment size mismatch for {}", item.storage_key));
        }
        if sha256_hex(&bytes) != item.sha256_hex {
            return Err(format!("Restored attachment hash mismatch for {}", item.storage_key));
        }
        let path = store.path_for_key(&item.storage_key)?;
        write_bytes_atomic(&path, &bytes)?;
    }
    Ok(())
}

pub fn validate_live_attachment_consistency(connection: &Connection, store: &AttachmentStore) -> Result<(), String> {
    let mut statement = connection
        .prepare("SELECT storage_key, sha256_hex, byte_size FROM attachments")
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?)))
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (storage_key, sha, size) = row.map_err(|e| e.to_string())?;
        let path = store.path_for_key(&storage_key)?;
        if !path.exists() {
            return Err(format!("Managed attachment file missing for {storage_key}"));
        }
        let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
        if bytes.len() as i64 != size || sha256_hex(&bytes) != sha {
            return Err(format!("Managed attachment integrity failed for {storage_key}"));
        }
    }
    Ok(())
}

pub fn build_ledger_package(database_bytes: &[u8], attachments: Vec<BackupAttachmentPayload>) -> Result<Vec<u8>, String> {
    let package = LedgerBackupPackage {
        kind: LEDGER_PACKAGE_KIND.into(),
        version: LEDGER_PACKAGE_VERSION,
        database_base64: BASE64.encode(database_bytes),
        attachments,
    };
    serde_json::to_vec(&package).map_err(|e| e.to_string())
}

pub fn parse_ledger_package(bytes: &[u8]) -> Result<Option<LedgerBackupPackage>, String> {
    if !bytes.starts_with(b"{") {
        return Ok(None);
    }
    let package: LedgerBackupPackage = serde_json::from_slice(bytes).map_err(|_| "The backup package is invalid".to_string())?;
    if package.kind != LEDGER_PACKAGE_KIND || package.version != LEDGER_PACKAGE_VERSION {
        return Err("Unsupported HomeLedger backup package version".into());
    }
    Ok(Some(package))
}

// --- Tauri commands ---

#[tauri::command]
pub fn list_transaction_attachments(
    transaction_id: String,
    state: State<'_, crate::DbState>,
) -> Result<Vec<AttachmentRecord>, String> {
    let connection = state.0.lock().map_err(|_| "Database lock failed".to_string())?;
    list_transaction_attachments_inner(&connection, transaction_id.trim())
}

#[tauri::command]
pub fn attach_bytes_to_transaction(
    request: AttachBytesRequest,
    state: State<'_, crate::DbState>,
    attachments: State<'_, AttachmentState>,
) -> Result<AttachmentRecord, String> {
    let mut connection = state.0.lock().map_err(|_| "Database lock failed".to_string())?;
    let store = attachments.0.lock().map_err(|_| "Attachment store lock failed".to_string())?;
    attach_bytes_to_transaction_inner(&mut connection, &store, request)
}

#[tauri::command]
pub fn detach_transaction_attachment(
    transaction_id: String,
    attachment_id: String,
    state: State<'_, crate::DbState>,
    attachments: State<'_, AttachmentState>,
) -> Result<(), String> {
    let mut connection = state.0.lock().map_err(|_| "Database lock failed".to_string())?;
    let store = attachments.0.lock().map_err(|_| "Attachment store lock failed".to_string())?;
    detach_transaction_attachment_inner(&mut connection, &store, transaction_id.trim(), attachment_id.trim())
}

#[tauri::command]
pub fn open_attachment(
    attachment_id: String,
    state: State<'_, crate::DbState>,
    attachments: State<'_, AttachmentState>,
) -> Result<(), String> {
    let connection = state.0.lock().map_err(|_| "Database lock failed".to_string())?;
    let store = attachments.0.lock().map_err(|_| "Attachment store lock failed".to_string())?;
    open_attachment_inner(&connection, &store, attachment_id.trim())
}

#[tauri::command]
pub fn retain_import_source_attachment(
    request: RetainImportSourceRequest,
    state: State<'_, crate::DbState>,
    attachments: State<'_, AttachmentState>,
) -> Result<AttachmentRecord, String> {
    let mut connection = state.0.lock().map_err(|_| "Database lock failed".to_string())?;
    let store = attachments.0.lock().map_err(|_| "Attachment store lock failed".to_string())?;
    retain_import_source_inner(&mut connection, &store, request)
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedAttachmentFile {
    pub original_filename: String,
    pub media_type: Option<String>,
    pub content_base64: String,
}

#[tauri::command]
pub fn pick_and_read_attachment_file(app: AppHandle) -> Result<Option<PickedAttachmentFile>, String> {
    use tauri_plugin_dialog::DialogExt;
    let file = app
        .dialog()
        .file()
        .add_filter("Documents", &["pdf", "png", "jpg", "jpeg", "tif", "tiff", "webp", "xls", "xlsx", "csv", "tsv", "txt", "ofx", "qfx", "qif", "xml"])
        .blocking_pick_file();
    let Some(path) = file else { return Ok(None) };
    let path = path.into_path().map_err(|e| e.to_string())?;
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err("Attachment exceeds the 10 MB size limit".into());
    }
    let original_filename = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("attachment.bin")
        .to_string();
    validate_supported_type(&original_filename, &bytes)?;
    Ok(Some(PickedAttachmentFile {
        original_filename,
        media_type: None,
        content_base64: BASE64.encode(bytes),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::STANDARD as B64;
    use rusqlite::Connection;

    struct TempStore {
        root: PathBuf,
    }
    impl TempStore {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("hl-att-{}", Uuid::new_v4()));
            std::fs::create_dir_all(&root).unwrap();
            Self { root }
        }
        fn path(&self) -> &Path {
            &self.root
        }
    }
    impl Drop for TempStore {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn png_bytes() -> Vec<u8> {
        let mut bytes = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
        bytes.extend_from_slice(b"homeledger-attachment-fixture");
        bytes
    }

    fn pdf_bytes() -> Vec<u8> {
        let mut bytes = b"%PDF-1.4\n".to_vec();
        bytes.extend_from_slice(b"% HomeLedger fixture\n");
        bytes
    }

    fn setup() -> (TempStore, Connection, AttachmentStore, String) {
        let dir = TempStore::new();
        let mut connection = Connection::open_in_memory().unwrap();
        crate::apply_migrations(&mut connection).unwrap();
        connection
            .execute(
                "INSERT INTO accounts(id, name, account_type, currency, opening_balance_minor, owner_label) VALUES('a', 'Checking', 'checking', 'USD', 10000, 'Household')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO transactions(id, account_id, posted_date, payee, category, amount_minor, status, source) VALUES('t1', 'a', '2026-09-01', 'Store', 'Shopping', -2500, 'cleared', 'manual')",
                [],
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO transactions(id, account_id, posted_date, payee, category, amount_minor, status, source) VALUES('t2', 'a', '2026-09-02', 'Cafe', 'Food', -800, 'reconciled', 'manual')",
                [],
            )
            .unwrap();
        let store = AttachmentStore::new(dir.path()).unwrap();
        (dir, connection, store, "t1".into())
    }

    #[test]
    fn migration_creates_attachment_tables() {
        let mut connection = Connection::open_in_memory().unwrap();
        crate::apply_migrations(&mut connection).unwrap();
        let tables: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('attachments','transaction_attachments','import_batch_attachments')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(tables, 3);
        let version: i64 = connection
            .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, 21);
    }

    #[test]
    fn storage_uses_opaque_key_not_original_filename() {
        let (_dir, mut connection, store, txn) = setup();
        let content = B64.encode(png_bytes());
        let attached = attach_bytes_to_transaction_inner(
            &mut connection,
            &store,
            AttachBytesRequest {
                transaction_id: txn,
                original_filename: "Receipt From Store.png".into(),
                media_type: None,
                content_base64: content,
                source_kind: Some("manual".into()),
            },
        )
        .unwrap();
        assert_eq!(attached.original_filename, "Receipt From Store.png");
        assert_ne!(attached.storage_key, attached.original_filename);
        assert!(!attached.storage_key.contains('/'));
        assert!(store.path_for_key(&attached.storage_key).unwrap().exists());
        assert_eq!(attached.sha256_hex.len(), 64);
        assert_eq!(attached.byte_size, png_bytes().len() as i64);
    }

    #[test]
    fn path_traversal_storage_key_rejected() {
        let store = AttachmentStore::from_root(std::env::temp_dir().join(format!("hl-att-root-{}", Uuid::new_v4()))).unwrap();
        assert!(store.path_for_key("../escape").is_err());
        assert!(store.path_for_key("a/b").is_err());
        assert!(store.path_for_key("..\\win").is_err());
        let _ = std::fs::remove_dir_all(store.root());
    }

    #[test]
    fn unsupported_and_oversized_rejected() {
        let (_dir, mut connection, store, txn) = setup();
        let exe = B64.encode(b"MZ fake executable");
        let err = attach_bytes_to_transaction_inner(
            &mut connection,
            &store,
            AttachBytesRequest {
                transaction_id: txn.clone(),
                original_filename: "malware.exe".into(),
                media_type: None,
                content_base64: exe,
                source_kind: None,
            },
        )
        .unwrap_err();
        assert!(err.to_lowercase().contains("unsupported"));

        let mut huge = png_bytes();
        huge.resize(MAX_ATTACHMENT_BYTES + 1, 0);
        let err = attach_bytes_to_transaction_inner(
            &mut connection,
            &store,
            AttachBytesRequest {
                transaction_id: txn,
                original_filename: "big.png".into(),
                media_type: None,
                content_base64: B64.encode(huge),
                source_kind: None,
            },
        )
        .unwrap_err();
        assert!(err.to_lowercase().contains("10 mb") || err.to_lowercase().contains("size"));
    }

    #[test]
    fn shared_attachment_lifecycle_and_gc() {
        let (_dir, mut connection, store, _) = setup();
        let content = B64.encode(pdf_bytes());
        let a = attach_bytes_to_transaction_inner(
            &mut connection,
            &store,
            AttachBytesRequest {
                transaction_id: "t1".into(),
                original_filename: "shared.pdf".into(),
                media_type: None,
                content_base64: content.clone(),
                source_kind: None,
            },
        )
        .unwrap();
        let b = attach_bytes_to_transaction_inner(
            &mut connection,
            &store,
            AttachBytesRequest {
                transaction_id: "t2".into(),
                original_filename: "shared.pdf".into(),
                media_type: None,
                content_base64: content,
                source_kind: None,
            },
        )
        .unwrap();
        assert_eq!(a.id, b.id);
        let path = store.path_for_key(&a.storage_key).unwrap();
        assert!(path.exists());

        detach_transaction_attachment_inner(&mut connection, &store, "t1", &a.id).unwrap();
        assert!(path.exists());
        let still = list_transaction_attachments_inner(&connection, "t2").unwrap();
        assert_eq!(still.len(), 1);

        detach_transaction_attachment_inner(&mut connection, &store, "t2", &a.id).unwrap();
        assert!(!path.exists());
        let count: i64 = connection
            .query_row("SELECT COUNT(*) FROM attachments", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn attachment_does_not_mutate_accounting_fields() {
        let (_dir, mut connection, store, _) = setup();
        let before: (i64, String, String, i64) = connection
            .query_row(
                "SELECT amount_minor, category, payee, (SELECT COUNT(*) FROM transactions) FROM transactions WHERE id='t2'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        attach_bytes_to_transaction_inner(
            &mut connection,
            &store,
            AttachBytesRequest {
                transaction_id: "t2".into(),
                original_filename: "receipt.png".into(),
                media_type: None,
                content_base64: B64.encode(png_bytes()),
                source_kind: None,
            },
        )
        .unwrap();
        let after: (i64, String, String, i64) = connection
            .query_row(
                "SELECT amount_minor, category, payee, (SELECT COUNT(*) FROM transactions) FROM transactions WHERE id='t2'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(before, after);
        assert_eq!(
            connection
                .query_row("SELECT status FROM transactions WHERE id='t2'", [], |row| row.get::<_, String>(0))
                .unwrap(),
            "reconciled"
        );
    }

    #[test]
    fn import_retention_dedupes_and_undo_cleans() {
        let (_dir, mut connection, store, _) = setup();
        let content = B64.encode(pdf_bytes());
        let imported = crate::import_transactions_inner(
            &mut connection,
            Some(&store),
            crate::ImportTransactionsRequest {
                account_id: "a".into(),
                source_name: "statement.pdf".into(),
                rows: vec![
                    crate::ImportTransactionRow {
                        posted_date: "2026-09-10".into(),
                        payee: "Utility".into(),
                        original_payee: None,
                        amount_minor: -4500,
                        memo: None,
                        external_id: Some("ext-1".into()),
                        category: None,
                        splits: None,
                        scheduled_occurrence_id: None,
                    },
                    crate::ImportTransactionRow {
                        posted_date: "2026-09-11".into(),
                        payee: "Grocery".into(),
                        original_payee: None,
                        amount_minor: -1200,
                        memo: None,
                        external_id: Some("ext-2".into()),
                        category: None,
                        splits: None,
                        scheduled_occurrence_id: None,
                    },
                ],
                retain_source: Some(crate::ImportSourceRetention {
                    original_filename: "statement.pdf".into(),
                    media_type: None,
                    content_base64: content,
                }),
            },
        )
        .unwrap();
        let files: usize = std::fs::read_dir(store.root()).unwrap().count();
        assert_eq!(files, 1);
        for id in &imported.transaction_ids {
            assert_eq!(list_transaction_attachments_inner(&connection, id).unwrap().len(), 1);
        }
        let attachment_id: String = connection
            .query_row("SELECT attachment_id FROM import_batch_attachments WHERE import_batch_id = ?1", params![imported.batch_id], |row| row.get(0))
            .unwrap();
        let path = store.path_for_key(&load_attachment(&connection, &attachment_id).unwrap().storage_key).unwrap();
        assert!(path.exists());

        crate::undo_import_batch_inner(&mut connection, &imported.batch_id).unwrap();
        cleanup_import_batch_attachments_inner(&mut connection, &store, &imported.batch_id).unwrap();
        assert!(!path.exists());
    }

    #[test]
    fn import_retention_link_failure_is_all_or_none_and_preserves_shared_bytes() {
        let (_dir, mut connection, store, _) = setup();
        let content = B64.encode(pdf_bytes());

        // Pre-existing shared attachment linked to an unrelated transaction.
        let preexisting = attach_bytes_to_transaction_inner(
            &mut connection,
            &store,
            AttachBytesRequest {
                transaction_id: "t1".into(),
                original_filename: "shared-statement.pdf".into(),
                media_type: None,
                content_base64: content.clone(),
                source_kind: None,
            },
        )
        .unwrap();
        let shared_path = store.path_for_key(&preexisting.storage_key).unwrap();
        assert!(shared_path.exists());
        let files_before: Vec<_> = std::fs::read_dir(store.root())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(files_before.len(), 1);
        let attachment_rows_before: i64 = connection
            .query_row("SELECT COUNT(*) FROM attachments", [], |row| row.get(0))
            .unwrap();
        let txn_before: i64 = connection
            .query_row("SELECT COUNT(*) FROM transactions", [], |row| row.get(0))
            .unwrap();
        let batches_before: i64 = connection
            .query_row("SELECT COUNT(*) FROM import_batches", [], |row| row.get(0))
            .unwrap();
        let links_before: i64 = connection
            .query_row("SELECT COUNT(*) FROM transaction_attachments", [], |row| row.get(0))
            .unwrap();

        let _force_fail = ForceImportRetentionFailGuard::enable();
        let err = crate::import_transactions_inner(
            &mut connection,
            Some(&store),
            crate::ImportTransactionsRequest {
                account_id: "a".into(),
                source_name: "shared-statement.pdf".into(),
                rows: vec![
                    crate::ImportTransactionRow {
                        posted_date: "2026-09-12".into(),
                        payee: "Utility".into(),
                        original_payee: None,
                        amount_minor: -3300,
                        memo: None,
                        external_id: Some("force-fail-1".into()),
                        category: None,
                        splits: None,
                        scheduled_occurrence_id: None,
                    },
                    crate::ImportTransactionRow {
                        posted_date: "2026-09-13".into(),
                        payee: "Grocery".into(),
                        original_payee: None,
                        amount_minor: -4400,
                        memo: None,
                        external_id: Some("force-fail-2".into()),
                        category: None,
                        splits: None,
                        scheduled_occurrence_id: None,
                    },
                ],
                retain_source: Some(crate::ImportSourceRetention {
                    original_filename: "shared-statement.pdf".into(),
                    media_type: None,
                    content_base64: content,
                }),
            },
        )
        .unwrap_err();
        drop(_force_fail);
        assert!(err.to_lowercase().contains("forced post-attachment"));

        // All-or-none: no imported rows/batch/partial links; shared file untouched.
        let txn_after: i64 = connection
            .query_row("SELECT COUNT(*) FROM transactions", [], |row| row.get(0))
            .unwrap();
        let batches_after: i64 = connection
            .query_row("SELECT COUNT(*) FROM import_batches", [], |row| row.get(0))
            .unwrap();
        let attachment_rows_after: i64 = connection
            .query_row("SELECT COUNT(*) FROM attachments", [], |row| row.get(0))
            .unwrap();
        let links_after: i64 = connection
            .query_row("SELECT COUNT(*) FROM transaction_attachments", [], |row| row.get(0))
            .unwrap();
        let batch_links: i64 = connection
            .query_row("SELECT COUNT(*) FROM import_batch_attachments", [], |row| row.get(0))
            .unwrap();
        assert_eq!(txn_after, txn_before);
        assert_eq!(batches_after, batches_before);
        assert_eq!(attachment_rows_after, attachment_rows_before);
        assert_eq!(links_after, links_before);
        assert_eq!(batch_links, 0);
        assert!(shared_path.exists());
        let files_after: Vec<_> = std::fs::read_dir(store.root())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(files_after, files_before);
        assert_eq!(
            list_transaction_attachments_inner(&connection, "t1").unwrap()[0].id,
            preexisting.id
        );
    }

    #[test]
    fn import_retention_new_file_link_failure_leaves_no_orphan_bytes() {
        let (_dir, mut connection, store, _) = setup();
        let content = B64.encode(b"%PDF-1.4\n% unique-orphan-fixture\n");
        assert_eq!(std::fs::read_dir(store.root()).unwrap().count(), 0);

        let _force_fail = ForceImportRetentionFailGuard::enable();
        let err = crate::import_transactions_inner(
            &mut connection,
            Some(&store),
            crate::ImportTransactionsRequest {
                account_id: "a".into(),
                source_name: "orphan.pdf".into(),
                rows: vec![crate::ImportTransactionRow {
                    posted_date: "2026-09-14".into(),
                    payee: "Orphan".into(),
                    original_payee: None,
                    amount_minor: -100,
                    memo: None,
                    external_id: Some("orphan-1".into()),
                    category: None,
                    splits: None,
                    scheduled_occurrence_id: None,
                }],
                retain_source: Some(crate::ImportSourceRetention {
                    original_filename: "orphan.pdf".into(),
                    media_type: None,
                    content_base64: content,
                }),
            },
        )
        .unwrap_err();
        drop(_force_fail);
        assert!(err.to_lowercase().contains("forced post-attachment"));

        let txn: i64 = connection.query_row("SELECT COUNT(*) FROM transactions WHERE source='import'", [], |r| r.get(0)).unwrap();
        let batches: i64 = connection.query_row("SELECT COUNT(*) FROM import_batches", [], |r| r.get(0)).unwrap();
        let attachments: i64 = connection.query_row("SELECT COUNT(*) FROM attachments", [], |r| r.get(0)).unwrap();
        let links: i64 = connection.query_row("SELECT COUNT(*) FROM transaction_attachments", [], |r| r.get(0)).unwrap();
        assert_eq!((txn, batches, attachments, links), (0, 0, 0, 0));
        assert_eq!(std::fs::read_dir(store.root()).unwrap().count(), 0);
    }

    #[test]
    fn backup_package_round_trip_and_hash_mismatch_fails() {
        let (_dir, mut connection, store, _) = setup();
        let attached = attach_bytes_to_transaction_inner(
            &mut connection,
            &store,
            AttachBytesRequest {
                transaction_id: "t1".into(),
                original_filename: "note.txt".into(),
                media_type: Some("text/plain".into()),
                content_base64: B64.encode(b"hello receipt"),
                source_kind: None,
            },
        )
        .unwrap();
        let db_bytes = {
            let path = std::env::temp_dir().join(format!("hl-snap-{}.db", Uuid::new_v4()));
            {
                let mut dest = Connection::open(&path).unwrap();
                let backup = rusqlite::backup::Backup::new(&connection, &mut dest).unwrap();
                backup
                    .run_to_completion(5, std::time::Duration::from_millis(1), None)
                    .unwrap();
            }
            let bytes = std::fs::read(&path).unwrap();
            let _ = std::fs::remove_file(path);
            bytes
        };
        let payloads = collect_backup_attachments(&connection, &store).unwrap();
        assert_eq!(payloads.len(), 1);
        assert_eq!(payloads[0].storage_key, attached.storage_key);
        let package = build_ledger_package(&db_bytes, payloads).unwrap();
        let parsed = parse_ledger_package(&package).unwrap().unwrap();
        assert_eq!(parsed.kind, LEDGER_PACKAGE_KIND);

        let restore_dir = TempStore::new();
        let restore_store = AttachmentStore::new(restore_dir.path()).unwrap();
        restore_attachment_payloads(&restore_store, &parsed.attachments).unwrap();
        assert!(restore_store.path_for_key(&attached.storage_key).unwrap().exists());

        let mut bad = parsed.attachments.clone();
        bad[0].sha256_hex = "0".repeat(64);
        let bad_dir = TempStore::new();
        let bad_store = AttachmentStore::new(bad_dir.path()).unwrap();
        assert!(restore_attachment_payloads(&bad_store, &bad).is_err());
    }

    #[test]
    fn legacy_sqlite_bytes_are_not_packages() {
        assert!(parse_ledger_package(b"SQLite format 3\0rest").unwrap().is_none());
    }
}
