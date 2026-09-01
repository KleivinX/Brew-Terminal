import { beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModelDeskRoute } from '@/features/model-desk/ModelDeskRoute';
import { MessageList } from '@/features/model-desk/MessageList';
import { AiPanel } from '@/features/settings/AiPanel';
import { detectAdviceShapedPrompt, scanResponse } from '@/features/model-desk/guardrails';
import { browserInvoke, __resetHarness } from '@/lib/ipc.browser';
import { __resetSession } from '@/features/model-desk/session';
import type { AiMessage } from '@/types/domain';
import { renderWithProviders } from '../setup/renderWithProviders';
import { DISCLAIMER_TEXT } from '@/components/status/DisclaimerNote';

/**
 * The reach label appears twice on the settings page — once in the status pill, once in the
 * prose explaining what it means. Only the pill reflects the saved endpoint, so assertions
 * scope to it; an unscoped query would pass before anything was saved at all.
 */
function statusPillText(): string {
  return document.querySelector('[data-state]')?.textContent ?? '';
}

/** Puts the harness in the state a configured, switched-on local model would leave it. */
async function configureLocalModel(endpoint = 'http://127.0.0.1:11434/v1'): Promise<void> {
  await browserInvoke('save_ai_endpoint', { endpoint, model: 'llama3.1' });
  await browserInvoke('set_preference', { key: 'aiEnabled', value: 'true' });
}

function message(role: AiMessage['role'], content: string, id = role): AiMessage {
  return { id, conversationId: 'c1', role, content, createdAt: 1_700_000_000 };
}

/*
 * These tests configure the harness *before* rendering, so they render with
 * `resetHarness: false` — which means the reset has to happen here instead. Without it the
 * outbound log carries over from the previous test, and an assertion that nothing was sent
 * passes or fails depending on what ran first.
 */
beforeEach(() => {
  __resetHarness();
  __resetSession();
});

/** Puts the harness in the state a configured, keyed cloud provider would leave it. */
async function configureCloudModel(): Promise<void> {
  await browserInvoke('save_ai_cloud_endpoint', {
    endpoint: 'https://api.example.com/v1',
    model: 'gpt-oss',
  });
  await browserInvoke('save_provider_credential', {
    providerId: 'cloud-openai',
    apiKey: 'sk-test-do-not-use-1234567890',
  });
  await browserInvoke('set_preference', { key: 'aiMode', value: '"cloud"' });
  await browserInvoke('set_preference', { key: 'aiEnabled', value: 'true' });
}

describe('Model Desk — the off state', () => {
  it('is switched off before anything is configured', async () => {
    renderWithProviders(<ModelDeskRoute />);

    expect(await screen.findByText(/No model configured/i)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /your question/i })).not.toBeInTheDocument();
  });

  it('distinguishes "no endpoint" from "endpoint saved but desk off"', async () => {
    await browserInvoke('save_ai_endpoint', {
      endpoint: 'http://127.0.0.1:11434/v1',
      model: 'llama3.1',
    });
    renderWithProviders(<ModelDeskRoute />, { resetHarness: false });

    // The fix differs, so the two states must not read the same.
    expect(
      await screen.findByText(/An endpoint is saved, but the desk is off/i),
    ).toBeInTheDocument();
  });

  it('says out loud that the guardrails do not make a model safe', async () => {
    renderWithProviders(<ModelDeskRoute />);

    expect(await screen.findByText(/do not make any model safe/i)).toBeInTheDocument();
  });

  it('carries the disclaimer even while switched off', async () => {
    renderWithProviders(<ModelDeskRoute />);

    const disclaimers = await screen.findAllByText(DISCLAIMER_TEXT);
    expect(disclaimers.length).toBeGreaterThan(0);
  });
});

describe('Model Desk — sending', () => {
  it('sends nothing until the user asks', async () => {
    await configureLocalModel();
    renderWithProviders(<ModelDeskRoute />, { resetHarness: false });

    await screen.findByRole('textbox', { name: /your question/i });
    // Rendering the desk, loading status, conversations and preview must not be a send.
    const log = await browserInvoke('list_ai_outbound_log');
    expect(log).toEqual([]);
  });

  it('records the send in the outbound log and shows the answer', async () => {
    const user = userEvent.setup();
    await configureLocalModel();
    renderWithProviders(<ModelDeskRoute />, { resetHarness: false });

    const input = await screen.findByRole('textbox', { name: /your question/i });
    await user.type(input, 'What is an ETF?');
    await user.click(screen.getByRole('button', { name: /^Send$/ }));

    await waitFor(() =>
      expect(screen.getByText(/browser harness, not a model/i)).toBeInTheDocument(),
    );

    const log = (await browserInvoke('list_ai_outbound_log')) as unknown[];
    expect(log).toHaveLength(1);
  });

  it('shows the reach label rather than deciding "offline" for itself', async () => {
    await configureLocalModel();
    renderWithProviders(<ModelDeskRoute />, { resetHarness: false });

    expect(await screen.findByText(/Local · offline/)).toBeInTheDocument();
  });

  it('labels a networked endpoint as leaving the machine', async () => {
    await browserInvoke('save_ai_endpoint', {
      endpoint: 'https://models.example.com/v1',
      model: 'gpt-oss',
    });
    await browserInvoke('set_preference', { key: 'aiEnabled', value: 'true' });
    renderWithProviders(<ModelDeskRoute />, { resetHarness: false });

    expect(await screen.findByText(/Local endpoint · network/)).toBeInTheDocument();
  });

  /**
   * A send that leaves the machine must pass through the itemised panel first — it cannot go
   * straight out on a single click. See AI_POLICY.md §2.2.
   */
  it('requires the consent panel before anything leaves the computer', async () => {
    const user = userEvent.setup();
    await browserInvoke('save_ai_endpoint', {
      endpoint: 'https://models.example.com/v1',
      model: 'gpt-oss',
    });
    await browserInvoke('set_preference', { key: 'aiEnabled', value: 'true' });
    renderWithProviders(<ModelDeskRoute />, { resetHarness: false });

    const input = await screen.findByRole('textbox', { name: /your question/i });
    await user.type(input, 'What is an ETF?');
    await user.click(screen.getByRole('button', { name: /Review and send/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/leaves your computer/i)).toBeInTheDocument();

    // Nothing has gone out on opening the panel.
    expect(await browserInvoke('list_ai_outbound_log')).toEqual([]);

    const confirm = within(dialog).getByRole('button', { name: /Send off this computer/i });
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);
    await waitFor(async () => {
      expect((await browserInvoke('list_ai_outbound_log')) as unknown[]).toHaveLength(1);
    });
  });

  it('lets the consent panel be cancelled without sending', async () => {
    const user = userEvent.setup();
    await browserInvoke('save_ai_endpoint', {
      endpoint: 'https://models.example.com/v1',
      model: 'gpt-oss',
    });
    await browserInvoke('set_preference', { key: 'aiEnabled', value: 'true' });
    renderWithProviders(<ModelDeskRoute />, { resetHarness: false });

    const input = await screen.findByRole('textbox', { name: /your question/i });
    await user.type(input, 'What is an ETF?');
    await user.click(screen.getByRole('button', { name: /Review and send/i }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /Cancel/i }));

    expect(await browserInvoke('list_ai_outbound_log')).toEqual([]);
  });
});

describe('Model Desk — the advice nudge', () => {
  it('offers a reframing without touching what was typed', async () => {
    const user = userEvent.setup();
    await configureLocalModel();
    renderWithProviders(<ModelDeskRoute />, { resetHarness: false });

    const input = (await screen.findByRole('textbox', {
      name: /your question/i,
    })) as HTMLTextAreaElement;
    await user.type(input, 'Should I buy bitcoin');

    expect(await screen.findByRole('note')).toBeInTheDocument();
    // The box still holds exactly what the user wrote. A guardrail that edits it silently
    // would leave them unable to tell what they asked.
    expect(input.value).toBe('Should I buy bitcoin');
    expect(screen.getByRole('button', { name: /^Send$/ })).toBeEnabled();
  });

  it('replaces the text only when the reframing is chosen', async () => {
    const user = userEvent.setup();
    await configureLocalModel();
    renderWithProviders(<ModelDeskRoute />, { resetHarness: false });

    const input = (await screen.findByRole('textbox', {
      name: /your question/i,
    })) as HTMLTextAreaElement;
    await user.type(input, 'Should I buy bitcoin');
    await user.click(await screen.findByRole('button', { name: /Ask this instead/i }));

    expect(input.value).toMatch(/What is bitcoin/i);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('dismisses without altering the prompt when the user keeps theirs', async () => {
    const user = userEvent.setup();
    await configureLocalModel();
    renderWithProviders(<ModelDeskRoute />, { resetHarness: false });

    const input = (await screen.findByRole('textbox', {
      name: /your question/i,
    })) as HTMLTextAreaElement;
    await user.type(input, 'Should I sell my ETH');
    await user.click(await screen.findByRole('button', { name: /Keep mine/i }));

    expect(input.value).toBe('Should I sell my ETH');
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});

describe('advice-shaped prompt detection', () => {
  it.each([
    'Should I buy AAPL?',
    'should i sell my bitcoin',
    'Is Solana a good investment',
    'When should I buy the dip',
    'what is the price prediction for ETH',
    'How much should I put in',
    'Will BTC go up this year',
  ])('flags %s', (prompt) => {
    expect(detectAdviceShapedPrompt(prompt)).not.toBeNull();
  });

  it.each([
    'What is an ETF?',
    'How does staking work',
    'Explain the bid-ask spread',
    'What does a P/E ratio actually measure?',
    'Who regulates exchanges in the EU',
  ])('leaves the educational question %s alone', (prompt) => {
    expect(detectAdviceShapedPrompt(prompt)).toBeNull();
  });
});

describe('Model Desk — model output', () => {
  it('cautions advice-shaped answers and still shows them in full', () => {
    const answer = 'Honestly this is a strong buy and the returns are risk-free.';
    renderWithProviders(<MessageList messages={[message('assistant', answer)]} pending={false} />);

    expect(screen.getByRole('note')).toHaveTextContent(/advice-shaped language/i);
    // Never suppressed — the user has to be able to see what their model actually said.
    expect(screen.getByText(answer)).toBeInTheDocument();
  });

  it('quotes what matched rather than gesturing at it', () => {
    renderWithProviders(
      <MessageList messages={[message('assistant', 'This is a strong buy.')]} pending={false} />,
    );

    expect(screen.getByRole('note')).toHaveTextContent(/strong buy/i);
  });

  it('leaves an ordinary educational answer uncautioned', () => {
    const answer = 'An ETF is a fund that trades on an exchange. Its main risks are liquidity.';
    renderWithProviders(<MessageList messages={[message('assistant', answer)]} pending={false} />);

    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(screen.getByText(answer)).toBeInTheDocument();
  });

  it('attaches the disclaimer to every model answer', () => {
    renderWithProviders(
      <MessageList messages={[message('assistant', 'An ETF is a fund.')]} pending={false} />,
    );

    expect(screen.getByText(DISCLAIMER_TEXT)).toBeInTheDocument();
  });

  it('does not caution the user’s own words back at them', () => {
    // The scan is for model output. A user is free to type whatever they like.
    renderWithProviders(
      <MessageList messages={[message('user', 'is this a strong buy?')]} pending={false} />,
    );

    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('renders model output as text, never as markup', () => {
    const hostile = '<img src=x onerror="alert(1)"> **not bold**';
    const { container } = renderWithProviders(
      <MessageList messages={[message('assistant', hostile)]} pending={false} />,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(hostile)).toBeInTheDocument();
  });
});

describe('response scanning', () => {
  it('returns every distinct phrase it found', () => {
    const found = scanResponse('A strong buy with a price target and guaranteed returns.');
    expect(found.length).toBeGreaterThanOrEqual(3);
  });

  it('returns nothing for a clean answer', () => {
    expect(scanResponse('Volatility measures how much a price moves, not which way.')).toEqual([]);
  });
});

describe('AI settings', () => {
  it('refuses a plaintext address that is not on this machine', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AiPanel />);

    await user.type(await screen.findByLabelText(/Endpoint address/i), 'http://192.168.1.20:11434');
    await user.type(screen.getByLabelText(/Model name/i), 'llama3.1');
    await user.click(screen.getByRole('button', { name: /Save endpoint/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('accepts a loopback address and reports it as offline', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AiPanel />);

    await user.type(await screen.findByLabelText(/Endpoint address/i), 'http://127.0.0.1:11434/v1');
    await user.type(screen.getByLabelText(/Model name/i), 'llama3.1');
    await user.click(screen.getByRole('button', { name: /Save endpoint/i }));

    await waitFor(() => expect(statusPillText()).toMatch(/Local · offline/));
  });

  /** Saving an address is not consent to use it. AI_POLICY.md §1. */
  it('leaves the desk switched off after an endpoint is saved', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AiPanel />);

    await user.type(await screen.findByLabelText(/Endpoint address/i), 'http://127.0.0.1:11434/v1');
    await user.type(screen.getByLabelText(/Model name/i), 'llama3.1');
    await user.click(screen.getByRole('button', { name: /Save endpoint/i }));

    await waitFor(() => expect(statusPillText()).toMatch(/Local · offline/));
    expect(screen.getByRole('switch', { name: /Use the Model Desk/i })).not.toBeChecked();
  });
});

describe('Model Desk — the cloud path', () => {
  it('labels a hosted provider as cloud', async () => {
    await configureCloudModel();
    renderWithProviders(<ModelDeskRoute />, { resetHarness: false });

    expect(await screen.findByText(/Cloud · API/)).toBeInTheDocument();
  });

  /** AI_POLICY.md §2.3: the first hosted send of a session gets its own warning. */
  it('warns before the first hosted send of a session, then stops repeating it', async () => {
    const user = userEvent.setup();
    await configureCloudModel();
    renderWithProviders(<ModelDeskRoute />, { resetHarness: false });

    const input = await screen.findByRole('textbox', { name: /your question/i });
    await user.type(input, 'What is an ETF?');
    await user.click(screen.getByRole('button', { name: /Review and send/i }));

    let dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(/First send to a hosted model this session/i),
    ).toBeInTheDocument();

    const confirm = within(dialog).getByRole('button', { name: /Send off this computer/i });
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);

    // The answer landing is the completion signal. The log row is written before the request
    // resolves — by design, since it records an attempt — so waiting on it races the mutation.
    await waitFor(() =>
      expect(screen.getByText(/browser harness, not a model/i)).toBeInTheDocument(),
    );

    // Second send in the same session: still the consent panel, no longer the session banner.
    await user.type(screen.getByRole('textbox', { name: /your question/i }), 'And an index fund?');
    await user.click(screen.getByRole('button', { name: /Review and send/i }));

    dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/leaves your computer/i)).toBeInTheDocument();
    expect(
      within(dialog).queryByText(/First send to a hosted model this session/i),
    ).not.toBeInTheDocument();
  });

  it('records the hosted provider and mode in the outbound log', async () => {
    const user = userEvent.setup();
    await configureCloudModel();
    renderWithProviders(<ModelDeskRoute />, { resetHarness: false });

    const input = await screen.findByRole('textbox', { name: /your question/i });
    await user.type(input, 'What is an ETF?');
    await user.click(screen.getByRole('button', { name: /Review and send/i }));

    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: /Send off this computer/i });
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);

    await waitFor(async () => {
      const log = (await browserInvoke('list_ai_outbound_log')) as Array<{
        providerId: string;
        mode: string;
      }>;
      expect(log[0]?.providerId).toBe('cloud-openai');
      expect(log[0]?.mode).toBe('cloud');
    });
  });
});

describe('AI settings — the hosted provider', () => {
  it('refuses a plaintext hosted endpoint, with no loopback exemption', async () => {
    const user = userEvent.setup();
    await browserInvoke('set_preference', { key: 'aiMode', value: '"cloud"' });
    renderWithProviders(<AiPanel />, { resetHarness: false });

    await user.type(await screen.findByLabelText(/Endpoint address/i), 'http://127.0.0.1:8080/v1');
    await user.type(screen.getByLabelText(/Model name/i), 'gpt-oss');
    await user.click(screen.getByRole('button', { name: /Save endpoint/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('keeps the desk unusable until a key is stored', async () => {
    const user = userEvent.setup();
    await browserInvoke('set_preference', { key: 'aiMode', value: '"cloud"' });
    renderWithProviders(<AiPanel />, { resetHarness: false });

    await user.type(
      await screen.findByLabelText(/Endpoint address/i),
      'https://api.example.com/v1',
    );
    await user.type(screen.getByLabelText(/Model name/i), 'gpt-oss');
    await user.click(screen.getByRole('button', { name: /Save endpoint/i }));

    await waitFor(() => expect(statusPillText()).toMatch(/Not configured/));
    expect(screen.getByRole('switch', { name: /Use the Model Desk/i })).toBeDisabled();
  });

  it('remembers both providers across a mode switch', async () => {
    await browserInvoke('save_ai_endpoint', {
      endpoint: 'http://127.0.0.1:11434/v1',
      model: 'llama3.1',
    });
    await browserInvoke('save_ai_cloud_endpoint', {
      endpoint: 'https://api.example.com/v1',
      model: 'gpt-oss',
    });
    await browserInvoke('set_preference', { key: 'aiMode', value: '"cloud"' });

    const status = (await browserInvoke('get_ai_status')) as {
      local: { model: string | null };
      cloud: { model: string | null };
      model: string | null;
    };
    expect(status.local.model).toBe('llama3.1');
    expect(status.cloud.model).toBe('gpt-oss');
    expect(status.model).toBe('gpt-oss');
  });

  /**
   * Phase 5 requires this explicitly: the key goes in once and is never readable again. The
   * harness mirrors the Rust rule, so the assertion is that no payload the frontend can obtain
   * carries the value.
   */
  it('never returns the API key to the frontend', async () => {
    const secret = 'sk-test-do-not-use-1234567890';
    await configureCloudModel();

    const payloads = await Promise.all([
      browserInvoke('get_ai_status'),
      browserInvoke('list_providers'),
      browserInvoke('list_ai_outbound_log'),
      browserInvoke('get_preferences'),
      browserInvoke('get_app_info'),
    ]);

    for (const payload of payloads) {
      expect(JSON.stringify(payload)).not.toContain(secret);
    }
  });
});
