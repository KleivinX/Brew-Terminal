import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Modal } from '@/components/ui/Modal';
import { findAccessibilityViolations, describeViolations } from '../setup/axe';

/**
 * Mirrors real usage: the caller passes an inline arrow as `onClose`, so its identity changes
 * on every render. That is the shape that exposed the focus-thrashing bug.
 */
function Harness() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');

  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        Open dialog
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Test dialog" size="sm">
        <form>
          <label htmlFor="field">Name</label>
          <input id="field" value={value} onChange={(e) => setValue(e.target.value)} />
          <button type="button">Save</button>
        </form>
      </Modal>
      <p data-testid="value">{value}</p>
    </div>
  );
}

describe('Modal', () => {
  it('opens and focuses the first focusable element', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Open dialog' }));

    const field = await screen.findByLabelText('Name');
    await waitFor(() => expect(field).toHaveFocus());
  });

  it('keeps focus in the field while typing, including spaces', async () => {
    /*
     * Regression: `onClose` is an inline arrow, so its identity changed every render. The
     * focus effect depended on it, so each keystroke tore the effect down — restoring focus
     * to the trigger button — and re-ran it. Typing a space then activated that button and
     * closed the dialog, losing the user's input.
     */
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Open dialog' }));
    const field = await screen.findByLabelText('Name');

    await user.type(field, 'Crypto majors');

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(field).toHaveFocus();
    expect(screen.getByTestId('value')).toHaveTextContent('Crypto majors');
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Open dialog' }));
    await screen.findByRole('dialog');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('restores focus to the trigger when it closes', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const trigger = screen.getByRole('button', { name: 'Open dialog' });
    await user.click(trigger);
    await screen.findByRole('dialog');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('traps Tab inside the dialog', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Open dialog' }));
    await screen.findByRole('dialog');

    // Cycling past the last control must land back inside, never on the page behind.
    for (let i = 0; i < 6; i += 1) {
      await user.tab();
      expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
    }
  });

  it('renders nothing while closed', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('calls onClose when the backdrop is clicked', async () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="Backdrop test" size="sm">
        <p>Body</p>
      </Modal>,
    );

    await userEvent.setup().click(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalled();
  });

  it('has no accessibility violations', async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open dialog' }));
    await screen.findByRole('dialog');

    const violations = await findAccessibilityViolations(container.ownerDocument.body);
    expect(violations, describeViolations(violations)).toHaveLength(0);
  });
});
