pub mod community;
pub mod market;
pub mod news;

use serde::{Deserialize, Serialize};

pub use community::MockCommunityProvider;
pub use market::MockMarketProvider;
pub use news::MockNewsProvider;

/// Forced behaviour for the mock provider.
///
/// Every UI state — including every failure — has to be reachable without a network
/// connection, or the Phase 1 state coverage would be untestable. The dev panel drives this.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MockBehavior {
    #[default]
    Normal,
    Slow,
    Empty,
    Stale,
    RateLimited,
    Error,
    NotConfigured,
}
