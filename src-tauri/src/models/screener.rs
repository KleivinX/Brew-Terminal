//! Filtering the market on the reader's own criteria.
//!
//! The screener answers "which assets match what I asked for" and stops there. It has no
//! preset called "undervalued", no score, no ranking by anything other than a column the user
//! chose. Those would be the app deciding what matters; the filters are the reader deciding.
//!
//! Every criterion is optional and absent means unbounded, so an empty filter returns the whole
//! list rather than nothing — a screen that starts empty teaches you nothing about what is
//! available to screen.

use serde::{Deserialize, Serialize};

use super::{AssetType, Quote};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "kebab-case")]
pub enum ScreenerSort {
    /// The default: it is the ordering a market list already arrives in, so an unsorted screen
    /// does not silently reshuffle what the reader was looking at.
    #[default]
    MarketCap,
    Price,
    Change24h,
    Change7d,
    Volume,
    Symbol,
}

/// A numeric window. Either end may be absent, meaning unbounded on that side.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct Range {
    pub min: Option<f64>,
    pub max: Option<f64>,
}

impl Range {
    /// Whether a value falls inside the window.
    ///
    /// A missing value never matches a bounded window. That is the deliberate half: if a
    /// provider does not report market cap for an asset and the reader asked for "over £1bn",
    /// including it would be asserting something unknown. An unbounded window keeps it, because
    /// then nothing was asked.
    fn admits(&self, value: Option<f64>) -> bool {
        match value {
            Some(value) => {
                if !value.is_finite() {
                    return false;
                }
                self.min.map_or(true, |min| value >= min)
                    && self.max.map_or(true, |max| value <= max)
            }
            None => self.min.is_none() && self.max.is_none(),
        }
    }

    pub fn is_unbounded(&self) -> bool {
        self.min.is_none() && self.max.is_none()
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct ScreenerFilter {
    /// Absent means every type the enabled providers cover.
    pub asset_type: Option<AssetType>,
    #[serde(default)]
    pub price: Range,
    #[serde(default)]
    pub market_cap: Range,
    #[serde(default)]
    pub change_24h: Range,
    #[serde(default)]
    pub change_7d: Range,
    #[serde(default)]
    pub volume_24h: Range,
    /// Matched against symbol and name, case-insensitively.
    pub query: Option<String>,
    #[serde(default)]
    pub sort: ScreenerSort,
    #[serde(default)]
    pub descending: bool,
}

impl ScreenerFilter {
    /// Whether anything at all was asked for.
    pub fn is_empty(&self) -> bool {
        self.asset_type.is_none()
            && self.price.is_unbounded()
            && self.market_cap.is_unbounded()
            && self.change_24h.is_unbounded()
            && self.change_7d.is_unbounded()
            && self.volume_24h.is_unbounded()
            && self.query.as_ref().map_or(true, |q| q.trim().is_empty())
    }

    fn matches(&self, quote: &Quote) -> bool {
        if let Some(wanted) = self.asset_type {
            if quote.asset_type != wanted {
                return false;
            }
        }

        if let Some(query) = self.query.as_ref().map(|q| q.trim().to_lowercase()) {
            if !query.is_empty() {
                let symbol = quote.symbol.to_lowercase();
                let name = quote.name.to_lowercase();
                if !symbol.contains(&query) && !name.contains(&query) {
                    return false;
                }
            }
        }

        self.price.admits(Some(quote.price))
            && self.market_cap.admits(quote.market_cap)
            && self.change_24h.admits(quote.change_pct_24h)
            && self.change_7d.admits(quote.change_pct_7d)
            && self.volume_24h.admits(quote.volume_24h)
    }
}

/// Applies a filter to a set of quotes.
///
/// Sorting puts assets with no value for the sorted column last regardless of direction. They
/// are not zero, and floating them to the top of an ascending sort would be a lie about their
/// size; keeping them visible at the bottom is the honest option.
pub fn screen(quotes: Vec<Quote>, filter: &ScreenerFilter) -> Vec<Quote> {
    let mut matched: Vec<Quote> = quotes.into_iter().filter(|q| filter.matches(q)).collect();

    if filter.sort == ScreenerSort::Symbol {
        matched.sort_by_key(|q| q.symbol.to_lowercase());
        if filter.descending {
            matched.reverse();
        }
        return matched;
    }

    let key = |q: &Quote| -> Option<f64> {
        match filter.sort {
            ScreenerSort::MarketCap => q.market_cap,
            ScreenerSort::Price => Some(q.price),
            ScreenerSort::Change24h => q.change_pct_24h,
            ScreenerSort::Change7d => q.change_pct_7d,
            ScreenerSort::Volume => q.volume_24h,
            ScreenerSort::Symbol => None,
        }
    };

    matched.sort_by(|a, b| match (key(a), key(b)) {
        (Some(x), Some(y)) => {
            let ordering = x.partial_cmp(&y).unwrap_or(std::cmp::Ordering::Equal);
            if filter.descending {
                ordering.reverse()
            } else {
                ordering
            }
        }
        // Unknown sorts last either way.
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => std::cmp::Ordering::Equal,
    });

    matched
}

#[cfg(test)]
mod tests {
    use super::*;

    fn quote(symbol: &str, price: f64, cap: Option<f64>, change: Option<f64>) -> Quote {
        Quote {
            asset_id: format!("crypto:cg:{}", symbol.to_lowercase()),
            symbol: symbol.into(),
            name: format!("{symbol} Coin"),
            asset_type: AssetType::Crypto,
            price,
            currency: "USD".into(),
            change_pct_24h: change,
            change_pct_7d: None,
            market_cap: cap,
            volume_24h: None,
            sparkline: Vec::new(),
        }
    }

    fn symbols(quotes: &[Quote]) -> Vec<&str> {
        quotes.iter().map(|q| q.symbol.as_str()).collect()
    }

    #[test]
    fn an_empty_filter_returns_everything() {
        let filter = ScreenerFilter::default();
        assert!(filter.is_empty());

        let out = screen(
            vec![
                quote("A", 1.0, Some(10.0), None),
                quote("B", 2.0, Some(20.0), None),
            ],
            &filter,
        );
        assert_eq!(out.len(), 2);
    }

    #[test]
    fn filters_on_a_price_window() {
        let filter = ScreenerFilter {
            price: Range {
                min: Some(10.0),
                max: Some(100.0),
            },
            ..Default::default()
        };
        let out = screen(
            vec![
                quote("LOW", 5.0, None, None),
                quote("MID", 50.0, None, None),
                quote("HIGH", 500.0, None, None),
            ],
            &filter,
        );
        assert_eq!(symbols(&out), vec!["MID"]);
    }

    #[test]
    fn either_bound_may_be_left_open() {
        let over = ScreenerFilter {
            price: Range {
                min: Some(10.0),
                max: None,
            },
            ..Default::default()
        };
        let under = ScreenerFilter {
            price: Range {
                min: None,
                max: Some(10.0),
            },
            ..Default::default()
        };
        let quotes = || vec![quote("A", 5.0, None, None), quote("B", 50.0, None, None)];

        assert_eq!(symbols(&screen(quotes(), &over)), vec!["B"]);
        assert_eq!(symbols(&screen(quotes(), &under)), vec!["A"]);
    }

    /// The judgement call this module makes: unknown is not zero.
    #[test]
    fn an_asset_with_no_value_never_matches_a_bounded_window() {
        let filter = ScreenerFilter {
            market_cap: Range {
                min: Some(1.0),
                max: None,
            },
            ..Default::default()
        };
        let out = screen(
            vec![
                quote("KNOWN", 1.0, Some(500.0), None),
                quote("UNKNOWN", 1.0, None, None),
            ],
            &filter,
        );
        assert_eq!(
            symbols(&out),
            vec!["KNOWN"],
            "including an asset whose cap is unknown would assert something unknown"
        );
    }

    #[test]
    fn an_unbounded_window_keeps_assets_with_no_value() {
        let filter = ScreenerFilter {
            query: Some("coin".into()),
            ..Default::default()
        };
        let out = screen(vec![quote("NOCAP", 1.0, None, None)], &filter);
        assert_eq!(
            out.len(),
            1,
            "nothing was asked about market cap, so nothing is excluded"
        );
    }

    #[test]
    fn matches_a_query_against_symbol_or_name_case_insensitively() {
        let quotes = || vec![quote("BTC", 1.0, None, None), quote("ETH", 1.0, None, None)];

        assert_eq!(
            symbols(&screen(
                quotes(),
                &ScreenerFilter {
                    query: Some("btc".into()),
                    ..Default::default()
                }
            )),
            vec!["BTC"]
        );
        // The name is "ETH Coin", so a full-name query matches on name rather than symbol.
        assert_eq!(
            symbols(&screen(
                quotes(),
                &ScreenerFilter {
                    query: Some("ETH Coin".into()),
                    ..Default::default()
                }
            )),
            vec!["ETH"]
        );
        // A substring spanning symbol and name still matches the name.
        assert_eq!(
            symbols(&screen(
                quotes(),
                &ScreenerFilter {
                    query: Some("eth c".into()),
                    ..Default::default()
                }
            )),
            vec!["ETH"]
        );
        // Something in neither field matches nothing.
        assert!(screen(
            quotes(),
            &ScreenerFilter {
                query: Some("solana".into()),
                ..Default::default()
            }
        )
        .is_empty());
    }

    #[test]
    fn a_blank_query_is_not_a_filter() {
        let filter = ScreenerFilter {
            query: Some("   ".into()),
            ..Default::default()
        };
        assert!(filter.is_empty());
        assert_eq!(screen(vec![quote("A", 1.0, None, None)], &filter).len(), 1);
    }

    #[test]
    fn sorts_ascending_and_descending() {
        let quotes = || {
            vec![
                quote("B", 2.0, Some(20.0), None),
                quote("A", 1.0, Some(30.0), None),
                quote("C", 3.0, Some(10.0), None),
            ]
        };

        let ascending = ScreenerFilter {
            sort: ScreenerSort::Price,
            ..Default::default()
        };
        assert_eq!(symbols(&screen(quotes(), &ascending)), vec!["A", "B", "C"]);

        let descending = ScreenerFilter {
            sort: ScreenerSort::Price,
            descending: true,
            ..Default::default()
        };
        assert_eq!(symbols(&screen(quotes(), &descending)), vec!["C", "B", "A"]);
    }

    /// Unknown values sort last in *both* directions — floating them to the top of an ascending
    /// sort would present "no data" as "smallest".
    #[test]
    fn assets_with_no_value_for_the_sorted_column_go_last_either_way() {
        let quotes = || {
            vec![
                quote("NONE", 1.0, None, None),
                quote("BIG", 1.0, Some(100.0), None),
                quote("SMALL", 1.0, Some(1.0), None),
            ]
        };

        let ascending = ScreenerFilter {
            sort: ScreenerSort::MarketCap,
            ..Default::default()
        };
        assert_eq!(
            symbols(&screen(quotes(), &ascending)),
            vec!["SMALL", "BIG", "NONE"]
        );

        let descending = ScreenerFilter {
            sort: ScreenerSort::MarketCap,
            descending: true,
            ..Default::default()
        };
        assert_eq!(
            symbols(&screen(quotes(), &descending)),
            vec!["BIG", "SMALL", "NONE"]
        );
    }

    #[test]
    fn sorts_by_symbol_alphabetically() {
        let quotes = vec![
            quote("zeta", 1.0, None, None),
            quote("Alpha", 1.0, None, None),
        ];
        let filter = ScreenerFilter {
            sort: ScreenerSort::Symbol,
            ..Default::default()
        };
        assert_eq!(symbols(&screen(quotes, &filter)), vec!["Alpha", "zeta"]);
    }

    #[test]
    fn combines_criteria_with_and_not_or() {
        let filter = ScreenerFilter {
            price: Range {
                min: Some(10.0),
                max: None,
            },
            change_24h: Range {
                min: None,
                max: Some(-5.0),
            },
            ..Default::default()
        };
        let out = screen(
            vec![
                quote("BOTH", 50.0, None, Some(-10.0)),
                quote("PRICE_ONLY", 50.0, None, Some(10.0)),
                quote("CHANGE_ONLY", 1.0, None, Some(-10.0)),
            ],
            &filter,
        );
        assert_eq!(symbols(&out), vec!["BOTH"]);
    }

    #[test]
    fn a_non_finite_price_never_matches() {
        let filter = ScreenerFilter {
            price: Range {
                min: Some(0.0),
                max: None,
            },
            ..Default::default()
        };
        assert!(screen(vec![quote("NAN", f64::NAN, None, None)], &filter).is_empty());
    }
}
