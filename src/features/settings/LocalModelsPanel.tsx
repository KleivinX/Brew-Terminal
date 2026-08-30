import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Panel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/status/StatusPill';
import { ipc } from '@/lib/ipc';
import type { LocalModel } from '@/types/domain';
import styles from './LocalModelsPanel.module.css';

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  const gb = bytes / 1_000_000_000;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.round(bytes / 1_000_000)} MB`;
}

export function LocalModelsPanel() {
  const queryClient = useQueryClient();

  const { data: overview } = useQuery({
    queryKey: ['local-models'],
    queryFn: () => ipc('get_local_models'),
  });

  // Polled only while something is actually downloading, so an idle app makes no calls.
  const { data: progress } = useQuery({
    queryKey: ['download-progress'],
    queryFn: () => ipc('get_download_progress'),
    refetchInterval: (query) => (query.state.data ? 500 : false),
    enabled: Boolean(overview),
  });

  const refresh = (result: unknown): void => {
    queryClient.setQueryData(['local-models'], result);
    void queryClient.invalidateQueries({ queryKey: ['download-progress'] });
    // Starting or stopping a model changes what the Model Desk can do.
    void queryClient.invalidateQueries({ queryKey: ['ai-status'] });
  };

  const installEngine = useMutation({
    mutationFn: () => ipc('install_engine'),
    onSuccess: refresh,
  });
  const downloadModel = useMutation({
    mutationFn: (modelId: string) => ipc('download_model', { modelId }),
    onSuccess: refresh,
  });
  const deleteModel = useMutation({
    mutationFn: (modelId: string) => ipc('delete_local_model', { modelId }),
    onSuccess: refresh,
  });
  const startModel = useMutation({
    mutationFn: (modelId: string) => ipc('start_local_model', { modelId }),
    onSuccess: refresh,
  });
  const stopModel = useMutation({
    mutationFn: () => ipc('stop_local_model'),
    onSuccess: refresh,
  });
  const cancel = useMutation({
    mutationFn: () => ipc('cancel_download'),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['download-progress'] }),
  });

  if (!overview) return null;

  if (!overview.supported) {
    return (
      <Panel title="Run a model on this computer">
        <div className={styles.body}>
          <p>
            No inference engine has been prepared for this kind of machine
            {' ('}
            {navigator.platform || 'unknown platform'}
            {'), '}
            so the app cannot download one for you here. You can still point the Model Desk at a
            model server you run yourself.
          </p>
        </div>
      </Panel>
    );
  }

  const { engine, models, diskUsedBytes } = overview;
  const busy = progress ?? null;

  const percent =
    busy && busy.totalBytes > 0 ? Math.round((busy.downloadedBytes / busy.totalBytes) * 100) : 0;

  return (
    <div className={styles.stack}>
      <Panel
        title="Run a model on this computer"
        meta="Downloads an open-source engine and the weights you choose. Everything runs on this machine and nothing is sent anywhere."
        actions={
          <StatusPill
            state={engine.running ? 'ready' : engine.installed ? 'empty' : 'not-configured'}
            label={engine.running ? 'Running' : engine.installed ? 'Ready' : 'Not installed'}
          />
        }
      >
        <div className={styles.body}>
          <p className={styles.notice}>
            This downloads third-party software and model weights from their publishers. Each
            download is checked against a checksum published by that publisher before it is used —
            which proves the file is the one they released, not that anyone here has reviewed it.
            Models can be wrong, and a small one more often than a large one.
          </p>

          <dl className={styles.facts}>
            <dt>Engine</dt>
            <dd>
              {engine.project} {engine.build} · {engine.licence} ·{' '}
              <a href={engine.sourceUrl} target="_blank" rel="noreferrer noopener">
                Source
              </a>
            </dd>
            <dt>Address when running</dt>
            <dd className="tabular">{engine.endpoint}</dd>
            <dt>Disk used</dt>
            <dd className="tabular">{formatBytes(diskUsedBytes)}</dd>
          </dl>

          {!engine.installed ? (
            <Button
              variant="primary"
              onClick={() => installEngine.mutate()}
              disabled={installEngine.isPending || busy !== null}
            >
              {installEngine.isPending ? 'Downloading the engine…' : 'Download the engine (~11 MB)'}
            </Button>
          ) : null}

          {installEngine.isError ? (
            <p className={styles.error} role="alert">
              The engine could not be installed. Check your connection and try again.
            </p>
          ) : null}

          {busy ? (
            <div className={styles.progress}>
              <div className={styles.progressRow}>
                <span>
                  Downloading {busy.itemId === 'engine' ? 'the engine' : busy.itemId} —{' '}
                  {formatBytes(busy.downloadedBytes)} of {formatBytes(busy.totalBytes)}
                </span>
                <Button variant="ghost" size="sm" onClick={() => cancel.mutate()}>
                  Cancel
                </Button>
              </div>
              <progress className={styles.bar} value={percent} max={100}>
                {percent}%
              </progress>
              <p className={styles.hint}>
                A cancelled download keeps what it already fetched, so resuming is quick.
              </p>
            </div>
          ) : null}
        </div>
      </Panel>

      <Panel title="Models" meta="Sized to run on an ordinary laptop rather than a workstation.">
        <ul role="list" className={styles.list}>
          {models.map((model: LocalModel) => {
            const isLoaded = engine.loadedModel === model.id;
            return (
              <li key={model.id} className={styles.model}>
                <div className={styles.modelMain}>
                  <span className={styles.modelName}>
                    {model.name}
                    {isLoaded && engine.running ? (
                      <span className={styles.running}>Running</span>
                    ) : null}
                  </span>
                  <span className={styles.description}>{model.description}</span>
                  <span className={styles.specs}>
                    {model.parameters} · {model.quantisation} · {formatBytes(model.sizeBytes)} on
                    disk · about {(model.approxRamMb / 1000).toFixed(1)} GB of memory to run
                  </span>
                  <span className={styles.specs}>
                    {model.publisher} · {model.licence} ·{' '}
                    <a href={model.sourceUrl} target="_blank" rel="noreferrer noopener">
                      Model card
                    </a>
                  </span>
                  {model.partialBytes > 0 && !model.installed ? (
                    <span className={styles.partial}>
                      {formatBytes(model.partialBytes)} already downloaded — it will resume where it
                      stopped.
                    </span>
                  ) : null}
                </div>

                <div className={styles.modelActions}>
                  {!model.installed ? (
                    <Button
                      variant="secondary"
                      onClick={() => downloadModel.mutate(model.id)}
                      disabled={busy !== null || downloadModel.isPending}
                    >
                      {model.partialBytes > 0 ? 'Resume' : 'Download'}
                    </Button>
                  ) : (
                    <>
                      {isLoaded && engine.running ? (
                        <Button variant="secondary" onClick={() => stopModel.mutate()}>
                          Stop
                        </Button>
                      ) : (
                        <Button
                          variant="primary"
                          onClick={() => startModel.mutate(model.id)}
                          disabled={!engine.installed}
                        >
                          Start
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        onClick={() => deleteModel.mutate(model.id)}
                        aria-label={`Delete ${model.name}`}
                      >
                        Delete
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>

      {engine.running ? (
        <Panel title="Using it">
          <div className={styles.body}>
            <p>
              The model is answering on <code className="tabular">{engine.endpoint}</code>. Open the
              Model Desk and it will be used automatically — the address is on this computer, so
              nothing you send leaves it.
            </p>
            <p className={styles.hint}>
              Closing Brew Terminal stops the model and frees the memory it was using.
            </p>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
