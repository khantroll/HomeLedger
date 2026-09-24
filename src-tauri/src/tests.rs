use super::{apply_migrations, bulk_delete_transactions_inner, bulk_set_transaction_category_inner, bulk_update_transaction_status_inner, clean_optional, clean_required, clean_scheduled_transaction, complete_reconciliation_inner, create_savings_goal_inner, create_transaction_inner, create_transfer_inner, delete_savings_goal_inner, delete_transaction_inner, delete_transfer_inner, generate_scheduled_occurrences_inner, get_budget_month_inner, get_debt_plan_inner, import_transactions_inner, insert_scheduled_transaction, link_scheduled_occurrence_inner, list_savings_goals_inner, list_transactions_page_inner, merge_categories_inner, merge_payees_inner, post_scheduled_occurrence_inner, process_scheduled_auto_post_inner, query_transactions, refresh_label_memory, remove_unused_category_inner, remove_unused_payee_inner, rename_category_inner, rename_payee_inner, reorder_accounts_inner, restore_database_inner, save_debt_plan_inner, set_account_archived_inner, skip_scheduled_occurrence_inner, snapshot_database, undo_import_batch_inner, update_account_inner, update_savings_goal_inner, update_transaction_annotation_inner, update_transaction_inner, update_transfer_inner, validate_backup_database, workbook_cell_text, BulkSetTransactionCategoryRequest, BulkTransactionIdsRequest, BulkUpdateTransactionStatusRequest, CompleteReconciliationRequest, CreateTransactionRequest, CreateTransactionSplitRequest, DebtPlanRequest, DebtTerm, ImportTransactionRow, ImportTransactionSplit, ImportTransactionsRequest, SavingsGoalRequest, ScheduledAutoPostRequest, ScheduledOccurrenceQuery, ScheduledTransactionRequest, TransactionQuery, TransactionAnnotationRequest, TransferRequest, UpdateAccountRequest};
use calamine::Data;
use rusqlite::Connection;
use crate::investment::{snapshot_inner, SCALE_E8};

#[test]
fn workbook_cells_become_stable_import_text() {
    assert_eq!(workbook_cell_text(&Data::Int(42)), "42");
    assert_eq!(workbook_cell_text(&Data::Float(-12.5)), "-12.5");
    assert_eq!(workbook_cell_text(&Data::String(" Payee ".into())), " Payee ");
    assert_eq!(workbook_cell_text(&Data::Empty), "");
}

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
    let version: i64 = connection.query_row("SELECT MAX(version) FROM schema_migrations", [], |row| row.get(0)).unwrap();
    let reconciliation_tables: i64 = connection.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('reconciliations','reconciliation_items')", [], |row| row.get(0)).unwrap();
    let merchant_tables: i64 = connection.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='merchant_rules'", [], |row| row.get(0)).unwrap();
    let profile_tables: i64 = connection.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='import_profiles'", [], |row| row.get(0)).unwrap();
    let scheduled_tables: i64 = connection.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('scheduled_transactions','scheduled_occurrences')", [], |row| row.get(0)).unwrap();
    let budget_tables: i64 = connection.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('budget_categories','budget_allocations')", [], |row| row.get(0)).unwrap();
    let auto_post_columns:i64=connection.query_row("SELECT COUNT(*) FROM pragma_table_info('scheduled_transactions') WHERE name='auto_post'",[],|row|row.get(0)).unwrap();
    let debt_tables:i64=connection.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('debt_plan_settings','debt_terms')",[],|row|row.get(0)).unwrap();
    let savings_tables:i64=connection.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='savings_goals'",[],|row|row.get(0)).unwrap();
    let catalog_tables:i64=connection.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('categories','payees')",[],|row|row.get(0)).unwrap();
    let template_columns:i64=connection.query_row("SELECT COUNT(*) FROM pragma_table_info('import_profiles') WHERE name IN ('source_kind','source_signature','pdf_layout','workbook_sheet_name','workbook_header_row')",[],|row|row.get(0)).unwrap();
    let audit_tables:i64=connection.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='ai_analysis_audit'",[],|row|row.get(0)).unwrap();
    assert_eq!((version, reconciliation_tables, merchant_tables, profile_tables, scheduled_tables, budget_tables,auto_post_columns,debt_tables,savings_tables,catalog_tables,template_columns,audit_tables), (20, 2, 1, 1, 2, 2,1,2,1,2,5,1));
    let oict: i64 = connection.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='ordinary_investment_cash_transfers'", [], |row| row.get(0)).unwrap();
    assert_eq!(oict, 1);
}

#[test]
fn migration_upgrades_a_populated_version_five_ledger() {
    let mut connection = Connection::open_in_memory().unwrap();
    connection.execute_batch("PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, description TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);").unwrap();
    let migrations = [
        (1, "initial local ledger", include_str!("../migrations/001_initial.sql")),
        (2, "import history totals", include_str!("../migrations/002_import_history.sql")),
        (3, "provider transaction identifiers", include_str!("../migrations/003_external_transaction_ids.sql")),
        (4, "HomeLedger database identity", include_str!("../migrations/004_database_identity.sql")),
        (5, "transaction split ordering", include_str!("../migrations/005_split_order.sql")),
    ];
    for (version, description, sql) in migrations {
        connection.execute_batch(sql).unwrap();
        connection.execute("INSERT INTO schema_migrations(version, description) VALUES(?1, ?2)", (version, description)).unwrap();
    }
    connection.execute("INSERT INTO accounts(id, name, account_type, currency, opening_balance_minor, owner_label) VALUES('existing', 'Existing Checking', 'checking', 'USD', 10000, 'Household')", []).unwrap();
    connection.execute("INSERT INTO transactions(id, account_id, posted_date, payee, category, amount_minor, status, source) VALUES('existing-transaction', 'existing', '2026-01-15', 'Existing Payee', 'Existing Category', -2500, 'cleared', 'manual')", []).unwrap();

    apply_migrations(&mut connection).unwrap();

    let version: i64 = connection.query_row("SELECT MAX(version) FROM schema_migrations", [], |row| row.get(0)).unwrap();
    let preserved: (String, i64) = connection.query_row("SELECT payee, amount_minor FROM transactions WHERE id='existing-transaction'", [], |row| Ok((row.get(0)?, row.get(1)?))).unwrap();
    let locale_columns: i64 = connection.query_row("SELECT COUNT(*) FROM pragma_table_info('import_profiles') WHERE name IN ('date_order','number_format')", [], |row| row.get(0)).unwrap();
    assert_eq!(version, 20);
    assert_eq!(preserved, ("Existing Payee".into(), -2500));
    assert_eq!(locale_columns, 2);
}


fn migrate_fixture_through_v17(connection: &mut Connection) {
    connection.execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, description TEXT NOT NULL, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);").unwrap();
    let migrations = [
        (1, include_str!("../migrations/001_initial.sql")),
        (2, include_str!("../migrations/002_import_history.sql")),
        (3, include_str!("../migrations/003_external_transaction_ids.sql")),
        (4, include_str!("../migrations/004_database_identity.sql")),
        (5, include_str!("../migrations/005_split_order.sql")),
        (6, include_str!("../migrations/006_reconciliations.sql")),
        (7, include_str!("../migrations/007_merchant_rules.sql")),
        (8, include_str!("../migrations/008_import_profiles.sql")),
        (9, include_str!("../migrations/009_import_profile_locales.sql")),
        (10, include_str!("../migrations/010_scheduled_transactions.sql")),
        (11, include_str!("../migrations/011_budgets.sql")),
        (12, include_str!("../migrations/012_scheduled_auto_post.sql")),
        (13, include_str!("../migrations/013_debt_plans.sql")),
        (14, include_str!("../migrations/014_savings_goals.sql")),
        (15, include_str!("../migrations/015_shared_categories_payees.sql")),
        (16, include_str!("../migrations/016_statement_templates.sql")),
        (17, include_str!("../migrations/017_ai_analysis_audit.sql")),
    ];
    for (version, sql) in migrations {
        connection.execute_batch(sql).unwrap();
        connection.execute("INSERT INTO schema_migrations(version,description) VALUES(?1,'fixture')",[version]).unwrap();
    }
}

#[test]
fn migration_upgrades_populated_v17_without_breaking_account_foreign_keys() {
    let mut connection=Connection::open_in_memory().unwrap();
    migrate_fixture_through_v17(&mut connection);
    connection.execute("INSERT INTO accounts(id,name,account_type,currency,opening_balance_minor,owner_label) VALUES('a','Checking','checking','USD',10000,'Household'),('b','Loan','loan','USD',-5000,'Household')",[]).unwrap();
    connection.execute("INSERT INTO import_batches(id,account_id,source_name) VALUES('ib','a','fixture.csv')",[]).unwrap();
    connection.execute("INSERT INTO transactions(id,account_id,posted_date,payee,category,amount_minor,status,source,import_batch_id) VALUES('t','a','2026-01-01','Payee','Category',-100,'cleared','import','ib')",[]).unwrap();
    connection.execute("INSERT INTO reconciliations(id,account_id,statement_end_date,opening_balance_minor,closing_balance_minor) VALUES('rec','a','2026-01-31',10000,9900)",[]).unwrap();
    connection.execute("INSERT INTO import_profiles(id,name,account_id,header_signature,date_column,payee_column,amount_column,debit_column,credit_column) VALUES('profile','Profile','a','sig',0,1,2,-1,-1)",[]).unwrap();
    connection.execute("INSERT INTO scheduled_transactions(id,kind,account_id,transfer_account_id,payee,category,amount_minor,status,frequency,anchor_date) VALUES('sched','transfer','a','b','Transfer','Transfer',100,'cleared','monthly','2026-01-01')",[]).unwrap();
    connection.execute("INSERT INTO debt_terms(account_id,annual_rate_bps,minimum_payment_minor) VALUES('b',500,100)",[]).unwrap();
    connection.execute("INSERT INTO savings_goals(id,name,account_id,target_minor,target_date) VALUES('goal','Goal','a',50000,'2027-01-01')",[]).unwrap();

    apply_migrations(&mut connection).unwrap();

    let version:i64=connection.query_row("SELECT MAX(version) FROM schema_migrations",[],|r|r.get(0)).unwrap();
    let fk_count:i64=connection.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check",[],|r|r.get(0)).unwrap();
    let related:(i64,i64,i64,i64,i64,i64)=connection.query_row("SELECT (SELECT COUNT(*) FROM transactions WHERE account_id='a'),(SELECT COUNT(*) FROM import_batches WHERE account_id='a'),(SELECT COUNT(*) FROM reconciliations WHERE account_id='a'),(SELECT COUNT(*) FROM import_profiles WHERE account_id='a'),(SELECT COUNT(*) FROM debt_terms WHERE account_id='b'),(SELECT COUNT(*) FROM savings_goals WHERE account_id='a')",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?))).unwrap();
    connection.execute("INSERT INTO accounts(id,name,account_type,currency,opening_balance_minor,owner_label) VALUES('inv','Brokerage','investment','USD',0,'Household')",[]).unwrap();
    assert_eq!(version,20);
    assert_eq!(fk_count,0);
    assert_eq!(related,(1,1,1,1,1,1));
}

#[test]
fn input_cleaning_rejects_missing_required_values() {
    assert!(clean_required("  ".into(), "Name", 80).is_err());
    assert_eq!(clean_optional(Some("  ".into()), 80).unwrap(), None);
}

#[test]
fn shared_catalogs_remember_ledger_and_planning_labels() {
    let mut connection = Connection::open_in_memory().unwrap();
    apply_migrations(&mut connection).unwrap();
    connection.execute("INSERT INTO accounts(id, name, account_type, currency, opening_balance_minor, owner_label) VALUES('a', 'Checking', 'checking', 'USD', 0, 'Household')", []).unwrap();
    connection.execute("INSERT INTO transactions(id, account_id, posted_date, payee, category, amount_minor, status, source) VALUES('t', 'a', '2026-09-20', 'Neighborhood Market', 'Food: Groceries', -100, 'cleared', 'manual')", []).unwrap();
    connection.execute("INSERT INTO budget_categories(id, category) VALUES('budget', 'Home: Repairs')", []).unwrap();
    refresh_label_memory(&connection).unwrap();
    connection.execute("DELETE FROM transactions WHERE id='t'", []).unwrap();
    let categories: Vec<String> = connection.prepare("SELECT name FROM categories ORDER BY name").unwrap().query_map([], |row| row.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
    let payees: Vec<String> = connection.prepare("SELECT name FROM payees ORDER BY name").unwrap().query_map([], |row| row.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
    assert_eq!(categories, vec!["Food: Groceries", "Home: Repairs"]);
    assert_eq!(payees, vec!["Neighborhood Market"]);
}

#[test]
fn category_rename_and_merge_rewrite_authoritative_surfaces_atomically() {
    let mut connection = Connection::open_in_memory().unwrap();
    apply_migrations(&mut connection).unwrap();
    connection.execute("INSERT INTO accounts(id, name, account_type, currency, opening_balance_minor, owner_label) VALUES('a', 'Checking', 'checking', 'USD', 5000, 'Household')", []).unwrap();
    connection.execute("INSERT INTO transactions(id, account_id, posted_date, payee, original_payee, category, amount_minor, status, source, import_batch_id) VALUES('t1', 'a', '2026-08-01', 'Market', 'MARKET #1', 'Food: Groceries', -1000, 'cleared', 'import', NULL), ('t2', 'a', '2026-08-02', 'Cafe', NULL, 'Split transaction', -1500, 'cleared', 'manual', NULL), ('xfer', 'a', '2026-08-03', 'Savings', NULL, 'Transfer: Savings', -200, 'cleared', 'transfer', NULL)", []).unwrap();
    connection.execute("INSERT INTO transaction_splits(id, transaction_id, category, amount_minor, sort_order) VALUES('s1', 't2', 'Food: Groceries', -900, 0), ('s2', 't2', 'Food: Dining', -600, 1)", []).unwrap();
    connection.execute("INSERT INTO scheduled_transactions(id, kind, account_id, payee, category, amount_minor, status, frequency, anchor_date) VALUES('sched', 'transaction', 'a', 'Market', 'Food: Groceries', -500, 'cleared', 'monthly', '2026-08-01')", []).unwrap();
    connection.execute("INSERT INTO budget_categories(id, category, rollover_enabled) VALUES('groc', 'Food: Groceries', 1), ('dining', 'Food: Dining', 0)", []).unwrap();
    connection.execute("INSERT INTO budget_allocations(id, budget_category_id, month, planned_minor) VALUES('ag', 'groc', '2026-08', 4000), ('ad', 'dining', '2026-08', 2000)", []).unwrap();
    connection.execute("INSERT INTO merchant_rules(id, name, pattern, normalized_pattern, match_type, direction, rename_to, category, priority, enabled) VALUES('r1', 'Market groceries', 'MARKET', 'market', 'contains', 'expense', 'Market', 'Food: Groceries', 100, 1)", []).unwrap();
    refresh_label_memory(&connection).unwrap();

    let renamed = rename_category_inner(&mut connection, "Food: Groceries".into(), "Food: Market".into()).unwrap();
    assert_eq!(renamed.operation, "rename");
    assert_eq!((renamed.transactions, renamed.splits, renamed.schedules, renamed.budget_categories, renamed.merchant_rules), (1, 1, 1, 1, 1));
    let category: String = connection.query_row("SELECT category FROM transactions WHERE id='t1'", [], |r| r.get(0)).unwrap();
    assert_eq!(category, "Food: Market");
    let split: String = connection.query_row("SELECT category FROM transaction_splits WHERE id='s1'", [], |r| r.get(0)).unwrap();
    assert_eq!(split, "Food: Market");
    let transfer: String = connection.query_row("SELECT category FROM transactions WHERE id='xfer'", [], |r| r.get(0)).unwrap();
    assert_eq!(transfer, "Transfer: Savings");
    let original: Option<String> = connection.query_row("SELECT original_payee FROM transactions WHERE id='t1'", [], |r| r.get(0)).unwrap();
    assert_eq!(original.as_deref(), Some("MARKET #1"));
    let balance: i64 = connection.query_row("SELECT opening_balance_minor + COALESCE((SELECT SUM(amount_minor) FROM transactions),0) FROM accounts WHERE id='a'", [], |r| r.get(0)).unwrap();
    assert_eq!(balance, 5000 - 1000 - 1500 - 200);

    assert!(rename_category_inner(&mut connection, "Food: Market".into(), "Food: Dining".into()).unwrap_err().contains("use merge"));
    let merged = merge_categories_inner(&mut connection, "Food: Market".into(), "Food: Dining".into()).unwrap();
    assert_eq!(merged.operation, "merge");
    let remaining: i64 = connection.query_row("SELECT COUNT(*) FROM budget_categories WHERE category = 'Food: Market' COLLATE NOCASE", [], |r| r.get(0)).unwrap();
    assert_eq!(remaining, 0);
    let planned: i64 = connection.query_row("SELECT planned_minor FROM budget_allocations a JOIN budget_categories c ON c.id=a.budget_category_id WHERE c.category='Food: Dining' AND a.month='2026-08'", [], |r| r.get(0)).unwrap();
    assert_eq!(planned, 6000);
    let catalogs: Vec<String> = connection.prepare("SELECT name FROM categories WHERE archived_at IS NULL ORDER BY name COLLATE NOCASE").unwrap().query_map([], |r| r.get(0)).unwrap().collect::<Result<_,_>>().unwrap();
    assert!(catalogs.iter().any(|n| n == "Food: Dining"));
    assert!(!catalogs.iter().any(|n| n.eq_ignore_ascii_case("Food: Market")));
}

#[test]
fn payee_rename_merge_preserve_import_provenance_and_support_unused_cleanup() {
    let mut connection = Connection::open_in_memory().unwrap();
    apply_migrations(&mut connection).unwrap();
    connection.execute("INSERT INTO accounts(id, name, account_type, currency, opening_balance_minor, owner_label) VALUES('a', 'Checking', 'checking', 'USD', 0, 'Household')", []).unwrap();
    connection.execute("INSERT INTO transactions(id, account_id, posted_date, payee, original_payee, category, amount_minor, status, source) VALUES('t1', 'a', '2026-08-01', 'Corner Bakery', 'CORNER BAKERY #44', 'Food: Dining', -800, 'cleared', 'import'), ('t2', 'a', '2026-08-02', 'Corner Cafe', NULL, 'Food: Dining', -400, 'cleared', 'manual')", []).unwrap();
    connection.execute("INSERT INTO scheduled_transactions(id, kind, account_id, payee, category, amount_minor, status, frequency, anchor_date) VALUES('sched', 'transaction', 'a', 'Corner Bakery', 'Food: Dining', -800, 'cleared', 'monthly', '2026-08-01')", []).unwrap();
    connection.execute("INSERT INTO merchant_rules(id, name, pattern, normalized_pattern, match_type, direction, rename_to, category, priority, enabled) VALUES('r1', 'Bakery', 'CORNER BAKERY', 'corner bakery', 'contains', 'expense', 'Corner Bakery', 'Food: Dining', 50, 1)", []).unwrap();
    refresh_label_memory(&connection).unwrap();

    let renamed = rename_payee_inner(&mut connection, "Corner Bakery".into(), "Neighborhood Bakery".into()).unwrap();
    assert_eq!(renamed.transactions, 1);
    assert_eq!(renamed.schedules, 1);
    assert_eq!(renamed.merchant_rules, 1);
    let original: Option<String> = connection.query_row("SELECT original_payee FROM transactions WHERE id='t1'", [], |r| r.get(0)).unwrap();
    assert_eq!(original.as_deref(), Some("CORNER BAKERY #44"));
    let payee: String = connection.query_row("SELECT payee FROM transactions WHERE id='t1'", [], |r| r.get(0)).unwrap();
    assert_eq!(payee, "Neighborhood Bakery");
    let pattern: String = connection.query_row("SELECT pattern FROM merchant_rules WHERE id='r1'", [], |r| r.get(0)).unwrap();
    assert_eq!(pattern, "CORNER BAKERY");

    assert!(rename_payee_inner(&mut connection, "Neighborhood Bakery".into(), "Corner Cafe".into()).unwrap_err().contains("use merge"));
    merge_payees_inner(&mut connection, "Neighborhood Bakery".into(), "Corner Cafe".into()).unwrap();
    let payees: Vec<String> = connection.prepare("SELECT DISTINCT payee FROM transactions ORDER BY payee").unwrap().query_map([], |r| r.get(0)).unwrap().collect::<Result<_,_>>().unwrap();
    assert_eq!(payees, vec!["Corner Cafe"]);

    connection.execute("INSERT INTO payees(id, name) VALUES('orphan', 'Stale Memory Payee')", []).unwrap();
    remove_unused_payee_inner(&mut connection, "Stale Memory Payee".into()).unwrap();
    assert!(remove_unused_payee_inner(&mut connection, "Corner Cafe".into()).unwrap_err().contains("still referenced"));
    connection.execute("INSERT INTO categories(id, name) VALUES('orphan-cat', 'Unused: Label')", []).unwrap();
    remove_unused_category_inner(&mut connection, "Unused: Label".into()).unwrap();
    assert!(rename_category_inner(&mut connection, "Food: Dining".into(), "food: dining".into()).is_ok());
    let cased: String = connection.query_row("SELECT category FROM transactions WHERE id='t1'", [], |r| r.get(0)).unwrap();
    assert_eq!(cased, "food: dining");
}

#[test]
fn category_rename_collision_and_reserved_labels_are_rejected() {
    let mut connection = Connection::open_in_memory().unwrap();
    apply_migrations(&mut connection).unwrap();
    connection.execute("INSERT INTO accounts(id, name, account_type, currency, opening_balance_minor, owner_label) VALUES('a', 'Checking', 'checking', 'USD', 0, 'Household'), ('b', 'Savings', 'savings', 'USD', 0, 'Household')", []).unwrap();
    connection.execute("INSERT INTO transactions(id, account_id, posted_date, payee, category, amount_minor, status, source) VALUES('t1', 'a', '2026-08-01', 'Store', 'Food', -100, 'cleared', 'manual'), ('t2', 'a', '2026-08-02', 'Move', 'Transfer: Savings', -50, 'cleared', 'transfer')", []).unwrap();
    refresh_label_memory(&connection).unwrap();
    assert!(rename_category_inner(&mut connection, "Transfer: Savings".into(), "Housing".into()).is_err());
    assert!(rename_category_inner(&mut connection, "Food".into(), "Split transaction".into()).is_err());
    assert!(merge_categories_inner(&mut connection, "Food".into(), "Food".into()).is_err());
}


#[test]
fn transaction_notes_and_flags_are_metadata_only_and_survive_edits() {
    let mut connection = Connection::open_in_memory().unwrap();
    apply_migrations(&mut connection).unwrap();
    connection.execute("INSERT INTO accounts(id, name, account_type, currency, opening_balance_minor, owner_label) VALUES('a', 'Checking', 'checking', 'USD', 10000, 'Household')", []).unwrap();
    let created = create_transaction_inner(&mut connection, CreateTransactionRequest {
        account_id: "a".into(), posted_date: "2026-09-20".into(), payee: "Hardware".into(), category: "Home".into(),
        amount_minor: -4200, status: "cleared".into(), memo: Some("Ask about warranty".into()), flagged: true, splits: None,
    }).unwrap();
    assert_eq!(created.memo.as_deref(), Some("Ask about warranty"));
    assert!(created.flagged);
    let balance_before: i64 = connection.query_row("SELECT opening_balance_minor + COALESCE((SELECT SUM(amount_minor) FROM transactions WHERE account_id='a'),0) FROM accounts WHERE id='a'", [], |r| r.get(0)).unwrap();

    let annotated = update_transaction_annotation_inner(&mut connection, created.id.clone(), TransactionAnnotationRequest {
        update_memo: true, memo: Some("  Called store  ".into()), flagged: Some(false),
    }).unwrap();
    assert_eq!(annotated.memo.as_deref(), Some("Called store"));
    assert!(!annotated.flagged);

    let updated = update_transaction_inner(&mut connection, created.id.clone(), CreateTransactionRequest {
        account_id: "a".into(), posted_date: "2026-09-20".into(), payee: "Hardware Store".into(), category: "Home: Repairs".into(),
        amount_minor: -4200, status: "pending".into(), memo: Some("Called store".into()), flagged: true, splits: None,
    }).unwrap();
    assert_eq!(updated.payee, "Hardware Store");
    assert_eq!(updated.memo.as_deref(), Some("Called store"));
    assert!(updated.flagged);

    let cleared = update_transaction_annotation_inner(&mut connection, created.id.clone(), TransactionAnnotationRequest {
        update_memo: true, memo: Some("   ".into()), flagged: None,
    }).unwrap();
    assert!(cleared.memo.is_none());
    assert!(cleared.flagged);

    let flagged_only = list_transactions_page_inner(&connection, TransactionQuery {
        account_id: Some("a".into()), offset: 0, limit: 50, from_date: None, to_date: None, status: None, search: None, flagged_only: true, newest: true,
    }, false).unwrap();
    assert_eq!(flagged_only.total_count, 1);

    let searched = list_transactions_page_inner(&connection, TransactionQuery {
        account_id: Some("a".into()), offset: 0, limit: 50, from_date: None, to_date: None, status: None, search: Some("Called store".into()), flagged_only: false, newest: true,
    }, false).unwrap();
    // note was cleared — search should miss
    assert_eq!(searched.total_count, 0);

    update_transaction_annotation_inner(&mut connection, created.id.clone(), TransactionAnnotationRequest {
        update_memo: true, memo: Some("warranty card in glovebox".into()), flagged: Some(true),
    }).unwrap();
    let note_search = list_transactions_page_inner(&connection, TransactionQuery {
        account_id: Some("a".into()), offset: 0, limit: 50, from_date: None, to_date: None, status: None, search: Some("glovebox".into()), flagged_only: false, newest: true,
    }, false).unwrap();
    assert_eq!(note_search.total_count, 1);

    let imported = import_transactions_inner(&mut connection, ImportTransactionsRequest {
        account_id: "a".into(), source_name: "statement.csv".into(), rows: vec![ImportTransactionRow {
            posted_date: "2026-09-21".into(), payee: "UTILITY".into(), original_payee: Some("UTILITY CO".into()),
            amount_minor: -5500, memo: Some("imported statement memo".into()), external_id: Some("ext-1".into()), category: None, splits: None, scheduled_occurrence_id: None,
        }],
    }).unwrap();
    assert_eq!(imported.imported_count, 1);
    let imported_id: String = connection.query_row("SELECT id FROM transactions WHERE external_id='ext-1'", [], |r| r.get(0)).unwrap();
    update_transaction_annotation_inner(&mut connection, imported_id.clone(), TransactionAnnotationRequest {
        update_memo: true, memo: Some("User note after import".into()), flagged: Some(true),
    }).unwrap();
    let redo_error = match import_transactions_inner(&mut connection, ImportTransactionsRequest {
        account_id: "a".into(), source_name: "statement.csv".into(), rows: vec![ImportTransactionRow {
            posted_date: "2026-09-21".into(), payee: "UTILITY".into(), original_payee: Some("UTILITY CO".into()),
            amount_minor: -5500, memo: Some("should not overwrite".into()), external_id: Some("ext-1".into()), category: None, splits: None, scheduled_occurrence_id: None,
        }],
    }) {
        Ok(_) => panic!("duplicate import unexpectedly succeeded"),
        Err(error) => error,
    };
    assert!(redo_error.contains("already exists"));
    let (memo, flagged, original, amount): (Option<String>, i64, Option<String>, i64) = connection.query_row(
        "SELECT memo, flagged, original_payee, amount_minor FROM transactions WHERE id=?1",
        [&imported_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    ).unwrap();
    assert_eq!(memo.as_deref(), Some("User note after import"));
    assert_eq!(flagged, 1);
    assert_eq!(original.as_deref(), Some("UTILITY CO"));
    assert_eq!(amount, -5500);

    let balance_after: i64 = connection.query_row("SELECT opening_balance_minor + COALESCE((SELECT SUM(amount_minor) FROM transactions WHERE account_id='a'),0) FROM accounts WHERE id='a'", [], |r| r.get(0)).unwrap();
    assert_eq!(balance_after, balance_before - 5500);

    assert!(update_transaction_annotation_inner(&mut connection, created.id.clone(), TransactionAnnotationRequest {
        update_memo: true, memo: Some("x".repeat(501)), flagged: None,
    }).is_err());
}

#[test]
fn bulk_register_actions_are_atomic_and_protect_transfers_splits_and_reconciled() {
    let mut connection = Connection::open_in_memory().unwrap();
    apply_migrations(&mut connection).unwrap();
    connection.execute("INSERT INTO accounts(id, name, account_type, currency, opening_balance_minor, owner_label) VALUES('a', 'Checking', 'checking', 'USD', 10000, 'Household'), ('b', 'Savings', 'savings', 'USD', 0, 'Household')", []).unwrap();
    connection.execute("INSERT INTO transactions(id, account_id, posted_date, payee, category, amount_minor, status, source) VALUES('t1', 'a', '2026-08-01', 'Market', 'Food: Groceries', -1000, 'review', 'manual'), ('t2', 'a', '2026-08-02', 'Cafe', 'Food: Dining', -500, 'pending', 'manual'), ('t3', 'a', '2026-08-03', 'Trip', 'Split transaction', -1500, 'cleared', 'manual'), ('rec', 'a', '2026-08-04', 'Old', 'Housing', -200, 'reconciled', 'manual')", []).unwrap();
    connection.execute("INSERT INTO transaction_splits(id, transaction_id, category, amount_minor, sort_order) VALUES('s1', 't3', 'Food: Groceries', -900, 0), ('s2', 't3', 'Food: Dining', -600, 1)", []).unwrap();
    connection.execute("INSERT INTO reconciliations(id, account_id, statement_end_date, opening_balance_minor, closing_balance_minor) VALUES('r1', 'a', '2026-08-31', 10000, 6800)", []).unwrap();
    connection.execute("INSERT INTO reconciliation_items(reconciliation_id, transaction_id, amount_minor, status_before) VALUES('r1', 'rec', -200, 'cleared')", []).unwrap();
    create_transfer_inner(&mut connection, TransferRequest {
        from_account_id: "a".into(), to_account_id: "b".into(), posted_date: "2026-08-05".into(), payee: "Move".into(),
        amount_minor: 250, status: "cleared".into(), memo: None, flagged: false,
    }).unwrap();

    let status = bulk_update_transaction_status_inner(&mut connection, BulkUpdateTransactionStatusRequest {
        transaction_ids: vec!["t1".into(), "t2".into()],
        status: "cleared".into(),
    }).unwrap();
    assert_eq!(status.updated_count, 2);
    let statuses: Vec<String> = connection.prepare("SELECT status FROM transactions WHERE id IN ('t1','t2') ORDER BY id").unwrap().query_map([], |r| r.get(0)).unwrap().collect::<Result<_,_>>().unwrap();
    assert_eq!(statuses, vec!["cleared", "cleared"]);

    let category = bulk_set_transaction_category_inner(&mut connection, BulkSetTransactionCategoryRequest {
        transaction_ids: vec!["t1".into(), "t2".into()],
        category: "Food: Market".into(),
    }).unwrap();
    assert_eq!(category.updated_count, 2);
    let categories: Vec<String> = connection.prepare("SELECT category FROM transactions WHERE id IN ('t1','t2') ORDER BY id").unwrap().query_map([], |r| r.get(0)).unwrap().collect::<Result<_,_>>().unwrap();
    assert_eq!(categories, vec!["Food: Market", "Food: Market"]);

    assert!(bulk_set_transaction_category_inner(&mut connection, BulkSetTransactionCategoryRequest {
        transaction_ids: vec!["t1".into(), "t3".into()],
        category: "Housing".into(),
    }).unwrap_err().contains("Split"));
    let unchanged: String = connection.query_row("SELECT category FROM transactions WHERE id='t1'", [], |r| r.get(0)).unwrap();
    assert_eq!(unchanged, "Food: Market");

    assert!(bulk_update_transaction_status_inner(&mut connection, BulkUpdateTransactionStatusRequest {
        transaction_ids: vec!["t1".into(), "rec".into()],
        status: "pending".into(),
    }).unwrap_err().contains("Reconciled"));
    let still_cleared: String = connection.query_row("SELECT status FROM transactions WHERE id='t1'", [], |r| r.get(0)).unwrap();
    assert_eq!(still_cleared, "cleared");

    let transfer_id: String = connection.query_row("SELECT id FROM transactions WHERE source='transfer' LIMIT 1", [], |r| r.get(0)).unwrap();
    assert!(bulk_delete_transactions_inner(&mut connection, BulkTransactionIdsRequest {
        transaction_ids: vec!["t2".into(), transfer_id],
    }).unwrap_err().contains("transfer"));
    let t2_exists: i64 = connection.query_row("SELECT COUNT(*) FROM transactions WHERE id='t2'", [], |r| r.get(0)).unwrap();
    assert_eq!(t2_exists, 1);

    let deleted = bulk_delete_transactions_inner(&mut connection, BulkTransactionIdsRequest {
        transaction_ids: vec!["t2".into()],
    }).unwrap();
    assert_eq!(deleted.deleted_count, 1);
    let remaining: i64 = connection.query_row("SELECT COUNT(*) FROM transactions WHERE id='t2'", [], |r| r.get(0)).unwrap();
    assert_eq!(remaining, 0);
}

#[test]
fn account_lifecycle_preserves_history_and_enforces_safety_rules() {
    let mut connection = Connection::open_in_memory().unwrap();
    apply_migrations(&mut connection).unwrap();
    connection.execute("INSERT INTO accounts(id, name, account_type, currency, opening_balance_minor, owner_label, sort_order) VALUES('a', 'Checking', 'checking', 'USD', 1000, 'Household', 0), ('b', 'Cash', 'cash', 'USD', 2000, 'Household', 1)", []).unwrap();

    let edited = update_account_inner(&connection, "a", UpdateAccountRequest {
        name: "Primary".into(), institution: Some("Local CU".into()), r#type: "checking".into(), currency: "EUR".into(), owner_label: "Alex".into(),
    }).unwrap();
    assert_eq!((edited.name.as_str(), edited.currency.as_str(), edited.owner_label.as_str()), ("Primary", "EUR", "Alex"));

    connection.execute("INSERT INTO transactions(id, account_id, posted_date, payee, category, amount_minor, status, source) VALUES('review', 'a', '2026-09-20', 'Store', 'Test', -100, 'review', 'manual')", []).unwrap();
    assert!(update_account_inner(&connection, "a", UpdateAccountRequest {
        name: "Primary".into(), institution: None, r#type: "checking".into(), currency: "GBP".into(), owner_label: "Alex".into(),
    }).is_err());
    assert!(set_account_archived_inner(&connection, "a", true).is_err());

    connection.execute("UPDATE transactions SET status='cleared' WHERE id='review'", []).unwrap();
    set_account_archived_inner(&connection, "a", true).unwrap();
    let archived: bool = connection.query_row("SELECT archived_at IS NOT NULL FROM accounts WHERE id='a'", [], |row| row.get(0)).unwrap();
    assert!(archived);
    set_account_archived_inner(&connection, "a", false).unwrap();

    reorder_accounts_inner(&mut connection, &["a".into(), "b".into()]).unwrap();
    let order: Vec<String> = connection.prepare("SELECT id FROM accounts WHERE archived_at IS NULL ORDER BY sort_order").unwrap().query_map([], |row| row.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
    assert_eq!(order, vec!["a", "b"]);
    assert!(reorder_accounts_inner(&mut connection, &["a".into()]).is_err());
}

#[test]
fn statement_import_is_atomic_and_rejects_duplicates() {
    let mut connection = Connection::open_in_memory().unwrap();
    apply_migrations(&mut connection).unwrap();
    connection.execute("INSERT INTO accounts(id, name, account_type, currency, opening_balance_minor, owner_label) VALUES('a', 'Checking', 'checking', 'USD', 0, 'Household')", []).unwrap();
    let request = || ImportTransactionsRequest {
        account_id: "a".into(), source_name: "statement.csv".into(),
        rows: vec![ImportTransactionRow {
            posted_date: "2026-09-18".into(), payee: "Store".into(), original_payee: None, amount_minor: -1250, memo: None,
            external_id: Some("bank-1".into()), category: Some("Split transaction".into()),
            scheduled_occurrence_id: None,
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
            posted_date: "2026-09-18".into(), payee: "Store".into(), original_payee: None, amount_minor: -1250, memo: None,
            external_id: None, category: Some("Split transaction".into()),
            scheduled_occurrence_id: None,
            splits: Some(vec![ImportTransactionSplit { category: "Food".into(), amount_minor: -1000, memo: None }])
        }]
    };
    assert!(import_transactions_inner(&mut connection, request).is_err());
    let count: i64 = connection.query_row("SELECT COUNT(*) FROM transactions", [], |row| row.get(0)).unwrap();
    assert_eq!(count, 0);
}

#[test]
fn statement_import_applies_deterministic_merchant_rules() {
    let mut connection = Connection::open_in_memory().unwrap();
    apply_migrations(&mut connection).unwrap();
    connection.execute("INSERT INTO accounts(id, name, account_type, currency, opening_balance_minor, owner_label) VALUES('a', 'Checking', 'checking', 'USD', 0, 'Household')", []).unwrap();
    connection.execute("INSERT INTO merchant_rules(id,name,pattern,normalized_pattern,match_type,direction,rename_to,category,priority,enabled) VALUES('rule','Market','NEIGHBORHOOD MARKET','neighborhood market','contains','expense','Neighborhood Market','Food: Groceries',100,1)", []).unwrap();
    import_transactions_inner(&mut connection, ImportTransactionsRequest {
        account_id: "a".into(), source_name: "rules.csv".into(),
        rows: vec![ImportTransactionRow {
            posted_date: "2026-09-18".into(), payee: "SQ *NEIGHBORHOOD MARKET #42".into(), original_payee: None,
            amount_minor: -1250, memo: None, external_id: None, category: None, splits: None,
            scheduled_occurrence_id: None,
        }],
    }).unwrap();
    let imported: (String,String,String) = connection.query_row("SELECT payee,original_payee,category FROM transactions", [], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?))).unwrap();
    assert_eq!(imported, ("Neighborhood Market".into(), "SQ *NEIGHBORHOOD MARKET #42".into(), "Food: Groceries".into()));
}

#[test]
fn manual_transaction_crud_preserves_balanced_splits() {
    let mut connection = Connection::open_in_memory().unwrap();
    apply_migrations(&mut connection).unwrap();
    connection.execute("INSERT INTO accounts(id, name, account_type, currency, opening_balance_minor, owner_label) VALUES('a', 'Checking', 'checking', 'USD', 0, 'Household')", []).unwrap();
    let transaction = create_transaction_inner(&mut connection, CreateTransactionRequest {
        account_id: "a".into(), posted_date: "2026-09-18".into(), payee: "Store".into(), category: "Ignored".into(),
        amount_minor: -3000, status: "cleared".into(), memo: None,
        flagged: false,
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
        amount_minor: -2500, status: "cleared".into(), memo: Some("Updated".into()), flagged: false, splits: None
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
        payee: "Savings transfer".into(), amount_minor, status: "cleared".into(), memo: None, flagged: false,
    };
    let transfer = create_transfer_inner(&mut connection, request(2500)).unwrap();
    let count: i64 = connection.query_row("SELECT COUNT(*) FROM transactions WHERE id IN (?1, ?2)", [&transfer.from_transaction_id, &transfer.to_transaction_id], |row| row.get(0)).unwrap();
    let total: i64 = connection.query_row("SELECT SUM(amount_minor) FROM transactions WHERE id IN (?1, ?2)", [&transfer.from_transaction_id, &transfer.to_transaction_id], |row| row.get(0)).unwrap();
    assert_eq!((count, total), (2, 0));
    assert!(update_transaction_inner(&mut connection, transfer.from_transaction_id.clone(), CreateTransactionRequest {
        account_id: "from".into(), posted_date: "2026-09-18".into(), payee: "Invalid".into(), category: "Transfer".into(),
        amount_minor: -100, status: "cleared".into(), memo: None, flagged: false, splits: None,
    }).is_err());
    update_transfer_inner(&mut connection, transfer.link_id.clone(), request(1000)).unwrap();
    let amounts: (i64, i64) = connection.query_row("SELECT origin.amount_minor, destination.amount_minor FROM transfer_links link JOIN transactions origin ON origin.id=link.from_transaction_id JOIN transactions destination ON destination.id=link.to_transaction_id WHERE link.id=?1", [&transfer.link_id], |row| Ok((row.get(0)?, row.get(1)?))).unwrap();
    assert_eq!(amounts, (-1000, 1000));
    delete_transfer_inner(&mut connection, transfer.link_id).unwrap();
    let remaining: i64 = connection.query_row("SELECT COUNT(*) FROM transactions", [], |row| row.get(0)).unwrap();
    assert_eq!(remaining, 0);
}

fn scheduled_request(kind:&str,account_id:&str,transfer_account_id:Option<&str>)->ScheduledTransactionRequest{
    ScheduledTransactionRequest{
        kind:kind.into(),account_id:account_id.into(),transfer_account_id:transfer_account_id.map(str::to_string),
        payee:"Utility".into(),category:"Utilities".into(),amount_minor:if kind=="transfer"{2500}else{-2500},
        status:"pending".into(),memo:None,frequency:"monthly".into(),anchor_date:"2026-01-31".into(),
        end_date:None,second_month_day:None,custom_interval_count:None,custom_interval_unit:None,enabled:true,auto_post:false,
    }
}

#[test]
fn scheduled_occurrences_are_idempotent_and_support_state_transitions() {
    let mut connection=Connection::open_in_memory().unwrap();
    apply_migrations(&mut connection).unwrap();
    connection.execute("INSERT INTO accounts(id,name,account_type,currency,opening_balance_minor,owner_label) VALUES('a','Checking','checking','USD',10000,'Household')",[]).unwrap();
    let template=clean_scheduled_transaction(&connection,scheduled_request("transaction","a",None),"schedule".into()).unwrap();
    insert_scheduled_transaction(&connection,&template).unwrap();
    let query=|from:&str,to:&str|ScheduledOccurrenceQuery{from_date:from.into(),to_date:to.into(),scheduled_transaction_id:Some("schedule".into())};
    assert_eq!(generate_scheduled_occurrences_inner(&mut connection,query("2026-01-01","2026-03-31")).unwrap(),3);
    assert_eq!(generate_scheduled_occurrences_inner(&mut connection,query("2026-02-01","2026-04-30")).unwrap(),1);
    let dates:Vec<String>={
        let mut statement=connection.prepare("SELECT due_date FROM scheduled_occurrences ORDER BY due_date").unwrap();
        statement.query_map([],|row|row.get(0)).unwrap().collect::<Result<Vec<_>,_>>().unwrap()
    };
    assert_eq!(dates,vec!["2026-01-31","2026-02-28","2026-03-31","2026-04-30"]);
    let ids:Vec<String>={
        let mut statement=connection.prepare("SELECT id FROM scheduled_occurrences ORDER BY due_date").unwrap();
        statement.query_map([],|row|row.get(0)).unwrap().collect::<Result<Vec<_>,_>>().unwrap()
    };
    let posted=post_scheduled_occurrence_inner(&mut connection,ids[0].clone()).unwrap();
    assert_eq!((posted.posted_date.as_str(),posted.amount_minor),("2026-01-31",-2500));
    let skipped=skip_scheduled_occurrence_inner(&connection,ids[1].clone()).unwrap();
    assert_eq!(skipped.status,"skipped");
    let existing=create_transaction_inner(&mut connection,CreateTransactionRequest{account_id:"a".into(),posted_date:"2026-03-30".into(),payee:"Utility".into(),category:"Utilities".into(),amount_minor:-2500,status:"cleared".into(),memo:None,flagged:false,splits:None}).unwrap();
    let linked=link_scheduled_occurrence_inner(&mut connection,ids[2].clone(),existing.id.clone()).unwrap();
    assert_eq!((linked.status.as_str(),linked.transaction_id.as_deref()),("linked",Some(existing.id.as_str())));
    assert!(delete_transaction_inner(&connection,existing.id).is_err());
    assert!(post_scheduled_occurrence_inner(&mut connection,ids[0].clone()).is_err());
}

#[test]
fn scheduled_transfer_posting_creates_a_balanced_linked_pair() {
    let mut connection=Connection::open_in_memory().unwrap();
    apply_migrations(&mut connection).unwrap();
    connection.execute("INSERT INTO accounts(id,name,account_type,currency,opening_balance_minor,owner_label) VALUES('from','Checking','checking','USD',10000,'Household'),('to','Savings','savings','USD',0,'Household')",[]).unwrap();
    let mut request=scheduled_request("transfer","from",Some("to"));request.auto_post=true;request.anchor_date="2026-01-01".into();
    let template=clean_scheduled_transaction(&connection,request,"transfer-schedule".into()).unwrap();
    insert_scheduled_transaction(&connection,&template).unwrap();
    assert_eq!(template.transfer_account_id.as_deref(),Some("to"));
    generate_scheduled_occurrences_inner(&mut connection,ScheduledOccurrenceQuery{from_date:"2026-01-01".into(),to_date:"2026-02-28".into(),scheduled_transaction_id:Some(template.id)}).unwrap();
    let ids:Vec<String>={let mut statement=connection.prepare("SELECT id FROM scheduled_occurrences ORDER BY due_date").unwrap();statement.query_map([],|row|row.get(0)).unwrap().collect::<Result<Vec<_>,_>>().unwrap()};
    let posted=post_scheduled_occurrence_inner(&mut connection,ids[0].clone()).unwrap();
    assert_eq!((posted.amount_minor,posted.transfer_account_id.as_deref()),(-2500,Some("to")));
    let auto_posted=process_scheduled_auto_post_inner(&mut connection,ScheduledAutoPostRequest{occurrence_ids:vec![ids[1].clone()],as_of_date:"2026-02-01".into()}).unwrap();
    assert_eq!(auto_posted.posted_count,1);
    let pair:(i64,i64)=connection.query_row("SELECT COUNT(*),SUM(amount_minor) FROM transactions WHERE source='transfer'",[],|row|Ok((row.get(0)?,row.get(1)?))).unwrap();
    assert_eq!(pair,(4,0));
    let links:i64=connection.query_row("SELECT COUNT(*) FROM transfer_links",[],|row|row.get(0)).unwrap();
    assert_eq!(links,2);
}

#[test]
fn reviewed_auto_post_is_atomic_and_revalidates_due_items() {
    let mut connection=Connection::open_in_memory().unwrap();
    apply_migrations(&mut connection).unwrap();
    connection.execute("INSERT INTO accounts(id,name,account_type,currency,opening_balance_minor,owner_label) VALUES('a','Checking','checking','USD',10000,'Household')",[]).unwrap();
    let mut request=scheduled_request("transaction","a",None);request.auto_post=true;request.anchor_date="2026-01-10".into();
    let template=clean_scheduled_transaction(&connection,request,"schedule".into()).unwrap();insert_scheduled_transaction(&connection,&template).unwrap();
    generate_scheduled_occurrences_inner(&mut connection,ScheduledOccurrenceQuery{from_date:"2026-01-01".into(),to_date:"2026-02-28".into(),scheduled_transaction_id:Some(template.id)}).unwrap();
    let ids:Vec<String>={let mut statement=connection.prepare("SELECT id FROM scheduled_occurrences ORDER BY due_date").unwrap();statement.query_map([],|row|row.get(0)).unwrap().collect::<Result<Vec<_>,_>>().unwrap()};
    assert!(process_scheduled_auto_post_inner(&mut connection,ScheduledAutoPostRequest{occurrence_ids:ids.clone(),as_of_date:"2026-01-31".into()}).is_err());
    let unchanged:(i64,i64)=connection.query_row("SELECT (SELECT COUNT(*) FROM transactions),(SELECT COUNT(*) FROM scheduled_occurrences WHERE status='expected')",[],|row|Ok((row.get(0)?,row.get(1)?))).unwrap();
    assert_eq!(unchanged,(0,2));
    assert!(process_scheduled_auto_post_inner(&mut connection,ScheduledAutoPostRequest{occurrence_ids:vec![ids[0].clone(),ids[0].clone()],as_of_date:"2026-01-31".into()}).is_err());
    let result=process_scheduled_auto_post_inner(&mut connection,ScheduledAutoPostRequest{occurrence_ids:vec![ids[0].clone()],as_of_date:"2026-01-31".into()}).unwrap();
    assert_eq!(result.posted_count,1);
}

#[test]
fn statement_import_links_an_eligible_occurrence_in_the_same_transaction() {
    let mut connection=Connection::open_in_memory().unwrap();
    apply_migrations(&mut connection).unwrap();
    connection.execute("INSERT INTO accounts(id,name,account_type,currency,opening_balance_minor,owner_label) VALUES('a','Checking','checking','USD',0,'Household')",[]).unwrap();
    let template=clean_scheduled_transaction(&connection,scheduled_request("transaction","a",None),"schedule".into()).unwrap();
    insert_scheduled_transaction(&connection,&template).unwrap();
    generate_scheduled_occurrences_inner(&mut connection,ScheduledOccurrenceQuery{from_date:"2026-01-01".into(),to_date:"2026-01-31".into(),scheduled_transaction_id:Some(template.id)}).unwrap();
    let occurrence_id:String=connection.query_row("SELECT id FROM scheduled_occurrences",[],|row|row.get(0)).unwrap();
    let imported=import_transactions_inner(&mut connection,ImportTransactionsRequest{
        account_id:"a".into(),source_name:"statement.csv".into(),rows:vec![ImportTransactionRow{
            posted_date:"2026-01-30".into(),payee:"UTILITY PAYMENT".into(),original_payee:None,amount_minor:-2600,memo:None,external_id:None,category:None,splits:None,scheduled_occurrence_id:Some(occurrence_id.clone()),
        }],
    }).unwrap();
    assert_eq!(imported.imported_count,1);
    let linked:(String,Option<String>)=connection.query_row("SELECT status,transaction_id FROM scheduled_occurrences WHERE id=?1",[occurrence_id],|row|Ok((row.get(0)?,row.get(1)?))).unwrap();
    assert_eq!(linked.0,"linked");
    assert!(linked.1.is_some());
    assert!(undo_import_batch_inner(&mut connection,&imported.batch_id).is_err());
}

#[test]
fn statement_import_rolls_back_when_selected_occurrence_is_ineligible() {
    let mut connection=Connection::open_in_memory().unwrap();
    apply_migrations(&mut connection).unwrap();
    connection.execute("INSERT INTO accounts(id,name,account_type,currency,opening_balance_minor,owner_label) VALUES('a','Checking','checking','USD',0,'Household')",[]).unwrap();
    let template=clean_scheduled_transaction(&connection,scheduled_request("transaction","a",None),"schedule".into()).unwrap();
    insert_scheduled_transaction(&connection,&template).unwrap();
    generate_scheduled_occurrences_inner(&mut connection,ScheduledOccurrenceQuery{from_date:"2026-01-01".into(),to_date:"2026-01-31".into(),scheduled_transaction_id:Some(template.id)}).unwrap();
    let occurrence_id:String=connection.query_row("SELECT id FROM scheduled_occurrences",[],|row|row.get(0)).unwrap();
    let result=import_transactions_inner(&mut connection,ImportTransactionsRequest{
        account_id:"a".into(),source_name:"statement.csv".into(),rows:vec![ImportTransactionRow{
            posted_date:"2026-01-30".into(),payee:"Unrelated merchant".into(),original_payee:None,amount_minor:-2600,memo:None,external_id:None,category:None,splits:None,scheduled_occurrence_id:Some(occurrence_id),
        }],
    });
    assert!(result.is_err());
    let counts:(i64,i64)=connection.query_row("SELECT (SELECT COUNT(*) FROM transactions),(SELECT COUNT(*) FROM import_batches)",[],|row|Ok((row.get(0)?,row.get(1)?))).unwrap();
    assert_eq!(counts,(0,0));
}

#[test]
fn monthly_budget_counts_splits_excludes_transfers_and_rolls_sinking_funds() {
    let mut connection=Connection::open_in_memory().unwrap();
    apply_migrations(&mut connection).unwrap();
    connection.execute("INSERT INTO accounts(id,name,account_type,currency,opening_balance_minor,owner_label) VALUES('a','Checking','checking','USD',0,'Household')",[]).unwrap();
    connection.execute("INSERT INTO budget_categories(id,category,rollover_enabled) VALUES('food','Food',0),('repairs','Home: Repairs',1)",[]).unwrap();
    connection.execute("INSERT INTO budget_allocations(id,budget_category_id,month,planned_minor) VALUES('f1','food','2026-08',30000),('f2','food','2026-09',30000),('r1','repairs','2026-08',10000),('r2','repairs','2026-09',10000)",[]).unwrap();
    connection.execute("INSERT INTO transactions(id,account_id,posted_date,payee,category,amount_minor,status,source) VALUES('aug','a','2026-08-10','Hardware','Home: Repairs',-2500,'cleared','manual'),('split','a','2026-09-05','Store','Split transaction',-6000,'cleared','manual'),('transfer','a','2026-09-06','Transfer','Home: Repairs',-5000,'cleared','transfer')",[]).unwrap();
    connection.execute("INSERT INTO transaction_splits(id,transaction_id,category,amount_minor,sort_order) VALUES('s1','split','Food',-4000,0),('s2','split','Home: Repairs',-2000,1)",[]).unwrap();
    let budget=get_budget_month_inner(&connection,"2026-09".into()).unwrap();
    assert_eq!((budget.planned_minor,budget.spent_minor,budget.carry_in_minor,budget.available_minor),(40000,6000,7500,41500));
    let repairs=budget.lines.iter().find(|item|item.id=="repairs").unwrap();
    assert_eq!((repairs.spent_minor,repairs.carry_in_minor,repairs.available_minor),(2000,7500,15500));
}

#[test]
fn debt_plans_are_currency_scoped_validated_and_replaced_atomically(){
    let mut connection=Connection::open_in_memory().unwrap();apply_migrations(&mut connection).unwrap();
    connection.execute("INSERT INTO accounts(id,name,account_type,currency,opening_balance_minor,owner_label) VALUES('card','Card','credit','USD',-100000,'Household'),('loan','Loan','loan','USD',-300000,'Household'),('cad','CAD Card','credit','CAD',-50000,'Household'),('cash','Checking','checking','USD',10000,'Household')",[]).unwrap();
    let request=DebtPlanRequest{currency:"usd".into(),strategy:"avalanche".into(),extra_payment_minor:10000,terms:vec![DebtTerm{account_id:"card".into(),annual_rate_bps:1999,minimum_payment_minor:5000,custom_priority:2,enabled:true},DebtTerm{account_id:"loan".into(),annual_rate_bps:650,minimum_payment_minor:8000,custom_priority:1,enabled:true}]};
    let saved=save_debt_plan_inner(&mut connection,request).unwrap();assert_eq!((saved.currency.as_str(),saved.strategy.as_str(),saved.terms.len()),("USD","avalanche",2));
    let loaded=get_debt_plan_inner(&connection,"USD".into()).unwrap();assert_eq!((loaded.extra_payment_minor,loaded.terms[0].account_id.as_str()),(10000,"loan"));
    let invalid=DebtPlanRequest{currency:"USD".into(),strategy:"snowball".into(),extra_payment_minor:0,terms:vec![DebtTerm{account_id:"cad".into(),annual_rate_bps:100,minimum_payment_minor:100,custom_priority:0,enabled:true}]};
    assert!(save_debt_plan_inner(&mut connection,invalid).is_err());assert_eq!(get_debt_plan_inner(&connection,"USD".into()).unwrap().terms.len(),2);
    let replacement=DebtPlanRequest{currency:"USD".into(),strategy:"custom".into(),extra_payment_minor:5000,terms:vec![DebtTerm{account_id:"card".into(),annual_rate_bps:1999,minimum_payment_minor:6000,custom_priority:1,enabled:true}]};
    assert_eq!(save_debt_plan_inner(&mut connection,replacement).unwrap().terms.len(),1);
}

#[test]
fn savings_goals_require_unique_active_savings_accounts(){
    let mut connection=Connection::open_in_memory().unwrap();apply_migrations(&mut connection).unwrap();
    connection.execute("INSERT INTO accounts(id,name,account_type,currency,opening_balance_minor,owner_label) VALUES('savings','Savings','savings','USD',250000,'Household'),('checking','Checking','checking','USD',10000,'Household')",[]).unwrap();
    let request=||SavingsGoalRequest{name:" Emergency fund ".into(),account_id:"savings".into(),target_minor:1_000_000,target_date:"2027-09-19".into(),planned_monthly_minor:75_000};
    let created=create_savings_goal_inner(&connection,request()).unwrap();assert_eq!((created.name.as_str(),created.account_id.as_str()),("Emergency fund","savings"));
    assert!(create_savings_goal_inner(&connection,request()).is_err());
    assert!(create_savings_goal_inner(&connection,SavingsGoalRequest{name:"Invalid".into(),account_id:"checking".into(),target_minor:1000,target_date:"2027-01-01".into(),planned_monthly_minor:0}).is_err());
    let updated=update_savings_goal_inner(&connection,created.id.clone(),SavingsGoalRequest{name:"Six months".into(),account_id:"savings".into(),target_minor:1_200_000,target_date:"2028-01-01".into(),planned_monthly_minor:80_000}).unwrap();
    assert_eq!((updated.target_minor,list_savings_goals_inner(&connection).unwrap().len()),(1_200_000,1));
    delete_savings_goal_inner(&connection,created.id).unwrap();assert!(list_savings_goals_inner(&connection).unwrap().is_empty());
}

#[test]
fn reconciliation_requires_an_exact_balance_and_protects_completed_items() {
    let mut connection = Connection::open_in_memory().unwrap();
    apply_migrations(&mut connection).unwrap();
    connection.execute("INSERT INTO accounts(id, name, account_type, currency, opening_balance_minor, owner_label) VALUES('a', 'Checking', 'checking', 'USD', 10000, 'Household')", []).unwrap();
    connection.execute("INSERT INTO transactions(id, account_id, posted_date, payee, category, amount_minor, status, source) VALUES('deposit', 'a', '2026-09-01', 'Deposit', 'Income', 5000, 'cleared', 'manual'), ('purchase', 'a', '2026-09-02', 'Store', 'Food', -1250, 'review', 'manual')", []).unwrap();
    let request = |closing_balance_minor| CompleteReconciliationRequest {
        account_id: "a".into(),
        statement_end_date: "2026-09-30".into(),
        opening_balance_minor: 10000,
        closing_balance_minor,
        transaction_ids: vec!["deposit".into(), "purchase".into()],
    };
    assert!(complete_reconciliation_inner(&mut connection, request(14000)).is_err());
    let reconciliation = complete_reconciliation_inner(&mut connection, request(13750)).unwrap();
    assert_eq!((reconciliation.transaction_count, reconciliation.adjustment_total_minor), (2, 3750));
    let reconciled_count: i64 = connection.query_row("SELECT COUNT(*) FROM transactions WHERE status = 'reconciled'", [], |row| row.get(0)).unwrap();
    assert_eq!(reconciled_count, 2);
    assert!(update_transaction_inner(&mut connection, "purchase".into(), CreateTransactionRequest {
        account_id: "a".into(), posted_date: "2026-09-02".into(), payee: "Store".into(), category: "Food".into(),
        amount_minor: -1250, status: "cleared".into(), memo: None, flagged: false, splits: None,
    }).is_err());
    assert!(delete_transaction_inner(&connection, "purchase".into()).is_err());
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
fn portfolio_snapshot_restore_preserves_revisions_allocations_prices_and_projection() {
    let mut connection=Connection::open_in_memory().unwrap();apply_migrations(&mut connection).unwrap();
    connection.execute("INSERT INTO accounts(id,name,account_type,currency,opening_balance_minor,owner_label) VALUES('inv','Brokerage','investment','USD',999999,'Household')",[]).unwrap();
    connection.execute("INSERT INTO investment_account_settings(account_id,account_kind,tax_treatment,opening_cash_minor,opening_date) VALUES('inv','brokerage','taxable',50000,'2026-01-01')",[]).unwrap();
    connection.execute("INSERT INTO securities(id,security_type,name,symbol,currency) VALUES('sec','stock','Example','EX','USD')",[]).unwrap();
    connection.execute("INSERT INTO investment_events(id,account_id,current_revision_id) VALUES('buy','inv','buy-r2'),('sell','inv','sell-r1')",[]).unwrap();
    connection.execute("INSERT INTO investment_event_revisions(id,event_id,revision_number,event_type,trade_date,security_id,quantity_e8,cash_effect_minor,acquisition_funding_minor,status,source) VALUES('buy-r1','buy',1,'buy','2026-01-02','sec',?1,-10000,10000,'cleared','manual')",[SCALE_E8]).unwrap();
    connection.execute("INSERT INTO investment_event_revisions(id,event_id,revision_number,supersedes_revision_id,event_type,trade_date,security_id,quantity_e8,cash_effect_minor,acquisition_funding_minor,status,source,correction_reason,corrected_at) VALUES('buy-r2','buy',2,'buy-r1','buy','2026-01-02','sec',?1,-12000,12000,'cleared','manual','Statement correction','2026-02-01')",[SCALE_E8]).unwrap();
    connection.execute("INSERT INTO investment_event_revisions(id,event_id,revision_number,event_type,trade_date,security_id,quantity_e8,cash_effect_minor,status,source) VALUES('sell-r1','sell',1,'sell','2026-03-01','sec',?1,8000,'cleared','manual')",[SCALE_E8/2]).unwrap();
    connection.execute("INSERT INTO investment_lot_allocations(sale_revision_id,acquisition_event_id,quantity_e8) VALUES('sell-r1','buy',?1)",[SCALE_E8/2]).unwrap();
    connection.execute("INSERT INTO security_prices(id,security_id,observed_at,price_e8,currency,source) VALUES('price','sec','2026-03-01',20000000000,'USD','manual')",[]).unwrap();
    let before=snapshot_inner(&connection,Some(&["inv".into()]),"2026-03-01").unwrap();
    let bytes=snapshot_database(&connection).unwrap();
    connection.execute_batch("DELETE FROM investment_lot_allocations; DELETE FROM investment_event_revisions; DELETE FROM investment_events; DELETE FROM security_prices; DELETE FROM investment_account_settings; DELETE FROM securities; DELETE FROM accounts;").unwrap();
    restore_database_inner(&mut connection,&bytes).unwrap();
    validate_backup_database(&connection).unwrap();
    let after=snapshot_inner(&connection,Some(&["inv".into()]),"2026-03-01").unwrap();
    assert_eq!(before.accounts[0].cash_minor,after.accounts[0].cash_minor);
    assert_eq!(before.accounts[0].holdings[0].quantity_e8,after.accounts[0].holdings[0].quantity_e8);
    assert_eq!(before.accounts[0].holdings[0].known_basis_minor,after.accounts[0].holdings[0].known_basis_minor);
    assert_eq!(before.accounts[0].holdings[0].market_value_minor,after.accounts[0].holdings[0].market_value_minor);
    assert_eq!(before.accounts[0].holdings[0].realized.calculable_gain_minor,after.accounts[0].holdings[0].realized.calculable_gain_minor);
    let counts:(i64,i64,i64)=connection.query_row("SELECT (SELECT COUNT(*) FROM investment_event_revisions),(SELECT COUNT(*) FROM investment_lot_allocations),(SELECT COUNT(*) FROM security_prices)",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
    let reason:String=connection.query_row("SELECT correction_reason FROM investment_event_revisions WHERE id='buy-r2'",[],|r|r.get(0)).unwrap();
    assert_eq!(counts,(3,1,1));assert_eq!(reason,"Statement correction");
}

#[test]
fn ordinary_ledger_rejects_investment_asset_conversions() {
    let mut connection=Connection::open_in_memory().unwrap();apply_migrations(&mut connection).unwrap();
    connection.execute("INSERT INTO accounts(id,name,account_type,currency,opening_balance_minor,owner_label) VALUES('inv','Brokerage','investment','USD',0,'Household'),('cash','Checking','checking','USD',0,'Household')",[]).unwrap();
    let result=create_transaction_inner(&mut connection,CreateTransactionRequest{account_id:"inv".into(),posted_date:"2026-01-01".into(),payee:"Buy".into(),category:"Investment".into(),amount_minor:-10000,status:"cleared".into(),memo:None,flagged:false,splits:None});
    assert!(matches!(result,Err(ref e) if e.contains("investment event workflow")));
    assert_eq!(query_transactions(&connection,None,None,false).unwrap().len(),0);
    let transfer=create_transfer_inner(&mut connection,TransferRequest{from_account_id:"cash".into(),to_account_id:"inv".into(),posted_date:"2026-01-01".into(),payee:"Funding".into(),amount_minor:10000,status:"cleared".into(),memo:None,flagged:false});
    assert_eq!(transfer.err().as_deref(),Some("Ordinary↔investment cash transfers must use the dedicated transfer command; investment-to-investment cash transfers use investment activity"));
    assert_eq!(query_transactions(&connection,None,None,false).unwrap().len(),0);
}

#[test]
fn investment_net_worth_value_uses_intrinsic_cash_and_holdings_not_account_opening_balance() {
    let mut connection=Connection::open_in_memory().unwrap();apply_migrations(&mut connection).unwrap();
    connection.execute("INSERT INTO accounts(id,name,account_type,currency,opening_balance_minor,owner_label) VALUES('inv','Brokerage','investment','USD',999999,'Household')",[]).unwrap();
    connection.execute("INSERT INTO investment_account_settings(account_id,account_kind,tax_treatment,opening_cash_minor,opening_date) VALUES('inv','brokerage','taxable',10000,'2026-01-01')",[]).unwrap();
    connection.execute("INSERT INTO securities(id,security_type,name,currency) VALUES('sec','stock','Example','USD')",[]).unwrap();
    connection.execute("INSERT INTO investment_events(id,account_id,current_revision_id) VALUES('buy','inv','r')",[]).unwrap();
    connection.execute("INSERT INTO investment_event_revisions(id,event_id,revision_number,event_type,trade_date,security_id,quantity_e8,cash_effect_minor,acquisition_funding_minor,status,source) VALUES('r','buy',1,'buy','2026-01-02','sec',?1,-5000,5000,'cleared','manual')",[SCALE_E8]).unwrap();
    connection.execute("INSERT INTO security_prices(id,security_id,observed_at,price_e8,currency,source) VALUES('p','sec','2026-01-03',6000000000,'USD','manual')",[]).unwrap();
    let p=snapshot_inner(&connection,Some(&["inv".into()]),"2026-01-03").unwrap();
    assert_eq!(p.accounts[0].cash_minor,5000);assert_eq!(p.accounts[0].holdings_value_minor,Some(6000));assert_eq!(p.accounts[0].total_value_minor,Some(11000));
}

#[test]
fn v18_backup_validation_rejects_missing_portfolio_tables() {
    let mut connection=Connection::open_in_memory().unwrap();apply_migrations(&mut connection).unwrap();
    connection.execute_batch("DROP TABLE security_prices").unwrap();
    assert!(validate_backup_database(&connection).unwrap_err().contains("Portfolio Foundation tables"));
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

#[test]
fn backup_validation_accepts_supported_pre_debt_schema() {
    let mut connection = Connection::open_in_memory().unwrap();
    apply_migrations(&mut connection).unwrap();
    connection.execute_batch("DROP TABLE savings_goals; DROP TABLE debt_terms; DROP TABLE debt_plan_settings; DELETE FROM schema_migrations WHERE version>=13;").unwrap();
    validate_backup_database(&connection).unwrap();
}

#[test]
fn backup_validation_accepts_supported_pre_savings_schema() {
    let mut connection = Connection::open_in_memory().unwrap();
    apply_migrations(&mut connection).unwrap();
    connection.execute_batch("DROP TABLE savings_goals; DELETE FROM schema_migrations WHERE version>=14;").unwrap();
    validate_backup_database(&connection).unwrap();
}

#[test]
fn backup_validation_accepts_supported_pre_catalog_schema() {
    let mut connection = Connection::open_in_memory().unwrap();
    apply_migrations(&mut connection).unwrap();
    connection.execute_batch("DROP TABLE categories; DROP TABLE payees; DELETE FROM schema_migrations WHERE version>=15;").unwrap();
    validate_backup_database(&connection).unwrap();
}

#[test]
fn transaction_pages_expose_history_beyond_the_old_thousand_row_cap() {
    let mut connection = Connection::open_in_memory().unwrap();
    apply_migrations(&mut connection).unwrap();
    connection.execute("INSERT INTO accounts(id, name, account_type, currency, opening_balance_minor, owner_label) VALUES('a', 'Checking', 'checking', 'USD', 500000, 'Household')", []).unwrap();
    for index in 0..1105 {
        create_transaction_inner(&mut connection, CreateTransactionRequest {
            account_id: "a".into(),
            posted_date: format!("20{:02}-{:02}-{:02}", index / (28 * 12), (index / 28) % 12 + 1, index % 28 + 1),
            payee: format!("History {index}"),
            category: "Archive".into(),
            amount_minor: -1,
            status: if index % 2 == 0 { "pending".into() } else { "cleared".into() },
            memo: None,
            flagged: false,
            splits: None,
        }).unwrap();
    }
    let all = query_transactions(&connection, Some("a"), None, false).unwrap();
    assert_eq!(all.len(), 1105);
    assert_eq!(all[0].payee, "History 1104");
    let newest = list_transactions_page_inner(&connection, TransactionQuery {
        account_id: Some("a".into()),
        offset: 0,
        limit: 100,
        from_date: None,
        to_date: None,
        status: None,
        search: None,
        flagged_only: false,
        newest: true,
    }, false).unwrap();
    assert_eq!(newest.total_count, 1105);
    assert_eq!(newest.offset, 1005);
    assert_eq!(newest.transactions.len(), 100);
    assert_eq!(newest.prior_balance_minor, Some(500000 - 1005));
    assert_eq!(newest.transactions.last().unwrap().payee, "History 1104");
    let earliest = list_transactions_page_inner(&connection, TransactionQuery {
        account_id: Some("a".into()),
        offset: 0,
        limit: 50,
        from_date: None,
        to_date: None,
        status: None,
        search: None,
        flagged_only: false,
        newest: false,
    }, false).unwrap();
    assert_eq!(earliest.prior_balance_minor, Some(500000));
    assert_eq!(earliest.transactions[0].payee, "History 0");

    let pending = list_transactions_page_inner(&connection, TransactionQuery {
        account_id: Some("a".into()),
        offset: 0,
        limit: 20,
        from_date: None,
        to_date: None,
        status: Some("pending".into()),
        search: None,
        flagged_only: false,
        newest: true,
    }, false).unwrap();
    let first_pending = pending.transactions.first().unwrap();
    let created_at: String = connection.query_row("SELECT created_at FROM transactions WHERE id=?1", rusqlite::params![first_pending.id], |row| row.get(0)).unwrap();
    let true_prior: i64 = connection.query_row(
        "SELECT 500000 + COALESCE(SUM(amount_minor),0) FROM transactions
         WHERE account_id='a' AND (
           posted_date < ?1 OR (posted_date = ?1 AND created_at < ?2) OR (posted_date = ?1 AND created_at = ?2 AND id < ?3)
         )",
        rusqlite::params![first_pending.posted_date, created_at, first_pending.id],
        |row| row.get(0),
    ).unwrap();
    assert_eq!(pending.prior_balance_minor, Some(true_prior));
}

#[test]
fn csv_export_validation_restricts_size_content_and_filename() {
    super::validate_csv_export("\u{feff}\"Date\"\r\n", "HomeLedger-report.csv").unwrap();
    assert!(super::validate_csv_export("", "HomeLedger-report.csv").is_err());
    assert!(super::validate_csv_export("date\0value", "HomeLedger-report.csv").is_err());
    assert!(super::validate_csv_export("date,value", "../report.csv").is_err());
    assert!(super::validate_csv_export("date,value", "report.txt").is_err());
}

#[test]
fn local_ai_urls_are_strictly_loopback_and_route_bounded_commands() {
    assert_eq!(super::local_ai_url("http://127.0.0.1:11434/v1", "chat/completions").unwrap().as_str(), "http://127.0.0.1:11434/v1/chat/completions");
    assert_eq!(super::local_ai_url("http://localhost:1234/v1/chat/completions", "models").unwrap().as_str(), "http://127.0.0.1:1234/v1/models");
    assert!(super::local_ai_url("https://localhost:1234/v1", "models").is_err());
    assert!(super::local_ai_url("http://192.168.1.10:1234/v1", "models").is_err());
    assert!(super::local_ai_url("http://localhost.evil:1234/v1", "models").is_err());
    assert!(super::local_ai_url("http://user@localhost:1234/v1", "models").is_err());
}

#[test]
fn local_ai_model_validation_rejects_empty_long_and_control_values() {
    assert_eq!(super::validate_local_ai_model(" qwen-local ").unwrap(), "qwen-local");
    assert!(super::validate_local_ai_model("").is_err());
    assert!(super::validate_local_ai_model(&"x".repeat(201)).is_err());
    assert!(super::validate_local_ai_model("model\nname").is_err());
}

#[test]
fn ai_credential_account_ids_are_strict_and_secrets_are_bounded() {
    assert_eq!(super::validate_ai_credential_account_id("cloud:openai:default").unwrap(), "cloud:openai:default");
    assert_eq!(super::validate_ai_credential_account_id("cloud:anthropic:default").unwrap(), "cloud:anthropic:default");
    assert_eq!(super::validate_ai_credential_account_id("cloud:gemini:default").unwrap(), "cloud:gemini:default");
    assert!(super::validate_ai_credential_account_id("").is_err());
    assert!(super::validate_ai_credential_account_id("bad id").is_err());
    assert!(super::validate_ai_credential_account_id(&"x".repeat(201)).is_err());
    assert_eq!(super::validate_ai_credential_secret("sk-test").unwrap(), "sk-test");
    assert!(super::validate_ai_credential_secret("").is_err());
    assert!(super::validate_ai_credential_secret("bad\u{0000}secret").is_err());
    assert!(super::validate_ai_credential_secret(&"x".repeat(4097)).is_err());
}

#[test]
fn openai_urls_require_https_approved_host_and_v1_chat_path() {
    assert_eq!(super::openai_chat_url("https://api.openai.com/v1").unwrap().as_str(), "https://api.openai.com/v1/chat/completions");
    assert_eq!(super::openai_chat_url("https://api.openai.com/v1/chat/completions").unwrap().as_str(), "https://api.openai.com/v1/chat/completions");
    assert!(super::openai_chat_url("http://api.openai.com/v1").is_err());
    assert!(super::openai_chat_url("https://api.openai.com.evil/v1").is_err());
    assert!(super::openai_chat_url("https://evil.example/v1").is_err());
    assert!(super::openai_chat_url("https://api.openai.com/v2").is_err());
    assert!(super::openai_chat_url("https://user:pass@api.openai.com/v1").is_err());
    assert!(super::openai_chat_url("https://api.openai.com/v1?x=1").is_err());
}

#[test]
fn openai_mocked_transport_requires_confirmation_and_preserves_reviewed_payload() {
    let payload = serde_json::json!({
        "model": "gpt-4.1-mini",
        "purpose": "Can I afford another $50 per month?",
        "disclosureMode": "task-specific",
        "analysisMode": "task",
        "task": "affordability-analysis",
        "schemaVersion": 1,
        "data": {"task": "affordability-analysis", "proposedMonthlyCostMinor": 5000}
    }).to_string();
    let mut request = super::OpenAiRequest {
        endpoint: "https://api.openai.com/v1".into(),
        model: "gpt-4.1-mini".into(),
        payload: payload.clone(),
        account_id: "cloud:openai:default".into(),
        confirmed: false,
    };
    assert!(super::query_openai_with_transport(&request, "sk-test", |_,_,_| Ok(vec![])).unwrap_err().contains("confirmation"));
    request.confirmed = true;
    let answer = super::query_openai_with_transport(&request, "sk-test", |url, key, body| {
        assert_eq!(url.as_str(), "https://api.openai.com/v1/chat/completions");
        assert_eq!(key, "sk-test");
        assert_eq!(body["model"], "gpt-4.1-mini");
        assert_eq!(body["messages"][1]["content"], payload);
        assert!(body["messages"][0]["content"].as_str().unwrap().contains("Affordability Analysis"));
        Ok(br#"{"choices":[{"message":{"content":"Surplus remains positive. DELETE FROM accounts;"}}]}"#.to_vec())
    }).unwrap();
    assert_eq!(answer.answer, "Surplus remains positive. DELETE FROM accounts;");
    assert!(super::openai_http_status_message(302).contains("redirect"));
    assert!(super::openai_http_status_message(401).contains("authentication"));
    assert!(super::parse_openai_chat_answer(br#"{"choices":[{"message":{"content":""}}]}"#).is_err());
    assert!(super::build_openai_chat_body("other", &payload).is_err());
    assert!(super::query_openai_with_transport(&super::OpenAiRequest {
        endpoint: "https://api.openai.com/v1".into(),
        model: "gpt-4.1-mini".into(),
        payload: "x".repeat(256 * 1024 + 1),
        account_id: "cloud:openai:default".into(),
        confirmed: true,
    }, "sk-test", |_,_,_| Ok(vec![])).unwrap_err().contains("256 KB"));
}

#[test]
fn anthropic_urls_require_https_approved_host_and_messages_path() {
    assert_eq!(super::anthropic_messages_url("https://api.anthropic.com").unwrap().as_str(), "https://api.anthropic.com/v1/messages");
    assert_eq!(super::anthropic_messages_url("https://api.anthropic.com/v1/messages").unwrap().as_str(), "https://api.anthropic.com/v1/messages");
    assert!(super::anthropic_messages_url("http://api.anthropic.com").is_err());
    assert!(super::anthropic_messages_url("https://api.anthropic.com.evil").is_err());
    assert!(super::anthropic_messages_url("https://evil.example").is_err());
    assert!(super::anthropic_messages_url("https://api.anthropic.com/v2").is_err());
    assert!(super::anthropic_messages_url("https://user:pass@api.anthropic.com").is_err());
    assert!(super::anthropic_messages_url("https://api.anthropic.com?x=1").is_err());
    assert!(super::anthropic_messages_url("https://api.anthropic.com/v1/chat/completions").is_err());
}

#[test]
fn anthropic_mocked_transport_uses_messages_api_and_preserves_reviewed_payload() {
    let payload = serde_json::json!({
        "model": "claude-sonnet-4-5",
        "purpose": "Can I afford another $50 per month?",
        "disclosureMode": "task-specific",
        "analysisMode": "task",
        "task": "affordability-analysis",
        "schemaVersion": 1,
        "data": {"task": "affordability-analysis", "proposedMonthlyCostMinor": 5000}
    }).to_string();
    let mut request = super::AnthropicRequest {
        endpoint: "https://api.anthropic.com".into(),
        model: "claude-sonnet-4-5".into(),
        payload: payload.clone(),
        account_id: "cloud:anthropic:default".into(),
        confirmed: false,
    };
    assert!(super::query_anthropic_with_transport(&request, "anthropic-key", |_,_,_| Ok(vec![])).unwrap_err().contains("confirmation"));
    request.confirmed = true;
    assert!(super::query_anthropic_with_transport(&request, "", |_,_,_| Ok(vec![])).unwrap_err().contains("credential"));
    assert!(super::query_anthropic_with_transport(&super::AnthropicRequest {
        endpoint: "https://api.anthropic.com".into(),
        model: "claude-sonnet-4-5".into(),
        payload: payload.clone(),
        account_id: "cloud:openai:default".into(),
        confirmed: true,
    }, "anthropic-key", |_,_,_| Ok(vec![])).unwrap_err().contains("credential account id"));
    let answer = super::query_anthropic_with_transport(&request, "anthropic-key", |url, key, body| {
        assert_eq!(url.as_str(), "https://api.anthropic.com/v1/messages");
        assert_eq!(key, "anthropic-key");
        assert_eq!(body["model"], "claude-sonnet-4-5");
        assert_eq!(body["max_tokens"], 2048);
        assert_eq!(body["messages"][0]["content"], payload);
        assert!(body["system"].as_str().unwrap().contains("Affordability Analysis"));
        assert!(!serde_json::to_string(&body).unwrap().contains("Authorization"));
        assert!(!serde_json::to_string(&body).unwrap().contains("Bearer"));
        Ok(br#"{"content":[{"type":"text","text":"Surplus remains positive. DELETE FROM accounts;"}]}"#.to_vec())
    }).unwrap();
    assert_eq!(answer.answer, "Surplus remains positive. DELETE FROM accounts;");
    assert!(super::anthropic_http_status_message(302).contains("redirect"));
    assert!(super::anthropic_http_status_message(307).contains("redirect"));
    assert!(super::anthropic_http_status_message(401).contains("authentication"));
    assert!(super::parse_anthropic_messages_answer(br#"{"content":[{"type":"text","text":""}]}"#).is_err());
    assert!(super::parse_anthropic_messages_answer(br#"{"choices":[{"message":{"content":"openai-shaped"}}]}"#).is_err());
    assert!(super::parse_anthropic_messages_answer(b"not-json").is_err());
    assert!(super::build_anthropic_messages_body("other", &payload).is_err());
    assert!(super::query_anthropic_with_transport(&super::AnthropicRequest {
        endpoint: "https://api.anthropic.com".into(),
        model: "claude-sonnet-4-5".into(),
        payload: "x".repeat(256 * 1024 + 1),
        account_id: "cloud:anthropic:default".into(),
        confirmed: true,
    }, "anthropic-key", |_,_,_| Ok(vec![])).unwrap_err().contains("256 KB"));
}

#[test]
fn openai_and_anthropic_receive_semantically_equivalent_affordability_payloads() {
    let data = serde_json::json!({
        "task": "affordability-analysis",
        "schemaVersion": 1,
        "question": "Can I afford another $50 per month?",
        "currency": "USD",
        "proposedMonthlyCostMinor": 5000,
        "asOfDate": "2026-09-20",
        "cashFlow": {"averageMonthlyIncomeMinor": 300000, "averageMonthlySpendingMinor": 120000},
        "liquidBalances": [{"accountType": "checking", "balanceMinor": 100000}]
    });
    let openai_payload = serde_json::json!({
        "model": "gpt-4.1-mini",
        "purpose": "Can I afford another $50 per month?",
        "disclosureMode": "task-specific",
        "analysisMode": "task",
        "task": "affordability-analysis",
        "schemaVersion": 1,
        "data": data
    }).to_string();
    let anthropic_payload = serde_json::json!({
        "model": "claude-sonnet-4-5",
        "purpose": "Can I afford another $50 per month?",
        "disclosureMode": "task-specific",
        "analysisMode": "task",
        "task": "affordability-analysis",
        "schemaVersion": 1,
        "data": data
    }).to_string();
    let gemini_payload = serde_json::json!({
        "model": "gemini-2.0-flash",
        "purpose": "Can I afford another $50 per month?",
        "disclosureMode": "task-specific",
        "analysisMode": "task",
        "task": "affordability-analysis",
        "schemaVersion": 1,
        "data": data
    }).to_string();
    let openai_body = super::build_openai_chat_body("gpt-4.1-mini", &openai_payload).unwrap();
    let anthropic_body = super::build_anthropic_messages_body("claude-sonnet-4-5", &anthropic_payload).unwrap();
    let gemini_body = super::build_gemini_generate_content_body("gemini-2.0-flash", &gemini_payload).unwrap();
    let openai_user = openai_body["messages"][1]["content"].as_str().unwrap();
    let anthropic_user = anthropic_body["messages"][0]["content"].as_str().unwrap();
    let gemini_user = gemini_body["contents"][0]["parts"][0]["text"].as_str().unwrap();
    let openai_data = serde_json::from_str::<serde_json::Value>(openai_user).unwrap()["data"].clone();
    let anthropic_data = serde_json::from_str::<serde_json::Value>(anthropic_user).unwrap()["data"].clone();
    let gemini_data = serde_json::from_str::<serde_json::Value>(gemini_user).unwrap()["data"].clone();
    assert_eq!(openai_data, anthropic_data);
    assert_eq!(openai_data, gemini_data);
    assert_eq!(openai_data, data);
    assert!(openai_body.get("messages").is_some());
    assert!(anthropic_body.get("system").is_some());
    assert!(anthropic_body.get("max_tokens").is_some());
    assert!(gemini_body.get("systemInstruction").is_some());
    assert!(gemini_body.get("generationConfig").is_some());
    assert!(openai_body.get("max_tokens").is_none());
    assert!(gemini_body.get("messages").is_none());
}

#[test]
fn gemini_urls_require_https_approved_host_and_generate_content_path() {
    assert_eq!(
        super::gemini_generate_content_url("https://generativelanguage.googleapis.com/v1beta", "gemini-2.0-flash").unwrap().as_str(),
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"
    );
    assert_eq!(
        super::gemini_generate_content_url(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
            "gemini-2.0-flash"
        ).unwrap().as_str(),
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"
    );
    assert!(super::gemini_generate_content_url("http://generativelanguage.googleapis.com/v1beta", "gemini-2.0-flash").is_err());
    assert!(super::gemini_generate_content_url("https://generativelanguage.googleapis.com.evil/v1beta", "gemini-2.0-flash").is_err());
    assert!(super::gemini_generate_content_url("https://evil.example/v1beta", "gemini-2.0-flash").is_err());
    assert!(super::gemini_generate_content_url("https://generativelanguage.googleapis.com/v1", "gemini-2.0-flash").is_err());
    assert!(super::gemini_generate_content_url("https://user:pass@generativelanguage.googleapis.com/v1beta", "gemini-2.0-flash").is_err());
    assert!(super::gemini_generate_content_url("https://generativelanguage.googleapis.com/v1beta?key=secret", "gemini-2.0-flash").is_err());
    assert!(super::gemini_generate_content_url("https://generativelanguage.googleapis.com/v1beta", "gemini/../evil").is_err());
    assert!(super::gemini_generate_content_url("https://generativelanguage.googleapis.com/v1beta", "models/gemini-2.0-flash").is_err());
}

#[test]
fn gemini_mocked_transport_uses_generate_content_and_preserves_reviewed_payload() {
    let payload = serde_json::json!({
        "model": "gemini-2.0-flash",
        "purpose": "Can I afford another $50 per month?",
        "disclosureMode": "task-specific",
        "analysisMode": "task",
        "task": "affordability-analysis",
        "schemaVersion": 1,
        "data": {"task": "affordability-analysis", "proposedMonthlyCostMinor": 5000}
    }).to_string();
    let mut request = super::GeminiRequest {
        endpoint: "https://generativelanguage.googleapis.com/v1beta".into(),
        model: "gemini-2.0-flash".into(),
        payload: payload.clone(),
        account_id: "cloud:gemini:default".into(),
        confirmed: false,
    };
    assert!(super::query_gemini_with_transport(&request, "gemini-key", |_,_,_| Ok(vec![])).unwrap_err().contains("confirmation"));
    request.confirmed = true;
    assert!(super::query_gemini_with_transport(&request, "", |_,_,_| Ok(vec![])).unwrap_err().contains("credential"));
    assert!(super::query_gemini_with_transport(&super::GeminiRequest {
        endpoint: "https://generativelanguage.googleapis.com/v1beta".into(),
        model: "gemini-2.0-flash".into(),
        payload: payload.clone(),
        account_id: "cloud:openai:default".into(),
        confirmed: true,
    }, "gemini-key", |_,_,_| Ok(vec![])).unwrap_err().contains("credential account id"));
    let answer = super::query_gemini_with_transport(&request, "gemini-key", |url, key, body| {
        assert_eq!(url.as_str(), "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent");
        assert_eq!(key, "gemini-key");
        assert_eq!(body["contents"][0]["parts"][0]["text"], payload);
        assert!(body["systemInstruction"]["parts"][0]["text"].as_str().unwrap().contains("Affordability Analysis"));
        assert_eq!(body["generationConfig"]["temperature"], 0.2);
        assert!(!serde_json::to_string(&body).unwrap().contains("Authorization"));
        assert!(!serde_json::to_string(&body).unwrap().contains("Bearer"));
        assert!(!serde_json::to_string(&body).unwrap().contains("x-api-key"));
        Ok(br#"{"candidates":[{"content":{"parts":[{"text":"Surplus remains positive. DELETE FROM accounts;"}]}}]}"#.to_vec())
    }).unwrap();
    assert_eq!(answer.answer, "Surplus remains positive. DELETE FROM accounts;");
    assert!(super::gemini_http_status_message(302).contains("redirect"));
    assert!(super::gemini_http_status_message(307).contains("redirect"));
    assert!(super::gemini_http_status_message(401).contains("authentication"));
    assert!(super::parse_gemini_generate_content_answer(br#"{"candidates":[{"content":{"parts":[{"text":""}]}}]}"#).is_err());
    assert!(super::parse_gemini_generate_content_answer(br#"{"choices":[{"message":{"content":"openai-shaped"}}]}"#).is_err());
    assert!(super::parse_gemini_generate_content_answer(br#"{"content":[{"type":"text","text":"anthropic-shaped"}]}"#).is_err());
    assert!(super::parse_gemini_generate_content_answer(b"not-json").is_err());
    assert!(super::build_gemini_generate_content_body("other", &payload).is_err());
    assert!(super::query_gemini_with_transport(&super::GeminiRequest {
        endpoint: "https://generativelanguage.googleapis.com/v1beta".into(),
        model: "gemini-2.0-flash".into(),
        payload: "x".repeat(256 * 1024 + 1),
        account_id: "cloud:gemini:default".into(),
        confirmed: true,
    }, "gemini-key", |_,_,_| Ok(vec![])).unwrap_err().contains("256 KB"));
}

#[test]
fn spending_change_task_selects_dedicated_system_prompt_across_providers() {
    let payload = serde_json::json!({
        "model": "gpt-4.1-mini",
        "purpose": "Why was this month expensive?",
        "disclosureMode": "task-specific",
        "analysisMode": "task",
        "task": "spending-change-analysis",
        "schemaVersion": 1,
        "data": {"task": "spending-change-analysis", "spendingChangeMinor": 60000}
    }).to_string();
    let openai = super::build_openai_chat_body("gpt-4.1-mini", &payload).unwrap();
    assert!(openai["messages"][0]["content"].as_str().unwrap().contains("Spending Change Analysis"));
    assert!(openai["messages"][0]["content"].as_str().unwrap().contains("Do not invent causes"));
    let anthropic_payload = payload.replace("gpt-4.1-mini", "claude-sonnet-4-5");
    let anthropic = super::build_anthropic_messages_body("claude-sonnet-4-5", &anthropic_payload).unwrap();
    assert!(anthropic["system"].as_str().unwrap().contains("Spending Change Analysis"));
    let gemini_payload = payload.replace("gpt-4.1-mini", "gemini-2.0-flash");
    let gemini = super::build_gemini_generate_content_body("gemini-2.0-flash", &gemini_payload).unwrap();
    assert!(gemini["systemInstruction"]["parts"][0]["text"].as_str().unwrap().contains("incomplete-period"));
    assert!(super::task_system_prompt(&payload).contains("Spending Change Analysis"));
}

#[test]
fn budget_review_task_selects_dedicated_system_prompt_across_providers() {
    let payload = serde_json::json!({
        "model": "gpt-4.1-mini",
        "purpose": "How am I doing against my budget?",
        "disclosureMode": "task-specific",
        "analysisMode": "task",
        "task": "budget-review-analysis",
        "schemaVersion": 1,
        "data": {"task": "budget-review-analysis", "budgetTotals": {"plannedMinor": 100000}}
    }).to_string();
    let openai = super::build_openai_chat_body("gpt-4.1-mini", &payload).unwrap();
    assert!(openai["messages"][0]["content"].as_str().unwrap().contains("Budget Review"));
    assert!(openai["messages"][0]["content"].as_str().unwrap().contains("judgmental"));
    let anthropic_payload = payload.replace("gpt-4.1-mini", "claude-sonnet-4-5");
    let anthropic = super::build_anthropic_messages_body("claude-sonnet-4-5", &anthropic_payload).unwrap();
    assert!(anthropic["system"].as_str().unwrap().contains("already-over"));
    let gemini_payload = payload.replace("gpt-4.1-mini", "gemini-2.0-flash");
    let gemini = super::build_gemini_generate_content_body("gemini-2.0-flash", &gemini_payload).unwrap();
    assert!(gemini["systemInstruction"]["parts"][0]["text"].as_str().unwrap().contains("Budget Review"));
    assert!(super::task_system_prompt(&payload).contains("Budget Review"));
}

#[test]
fn debt_strategy_task_selects_dedicated_system_prompt_across_providers() {
    let payload = serde_json::json!({
        "model": "gpt-4.1-mini",
        "purpose": "How should I approach my debt?",
        "disclosureMode": "task-specific",
        "analysisMode": "task",
        "task": "debt-strategy-analysis",
        "schemaVersion": 1,
        "data": {"task": "debt-strategy-analysis", "extraPaymentMinor": 10000}
    }).to_string();
    let openai = super::build_openai_chat_body("gpt-4.1-mini", &payload).unwrap();
    assert!(openai["messages"][0]["content"].as_str().unwrap().contains("Debt Strategy"));
    assert!(openai["messages"][0]["content"].as_str().unwrap().contains("universally best"));
    let anthropic_payload = payload.replace("gpt-4.1-mini", "claude-sonnet-4-5");
    let anthropic = super::build_anthropic_messages_body("claude-sonnet-4-5", &anthropic_payload).unwrap();
    assert!(anthropic["system"].as_str().unwrap().contains("avalanche"));
    let gemini_payload = payload.replace("gpt-4.1-mini", "gemini-2.0-flash");
    let gemini = super::build_gemini_generate_content_body("gemini-2.0-flash", &gemini_payload).unwrap();
    assert!(gemini["systemInstruction"]["parts"][0]["text"].as_str().unwrap().contains("Debt Strategy"));
    assert!(super::task_system_prompt(&payload).contains("Debt Strategy"));
}


#[test]
fn ordinary_transaction_creation_rejects_investment_accounts() {
    let mut connection=Connection::open_in_memory().unwrap();
    apply_migrations(&mut connection).unwrap();
    connection.execute("INSERT INTO accounts(id,name,account_type,currency,opening_balance_minor,owner_label) VALUES('inv-ui','Brokerage','investment','USD',0,'Household')",[]).unwrap();
    connection.execute("INSERT INTO investment_account_settings(account_id,account_kind,tax_treatment,opening_cash_minor,opening_date) VALUES('inv-ui','brokerage','unknown',0,'2026-01-01')",[]).unwrap();
    let error=match create_transaction_inner(&mut connection,CreateTransactionRequest{account_id:"inv-ui".into(),posted_date:"2026-09-22".into(),payee:"Should fail".into(),category:"Investments".into(),amount_minor:-1000,status:"cleared".into(),memo:None,flagged:false,splits:None}){Ok(_)=>panic!("ordinary transaction unexpectedly accepted investment account"),Err(error)=>error};
    assert_eq!(error,"Investment activity must use the investment event workflow");
    let count:i64=connection.query_row("SELECT COUNT(*) FROM transactions WHERE account_id='inv-ui'",[],|r|r.get(0)).unwrap();
    assert_eq!(count,0);
}


#[test]
fn cross_domain_ordinary_leg_rejects_generic_edit_delete_and_reconciliation() {
    let mut connection = Connection::open_in_memory().unwrap();
    apply_migrations(&mut connection).unwrap();
    connection.execute("INSERT INTO accounts(id,name,account_type,currency,opening_balance_minor,owner_label) VALUES('checking','Checking','checking','USD',10000,'Household'),('inv','Brokerage','investment','USD',0,'Household')", []).unwrap();
    connection.execute("INSERT INTO investment_account_settings(account_id,account_kind,tax_treatment,opening_cash_minor,opening_date) VALUES('inv','brokerage','taxable',0,'2026-01-01')", []).unwrap();

    let created = crate::cross_domain_transfer::create_cross_domain_cash_transfer_inner(
        &mut connection,
        crate::cross_domain_transfer::CrossDomainCashTransferRequest {
            from_account_id: "checking".into(),
            to_account_id: "inv".into(),
            posted_date: "2026-09-22".into(),
            payee: "Brokerage funding".into(),
            amount_minor: 1000,
            status: "pending".into(),
            memo: None,
        },
    ).unwrap();

    let edit = update_transaction_inner(&mut connection, created.ordinary_transaction_id.clone(), CreateTransactionRequest {
        account_id: "checking".into(),
        posted_date: "2026-09-22".into(),
        payee: "Tampered".into(),
        category: "Other".into(),
        amount_minor: -250,
        status: "cleared".into(),
        memo: None,
        flagged: false,
        splits: None,
    }).err().unwrap();
    assert!(edit.contains("transfer editor"));

    let delete = delete_transaction_inner(&connection, created.ordinary_transaction_id.clone()).unwrap_err();
    assert!(delete.contains("transfer editor"));

    let reconcile = complete_reconciliation_inner(&mut connection, CompleteReconciliationRequest {
        account_id: "checking".into(),
        statement_end_date: "2026-09-30".into(),
        opening_balance_minor: 10000,
        closing_balance_minor: 9000,
        transaction_ids: vec![created.ordinary_transaction_id.clone()],
    }).err().unwrap();
    assert!(reconcile.contains("cross-domain transfer workflow"));

    let row: (i64, String) = connection.query_row(
        "SELECT amount_minor,status FROM transactions WHERE id=?1",
        [&created.ordinary_transaction_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    ).unwrap();
    assert_eq!(row, (-1000, "pending".into()));
    let reconciliations: i64 = connection.query_row("SELECT COUNT(*) FROM reconciliations", [], |r| r.get(0)).unwrap();
    assert_eq!(reconciliations, 0);

    let mut changed = crate::cross_domain_transfer::CrossDomainCashTransferRequest {
        from_account_id: "checking".into(),
        to_account_id: "inv".into(),
        posted_date: "2026-09-23".into(),
        payee: "Brokerage funding adjusted".into(),
        amount_minor: 1500,
        status: "pending".into(),
        memo: Some("bridge edit".into()),
    };
    crate::cross_domain_transfer::update_cross_domain_cash_transfer_inner(&mut connection, created.link_id.clone(), changed.clone()).unwrap();
    let amount: i64 = connection.query_row("SELECT amount_minor FROM transactions WHERE id=?1", [&created.ordinary_transaction_id], |r| r.get(0)).unwrap();
    assert_eq!(amount, -1500);
    changed.amount_minor = 1600;
    crate::cross_domain_transfer::delete_cross_domain_cash_transfer_inner(&mut connection, created.link_id).unwrap();
    let remaining: i64 = connection.query_row("SELECT COUNT(*) FROM transactions WHERE id=?1", [&created.ordinary_transaction_id], |r| r.get(0)).unwrap();
    assert_eq!(remaining, 0);
}
