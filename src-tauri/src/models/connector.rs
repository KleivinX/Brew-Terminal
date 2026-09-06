//! The connector catalogue — what this app can read, what it has decided not to, and what
//! nobody has looked at yet.
//!
//! # Connector and provider are different words here
//!
//! A **provider** is a running adapter: it has code, a place in the registry, and it answers
//! requests. A **connector** is a catalogue entry: a data source this project has either wired
//! up, deliberately declined, or merely written down as a candidate.
//!
//! Every provider is a connector. Most connectors are not providers, and the distinction is the
//! whole point of this module.
//!
//! # Why a catalogue needs a review stage at all
//!
//! ADR-008 says no source is wired live until its terms and limits have been read and recorded
//! in `docs/PROVIDERS.md`. A catalogue that listed a hundred sources with rate limits and risk
//! levels beside each would quietly assert that a hundred terms reviews had happened. They have
//! not, and a table is a very convincing place to state something untrue.
//!
//! So `stage` is the first field anything reads, and it gates the rest:
//!
//! - `Wired` — reviewed, recorded, adapter exists, tests pass. Carries real limits and terms.
//! - `Declined` — reviewed, and the answer was no. Carries the reason.
//! - `Candidate` — a name and a category. **No limits, no risk level, no claims.** It is a
//!   queue of things to review, and it says so on screen rather than dressing up as knowledge.
//!
//! That is stricter than the usual "tier 0 / tier 1" split, because tiers describe how much a
//! user is trusted with something, and this describes how much *this project actually knows*.

use serde::{Deserialize, Serialize};

/// What a connector is for, in terms a non-specialist can scan.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "kebab-case")]
pub enum ConnectorCategory {
    CryptoMarket,
    /// A single venue's own API, as distinct from an aggregator.
    Exchange,
    EquitiesMarket,
    Macro,
    Fx,
    Defi,
    Nft,
    Wallet,
    OnchainAnalytics,
    News,
    Filings,
    Geospatial,
}

impl ConnectorCategory {
    pub fn label(self) -> &'static str {
        match self {
            Self::CryptoMarket => "Crypto market data",
            Self::Exchange => "Exchange",
            Self::EquitiesMarket => "Equities and multi-asset",
            Self::Macro => "Macro",
            Self::Fx => "Foreign exchange",
            Self::Defi => "DeFi",
            Self::Nft => "NFT",
            Self::Wallet => "Wallets and balances",
            Self::OnchainAnalytics => "On-chain analytics",
            Self::News => "News and events",
            Self::Filings => "Filings and disclosure",
            Self::Geospatial => "Geospatial",
        }
    }

    pub const ALL: &'static [Self] = &[
        Self::CryptoMarket,
        Self::Exchange,
        Self::EquitiesMarket,
        Self::Macro,
        Self::Fx,
        Self::Defi,
        Self::Nft,
        Self::Wallet,
        Self::OnchainAnalytics,
        Self::News,
        Self::Filings,
        Self::Geospatial,
    ];
}

/// How far a connector has got through the ADR-008 review.
///
/// The ordering matters on screen: wired first, then declined with its reason, then the
/// candidates. A reader scanning the table should reach everything this project actually knows
/// before reaching the list of things it does not.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "kebab-case")]
pub enum ConnectorStage {
    /// Terms read, recorded in PROVIDERS.md, adapter written, tests green.
    Wired,
    /// Terms read, and the answer was no — or not yet. `note` says why.
    Declined,
    /// A name and a category. Nothing has been read.
    Candidate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "kebab-case")]
pub enum ConnectorAuth {
    Keyless,
    ApiKey,
    Oauth,
    /// Works without a key, but a free key raises the limits.
    Mixed,
}

/// What the free tier is actually good for.
///
/// Only ever set on a `Wired` connector, because every value here is a claim about somebody's
/// terms of service.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "kebab-case")]
pub enum TermsRisk {
    /// Documented, free, and the terms permit a shipped desktop app to poll it.
    CoreOk,
    /// Free, but the allowance only stretches to occasional or user-initiated use.
    Tight,
    /// The free tier exists for evaluation. Sustained use is expected to be paid.
    PaidForProduction,
    /// The terms require a written agreement before an application may use it.
    RequiresWrittenAgreement,
}

impl TermsRisk {
    /// The badge text. Deliberately a sentence rather than a colour name — the point is that a
    /// non-expert can tell what enabling this commits them to.
    pub fn label(self) -> &'static str {
        match self {
            Self::CoreOk => "Free, documented, fine to ship",
            Self::Tight => "Free but tightly limited",
            Self::PaidForProduction => "Free to evaluate, paid to rely on",
            Self::RequiresWrittenAgreement => "Needs a written agreement",
        }
    }
}

/// One row of the catalogue, with runtime state merged in.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorInfo {
    pub id: String,
    pub display_name: String,
    pub category: ConnectorCategory,
    pub category_label: String,
    pub stage: ConnectorStage,
    /// One line on what it serves. Present for every entry, including candidates — a category
    /// alone does not tell a reader what CoinGlass or Flipside is.
    pub summary: String,

    // --- Only ever populated for a reviewed connector ---
    pub auth: Option<ConnectorAuth>,
    pub terms_risk: Option<TermsRisk>,
    pub terms_label: Option<String>,
    /// Rate limits in the provider's own terms. Never a guess.
    pub free_tier: Option<String>,
    pub attribution: Option<String>,
    pub docs_url: Option<String>,
    /// Why a connector was declined, or a caveat on a wired one.
    pub note: Option<String>,

    /// The `Envelope.meta.providerId` this connector's data arrives under.
    ///
    /// This is the link that makes the catalogue answer the question the app exists to answer:
    /// a number on screen carries a provider id, and that id resolves to a row here.
    pub provider_id: Option<String>,

    // --- Runtime state ---
    pub enabled: bool,
    /// Whether Settings can switch it. Two wired adapters are not user-controllable: services
    /// construct them directly, so they have no row to toggle. Said plainly rather than shown
    /// as a toggle that does nothing.
    pub user_controllable: bool,
    pub requires_credential: bool,
    pub has_credential: bool,
    /// When this provider last answered a check successfully.
    ///
    /// Named for what it is. `provider_config.last_ok_at` is written when a credential is saved
    /// or "Test provider" is pressed — **not** on ordinary data requests — so calling it "last
    /// used" would overstate it by a wide margin.
    #[cfg_attr(test, ts(type = "number | null"))]
    pub last_checked_at: Option<i64>,
}

/// Counts for the header, so the shape of the catalogue is visible before scrolling it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorSummary {
    #[cfg_attr(test, ts(type = "number"))]
    pub wired: i64,
    #[cfg_attr(test, ts(type = "number"))]
    pub enabled: i64,
    #[cfg_attr(test, ts(type = "number"))]
    pub declined: i64,
    #[cfg_attr(test, ts(type = "number"))]
    pub candidates: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(
    test,
    derive(ts_rs::TS),
    ts(export, export_to = "../../src/types/generated/")
)]
#[serde(rename_all = "camelCase")]
pub struct ConnectorCatalogue {
    pub connectors: Vec<ConnectorInfo>,
    pub summary: ConnectorSummary,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_category_is_labelled_and_listed_once() {
        let mut labels: Vec<&str> = ConnectorCategory::ALL.iter().map(|c| c.label()).collect();
        assert!(labels.iter().all(|l| !l.is_empty()));

        let count = labels.len();
        labels.sort_unstable();
        labels.dedup();
        assert_eq!(labels.len(), count, "two categories share a label");
        assert_eq!(count, 12, "a category was added without adding it to ALL");
    }

    #[test]
    fn every_risk_level_says_what_it_commits_you_to() {
        for risk in [
            TermsRisk::CoreOk,
            TermsRisk::Tight,
            TermsRisk::PaidForProduction,
            TermsRisk::RequiresWrittenAgreement,
        ] {
            assert!(!risk.label().is_empty());
        }
    }
}
