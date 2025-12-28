import React, { useMemo, useState } from 'react';
import { useApp } from '../App';
import { calculateForecast } from '../lib/forecasting';
import { formatMonthLabel } from '../lib/format';
import { CartesianGrid, LineChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const Dashboard: React.FC = () => {
  const { currentSnapshot, settings } = useApp();
  const [selectedAccountId, setSelectedAccountId] = useState<string>('total');

  const forecastData = useMemo(() => {
    if (!currentSnapshot) return [];
    return calculateForecast(currentSnapshot);
  }, [currentSnapshot]);

  const selectedSeries = useMemo(() => {
    if (selectedAccountId === 'total') {
      return forecastData.map(p => ({ date: p.date, value: p.total_cash }));
    }
    return forecastData.map(p => ({ date: p.date, value: p.balances[selectedAccountId] || 0 }));
  }, [forecastData, selectedAccountId]);

  const summary = useMemo(() => {
    if (selectedSeries.length === 0) {
      return { projected_end_balance: 0, lowest_projected_balance: 0, lowest_balance_date: '' };
    }
    const endBalance = selectedSeries[selectedSeries.length - 1].value;
    let lowestBalance = Infinity;
    let lowestDate = '';
    selectedSeries.forEach(p => {
      if (p.value < lowestBalance) {
        lowestBalance = p.value;
        lowestDate = p.date;
      }
    });
    return {
      projected_end_balance: endBalance,
      lowest_projected_balance: lowestBalance === Infinity ? 0 : lowestBalance,
      lowest_balance_date: lowestDate
    };
  }, [selectedSeries]);

  const totals = useMemo(() => {
    if (!currentSnapshot) {
      return { income: 0, expenses: 0, net: 0 };
    }
    let income = 0;
    let expenses = 0;
    currentSnapshot.transactions.forEach(tx => {
      if (tx.transaction_type === 'transfer' || tx.transfer_account_id) return;
      if (tx.amount >= 0) {
        income += tx.amount;
      } else {
        expenses += Math.abs(tx.amount);
      }
    });
    return { income, expenses, net: income - expenses };
  }, [currentSnapshot]);

  const startingCash = useMemo(() => {
    if (!currentSnapshot) return 0;
    if (selectedAccountId === 'total') {
      const eligibleAccounts = currentSnapshot.accounts.filter(
        acc => acc.included_in_cash_forecast && acc.type !== 'investment' && acc.type !== 'loan'
      );
      return eligibleAccounts.reduce((sum, acc) => {
        const balance = currentSnapshot.starting_balances.find(b => b.account_id === acc.id)?.amount || 0;
        return sum + balance;
      }, 0);
    }
    return currentSnapshot.starting_balances.find(b => b.account_id === selectedAccountId)?.amount || 0;
  }, [currentSnapshot, selectedAccountId]);

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: settings.preferred_currency,
    }).format(val);
  };

  if (!currentSnapshot) return null;
  const sortedAccounts = [...currentSnapshot.accounts].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-extrabold text-slate-900">Dashboard</h2>
          <p className="text-slate-500">Overview for {formatMonthLabel(currentSnapshot.id)}</p>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-bold text-slate-500 uppercase">Account View</label>
          <select
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            className="px-3 py-2 border rounded-lg bg-slate-50"
          >
            <option value="total">All Cash (Forecast Total)</option>
            {sortedAccounts.map(acc => (
              <option key={acc.id} value={acc.id}>{acc.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <p className="text-sm font-medium text-slate-500 mb-1">Projected End Balance</p>
          <p className={`text-2xl font-bold ${summary.projected_end_balance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {formatCurrency(summary.projected_end_balance)}
          </p>
        </div>
        
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <p className="text-sm font-medium text-slate-500 mb-1">Lowest Balance</p>
          <p className={`text-2xl font-bold ${summary.lowest_projected_balance >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
            {formatCurrency(summary.lowest_projected_balance)}
          </p>
          <p className="text-xs text-slate-400 mt-1">Expected on {summary.lowest_balance_date || 'N/A'}</p>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <p className="text-sm font-medium text-slate-500 mb-1">Starting Cash</p>
          <p className="text-2xl font-bold text-slate-800">
            {formatCurrency(startingCash)}
          </p>
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
        <h3 className="text-lg font-bold text-slate-800 mb-4">Monthly Totals</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <tbody className="divide-y divide-slate-100">
              <tr>
                <td className="px-4 py-3 font-semibold text-slate-700">Total Income</td>
                <td className="px-4 py-3 text-right font-bold text-green-600">{formatCurrency(totals.income)}</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-semibold text-slate-700">Total Expenses</td>
                <td className="px-4 py-3 text-right font-bold text-red-600">{formatCurrency(totals.expenses)}</td>
              </tr>
              <tr>
                <td className="px-4 py-3 font-semibold text-slate-700">Net Amount</td>
                <td className={`px-4 py-3 text-right font-bold ${totals.net >= 0 ? 'text-slate-800' : 'text-red-600'}`}>
                  {formatCurrency(totals.net)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 h-80">
        <h3 className="text-lg font-bold text-slate-800 mb-4">Cash Forecast Trend</h3>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={selectedSeries}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
            <XAxis 
              dataKey="date" 
              tickFormatter={(str) => str.split('-')[2]} 
              stroke="#94a3b8"
              fontSize={12}
            />
            <YAxis stroke="#94a3b8" fontSize={12} />
            <Tooltip 
              formatter={(value: number) => [formatCurrency(value), selectedAccountId === 'total' ? 'Total Cash' : 'Balance']}
              contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
            />
            <Line 
              type="monotone" 
              dataKey="value" 
              stroke="#3b82f6" 
              strokeWidth={3} 
              dot={false}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
        <h3 className="text-lg font-bold text-slate-800 mb-4">Account Breakdowns</h3>
        <div className="space-y-4">
          {sortedAccounts.map(acc => {
            const lastPoint = forecastData[forecastData.length - 1];
            const balance = lastPoint ? lastPoint.balances[acc.id] : 0;
            return (
              <div key={acc.id} className="flex justify-between items-center py-2 border-b border-slate-50 last:border-0">
                <div>
                  <p className="font-semibold text-slate-700">{acc.name}</p>
                  <p className="text-xs text-slate-400 uppercase tracking-wider">{acc.type}</p>
                </div>
                <p className={`font-bold ${balance >= 0 ? 'text-slate-800' : 'text-red-500'}`}>
                  {formatCurrency(balance)}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
