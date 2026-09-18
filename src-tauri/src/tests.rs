use super::{apply_migrations, clean_optional, clean_required, create_transaction_inner, create_transfer_inner, delete_transaction_inner, delete_transfer_inner, import_transactions_inner, restore_database_inner, snapshot_database, undo_import_batch_inner, update_transaction_inner, update_transfer_inner, CreateTransactionRequest, CreateTransactionSplitRequest, ImportTransactionRow, ImportTransactionSplit, ImportTransactionsRequest, TransferRequest};
use rusqlite::Connection;

#[test]
fn migration_creates_local_ledger_tables() {
    let mut connection = Connection::open_in_memory().unwrap();
    apply_migrations(&mut connection).unwrap();
    let count: i64 = connection
        .query_row("SELECT COUNT(*) FROM households", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 1);
    let application_id: i64 = connection.query_row("PRAGMA application_id", [], |row| row.get(0)).unwrap();
    assert_eq!(application_id, 1_212_957_767);
}

#[test]
fn input_cleaning_rejects_missing_required_values() {
    assert!(clean_required("  ".into(), "Name", 80).is_err());
    assert_eq!(clean_optional(Some("  ".into()), 80).unwrap(), None);
}

#[test]
fn statement_import_is_atomic_and_rejects_duplicates() {
    let mut connection = Connection::open_in_memory().unwrap();
    apply_migrations(&mut connection).unwrap();
    connection.execute("INSERT INTO accounts(id, name, account_type, currency, opening_balance_minor, owner_label) VALUES('a', 'Checking', 'checking', 'USD', 0, 'Household')", []).unwrap();
    let request = || ImportTransactionsRequest {
        account_id: "a".into(), source_name: "statement.csv".into(),
        rows: vec![ImportTransactionRow {
            posted_date: "2026-09-18".into(), payee: "Store".into(), amount_minor: -1250, memo: None,
            external_id: Some("bank-1".into()), category: Some("Split transaction".into()),
            splits: Some(vec![
                ImportTransactionSplit { category: "Food".into(), amount_minor: -1000, memo: None },
                ImportTransactionSplit { category: "Household".into(), amount_minor: -250, memo: Some("Supplies".into()) },
            ])
        }]
    };
    let imported = import_transactions_inner(&mut connection, request()).unwrap();
    assert_eq!(imported.imported_count, 1);
    assert!(import_transactions_inner(&mut connection, request()).is_err());
    let count: i64 = connection.query_row("SELECT COUNT(*) FROM transactions", [], |row| row.get(0)).unwrap();
    assert_eq!(count, 1);
    let split_count: i64 = connection.query_row("SELECT COUNT(*) FROM transaction_splits", [], |row| row.get(0)).unwrap();
    assert_eq!(split_count, 2);
    let imported_id: String = connection.query_row("SELECT id FROM transactions LIMIT 1", [], |row| row.get(0)).unwrap();
    assert!(delete_transaction_inner(&connection, imported_id).is_err());
    let undone = undo_import_batch_inner(&mut connection, &imported.batch_id).unwrap();
    assert_eq!(undone.removed_count, 1);
    assert!(undo_import_batch_inner(&mut connection, &imported.batch_id).is_err());
    let active_count: i64 = connection.query_row("SELECT COUNT(*) FROM transactions", [], |row| row.get(0)).unwrap();
    assert_eq!(active_count, 0);
    let remaining_splits: i64 = connection.query_row("SELECT COUNT(*) FROM transaction_splits", [], |row| row.get(0)).unwrap();
    assert_eq!(remaining_splits, 0);
}

#[test]
fn statement_import_rejects_unbalanced_splits_before_writing() {
    let mut connection = Connection::open_in_memory().unwrap();
    apply_migrations(&mut connection).unwrap();
    connection.execute("INSERT INTO accounts(id, name, account_type, currency, opening_balance_minor, owner_label) VALUES('a', 'Checking', 'checking', 'USD', 0, 'Household')", []).unwrap();
    let request = ImportTransactionsRequest {
        account_id: "a".into(), source_name: "bad.qif".into(),
        rows: vec![ImportTransactionRow {
            posted_date: "2026-09-18".into(), payee: "Store".into(), amount_minor: -1250, memo: None,
            external_id: None, category: Some("Split transaction".into()),
            splits: Some(vec![ImportTransactionSplit { category: "Food".into(), amount_minor: -1000, memo: None }])
        }]
    };
    assert!(import_transactions_inner(&mut connection, request).is_err());
    let count: i64 = connection.query_row("SELECT COUNT(*) FROM transactions", [], |row| row.get(0)).unwrap();
    assert_eq!(count, 0);
}

#[test]
fn manual_transaction_crud_preserves_balanced_splits() {
    let mut connection = Connection::open_in_memory().unwrap();
    apply_migrations(&mut connection).unwrap();
    connection.execute("INSERT INTO accounts(id, name, account_type, currency, opening_balance_minor, owner_label) VALUES('a', 'Checking', 'checking', 'USD', 0, 'Household')", []).unwrap();
    let transaction = create_transaction_inner(&mut connection, CreateTransactionRequest {
        account_id: "a".into(), posted_date: "2026-09-18".into(), payee: "Store".into(), category: "Ignored".into(),
        amount_minor: -3000, status: "cleared".into(), memo: None,
        splits: Some(vec![
            CreateTransactionSplitRequest { category: "Food".into(), amount_minor: -2000, memo: None },
            CreateTransactionSplitRequest { category: "Household".into(), amount_minor: -1000, memo: Some("Supplies".into()) },
        ])
    }).unwrap();
    assert_eq!(transaction.category, "Split transaction");
    assert_eq!(transaction.splits.len(), 2);
    let split_count: i64 = connection.query_row("SELECT COUNT(*) FROM transaction_splits WHERE transaction_id=?1", [&transaction.id], |row| row.get(0)).unwrap();
    assert_eq!(split_count, 2);

    let updated = update_transaction_inner(&mut connection, transaction.id.clone(), CreateTransactionRequest {
        account_id: "a".into(), posted_date: "2026-09-19".into(), payee: "Market".into(), category: "Food".into(),
        amount_minor: -2500, status: "reconciled".into(), memo: Some("Updated".into()), splits: None
    }).unwrap();
    assert_eq!(updated.category, "Food");
    let remaining_splits: i64 = connection.query_row("SELECT COUNT(*) FROM transaction_splits WHERE transaction_id=?1", [&transaction.id], |row| row.get(0)).unwrap();
    assert_eq!(remaining_splits, 0);
    delete_transaction_inner(&connection, transaction.id).unwrap();
    let remaining: i64 = connection.query_row("SELECT COUNT(*) FROM transactions", [], |row| row.get(0)).unwrap();
    assert_eq!(remaining, 0);
}

#[test]
fn linked_transfer_crud_is_atomic_and_balanced() {
    let mut connection = Connection::open_in_memory().unwrap();
    apply_migrations(&mut connection).unwrap();
    connection.execute("INSERT INTO accounts(id, name, account_type, currency, opening_balance_minor, owner_label) VALUES('from', 'Checking', 'checking', 'USD', 10000, 'Household'), ('to', 'Savings', 'savings', 'USD', 2000, 'Household')", []).unwrap();
    let request = |amount_minor| TransferRequest {
        from_account_id: "from".into(), to_account_id: "to".into(), posted_date: "2026-09-18".into(),
        payee: "Savings transfer".into(), amount_minor, status: "cleared".into(), memo: None,
    };
    let transfer = create_transfer_inner(&mut connection, request(2500)).unwrap();
    let count: i64 = connection.query_row("SELECT COUNT(*) FROM transactions WHERE id IN (?1, ?2)", [&transfer.from_transaction_id, &transfer.to_transaction_id], |row| row.get(0)).unwrap();
    let total: i64 = connection.query_row("SELECT SUM(amount_minor) FROM transactions WHERE id IN (?1, ?2)", [&transfer.from_transaction_id, &transfer.to_transaction_id], |row| row.get(0)).unwrap();
    assert_eq!((count, total), (2, 0));
    assert!(update_transaction_inner(&mut connection, transfer.from_transaction_id.clone(), CreateTransactionRequest {
        account_id: "from".into(), posted_date: "2026-09-18".into(), payee: "Invalid".into(), category: "Transfer".into(),
        amount_minor: -100, status: "cleared".into(), memo: None, splits: None,
    }).is_err());
    update_transfer_inner(&mut connection, transfer.link_id.clone(), request(1000)).unwrap();
    let amounts: (i64, i64) = connection.query_row("SELECT origin.amount_minor, destination.amount_minor FROM transfer_links link JOIN transactions origin ON origin.id=link.from_transaction_id JOIN transactions destination ON destination.id=link.to_transaction_id WHERE link.id=?1", [&transfer.link_id], |row| Ok((row.get(0)?, row.get(1)?))).unwrap();
    assert_eq!(amounts, (-1000, 1000));
    delete_transfer_inner(&mut connection, transfer.link_id).unwrap();
    let remaining: i64 = connection.query_row("SELECT COUNT(*) FROM transactions", [], |row| row.get(0)).unwrap();
    assert_eq!(remaining, 0);
}

#[test]
fn database_snapshot_restore_replaces_the_ledger_safely() {
    let mut connection = Connection::open_in_memory().unwrap();
    apply_migrations(&mut connection).unwrap();
    connection.execute("INSERT INTO accounts(id, name, account_type, currency, opening_balance_minor, owner_label) VALUES('original', 'Original', 'checking', 'USD', 100, 'Household')", []).unwrap();
    connection.execute("INSERT INTO transactions(id, account_id, posted_date, payee, category, amount_minor, status, source) VALUES('t', 'original', '2026-09-18', 'Store', 'Food', -25, 'cleared', 'manual')", []).unwrap();
    let snapshot = snapshot_database(&connection).unwrap();

    connection.execute("DELETE FROM transactions", []).unwrap();
    connection.execute("DELETE FROM accounts", []).unwrap();
    connection.execute("INSERT INTO accounts(id, name, account_type, currency, opening_balance_minor, owner_label) VALUES('later', 'Later', 'cash', 'USD', 0, 'Household')", []).unwrap();

    let restored = restore_database_inner(&mut connection, &snapshot).unwrap();
    assert_eq!(restored.account_count, 1);
    assert_eq!(restored.transaction_count, 1);
    let original: i64 = connection.query_row("SELECT COUNT(*) FROM accounts WHERE id = 'original'", [], |row| row.get(0)).unwrap();
    let later: i64 = connection.query_row("SELECT COUNT(*) FROM accounts WHERE id = 'later'", [], |row| row.get(0)).unwrap();
    assert_eq!((original, later), (1, 0));
}

#[test]
fn invalid_restore_does_not_modify_the_ledger() {
    let mut connection = Connection::open_in_memory().unwrap();
    apply_migrations(&mut connection).unwrap();
    connection.execute("INSERT INTO accounts(id, name, account_type, currency, opening_balance_minor, owner_label) VALUES('safe', 'Safe', 'checking', 'USD', 0, 'Household')", []).unwrap();
    assert!(restore_database_inner(&mut connection, b"not a database").is_err());
    let count: i64 = connection.query_row("SELECT COUNT(*) FROM accounts WHERE id = 'safe'", [], |row| row.get(0)).unwrap();
    assert_eq!(count, 1);
}
