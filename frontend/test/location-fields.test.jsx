// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import LocationFields from '../src/components/LocationFields';
import { loadPlaces } from '../src/services/locationService';

vi.mock('../src/context/AuthContext', () => ({ useAuth: () => ({ language: 'en' }) }));
vi.mock('../src/services/locationService', async (original) => ({ ...await original(), loadPlaces: vi.fn() }));

function Form({ initial = { state: '', district: '', village: '' }, language = 'en' }) {
  const [values, setValues] = useState(initial);
  return <LocationFields values={values} initialValues={initial} errors={{}} language={language}
    onChange={(changes) => setValues((previous) => ({ ...previous, ...changes }))} />;
}
beforeEach(() => loadPlaces.mockReset().mockResolvedValue(['Lasalgaon', 'Nashik']));
afterEach(cleanup);

it('enables child fields in order and clears both children when the state changes', async () => {
  render(<Form />);
  expect(screen.getByLabelText('District').disabled).toBe(true);
  expect(screen.getByLabelText(/Village \/ Town/).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('State'), { target: { value: 'Maharashtra' } });
  expect(screen.getByLabelText('District').disabled).toBe(false);
  expect(screen.getByRole('option', { name: 'Nashik' })).toBeTruthy();
  expect(screen.queryByRole('option', { name: 'North Goa' })).toBeNull();
  fireEvent.change(screen.getByLabelText('District'), { target: { value: 'Nashik' } });
  await waitFor(() => expect(screen.getByLabelText(/Village \/ Town/).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText(/Village \/ Town/), { target: { value: 'Lasalgaon' } });
  fireEvent.change(screen.getByLabelText('State'), { target: { value: 'Goa' } });
  expect(screen.getByLabelText('District').value).toBe('');
  expect(screen.getByLabelText(/Village \/ Town/).value).toBe('');
  expect(screen.queryByRole('option', { name: 'Nashik' })).toBeNull();
  expect(screen.getByRole('option', { name: 'North Goa' })).toBeTruthy();
});

it('clears the village when switching districts and ignores a late response from the old district', async () => {
  let resolveOld;
  loadPlaces.mockImplementation((_state, district) => district === 'Nashik'
    ? new Promise((resolve) => { resolveOld = resolve; }) : Promise.resolve(['Pune', 'Baramati']));
  render(<Form initial={{ state: 'Maharashtra', district: 'Nashik', village: 'Lasalgaon' }} />);
  fireEvent.change(screen.getByLabelText('District'), { target: { value: 'Pune' } });
  expect(screen.getByLabelText(/Village \/ Town/).value).toBe('');
  await waitFor(() => expect(document.querySelector('#location-places').textContent || document.querySelector('#location-places option')?.value).toBeTruthy());
  await act(async () => resolveOld(['Lasalgaon']));
  expect([...document.querySelectorAll('#location-places option')].map((option) => option.value)).toEqual(['Pune', 'Baramati']);
});

it('shows a retry action when loading fails and loads the selected district on retry', async () => {
  loadPlaces.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(['Lasalgaon']);
  render(<Form initial={{ state: 'Maharashtra', district: 'Nashik', village: '' }} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(document.querySelector('#location-places option')?.value).toBe('Lasalgaon'));
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
});

it('shows a loading placeholder and disables village input while places are loading slowly', async () => {
  let finishLoading;
  const pending = new Promise((resolve) => { finishLoading = resolve; });
  loadPlaces.mockReturnValueOnce(pending);
  render(<Form initial={{ state: 'Maharashtra', district: 'Nashik', village: '' }} />);

  const villageInput = screen.getByLabelText(/Village \/ Town/);
  expect(villageInput.disabled).toBe(true);
  expect(villageInput.placeholder).toBe('Loading villages and towns…');
  expect(screen.getByText('Loading villages and towns…')).toBeTruthy();

  finishLoading(['Lasalgaon', 'Yeola']);
  await waitFor(() => expect(screen.getByLabelText(/Village \/ Town/).disabled).toBe(false));
  expect(screen.getByLabelText(/Village \/ Town/).placeholder).toBe('Search village or town');
  expect(screen.getByText(/Type to find a village or town/)).toBeTruthy();
});

it('disables district and village when the state is reset to empty', async () => {
  render(<Form initial={{ state: 'Maharashtra', district: 'Nashik', village: 'Lasalgaon' }} />);
  await waitFor(() => expect(screen.getByLabelText(/Village \/ Town/).disabled).toBe(false));

  fireEvent.change(screen.getByLabelText('State'), { target: { value: '' } });
  expect(screen.getByLabelText('State').value).toBe('');
  expect(screen.getByLabelText('District').value).toBe('');
  expect(screen.getByLabelText('District').disabled).toBe(true);
  expect(screen.getByLabelText(/Village \/ Town/).value).toBe('');
  expect(screen.getByLabelText(/Village \/ Town/).disabled).toBe(true);
});

it('allows editing previously saved addresses while keeping initial values visible', async () => {
  render(<Form initial={{ state: 'Maharashtra', district: 'Nashik', village: 'Lasalgaon' }} />);
  expect(screen.getByLabelText('State').value).toBe('Maharashtra');
  expect(screen.getByLabelText('District').value).toBe('Nashik');
  expect(screen.getByLabelText(/Village \/ Town/).value).toBe('Lasalgaon');

  await waitFor(() => expect(screen.getByLabelText(/Village \/ Town/).disabled).toBe(false));
  fireEvent.change(screen.getByLabelText(/Village \/ Town/), { target: { value: 'Pimpalgaon' } });
  expect(screen.getByLabelText(/Village \/ Town/).value).toBe('Pimpalgaon');
});

it('renders field labels and placeholders correctly in Hindi and Marathi', () => {
  const { rerender } = render(<Form language="hi" />);
  expect(screen.getByLabelText('राज्य')).toBeTruthy();
  expect(screen.getByLabelText('जिला')).toBeTruthy();
  expect(screen.getByLabelText(/गाँव \/ नगर/)).toBeTruthy();

  rerender(<Form language="mr" />);
  expect(screen.getByLabelText('राज्य')).toBeTruthy();
  expect(screen.getByLabelText('जिल्हा')).toBeTruthy();
  expect(screen.getByLabelText(/गाव \/ शहर/)).toBeTruthy();
});


it('preserves a saved legacy district and village until the farmer changes the address', () => {
  render(<Form initial={{ state: 'Maharashtra', district: 'Aurangabad', village: 'जुने गाव' }} />);
  expect(screen.getByLabelText('District').value).toBe('Aurangabad');
  expect(screen.getByLabelText(/Village \/ Town/).value).toBe('जुने गाव');
  expect(loadPlaces).not.toHaveBeenCalled();
});
