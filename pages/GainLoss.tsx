import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../App';
import { storage } from '../lib/storage';
import { GainLossHistoryEntry, MonthSnapshot, StartingBalance } from '../types';
import { formatMonthLabel } from '../lib/format';
import { Button } from '../components/Button';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const formatMonthId = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  return `${year}-${month}`;
};

const addMonths = (monthId: string, delta: number) => {
  const [year, month] = monthId.split('-').map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return formatMonthId(date);
};

const buildMonthRange = (startId: string, endId: string) => {
  if (!startId || !endId) return [];
  const [startYear, startMonth] = startId.split('-').map(Number);
  const [endYear, endMonth] = endId.split('-').map(Number);
  const start = new Date(startYear, startMonth - 1, 1);
  const end = new Date(endYear, endMonth - 1, 1);
  if (start > end) return [];
  const months: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    months.push(formatMonthId(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
};

const getPreviousMonthId = (monthId: string) => {
  const [year, month] = monthId.split('-').map(Number);
  const date = new Date(year, month - 1, 1);
  date.setMonth(date.getMonth() - 1);
  return formatMonthId(date);
};

const GainLossPage: React.FC = () => {
  const { currentSnapshot, settings, updateSettings } = useApp();
  const [previousSnapshot, setPreviousSnapshot] = useState<MonthSnapshot | null>(null);
  const [ytdBaselineSnapshot, setYtdBaselineSnapshot] = useState<MonthSnapshot | null>(null);
  const [yearSnapshots, setYearSnapshots] = useState<Record<string, MonthSnapshot | null>>({});
  const [momDetailMonthId, setMomDetailMonthId] = useState<string>('');
  const [historyMonthId, setHistoryMonthId] = useState<string>('');
  const [historyInputs, setHistoryInputs] = useState<Record<string, string>>({});
  const [templateStart, setTemplateStart] = useState<string>('');
  const [templateEnd, setTemplateEnd] = useState<string>('');
  const [importText, setImportText] = useState<string>('');
  const [importStatus, setImportStatus] = useState<string>('');

  useEffect(() => {
    if (!currentSnapshot) return;
    const prevId = getPreviousMonthId(currentSnapshot.id);
    storage.getMonth(prevId).then(setPreviousSnapshot);
  }, [currentSnapshot?.id]);

  useEffect(() => {
    if (!currentSnapshot) return;
    const year = currentSnapshot.id.split('-')[0];
    const baselineId = `${year}-01`;
    storage.getMonth(baselineId).then(setYtdBaselineSnapshot);
  }, [currentSnapshot?.id]);

  useEffect(() => {
    if (!currentSnapshot) return;
    const year = currentSnapshot.id.split('-')[0];
    const months = buildMonthRange(`${year}-01`, currentSnapshot.id);
    const decBaseline = getPreviousMonthId(`${year}-01`);
    const monthIds = [...new Set([...months, decBaseline])];
    let isActive = true;
    Promise.all(
      monthIds.map(async (monthId) => {
        const snapshot = await storage.getMonth(monthId);
        return { monthId, snapshot };
      })
    ).then((entries) => {
      if (!isActive) return;
      const next: Record<string, MonthSnapshot | null> = {};
      entries.forEach(({ monthId, snapshot }) => {
        next[monthId] = snapshot;
      });
      setYearSnapshots(next);
    });
    return () => { isActive = false; };
  }, [currentSnapshot?.id]);

  useEffect(() => {
    if (!currentSnapshot) return;
    const prevId = getPreviousMonthId(currentSnapshot.id);
    setHistoryMonthId(prevId);
    setTemplateEnd(prevId);
    setTemplateStart(addMonths(prevId, -11));
    setMomDetailMonthId(currentSnapshot.id);
  }, [currentSnapshot?.id]);

  useEffect(() => {
    if (!historyMonthId) return;
    const entry = settings.gain_loss_history.find(h => h.month_id === historyMonthId);
    const next: Record<string, string> = {};
    entry?.balances.forEach(b => {
      next[b.account_id] = String(b.amount);
    });
    setHistoryInputs(next);
  }, [historyMonthId, settings.gain_loss_history]);

  const isAllZeroBalances = (balances: StartingBalance[]) => {
    if (balances.length === 0) return true;
    return balances.every(b => Number(b.amount) === 0);
  };

  const getHistoryBalances = (monthId: string) => {
    return settings.gain_loss_history.find(h => h.month_id === monthId)?.balances || [];
  };

  const resolveBalances = (monthId: string, snapshot?: MonthSnapshot | null) => {
    const historyBalances = getHistoryBalances(monthId);
    if (!snapshot) return historyBalances;
    const snapshotBalances = snapshot.starting_balances || [];
    if (!isAllZeroBalances(snapshotBalances)) return snapshotBalances;
    return historyBalances.length ? historyBalances : snapshotBalances;
  };

  const getBalancesForMonth = (monthId: string) => {
    if (!monthId) return [];
    if (currentSnapshot?.id === monthId) return resolveBalances(monthId, currentSnapshot);
    const snapshot = yearSnapshots[monthId];
    if (snapshot) return resolveBalances(monthId, snapshot);
    return resolveBalances(monthId);
  };

  const { totalAll, totalCash, totalInvestments } = useMemo(() => {
    if (!currentSnapshot) {
      return { totalAll: 0, totalCash: 0, totalInvestments: 0 };
    }
    const currentBalances = new Map(getBalancesForMonth(currentSnapshot.id).map(b => [b.account_id, b.amount]));
    const previousBalances = getBalancesForMonth(getPreviousMonthId(currentSnapshot.id));
    const previousMap = new Map(previousBalances.map(b => [b.account_id, b.amount]));

    let totalAllDelta = 0;
    let cashDelta = 0;
    let investmentDelta = 0;

    settings.accounts
      .filter(acc => acc.type !== 'loan')
      .forEach(acc => {
      const current = currentBalances.get(acc.id) ?? 0;
      const previous = previousMap.get(acc.id) ?? 0;
      const delta = current - previous;
      totalAllDelta += delta;
      if (acc.included_in_cash_forecast && acc.type !== 'investment' && acc.type !== 'loan') {
        cashDelta += delta;
      }
      if (acc.type === 'investment') {
        investmentDelta += delta;
      }
    });

    return { totalAll: totalAllDelta, totalCash: cashDelta, totalInvestments: investmentDelta };
  }, [currentSnapshot, previousSnapshot, settings.accounts, settings.gain_loss_history, yearSnapshots]);

  const ytdTotals = useMemo(() => {
    if (!currentSnapshot) {
      return { cash: 0, investments: 0, cashAndInvestments: 0 };
    }
    const year = currentSnapshot.id.split('-')[0];
    const baselineId = `${year}-01`;
    const baselineBalances: StartingBalance[] = resolveBalances(baselineId, ytdBaselineSnapshot);
    const baselineMap = new Map(baselineBalances.map(b => [b.account_id, b.amount]));
    const currentMap = new Map(getBalancesForMonth(currentSnapshot.id).map(b => [b.account_id, b.amount]));

    let cashDelta = 0;
    let investmentDelta = 0;
    let cashAndInvestmentDelta = 0;

    settings.accounts
      .filter(acc => acc.type !== 'loan')
      .forEach(acc => {
        const current = currentMap.get(acc.id) ?? 0;
        const baseline = baselineMap.get(acc.id) ?? 0;
        const delta = current - baseline;
        const isCash = acc.included_in_cash_forecast && acc.type !== 'investment' && acc.type !== 'loan';
        const isInvestment = acc.type === 'investment';
        if (isCash) cashDelta += delta;
        if (isInvestment) investmentDelta += delta;
        if (isCash || isInvestment) cashAndInvestmentDelta += delta;
      });

    return { cash: cashDelta, investments: investmentDelta, cashAndInvestments: cashAndInvestmentDelta };
  }, [currentSnapshot, settings.accounts, settings.gain_loss_history, ytdBaselineSnapshot, yearSnapshots]);

  const buildBalanceMap = (balances: StartingBalance[]) => {
    return new Map(balances.map(b => [b.account_id, b.amount]));
  };

  const buildTotalsFromMap = (map: Map<string, number>) => {
    let cash = 0;
    let investments = 0;
    let cashAndInvestments = 0;
    settings.accounts
      .filter(acc => acc.type !== 'loan')
      .forEach(acc => {
        const value = map.get(acc.id) ?? 0;
        const isCash = acc.included_in_cash_forecast && acc.type !== 'investment' && acc.type !== 'loan';
        const isInvestment = acc.type === 'investment';
        if (isCash) cash += value;
        if (isInvestment) investments += value;
        if (isCash || isInvestment) cashAndInvestments += value;
      });
    return { cash, investments, cashAndInvestments };
  };

  const momRows = useMemo(() => {
    if (!currentSnapshot) return [];
    const year = currentSnapshot.id.split('-')[0];
    const months = buildMonthRange(`${year}-01`, currentSnapshot.id);
    const rows = months.map(monthId => {
      const currentBalances = buildBalanceMap(getBalancesForMonth(monthId));
      const prevBalances = buildBalanceMap(getBalancesForMonth(getPreviousMonthId(monthId)));
      const currentTotals = buildTotalsFromMap(currentBalances);
      const prevTotals = buildTotalsFromMap(prevBalances);
      return {
        monthId,
        cash: currentTotals.cash - prevTotals.cash,
        investments: currentTotals.investments - prevTotals.investments,
        cashAndInvestments: currentTotals.cashAndInvestments - prevTotals.cashAndInvestments
      };
    });
    return rows;
  }, [currentSnapshot, settings.accounts, settings.gain_loss_history, yearSnapshots]);

  const ytdProgression = useMemo(() => {
    if (!currentSnapshot) return [];
    const year = currentSnapshot.id.split('-')[0];
    const baselineId = `${year}-01`;
    const baselineTotals = buildTotalsFromMap(buildBalanceMap(getBalancesForMonth(baselineId)));
    return momRows.map(row => ({
      month: row.monthId,
      cash: (buildTotalsFromMap(buildBalanceMap(getBalancesForMonth(row.monthId))).cash - baselineTotals.cash),
      investments: (buildTotalsFromMap(buildBalanceMap(getBalancesForMonth(row.monthId))).investments - baselineTotals.investments),
      cashAndInvestments: (buildTotalsFromMap(buildBalanceMap(getBalancesForMonth(row.monthId))).cashAndInvestments - baselineTotals.cashAndInvestments)
    }));
  }, [currentSnapshot, momRows, settings.accounts, settings.gain_loss_history, yearSnapshots]);

  const historyAccounts = [...settings.accounts]
    .filter(acc => acc.type !== 'loan')
    .sort((a, b) => a.name.localeCompare(b.name));

  const momDetailRows = useMemo(() => {
    if (!momDetailMonthId) return [];
    const currentBalances = buildBalanceMap(getBalancesForMonth(momDetailMonthId));
    const prevBalances = buildBalanceMap(getBalancesForMonth(getPreviousMonthId(momDetailMonthId)));
    return historyAccounts.map(acc => {
      const current = currentBalances.get(acc.id) ?? 0;
      const previous = prevBalances.get(acc.id) ?? 0;
      return {
        id: acc.id,
        name: acc.name,
        type: acc.type,
        current,
        previous,
        delta: current - previous
      };
    });
  }, [historyAccounts, momDetailMonthId, settings.gain_loss_history, yearSnapshots]);

  const momTotals = useMemo(() => {
    if (!currentSnapshot) {
      return { cash: 0, investments: 0, cashAndInvestments: 0 };
    }
    const prevBalances = getBalancesForMonth(getPreviousMonthId(currentSnapshot.id));
    const prevMap = new Map(prevBalances.map(b => [b.account_id, b.amount]));
    const currentMap = new Map(getBalancesForMonth(currentSnapshot.id).map(b => [b.account_id, b.amount]));

    let cashDelta = 0;
    let investmentDelta = 0;
    let cashAndInvestmentDelta = 0;

    settings.accounts
      .filter(acc => acc.type !== 'loan')
      .forEach(acc => {
        const current = currentMap.get(acc.id) ?? 0;
        const previous = prevMap.get(acc.id) ?? 0;
        const delta = current - previous;
        const isCash = acc.included_in_cash_forecast && acc.type !== 'investment' && acc.type !== 'loan';
        const isInvestment = acc.type === 'investment';
        if (isCash) cashDelta += delta;
        if (isInvestment) investmentDelta += delta;
        if (isCash || isInvestment) cashAndInvestmentDelta += delta;
      });

    return { cash: cashDelta, investments: investmentDelta, cashAndInvestments: cashAndInvestmentDelta };
  }, [currentSnapshot, previousSnapshot, settings.accounts, settings.gain_loss_history, yearSnapshots]);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: settings.preferred_currency,
    }).format(val);
  };

  if (!currentSnapshot) return null;

  const prevId = getPreviousMonthId(currentSnapshot.id);

  const saveHistoryEntry = async () => {
    if (!historyMonthId) return;
    const balances: StartingBalance[] = historyAccounts.map(acc => {
      const raw = historyInputs[acc.id];
      const parsed = Number(raw);
      return { account_id: acc.id, amount: Number.isNaN(parsed) ? 0 : parsed };
    });
    const entry: GainLossHistoryEntry = { month_id: historyMonthId, balances };
    const filtered = settings.gain_loss_history.filter(h => h.month_id !== historyMonthId);
    const updated = [...filtered, entry];
    await updateSettings({ gain_loss_history: updated });
  };

  const handleDownloadTemplate = () => {
    const months = buildMonthRange(templateStart, templateEnd);
    if (!months.length) {
      setImportStatus('Select a valid template month range.');
      return;
    }
    const header = ['Account', ...months].join(',');
    const rows = historyAccounts.map(acc => [acc.name, ...months.map(() => '')].join(','));
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gain_loss_template_${templateStart}_to_${templateEnd}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const parseCsvLine = (line: string) => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }
      if (char === ',' && !inQuotes) {
        result.push(current);
        current = '';
        continue;
      }
      current += char;
    }
    result.push(current);
    return result;
  };

  const handleImportPaste = async (rawOverride?: string) => {
    const rawSource = typeof rawOverride === 'string' ? rawOverride : importText;
    const raw = rawSource.trim();
    if (!raw) {
      setImportStatus('Paste your spreadsheet data first.');
      return;
    }
    try {
      setImportStatus('Importing...');
      const delimiter = raw.includes('\t') ? '\t' : ',';
      const rows = raw
        .split(/\r?\n/)
        .map(line => {
          const cells = delimiter === '\t' ? line.split('\t') : parseCsvLine(line);
          return cells.map(cell => cell.trim());
        })
        .filter(row => row.some(cell => cell !== ''));
      if (rows.length < 2) {
        setImportStatus('Paste must include a header row and at least one data row.');
        return;
      }
      const header = rows[0];
      const monthColumnIndexes = header
        .map((cell, index) => ({ monthId: cell.trim(), index }))
        .filter(col => /^\d{4}-\d{2}$/.test(col.monthId));
      if (!monthColumnIndexes.length) {
        setImportStatus('Header row must include month columns like YYYY-MM.');
        return;
      }
      const monthIds = monthColumnIndexes.map(col => col.monthId);
      const accountByName = new Map(
        historyAccounts.map(acc => [acc.name.trim().toLowerCase(), acc.id])
      );
      const missingAccounts: string[] = [];
      const monthToBalances = new Map<string, Map<string, number>>();
      monthIds.forEach(monthId => {
        const map = new Map<string, number>();
        historyAccounts.forEach(acc => map.set(acc.id, 0));
        monthToBalances.set(monthId, map);
      });

      const parseCurrency = (value: string) => {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const isNegative = trimmed.startsWith('(') && trimmed.endsWith(')');
        const cleaned = trimmed.replace(/[$,()]/g, '');
        const parsed = Number(cleaned);
        if (Number.isNaN(parsed)) return null;
        return isNegative ? -parsed : parsed;
      };

      rows.slice(1).forEach(row => {
        const accountName = row[0]?.trim();
        if (!accountName) return;
        const accountId = accountByName.get(accountName.toLowerCase());
        if (!accountId) {
          if (!missingAccounts.includes(accountName)) {
            missingAccounts.push(accountName);
          }
          return;
        }
        monthColumnIndexes.forEach(({ monthId, index }) => {
          const rawValue = row[index] ?? '';
          const parsed = parseCurrency(rawValue);
          if (parsed === null) return;
          const map = monthToBalances.get(monthId);
          if (map) {
            map.set(accountId, parsed);
          }
        });
      });

      const importedEntries: GainLossHistoryEntry[] = monthIds.map(monthId => {
        const map = monthToBalances.get(monthId) || new Map<string, number>();
        return {
          month_id: monthId,
          balances: historyAccounts.map(acc => ({
            account_id: acc.id,
            amount: map.get(acc.id) ?? 0
          }))
        };
      });

      const filtered = settings.gain_loss_history.filter(entry => !monthIds.includes(entry.month_id));
      const updated = [...filtered, ...importedEntries];
      await updateSettings({ gain_loss_history: updated });
      if (monthIds.includes(historyMonthId)) {
        const entry = importedEntries.find(e => e.month_id === historyMonthId);
        if (entry) {
          const next: Record<string, string> = {};
          entry.balances.forEach(b => {
            next[b.account_id] = String(b.amount);
          });
          setHistoryInputs(next);
        }
      }
      const missingNote = missingAccounts.length
        ? ` Missing accounts: ${missingAccounts.join(', ')}.`
        : '';
      setImportStatus(`Imported ${monthIds.length} month(s).${missingNote}`);
    } catch (error) {
      setImportStatus(`Import failed: ${(error as Error).message}`);
    }
  };

  const handleImportFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = String(ev.target?.result || '');
      setImportText(text);
      await handleImportPaste(text);
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const handleAmountKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.currentTarget.blur();
    }
  };

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <div>
        <h2 className="text-3xl font-extrabold text-slate-900">Gain/Loss Tracker</h2>
        <p className="text-slate-500">Comparing {formatMonthLabel(currentSnapshot.id)} to {formatMonthLabel(prevId)}</p>
        {!previousSnapshot && (
          <p className="text-xs text-slate-400 mt-1">No prior month snapshot found. Deltas use 0 as baseline.</p>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <p className="text-sm font-medium text-slate-500 mb-1">Total Gain/Loss</p>
          <p className={`text-2xl font-bold ${totalAll >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {formatCurrency(totalAll)}
          </p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <p className="text-sm font-medium text-slate-500 mb-1">Cash Accounts Gain/Loss</p>
          <p className={`text-2xl font-bold ${totalCash >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {formatCurrency(totalCash)}
          </p>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <p className="text-sm font-medium text-slate-500 mb-1">Investment Accounts Gain/Loss</p>
          <p className={`text-2xl font-bold ${totalInvestments >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {formatCurrency(totalInvestments)}
          </p>
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
        <h3 className="text-lg font-bold text-slate-800 mb-4">YTD Change</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <tbody className="divide-y divide-slate-100">
              <tr>
                <td className="px-4 py-3 font-semibold text-slate-700">Cash</td>
                <td className={`px-4 py-3 text-right font-bold ${ytdTotals.cash >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {formatCurrency(ytdTotals.cash)}
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-semibold text-slate-700">Investment</td>
                <td className={`px-4 py-3 text-right font-bold ${ytdTotals.investments >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {formatCurrency(ytdTotals.investments)}
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-semibold text-slate-700">Cash + Investment</td>
                <td className={`px-4 py-3 text-right font-bold ${ytdTotals.cashAndInvestments >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {formatCurrency(ytdTotals.cashAndInvestments)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400 mt-2">
          Baseline is the starting balances from {formatMonthLabel(`${currentSnapshot.id.split('-')[0]}-01`)}.
        </p>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
        <h3 className="text-lg font-bold text-slate-800 mb-4">Month Over Month</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2 font-bold">Month</th>
                <th className="px-4 py-2 font-bold text-right">Cash</th>
                <th className="px-4 py-2 font-bold text-right">Investment</th>
                <th className="px-4 py-2 font-bold text-right">Cash + Investment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {momRows.map(row => (
                <tr key={row.monthId}>
                  <td className="px-4 py-3 font-semibold text-slate-700">{formatMonthLabel(row.monthId)}</td>
                  <td className={`px-4 py-3 text-right font-bold ${row.cash >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatCurrency(row.cash)}
                  </td>
                  <td className={`px-4 py-3 text-right font-bold ${row.investments >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatCurrency(row.investments)}
                  </td>
                  <td className={`px-4 py-3 text-right font-bold ${row.cashAndInvestments >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatCurrency(row.cashAndInvestments)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400 mt-2">
          Each row compares to the prior month. January compares to the previous December when available.
        </p>
        <div className="mt-6 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={ytdProgression}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis
                dataKey="month"
                tickFormatter={(value) => value.split('-')[1]}
                stroke="#94a3b8"
                fontSize={12}
              />
              <YAxis stroke="#94a3b8" fontSize={12} />
              <Tooltip formatter={(value: number) => formatCurrency(value)} />
              <Line type="monotone" dataKey="cash" stroke="#16a34a" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="investments" stroke="#3b82f6" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="cashAndInvestments" stroke="#0f172a" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          <h3 className="text-lg font-bold text-slate-800">Month Detail (By Account)</h3>
          <input
            type="month"
            value={momDetailMonthId}
            onChange={(e) => setMomDetailMonthId(e.target.value)}
            className="px-3 py-2 border rounded-lg"
          />
        </div>
        <p className="text-xs text-slate-500">
          Compares {formatMonthLabel(momDetailMonthId)} to {formatMonthLabel(getPreviousMonthId(momDetailMonthId))}.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2 font-bold">Account</th>
                <th className="px-4 py-2 font-bold">Type</th>
                <th className="px-4 py-2 font-bold text-right">Previous</th>
                <th className="px-4 py-2 font-bold text-right">Current</th>
                <th className="px-4 py-2 font-bold text-right">Delta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {momDetailRows.map(row => (
                <tr key={row.id}>
                  <td className="px-4 py-3 font-semibold text-slate-700">{row.name}</td>
                  <td className="px-4 py-3 text-slate-500 capitalize">{row.type}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(row.previous)}</td>
                  <td className="px-4 py-3 text-right">{formatCurrency(row.current)}</td>
                  <td className={`px-4 py-3 text-right font-bold ${row.delta >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatCurrency(row.delta)}
                  </td>
                </tr>
              ))}
              {momDetailRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400 italic">
                    No accounts available.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          <h3 className="text-lg font-bold text-slate-800">Historical Balances (Gain/Loss Only)</h3>
          <input
            type="month"
            value={historyMonthId}
            onChange={(e) => setHistoryMonthId(e.target.value)}
            className="px-3 py-2 border rounded-lg"
          />
        </div>
        <p className="text-xs text-slate-500">
          Use this to add historical balances without creating forecast data. These values are used only when a prior month snapshot is missing.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {historyAccounts.map(acc => (
            <div key={acc.id} className="space-y-1">
              <label className="text-xs font-bold text-slate-500 uppercase">{acc.name}</label>
              <input
                type="number"
                value={historyInputs[acc.id] ?? ''}
                onChange={(e) => setHistoryInputs(prev => ({ ...prev, [acc.id]: e.target.value }))}
                onKeyDown={handleAmountKeyDown}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
          ))}
        </div>
        <Button onClick={saveHistoryEntry} variant="primary">
          Save Historical Balances
        </Button>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-4">
        <h3 className="text-lg font-bold text-slate-800">Bulk Import (Spreadsheet)</h3>
        <p className="text-xs text-slate-500">
          Use a table with accounts in the first column and months (YYYY-MM) across the header row. Transfers are not used here.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase">Template Start</label>
            <input
              type="month"
              value={templateStart}
              onChange={(e) => setTemplateStart(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500 uppercase">Template End</label>
            <input
              type="month"
              value={templateEnd}
              onChange={(e) => setTemplateEnd(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
        </div>
        <Button onClick={handleDownloadTemplate} variant="secondary" type="button">
          Download CSV Template
        </Button>
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-500 uppercase">Paste CSV/TSV Data</label>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={6}
            className="w-full px-3 py-2 border rounded-lg font-mono text-xs"
            placeholder="Account,2024-01,2024-02&#10;Checking,1200,1250"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() => {
              setImportStatus('Importing...');
              handleImportPaste();
            }}
            variant="primary"
            type="button"
          >
            Import Historical Data
          </Button>
          <label className="px-3 py-2 bg-slate-100 text-slate-700 rounded-lg font-semibold hover:bg-slate-200 transition cursor-pointer">
            Upload CSV
            <input type="file" className="hidden" accept=".csv,.tsv,text/csv,text/tab-separated-values" onChange={handleImportFile} />
          </label>
          {importStatus && <span className="text-xs text-slate-500">{importStatus}</span>}
        </div>
      </div>
    </div>
  );
};

export default GainLossPage;
