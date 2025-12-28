import React, { useMemo, useState } from 'react';
import { useApp } from '../App';
import { storage } from '../lib/storage';
import { LoanPaymentRecord } from '../types';
import { formatMonthLabel } from '../lib/format';
import { Button } from '../components/Button';

const getMonthIdFromDate = (value: string) => value.slice(0, 7);

const LoanTracker: React.FC = () => {
  const { settings, updateSettings } = useApp();
  const [selectedMonthId, setSelectedMonthId] = useState<string>(new Date().toISOString().slice(0, 7));
  const [status, setStatus] = useState<string>('');

  const sortedLoans = useMemo(() => {
    return [...settings.loans].sort((a, b) => a.name.localeCompare(b.name));
  }, [settings.loans]);

  const applyPaymentsForMonth = async () => {
    setStatus('Applying payments...');
    const snapshot = await storage.getMonth(selectedMonthId);
    if (!snapshot) {
      setStatus('No month snapshot found for selected month.');
      return;
    }
    const paymentsByLoan = new Map<string, number>();
    snapshot.transactions.forEach(tx => {
      if (!tx.loan_id) return;
      if (tx.amount >= 0) return;
      const amount = Math.abs(tx.amount);
      paymentsByLoan.set(tx.loan_id, (paymentsByLoan.get(tx.loan_id) || 0) + amount);
    });

    const updatedLoans = sortedLoans.map(loan => {
      const paid = paymentsByLoan.get(loan.id) || 0;
      const history = loan.payment_history || [];
      const existing = history.find(h => h.month_id === selectedMonthId);
      const previousPaid = existing?.amount || 0;
      const previousInterest = existing?.interest_accrued || 0;
      const balanceBefore = existing?.balance_before ?? loan.current_balance;
      const monthlyInterest = (balanceBefore * (loan.interest_rate / 100)) / 12;
      const deltaInterest = monthlyInterest - previousInterest;
      const deltaPayment = paid - previousPaid;
      const newBalance = Math.max(0, loan.current_balance + deltaInterest - deltaPayment);
      const record: LoanPaymentRecord = {
        month_id: selectedMonthId,
        amount: paid,
        interest_accrued: monthlyInterest,
        balance_before: balanceBefore,
        balance_after: newBalance
      };
      const newHistory: LoanPaymentRecord[] = existing
        ? history.map(h => h.month_id === selectedMonthId ? record : h)
        : [...history, record];
      return { ...loan, current_balance: newBalance, payment_history: newHistory, updated_at: Date.now() };
    });

    await updateSettings({ loans: updatedLoans });
    setStatus('Payments applied.');
  };

  return (
    <div className="space-y-6 pb-20 md:pb-0">
      <div>
        <h2 className="text-3xl font-extrabold text-slate-900">Loan Tracker</h2>
        <p className="text-slate-500">Track balances and apply payments from cash transactions</p>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">Apply Payments For</label>
            <input
              type="month"
              value={selectedMonthId}
              onChange={(e) => setSelectedMonthId(e.target.value)}
              className="px-3 py-2 border rounded-lg"
            />
          </div>
          <Button onClick={applyPaymentsForMonth} variant="primary">
            Apply Payments
          </Button>
        </div>
        {status && <p className="text-xs text-slate-500">{status}</p>}
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
        <h3 className="text-lg font-bold text-slate-800 mb-4">Loan Balances</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2 font-bold">Loan</th>
                <th className="px-4 py-2 font-bold">Balance</th>
                <th className="px-4 py-2 font-bold">APR</th>
                <th className="px-4 py-2 font-bold">Maturity</th>
                <th className="px-4 py-2 font-bold">Last Payment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedLoans.map(loan => {
                const lastPayment = loan.payment_history?.slice().sort((a, b) => a.month_id.localeCompare(b.month_id)).slice(-1)[0];
                return (
                  <tr key={loan.id} className="hover:bg-slate-50 transition">
                    <td className="px-4 py-2 font-semibold text-slate-800">{loan.name}</td>
                    <td className="px-4 py-2">{loan.current_balance.toFixed(2)}</td>
                    <td className="px-4 py-2">{loan.interest_rate.toFixed(2)}%</td>
                    <td className="px-4 py-2">{loan.maturity_date || '—'}</td>
                    <td className="px-4 py-2">
                      {lastPayment
                        ? `${formatMonthLabel(lastPayment.month_id)} (${lastPayment.amount.toFixed(2)} | Int ${lastPayment.interest_accrued?.toFixed(2) || '0.00'})`
                        : '—'}
                    </td>
                  </tr>
                );
              })}
              {sortedLoans.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400 italic">
                    No loans configured. Add loans in Settings to begin tracking.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default LoanTracker;
