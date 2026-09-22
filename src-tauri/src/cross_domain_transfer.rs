//! Atomic ordinary ↔ investment cash transfers.
//! Orchestrates FinanceRepository ordinary ledger rows with Foundation
//! investment cash_transfer events without merging the two domains.

use crate::investment::{self, InvestmentEventRequest};
use crate::DbState;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CrossDomainCashTransferRequest {
    pub from_account_id: String,
    pub to_account_id: String,
    pub posted_date: String,
    pub payee: String,
    pub amount_minor: i64,
    pub status: String,
    pub memo: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CrossDomainCashTransferResult {
    pub link_id: String,
    pub ordinary_transaction_id: String,
    pub investment_event_id: String,
    pub direction: String,
}

struct ResolvedAccounts {
    ordinary_id: String,
    ordinary_name: String,
    investment_id: String,
    investment_name: String,
    currency: String,
    direction: &'static str,
    ordinary_amount_minor: i64,
    investment_cash_effect_minor: i64,
}

fn clean_required(value: String, label: &str, max: usize) -> Result<String, String> {
    let trimmed = value.trim().to_string();
    if trimmed.is_empty() {
        return Err(format!("{label} is required"));
    }
    if trimmed.chars().count() > max {
        return Err(format!("{label} is too long"));
    }
    Ok(trimmed)
}

fn clean_optional(value: Option<String>, max: usize) -> Result<Option<String>, String> {
    match value {
        None => Ok(None),
        Some(v) => {
            let trimmed = v.trim().to_string();
            if trimmed.is_empty() {
                Ok(None)
            } else if trimmed.chars().count() > max {
                Err("Memo is too long".into())
            } else {
                Ok(Some(trimmed))
            }
        }
    }
}

fn date(value: &str, label: &str) -> Result<(), String> {
    let parsed = chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| format!("{label} must use YYYY-MM-DD"))?;
    if parsed.format("%Y-%m-%d").to_string() != value {
        return Err(format!("{label} must use YYYY-MM-DD"));
    }
    Ok(())
}

fn clean_request(mut request: CrossDomainCashTransferRequest) -> Result<CrossDomainCashTransferRequest, String> {
    request.from_account_id = clean_required(request.from_account_id, "Source account", 80)?;
    request.to_account_id = clean_required(request.to_account_id, "Destination account", 80)?;
    date(&request.posted_date, "Transfer date")?;
    request.payee = clean_required(request.payee, "Description", 160)?;
    request.memo = clean_optional(request.memo, 500)?;
    if request.amount_minor <= 0 {
        return Err("Transfer amount must be greater than zero".into());
    }
    if !matches!(request.status.as_str(), "pending" | "cleared" | "review") {
        return Err("Unsupported transfer status".into());
    }
    if request.from_account_id == request.to_account_id {
        return Err("Source and destination accounts must differ".into());
    }
    Ok(request)
}

fn account_row(c: &Connection, id: &str) -> Result<(String, String, String, bool), String> {
    c.query_row(
        "SELECT name, currency, account_type, archived_at IS NOT NULL FROM accounts WHERE id=?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )
    .optional()
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Account does not exist".into())
}

fn resolve_accounts(c: &Connection, from_id: &str, to_id: &str, amount_minor: i64) -> Result<ResolvedAccounts, String> {
    let (from_name, from_currency, from_type, from_archived) = account_row(c, from_id)?;
    let (to_name, to_currency, to_type, to_archived) = account_row(c, to_id)?;
    if from_archived || to_archived {
        return Err("Archived accounts cannot participate in transfers".into());
    }
    if from_currency != to_currency {
        return Err("Ordinary↔investment cash transfers require the same currency; FX accounting is not supported".into());
    }
    let from_inv = from_type == "investment";
    let to_inv = to_type == "investment";
    if from_inv == to_inv {
        if from_inv {
            return Err("Investment-to-investment cash transfers use the investment activity workflow".into());
        }
        return Err("Ordinary-to-ordinary transfers use the linked transfer workflow".into());
    }
    if from_inv {
        Ok(ResolvedAccounts {
            ordinary_id: to_id.into(),
            ordinary_name: to_name,
            investment_id: from_id.into(),
            investment_name: from_name,
            currency: from_currency,
            direction: "investment_to_ordinary",
            ordinary_amount_minor: amount_minor,
            investment_cash_effect_minor: -amount_minor,
        })
    } else {
        Ok(ResolvedAccounts {
            ordinary_id: from_id.into(),
            ordinary_name: from_name,
            investment_id: to_id.into(),
            investment_name: to_name,
            currency: from_currency,
            direction: "ordinary_to_investment",
            ordinary_amount_minor: -amount_minor,
            investment_cash_effect_minor: amount_minor,
        })
    }
}

fn map_investment_status(status: &str) -> String {
    status.to_string()
}

fn investment_event_request(resolved: &ResolvedAccounts, request: &CrossDomainCashTransferRequest) -> InvestmentEventRequest {
    InvestmentEventRequest {
        account_id: resolved.investment_id.clone(),
        event_type: "cash_transfer".into(),
        trade_date: request.posted_date.clone(),
        settlement_date: None,
        acquisition_date: None,
        security_id: None,
        related_account_id: Some(resolved.ordinary_id.clone()),
        quantity_e8: None,
        unit_price_e8: None,
        gross_cash_minor: None,
        cash_effect_minor: resolved.investment_cash_effect_minor,
        income_minor: 0,
        acquisition_funding_minor: 0,
        fee_minor: 0,
        basis_effect_minor: 0,
        split_numerator: None,
        split_denominator: None,
        status: map_investment_status(&request.status),
        source: "manual".into(),
        memo: request.memo.clone(),
        external_id: None,
        provenance: Some("Ordinary↔investment cash transfer".into()),
        group_id: None,
    }
}

fn insert_ordinary_leg(
    tx: &Connection,
    transaction_id: &str,
    resolved: &ResolvedAccounts,
    request: &CrossDomainCashTransferRequest,
) -> Result<(), String> {
    let category = format!("Transfer: {}", resolved.investment_name);
    let payee = if request.payee.trim().is_empty() {
        "Account transfer".into()
    } else {
        request.payee.clone()
    };
    tx.execute(
        "INSERT INTO transactions(id,account_id,posted_date,payee,category,amount_minor,status,memo,source) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'transfer')",
        params![
            transaction_id,
            resolved.ordinary_id,
            request.posted_date,
            payee,
            category,
            resolved.ordinary_amount_minor,
            request.status,
            request.memo
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn create_cross_domain_cash_transfer_inner(
    connection: &mut Connection,
    request: CrossDomainCashTransferRequest,
) -> Result<CrossDomainCashTransferResult, String> {
    let request = clean_request(request)?;
    let resolved = resolve_accounts(connection, &request.from_account_id, &request.to_account_id, request.amount_minor)?;
    if !investment::account_has_settings(connection, &resolved.investment_id)? {
        return Err("Investment account has no settings".into());
    }
    let tx = connection.transaction().map_err(|e| e.to_string())?;
    let link_id = Uuid::new_v4().to_string();
    let ordinary_transaction_id = Uuid::new_v4().to_string();
    let investment_event_id = Uuid::new_v4().to_string();

    insert_ordinary_leg(&tx, &ordinary_transaction_id, &resolved, &request)?;
    let mut event = investment_event_request(&resolved, &request);
    event.group_id = Some(link_id.clone());
    investment::insert_linked_ordinary_cash_transfer(&tx, &investment_event_id, &event)?;

    tx.execute(
        "INSERT INTO ordinary_investment_cash_transfers(id,ordinary_transaction_id,investment_event_id,ordinary_account_id,investment_account_id,direction,amount_minor) VALUES(?1,?2,?3,?4,?5,?6,?7)",
        params![
            link_id,
            ordinary_transaction_id,
            investment_event_id,
            resolved.ordinary_id,
            resolved.investment_id,
            resolved.direction,
            request.amount_minor
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    let _ = resolved.currency;
    Ok(CrossDomainCashTransferResult {
        link_id,
        ordinary_transaction_id,
        investment_event_id,
        direction: resolved.direction.into(),
    })
}

fn load_link(tx: &Connection, link_id: &str) -> Result<(String, String, String, String, String), String> {
    tx.query_row(
        "SELECT ordinary_transaction_id,investment_event_id,ordinary_account_id,investment_account_id,direction FROM ordinary_investment_cash_transfers WHERE id=?1",
        [link_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
    )
    .optional()
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "Ordinary↔investment cash transfer does not exist".into())
}

fn assert_editable(tx: &Connection, ordinary_transaction_id: &str, investment_event_id: &str) -> Result<(), String> {
    let reconciled: Option<i64> = tx
        .query_row(
            "SELECT 1 FROM reconciliation_items WHERE transaction_id=?1 LIMIT 1",
            [ordinary_transaction_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if reconciled.is_some() {
        return Err("A reconciled ordinary↔investment cash transfer cannot be rewritten".into());
    }
    let status: String = tx
        .query_row(
            "SELECT r.status FROM investment_events e JOIN investment_event_revisions r ON r.id=e.current_revision_id WHERE e.id=?1",
            [investment_event_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !matches!(status.as_str(), "pending" | "review") {
        return Err("Cleared or reconciled investment-linked transfers cannot be rewritten. Record an opposite transfer to reverse the cash movement.".into());
    }
    Ok(())
}

pub(crate) fn update_cross_domain_cash_transfer_inner(
    connection: &mut Connection,
    link_id: String,
    request: CrossDomainCashTransferRequest,
) -> Result<CrossDomainCashTransferResult, String> {
    let link_id = clean_required(link_id, "Transfer", 80)?;
    let request = clean_request(request)?;
    let resolved = resolve_accounts(connection, &request.from_account_id, &request.to_account_id, request.amount_minor)?;
    let tx = connection.transaction().map_err(|e| e.to_string())?;
    let (ordinary_transaction_id, investment_event_id, _old_ordinary, old_investment, _old_direction) = load_link(&tx, &link_id)?;
    if old_investment != resolved.investment_id {
        return Err("Cross-domain transfer investment account cannot be changed".into());
    }
    assert_editable(&tx, &ordinary_transaction_id, &investment_event_id)?;

    let category = format!("Transfer: {}", resolved.investment_name);
    let updated = tx
        .execute(
            "UPDATE transactions SET account_id=?2,posted_date=?3,payee=?4,category=?5,amount_minor=?6,status=?7,memo=?8,modified_at=CURRENT_TIMESTAMP WHERE id=?1 AND source='transfer'",
            params![
                ordinary_transaction_id,
                resolved.ordinary_id,
                request.posted_date,
                request.payee,
                category,
                resolved.ordinary_amount_minor,
                request.status,
                request.memo
            ],
        )
        .map_err(|e| e.to_string())?;
    if updated != 1 {
        return Err("Ordinary transfer leg is incomplete; nothing was changed".into());
    }

    let mut event = investment_event_request(&resolved, &request);
    event.group_id = Some(link_id.clone());
    investment::update_pending_linked_ordinary_cash_transfer(&tx, &investment_event_id, &event)?;

    tx.execute(
        "UPDATE ordinary_investment_cash_transfers SET ordinary_account_id=?2,investment_account_id=?3,direction=?4,amount_minor=?5 WHERE id=?1",
        params![link_id, resolved.ordinary_id, resolved.investment_id, resolved.direction, request.amount_minor],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(CrossDomainCashTransferResult {
        link_id,
        ordinary_transaction_id,
        investment_event_id,
        direction: resolved.direction.into(),
    })
}

pub(crate) fn delete_cross_domain_cash_transfer_inner(connection: &mut Connection, link_id: String) -> Result<(), String> {
    let link_id = clean_required(link_id, "Transfer", 80)?;
    let tx = connection.transaction().map_err(|e| e.to_string())?;
    let (ordinary_transaction_id, investment_event_id, _, _, _) = load_link(&tx, &link_id)?;
    assert_editable(&tx, &ordinary_transaction_id, &investment_event_id)?;
    tx.execute("DELETE FROM ordinary_investment_cash_transfers WHERE id=?1", [&link_id])
        .map_err(|e| e.to_string())?;
    let removed = tx
        .execute(
            "DELETE FROM transactions WHERE id=?1 AND source='transfer'",
            [&ordinary_transaction_id],
        )
        .map_err(|e| e.to_string())?;
    if removed != 1 {
        return Err("Ordinary transfer leg is incomplete; nothing was deleted".into());
    }
    investment::delete_pending_linked_ordinary_cash_transfer(&tx, &investment_event_id)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn create_ordinary_investment_cash_transfer(
    request: CrossDomainCashTransferRequest,
    state: State<DbState>,
) -> Result<CrossDomainCashTransferResult, String> {
    let mut c = state.0.lock().map_err(|_| "Database lock failed".to_string())?;
    create_cross_domain_cash_transfer_inner(&mut c, request)
}

#[tauri::command]
pub fn update_ordinary_investment_cash_transfer(
    transfer_id: String,
    request: CrossDomainCashTransferRequest,
    state: State<DbState>,
) -> Result<CrossDomainCashTransferResult, String> {
    let mut c = state.0.lock().map_err(|_| "Database lock failed".to_string())?;
    update_cross_domain_cash_transfer_inner(&mut c, transfer_id, request)
}

#[tauri::command]
pub fn delete_ordinary_investment_cash_transfer(transfer_id: String, state: State<DbState>) -> Result<(), String> {
    let mut c = state.0.lock().map_err(|_| "Database lock failed".to_string())?;
    delete_cross_domain_cash_transfer_inner(&mut c, transfer_id)
}

pub(crate) fn lookup_cross_domain_link(
    c: &Connection,
    transaction_id: &str,
) -> Result<Option<(String, String)>, String> {
    c.query_row(
        "SELECT id, investment_account_id FROM ordinary_investment_cash_transfers WHERE ordinary_transaction_id=?1",
        [transaction_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub(crate) fn transaction_is_cross_domain_linked(c: &Connection, transaction_id: &str) -> Result<bool, String> {
    let found: Option<i64> = c
        .query_row(
            "SELECT 1 FROM ordinary_investment_cash_transfers WHERE ordinary_transaction_id=?1",
            [transaction_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(found.is_some())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::apply_migrations;
    use crate::investment::{create_event_inner, snapshot_inner, SCALE_E8};

    fn db() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        apply_migrations(&mut c).unwrap();
        c.execute(
            "INSERT INTO accounts(id,name,account_type,currency,opening_balance_minor,owner_label) VALUES('checking','Checking','checking','USD',500000,'Household'),('inv','Brokerage','investment','USD',0,'Household'),('eur','Euro Checking','checking','EUR',100000,'Household')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO investment_account_settings(account_id,account_kind,tax_treatment,opening_cash_minor,opening_date) VALUES('inv','brokerage','taxable',100000,'2026-01-01')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO securities(id,security_type,name,symbol,currency) VALUES('sec','stock','Example','EX','USD')",
            [],
        )
        .unwrap();
        c
    }

    fn req(from: &str, to: &str, amount: i64) -> CrossDomainCashTransferRequest {
        CrossDomainCashTransferRequest {
            from_account_id: from.into(),
            to_account_id: to.into(),
            posted_date: "2026-09-22".into(),
            payee: "Account transfer".into(),
            amount_minor: amount,
            status: "cleared".into(),
            memo: None,
        }
    }

    #[test]
    fn ordinary_to_investment_moves_cash_without_income_or_security() {
        let mut c = db();
        let result = create_cross_domain_cash_transfer_inner(&mut c, req("checking", "inv", 100_00)).unwrap();
        assert_eq!(result.direction, "ordinary_to_investment");
        let ordinary: i64 = c
            .query_row(
                "SELECT amount_minor FROM transactions WHERE id=?1",
                [&result.ordinary_transaction_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(ordinary, -100_00);
        let source: String = c
            .query_row(
                "SELECT source FROM transactions WHERE id=?1",
                [&result.ordinary_transaction_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(source, "transfer");
        let cash = snapshot_inner(&c, Some(&["inv".into()]), "2026-09-22").unwrap().accounts[0].cash_minor;
        assert_eq!(cash, 100000 + 100_00);
        assert!(snapshot_inner(&c, Some(&["inv".into()]), "2026-09-22").unwrap().accounts[0].holdings.is_empty());
        let income: i64 = c
            .query_row(
                "SELECT income_minor FROM investment_event_revisions WHERE event_id=?1",
                [&result.investment_event_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(income, 0);
    }

    #[test]
    fn investment_to_ordinary_moves_cash_both_ways() {
        let mut c = db();
        let result = create_cross_domain_cash_transfer_inner(&mut c, req("inv", "checking", 50_00)).unwrap();
        assert_eq!(result.direction, "investment_to_ordinary");
        let ordinary: i64 = c
            .query_row(
                "SELECT amount_minor FROM transactions WHERE id=?1",
                [&result.ordinary_transaction_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(ordinary, 50_00);
        let cash = snapshot_inner(&c, Some(&["inv".into()]), "2026-09-22").unwrap().accounts[0].cash_minor;
        assert_eq!(cash, 100000 - 50_00);
    }

    #[test]
    fn currency_mismatch_and_same_domain_are_rejected() {
        let mut c = db();
        assert!(create_cross_domain_cash_transfer_inner(&mut c, req("checking", "eur", 10_00))
            .unwrap_err()
            .contains("same currency"));
        assert!(create_cross_domain_cash_transfer_inner(&mut c, req("checking", "checking", 10_00))
            .unwrap_err()
            .contains("must differ"));
        c.execute(
            "INSERT INTO accounts(id,name,account_type,currency,opening_balance_minor,owner_label) VALUES('inv2','Other','investment','USD',0,'Household')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO investment_account_settings(account_id,account_kind,tax_treatment,opening_cash_minor,opening_date) VALUES('inv2','brokerage','taxable',0,'2026-01-01')",
            [],
        )
        .unwrap();
        assert!(create_cross_domain_cash_transfer_inner(&mut c, req("inv", "inv2", 10_00))
            .unwrap_err()
            .contains("investment activity"));
    }

    #[test]
    fn standalone_investment_event_still_rejects_ordinary_destination() {
        let mut c = db();
        let mut event = InvestmentEventRequest {
            account_id: "inv".into(),
            event_type: "cash_transfer".into(),
            trade_date: "2026-09-22".into(),
            settlement_date: None,
            acquisition_date: None,
            security_id: None,
            related_account_id: Some("checking".into()),
            quantity_e8: None,
            unit_price_e8: None,
            gross_cash_minor: None,
            cash_effect_minor: -1000,
            income_minor: 0,
            acquisition_funding_minor: 0,
            fee_minor: 0,
            basis_effect_minor: 0,
            split_numerator: None,
            split_denominator: None,
            status: "cleared".into(),
            source: "manual".into(),
            memo: None,
            external_id: None,
            provenance: None,
            group_id: None,
        };
        assert!(create_event_inner(&mut c, event.clone())
            .unwrap_err()
            .contains("ordinary↔investment cash transfer"));
        // Ensure no half-written event remains.
        let count: i64 = c.query_row("SELECT COUNT(*) FROM investment_events", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);
        let _ = SCALE_E8;
        event.cash_effect_minor = -1;
    }

    #[test]
    fn household_net_worth_unchanged_by_cross_domain_cash_transfer() {
        let mut c = db();
        let before_checking: i64 = c
            .query_row(
                "SELECT opening_balance_minor + COALESCE((SELECT SUM(amount_minor) FROM transactions WHERE account_id='checking'),0) FROM accounts WHERE id='checking'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let before_inv = snapshot_inner(&c, Some(&["inv".into()]), "2026-09-22").unwrap().accounts[0].cash_minor;
        let before_total = before_checking + before_inv;
        create_cross_domain_cash_transfer_inner(&mut c, req("checking", "inv", 100_00)).unwrap();
        let after_checking: i64 = c
            .query_row(
                "SELECT opening_balance_minor + COALESCE((SELECT SUM(amount_minor) FROM transactions WHERE account_id='checking'),0) FROM accounts WHERE id='checking'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let after_inv = snapshot_inner(&c, Some(&["inv".into()]), "2026-09-22").unwrap().accounts[0].cash_minor;
        assert_eq!(after_checking, before_checking - 100_00);
        assert_eq!(after_inv, before_inv + 100_00);
        assert_eq!(after_checking + after_inv, before_total);
    }

    #[test]
    fn failed_create_and_update_leave_no_mismatched_halves() {
        let mut c = db();
        assert!(create_cross_domain_cash_transfer_inner(&mut c, req("checking", "missing", 10_00)).is_err());
        let links: i64 = c
            .query_row("SELECT COUNT(*) FROM ordinary_investment_cash_transfers", [], |r| r.get(0))
            .unwrap();
        let events: i64 = c.query_row("SELECT COUNT(*) FROM investment_events", [], |r| r.get(0)).unwrap();
        let txns: i64 = c
            .query_row("SELECT COUNT(*) FROM transactions WHERE source='transfer'", [], |r| r.get(0))
            .unwrap();
        assert_eq!((links, events, txns), (0, 0, 0));

        let mut pending = req("checking", "inv", 15_00);
        pending.status = "pending".into();
        let created = create_cross_domain_cash_transfer_inner(&mut c, pending).unwrap();
        assert!(update_cross_domain_cash_transfer_inner(&mut c, created.link_id.clone(), req("checking", "eur", 20_00))
            .unwrap_err()
            .contains("same currency"));
        let amount: i64 = c
            .query_row(
                "SELECT amount_minor FROM transactions WHERE id=?1",
                [&created.ordinary_transaction_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(amount, -15_00);
        let cash = snapshot_inner(&c, Some(&["inv".into()]), "2026-09-22").unwrap().accounts[0].cash_minor;
        assert_eq!(cash, 100000 + 15_00);
        let link_amount: i64 = c
            .query_row(
                "SELECT amount_minor FROM ordinary_investment_cash_transfers WHERE id=?1",
                [&created.link_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(link_amount, 15_00);
    }

    #[test]
    fn positive_amount_and_archived_accounts_are_rejected() {
        let mut c = db();
        assert!(create_cross_domain_cash_transfer_inner(&mut c, req("checking", "inv", 0))
            .unwrap_err()
            .contains("greater than zero"));
        c.execute("UPDATE accounts SET archived_at=CURRENT_TIMESTAMP WHERE id='inv'", []).unwrap();
        assert!(create_cross_domain_cash_transfer_inner(&mut c, req("checking", "inv", 10_00))
            .unwrap_err()
            .contains("Archived"));
    }

    #[test]
    fn pending_edit_and_delete_keep_both_sides_aligned() {
        let mut c = db();
        let mut pending = req("checking", "inv", 25_00);
        pending.status = "pending".into();
        let created = create_cross_domain_cash_transfer_inner(&mut c, pending.clone()).unwrap();
        let mut updated = req("checking", "inv", 40_00);
        updated.status = "pending".into();
        updated.memo = Some("Adjusted".into());
        let saved = update_cross_domain_cash_transfer_inner(&mut c, created.link_id.clone(), updated).unwrap();
        let amount: i64 = c
            .query_row(
                "SELECT amount_minor FROM transactions WHERE id=?1",
                [&saved.ordinary_transaction_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(amount, -40_00);
        let cash = snapshot_inner(&c, Some(&["inv".into()]), "2026-09-22").unwrap().accounts[0].cash_minor;
        assert_eq!(cash, 100000 + 40_00);
        delete_cross_domain_cash_transfer_inner(&mut c, saved.link_id).unwrap();
        let links: i64 = c
            .query_row("SELECT COUNT(*) FROM ordinary_investment_cash_transfers", [], |r| r.get(0))
            .unwrap();
        let events: i64 = c.query_row("SELECT COUNT(*) FROM investment_events", [], |r| r.get(0)).unwrap();
        let txns: i64 = c
            .query_row("SELECT COUNT(*) FROM transactions WHERE source='transfer'", [], |r| r.get(0))
            .unwrap();
        assert_eq!((links, events, txns), (0, 0, 0));
        assert_eq!(
            snapshot_inner(&c, Some(&["inv".into()]), "2026-09-22").unwrap().accounts[0].cash_minor,
            100000
        );
    }

    #[test]
    fn cleared_cross_domain_transfer_cannot_be_silently_rewritten() {
        let mut c = db();
        let created = create_cross_domain_cash_transfer_inner(&mut c, req("checking", "inv", 10_00)).unwrap();
        assert!(update_cross_domain_cash_transfer_inner(&mut c, created.link_id.clone(), req("checking", "inv", 20_00))
            .unwrap_err()
            .contains("cannot be rewritten"));
        assert!(delete_cross_domain_cash_transfer_inner(&mut c, created.link_id)
            .unwrap_err()
            .contains("cannot be rewritten"));
    }
}
