use serde::{Deserialize, Serialize};

use super::AssetType;

/// Sparkline points are capped at the adapter boundary so the UI never receives a series it
/// would have to downsample itself. See ADR-006.
pub const MAX_SPARKLINE_POINTS: usize = 24;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Quote {
    pub asset_id: String,
    pub symbol: String,
    pub name: String,
    pub asset_type: AssetType,
    pub price: f64,
    pub currency: String,
    pub change_pct_24h: Option<f64>,
    pub change_pct_7d: Option<f64>,
    pub market_cap: Option<f64>,
    pub volume_24h: Option<f64>,
    #[serde(default)]
    pub sparkline: Vec<f64>,
}

impl Quote {
    /// Validation applied to every quote before it leaves the adapter layer.
    ///
    /// Provider responses are untrusted input: a NaN price, a negative market cap or a
    /// thousand-point sparkline all have to be caught here rather than in a React component.
    /// One bad record fails that record, not the whole request. See THREAT_MODEL.md §3.
    pub fn validate_and_normalize(mut self) -> Result<Self, String> {
        if self.asset_id.trim().is_empty() {
            return Err("empty asset id".into());
        }
        if self.symbol.trim().is_empty() {
            return Err("empty symbol".into());
        }
        if !self.price.is_finite() || self.price < 0.0 {
            return Err(format!("non-finite or negative price for {}", self.symbol));
        }
        if self.currency.len() != 3 {
            return Err(format!(
                "currency is not ISO-4217 shaped: {}",
                self.currency
            ));
        }
        self.currency = self.currency.to_uppercase();

        // A percentage outside this band is a provider bug, not a market event. Dropping the
        // field keeps the row usable rather than discarding a valid price.
        self.change_pct_24h = sane_percent(self.change_pct_24h);
        self.change_pct_7d = sane_percent(self.change_pct_7d);
        self.market_cap = sane_positive(self.market_cap);
        self.volume_24h = sane_positive(self.volume_24h);

        self.sparkline.retain(|v| v.is_finite());
        if self.sparkline.len() > MAX_SPARKLINE_POINTS {
            self.sparkline = downsample(&self.sparkline, MAX_SPARKLINE_POINTS);
        }

        Ok(self)
    }
}

fn sane_percent(value: Option<f64>) -> Option<f64> {
    value.filter(|v| v.is_finite() && v.abs() <= 100_000.0)
}

fn sane_positive(value: Option<f64>) -> Option<f64> {
    value.filter(|v| v.is_finite() && *v >= 0.0)
}

/// Even sampling that always keeps the first and last point, so the visible endpoints of a
/// sparkline match the period's actual start and end.
pub fn downsample(series: &[f64], target: usize) -> Vec<f64> {
    if series.len() <= target || target < 2 {
        return series.to_vec();
    }
    let last = series.len() - 1;
    (0..target)
        .map(|i| {
            let index = (i * last) / (target - 1);
            series[index]
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_quote() -> Quote {
        Quote {
            asset_id: "crypto:cg:bitcoin".into(),
            symbol: "BTC".into(),
            name: "Bitcoin".into(),
            asset_type: AssetType::Crypto,
            price: 61_240.55,
            currency: "usd".into(),
            change_pct_24h: Some(1.9),
            change_pct_7d: Some(-3.2),
            market_cap: Some(1.2e12),
            volume_24h: Some(2.8e10),
            sparkline: vec![1.0, 2.0, 3.0],
        }
    }

    #[test]
    fn uppercases_currency() {
        let quote = base_quote().validate_and_normalize().unwrap();
        assert_eq!(quote.currency, "USD");
    }

    #[test]
    fn rejects_non_finite_price() {
        let mut quote = base_quote();
        quote.price = f64::NAN;
        assert!(quote.validate_and_normalize().is_err());
    }

    #[test]
    fn rejects_negative_price() {
        let mut quote = base_quote();
        quote.price = -1.0;
        assert!(quote.validate_and_normalize().is_err());
    }

    #[test]
    fn drops_absurd_percentages_but_keeps_the_row() {
        let mut quote = base_quote();
        quote.change_pct_24h = Some(f64::INFINITY);
        let quote = quote.validate_and_normalize().unwrap();
        assert!(quote.change_pct_24h.is_none());
        assert_eq!(
            quote.price, 61_240.55,
            "a bad percentage must not lose the price"
        );
    }

    #[test]
    fn caps_sparkline_length() {
        let mut quote = base_quote();
        quote.sparkline = (0..500).map(|i| i as f64).collect();
        let quote = quote.validate_and_normalize().unwrap();
        assert_eq!(quote.sparkline.len(), MAX_SPARKLINE_POINTS);
    }

    #[test]
    fn downsample_preserves_endpoints() {
        let series: Vec<f64> = (0..100).map(|i| i as f64).collect();
        let out = downsample(&series, 24);
        assert_eq!(out.len(), 24);
        assert_eq!(out.first(), Some(&0.0));
        assert_eq!(out.last(), Some(&99.0));
    }

    #[test]
    fn strips_non_finite_sparkline_points() {
        let mut quote = base_quote();
        quote.sparkline = vec![1.0, f64::NAN, 3.0];
        let quote = quote.validate_and_normalize().unwrap();
        assert_eq!(quote.sparkline, vec![1.0, 3.0]);
    }
}
