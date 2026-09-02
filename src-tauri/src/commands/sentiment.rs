use tauri::State;

use crate::error::AppResult;
use crate::models::{Envelope, SentimentIndex};
use crate::services;
use crate::state::AppState;

/// The published crypto Fear & Greed Index.
///
/// `None` inside the envelope means no reading was obtainable and nothing was cached; the
/// envelope's `degraded` field says why. It is never a zero, which on this scale would read as
/// maximum fear.
#[tauri::command]
pub async fn get_crypto_sentiment(
    state: State<'_, AppState>,
) -> AppResult<Envelope<Option<SentimentIndex>>> {
    services::sentiment::crypto_index(&state).await
}

/// The equity Fear & Greed Index this app computes from public Federal Reserve series.
#[tauri::command]
pub async fn get_stock_sentiment(
    state: State<'_, AppState>,
) -> AppResult<Envelope<Option<SentimentIndex>>> {
    services::sentiment::stock_index(&state).await
}
