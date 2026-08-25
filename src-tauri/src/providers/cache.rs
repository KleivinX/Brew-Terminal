use crate::models::ChartRange;

/// TTLs by data class.
///
/// These mirror the frontend's `STALE_TIMES` so the two cache tiers do not fight: the memory
/// tier considering something fresh while the durable tier considers it stale would produce
/// refreshes the user never sees. See DATA_MODEL.md and ARCHITECTURE.md §4.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CacheKind {
    Quote,
    ChartIntraday,
    ChartHistorical,
    Profile,
    News,
    Community,
    Search,
}

impl CacheKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Quote => "quote",
            Self::ChartIntraday => "chart_intraday",
            Self::ChartHistorical => "chart_historical",
            Self::Profile => "profile",
            Self::News => "news",
            Self::Community => "community",
            Self::Search => "search",
        }
    }

    pub fn ttl_seconds(&self) -> i64 {
        match self {
            Self::Quote => 60,
            // Intraday shape does not change second to second, and a free tier will not
            // survive it being treated as if it did.
            Self::ChartIntraday => 5 * 60,
            // Historical daily closes are effectively immutable once the day is done.
            Self::ChartHistorical => 6 * 60 * 60,
            Self::Profile => 7 * 24 * 60 * 60,
            Self::News => 10 * 60,
            // Explicitly not real-time. Community volume is not a signal to chase.
            Self::Community => 30 * 60,
            Self::Search => 24 * 60 * 60,
        }
    }

    pub fn for_chart(range: ChartRange) -> Self {
        match range {
            ChartRange::Day => Self::ChartIntraday,
            _ => Self::ChartHistorical,
        }
    }
}

/// Deterministic cache key. Arguments are normalized (sorted, lowercased) so that the same
/// logical request always produces the same key regardless of how the caller ordered things —
/// otherwise single-flight deduplication would miss.
pub fn cache_key(provider_id: &str, endpoint: &str, args: &[String]) -> String {
    let mut normalized: Vec<String> = args.iter().map(|a| a.to_lowercase()).collect();
    normalized.sort();
    format!("{provider_id}:{endpoint}:{}", normalized.join(","))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_key_is_order_independent() {
        let a = cache_key("mock", "quotes", &["btc".into(), "eth".into()]);
        let b = cache_key("mock", "quotes", &["eth".into(), "btc".into()]);
        assert_eq!(a, b, "argument order must not fragment the cache");
    }

    #[test]
    fn cache_key_is_case_insensitive() {
        let a = cache_key("mock", "quotes", &["BTC".into()]);
        let b = cache_key("mock", "quotes", &["btc".into()]);
        assert_eq!(a, b);
    }

    #[test]
    fn cache_key_separates_providers_and_endpoints() {
        assert_ne!(
            cache_key("mock", "quotes", &["btc".into()]),
            cache_key("finnhub", "quotes", &["btc".into()])
        );
        assert_ne!(
            cache_key("mock", "quotes", &["btc".into()]),
            cache_key("mock", "chart", &["btc".into()])
        );
    }

    #[test]
    fn intraday_charts_expire_faster_than_historical() {
        assert!(
            CacheKind::for_chart(ChartRange::Day).ttl_seconds()
                < CacheKind::for_chart(ChartRange::Year).ttl_seconds()
        );
    }

    #[test]
    fn community_is_not_treated_as_real_time() {
        assert!(CacheKind::Community.ttl_seconds() >= 30 * 60);
    }
}
