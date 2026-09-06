//! The connector catalogue, with live configuration merged in.
//!
//! The catalogue is static; whether a connector is switched on, and whether it holds a
//! credential, is not. This module joins the two so one screen can answer the question the app
//! is built around — *where does this number come from* — for every source at once.
//!
//! It writes nothing. Turning a connector on is `set_provider_enabled`, and adding a key is
//! `save_provider_credential`: the commands Settings already uses, with the keychain handling
//! that has been in place since v0.1. A second write path for credentials would be a second
//! place for one to be mishandled.

pub mod catalogue;

use crate::db::repo_providers;
use crate::error::AppResult;
use crate::models::{ConnectorCatalogue, ConnectorInfo, ConnectorStage, ConnectorSummary};
use crate::state::{with_db, AppState};

/// The whole catalogue, ordered wired → declined → candidate.
pub async fn list(state: &AppState) -> AppResult<ConnectorCatalogue> {
    // One database read for every provider row, rather than one per connector. There are ~100
    // connectors and a dozen rows; the join belongs in memory.
    let rows = with_db(state.pool.clone(), |conn| repo_providers::list(conn)).await?;

    let connectors: Vec<ConnectorInfo> = catalogue::entries()
        .into_iter()
        .map(|entry| {
            let row = entry
                .provider_id
                .and_then(|id| rows.iter().find(|row| row.provider_id == id));

            // A wired adapter with no `provider_config` row is not a bug — FRED and
            // Alternative.me are constructed directly by the services that use them, because
            // neither needs a credential and neither serves market data. They are shown as
            // always-on rather than given a toggle that would do nothing.
            let user_controllable = row.is_some();
            let has_credential = entry
                .provider_id
                .map(crate::security::secrets::exists)
                .unwrap_or(false);

            ConnectorInfo {
                id: entry.id.to_string(),
                display_name: entry.name.to_string(),
                category: entry.category,
                category_label: entry.category.label().to_string(),
                stage: entry.stage,
                summary: entry.summary.to_string(),
                auth: entry.auth,
                terms_risk: entry.risk,
                terms_label: entry.risk.map(|risk| risk.label().to_string()),
                free_tier: entry.free_tier.map(str::to_string),
                attribution: entry.attribution.map(str::to_string),
                docs_url: entry.docs.map(str::to_string),
                note: entry.note.map(str::to_string),
                provider_id: entry.provider_id.map(str::to_string),

                enabled: match row {
                    Some(row) => row.enabled,
                    // No row and a wired adapter means always-on; no row and no adapter means
                    // there is nothing to be on.
                    None => entry.stage == ConnectorStage::Wired,
                },
                user_controllable,
                requires_credential: matches!(
                    entry.auth,
                    Some(crate::models::ConnectorAuth::ApiKey)
                        | Some(crate::models::ConnectorAuth::Oauth)
                ),
                has_credential,
                last_checked_at: row.and_then(|row| row.last_ok_at),
            }
        })
        .collect();

    let count =
        |stage: ConnectorStage| connectors.iter().filter(|c| c.stage == stage).count() as i64;

    let summary = ConnectorSummary {
        wired: count(ConnectorStage::Wired),
        enabled: connectors
            .iter()
            .filter(|c| c.stage == ConnectorStage::Wired && c.enabled)
            .count() as i64,
        declined: count(ConnectorStage::Declined),
        candidates: count(ConnectorStage::Candidate),
    };

    Ok(ConnectorCatalogue {
        connectors,
        summary,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> (AppState, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::bootstrap(dir.path().to_path_buf()).unwrap();
        (state, dir)
    }

    #[tokio::test]
    async fn wired_connectors_come_first() {
        let (state, _dir) = state();
        let result = list(&state).await.unwrap();

        let stages: Vec<ConnectorStage> = result.connectors.iter().map(|c| c.stage).collect();
        let first_candidate = stages
            .iter()
            .position(|s| *s == ConnectorStage::Candidate)
            .unwrap();
        assert!(
            stages[..first_candidate]
                .iter()
                .all(|s| *s != ConnectorStage::Candidate),
            "a candidate appears before the reviewed entries"
        );
        assert_eq!(stages[0], ConnectorStage::Wired);
    }

    #[tokio::test]
    async fn a_connectors_enabled_state_follows_the_provider_registry() {
        let (state, _dir) = state();
        {
            let conn = state.pool.get().unwrap();
            repo_providers::set_enabled(&conn, "coingecko", false).unwrap();
        }

        let result = list(&state).await.unwrap();
        let coingecko = result
            .connectors
            .iter()
            .find(|c| c.id == "coingecko")
            .unwrap();

        assert!(!coingecko.enabled);
        assert!(coingecko.user_controllable);
    }

    /// FRED and Alternative.me have adapters but no `provider_config` row, because the services
    /// that use them construct them directly. Showing a toggle for those would be showing a
    /// control that does nothing.
    #[tokio::test]
    async fn an_always_on_adapter_is_marked_as_not_switchable() {
        let (state, _dir) = state();
        let result = list(&state).await.unwrap();

        for id in ["fred", "alternative-me"] {
            let entry = result.connectors.iter().find(|c| c.id == id).unwrap();
            assert_eq!(entry.stage, ConnectorStage::Wired);
            assert!(entry.enabled, "{id} should read as on");
            assert!(
                !entry.user_controllable,
                "{id} has no row to toggle, so it must not offer one"
            );
            assert!(
                entry.note.is_some(),
                "{id} must explain why it has no toggle"
            );
        }
    }

    #[tokio::test]
    async fn a_candidate_is_never_reported_as_enabled() {
        let (state, _dir) = state();
        let result = list(&state).await.unwrap();

        for connector in result
            .connectors
            .iter()
            .filter(|c| c.stage != ConnectorStage::Wired)
        {
            assert!(
                !connector.enabled,
                "{} is not wired but reports as enabled",
                connector.id
            );
            assert!(!connector.user_controllable);
        }
    }

    #[tokio::test]
    async fn the_summary_matches_the_rows() {
        let (state, _dir) = state();
        let result = list(&state).await.unwrap();

        let total = result.summary.wired + result.summary.declined + result.summary.candidates;
        assert_eq!(total as usize, result.connectors.len());
        assert!(result.summary.enabled <= result.summary.wired);
        assert!(result.summary.candidates > result.summary.wired);
    }

    /// The link the whole feature turns on: an envelope carries a provider id, and that id has
    /// to resolve to a catalogue row or the reader cannot get from a number to its terms.
    #[tokio::test]
    async fn every_provider_id_in_the_registry_resolves_to_a_connector() {
        let (state, _dir) = state();
        let result = list(&state).await.unwrap();
        let known: Vec<&str> = result
            .connectors
            .iter()
            .filter_map(|c| c.provider_id.as_deref())
            .collect();

        for info in state.registry.list_info().await {
            // The fixture provider is a development artefact, not a data source, and is
            // deliberately not in the catalogue.
            if info.id == "mock" || info.id.starts_with("mock-") || info.id.starts_with("ai-") {
                continue;
            }
            assert!(
                known.contains(&info.id.as_str()),
                "provider {:?} is in the registry but has no catalogue entry, so a number it \
                 served could not be traced back to its terms",
                info.id
            );
        }
    }
}
