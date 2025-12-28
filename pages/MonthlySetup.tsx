import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../App';
import { storage } from '../lib/storage';
import { generateMonthTransactions, GenerateMode, getScheduleDates } from '../lib/generate';
import { calculateForecast } from '../lib/forecasting';
import { roundToCents } from '../lib/number';
import { formatMonthLabel } from '../lib/format';
import { MonthSetup, OneOffAdjustment, PaycheckDepositSplit, PaycheckEntry, RecurringItemType } from '../types';
import { Button } from '../components/Button';
import { calculatePayrollForMonth } from '../src/lib/payroll/engine';
import { getTaxTableSet } from '../src/lib/payroll/taxTables';
import { TaxTableSet } from '../src/lib/payroll/types';

const MonthlySetupPage: React.FC = () => {
  const { currentSnapshot, setSnapshot, settings, refreshSnapshot } = useApp();
  const navigate = useNavigate();
  const [generateMode, setGenerateMode] = useState<GenerateMode>('regenerate');

  if (!currentSnapshot || !currentSnapshot.month_setup) return null;

  const monthSetup = currentSnapshot.month_setup;
  const monthId = currentSnapshot.id;

  const sortedAccounts = [...settings.accounts].sort((a, b) => a.name.localeCompare(b.name));
  const sortedCategories = [...settings.categories].sort((a, b) => a.name.localeCompare(b.name));
  const sortedLoans = [...settings.loans].sort((a, b) => a.name.localeCompare(b.name));
  const cashAccounts = sortedAccounts.filter(acc => acc.type !== 'loan');
  const incomeCategories = sortedCategories.filter(cat => cat.type === 'income');
  const expenseCategories = sortedCategories.filter(cat => cat.type === 'expense');
  const [balanceInputs, setBalanceInputs] = useState<Record<string, string>>({});
  const [paycheckInputs, setPaycheckInputs] = useState<Record<string, string>>({});
  const [paycheckDefaultInput, setPaycheckDefaultInput] = useState<string>('');
  const [paycheckSplitInputs, setPaycheckSplitInputs] = useState<Record<string, string>>({});
  const [taxTableSet, setTaxTableSet] = useState<TaxTableSet | null>(null);
  const [taxTableNotice, setTaxTableNotice] = useState<string>('');

  const scheduleDates = useMemo(() => {
    return getScheduleDates(monthId, monthSetup.paycheck_schedule, monthSetup.paycheck_anchor_date);
  }, [monthId, monthSetup.paycheck_schedule, monthSetup.paycheck_anchor_date]);

  useEffect(() => {
    let isActive = true;
    const loadTables = async () => {
      const table = await getTaxTableSet(settings.payroll_settings.tax_year);
      if (!isActive) return;
      setTaxTableSet(table);
      setTaxTableNotice(table ? '' : `No tax tables found for ${settings.payroll_settings.tax_year}. Import a tax table to enable payroll estimates.`);
    };
    loadTables();
    return () => { isActive = false; };
  }, [settings.payroll_settings.tax_year]);

  useEffect(() => {
    const next: Record<string, string> = {};
    currentSnapshot.starting_balances.forEach(b => {
      next[b.account_id] = String(b.amount);
    });
    setBalanceInputs(next);
  }, [currentSnapshot.id, currentSnapshot.starting_balances]);

  const payrollEstimates = useMemo(() => {
    if (!taxTableSet) return null;
    if (!settings.payroll_settings.salary_annual) return [];
    const result = calculatePayrollForMonth({
      monthId,
      schedule: monthSetup.paycheck_schedule,
      anchorDate: monthSetup.paycheck_anchor_date,
      payrollSettings: settings.payroll_settings,
      taxTables: taxTableSet,
    });
    return result.paychecks.map(paycheck => ({
      id: `estimate:${paycheck.id}`,
      date: paycheck.date,
      amount: roundToCents(paycheck.net),
      is_bonus: paycheck.is_bonus,
      description: paycheck.description || (paycheck.is_bonus ? 'Bonus' : 'Paycheck')
    }));
  }, [monthId, monthSetup.paycheck_schedule, monthSetup.paycheck_anchor_date, settings.payroll_settings, taxTableSet]);

  const buildEntryKey = (entry: { date: string; is_bonus?: boolean }) => `${entry.date}:${entry.is_bonus ? 'bonus' : 'regular'}`;

  useEffect(() => {
    if (!payrollEstimates || payrollEstimates.length === 0) return;
    const existing = monthSetup.paycheck_estimates || [];
    const normalize = (entries: PaycheckEntry[]) => entries
      .map(entry => ({ date: entry.date, amount: entry.amount, is_bonus: entry.is_bonus, description: entry.description }))
      .sort((a, b) => buildEntryKey(a).localeCompare(buildEntryKey(b)));
    const next = normalize(payrollEstimates);
    const current = normalize(existing);
    const isSame = next.length === current.length
      && next.every((entry, index) => entry.date === current[index].date
        && entry.amount === current[index].amount
        && entry.is_bonus === current[index].is_bonus
        && entry.description === current[index].description);
    if (!isSame) {
      updateMonthSetup({ paycheck_estimates: payrollEstimates });
    }
  }, [payrollEstimates, monthSetup.paycheck_estimates]);

  useEffect(() => {
    const regularEstimate = payrollEstimates?.find(entry => !entry.is_bonus);
    if (!regularEstimate) return;
    if (monthSetup.paycheck_default_amount !== 0) return;
    updateMonthSetup({ paycheck_default_amount: regularEstimate.amount });
  }, [payrollEstimates, monthSetup.paycheck_default_amount]);

  const estimateByKey = useMemo(() => {
    const entries = monthSetup.paycheck_estimates && monthSetup.paycheck_estimates.length > 0
      ? monthSetup.paycheck_estimates
      : (payrollEstimates || []);
    return new Map(entries.map(entry => [buildEntryKey(entry), entry]));
  }, [monthSetup.paycheck_estimates, payrollEstimates]);

  const overridesByKey = useMemo(() => {
    return new Map(monthSetup.paycheck_overrides.map(entry => [buildEntryKey(entry), entry]));
  }, [monthSetup.paycheck_overrides]);

  const paycheckEntries = useMemo(() => {
    const regularEntries = scheduleDates.map((date) => {
      const key = buildEntryKey({ date, is_bonus: false });
      const override = overridesByKey.get(key);
      const estimate = estimateByKey.get(key);
      return {
        id: override?.id || estimate?.id || crypto.randomUUID(),
        date,
        amount: override?.amount ?? estimate?.amount ?? monthSetup.paycheck_default_amount,
        is_bonus: false,
        description: estimate?.description || 'Paycheck'
      };
    });
    const bonusEntries = Array.from(estimateByKey.values())
      .filter(entry => entry.is_bonus)
      .map(entry => {
        const key = buildEntryKey(entry);
        const override = overridesByKey.get(key);
        return {
          ...entry,
          id: override?.id || entry.id,
          amount: override?.amount ?? entry.amount
        };
      });
    return [...regularEntries, ...bonusEntries].sort((a, b) => a.date.localeCompare(b.date));
  }, [scheduleDates, estimateByKey, overridesByKey, monthSetup.paycheck_default_amount]);

  useEffect(() => {
    const next: Record<string, string> = {};
    paycheckEntries.forEach(entry => {
      next[entry.id] = String(entry.amount);
    });
    setPaycheckInputs(next);
  }, [paycheckEntries]);

  useEffect(() => {
    setPaycheckDefaultInput(String(monthSetup.paycheck_default_amount));
  }, [monthSetup.paycheck_default_amount]);

  useEffect(() => {
    const next: Record<string, string> = {};
    monthSetup.paycheck_deposit_splits.forEach(split => {
      next[split.id] = String(split.amount);
    });
    setPaycheckSplitInputs(next);
  }, [monthSetup.paycheck_deposit_splits]);

  useEffect(() => {
    if (!monthSetup.paycheck_category_id && settings.payroll_settings.paycheck_category_id) {
      updateMonthSetup({ paycheck_category_id: settings.payroll_settings.paycheck_category_id });
    }
  }, [monthSetup.paycheck_category_id, settings.payroll_settings.paycheck_category_id]);

  const updateMonthSetup = (patch: Partial<typeof monthSetup>) => {
    setSnapshot({
      ...currentSnapshot,
      month_setup: {
        ...monthSetup,
        ...patch
      }
    });
  };

  const handleAmountKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.currentTarget.blur();
    }
  };

  const updateStartingBalance = (accountId: string, raw: string) => {
    setBalanceInputs(prev => ({ ...prev, [accountId]: raw }));
  };

  const commitStartingBalance = (accountId: string) => {
    const raw = balanceInputs[accountId];
    if (raw === undefined) return;
    const parsed = Number(raw);
    if (Number.isNaN(parsed)) {
      const existing = currentSnapshot.starting_balances.find(b => b.account_id === accountId)?.amount || 0;
      setBalanceInputs(prev => ({ ...prev, [accountId]: String(existing) }));
      return;
    }
    const rounded = roundToCents(parsed);
    const updatedBalances = currentSnapshot.starting_balances.map(b =>
      b.account_id === accountId ? { ...b, amount: rounded } : b
    );
    const updatedSnapshot = { ...currentSnapshot, starting_balances: updatedBalances, updated_at: Date.now() };
    setSnapshot(updatedSnapshot);
    storage.upsertMonth(updatedSnapshot);
  };

  const updatePaycheckEntries = (entries: PaycheckEntry[]) => {
    updateMonthSetup({ paycheck_overrides: entries });
  };

  const handleScheduleChange = (schedule: typeof monthSetup.paycheck_schedule) => {
    updateMonthSetup({ paycheck_schedule: schedule, paycheck_overrides: [] });
  };

  const handleAnchorChange = (anchorDate: string) => {
    updateMonthSetup({ paycheck_anchor_date: anchorDate, paycheck_overrides: [] });
  };

  const handleDefaultPaycheckAmount = (value: number) => {
    updateMonthSetup({ paycheck_default_amount: value });
  };

  const commitDefaultPaycheckAmount = () => {
    const parsed = Number(paycheckDefaultInput);
    if (Number.isNaN(parsed)) {
      setPaycheckDefaultInput(String(monthSetup.paycheck_default_amount));
      return;
    }
    handleDefaultPaycheckAmount(roundToCents(parsed));
  };

  const setPaycheckAmount = (id: string, value: string) => {
    setPaycheckInputs(prev => ({ ...prev, [id]: value }));
  };

  const commitPaycheckAmount = (id: string) => {
    const raw = paycheckInputs[id];
    if (raw === undefined) return;
    const parsed = Number(raw);
    if (Number.isNaN(parsed)) {
      const existing = paycheckEntries.find(entry => entry.id === id)?.amount ?? monthSetup.paycheck_default_amount;
      setPaycheckInputs(prev => ({ ...prev, [id]: String(existing) }));
      return;
    }
    const target = paycheckEntries.find(entry => entry.id === id);
    if (!target) return;
    const nextAmount = roundToCents(parsed);
    const key = buildEntryKey(target);
    const estimate = estimateByKey.get(key);
    const nextOverrides = monthSetup.paycheck_overrides.filter(entry => buildEntryKey(entry) !== key);
    if (!estimate || estimate.amount !== nextAmount) {
      nextOverrides.push({ ...target, amount: nextAmount });
    }
    updateMonthSetup({ paycheck_overrides: nextOverrides });
  };

  const setPaycheckDate = (id: string, value: string) => {
    const entries = paycheckEntries.map(entry => entry.id === id ? { ...entry, date: value } : entry);
    updatePaycheckEntries(entries);
  };

  const updatePaycheckSplits = (splits: PaycheckDepositSplit[]) => {
    updateMonthSetup({ paycheck_deposit_splits: splits });
  };

  const updatePaycheckSplit = (id: string, patch: Partial<PaycheckDepositSplit>) => {
    updatePaycheckSplits(monthSetup.paycheck_deposit_splits.map(split => split.id === id ? { ...split, ...patch } : split));
  };

  const setSplitType = (id: string, type: 'fixed' | 'remainder') => {
    const next = monthSetup.paycheck_deposit_splits.map(split => {
      if (split.id !== id) {
        return type === 'remainder' ? { ...split, is_remainder: false } : split;
      }
      if (type === 'remainder') {
        return { ...split, is_remainder: true, amount: 0 };
      }
      return { ...split, is_remainder: false };
    });
    updatePaycheckSplits(next);
  };

  const handleAddSplit = () => {
    const existingAccountIds = new Set(monthSetup.paycheck_deposit_splits.map(split => split.account_id));
    const available = cashAccounts.find(acc => !existingAccountIds.has(acc.id)) || cashAccounts[0];
    if (!available) return;
    const next = [
      ...monthSetup.paycheck_deposit_splits,
      {
        id: crypto.randomUUID(),
        account_id: available.id,
        amount: 0,
        is_remainder: false
      }
    ];
    updatePaycheckSplits(next);
  };

  const handleRemoveSplit = (id: string) => {
    updatePaycheckSplits(monthSetup.paycheck_deposit_splits.filter(split => split.id !== id));
  };

  const setSplitAmountInput = (id: string, value: string) => {
    setPaycheckSplitInputs(prev => ({ ...prev, [id]: value }));
  };

  const commitSplitAmount = (id: string) => {
    const raw = paycheckSplitInputs[id];
    if (raw === undefined) return;
    if (monthSetup.paycheck_deposit_splits.find(split => split.id === id)?.is_remainder) {
      setPaycheckSplitInputs(prev => ({ ...prev, [id]: '0' }));
      return;
    }
    const parsed = Number(raw);
    if (Number.isNaN(parsed)) {
      const existing = monthSetup.paycheck_deposit_splits.find(split => split.id === id)?.amount ?? 0;
      setPaycheckSplitInputs(prev => ({ ...prev, [id]: String(existing) }));
      return;
    }
    updatePaycheckSplit(id, { amount: roundToCents(parsed) });
  };

  const fixedSplitTotal = useMemo(() => {
    return monthSetup.paycheck_deposit_splits.reduce((sum, split) => {
      if (split.is_remainder) return sum;
      return sum + (Number(split.amount) || 0);
    }, 0);
  }, [monthSetup.paycheck_deposit_splits]);

  const hasRemainderSplit = useMemo(() => {
    return monthSetup.paycheck_deposit_splits.some(split => split.is_remainder);
  }, [monthSetup.paycheck_deposit_splits]);

  const handleVariableOverride = (itemId: string, value: string) => {
    const amount = value.trim() === '' ? null : Number(value);
    const filtered = monthSetup.variable_overrides.filter(o => o.item_id !== itemId);
    if (amount === null || Number.isNaN(amount)) {
      updateMonthSetup({ variable_overrides: filtered });
      return;
    }
    updateMonthSetup({ variable_overrides: [...filtered, { item_id: itemId, amount }] });
  };

  const handleAddOneOff = () => {
      const base: OneOffAdjustment = {
        id: crypto.randomUUID(),
        date: `${monthId}-01`,
        description: '',
        amount: 0,
        account_id: cashAccounts[0]?.id || '',
        transfer_account_id: '',
        category_id: expenseCategories[0]?.id || '',
        loan_id: undefined,
      type: 'expense'
    };
    updateMonthSetup({ one_offs: [...monthSetup.one_offs, base] });
  };

  const getPreviousMonthId = (monthId: string) => {
    const [yearRaw, monthRaw] = monthId.split('-').map(Number);
    let year = yearRaw;
    let month = monthRaw - 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
    return `${year}-${month.toString().padStart(2, '0')}`;
  };

  const pullStartingBalancesFromPreviousMonth = async () => {
    if (!currentSnapshot) return;
    const previousMonthId = getPreviousMonthId(currentSnapshot.id);
    let previousSnapshot = await storage.getMonth(previousMonthId);
    if (!previousSnapshot) {
      const months = await storage.listMonths();
      const fallbackId = months
        .filter(id => id < currentSnapshot.id)
        .sort()
        .at(-1);
      if (fallbackId) {
        previousSnapshot = await storage.getMonth(fallbackId);
      }
    }
    if (!previousSnapshot) {
      alert('No previous month found to pull balances from.');
      return;
    }
    const previousForecast = calculateForecast(previousSnapshot);
    const lastPoint = previousForecast[previousForecast.length - 1];
    if (!lastPoint) {
      alert('Previous month has no forecast data to pull balances from.');
      return;
    }
    const nextBalances = currentSnapshot.accounts.map(acc => ({
      account_id: acc.id,
      amount: roundToCents(lastPoint.balances[acc.id] ?? 0)
    }));
    const updatedSnapshot = { ...currentSnapshot, starting_balances: nextBalances, updated_at: Date.now() };
    setSnapshot(updatedSnapshot);
    await storage.upsertMonth(updatedSnapshot);
  };

  const handleDeleteMonthSnapshot = async () => {
    if (!currentSnapshot) return;
    const confirmed = confirm('This will delete the entire month snapshot. Continue?');
    if (!confirmed) return;
    await storage.deleteMonth(currentSnapshot.id);
    refreshSnapshot();
  };

  const updateOneOff = (id: string, patch: Partial<OneOffAdjustment>) => {
    updateMonthSetup({
      one_offs: monthSetup.one_offs.map(o => o.id === id ? { ...o, ...patch } : o)
    });
  };

  const deleteOneOff = (id: string) => {
    updateMonthSetup({ one_offs: monthSetup.one_offs.filter(o => o.id !== id) });
  };

  const handleGenerate = async () => {
    if (generateMode === 'reset') {
      const confirmed = confirm('This will delete ALL transactions for the month. Continue?');
      if (!confirmed) return;
    }
    const result = generateMonthTransactions(
      monthId,
      monthSetup,
      settings.recurring_items,
      currentSnapshot.transactions,
      generateMode
    );

    const updatedSnapshot = {
      ...currentSnapshot,
      transactions: result.transactions,
      month_setup: result.month_setup,
      updated_at: Date.now(),
      schema_version: 6
    };

    setSnapshot(updatedSnapshot);
    await storage.upsertMonth(updatedSnapshot);
    navigate('/month');
  };

  const formatTypeLabel = (type: RecurringItemType) => {
    if (type === 'income') return 'Income';
    if (type === 'transfer') return 'Transfer';
    return 'Expense';
  };

  return (
    <div className="space-y-8 pb-20">
      <div>
        <h2 className="text-3xl font-extrabold text-slate-900">Monthly Setup</h2>
        <p className="text-slate-500">Configure paychecks and recurring items for {formatMonthLabel(monthId)}</p>
      </div>

      <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border-b pb-2">
          <h3 className="text-lg font-bold text-slate-800">Opening Balances</h3>
          <div className="flex flex-wrap gap-2">
            <Button onClick={pullStartingBalancesFromPreviousMonth} size="sm" type="button">
              Use Previous Month Ending Balances
            </Button>
            <Button onClick={handleDeleteMonthSnapshot} variant="danger" size="sm" type="button">
              Delete This Month Snapshot
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {sortedAccounts.map(acc => {
            const balance = currentSnapshot.starting_balances.find(b => b.account_id === acc.id)?.amount || 0;
            return (
              <div key={acc.id} className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">{acc.name}</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                  <input
                    type="number"
                    value={balanceInputs[acc.id] ?? String(balance)}
                    onChange={(e) => updateStartingBalance(acc.id, e.target.value)}
                    onBlur={() => commitStartingBalance(acc.id)}
                    onKeyDown={handleAmountKeyDown}
                    className="w-full pl-7 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-6">
        <h3 className="text-lg font-bold text-slate-800 border-b pb-2">Paychecks</h3>
        {taxTableNotice && (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
            {taxTableNotice} <Link to="/tax-tables" className="underline">Manage tax tables</Link>.
          </div>
        )}
        {!taxTableNotice && (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
            Estimates only; verify with your paystub or tax professional. No legal or tax advice.
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">Schedule</label>
            <select
              value={monthSetup.paycheck_schedule}
              onChange={(e) => handleScheduleChange(e.target.value as MonthSetup['paycheck_schedule'])}
              className="w-full px-3 py-2 border rounded-lg"
            >
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly</option>
              <option value="semimonthly">Semi-monthly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">Anchor Date</label>
            <input
              type="date"
              value={monthSetup.paycheck_anchor_date}
              onChange={(e) => handleAnchorChange(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">Income Category</label>
            <select
              value={monthSetup.paycheck_category_id}
              onChange={(e) => updateMonthSetup({ paycheck_category_id: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg"
            >
              {incomeCategories.map(cat => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">Default Amount</label>
            <input
              type="number"
              value={paycheckDefaultInput}
              onChange={(e) => setPaycheckDefaultInput(e.target.value)}
              onBlur={commitDefaultPaycheckAmount}
              onKeyDown={handleAmountKeyDown}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-500 uppercase">Deposit Splits</label>
              <Button onClick={handleAddSplit} variant="secondary" size="sm" type="button">
                Add Account
              </Button>
            </div>
            <div className="space-y-2">
              {monthSetup.paycheck_deposit_splits.map(split => (
                <div key={split.id} className="grid grid-cols-1 md:grid-cols-8 gap-2 items-center">
                  <select
                    value={split.is_remainder ? 'remainder' : 'fixed'}
                    onChange={(e) => setSplitType(split.id, e.target.value as 'fixed' | 'remainder')}
                    className="w-full px-3 py-2 border rounded-lg md:col-span-2"
                  >
                    <option value="fixed">Fixed</option>
                    <option value="remainder">Remainder</option>
                  </select>
                  <select
                    value={split.account_id}
                    onChange={(e) => updatePaycheckSplit(split.id, { account_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg md:col-span-3"
                  >
                    {cashAccounts.map(acc => (
                      <option key={acc.id} value={acc.id}>{acc.name}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    value={split.is_remainder ? '0' : (paycheckSplitInputs[split.id] ?? String(split.amount))}
                    onChange={(e) => setSplitAmountInput(split.id, e.target.value)}
                    onBlur={() => commitSplitAmount(split.id)}
                    onKeyDown={handleAmountKeyDown}
                    disabled={split.is_remainder}
                    className={`w-full px-3 py-2 border rounded-lg md:col-span-2 ${split.is_remainder ? 'bg-slate-100 text-slate-400' : ''}`}
                  />
                  <Button
                    onClick={() => handleRemoveSplit(split.id)}
                    variant="danger"
                    size="sm"
                    className="md:col-span-1"
                    type="button"
                  >
                    Remove
                  </Button>
                </div>
              ))}
              {monthSetup.paycheck_deposit_splits.length === 0 && (
                <p className="text-sm text-slate-400 italic">Add at least one account to receive paychecks.</p>
              )}
            </div>
            <p className={`text-xs ${!hasRemainderSplit ? 'text-amber-600' : 'text-slate-500'}`}>
              Fixed total: {fixedSplitTotal.toFixed(2)} {hasRemainderSplit ? '(remainder gets the rest)' : '(no remainder account)'}
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2 font-bold">Type</th>
                <th className="px-4 py-2 font-bold">Paycheck Date</th>
                <th className="px-4 py-2 font-bold">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {paycheckEntries.map(entry => (
                <tr key={entry.id} className="hover:bg-slate-50 transition">
                  <td className="px-4 py-2 text-sm font-semibold text-slate-700">
                    {entry.is_bonus ? 'Bonus' : 'Paycheck'}
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="date"
                      value={entry.date}
                      onChange={(e) => setPaycheckDate(entry.id, e.target.value)}
                      disabled={entry.is_bonus}
                      className="w-full px-3 py-2 border rounded-lg"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      value={paycheckInputs[entry.id] ?? String(entry.amount)}
                      onChange={(e) => setPaycheckAmount(entry.id, e.target.value)}
                      onBlur={() => commitPaycheckAmount(entry.id)}
                      onKeyDown={handleAmountKeyDown}
                      className="w-full px-3 py-2 border rounded-lg"
                    />
                  </td>
                </tr>
              ))}
              {paycheckEntries.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-slate-400 italic">
                    No paychecks for this schedule.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-6">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-bold text-slate-800">Recurring Items (This Month)</h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2 font-bold">Item</th>
                <th className="px-4 py-2 font-bold">Cadence</th>
                <th className="px-4 py-2 font-bold">Default</th>
                <th className="px-4 py-2 font-bold">This Month</th>
                <th className="px-4 py-2 font-bold">Type</th>
                <th className="px-4 py-2 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
          {settings.recurring_items.map(item => {
                const override = monthSetup.variable_overrides.find(o => o.item_id === item.id);
                return (
                  <tr key={item.id} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-2">
                      <div className="font-semibold text-slate-800">{item.name}</div>
                      <div className="text-xs text-slate-400">{item.day_rule}</div>
                    </td>
                    <td className="px-4 py-2 capitalize">{item.cadence}</td>
                    <td className="px-4 py-2">{item.default_amount.toFixed(2)}</td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        value={override?.amount ?? ''}
                        onChange={(e) => handleVariableOverride(item.id, e.target.value)}
                        placeholder={item.default_amount.toFixed(2)}
                        className="w-full px-3 py-2 border rounded-lg"
                      />
                    </td>
                    <td className="px-4 py-2">{formatTypeLabel(item.type)}</td>
                    <td className="px-4 py-2 text-right text-xs text-slate-400">
                      {item.loan_id ? `Loan: ${sortedLoans.find(l => l.id === item.loan_id)?.name || 'Unknown'}` : 'Managed in Settings'}
                    </td>
                  </tr>
                );
              })}
              {settings.recurring_items.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-400 italic">
                    No recurring items yet. Add them in Settings.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-6">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-bold text-slate-800">One-off Adjustments</h3>
          <Button onClick={handleAddOneOff} variant="secondary">
            Add Adjustment
          </Button>
        </div>
        <div className="space-y-4">
          {monthSetup.one_offs.map(oneOff => (
            <div key={oneOff.id} className="grid grid-cols-1 md:grid-cols-8 gap-3 items-center">
              <input
                type="date"
                value={oneOff.date}
                onChange={(e) => updateOneOff(oneOff.id, { date: e.target.value })}
                className="px-3 py-2 border rounded-lg"
              />
              <input
                type="text"
                value={oneOff.description}
                onChange={(e) => updateOneOff(oneOff.id, { description: e.target.value })}
                placeholder="Description"
                className="px-3 py-2 border rounded-lg md:col-span-2"
              />
              <input
                type="number"
                value={oneOff.amount}
                onChange={(e) => updateOneOff(oneOff.id, { amount: roundToCents(Number(e.target.value)) })}
                onKeyDown={handleAmountKeyDown}
                className="px-3 py-2 border rounded-lg"
              />
              <select
                value={oneOff.account_id}
                onChange={(e) => updateOneOff(oneOff.id, { account_id: e.target.value })}
                className="px-3 py-2 border rounded-lg"
              >
                {cashAccounts.map(acc => (
                  <option key={acc.id} value={acc.id}>{acc.name}</option>
                ))}
              </select>
              <select
                value={oneOff.category_id}
                onChange={(e) => updateOneOff(oneOff.id, { category_id: e.target.value })}
                className="px-3 py-2 border rounded-lg"
              >
                {[...incomeCategories, ...expenseCategories].map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
              <select
                value={oneOff.loan_id || ''}
                onChange={(e) => updateOneOff(oneOff.id, { loan_id: e.target.value || undefined })}
                className="px-3 py-2 border rounded-lg"
              >
                <option value="">No Loan</option>
                {sortedLoans.map(loan => (
                  <option key={loan.id} value={loan.id}>{loan.name}</option>
                ))}
              </select>
              {oneOff.type === 'transfer' && (
                <select
                  value={oneOff.transfer_account_id || ''}
                  onChange={(e) => updateOneOff(oneOff.id, { transfer_account_id: e.target.value || undefined })}
                  className="px-3 py-2 border rounded-lg"
                >
                  <option value="">Transfer To</option>
                  {sortedAccounts.map(acc => (
                    <option key={acc.id} value={acc.id}>{acc.name}</option>
                  ))}
                </select>
              )}
              <select
                value={oneOff.type}
                onChange={(e) => updateOneOff(oneOff.id, { type: e.target.value as RecurringItemType })}
                className="px-3 py-2 border rounded-lg"
              >
                <option value="income">Income</option>
                <option value="expense">Expense</option>
                <option value="transfer">Transfer</option>
              </select>
              <Button onClick={() => deleteOneOff(oneOff.id)} variant="danger" size="sm">
                Remove
              </Button>
            </div>
          ))}
          {monthSetup.one_offs.length === 0 && (
            <p className="text-sm text-slate-400 italic">No adjustments added.</p>
          )}
        </div>
      </section>

      <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-4">
        <h3 className="text-lg font-bold text-slate-800">Generate Forecast</h3>
        <div className="flex flex-col md:flex-row gap-4 items-center">
          <select
            value={generateMode}
            onChange={(e) => setGenerateMode(e.target.value as GenerateMode)}
            className="px-3 py-2 border rounded-lg"
          >
            <option value="missing">Generate missing</option>
            <option value="regenerate">Regenerate generated</option>
            <option value="reset">Full reset month</option>
          </select>
          <Button onClick={handleGenerate} variant="success">
            Generate Forecast
          </Button>
        </div>
        <p className="text-xs text-slate-500">
          Default is to regenerate generated transactions only, leaving manual entries untouched.
        </p>
      </section>

    </div>
  );
};

export default MonthlySetupPage;
