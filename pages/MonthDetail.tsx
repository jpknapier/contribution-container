
import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../App';
import { Transaction } from '../types';
import { calculateForecast } from '../lib/forecasting';
import { roundToCents } from '../lib/number';
import { Button } from '../components/Button';

const MonthDetail: React.FC = () => {
  const { currentSnapshot, setSnapshot, saveCurrentSnapshot, settings, updateSettings } = useApp();
  const [editingTx, setEditingTx] = useState<Partial<Transaction> | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  if (!currentSnapshot) return null;

  const sortedAccounts = [...currentSnapshot.accounts].sort((a, b) => a.name.localeCompare(b.name));
  const sortedCategories = [...currentSnapshot.categories].sort((a, b) => a.name.localeCompare(b.name));
  const sortedLoans = [...settings.loans].sort((a, b) => a.name.localeCompare(b.name));
  const cashAccounts = sortedAccounts.filter(acc => acc.included_in_cash_forecast && acc.type !== 'loan');
  const [balanceAccountOrder, setBalanceAccountOrder] = useState<string[]>(settings.running_balance_account_order || []);
  const [draggingAccountId, setDraggingAccountId] = useState<string | null>(null);
  const orderedCashAccounts = useMemo(() => {
    if (balanceAccountOrder.length === 0) return cashAccounts;
    return balanceAccountOrder
      .map((id) => cashAccounts.find((acc) => acc.id === id))
      .filter((acc): acc is typeof cashAccounts[number] => Boolean(acc));
  }, [balanceAccountOrder, cashAccounts]);
  const forecastData = useMemo(() => calculateForecast(currentSnapshot), [currentSnapshot]);
  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: settings.preferred_currency,
  }).format(val);

  const arraysEqual = (a: string[], b: string[]) => {
    if (a.length !== b.length) return false;
    return a.every((value, index) => value === b[index]);
  };

  const normalizeBalanceOrder = (order: string[], accounts: typeof cashAccounts) => {
    const ids = accounts.map((acc) => acc.id);
    const existing = order.filter((id) => ids.includes(id));
    const missing = ids.filter((id) => !existing.includes(id));
    return [...existing, ...missing];
  };

  useEffect(() => {
    const next = normalizeBalanceOrder(settings.running_balance_account_order || [], cashAccounts);
    setBalanceAccountOrder((prev) => (arraysEqual(prev, next) ? prev : next));
    if (!arraysEqual(next, settings.running_balance_account_order || [])) {
      updateSettings({ running_balance_account_order: next });
    }
  }, [cashAccounts, settings.running_balance_account_order]);

  const handleAmountKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.currentTarget.blur();
    }
  };

  const getDisplayAmount = (tx: Partial<Transaction> | null) => {
    if (!tx) return 0;
    const amount = tx.amount || 0;
    return Math.abs(amount);
  };

  const handleDropAccount = (targetId: string) => {
    if (!draggingAccountId || draggingAccountId === targetId) return;
    setBalanceAccountOrder((prev) => {
      const next = prev.filter((id) => id !== draggingAccountId);
      const targetIndex = next.indexOf(targetId);
      if (targetIndex === -1) return prev;
      next.splice(targetIndex, 0, draggingAccountId);
      updateSettings({ running_balance_account_order: next });
      return next;
    });
    setDraggingAccountId(null);
  };

  const handleAddTransaction = () => {
    const newTx: Partial<Transaction> = {
      id: crypto.randomUUID(),
      date: `${currentSnapshot.id}-01`,
      amount: 0,
      account_id: currentSnapshot.accounts[0]?.id || '',
      transfer_account_id: '',
      transaction_type: 'expense',
      category_id: currentSnapshot.categories[0]?.id || '',
      description: '',
      created_at: Date.now(),
      updated_at: Date.now()
    };
    setEditingTx(newTx);
  };

  const handleSaveTx = () => {
    if (!editingTx || !editingTx.id) return;

    const account = currentSnapshot.accounts.find(a => a.id === editingTx.account_id);
    if (!account) return;
    const txType = editingTx.transaction_type || 'expense';
    if (txType === 'transfer') {
      if (!editingTx.transfer_account_id) {
        alert('Select a "Transfer To" account.');
        return;
      }
      if (editingTx.transfer_account_id === editingTx.account_id) {
        alert('Transfer accounts must be different.');
        return;
      }
    }
    const rawAmount = Math.abs(editingTx.amount || 0);
    let normalizedAmount = roundToCents(rawAmount);
    if (txType === 'expense') {
      normalizedAmount = -normalizedAmount;
    }
    const tx: Transaction = {
      ...editingTx as Transaction,
      transaction_type: txType,
      amount: normalizedAmount,
      updated_at: Date.now()
    };

    const newTxs = currentSnapshot.transactions.some(t => t.id === tx.id)
      ? currentSnapshot.transactions.map(t => t.id === tx.id ? tx : t)
      : [...currentSnapshot.transactions, tx];

    setSnapshot({ ...currentSnapshot, transactions: newTxs });
    setEditingTx(null);
  };

  const handleDeleteTx = (id: string) => {
    if (!confirm('Are you sure you want to delete this transaction?')) return;
    const newTxs = currentSnapshot.transactions.filter(t => t.id !== id);
    setSnapshot({ ...currentSnapshot, transactions: newTxs });
  };


  const filteredTransactions = currentSnapshot.transactions.filter(tx => 
    tx.description.toLowerCase().includes(searchTerm.toLowerCase()) || 
    currentSnapshot.categories.find(c => c.id === tx.category_id)?.name.toLowerCase().includes(searchTerm.toLowerCase())
  ).sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="space-y-6 pb-20">
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-extrabold text-slate-900">Forecast Detail</h2>
          <p className="text-slate-500">Manage balances and transactions</p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={handleAddTransaction}
            variant="primary"
            className="flex items-center shadow-sm"
          >
            <svg className="w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
            New Transaction
          </Button>
          <Button
            onClick={saveCurrentSnapshot}
            variant="success"
            className="flex items-center shadow-sm"
          >
            <svg className="w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"></path></svg>
            Save Changes
          </Button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex justify-between items-center">
          <h3 className="text-lg font-bold text-slate-800">Running Balances (Cash Accounts)</h3>
          <p className="text-xs text-slate-500">Daily balances by account</p>
        </div>
        <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-slate-500 uppercase">Reorder Accounts</span>
          {orderedCashAccounts.map((acc) => (
            <div
              key={acc.id}
              draggable
              onDragStart={() => setDraggingAccountId(acc.id)}
              onDragEnd={() => setDraggingAccountId(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDropAccount(acc.id)}
              className={`flex items-center gap-1 rounded-full px-2 py-1 border text-xs font-semibold cursor-move select-none ${
                draggingAccountId === acc.id ? 'bg-blue-100 border-blue-300 text-blue-700' : 'bg-slate-50 border-slate-200 text-slate-700'
              }`}
              title="Drag to reorder"
            >
              <span className="text-sm leading-none">⠿</span>
              <span>{acc.name}</span>
            </div>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-3 font-bold">Date</th>
                {orderedCashAccounts.map(acc => (
                  <th key={acc.id} className="px-4 py-3 font-bold">{acc.name}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {forecastData.map(point => (
                <tr key={point.date} className="hover:bg-slate-50 transition">
                  <td className="px-4 py-2 text-slate-600 font-mono">{point.date}</td>
                  {orderedCashAccounts.map(acc => (
                    <td key={acc.id} className="px-4 py-2 font-semibold text-slate-700">
                      {formatCurrency(point.balances[acc.id] || 0)}
                    </td>
                  ))}
                </tr>
              ))}
              {forecastData.length === 0 && (
                <tr>
                  <td colSpan={orderedCashAccounts.length + 1} className="px-4 py-8 text-center text-slate-400 italic">
                    No forecast data available.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row justify-between items-center gap-4">
          <h3 className="text-lg font-bold text-slate-800">Transactions</h3>
          <input 
            type="text"
            placeholder="Search transactions..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full md:w-64 px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3 font-bold">Date</th>
                <th className="px-6 py-3 font-bold">Description</th>
                <th className="px-6 py-3 font-bold">Category</th>
                <th className="px-6 py-3 font-bold">Account</th>
                <th className="px-6 py-3 font-bold text-right">Amount</th>
                <th className="px-6 py-3 font-bold text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filteredTransactions.map(tx => {
                const cat = currentSnapshot.categories.find(c => c.id === tx.category_id);
                const acc = currentSnapshot.accounts.find(a => a.id === tx.account_id);
                return (
                  <tr key={tx.id} className="hover:bg-slate-50 transition">
                    <td className="px-6 py-4 text-slate-600 font-mono">{tx.date}</td>
                    <td className="px-6 py-4 font-medium text-slate-800">{tx.description}</td>
                    <td className="px-6 py-4 text-slate-600">
                      <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${cat?.type === 'income' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                        {cat?.name}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-slate-600 text-xs font-semibold">{acc?.name}</td>
                    <td className={`px-6 py-4 text-right font-bold ${tx.amount >= 0 ? 'text-green-600' : 'text-slate-800'}`}>
                      {tx.amount > 0 ? '+' : ''}{tx.amount.toFixed(2)}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex justify-center space-x-2">
                        <Button onClick={() => setEditingTx(tx)} variant="icon" className="p-2">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                        </Button>
                        <Button onClick={() => handleDeleteTx(tx.id)} variant="danger" className="p-2">
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredTransactions.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400 italic">No transactions found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editingTx && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 space-y-4">
            <h3 className="text-xl font-bold text-slate-900">{editingTx.id ? 'Edit Transaction' : 'New Transaction'}</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">Date</label>
                <input 
                  type="date"
                  value={editingTx.date}
                  onChange={(e) => setEditingTx({...editingTx, date: e.target.value})}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">Type</label>
                <select
                  value={editingTx.transaction_type || 'expense'}
                  onChange={(e) => setEditingTx({ ...editingTx, transaction_type: e.target.value as Transaction['transaction_type'] })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="income">Income</option>
                  <option value="expense">Expense</option>
                  <option value="transfer">Transfer</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">Amount</label>
                <input 
                  type="number"
                  step="0.01"
                  value={getDisplayAmount(editingTx)}
                  onChange={(e) => setEditingTx({...editingTx, amount: parseFloat(e.target.value) || 0})}
                  onKeyDown={handleAmountKeyDown}
                  className="w-full px-3 py-2 border rounded-lg font-bold"
                />
              </div>
              <div className="col-span-2 space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">Description</label>
                <input 
                  type="text"
                  value={editingTx.description}
                  onChange={(e) => setEditingTx({...editingTx, description: e.target.value})}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="e.g. Weekly Groceries"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">Category</label>
                <select 
                  value={editingTx.category_id}
                  onChange={(e) => setEditingTx({...editingTx, category_id: e.target.value})}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  {sortedCategories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">Account</label>
                <select 
                  value={editingTx.account_id}
                  onChange={(e) => setEditingTx({...editingTx, account_id: e.target.value})}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  {sortedAccounts
                    .map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              {editingTx.transaction_type === 'transfer' && (
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">Transfer To</label>
                  <select
                    value={editingTx.transfer_account_id || ''}
                    onChange={(e) => setEditingTx({ ...editingTx, transfer_account_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="">Select account</option>
                    {sortedAccounts.map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="space-y-1 col-span-2">
                <label className="text-xs font-bold text-slate-500 uppercase">Loan (Optional)</label>
                <select
                  value={editingTx.loan_id || ''}
                  onChange={(e) => setEditingTx({ ...editingTx, loan_id: e.target.value || undefined })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="">No Loan</option>
                  {sortedLoans.map(loan => (
                    <option key={loan.id} value={loan.id}>{loan.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end space-x-3 pt-4 border-t">
              <Button onClick={() => setEditingTx(null)} variant="secondary">Cancel</Button>
              <Button onClick={handleSaveTx} variant="primary">Save Transaction</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MonthDetail;
