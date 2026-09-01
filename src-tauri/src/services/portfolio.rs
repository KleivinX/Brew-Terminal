//! Positions, valued against whatever the market providers can tell us.
//!
//! Two decisions shape everything here.
//!
//! **No currency conversion.** A portfolio holding assets priced in different currencies is not
//! summed across them. Converting would need an FX rate, an FX provider, and a decision about
//! which day's rate applies to a cost basis — three things this app does not have and would have
//! to invent. Instead the totals cover the display currency and `excluded_currencies` names what
//! was left out, so the number shown is true rather than nearly true.
//!
//! **An unpriced holding is unknown, not worthless.** When a provider cannot price something,
//! its market value is `None` and its id goes into `unpriced`. Treating it as zero would quietly
//! understate the total, and understating a total is how someone ends up making a decision on a
//! number the app knew was wrong.

use std::collections::HashMap;

use crate::db::{repo_portfolio, repo_preferences};
use crate::error::{AppError, AppResult};
use crate::models::{replay, CostBasisMethod, PortfolioSummary, Position, Transaction};
use crate::state::{with_db, AppState};

/// Rounds a money figure to the precision it will be shown at.
///
/// Applied only at the boundary. Rounding inside the replay would compound.
fn money(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

fn method_for(state: &AppState) -> AppResult<CostBasisMethod> {
    let pool = state.pool.clone();
    let stored = pool
        .get()
        .ok()
        .and_then(|conn| repo_preferences::get_all(&conn).ok())
        .map(|prefs| prefs.cost_basis_method)
        .unwrap_or_else(|| CostBasisMethod::default().as_str().to_string());
    Ok(CostBasisMethod::from_str_or_default(&stored))
}

/// Builds every position, then prices what it can.
pub async fn summary(state: &AppState) -> AppResult<PortfolioSummary> {
    let method = method_for(state)?;

    let (transactions, display_currency) = with_db(state.pool.clone(), |conn| {
        let txs = repo_portfolio::list_all(conn)?;
        let currency = repo_preferences::get_all(conn)
            .map(|p| p.display_currency)
            .unwrap_or_else(|_| "USD".to_string());
        Ok((txs, currency))
    })
    .await?;

    // Group by asset, preserving execution order within each group.
    let mut by_asset: Vec<(String, Vec<Transaction>)> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    for tx in transactions {
        match index.get(&tx.asset_id) {
            Some(at) => by_asset[*at].1.push(tx),
            None => {
                index.insert(tx.asset_id.clone(), by_asset.len());
                by_asset.push((tx.asset_id.clone(), vec![tx]));
            }
        }
    }

    let mut positions: Vec<Position> = by_asset
        .into_iter()
        .map(|(asset_id, txs)| {
            let result = replay(&txs, method);
            let last = txs.last().expect("a group always has a transaction");
            Position {
                asset_id,
                symbol: last.symbol.clone(),
                currency: last.currency.clone(),
                quantity: result.quantity,
                cost_basis: money(result.cost_basis),
                average_cost: (result.quantity > 0.0).then(|| result.cost_basis / result.quantity),
                realised_pnl: money(result.realised_pnl),
                fees_paid: money(result.fees_paid),
                market_value: None,
                unrealised_pnl: None,
                unrealised_pct: None,
                last_price: None,
                oversold: result.oversold,
                transaction_count: txs.len() as i64,
            }
        })
        .collect();

    // Only open positions need a price. A closed one has a realised figure and nothing to value.
    let to_price: Vec<String> = positions
        .iter()
        .filter(|p| p.quantity > 0.0)
        .map(|p| p.asset_id.clone())
        .collect();

    if !to_price.is_empty() {
        // A provider being down must not take the portfolio down with it: cost basis and
        // realised gain do not depend on today's price, so they are still worth showing.
        match super::market::get_quotes(state, to_price).await {
            Ok(envelope) => {
                let prices: HashMap<String, f64> = envelope
                    .data
                    .iter()
                    .map(|q| (q.asset_id.clone(), q.price))
                    .collect();

                for position in positions.iter_mut().filter(|p| p.quantity > 0.0) {
                    if let Some(price) = prices.get(&position.asset_id).copied() {
                        let value = price * position.quantity;
                        let unrealised = value - position.cost_basis;
                        position.last_price = Some(price);
                        position.market_value = Some(money(value));
                        position.unrealised_pnl = Some(money(unrealised));
                        position.unrealised_pct = (position.cost_basis.abs() > 0.005)
                            .then(|| unrealised / position.cost_basis * 100.0);
                    }
                }
            }
            Err(error) => {
                tracing::warn!(
                    ?error,
                    "could not price the portfolio; showing cost basis only"
                );
            }
        }
    }

    // Largest holding first, then closed positions.
    positions.sort_by(|a, b| {
        b.market_value
            .unwrap_or(b.cost_basis)
            .partial_cmp(&a.market_value.unwrap_or(a.cost_basis))
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let mut summary = PortfolioSummary {
        market_value: 0.0,
        cost_basis: 0.0,
        unrealised_pnl: 0.0,
        unrealised_pct: None,
        realised_pnl: 0.0,
        fees_paid: 0.0,
        currency: display_currency.clone(),
        unpriced: Vec::new(),
        excluded_currencies: Vec::new(),
        method,
        positions: Vec::new(),
    };

    for position in &positions {
        if !position.currency.eq_ignore_ascii_case(&display_currency) {
            if !summary.excluded_currencies.contains(&position.currency) {
                summary.excluded_currencies.push(position.currency.clone());
            }
            continue;
        }

        summary.realised_pnl += position.realised_pnl;
        summary.fees_paid += position.fees_paid;

        if position.quantity <= 0.0 {
            continue;
        }

        summary.cost_basis += position.cost_basis;
        match position.market_value {
            Some(value) => summary.market_value += value,
            None => summary.unpriced.push(position.symbol.clone()),
        }
    }

    summary.unrealised_pnl = money(summary.market_value - summary.cost_basis);
    summary.market_value = money(summary.market_value);
    summary.cost_basis = money(summary.cost_basis);
    summary.realised_pnl = money(summary.realised_pnl);
    summary.fees_paid = money(summary.fees_paid);
    // Only meaningful when everything open could be priced; otherwise it compares a partial
    // value against a whole cost.
    summary.unrealised_pct = (summary.cost_basis.abs() > 0.005 && summary.unpriced.is_empty())
        .then(|| summary.unrealised_pnl / summary.cost_basis * 100.0);
    summary.positions = positions;

    Ok(summary)
}

pub async fn list_transactions(
    state: &AppState,
    asset_id: Option<String>,
) -> AppResult<Vec<Transaction>> {
    with_db(state.pool.clone(), move |conn| match asset_id {
        Some(id) => repo_portfolio::list_for_asset(conn, &id),
        None => repo_portfolio::list_recent(conn, 500),
    })
    .await
}

fn validated(tx: Transaction) -> AppResult<Transaction> {
    tx.validate().map_err(|detail| AppError::Validation {
        field: "transaction".into(),
        detail,
    })?;
    Ok(tx)
}

pub async fn add_transaction(state: &AppState, tx: Transaction) -> AppResult<Transaction> {
    let tx = validated(tx)?;
    with_db(state.pool.clone(), move |conn| {
        repo_portfolio::insert(conn, &tx)
    })
    .await
}

pub async fn update_transaction(state: &AppState, tx: Transaction) -> AppResult<Transaction> {
    let tx = validated(tx)?;
    with_db(state.pool.clone(), move |conn| {
        repo_portfolio::update(conn, &tx)?.ok_or(AppError::NotFound)
    })
    .await
}

pub async fn delete_transaction(state: &AppState, id: String) -> AppResult<()> {
    with_db(state.pool.clone(), move |conn| {
        if repo_portfolio::delete(conn, &id)? {
            Ok(())
        } else {
            Err(AppError::NotFound)
        }
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::TransactionKind;

    fn state() -> (AppState, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::bootstrap(dir.path().to_path_buf()).unwrap();
        (state, dir)
    }

    fn tx(asset: &str, kind: TransactionKind, qty: f64, price: f64, at: i64) -> Transaction {
        Transaction {
            id: String::new(),
            asset_id: asset.into(),
            symbol: "BTC".into(),
            kind,
            quantity: qty,
            unit_price: price,
            fee: 0.0,
            currency: "USD".into(),
            executed_at: at,
            note: None,
            created_at: 0,
        }
    }

    #[tokio::test]
    async fn an_empty_portfolio_totals_zero_rather_than_failing() {
        let (state, _dir) = state();
        let s = summary(&state).await.unwrap();

        assert!(s.positions.is_empty());
        assert_eq!(s.market_value, 0.0);
        assert_eq!(s.cost_basis, 0.0);
        assert!(s.unrealised_pct.is_none());
    }

    #[tokio::test]
    async fn a_position_reports_its_cost_even_when_no_price_is_available() {
        let (state, _dir) = state();
        add_transaction(
            &state,
            tx(
                "crypto:cg:not-a-real-asset",
                TransactionKind::Buy,
                2.0,
                100.0,
                1_700_000_000,
            ),
        )
        .await
        .unwrap();

        let s = summary(&state).await.unwrap();
        assert_eq!(s.positions.len(), 1);
        assert_eq!(s.cost_basis, 200.0);
        // Unknown, not zero — and named so the UI can say the total is partial.
        assert!(s.positions[0].market_value.is_none());
        assert_eq!(s.unpriced, vec!["BTC".to_string()]);
        assert!(
            s.unrealised_pct.is_none(),
            "a partial value has no meaningful percentage"
        );
    }

    #[tokio::test]
    async fn a_closed_position_keeps_its_realised_gain_and_holds_nothing() {
        let (state, _dir) = state();
        let asset = "crypto:cg:not-a-real-asset";
        add_transaction(
            &state,
            tx(asset, TransactionKind::Buy, 1.0, 100.0, 1_700_000_000),
        )
        .await
        .unwrap();
        add_transaction(
            &state,
            tx(asset, TransactionKind::Sell, 1.0, 250.0, 1_700_100_000),
        )
        .await
        .unwrap();

        let s = summary(&state).await.unwrap();
        assert_eq!(s.realised_pnl, 150.0);
        assert_eq!(s.cost_basis, 0.0, "nothing is held, so nothing is at cost");
        assert!(s.unpriced.is_empty(), "a closed position needs no price");
        assert_eq!(s.positions[0].quantity, 0.0);
    }

    #[tokio::test]
    async fn holdings_in_another_currency_are_excluded_rather_than_converted() {
        let (state, _dir) = state();
        let mut euro = tx(
            "stock:eu:SAP",
            TransactionKind::Buy,
            1.0,
            100.0,
            1_700_000_000,
        );
        euro.currency = "EUR".into();
        euro.symbol = "SAP".into();
        add_transaction(&state, euro).await.unwrap();

        let s = summary(&state).await.unwrap();
        // The default display currency is USD, so this cannot be added to the total.
        assert_eq!(s.cost_basis, 0.0);
        assert_eq!(s.excluded_currencies, vec!["EUR".to_string()]);
        assert_eq!(s.positions.len(), 1, "it is still shown, just not summed");
    }

    #[tokio::test]
    async fn the_configured_cost_basis_method_is_the_one_used() {
        let (state, _dir) = state();
        let asset = "crypto:cg:not-a-real-asset";
        add_transaction(
            &state,
            tx(asset, TransactionKind::Buy, 1.0, 100.0, 1_700_000_000),
        )
        .await
        .unwrap();
        add_transaction(
            &state,
            tx(asset, TransactionKind::Buy, 1.0, 200.0, 1_700_100_000),
        )
        .await
        .unwrap();
        add_transaction(
            &state,
            tx(asset, TransactionKind::Sell, 1.0, 300.0, 1_700_200_000),
        )
        .await
        .unwrap();

        // FIFO by default: sells the 100 unit for a gain of 200.
        assert_eq!(summary(&state).await.unwrap().realised_pnl, 200.0);

        super::super::settings::set_preference(
            &state,
            "costBasisMethod".into(),
            "\"average\"".into(),
        )
        .await
        .unwrap();

        // Average: the unit cost 150, so the gain is 150.
        let s = summary(&state).await.unwrap();
        assert_eq!(s.realised_pnl, 150.0);
        assert_eq!(s.method, CostBasisMethod::Average);
    }

    #[tokio::test]
    async fn a_nonsensical_transaction_is_refused_before_it_is_stored() {
        let (state, _dir) = state();
        let bad = tx(
            "crypto:cg:bitcoin",
            TransactionKind::Buy,
            0.0,
            100.0,
            1_700_000_000,
        );

        assert!(matches!(
            add_transaction(&state, bad).await,
            Err(AppError::Validation { .. })
        ));
        assert!(list_transactions(&state, None).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn editing_and_deleting_a_transaction_changes_the_position() {
        let (state, _dir) = state();
        let asset = "crypto:cg:not-a-real-asset";
        let mut stored = add_transaction(
            &state,
            tx(asset, TransactionKind::Buy, 1.0, 100.0, 1_700_000_000),
        )
        .await
        .unwrap();

        stored.quantity = 3.0;
        update_transaction(&state, stored.clone()).await.unwrap();
        assert_eq!(summary(&state).await.unwrap().cost_basis, 300.0);

        delete_transaction(&state, stored.id.clone()).await.unwrap();
        assert!(summary(&state).await.unwrap().positions.is_empty());

        assert!(matches!(
            delete_transaction(&state, stored.id).await,
            Err(AppError::NotFound)
        ));
    }
}
