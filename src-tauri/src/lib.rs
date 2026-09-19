use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use rusqlite::{backup::Backup, params, Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, path::Path, sync::Mutex, time::Duration};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;
use chrono::{Datelike, Duration as ChronoDuration, NaiveDate};

#[cfg(test)]
mod tests;

struct DbState(Mutex<Connection>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Account {
    id: String,
    name: String,
    institution: Option<String>,
    r#type: String,
    currency: String,
    balance_minor: i64,
    owner_label: String,
    needs_review: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateAccountRequest {
    name: String,
    institution: Option<String>,
    r#type: String,
    currency: String,
    opening_balance_minor: i64,
    owner_label: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LedgerTransaction {
    id: String,
    account_id: String,
    posted_date: String,
    payee: String,
    original_payee: Option<String>,
    category: String,
    amount_minor: i64,
    status: String,
    memo: Option<String>,
    external_id: Option<String>,
    source: String,
    import_batch_id: Option<String>,
    splits: Vec<LedgerTransactionSplit>,
    transfer_link_id: Option<String>,
    transfer_account_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LedgerTransactionSplit {
    id: String,
    category: String,
    amount_minor: i64,
    memo: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateTransactionRequest {
    account_id: String,
    posted_date: String,
    payee: String,
    category: String,
    amount_minor: i64,
    status: String,
    memo: Option<String>,
    splits: Option<Vec<CreateTransactionSplitRequest>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateTransactionSplitRequest {
    category: String,
    amount_minor: i64,
    memo: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TransferRequest {
    from_account_id: String,
    to_account_id: String,
    posted_date: String,
    payee: String,
    amount_minor: i64,
    status: String,
    memo: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TransferResult {
    link_id: String,
    from_transaction_id: String,
    to_transaction_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MerchantRule {
    id: String,
    name: String,
    pattern: String,
    match_type: String,
    direction: String,
    rename_to: Option<String>,
    category: Option<String>,
    priority: i64,
    enabled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MerchantRuleRequest {
    name: String,
    pattern: String,
    match_type: String,
    direction: String,
    rename_to: Option<String>,
    category: Option<String>,
    priority: i64,
    enabled: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportProfile {
    id: String,
    name: String,
    account_id: Option<String>,
    header_signature: String,
    date_column: i64,
    payee_column: i64,
    amount_column: i64,
    debit_column: i64,
    credit_column: i64,
    date_order: String,
    number_format: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportProfileRequest {
    name: String,
    account_id: Option<String>,
    header_signature: String,
    date_column: i64,
    payee_column: i64,
    amount_column: i64,
    debit_column: i64,
    credit_column: i64,
    date_order: String,
    number_format: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportTransactionSplit {
    category: String,
    amount_minor: i64,
    memo: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportTransactionRow {
    posted_date: String,
    payee: String,
    original_payee: Option<String>,
    amount_minor: i64,
    memo: Option<String>,
    external_id: Option<String>,
    category: Option<String>,
    splits: Option<Vec<ImportTransactionSplit>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportTransactionsRequest {
    account_id: String,
    source_name: String,
    rows: Vec<ImportTransactionRow>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportResult {
    batch_id: String,
    imported_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportBatch {
    id: String,
    account_id: String,
    account_name: String,
    source_name: String,
    imported_at: String,
    undone_at: Option<String>,
    transaction_count: i64,
    total_minor: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UndoImportResult {
    batch_id: String,
    removed_count: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompleteReconciliationRequest {
    account_id: String,
    statement_end_date: String,
    opening_balance_minor: i64,
    closing_balance_minor: i64,
    transaction_ids: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Reconciliation {
    id: String,
    account_id: String,
    statement_end_date: String,
    opening_balance_minor: i64,
    closing_balance_minor: i64,
    reconciled_at: String,
    transaction_count: i64,
    adjustment_total_minor: i64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScheduledTransaction {
    id: String,
    kind: String,
    account_id: String,
    transfer_account_id: Option<String>,
    payee: String,
    category: String,
    amount_minor: i64,
    status: String,
    memo: Option<String>,
    frequency: String,
    anchor_date: String,
    end_date: Option<String>,
    second_month_day: Option<u32>,
    custom_interval_count: Option<u32>,
    custom_interval_unit: Option<String>,
    enabled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScheduledTransactionRequest {
    kind: String,
    account_id: String,
    transfer_account_id: Option<String>,
    payee: String,
    category: String,
    amount_minor: i64,
    status: String,
    memo: Option<String>,
    frequency: String,
    anchor_date: String,
    end_date: Option<String>,
    second_month_day: Option<u32>,
    custom_interval_count: Option<u32>,
    custom_interval_unit: Option<String>,
    enabled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScheduledOccurrenceQuery {
    from_date: String,
    to_date: String,
    scheduled_transaction_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScheduledOccurrence {
    id: String,
    scheduled_transaction_id: String,
    due_date: String,
    status: String,
    transaction_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RestoreResult {
    account_count: i64,
    transaction_count: i64,
}

const CURRENT_SCHEMA_VERSION: i64 = 10;
const HOMELEDGER_APPLICATION_ID: i64 = 1_212_957_767;
const MAX_BACKUP_BYTES: usize = 256 * 1024 * 1024;

fn clean_required(value: String, field: &str, max: usize) -> Result<String, String> {
    let cleaned = value.trim().to_string();
    if cleaned.is_empty() { return Err(format!("{field} is required")); }
    if cleaned.chars().count() > max { return Err(format!("{field} is too long")); }
    Ok(cleaned)
}

fn clean_optional(value: Option<String>, max: usize) -> Result<Option<String>, String> {
    match value.map(|v| v.trim().to_string()).filter(|v| !v.is_empty()) {
        Some(value) if value.chars().count() > max => Err("Optional field is too long".into()),
        value => Ok(value),
    }
}

fn apply_migrations(connection: &mut Connection) -> Result<(), String> {
    connection.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;").map_err(|e| e.to_string())?;
    connection.execute_batch("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, description TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);").map_err(|e| e.to_string())?;
    let version: i64 = connection.query_row("SELECT COALESCE(MAX(version), 0) FROM schema_migrations", [], |row| row.get(0)).map_err(|e| e.to_string())?;
    if version < 1 {
        let tx = connection.transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(include_str!("../migrations/001_initial.sql")).map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO schema_migrations(version, description) VALUES(1, 'initial local ledger')", []).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    if version < 2 {
        let tx = connection.transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(include_str!("../migrations/002_import_history.sql")).map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO schema_migrations(version, description) VALUES(2, 'import history totals')", []).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    if version < 3 {
        let tx = connection.transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(include_str!("../migrations/003_external_transaction_ids.sql")).map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO schema_migrations(version, description) VALUES(3, 'provider transaction identifiers')", []).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    if version < 4 {
        let tx = connection.transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(include_str!("../migrations/004_database_identity.sql")).map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO schema_migrations(version, description) VALUES(4, 'HomeLedger database identity')", []).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    if version < 5 {
        let tx = connection.transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(include_str!("../migrations/005_split_order.sql")).map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO schema_migrations(version, description) VALUES(5, 'transaction split ordering')", []).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    if version < 6 {
        let tx = connection.transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(include_str!("../migrations/006_reconciliations.sql")).map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO schema_migrations(version, description) VALUES(6, 'account statement reconciliations')", []).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    if version < 7 {
        let tx = connection.transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(include_str!("../migrations/007_merchant_rules.sql")).map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO schema_migrations(version, description) VALUES(7, 'deterministic merchant rules')", []).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    if version < 8 {
        let tx = connection.transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(include_str!("../migrations/008_import_profiles.sql")).map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO schema_migrations(version, description) VALUES(8, 'reusable delimited import profiles')", []).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    if version < 9 {
        let tx = connection.transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(include_str!("../migrations/009_import_profile_locales.sql")).map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO schema_migrations(version, description) VALUES(9, 'import profile locale settings')", []).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    if version < 10 {
        let tx = connection.transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(include_str!("../migrations/010_scheduled_transactions.sql")).map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO schema_migrations(version, description) VALUES(10, 'scheduled transaction templates and occurrences')", []).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn list_accounts(state: State<DbState>) -> Result<Vec<Account>, String> {
    let connection = state.0.lock().map_err(|_| "Database lock failed".to_string())?;
    let mut statement = connection.prepare("SELECT a.id, a.name, a.institution, a.account_type, a.currency, a.opening_balance_minor + COALESCE(SUM(t.amount_minor), 0), a.owner_label, EXISTS(SELECT 1 FROM transactions review WHERE review.account_id = a.id AND review.status = 'review') FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id WHERE a.archived_at IS NULL GROUP BY a.id ORDER BY a.sort_order, a.created_at").map_err(|e| e.to_string())?;
    let rows = statement.query_map([], |row| Ok(Account { id: row.get(0)?, name: row.get(1)?, institution: row.get(2)?, r#type: row.get(3)?, currency: row.get(4)?, balance_minor: row.get(5)?, owner_label: row.get(6)?, needs_review: row.get(7)? })).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[tauri::command]
fn create_account(request: CreateAccountRequest, state: State<DbState>) -> Result<Account, String> {
    const TYPES: &[&str] = &["checking", "savings", "credit", "cash", "loan", "asset"];
    if !TYPES.contains(&request.r#type.as_str()) { return Err("Unsupported account type".into()); }
    let currency = request.currency.trim().to_uppercase();
    if currency.len() != 3 || !currency.chars().all(|c| c.is_ascii_alphabetic()) { return Err("Currency must be a three-letter code".into()); }
    let account = Account { id: Uuid::new_v4().to_string(), name: clean_required(request.name, "Account name", 80)?, institution: clean_optional(request.institution, 80)?, r#type: request.r#type, currency, balance_minor: request.opening_balance_minor, owner_label: clean_required(request.owner_label, "Owner", 80)?, needs_review: false };
    let connection = state.0.lock().map_err(|_| "Database lock failed".to_string())?;
    connection.execute("INSERT INTO accounts(id, name, institution, account_type, currency, opening_balance_minor, owner_label) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)", params![account.id, account.name, account.institution, account.r#type, account.currency, account.balance_minor, account.owner_label]).map_err(|e| e.to_string())?;
    Ok(account)
}

fn query_transactions(connection: &Connection, account_id: Option<&str>, statement_end_date: Option<&str>, reconciliation_candidates: bool) -> Result<Vec<LedgerTransaction>, String> {
    let mut items = {
        let mut statement = connection.prepare(
            "SELECT id, account_id, posted_date, payee, original_payee, category, amount_minor, status, memo, external_id, source, import_batch_id
             FROM transactions
             WHERE (?1 IS NULL OR account_id = ?1)
               AND (?2 IS NULL OR posted_date <= ?2)
               AND (?3 = 0 OR (status <> 'reconciled' AND NOT EXISTS (
                 SELECT 1 FROM reconciliation_items item WHERE item.transaction_id = transactions.id
               )))
             ORDER BY posted_date DESC, created_at DESC
             LIMIT ?4"
        ).map_err(|e| e.to_string())?;
        let limit = if reconciliation_candidates { i64::MAX } else { 1000 };
        let rows = statement.query_map(params![account_id, statement_end_date, reconciliation_candidates, limit], |row| Ok(LedgerTransaction { id: row.get(0)?, account_id: row.get(1)?, posted_date: row.get(2)?, payee: row.get(3)?, original_payee: row.get(4)?, category: row.get(5)?, amount_minor: row.get(6)?, status: row.get(7)?, memo: row.get(8)?, external_id: row.get(9)?, source: row.get(10)?, import_batch_id: row.get(11)?, splits: vec![], transfer_link_id: None, transfer_account_id: None })).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
    };
    let mut split_statement = connection.prepare("SELECT id, category, amount_minor, memo FROM transaction_splits WHERE transaction_id = ?1 ORDER BY sort_order, rowid").map_err(|e| e.to_string())?;
    for item in &mut items {
        let rows = split_statement.query_map(params![item.id], |row| Ok(LedgerTransactionSplit { id: row.get(0)?, category: row.get(1)?, amount_minor: row.get(2)?, memo: row.get(3)? })).map_err(|e| e.to_string())?;
        item.splits = rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    }
    let mut transfer_statement = connection.prepare("SELECT l.id, CASE WHEN l.from_transaction_id = ?1 THEN destination.account_id ELSE origin.account_id END FROM transfer_links l JOIN transactions origin ON origin.id = l.from_transaction_id JOIN transactions destination ON destination.id = l.to_transaction_id WHERE l.from_transaction_id = ?1 OR l.to_transaction_id = ?1").map_err(|e| e.to_string())?;
    for item in &mut items {
        let link: Option<(String,String)> = transfer_statement.query_row(params![item.id], |row| Ok((row.get(0)?,row.get(1)?))).optional().map_err(|e| e.to_string())?;
        if let Some((link_id,account_id))=link { item.transfer_link_id=Some(link_id);item.transfer_account_id=Some(account_id); }
    }
    Ok(items)
}

#[tauri::command]
fn list_transactions(account_id: Option<String>, state: State<DbState>) -> Result<Vec<LedgerTransaction>, String> {
    let connection = state.0.lock().map_err(|_| "Database lock failed".to_string())?;
    query_transactions(&connection, account_id.as_deref(), None, false)
}

#[tauri::command]
fn list_reconciliation_transactions(account_id: String, statement_end_date: String, state: State<DbState>) -> Result<Vec<LedgerTransaction>, String> {
    let account_id = clean_required(account_id, "Account", 80)?;
    if NaiveDate::parse_from_str(&statement_end_date, "%Y-%m-%d").is_err() { return Err("Statement end date must be a valid YYYY-MM-DD date".into()); }
    let connection = state.0.lock().map_err(|_| "Database lock failed".to_string())?;
    let exists: Option<i64> = connection.query_row("SELECT 1 FROM accounts WHERE id = ?1 AND archived_at IS NULL", params![account_id], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
    if exists.is_none() { return Err("Account does not exist".into()); }
    query_transactions(&connection, Some(&account_id), Some(&statement_end_date), true)
}

fn clean_transaction_request(request: CreateTransactionRequest) -> Result<LedgerTransaction, String> {
    const STATUSES: &[&str] = &["pending", "cleared", "review"];
    if !STATUSES.contains(&request.status.as_str()) { return Err("Unsupported transaction status".into()); }
    if NaiveDate::parse_from_str(&request.posted_date, "%Y-%m-%d").is_err() { return Err("Date must be a valid YYYY-MM-DD date".into()); }
    let account_id = clean_required(request.account_id, "Account", 80)?;
    let payee = clean_required(request.payee, "Payee", 160)?;
    let memo = clean_optional(request.memo, 500)?;
    let mut splits = Vec::new();
    for split in request.splits.unwrap_or_default() {
        if split.amount_minor == 0 { return Err("Split amounts cannot be zero".into()); }
        splits.push(LedgerTransactionSplit { id: Uuid::new_v4().to_string(), category: clean_required(split.category, "Split category", 120)?, amount_minor: split.amount_minor, memo: clean_optional(split.memo, 500)? });
    }
    if !splits.is_empty() {
        if splits.len() < 2 { return Err("A split transaction requires at least two splits".into()); }
        let total = splits.iter().try_fold(0_i64, |sum, split| sum.checked_add(split.amount_minor).ok_or("Split total is too large"))?;
        if total != request.amount_minor { return Err("Split total does not equal the transaction amount".into()); }
    }
    Ok(LedgerTransaction {
        id: Uuid::new_v4().to_string(), account_id, posted_date: request.posted_date, payee, original_payee: None,
        category: if splits.is_empty() { clean_required(request.category, "Category", 120)? } else { "Split transaction".into() },
        amount_minor: request.amount_minor, status: request.status, memo, external_id: None,
        source: "manual".into(), import_batch_id: None, splits, transfer_link_id: None, transfer_account_id: None
    })
}

fn insert_transaction_splits(connection: &Connection, transaction_id: &str, splits: &[LedgerTransactionSplit]) -> Result<(), String> {
    for (index, split) in splits.iter().enumerate() {
        connection.execute("INSERT INTO transaction_splits(id, transaction_id, category, amount_minor, memo, sort_order) VALUES(?1, ?2, ?3, ?4, ?5, ?6)", params![split.id, transaction_id, split.category, split.amount_minor, split.memo, index as i64]).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn create_transaction_inner(connection: &mut Connection, request: CreateTransactionRequest) -> Result<LedgerTransaction, String> {
    let item = clean_transaction_request(request)?;
    let tx = connection.transaction().map_err(|e| e.to_string())?;
    let exists: Option<i64> = tx.query_row("SELECT 1 FROM accounts WHERE id = ?1 AND archived_at IS NULL", params![item.account_id], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
    if exists.is_none() { return Err("Account does not exist".into()); }
    tx.execute("INSERT INTO transactions(id, account_id, posted_date, payee, category, amount_minor, status, memo, source) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'manual')", params![item.id, item.account_id, item.posted_date, item.payee, item.category, item.amount_minor, item.status, item.memo]).map_err(|e| e.to_string())?;
    insert_transaction_splits(&tx, &item.id, &item.splits)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(item)
}

fn clean_transfer_request(request: TransferRequest) -> Result<TransferRequest, String> {
    const STATUSES: &[&str] = &["pending", "cleared", "review"];
    if request.amount_minor <= 0 { return Err("Transfer amount must be greater than zero".into()); }
    if !STATUSES.contains(&request.status.as_str()) { return Err("Unsupported transaction status".into()); }
    if NaiveDate::parse_from_str(&request.posted_date, "%Y-%m-%d").is_err() { return Err("Date must be a valid YYYY-MM-DD date".into()); }
    let from_account_id = clean_required(request.from_account_id, "From account", 80)?;
    let to_account_id = clean_required(request.to_account_id, "To account", 80)?;
    if from_account_id == to_account_id { return Err("Choose two different transfer accounts".into()); }
    Ok(TransferRequest {
        from_account_id,
        to_account_id,
        posted_date: request.posted_date,
        payee: clean_required(request.payee, "Description/payee", 160)?,
        amount_minor: request.amount_minor,
        status: request.status,
        memo: clean_optional(request.memo, 500)?,
    })
}

fn transfer_accounts(connection: &Connection, from_id: &str, to_id: &str) -> Result<(String,String), String> {
    let from: Option<(String,String)> = connection.query_row("SELECT name,currency FROM accounts WHERE id=?1 AND archived_at IS NULL", params![from_id], |row| Ok((row.get(0)?,row.get(1)?))).optional().map_err(|e| e.to_string())?;
    let to: Option<(String,String)> = connection.query_row("SELECT name,currency FROM accounts WHERE id=?1 AND archived_at IS NULL", params![to_id], |row| Ok((row.get(0)?,row.get(1)?))).optional().map_err(|e| e.to_string())?;
    let (from_name,from_currency)=from.ok_or("Source account does not exist")?;
    let (to_name,to_currency)=to.ok_or("Destination account does not exist")?;
    if from_currency != to_currency { return Err("Transfers between different currencies are not supported yet".into()); }
    Ok((from_name,to_name))
}

fn create_transfer_inner(connection: &mut Connection, request: TransferRequest) -> Result<TransferResult,String> {
    let request=clean_transfer_request(request)?;
    let tx=connection.transaction().map_err(|e|e.to_string())?;
    let (from_name,to_name)=transfer_accounts(&tx,&request.from_account_id,&request.to_account_id)?;
    let link_id=Uuid::new_v4().to_string();
    let from_transaction_id=Uuid::new_v4().to_string();
    let to_transaction_id=Uuid::new_v4().to_string();
    tx.execute("INSERT INTO transactions(id,account_id,posted_date,payee,category,amount_minor,status,memo,source) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'transfer')",params![from_transaction_id,request.from_account_id,request.posted_date,request.payee,format!("Transfer: {to_name}"),-request.amount_minor,request.status,request.memo]).map_err(|e|e.to_string())?;
    tx.execute("INSERT INTO transactions(id,account_id,posted_date,payee,category,amount_minor,status,memo,source) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'transfer')",params![to_transaction_id,request.to_account_id,request.posted_date,request.payee,format!("Transfer: {from_name}"),request.amount_minor,request.status,request.memo]).map_err(|e|e.to_string())?;
    tx.execute("INSERT INTO transfer_links(id,from_transaction_id,to_transaction_id) VALUES(?1,?2,?3)",params![link_id,from_transaction_id,to_transaction_id]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e|e.to_string())?;
    Ok(TransferResult{link_id,from_transaction_id,to_transaction_id})
}

fn update_transfer_inner(connection:&mut Connection,transfer_id:String,request:TransferRequest)->Result<TransferResult,String>{
    let request=clean_transfer_request(request)?;
    let transfer_id=clean_required(transfer_id,"Transfer",80)?;
    let tx=connection.transaction().map_err(|e|e.to_string())?;
    let pair:Option<(String,String)>=tx.query_row("SELECT from_transaction_id,to_transaction_id FROM transfer_links WHERE id=?1",params![transfer_id],|row|Ok((row.get(0)?,row.get(1)?))).optional().map_err(|e|e.to_string())?;
    let (from_transaction_id,to_transaction_id)=pair.ok_or("Transfer does not exist")?;
    let reconciled: Option<i64> = tx.query_row("SELECT 1 FROM reconciliation_items WHERE transaction_id IN (?1, ?2) LIMIT 1", params![from_transaction_id, to_transaction_id], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
    if reconciled.is_some() { return Err("A reconciled transfer cannot be edited".into()); }
    let (from_name,to_name)=transfer_accounts(&tx,&request.from_account_id,&request.to_account_id)?;
    let outgoing_updated=tx.execute("UPDATE transactions SET account_id=?2,posted_date=?3,payee=?4,category=?5,amount_minor=?6,status=?7,memo=?8,modified_at=CURRENT_TIMESTAMP WHERE id=?1 AND source='transfer'",params![from_transaction_id,request.from_account_id,request.posted_date,request.payee,format!("Transfer: {to_name}"),-request.amount_minor,request.status,request.memo]).map_err(|e|e.to_string())?;
    let incoming_updated=tx.execute("UPDATE transactions SET account_id=?2,posted_date=?3,payee=?4,category=?5,amount_minor=?6,status=?7,memo=?8,modified_at=CURRENT_TIMESTAMP WHERE id=?1 AND source='transfer'",params![to_transaction_id,request.to_account_id,request.posted_date,request.payee,format!("Transfer: {from_name}"),request.amount_minor,request.status,request.memo]).map_err(|e|e.to_string())?;
    if outgoing_updated!=1||incoming_updated!=1{return Err("Transfer pair is incomplete; nothing was changed".into());}
    tx.commit().map_err(|e|e.to_string())?;
    Ok(TransferResult{link_id:transfer_id,from_transaction_id,to_transaction_id})
}

fn delete_transfer_inner(connection:&mut Connection,transfer_id:String)->Result<(),String>{
    let transfer_id=clean_required(transfer_id,"Transfer",80)?;
    let tx=connection.transaction().map_err(|e|e.to_string())?;
    let pair:Option<(String,String)>=tx.query_row("SELECT from_transaction_id,to_transaction_id FROM transfer_links WHERE id=?1",params![transfer_id],|row|Ok((row.get(0)?,row.get(1)?))).optional().map_err(|e|e.to_string())?;
    let (from_transaction_id,to_transaction_id)=pair.ok_or("Transfer does not exist")?;
    let reconciled: Option<i64> = tx.query_row("SELECT 1 FROM reconciliation_items WHERE transaction_id IN (?1, ?2) LIMIT 1", params![from_transaction_id, to_transaction_id], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
    if reconciled.is_some() { return Err("A reconciled transfer cannot be deleted".into()); }
    tx.execute("DELETE FROM transfer_links WHERE id=?1",params![transfer_id]).map_err(|e|e.to_string())?;
    let removed=tx.execute("DELETE FROM transactions WHERE id IN (?1,?2) AND source='transfer'",params![from_transaction_id,to_transaction_id]).map_err(|e|e.to_string())?;
    if removed!=2{return Err("Transfer pair is incomplete; nothing was deleted".into());}
    tx.commit().map_err(|e|e.to_string())?;
    Ok(())
}

#[tauri::command]
fn create_transfer(request:TransferRequest,state:State<DbState>)->Result<TransferResult,String>{let mut connection=state.0.lock().map_err(|_|"Database lock failed".to_string())?;create_transfer_inner(&mut connection,request)}
#[tauri::command]
fn update_transfer(transfer_id:String,request:TransferRequest,state:State<DbState>)->Result<TransferResult,String>{let mut connection=state.0.lock().map_err(|_|"Database lock failed".to_string())?;update_transfer_inner(&mut connection,transfer_id,request)}
#[tauri::command]
fn delete_transfer(transfer_id:String,state:State<DbState>)->Result<(),String>{let mut connection=state.0.lock().map_err(|_|"Database lock failed".to_string())?;delete_transfer_inner(&mut connection,transfer_id)}

fn normalize_merchant(value:&str)->String{
    let mut output=String::new();
    let mut spacing=false;
    for character in value.to_lowercase().chars(){
        if character.is_alphanumeric(){output.push(character);spacing=false;}
        else if !output.is_empty()&&!spacing{output.push(' ');spacing=true;}
    }
    output.trim().to_string()
}

fn clean_merchant_rule(request:MerchantRuleRequest,id:String)->Result<(MerchantRule,String),String>{
    const MATCH_TYPES:&[&str]=&["contains","starts_with","exact"];
    const DIRECTIONS:&[&str]=&["any","expense","income"];
    if !MATCH_TYPES.contains(&request.match_type.as_str()){return Err("Unsupported merchant-rule match type".into());}
    if !DIRECTIONS.contains(&request.direction.as_str()){return Err("Unsupported merchant-rule direction".into());}
    if !(-10_000..=10_000).contains(&request.priority){return Err("Priority must be between -10000 and 10000".into());}
    let pattern=clean_required(request.pattern,"Match text",120)?;
    let normalized_pattern=normalize_merchant(&pattern);
    if normalized_pattern.is_empty(){return Err("Match text must contain a letter or number".into());}
    let rename_to=clean_optional(request.rename_to,160)?;
    let category=clean_optional(request.category,120)?;
    if rename_to.is_none()&&category.is_none(){return Err("A rule must rename the payee, assign a category, or both".into());}
    Ok((MerchantRule{id,name:clean_required(request.name,"Rule name",80)?,pattern,match_type:request.match_type,direction:request.direction,rename_to,category,priority:request.priority,enabled:request.enabled},normalized_pattern))
}

fn load_merchant_rules(connection:&Connection)->Result<Vec<MerchantRule>,String>{
    let mut statement=connection.prepare("SELECT id,name,pattern,match_type,direction,rename_to,category,priority,enabled FROM merchant_rules ORDER BY priority DESC,id").map_err(|e|e.to_string())?;
    let rows=statement.query_map([],|row|Ok(MerchantRule{id:row.get(0)?,name:row.get(1)?,pattern:row.get(2)?,match_type:row.get(3)?,direction:row.get(4)?,rename_to:row.get(5)?,category:row.get(6)?,priority:row.get(7)?,enabled:row.get(8)?})).map_err(|e|e.to_string())?;
    rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())
}

#[tauri::command]
fn list_merchant_rules(state:State<DbState>)->Result<Vec<MerchantRule>,String>{
    let connection=state.0.lock().map_err(|_|"Database lock failed".to_string())?;
    load_merchant_rules(&connection)
}

#[tauri::command]
fn create_merchant_rule(request:MerchantRuleRequest,state:State<DbState>)->Result<MerchantRule,String>{
    let (rule,normalized)=clean_merchant_rule(request,Uuid::new_v4().to_string())?;
    let connection=state.0.lock().map_err(|_|"Database lock failed".to_string())?;
    connection.execute("INSERT INTO merchant_rules(id,name,pattern,normalized_pattern,match_type,direction,rename_to,category,priority,enabled) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",params![rule.id,rule.name,rule.pattern,normalized,rule.match_type,rule.direction,rule.rename_to,rule.category,rule.priority,rule.enabled]).map_err(|e|e.to_string())?;
    Ok(rule)
}

#[tauri::command]
fn update_merchant_rule(rule_id:String,request:MerchantRuleRequest,state:State<DbState>)->Result<MerchantRule,String>{
    let rule_id=clean_required(rule_id,"Merchant rule",80)?;
    let (rule,normalized)=clean_merchant_rule(request,rule_id)?;
    let connection=state.0.lock().map_err(|_|"Database lock failed".to_string())?;
    let changed=connection.execute("UPDATE merchant_rules SET name=?2,pattern=?3,normalized_pattern=?4,match_type=?5,direction=?6,rename_to=?7,category=?8,priority=?9,enabled=?10,modified_at=CURRENT_TIMESTAMP WHERE id=?1",params![rule.id,rule.name,rule.pattern,normalized,rule.match_type,rule.direction,rule.rename_to,rule.category,rule.priority,rule.enabled]).map_err(|e|e.to_string())?;
    if changed!=1{return Err("Merchant rule does not exist".into());}
    Ok(rule)
}

#[tauri::command]
fn delete_merchant_rule(rule_id:String,state:State<DbState>)->Result<(),String>{
    let rule_id=clean_required(rule_id,"Merchant rule",80)?;
    let connection=state.0.lock().map_err(|_|"Database lock failed".to_string())?;
    let removed=connection.execute("DELETE FROM merchant_rules WHERE id=?1",params![rule_id]).map_err(|e|e.to_string())?;
    if removed!=1{return Err("Merchant rule does not exist".into());}
    Ok(())
}

fn clean_import_profile(request:ImportProfileRequest,id:String)->Result<ImportProfile,String>{
    let header_signature=clean_required(request.header_signature,"Header signature",2000)?;
    if request.date_column<0||request.payee_column<0{return Err("Date and description columns are required".into());}
    if request.amount_column<0&&request.debit_column<0&&request.credit_column<0{return Err("An amount or debit/credit column is required".into());}
    for column in [request.date_column,request.payee_column,request.amount_column,request.debit_column,request.credit_column]{if column>1000{return Err("Import profile column is out of range".into());}}
    if !["mdy","dmy"].contains(&request.date_order.as_str())||!["dot","comma"].contains(&request.number_format.as_str()){return Err("Import profile locale settings are invalid".into());}
    Ok(ImportProfile{id,name:clean_required(request.name,"Profile name",80)?,account_id:clean_optional(request.account_id,80)?,header_signature,date_column:request.date_column,payee_column:request.payee_column,amount_column:request.amount_column,debit_column:request.debit_column,credit_column:request.credit_column,date_order:request.date_order,number_format:request.number_format})
}

#[tauri::command]
fn list_import_profiles(state:State<DbState>)->Result<Vec<ImportProfile>,String>{
    let connection=state.0.lock().map_err(|_|"Database lock failed".to_string())?;
    let mut statement=connection.prepare("SELECT id,name,account_id,header_signature,date_column,payee_column,amount_column,debit_column,credit_column,date_order,number_format FROM import_profiles ORDER BY modified_at DESC,name").map_err(|e|e.to_string())?;
    let rows=statement.query_map([],|row|Ok(ImportProfile{id:row.get(0)?,name:row.get(1)?,account_id:row.get(2)?,header_signature:row.get(3)?,date_column:row.get(4)?,payee_column:row.get(5)?,amount_column:row.get(6)?,debit_column:row.get(7)?,credit_column:row.get(8)?,date_order:row.get(9)?,number_format:row.get(10)?})).map_err(|e|e.to_string())?;
    rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())
}

#[tauri::command]
fn save_import_profile(request:ImportProfileRequest,state:State<DbState>)->Result<ImportProfile,String>{
    let profile=clean_import_profile(request,Uuid::new_v4().to_string())?;
    let connection=state.0.lock().map_err(|_|"Database lock failed".to_string())?;
    if let Some(account_id)=&profile.account_id{
        let exists:Option<i64>=connection.query_row("SELECT 1 FROM accounts WHERE id=?1 AND archived_at IS NULL",params![account_id],|row|row.get(0)).optional().map_err(|e|e.to_string())?;
        if exists.is_none(){return Err("Profile account does not exist".into());}
    }
    let existing_id:Option<String>=connection.query_row("SELECT id FROM import_profiles WHERE name=?1 AND header_signature=?2",params![profile.name,profile.header_signature],|row|row.get(0)).optional().map_err(|e|e.to_string())?;
    let id=existing_id.unwrap_or_else(||profile.id.clone());
    connection.execute("INSERT INTO import_profiles(id,name,account_id,header_signature,date_column,payee_column,amount_column,debit_column,credit_column,date_order,number_format) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11) ON CONFLICT(name,header_signature) DO UPDATE SET account_id=excluded.account_id,date_column=excluded.date_column,payee_column=excluded.payee_column,amount_column=excluded.amount_column,debit_column=excluded.debit_column,credit_column=excluded.credit_column,date_order=excluded.date_order,number_format=excluded.number_format,modified_at=CURRENT_TIMESTAMP",params![id,profile.name,profile.account_id,profile.header_signature,profile.date_column,profile.payee_column,profile.amount_column,profile.debit_column,profile.credit_column,profile.date_order,profile.number_format]).map_err(|e|e.to_string())?;
    Ok(ImportProfile{id,..profile})
}

#[tauri::command]
fn delete_import_profile(profile_id:String,state:State<DbState>)->Result<(),String>{
    let profile_id=clean_required(profile_id,"Import profile",80)?;
    let connection=state.0.lock().map_err(|_|"Database lock failed".to_string())?;
    if connection.execute("DELETE FROM import_profiles WHERE id=?1",params![profile_id]).map_err(|e|e.to_string())?!=1{return Err("Import profile does not exist".into());}
    Ok(())
}

fn scheduled_transaction_from_row(row:&rusqlite::Row<'_>)->rusqlite::Result<ScheduledTransaction>{
    Ok(ScheduledTransaction{id:row.get(0)?,kind:row.get(1)?,account_id:row.get(2)?,transfer_account_id:row.get(3)?,payee:row.get(4)?,category:row.get(5)?,amount_minor:row.get(6)?,status:row.get(7)?,memo:row.get(8)?,frequency:row.get(9)?,anchor_date:row.get(10)?,end_date:row.get(11)?,second_month_day:row.get(12)?,custom_interval_count:row.get(13)?,custom_interval_unit:row.get(14)?,enabled:row.get(15)?})
}

fn scheduled_occurrence_from_row(row:&rusqlite::Row<'_>)->rusqlite::Result<ScheduledOccurrence>{
    Ok(ScheduledOccurrence{id:row.get(0)?,scheduled_transaction_id:row.get(1)?,due_date:row.get(2)?,status:row.get(3)?,transaction_id:row.get(4)?})
}

fn clean_scheduled_transaction(connection:&Connection,request:ScheduledTransactionRequest,id:String)->Result<ScheduledTransaction,String>{
    if !["transaction","transfer"].contains(&request.kind.as_str()){return Err("Unsupported scheduled transaction kind".into());}
    if !["pending","cleared","review"].contains(&request.status.as_str()){return Err("Unsupported scheduled transaction status".into());}
    if !["weekly","biweekly","semimonthly","monthly","annual","custom"].contains(&request.frequency.as_str()){return Err("Unsupported recurrence frequency".into());}
    if request.amount_minor==0{return Err("Scheduled amount cannot be zero".into());}
    let anchor=NaiveDate::parse_from_str(&request.anchor_date,"%Y-%m-%d").map_err(|_|"Anchor date must be a valid YYYY-MM-DD date")?;
    let end_date=match clean_optional(request.end_date,10)?{
        Some(value)=>{
            let end=NaiveDate::parse_from_str(&value,"%Y-%m-%d").map_err(|_|"End date must be a valid YYYY-MM-DD date")?;
            if end<anchor{return Err("Schedule end date cannot be before its anchor".into());}
            Some(value)
        },
        None=>None
    };
    if request.frequency=="semimonthly"{
        let second=request.second_month_day.ok_or("Semimonthly schedules require a second month day")?;
        if !(1..=31).contains(&second)||second==anchor.day(){return Err("Semimonthly schedules require two different month days".into());}
    }else if request.second_month_day.is_some(){return Err("Second month day is only valid for semimonthly schedules".into());}
    if request.frequency=="custom"{
        let count=request.custom_interval_count.ok_or("Custom schedules require an interval")?;
        if count==0||count>10_000{return Err("Custom interval must be between 1 and 10,000".into());}
        if !["days","weeks","months","years"].contains(&request.custom_interval_unit.as_deref().unwrap_or("")){return Err("Custom recurrence unit is invalid".into());}
    }else if request.custom_interval_count.is_some()||request.custom_interval_unit.is_some(){return Err("Custom interval fields are only valid for custom schedules".into());}
    let account_id=clean_required(request.account_id,"Account",80)?;
    let source:Option<String>=connection.query_row("SELECT currency FROM accounts WHERE id=?1 AND archived_at IS NULL",params![account_id],|row|row.get(0)).optional().map_err(|e|e.to_string())?;
    let source_currency=source.ok_or("Scheduled transaction account does not exist")?;
    let transfer_account_id=clean_optional(request.transfer_account_id,80)?;
    if request.kind=="transaction"&&transfer_account_id.is_some(){return Err("Ordinary scheduled transactions cannot have a transfer account".into());}
    if request.kind=="transfer"{
        let destination_id=transfer_account_id.as_ref().ok_or("Scheduled transfers require a destination account")?;
        if destination_id==&account_id{return Err("Scheduled transfers require two different accounts".into());}
        let destination:Option<String>=connection.query_row("SELECT currency FROM accounts WHERE id=?1 AND archived_at IS NULL",params![destination_id],|row|row.get(0)).optional().map_err(|e|e.to_string())?;
        if destination.as_deref()!=Some(source_currency.as_str()){return Err("Scheduled transfer accounts must exist and use the same currency".into());}
        if request.amount_minor<=0{return Err("Scheduled transfer amount must be positive".into());}
    }
    Ok(ScheduledTransaction{id,kind:request.kind,account_id,transfer_account_id,payee:clean_required(request.payee,"Payee",160)?,category:clean_required(request.category,"Category",120)?,amount_minor:request.amount_minor,status:request.status,memo:clean_optional(request.memo,500)?,frequency:request.frequency,anchor_date:request.anchor_date,end_date,second_month_day:request.second_month_day,custom_interval_count:request.custom_interval_count,custom_interval_unit:request.custom_interval_unit,enabled:request.enabled})
}

fn clamped_month_date(anchor:NaiveDate,month_offset:i32)->Result<NaiveDate,String>{
    let total=anchor.year().checked_mul(12).and_then(|value|value.checked_add(anchor.month0() as i32)).and_then(|value|value.checked_add(month_offset)).ok_or("Recurrence date is out of range")?;
    let year=total.div_euclid(12);
    let month0=total.rem_euclid(12) as u32;
    let next=if month0==11{NaiveDate::from_ymd_opt(year+1,1,1)}else{NaiveDate::from_ymd_opt(year,month0+2,1)}.ok_or("Recurrence date is out of range")?;
    let last=(next-ChronoDuration::days(1)).day();
    NaiveDate::from_ymd_opt(year,month0+1,anchor.day().min(last)).ok_or("Recurrence date is out of range".into())
}

fn generate_scheduled_dates(template:&ScheduledTransaction,from:NaiveDate,requested_end:NaiveDate)->Result<Vec<NaiveDate>,String>{
    let anchor=NaiveDate::parse_from_str(&template.anchor_date,"%Y-%m-%d").map_err(|_|"Stored schedule has an invalid anchor date")?;
    let configured_end=template.end_date.as_deref().map(|value|NaiveDate::parse_from_str(value,"%Y-%m-%d").map_err(|_|"Stored schedule has an invalid end date")).transpose()?;
    let end=configured_end.map_or(requested_end,|value|value.min(requested_end));
    if from>end||anchor>end{return Ok(vec![]);}
    let mut dates=Vec::new();
    match template.frequency.as_str(){
        "weekly"|"biweekly"=>{
            let step=if template.frequency=="biweekly"{14}else{7};
            let elapsed=(from-anchor).num_days();
            let mut occurrence=anchor+ChronoDuration::days(if elapsed<=0{0}else{(elapsed+step-1)/step*step});
            while occurrence<=end{dates.push(occurrence);occurrence+=ChronoDuration::days(step);}
        },
        "monthly"|"annual"=>{
            let interval=if template.frequency=="annual"{12}else{1};
            let month_difference=(from.year()-anchor.year())*12+from.month0() as i32-anchor.month0() as i32;
            let mut step=(month_difference.div_euclid(interval)-1).max(0);
            loop{
                let occurrence=clamped_month_date(anchor,step*interval)?;
                if occurrence>end{break;}
                if occurrence>=anchor&&occurrence>=from{dates.push(occurrence);}
                step+=1;
            }
        },
        "semimonthly"=>{
            let second=template.second_month_day.ok_or("Stored semimonthly schedule is incomplete")?;
            let month_difference=(from.year()-anchor.year())*12+from.month0() as i32-anchor.month0() as i32;
            let mut offset=(month_difference-1).max(0);
            loop{
                let first=clamped_month_date(anchor,offset)?;
                if NaiveDate::from_ymd_opt(first.year(),first.month(),1).ok_or("Recurrence date is out of range")?>end{break;}
                for day in [anchor.day(),second]{
                    let month_anchor=NaiveDate::from_ymd_opt(first.year(),first.month(),day.min(28)).ok_or("Recurrence date is out of range")?;
                    let occurrence=clamped_month_date(month_anchor,0)?;
                    let desired=if day<=28{occurrence}else{
                        let next=if first.month()==12{NaiveDate::from_ymd_opt(first.year()+1,1,1)}else{NaiveDate::from_ymd_opt(first.year(),first.month()+1,1)}.ok_or("Recurrence date is out of range")?;
                        NaiveDate::from_ymd_opt(first.year(),first.month(),day.min((next-ChronoDuration::days(1)).day())).ok_or("Recurrence date is out of range")?
                    };
                    if desired>=anchor&&desired>=from&&desired<=end{dates.push(desired);}
                }
                offset+=1;
            }
        },
        "custom"=>{
            let count=template.custom_interval_count.ok_or("Stored custom schedule is incomplete")? as i64;
            match template.custom_interval_unit.as_deref(){
                Some("days")|Some("weeks")=>{
                    let step=count*if template.custom_interval_unit.as_deref()==Some("weeks"){7}else{1};
                    let elapsed=(from-anchor).num_days();
                    let mut occurrence=anchor+ChronoDuration::days(if elapsed<=0{0}else{(elapsed+step-1)/step*step});
                    while occurrence<=end{dates.push(occurrence);occurrence+=ChronoDuration::days(step);}
                },
                Some("months")|Some("years")=>{
                    let interval=(count as i32)*if template.custom_interval_unit.as_deref()==Some("years"){12}else{1};
                    let month_difference=(from.year()-anchor.year())*12+from.month0() as i32-anchor.month0() as i32;
                    let mut step=(month_difference.div_euclid(interval)-1).max(0);
                    loop{let occurrence=clamped_month_date(anchor,step*interval)?;if occurrence>end{break;}if occurrence>=anchor&&occurrence>=from{dates.push(occurrence);}step+=1;}
                },
                _=>return Err("Stored custom schedule has an invalid unit".into())
            }
        },
        _=>return Err("Stored schedule has an invalid frequency".into())
    }
    dates.sort_unstable();
    dates.dedup();
    if dates.len()>10_000{return Err("A recurrence window cannot exceed 10,000 occurrences".into());}
    Ok(dates)
}

fn parse_occurrence_query(request:&ScheduledOccurrenceQuery)->Result<(NaiveDate,NaiveDate),String>{
    let from=NaiveDate::parse_from_str(&request.from_date,"%Y-%m-%d").map_err(|_|"From date must be a valid YYYY-MM-DD date")?;
    let to=NaiveDate::parse_from_str(&request.to_date,"%Y-%m-%d").map_err(|_|"To date must be a valid YYYY-MM-DD date")?;
    if from>to{return Err("Occurrence date range is invalid".into());}
    Ok((from,to))
}

#[tauri::command]
fn list_scheduled_transactions(state:State<DbState>)->Result<Vec<ScheduledTransaction>,String>{
    let connection=state.0.lock().map_err(|_|"Database lock failed".to_string())?;
    let mut statement=connection.prepare("SELECT id,kind,account_id,transfer_account_id,payee,category,amount_minor,status,memo,frequency,anchor_date,end_date,second_month_day,custom_interval_count,custom_interval_unit,enabled FROM scheduled_transactions WHERE archived_at IS NULL ORDER BY created_at,id").map_err(|e|e.to_string())?;
    let rows=statement.query_map([],scheduled_transaction_from_row).map_err(|e|e.to_string())?;
    rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())
}

fn insert_scheduled_transaction(connection:&Connection,item:&ScheduledTransaction)->Result<(),String>{
    connection.execute("INSERT INTO scheduled_transactions(id,kind,account_id,transfer_account_id,payee,category,amount_minor,status,memo,frequency,anchor_date,end_date,second_month_day,custom_interval_count,custom_interval_unit,enabled) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",params![item.id,item.kind,item.account_id,item.transfer_account_id,item.payee,item.category,item.amount_minor,item.status,item.memo,item.frequency,item.anchor_date,item.end_date,item.second_month_day,item.custom_interval_count,item.custom_interval_unit,item.enabled]).map_err(|e|e.to_string())?;
    Ok(())
}

#[tauri::command]
fn create_scheduled_transaction(request:ScheduledTransactionRequest,state:State<DbState>)->Result<ScheduledTransaction,String>{
    let connection=state.0.lock().map_err(|_|"Database lock failed".to_string())?;
    let item=clean_scheduled_transaction(&connection,request,Uuid::new_v4().to_string())?;
    insert_scheduled_transaction(&connection,&item)?;
    Ok(item)
}

#[tauri::command]
fn update_scheduled_transaction(scheduled_transaction_id:String,request:ScheduledTransactionRequest,state:State<DbState>)->Result<ScheduledTransaction,String>{
    let mut connection=state.0.lock().map_err(|_|"Database lock failed".to_string())?;
    let id=clean_required(scheduled_transaction_id,"Scheduled transaction",80)?;
    let item=clean_scheduled_transaction(&connection,request,id)?;
    let tx=connection.transaction().map_err(|e|e.to_string())?;
    let changed=tx.execute("UPDATE scheduled_transactions SET kind=?2,account_id=?3,transfer_account_id=?4,payee=?5,category=?6,amount_minor=?7,status=?8,memo=?9,frequency=?10,anchor_date=?11,end_date=?12,second_month_day=?13,custom_interval_count=?14,custom_interval_unit=?15,enabled=?16,modified_at=CURRENT_TIMESTAMP WHERE id=?1 AND archived_at IS NULL",params![item.id,item.kind,item.account_id,item.transfer_account_id,item.payee,item.category,item.amount_minor,item.status,item.memo,item.frequency,item.anchor_date,item.end_date,item.second_month_day,item.custom_interval_count,item.custom_interval_unit,item.enabled]).map_err(|e|e.to_string())?;
    if changed!=1{return Err("Scheduled transaction does not exist".into());}
    tx.execute("DELETE FROM scheduled_occurrences WHERE scheduled_transaction_id=?1 AND status='expected'",params![item.id]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e|e.to_string())?;
    Ok(item)
}

#[tauri::command]
fn delete_scheduled_transaction(scheduled_transaction_id:String,state:State<DbState>)->Result<(),String>{
    let mut connection=state.0.lock().map_err(|_|"Database lock failed".to_string())?;
    let id=clean_required(scheduled_transaction_id,"Scheduled transaction",80)?;
    let tx=connection.transaction().map_err(|e|e.to_string())?;
    if tx.execute("UPDATE scheduled_transactions SET archived_at=CURRENT_TIMESTAMP,enabled=0,modified_at=CURRENT_TIMESTAMP WHERE id=?1 AND archived_at IS NULL",params![id]).map_err(|e|e.to_string())?!=1{return Err("Scheduled transaction does not exist".into());}
    tx.execute("DELETE FROM scheduled_occurrences WHERE scheduled_transaction_id=?1 AND status='expected'",params![id]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e|e.to_string())
}

fn generate_scheduled_occurrences_inner(connection:&mut Connection,request:ScheduledOccurrenceQuery)->Result<usize,String>{
    let (from,to)=parse_occurrence_query(&request)?;
    let mut statement=connection.prepare("SELECT id,kind,account_id,transfer_account_id,payee,category,amount_minor,status,memo,frequency,anchor_date,end_date,second_month_day,custom_interval_count,custom_interval_unit,enabled FROM scheduled_transactions WHERE archived_at IS NULL AND enabled=1 AND (?1 IS NULL OR id=?1) ORDER BY id").map_err(|e|e.to_string())?;
    let rows=statement.query_map(params![request.scheduled_transaction_id],scheduled_transaction_from_row).map_err(|e|e.to_string())?;
    let templates=rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
    drop(statement);
    if request.scheduled_transaction_id.is_some()&&templates.is_empty(){return Err("Scheduled transaction does not exist or is disabled".into());}
    let tx=connection.transaction().map_err(|e|e.to_string())?;
    let mut created=0;
    for template in templates{
        for due in generate_scheduled_dates(&template,from,to)?{
            created+=tx.execute("INSERT OR IGNORE INTO scheduled_occurrences(id,scheduled_transaction_id,due_date,status) VALUES(?1,?2,?3,'expected')",params![Uuid::new_v4().to_string(),template.id,due.format("%Y-%m-%d").to_string()]).map_err(|e|e.to_string())?;
        }
    }
    tx.commit().map_err(|e|e.to_string())?;
    Ok(created)
}

#[tauri::command]
fn generate_scheduled_occurrences(request:ScheduledOccurrenceQuery,state:State<DbState>)->Result<usize,String>{
    let mut connection=state.0.lock().map_err(|_|"Database lock failed".to_string())?;
    generate_scheduled_occurrences_inner(&mut connection,request)
}

#[tauri::command]
fn list_scheduled_occurrences(request:ScheduledOccurrenceQuery,state:State<DbState>)->Result<Vec<ScheduledOccurrence>,String>{
    parse_occurrence_query(&request)?;
    let connection=state.0.lock().map_err(|_|"Database lock failed".to_string())?;
    let mut statement=connection.prepare("SELECT id,scheduled_transaction_id,due_date,status,transaction_id FROM scheduled_occurrences WHERE due_date BETWEEN ?1 AND ?2 AND (?3 IS NULL OR scheduled_transaction_id=?3) ORDER BY due_date,id").map_err(|e|e.to_string())?;
    let rows=statement.query_map(params![request.from_date,request.to_date,request.scheduled_transaction_id],scheduled_occurrence_from_row).map_err(|e|e.to_string())?;
    rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())
}

fn load_expected_occurrence(connection:&Connection,id:&str)->Result<(ScheduledOccurrence,ScheduledTransaction),String>{
    let occurrence:Option<ScheduledOccurrence>=connection.query_row("SELECT id,scheduled_transaction_id,due_date,status,transaction_id FROM scheduled_occurrences WHERE id=?1",params![id],scheduled_occurrence_from_row).optional().map_err(|e|e.to_string())?;
    let occurrence=occurrence.ok_or("Scheduled occurrence does not exist")?;
    if occurrence.status!="expected"{return Err("Only expected occurrences can be changed".into());}
    let template=connection.query_row("SELECT id,kind,account_id,transfer_account_id,payee,category,amount_minor,status,memo,frequency,anchor_date,end_date,second_month_day,custom_interval_count,custom_interval_unit,enabled FROM scheduled_transactions WHERE id=?1",params![occurrence.scheduled_transaction_id],scheduled_transaction_from_row).map_err(|e|e.to_string())?;
    Ok((occurrence,template))
}

fn post_scheduled_occurrence_inner(connection:&mut Connection,occurrence_id:String)->Result<LedgerTransaction,String>{
    let id=clean_required(occurrence_id,"Scheduled occurrence",80)?;
    let tx=connection.transaction().map_err(|e|e.to_string())?;
    let (occurrence,template)=load_expected_occurrence(&tx,&id)?;
    if template.kind=="transfer"{return Err("Recurring transfer posting is not implemented yet".into());}
    let item=clean_transaction_request(CreateTransactionRequest{account_id:template.account_id,posted_date:occurrence.due_date,payee:template.payee,category:template.category,amount_minor:template.amount_minor,status:template.status,memo:template.memo,splits:None})?;
    tx.execute("INSERT INTO transactions(id,account_id,posted_date,payee,category,amount_minor,status,memo,source) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'manual')",params![item.id,item.account_id,item.posted_date,item.payee,item.category,item.amount_minor,item.status,item.memo]).map_err(|e|e.to_string())?;
    if tx.execute("UPDATE scheduled_occurrences SET status='posted',transaction_id=?2,modified_at=CURRENT_TIMESTAMP WHERE id=?1 AND status='expected'",params![id,item.id]).map_err(|e|e.to_string())?!=1{return Err("Scheduled occurrence changed before it could be posted".into());}
    tx.commit().map_err(|e|e.to_string())?;
    Ok(item)
}

#[tauri::command]
fn post_scheduled_occurrence(occurrence_id:String,state:State<DbState>)->Result<LedgerTransaction,String>{
    let mut connection=state.0.lock().map_err(|_|"Database lock failed".to_string())?;
    post_scheduled_occurrence_inner(&mut connection,occurrence_id)
}

fn skip_scheduled_occurrence_inner(connection:&Connection,occurrence_id:String)->Result<ScheduledOccurrence,String>{
    let id=clean_required(occurrence_id,"Scheduled occurrence",80)?;
    load_expected_occurrence(connection,&id)?;
    connection.execute("UPDATE scheduled_occurrences SET status='skipped',modified_at=CURRENT_TIMESTAMP WHERE id=?1 AND status='expected'",params![id]).map_err(|e|e.to_string())?;
    connection.query_row("SELECT id,scheduled_transaction_id,due_date,status,transaction_id FROM scheduled_occurrences WHERE id=?1",params![id],scheduled_occurrence_from_row).map_err(|e|e.to_string())
}

#[tauri::command]
fn skip_scheduled_occurrence(occurrence_id:String,state:State<DbState>)->Result<ScheduledOccurrence,String>{
    let connection=state.0.lock().map_err(|_|"Database lock failed".to_string())?;
    skip_scheduled_occurrence_inner(&connection,occurrence_id)
}

fn link_scheduled_occurrence_inner(connection:&mut Connection,occurrence_id:String,transaction_id:String)->Result<ScheduledOccurrence,String>{
    let occurrence_id=clean_required(occurrence_id,"Scheduled occurrence",80)?;
    let transaction_id=clean_required(transaction_id,"Transaction",80)?;
    let tx=connection.transaction().map_err(|e|e.to_string())?;
    let (_,template)=load_expected_occurrence(&tx,&occurrence_id)?;
    if template.kind=="transfer"{return Err("Recurring transfer linking is not implemented yet".into());}
    let transaction:Option<(String,i64)>=tx.query_row("SELECT account_id,amount_minor FROM transactions WHERE id=?1",params![transaction_id],|row|Ok((row.get(0)?,row.get(1)?))).optional().map_err(|e|e.to_string())?;
    let (account_id,amount_minor)=transaction.ok_or("Transaction does not exist")?;
    if account_id!=template.account_id||amount_minor!=template.amount_minor{return Err("Transaction account and amount must match the scheduled transaction".into());}
    let transfer:Option<i64>=tx.query_row("SELECT 1 FROM transfer_links WHERE from_transaction_id=?1 OR to_transaction_id=?1",params![transaction_id],|row|row.get(0)).optional().map_err(|e|e.to_string())?;
    if transfer.is_some(){return Err("Linked transfers cannot be matched to a scheduled transaction".into());}
    tx.execute("UPDATE scheduled_occurrences SET status='linked',transaction_id=?2,modified_at=CURRENT_TIMESTAMP WHERE id=?1 AND status='expected'",params![occurrence_id,transaction_id]).map_err(|e|e.to_string())?;
    let result=tx.query_row("SELECT id,scheduled_transaction_id,due_date,status,transaction_id FROM scheduled_occurrences WHERE id=?1",params![occurrence_id],scheduled_occurrence_from_row).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e|e.to_string())?;
    Ok(result)
}

#[tauri::command]
fn link_scheduled_occurrence(occurrence_id:String,transaction_id:String,state:State<DbState>)->Result<ScheduledOccurrence,String>{
    let mut connection=state.0.lock().map_err(|_|"Database lock failed".to_string())?;
    link_scheduled_occurrence_inner(&mut connection,occurrence_id,transaction_id)
}

fn matching_merchant_rule<'a>(rules:&'a [MerchantRule],payee:&str,amount_minor:i64)->Option<&'a MerchantRule>{
    let normalized=normalize_merchant(payee);
    rules.iter().find(|rule|{
        if !rule.enabled{return false;}
        if rule.direction=="expense"&&amount_minor>=0{return false;}
        if rule.direction=="income"&&amount_minor<=0{return false;}
        let pattern=normalize_merchant(&rule.pattern);
        match rule.match_type.as_str(){"exact"=>normalized==pattern,"starts_with"=>normalized.starts_with(&pattern),_=>normalized.contains(&pattern)}
    })
}

#[tauri::command]
fn create_transaction(request: CreateTransactionRequest, state: State<DbState>) -> Result<LedgerTransaction, String> {
    let mut connection = state.0.lock().map_err(|_| "Database lock failed".to_string())?;
    create_transaction_inner(&mut connection, request)
}

fn update_transaction_inner(connection: &mut Connection, transaction_id: String, request: CreateTransactionRequest) -> Result<LedgerTransaction, String> {
    let mut item = clean_transaction_request(request)?;
    let transaction_id = clean_required(transaction_id, "Transaction", 80)?;
    let tx = connection.transaction().map_err(|e| e.to_string())?;
    let reconciled: Option<i64> = tx.query_row("SELECT 1 FROM reconciliation_items WHERE transaction_id = ?1", params![transaction_id], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
    if reconciled.is_some() { return Err("Reconciled transactions cannot be edited".into()); }
    let scheduled: Option<i64> = tx.query_row("SELECT 1 FROM scheduled_occurrences WHERE transaction_id = ?1", params![transaction_id], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
    if scheduled.is_some() { return Err("Transactions linked to scheduled occurrences cannot be edited".into()); }
    let linked: Option<i64> = tx.query_row("SELECT 1 FROM transfer_links WHERE from_transaction_id = ?1 OR to_transaction_id = ?1", params![transaction_id], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
    if linked.is_some() { return Err("Linked transfers must be edited through the transfer editor".into()); }
    let existing: Option<(Option<String>, String, Option<String>, String)> = tx.query_row("SELECT external_id, source, import_batch_id, account_id FROM transactions WHERE id = ?1", params![transaction_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))).optional().map_err(|e| e.to_string())?;
    let (external_id, source, import_batch_id, existing_account_id) = existing.ok_or("Transaction does not exist")?;
    if import_batch_id.is_some() && item.account_id != existing_account_id { return Err("Imported transactions cannot be moved to another account; undo and re-import the batch instead".into()); }
    let account_exists: Option<i64> = tx.query_row("SELECT 1 FROM accounts WHERE id = ?1 AND archived_at IS NULL", params![item.account_id], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
    if account_exists.is_none() { return Err("Account does not exist".into()); }
    tx.execute("UPDATE transactions SET account_id=?2, posted_date=?3, payee=?4, category=?5, amount_minor=?6, status=?7, memo=?8, modified_at=CURRENT_TIMESTAMP WHERE id=?1", params![transaction_id, item.account_id, item.posted_date, item.payee, item.category, item.amount_minor, item.status, item.memo]).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM transaction_splits WHERE transaction_id = ?1", params![transaction_id]).map_err(|e| e.to_string())?;
    insert_transaction_splits(&tx, &transaction_id, &item.splits)?;
    tx.commit().map_err(|e| e.to_string())?;
    item.id = transaction_id;
    item.external_id = external_id;
    item.source = source;
    item.import_batch_id = import_batch_id;
    Ok(item)
}

#[tauri::command]
fn update_transaction(transaction_id: String, request: CreateTransactionRequest, state: State<DbState>) -> Result<LedgerTransaction, String> {
    let mut connection = state.0.lock().map_err(|_| "Database lock failed".to_string())?;
    update_transaction_inner(&mut connection, transaction_id, request)
}

fn delete_transaction_inner(connection: &Connection, transaction_id: String) -> Result<(), String> {
    let transaction_id = clean_required(transaction_id, "Transaction", 80)?;
    let reconciled: Option<i64> = connection.query_row("SELECT 1 FROM reconciliation_items WHERE transaction_id = ?1", params![transaction_id], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
    if reconciled.is_some() { return Err("Reconciled transactions cannot be deleted".into()); }
    let scheduled: Option<i64> = connection.query_row("SELECT 1 FROM scheduled_occurrences WHERE transaction_id = ?1", params![transaction_id], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
    if scheduled.is_some() { return Err("Transactions linked to scheduled occurrences cannot be deleted".into()); }
    let imported: Option<Option<String>> = connection.query_row("SELECT import_batch_id FROM transactions WHERE id = ?1", params![transaction_id], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
    let import_batch_id = imported.ok_or("Transaction does not exist")?;
    if import_batch_id.is_some() { return Err("Imported transactions must be removed by undoing their complete import batch".into()); }
    let linked: Option<i64> = connection.query_row("SELECT 1 FROM transfer_links WHERE from_transaction_id = ?1 OR to_transaction_id = ?1", params![transaction_id], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
    if linked.is_some() { return Err("Linked transfers must be removed through the transfer editor".into()); }
    connection.execute("DELETE FROM transactions WHERE id = ?1", params![transaction_id]).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn delete_transaction(transaction_id: String, state: State<DbState>) -> Result<(), String> {
    let connection = state.0.lock().map_err(|_| "Database lock failed".to_string())?;
    delete_transaction_inner(&connection, transaction_id)
}

fn import_transactions_inner(connection: &mut Connection, request: ImportTransactionsRequest) -> Result<ImportResult, String> {
    if request.rows.is_empty() { return Err("The import contains no transactions".into()); }
    if request.rows.len() > 10_000 { return Err("A single import is limited to 10,000 transactions".into()); }
    let source_name = clean_required(request.source_name, "Source filename", 255)?;
    let account_id = clean_required(request.account_id, "Account", 80)?;

    for row in &request.rows {
        if NaiveDate::parse_from_str(&row.posted_date, "%Y-%m-%d").is_err() { return Err(format!("Invalid import date: {}", row.posted_date)); }
        clean_required(row.payee.clone(), "Description/payee", 160)?;
        clean_optional(row.original_payee.clone(), 160)?;
        clean_optional(row.memo.clone(), 500)?;
        clean_optional(row.external_id.clone(), 255)?;
        clean_optional(row.category.clone(), 120)?;
        if let Some(splits) = &row.splits {
            if splits.is_empty() { return Err("Split transactions must contain at least one split".into()); }
            let mut split_total = 0_i64;
            for split in splits {
                clean_required(split.category.clone(), "Split category", 120)?;
                clean_optional(split.memo.clone(), 500)?;
                split_total = split_total.checked_add(split.amount_minor).ok_or("Split total is too large")?;
            }
            if split_total != row.amount_minor { return Err(format!("Split total does not equal the transaction amount for {}", row.posted_date)); }
        }
    }

    let tx = connection.transaction().map_err(|e| e.to_string())?;
    let account_exists: Option<i64> = tx.query_row("SELECT 1 FROM accounts WHERE id = ?1 AND archived_at IS NULL", params![account_id], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
    if account_exists.is_none() { return Err("Account does not exist".into()); }
    let merchant_rules=load_merchant_rules(&tx)?;

    let batch_id = Uuid::new_v4().to_string();
    let imported_count = request.rows.len();
    let original_total_minor: i64 = request.rows.iter().map(|row| row.amount_minor).try_fold(0_i64, |total, amount| total.checked_add(amount).ok_or("Import total is too large"))?;
    tx.execute("INSERT INTO import_batches(id, account_id, source_name, original_transaction_count, original_total_minor) VALUES(?1, ?2, ?3, ?4, ?5)", params![batch_id, account_id, source_name, imported_count as i64, original_total_minor]).map_err(|e| e.to_string())?;
    for row in request.rows {
        let original_payee=clean_required(row.original_payee.unwrap_or_else(||row.payee.clone()),"Description/payee",160)?;
        let matched_rule=matching_merchant_rule(&merchant_rules,&original_payee,row.amount_minor);
        let payee=matched_rule.and_then(|rule|rule.rename_to.clone()).unwrap_or_else(||row.payee.trim().to_string());
        let duplicate: Option<i64> = tx.query_row(
            "SELECT 1 FROM transactions WHERE account_id = ?1 AND ((?5 IS NOT NULL AND external_id = ?5) OR (posted_date = ?2 AND amount_minor = ?3 AND (lower(trim(COALESCE(original_payee,payee))) = lower(trim(?4)) OR lower(trim(payee)) = lower(trim(?4))))) LIMIT 1",
            params![account_id, row.posted_date, row.amount_minor, original_payee, row.external_id],
            |result| result.get(0)
        ).optional().map_err(|e| e.to_string())?;
        if duplicate.is_some() { return Err(format!("A matching transaction already exists for {}. Nothing was imported.", row.posted_date)); }
        let transaction_id = Uuid::new_v4().to_string();
        let source_category=row.category.as_deref().map(str::trim).filter(|value|!value.is_empty()&&*value!="Uncategorized");
        let category=source_category.or_else(||matched_rule.and_then(|rule|rule.category.as_deref())).unwrap_or("Uncategorized");
        tx.execute(
            "INSERT INTO transactions(id, account_id, posted_date, payee, original_payee, category, amount_minor, status, memo, source, import_batch_id, external_id) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, 'review', ?8, 'import', ?9, ?10)",
            params![transaction_id, account_id, row.posted_date, payee, original_payee, category, row.amount_minor, row.memo, batch_id, row.external_id]
        ).map_err(|e| e.to_string())?;
        if let Some(splits) = row.splits {
            for (index, split) in splits.into_iter().enumerate() {
                tx.execute(
                    "INSERT INTO transaction_splits(id, transaction_id, category, amount_minor, memo, sort_order) VALUES(?1, ?2, ?3, ?4, ?5, ?6)",
                    params![Uuid::new_v4().to_string(), transaction_id, split.category.trim(), split.amount_minor, split.memo, index as i64]
                ).map_err(|e| e.to_string())?;
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(ImportResult { batch_id, imported_count })
}

#[tauri::command]
fn import_transactions(request: ImportTransactionsRequest, state: State<DbState>) -> Result<ImportResult, String> {
    let mut connection = state.0.lock().map_err(|_| "Database lock failed".to_string())?;
    import_transactions_inner(&mut connection, request)
}

#[tauri::command]
fn list_import_batches(state: State<DbState>) -> Result<Vec<ImportBatch>, String> {
    let connection = state.0.lock().map_err(|_| "Database lock failed".to_string())?;
    let mut statement = connection.prepare("SELECT b.id, b.account_id, a.name, b.source_name, b.imported_at, b.undone_at, b.original_transaction_count, b.original_total_minor FROM import_batches b JOIN accounts a ON a.id = b.account_id ORDER BY b.imported_at DESC, b.id DESC LIMIT 200").map_err(|e| e.to_string())?;
    let rows = statement.query_map([], |row| Ok(ImportBatch { id: row.get(0)?, account_id: row.get(1)?, account_name: row.get(2)?, source_name: row.get(3)?, imported_at: row.get(4)?, undone_at: row.get(5)?, transaction_count: row.get(6)?, total_minor: row.get(7)? })).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn undo_import_batch_inner(connection: &mut Connection, batch_id: &str) -> Result<UndoImportResult, String> {
    let tx = connection.transaction().map_err(|e| e.to_string())?;
    let batch: Option<(Option<String>, i64)> = tx.query_row("SELECT undone_at, original_transaction_count FROM import_batches WHERE id = ?1", params![batch_id], |row| Ok((row.get(0)?, row.get(1)?))).optional().map_err(|e| e.to_string())?;
    let (undone_at, expected_count) = batch.ok_or("Import batch does not exist")?;
    if undone_at.is_some() { return Err("This import has already been undone".into()); }
    let reconciled: Option<i64> = tx.query_row("SELECT 1 FROM reconciliation_items item JOIN transactions txn ON txn.id = item.transaction_id WHERE txn.import_batch_id = ?1 LIMIT 1", params![batch_id], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
    if reconciled.is_some() { return Err("This import contains reconciled transactions and cannot be undone".into()); }
    let scheduled: Option<i64> = tx.query_row("SELECT 1 FROM scheduled_occurrences occurrence JOIN transactions txn ON txn.id=occurrence.transaction_id WHERE txn.import_batch_id=?1 LIMIT 1",params![batch_id],|row|row.get(0)).optional().map_err(|e|e.to_string())?;
    if scheduled.is_some(){return Err("This import contains transactions linked to scheduled occurrences and cannot be undone".into());}
    let removed_count = tx.execute("DELETE FROM transactions WHERE import_batch_id = ?1", params![batch_id]).map_err(|e| e.to_string())?;
    if removed_count as i64 != expected_count { return Err("Import batch no longer matches its original transaction count; nothing was removed".into()); }
    tx.execute("UPDATE import_batches SET undone_at = CURRENT_TIMESTAMP WHERE id = ?1 AND undone_at IS NULL", params![batch_id]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(UndoImportResult { batch_id: batch_id.to_string(), removed_count })
}

#[tauri::command]
fn undo_import_batch(batch_id: String, state: State<DbState>) -> Result<UndoImportResult, String> {
    let mut connection = state.0.lock().map_err(|_| "Database lock failed".to_string())?;
    undo_import_batch_inner(&mut connection, &batch_id)
}

fn complete_reconciliation_inner(connection: &mut Connection, request: CompleteReconciliationRequest) -> Result<Reconciliation, String> {
    let account_id = clean_required(request.account_id, "Account", 80)?;
    if NaiveDate::parse_from_str(&request.statement_end_date, "%Y-%m-%d").is_err() { return Err("Statement end date must be a valid YYYY-MM-DD date".into()); }
    if request.transaction_ids.len() > 10_000 { return Err("A reconciliation is limited to 10,000 transactions".into()); }
    let unique_ids: HashSet<&str> = request.transaction_ids.iter().map(String::as_str).collect();
    if unique_ids.len() != request.transaction_ids.len() { return Err("A transaction was selected more than once".into()); }

    let tx = connection.transaction().map_err(|e| e.to_string())?;
    let account_exists: Option<i64> = tx.query_row("SELECT 1 FROM accounts WHERE id = ?1 AND archived_at IS NULL", params![account_id], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
    if account_exists.is_none() { return Err("Account does not exist".into()); }
    let existing: Option<i64> = tx.query_row("SELECT 1 FROM reconciliations WHERE account_id = ?1 AND statement_end_date = ?2", params![account_id, request.statement_end_date], |row| row.get(0)).optional().map_err(|e| e.to_string())?;
    if existing.is_some() { return Err("This account already has a reconciliation for that statement end date".into()); }

    let mut selected = Vec::with_capacity(request.transaction_ids.len());
    let mut adjustment_total_minor = 0_i64;
    for transaction_id in &request.transaction_ids {
        let item: Option<(String, String, i64, String, bool)> = tx.query_row(
            "SELECT account_id, posted_date, amount_minor, status, EXISTS(SELECT 1 FROM reconciliation_items item WHERE item.transaction_id = transactions.id) FROM transactions WHERE id = ?1",
            params![transaction_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))
        ).optional().map_err(|e| e.to_string())?;
        let (transaction_account_id, posted_date, amount_minor, status, already_reconciled) = item.ok_or("A selected transaction does not exist")?;
        if transaction_account_id != account_id { return Err("Every selected transaction must belong to the reconciled account".into()); }
        if posted_date > request.statement_end_date { return Err("A selected transaction is after the statement end date".into()); }
        if already_reconciled || status == "reconciled" { return Err("A selected transaction has already been reconciled".into()); }
        adjustment_total_minor = adjustment_total_minor.checked_add(amount_minor).ok_or("Reconciliation total is too large")?;
        selected.push((transaction_id, amount_minor, status));
    }
    let calculated_closing = request.opening_balance_minor.checked_add(adjustment_total_minor).ok_or("Reconciliation balance is too large")?;
    if calculated_closing != request.closing_balance_minor { return Err("Selected transactions do not match the statement closing balance".into()); }

    let reconciliation_id = Uuid::new_v4().to_string();
    tx.execute(
        "INSERT INTO reconciliations(id, account_id, statement_end_date, opening_balance_minor, closing_balance_minor) VALUES(?1, ?2, ?3, ?4, ?5)",
        params![reconciliation_id, account_id, request.statement_end_date, request.opening_balance_minor, request.closing_balance_minor]
    ).map_err(|e| e.to_string())?;
    for (transaction_id, amount_minor, status_before) in selected {
        tx.execute(
            "INSERT INTO reconciliation_items(reconciliation_id, transaction_id, amount_minor, status_before) VALUES(?1, ?2, ?3, ?4)",
            params![reconciliation_id, transaction_id, amount_minor, status_before]
        ).map_err(|e| e.to_string())?;
        tx.execute("UPDATE transactions SET status = 'reconciled', modified_at = CURRENT_TIMESTAMP WHERE id = ?1", params![transaction_id]).map_err(|e| e.to_string())?;
    }
    let reconciled_at: String = tx.query_row("SELECT reconciled_at FROM reconciliations WHERE id = ?1", params![reconciliation_id], |row| row.get(0)).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(Reconciliation {
        id: reconciliation_id,
        account_id,
        statement_end_date: request.statement_end_date,
        opening_balance_minor: request.opening_balance_minor,
        closing_balance_minor: request.closing_balance_minor,
        reconciled_at,
        transaction_count: request.transaction_ids.len() as i64,
        adjustment_total_minor,
    })
}

#[tauri::command]
fn complete_reconciliation(request: CompleteReconciliationRequest, state: State<DbState>) -> Result<Reconciliation, String> {
    let mut connection = state.0.lock().map_err(|_| "Database lock failed".to_string())?;
    complete_reconciliation_inner(&mut connection, request)
}

#[tauri::command]
fn list_reconciliations(account_id: String, state: State<DbState>) -> Result<Vec<Reconciliation>, String> {
    let account_id = clean_required(account_id, "Account", 80)?;
    let connection = state.0.lock().map_err(|_| "Database lock failed".to_string())?;
    let mut statement = connection.prepare(
        "SELECT reconciliation.id, reconciliation.account_id, reconciliation.statement_end_date,
                reconciliation.opening_balance_minor, reconciliation.closing_balance_minor,
                reconciliation.reconciled_at, COUNT(item.transaction_id), COALESCE(SUM(item.amount_minor), 0)
         FROM reconciliations reconciliation
         LEFT JOIN reconciliation_items item ON item.reconciliation_id = reconciliation.id
         WHERE reconciliation.account_id = ?1
         GROUP BY reconciliation.id
         ORDER BY reconciliation.statement_end_date DESC, reconciliation.reconciled_at DESC"
    ).map_err(|e| e.to_string())?;
    let rows = statement.query_map(params![account_id], |row| Ok(Reconciliation {
        id: row.get(0)?,
        account_id: row.get(1)?,
        statement_end_date: row.get(2)?,
        opening_balance_minor: row.get(3)?,
        closing_balance_minor: row.get(4)?,
        reconciled_at: row.get(5)?,
        transaction_count: row.get(6)?,
        adjustment_total_minor: row.get(7)?,
    })).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

fn copy_database(source: &Connection, destination: &mut Connection) -> Result<(), String> {
    let backup = Backup::new(source, destination).map_err(|e| e.to_string())?;
    backup.run_to_completion(128, Duration::from_millis(5), None).map_err(|e| e.to_string())
}

fn temporary_database_path(label: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!("homeledger-{label}-{}.db", Uuid::new_v4()))
}

fn snapshot_database(connection: &Connection) -> Result<Vec<u8>, String> {
    let path = temporary_database_path("snapshot");
    let result = (|| {
        let mut destination = Connection::open(&path).map_err(|e| e.to_string())?;
        copy_database(connection, &mut destination)?;
        drop(destination);
        let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
        if bytes.len() > MAX_BACKUP_BYTES { return Err("The ledger is too large for a single backup file".into()); }
        Ok(bytes)
    })();
    let _ = std::fs::remove_file(path);
    result
}

fn validate_backup_database(connection: &Connection) -> Result<(), String> {
    let integrity: String = connection.query_row("PRAGMA integrity_check", [], |row| row.get(0)).map_err(|_| "The backup database could not be checked".to_string())?;
    if integrity != "ok" { return Err("The backup database is corrupt".into()); }
    let version: i64 = connection.query_row("SELECT COALESCE(MAX(version), 0) FROM schema_migrations", [], |row| row.get(0)).map_err(|_| "This is not a HomeLedger database".to_string())?;
    if !(1..=CURRENT_SCHEMA_VERSION).contains(&version) { return Err(format!("Backup schema version {version} is not supported by this version of HomeLedger")); }
    let application_id: i64 = connection.query_row("PRAGMA application_id", [], |row| row.get(0)).map_err(|e| e.to_string())?;
    if version >= 4 && application_id != HOMELEDGER_APPLICATION_ID { return Err("The backup does not have a valid HomeLedger database identity".into()); }
    let required_tables: i64 = connection.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('schema_migrations','households','household_members','accounts','import_batches','transactions','transaction_splits','transfer_links')",
        [], |row| row.get(0)
    ).map_err(|e| e.to_string())?;
    if required_tables != 8 { return Err("The backup is missing required HomeLedger tables".into()); }
    if version >= 6 {
        let reconciliation_tables: i64 = connection.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('reconciliations','reconciliation_items')",
            [], |row| row.get(0)
        ).map_err(|e| e.to_string())?;
        if reconciliation_tables != 2 { return Err("The backup is missing required reconciliation tables".into()); }
    }
    if version >= 7 {
        let merchant_tables:i64=connection.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='merchant_rules'",[],|row|row.get(0)).map_err(|e|e.to_string())?;
        if merchant_tables!=1{return Err("The backup is missing merchant rules".into());}
    }
    if version >= 8 {
        let profile_tables:i64=connection.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='import_profiles'",[],|row|row.get(0)).map_err(|e|e.to_string())?;
        if profile_tables!=1{return Err("The backup is missing import profiles".into());}
    }
    if version >= 10 {
        let scheduled_tables:i64=connection.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('scheduled_transactions','scheduled_occurrences')",[],|row|row.get(0)).map_err(|e|e.to_string())?;
        if scheduled_tables!=2{return Err("The backup is missing scheduled transaction tables".into());}
    }
    let executable_schema_objects: i64 = connection.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type IN ('trigger','view')", [], |row| row.get(0)).map_err(|e| e.to_string())?;
    if executable_schema_objects != 0 { return Err("The backup contains unsupported database triggers or views".into()); }
    let mut statement = connection.prepare("PRAGMA foreign_key_check").map_err(|e| e.to_string())?;
    let mut rows = statement.query([]).map_err(|e| e.to_string())?;
    if rows.next().map_err(|e| e.to_string())?.is_some() { return Err("The backup contains invalid record relationships".into()); }
    Ok(())
}

fn open_backup_database(path: &Path) -> Result<Connection, String> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|_| "The decrypted backup is not a readable SQLite database".to_string())?;
    validate_backup_database(&connection)?;
    Ok(connection)
}

fn restore_database_inner(connection: &mut Connection, bytes: &[u8]) -> Result<RestoreResult, String> {
    if bytes.len() < 100 || bytes.len() > MAX_BACKUP_BYTES || !bytes.starts_with(b"SQLite format 3\0") { return Err("The decrypted data is not a valid SQLite backup".into()); }
    let source_path = temporary_database_path("restore-source");
    let rollback_path = temporary_database_path("restore-rollback");
    let result = (|| {
        std::fs::write(&source_path, bytes).map_err(|e| e.to_string())?;
        let source = open_backup_database(&source_path)?;
        {
            let mut rollback = Connection::open(&rollback_path).map_err(|e| e.to_string())?;
            copy_database(connection, &mut rollback)?;
        }
        if let Err(reason) = copy_database(&source, connection).and_then(|_| apply_migrations(connection)).and_then(|_| validate_backup_database(connection)) {
            if let Ok(rollback) = Connection::open_with_flags(&rollback_path, OpenFlags::SQLITE_OPEN_READ_ONLY) {
                let _ = copy_database(&rollback, connection);
            }
            return Err(format!("Restore failed; the existing ledger was retained: {reason}"));
        }
        let account_count = connection.query_row("SELECT COUNT(*) FROM accounts", [], |row| row.get(0)).map_err(|e| e.to_string())?;
        let transaction_count = connection.query_row("SELECT COUNT(*) FROM transactions", [], |row| row.get(0)).map_err(|e| e.to_string())?;
        Ok(RestoreResult { account_count, transaction_count })
    })();
    let _ = std::fs::remove_file(source_path);
    let _ = std::fs::remove_file(rollback_path);
    result
}

#[tauri::command]
fn export_backup_snapshot(state: State<DbState>) -> Result<String, String> {
    let connection = state.0.lock().map_err(|_| "Database lock failed".to_string())?;
    snapshot_database(&connection).map(|bytes| BASE64.encode(bytes))
}

#[tauri::command]
fn save_backup_file(contents: String, app: AppHandle) -> Result<bool, String> {
    if contents.len() > MAX_BACKUP_BYTES * 2 { return Err("The encrypted backup is too large".into()); }
    let Some(file) = app.dialog().file().add_filter("HomeLedger encrypted backup", &["hlb"]).set_file_name("HomeLedger-backup.hlb").blocking_save_file() else { return Ok(false); };
    let path = file.into_path().map_err(|_| "The selected backup destination is not a local file".to_string())?;
    std::fs::write(path, contents.as_bytes()).map_err(|e| format!("Could not write the backup: {e}"))?;
    Ok(true)
}

#[tauri::command]
fn choose_backup_file(app: AppHandle) -> Result<Option<String>, String> {
    let Some(file) = app.dialog().file().add_filter("HomeLedger encrypted backup", &["hlb"]).blocking_pick_file() else { return Ok(None); };
    let path = file.into_path().map_err(|_| "The selected backup is not a local file".to_string())?;
    let metadata = std::fs::metadata(&path).map_err(|e| format!("Could not inspect the backup: {e}"))?;
    if metadata.len() > (MAX_BACKUP_BYTES * 2) as u64 { return Err("The selected backup is too large".into()); }
    std::fs::read_to_string(path).map(Some).map_err(|_| "The selected file is not a valid encrypted HomeLedger backup".to_string())
}

#[tauri::command]
fn restore_backup_snapshot(snapshot_base64: String, state: State<DbState>) -> Result<RestoreResult, String> {
    let bytes = BASE64.decode(snapshot_base64).map_err(|_| "The decrypted backup payload is invalid".to_string())?;
    let mut connection = state.0.lock().map_err(|_| "Database lock failed".to_string())?;
    restore_database_inner(&mut connection, &bytes)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let mut connection = Connection::open(data_dir.join("homeledger.db"))?;
            apply_migrations(&mut connection).map_err(std::io::Error::other)?;
            app.manage(DbState(Mutex::new(connection)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![list_accounts, create_account, list_transactions, list_reconciliation_transactions, list_reconciliations, complete_reconciliation, create_transaction, update_transaction, delete_transaction, create_transfer, update_transfer, delete_transfer, list_merchant_rules, create_merchant_rule, update_merchant_rule, delete_merchant_rule, list_import_profiles, save_import_profile, delete_import_profile, list_scheduled_transactions, create_scheduled_transaction, update_scheduled_transaction, delete_scheduled_transaction, generate_scheduled_occurrences, list_scheduled_occurrences, post_scheduled_occurrence, skip_scheduled_occurrence, link_scheduled_occurrence, import_transactions, list_import_batches, undo_import_batch, export_backup_snapshot, save_backup_file, choose_backup_file, restore_backup_snapshot])
        .run(tauri::generate_context!())
        .expect("error while running HomeLedger");
}
