//! Price alerts.
//!
//! The condition is evaluated here, away from the polling and the storage, so it can be tested
//! exhaustively without either. Everything about when an alert *should* fire lives in
//! `Alert::evaluate`; everything about *when it is asked* lives in the service.

use serde::{Deserialize, Serialize};

use super::Quote;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "kebab-case")]
pub enum AlertKind {
    /// Price rises to or above the threshold.
    PriceAbove,
    /// Price falls to or below the threshold.
    PriceBelow,
    /// 24-hour change rises to or above the threshold, as a percentage.
    ChangeAbove,
    /// 24-hour change falls to or below the threshold, as a percentage.
    ChangeBelow,
}

impl AlertKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::PriceAbove => "price-above",
            Self::PriceBelow => "price-below",
            Self::ChangeAbove => "change-above",
            Self::ChangeBelow => "change-below",
        }
    }

    pub fn from_str_or_default(value: &str) -> Self {
        match value {
            "price-below" => Self::PriceBelow,
            "change-above" => Self::ChangeAbove,
            "change-below" => Self::ChangeBelow,
            _ => Self::PriceAbove,
        }
    }

    /// True when the threshold is a percentage rather than a price.
    pub fn is_percentage(&self) -> bool {
        matches!(self, Self::ChangeAbove | Self::ChangeBelow)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct Alert {
    pub id: String,
    pub asset_id: String,
    pub symbol: String,
    pub kind: AlertKind,
    pub threshold: f64,
    pub enabled: bool,
    pub note: Option<String>,
    #[cfg_attr(test, ts(type = "number"))]
    pub created_at: i64,
    /// Set once when the condition first holds, and cleared only by re-arming.
    #[cfg_attr(test, ts(type = "number | null"))]
    pub triggered_at: Option<i64>,
    /// The value that tripped it, so the notification can say what happened.
    pub triggered_value: Option<f64>,
}

impl Alert {
    /// Whether this alert should fire against a quote, and on what value.
    ///
    /// Returns `None` when it should not — including when it has already fired. An alert that
    /// re-fired on every poll would be indistinguishable from a bug within about a minute.
    pub fn evaluate(&self, quote: &Quote) -> Option<f64> {
        if !self.enabled || self.triggered_at.is_some() {
            return None;
        }
        if quote.asset_id != self.asset_id {
            return None;
        }

        let value = match self.kind {
            AlertKind::PriceAbove | AlertKind::PriceBelow => quote.price,
            // A provider that does not report 24h change cannot trip a change alert. Treating
            // a missing change as zero would fire every "below -5%" alert on every asset with
            // no data.
            AlertKind::ChangeAbove | AlertKind::ChangeBelow => quote.change_pct_24h?,
        };

        if !value.is_finite() {
            return None;
        }

        let tripped = match self.kind {
            AlertKind::PriceAbove | AlertKind::ChangeAbove => value >= self.threshold,
            AlertKind::PriceBelow | AlertKind::ChangeBelow => value <= self.threshold,
        };

        tripped.then_some(value)
    }

    /// A sentence describing what happened, for the notification and the list.
    pub fn describe(&self, value: f64) -> String {
        match self.kind {
            AlertKind::PriceAbove => format!("{} rose to {:.2}", self.symbol, value),
            AlertKind::PriceBelow => format!("{} fell to {:.2}", self.symbol, value),
            AlertKind::ChangeAbove => format!("{} is up {:.2}% over 24h", self.symbol, value),
            AlertKind::ChangeBelow => {
                format!("{} is down {:.2}% over 24h", self.symbol, value.abs())
            }
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.asset_id.trim().is_empty() {
            return Err("Choose an asset.".into());
        }
        if !self.threshold.is_finite() {
            return Err("That threshold is not a number.".into());
        }
        if !self.kind.is_percentage() && self.threshold < 0.0 {
            return Err("A price threshold cannot be negative.".into());
        }
        if self.kind.is_percentage() && !(-100.0..=10_000.0).contains(&self.threshold) {
            return Err("That percentage is outside the range this app handles.".into());
        }
        if self.note.as_ref().is_some_and(|n| n.len() > 200) {
            return Err("That note is too long.".into());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::AssetType;

    fn quote(price: f64, change: Option<f64>) -> Quote {
        Quote {
            asset_id: "crypto:cg:bitcoin".into(),
            symbol: "BTC".into(),
            name: "Bitcoin".into(),
            asset_type: AssetType::Crypto,
            price,
            currency: "USD".into(),
            change_pct_24h: change,
            change_pct_7d: None,
            market_cap: None,
            volume_24h: None,
            sparkline: Vec::new(),
        }
    }

    fn alert(kind: AlertKind, threshold: f64) -> Alert {
        Alert {
            id: "a1".into(),
            asset_id: "crypto:cg:bitcoin".into(),
            symbol: "BTC".into(),
            kind,
            threshold,
            enabled: true,
            note: None,
            created_at: 0,
            triggered_at: None,
            triggered_value: None,
        }
    }

    #[test]
    fn a_price_alert_fires_when_the_threshold_is_reached() {
        let above = alert(AlertKind::PriceAbove, 100.0);
        assert_eq!(above.evaluate(&quote(150.0, None)), Some(150.0));
        assert_eq!(
            above.evaluate(&quote(100.0, None)),
            Some(100.0),
            "at the threshold counts"
        );
        assert_eq!(above.evaluate(&quote(99.0, None)), None);

        let below = alert(AlertKind::PriceBelow, 100.0);
        assert_eq!(below.evaluate(&quote(50.0, None)), Some(50.0));
        assert_eq!(below.evaluate(&quote(100.0, None)), Some(100.0));
        assert_eq!(below.evaluate(&quote(101.0, None)), None);
    }

    #[test]
    fn a_change_alert_reads_the_percentage_not_the_price() {
        let drop = alert(AlertKind::ChangeBelow, -5.0);
        assert_eq!(drop.evaluate(&quote(100.0, Some(-10.0))), Some(-10.0));
        assert_eq!(drop.evaluate(&quote(100.0, Some(-1.0))), None);

        let rise = alert(AlertKind::ChangeAbove, 5.0);
        assert_eq!(rise.evaluate(&quote(1.0, Some(9.0))), Some(9.0));
    }

    /// The trap this avoids: treating "no data" as zero would fire every "down 5%" alert on
    /// every asset the provider does not report a change for.
    #[test]
    fn a_change_alert_never_fires_when_the_provider_reports_no_change() {
        let drop = alert(AlertKind::ChangeBelow, -5.0);
        assert_eq!(drop.evaluate(&quote(100.0, None)), None);
    }

    /// The other trap: an alert that re-fires on every poll is a notification every minute.
    #[test]
    fn an_alert_that_has_already_fired_stays_quiet() {
        let mut fired = alert(AlertKind::PriceAbove, 100.0);
        fired.triggered_at = Some(1_700_000_000);
        assert_eq!(fired.evaluate(&quote(500.0, None)), None);
    }

    #[test]
    fn a_disabled_alert_never_fires() {
        let mut off = alert(AlertKind::PriceAbove, 100.0);
        off.enabled = false;
        assert_eq!(off.evaluate(&quote(500.0, None)), None);
    }

    #[test]
    fn an_alert_only_answers_for_its_own_asset() {
        let mut other = alert(AlertKind::PriceAbove, 1.0);
        other.asset_id = "crypto:cg:ethereum".into();
        assert_eq!(other.evaluate(&quote(500.0, None)), None);
    }

    #[test]
    fn a_non_finite_price_does_not_trip_anything() {
        let above = alert(AlertKind::PriceAbove, 100.0);
        assert_eq!(above.evaluate(&quote(f64::NAN, None)), None);
        assert_eq!(
            above.evaluate(&quote(f64::INFINITY, None)),
            Some(f64::INFINITY).filter(|v| v.is_finite())
        );
    }

    #[test]
    fn the_description_says_what_actually_happened() {
        assert_eq!(
            alert(AlertKind::PriceAbove, 100.0).describe(150.0),
            "BTC rose to 150.00"
        );
        assert_eq!(
            alert(AlertKind::PriceBelow, 100.0).describe(50.0),
            "BTC fell to 50.00"
        );
        assert_eq!(
            alert(AlertKind::ChangeBelow, -5.0).describe(-8.5),
            "BTC is down 8.50% over 24h"
        );
    }

    #[test]
    fn validation_rejects_impossible_thresholds() {
        let mut a = alert(AlertKind::PriceAbove, 100.0);
        assert!(a.validate().is_ok());

        a.threshold = -1.0;
        assert!(a.validate().is_err(), "a negative price is not a price");

        a.threshold = f64::NAN;
        assert!(a.validate().is_err());

        let mut pct = alert(AlertKind::ChangeBelow, -50.0);
        assert!(pct.validate().is_ok(), "a 50% drop is entirely possible");
        pct.threshold = -500.0;
        assert!(
            pct.validate().is_err(),
            "an asset cannot fall more than 100%"
        );
    }
}
