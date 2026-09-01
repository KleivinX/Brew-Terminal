//! Holdings, and the arithmetic that turns transactions into positions.
//!
//! The app does not tell anyone what to hold. It records what they say they hold and computes
//! the consequences accurately — which is the whole of the job, and a different job from
//! advising.
//!
//! **On money and `f64`.** There is no decimal type here. `f64` carries ~15 significant digits;
//! a position of a billion units priced to eight decimal places uses 17, so the representable
//! error is far below the precision of any price a provider publishes. What `f64` cannot do is
//! guarantee that `0.1 + 0.2 == 0.3`, so this module never compares money for equality, uses
//! `DUST` as the threshold for "this lot is finished", and rounds only at the display boundary.
//! It is a research tool's arithmetic, not a ledger's: good to far more places than the inputs
//! justify, and not a substitute for a broker's statement at tax time.

use serde::{Deserialize, Serialize};

/// A quantity below which a lot is treated as closed.
///
/// Repeated subtraction leaves remainders like 3e-17. Without this, selling a position in full
/// would leave an invisible sliver behind and the position would never close.
const DUST: f64 = 1e-9;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "lowercase")]
pub enum TransactionKind {
    Buy,
    Sell,
}

/// How a sale is matched against the purchases that preceded it.
///
/// Both are offered because the correct answer is jurisdictional, not technical: several tax
/// authorities mandate FIFO, others permit or require average cost. The app does not know where
/// its user files, so it does not choose for them — it defaults to FIFO because that is the
/// more commonly mandated of the two, and says which one produced a number.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "kebab-case")]
pub enum CostBasisMethod {
    /// First in, first out. The oldest units are the ones sold.
    ///
    /// The default because it is the more commonly mandated of the two, not because it is more
    /// correct — that depends entirely on where the user files.
    #[default]
    Fifo,
    /// Every unit is assumed to have cost the running average.
    Average,
}

impl CostBasisMethod {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Fifo => "fifo",
            Self::Average => "average",
        }
    }

    pub fn from_str_or_default(value: &str) -> Self {
        match value {
            "average" => Self::Average,
            _ => Self::Fifo,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct Transaction {
    pub id: String,
    pub asset_id: String,
    pub symbol: String,
    pub kind: TransactionKind,
    pub quantity: f64,
    /// Per unit, excluding the fee.
    pub unit_price: f64,
    pub fee: f64,
    pub currency: String,
    #[cfg_attr(test, ts(type = "number"))]
    pub executed_at: i64,
    pub note: Option<String>,
    #[cfg_attr(test, ts(type = "number"))]
    pub created_at: i64,
}

/// A holding, as computed from its transactions.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct Position {
    pub asset_id: String,
    pub symbol: String,
    pub currency: String,
    /// Units still held.
    pub quantity: f64,
    /// What those units cost, fees included.
    pub cost_basis: f64,
    /// `cost_basis / quantity`, or `None` when nothing is held.
    pub average_cost: Option<f64>,
    /// Gain or loss already crystallised by sales. Independent of today's price.
    pub realised_pnl: f64,
    /// Fees paid across every transaction for this asset, already reflected in the figures
    /// above. Surfaced separately because it is the cost people most often forget.
    pub fees_paid: f64,
    /// Today's value, when a price is known. `None` rather than zero: an unpriced holding is
    /// unknown, not worthless.
    pub market_value: Option<f64>,
    pub unrealised_pnl: Option<f64>,
    pub unrealised_pct: Option<f64>,
    pub last_price: Option<f64>,
    /// True when the recorded sales exceed the recorded purchases, which means the history is
    /// incomplete. Flagged rather than hidden, because the numbers below it cannot be right.
    pub oversold: bool,
    #[cfg_attr(test, ts(type = "number"))]
    pub transaction_count: i64,
}

/// The whole portfolio.
#[derive(Debug, Clone, Serialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioSummary {
    pub positions: Vec<Position>,
    /// Present value of everything that could be priced.
    pub market_value: f64,
    /// What the currently-held units cost.
    pub cost_basis: f64,
    pub unrealised_pnl: f64,
    pub unrealised_pct: Option<f64>,
    pub realised_pnl: f64,
    pub fees_paid: f64,
    /// The currency every figure above is expressed in.
    pub currency: String,
    /// Positions whose price is unknown, so `market_value` understates the total. Named so the
    /// UI can say which, rather than showing a total that is quietly incomplete.
    pub unpriced: Vec<String>,
    /// Assets held in a currency other than `currency`. No conversion is performed — see
    /// `services::portfolio`.
    pub excluded_currencies: Vec<String>,
    pub method: CostBasisMethod,
}

/// One open parcel of units bought at one price.
#[derive(Debug, Clone, Copy)]
struct Lot {
    quantity: f64,
    /// Purchase price per unit with the fee amortised in.
    unit_cost: f64,
}

/// What replaying an asset's transactions produces.
#[derive(Debug, Clone, Default)]
pub struct Replay {
    pub quantity: f64,
    pub cost_basis: f64,
    pub realised_pnl: f64,
    pub fees_paid: f64,
    pub oversold: bool,
}

/// Replays one asset's transactions in execution order.
///
/// `transactions` must already be sorted by `executed_at`; the caller does that in SQL. Fees are
/// capitalised on the way in (a buy fee raises cost basis) and deducted on the way out (a sell
/// fee reduces proceeds), which is the treatment every jurisdiction this could plausibly be used
/// in agrees on.
pub fn replay(transactions: &[Transaction], method: CostBasisMethod) -> Replay {
    let mut out = Replay::default();
    let mut lots: Vec<Lot> = Vec::new();

    for tx in transactions {
        out.fees_paid += tx.fee;

        match tx.kind {
            TransactionKind::Buy => {
                // Amortising the fee across the units bought keeps a single per-unit cost, which
                // is what both methods need.
                let unit_cost = tx.unit_price + safe_div(tx.fee, tx.quantity);
                out.cost_basis += unit_cost * tx.quantity;
                out.quantity += tx.quantity;
                lots.push(Lot {
                    quantity: tx.quantity,
                    unit_cost,
                });
            }
            TransactionKind::Sell => {
                if tx.quantity > out.quantity + DUST {
                    // More sold than the history says was ever held. The remainder has no cost
                    // to match against, so anything computed past here is a guess.
                    out.oversold = true;
                }

                let sellable = tx.quantity.min(out.quantity.max(0.0));
                if sellable <= DUST {
                    continue;
                }

                // The fee reduces what the sale actually returned.
                let net_proceeds = tx.unit_price * sellable - tx.fee;

                let matched_cost = match method {
                    CostBasisMethod::Average => {
                        let average = safe_div(out.cost_basis, out.quantity);
                        average * sellable
                    }
                    CostBasisMethod::Fifo => consume_fifo(&mut lots, sellable),
                };

                out.realised_pnl += net_proceeds - matched_cost;
                out.cost_basis -= matched_cost;
                out.quantity -= sellable;

                if method == CostBasisMethod::Average {
                    // Average cost keeps no lots, but FIFO would have shrunk them. Keep the two
                    // representations from drifting by rebuilding a single synthetic lot.
                    lots.clear();
                    if out.quantity > DUST {
                        lots.push(Lot {
                            quantity: out.quantity,
                            unit_cost: safe_div(out.cost_basis, out.quantity),
                        });
                    }
                }
            }
        }

        // Closing a position fully should leave nothing behind. Floating point remainders would
        // otherwise show as a holding of 4e-17 units costing £0.00.
        if out.quantity.abs() < DUST {
            out.quantity = 0.0;
            out.cost_basis = 0.0;
            lots.clear();
        }
    }

    out
}

/// Consumes `quantity` from the oldest lots, returning what those units cost.
fn consume_fifo(lots: &mut Vec<Lot>, quantity: f64) -> f64 {
    let mut remaining = quantity;
    let mut cost = 0.0;

    while remaining > DUST {
        let Some(lot) = lots.first_mut() else { break };
        let take = remaining.min(lot.quantity);
        cost += take * lot.unit_cost;
        lot.quantity -= take;
        remaining -= take;

        if lot.quantity <= DUST {
            lots.remove(0);
        }
    }

    cost
}

/// Division that yields 0 rather than infinity or NaN on a zero denominator.
fn safe_div(numerator: f64, denominator: f64) -> f64 {
    if denominator.abs() < DUST {
        0.0
    } else {
        numerator / denominator
    }
}

impl Transaction {
    /// Checks a transaction the user typed.
    pub fn validate(&self) -> Result<(), String> {
        if self.asset_id.trim().is_empty() {
            return Err("Choose an asset.".into());
        }
        if !self.quantity.is_finite() || self.quantity <= 0.0 {
            return Err("Quantity must be a positive number.".into());
        }
        if !self.unit_price.is_finite() || self.unit_price < 0.0 {
            return Err("Price cannot be negative.".into());
        }
        if !self.fee.is_finite() || self.fee < 0.0 {
            return Err("Fee cannot be negative.".into());
        }
        if self.currency.len() != 3 {
            return Err("Currency should be a three-letter code.".into());
        }
        // The same plausibility window the news model uses: 2000-01-01 to 2100-01-01.
        if !(946_684_800..=4_102_444_800).contains(&self.executed_at) {
            return Err("That date is outside the range this app handles.".into());
        }
        if self.note.as_ref().is_some_and(|n| n.len() > 500) {
            return Err("That note is too long.".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tx(kind: TransactionKind, quantity: f64, unit_price: f64, fee: f64, at: i64) -> Transaction {
        Transaction {
            id: format!("t{at}"),
            asset_id: "crypto:cg:bitcoin".into(),
            symbol: "BTC".into(),
            kind,
            quantity,
            unit_price,
            fee,
            currency: "USD".into(),
            executed_at: at,
            note: None,
            created_at: at,
        }
    }

    fn buy(q: f64, p: f64, at: i64) -> Transaction {
        tx(TransactionKind::Buy, q, p, 0.0, at)
    }
    fn sell(q: f64, p: f64, at: i64) -> Transaction {
        tx(TransactionKind::Sell, q, p, 0.0, at)
    }

    /// Two decimal places is finer than any figure this is displayed to.
    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 0.005
    }

    #[test]
    fn a_single_purchase_is_its_own_cost_basis() {
        let r = replay(&[buy(2.0, 100.0, 1)], CostBasisMethod::Fifo);
        assert!(close(r.quantity, 2.0));
        assert!(close(r.cost_basis, 200.0));
        assert!(close(r.realised_pnl, 0.0));
    }

    /// The case the two methods disagree on, which is the reason both exist.
    #[test]
    fn fifo_and_average_differ_on_a_partial_sale() {
        // 1 at 100, then 1 at 200. Sell 1 at 300.
        let history = [buy(1.0, 100.0, 1), buy(1.0, 200.0, 2), sell(1.0, 300.0, 3)];

        // FIFO sells the £100 unit: gain of 200.
        let fifo = replay(&history, CostBasisMethod::Fifo);
        assert!(close(fifo.realised_pnl, 200.0), "got {}", fifo.realised_pnl);
        assert!(close(fifo.cost_basis, 200.0), "the £200 unit remains");

        // Average sells a unit that cost 150: gain of 150.
        let avg = replay(&history, CostBasisMethod::Average);
        assert!(close(avg.realised_pnl, 150.0), "got {}", avg.realised_pnl);
        assert!(close(avg.cost_basis, 150.0), "half the pooled cost remains");

        // Both still hold one unit, and both agree on total gain once it is all sold.
        assert!(close(fifo.quantity, 1.0));
        assert!(close(avg.quantity, 1.0));
    }

    /// Whatever the method, selling everything must realise the same total.
    #[test]
    fn the_methods_agree_once_the_position_is_fully_closed() {
        let history = [
            buy(1.0, 100.0, 1),
            buy(1.0, 200.0, 2),
            sell(1.0, 300.0, 3),
            sell(1.0, 400.0, 4),
        ];
        let fifo = replay(&history, CostBasisMethod::Fifo);
        let avg = replay(&history, CostBasisMethod::Average);

        // Bought for 300, sold for 700.
        assert!(
            close(fifo.realised_pnl, 400.0),
            "fifo {}",
            fifo.realised_pnl
        );
        assert!(close(avg.realised_pnl, 400.0), "avg {}", avg.realised_pnl);
    }

    #[test]
    fn fees_raise_the_cost_of_a_purchase_and_reduce_the_proceeds_of_a_sale() {
        let history = [
            tx(TransactionKind::Buy, 1.0, 100.0, 10.0, 1),
            tx(TransactionKind::Sell, 1.0, 200.0, 5.0, 2),
        ];
        let r = replay(&history, CostBasisMethod::Fifo);

        // Cost 110, received 195.
        assert!(close(r.realised_pnl, 85.0), "got {}", r.realised_pnl);
        assert!(close(r.fees_paid, 15.0));
    }

    #[test]
    fn closing_a_position_leaves_nothing_behind() {
        // Quantities chosen so the subtraction does not land on an exact binary fraction.
        let history = [buy(0.1, 100.0, 1), buy(0.2, 100.0, 2), sell(0.3, 100.0, 3)];
        let r = replay(&history, CostBasisMethod::Fifo);

        assert_eq!(r.quantity, 0.0, "a closed position must be exactly zero");
        assert_eq!(r.cost_basis, 0.0, "and must carry no residual cost");
    }

    #[test]
    fn selling_more_than_was_ever_bought_is_flagged() {
        let r = replay(
            &[buy(1.0, 100.0, 1), sell(3.0, 200.0, 2)],
            CostBasisMethod::Fifo,
        );
        assert!(r.oversold, "an incomplete history must be visible");
        assert!(close(r.quantity, 0.0));
    }

    #[test]
    fn a_complete_history_is_never_flagged_as_oversold() {
        let r = replay(
            &[buy(5.0, 10.0, 1), sell(5.0, 20.0, 2)],
            CostBasisMethod::Fifo,
        );
        assert!(!r.oversold);
    }

    #[test]
    fn fifo_consumes_the_oldest_lot_first() {
        // Three lots, sell enough to clear the first and bite into the second.
        let history = [
            buy(1.0, 10.0, 1),
            buy(1.0, 20.0, 2),
            buy(1.0, 30.0, 3),
            sell(1.5, 50.0, 4),
        ];
        let r = replay(&history, CostBasisMethod::Fifo);

        // Matched cost: 1 @ 10 plus 0.5 @ 20 = 20. Proceeds 75.
        assert!(close(r.realised_pnl, 55.0), "got {}", r.realised_pnl);
        // Remaining: 0.5 @ 20 plus 1 @ 30 = 40.
        assert!(close(r.cost_basis, 40.0), "got {}", r.cost_basis);
    }

    #[test]
    fn buying_back_after_a_full_exit_starts_a_fresh_basis() {
        let history = [buy(1.0, 100.0, 1), sell(1.0, 50.0, 2), buy(1.0, 10.0, 3)];
        let r = replay(&history, CostBasisMethod::Fifo);

        assert!(close(r.realised_pnl, -50.0), "the loss is kept");
        assert!(close(r.cost_basis, 10.0), "the new lot stands alone");
        assert!(close(r.quantity, 1.0));
    }

    #[test]
    fn an_empty_history_is_an_empty_position() {
        let r = replay(&[], CostBasisMethod::Fifo);
        assert_eq!(r.quantity, 0.0);
        assert_eq!(r.cost_basis, 0.0);
        assert_eq!(r.realised_pnl, 0.0);
        assert!(!r.oversold);
    }

    #[test]
    fn realistic_crypto_precision_survives_a_round_trip() {
        // Eight decimal places, which is where a naive implementation starts drifting.
        let history = [
            buy(0.00123456, 43_218.55, 1),
            buy(0.00765432, 51_004.10, 2),
            sell(0.00888888, 60_000.00, 3),
        ];
        let r = replay(&history, CostBasisMethod::Fifo);

        assert_eq!(r.quantity, 0.0, "the position closed exactly");
        let bought = 0.00123456 * 43_218.55 + 0.00765432 * 51_004.10;
        let sold = 0.00888888 * 60_000.00;
        assert!(
            close(r.realised_pnl, sold - bought),
            "got {}",
            r.realised_pnl
        );
    }

    #[test]
    fn validation_rejects_what_cannot_be_a_trade() {
        let mut t = buy(1.0, 100.0, 1_700_000_000);
        assert!(t.validate().is_ok());

        t.quantity = 0.0;
        assert!(t.validate().is_err());
        t.quantity = -1.0;
        assert!(t.validate().is_err());
        t.quantity = f64::NAN;
        assert!(t.validate().is_err());

        let mut t = buy(1.0, 100.0, 1_700_000_000);
        t.unit_price = -1.0;
        assert!(t.validate().is_err());
        t.unit_price = 0.0;
        assert!(
            t.validate().is_ok(),
            "an airdrop can genuinely cost nothing"
        );

        let mut t = buy(1.0, 100.0, 1_700_000_000);
        t.currency = "US".into();
        assert!(t.validate().is_err());

        let mut t = buy(1.0, 100.0, 1);
        t.executed_at = 1;
        assert!(t.validate().is_err(), "1970 is not a plausible trade date");
    }

    #[test]
    fn the_default_method_is_fifo() {
        assert_eq!(CostBasisMethod::default(), CostBasisMethod::Fifo);
        assert_eq!(
            CostBasisMethod::from_str_or_default("average"),
            CostBasisMethod::Average
        );
        assert_eq!(
            CostBasisMethod::from_str_or_default("nonsense"),
            CostBasisMethod::Fifo
        );
    }
}
