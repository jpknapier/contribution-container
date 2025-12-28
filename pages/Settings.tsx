
import React, { useEffect, useState } from 'react';
import { useApp } from '../App';
import { storage } from '../lib/storage';
import { getSupabase, syncMonth, syncSettings, syncTaxTables } from '../lib/supabase';
import { Account, AccountType, Category, CategoryType, Loan, RecurringItem, RecurringItemType } from '../types';
import { Button } from '../components/Button';

const SettingsPage: React.FC = () => {
  const { settings, updateSettings, currentSnapshot, refreshSnapshot } = useApp();
  const [syncStatus, setSyncStatus] = useState<string>('Idle');
  const [authStatus, setAuthStatus] = useState<string>('Signed out');
  const [authEmail, setAuthEmail] = useState<string>('');
  const [authPassword, setAuthPassword] = useState<string>('');
  const [editingAccount, setEditingAccount] = useState<Partial<Account> | null>(null);
  const [editingCategory, setEditingCategory] = useState<Partial<Category> | null>(null);
  const [editingLoan, setEditingLoan] = useState<Partial<Loan> | null>(null);
  const [editingRecurring, setEditingRecurring] = useState<RecurringItem | null>(null);
  const [accountSortKey, setAccountSortKey] = useState<'name' | 'type' | 'included_in_cash_forecast'>('name');
  const [accountSortDir, setAccountSortDir] = useState<'asc' | 'desc'>('asc');
  const [recurringSortKey, setRecurringSortKey] = useState<'name' | 'cadence' | 'day_rule' | 'default_amount' | 'type' | 'account'>('name');
  const [recurringSortDir, setRecurringSortDir] = useState<'asc' | 'desc'>('asc');

  const refreshAuthStatus = async () => {
    const client = getSupabase(settings);
    if (!client) {
      setAuthStatus('Disabled');
      return;
    }
    const { data: { user }, error } = await client.auth.getUser();
    if (error) {
      setAuthStatus('Auth error');
      return;
    }
    if (user?.email) {
      setAuthStatus(`Signed in as ${user.email}`);
      return;
    }
    setAuthStatus('Signed out');
  };

  useEffect(() => {
    refreshAuthStatus();
  }, [settings.supabase_enabled, settings.supabase_url, settings.supabase_anon_key]);

  const handleExport = async () => {
    const data = await storage.exportAllData();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cash_forecast_backup_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        await storage.importData(ev.target?.result as string);
        alert("Import successful! Refreshing page...");
        window.location.reload();
      } catch (err) {
        alert("Import failed: " + (err as Error).message);
      }
    };
    reader.readAsText(file);
  };

  const handleSyncNow = async () => {
    if (!currentSnapshot || !settings.supabase_enabled) return;
    setSyncStatus('Syncing...');
    try {
      const client = getSupabase(settings);
      if (!client) {
        setSyncStatus('Supabase not configured');
        return;
      }
      const { data: { user } } = await client.auth.getUser();
      if (!user) {
        setSyncStatus('Sign in required');
        return;
      }
      const updatedSettings = await syncSettings(settings);
      if (updatedSettings) {
        await updateSettings(updatedSettings);
      }
      await syncTaxTables(updatedSettings || settings);

      const snapshotToSync = await storage.getMonth(currentSnapshot.id) || currentSnapshot;
      const updated = await syncMonth(snapshotToSync, updatedSettings || settings);
      if (updated) {
        await storage.upsertMonth(updated);
        refreshSnapshot();
        setSyncStatus('Success (Remote updated local)');
      } else {
        setSyncStatus('Success (Local pushed to remote)');
      }
    } catch (e) {
      setSyncStatus('Failed: ' + (e as Error).message);
    }
  };

  const handleReset = async () => {
    if (!confirm('DANGER: This will delete ALL local data in IndexedDB. Are you absolutely sure?')) return;
    await storage.resetAll();
    window.location.reload();
  };

  const handleSignIn = async () => {
    const client = getSupabase(settings);
    if (!client) return;
    if (!authEmail || !authPassword) {
      setAuthStatus('Enter email and password');
      return;
    }
    setAuthStatus('Signing in...');
    const { error } = await client.auth.signInWithPassword({
      email: authEmail,
      password: authPassword
    });
    if (error) {
      setAuthStatus('Sign-in failed');
      return;
    }
    setAuthStatus('Signed in');
    await refreshAuthStatus();
  };

  const handleSignUp = async () => {
    const client = getSupabase(settings);
    if (!client) return;
    if (!authEmail || !authPassword) {
      setAuthStatus('Enter email and password');
      return;
    }
    setAuthStatus('Creating account...');
    const { error } = await client.auth.signUp({
      email: authEmail,
      password: authPassword
    });
    if (error) {
      setAuthStatus('Sign-up failed');
      return;
    }
    setAuthStatus('Account created. Check email to confirm.');
  };

  const handleSignOut = async () => {
    const client = getSupabase(settings);
    if (!client) return;
    await client.auth.signOut();
    await refreshAuthStatus();
  };

  const handleAccountSave = async () => {
    if (!editingAccount || !editingAccount.name) return;
    const acc = { ...editingAccount as Account, updated_at: Date.now() };
    const exists = settings.accounts.find(a => a.id === acc.id);
    const list = exists
      ? settings.accounts.map(a => a.id === acc.id ? acc : a)
      : [...settings.accounts, acc];
    await updateSettings({ accounts: list });
    setEditingAccount(null);
  };

  const handleAccountDelete = async (id: string) => {
    if (!confirm('Warning: Deleting an account will NOT delete associated transactions, but they may become orphaned. Continue?')) return;
    await updateSettings({ accounts: settings.accounts.filter(a => a.id !== id) });
  };

  const handleRecurringSave = async () => {
    if (!editingRecurring || !editingRecurring.name) return;
    const updated = { ...editingRecurring, updated_at: Date.now() };
    const exists = settings.recurring_items.find(item => item.id === updated.id);
    const list = exists
      ? settings.recurring_items.map(item => item.id === updated.id ? updated : item)
      : [...settings.recurring_items, updated];
    await updateSettings({ recurring_items: list });
    setEditingRecurring(null);
  };

  const handleRecurringDelete = async (id: string) => {
    await updateSettings({ recurring_items: settings.recurring_items.filter(item => item.id !== id) });
    if (currentSnapshot?.month_setup) {
      const filtered = currentSnapshot.month_setup.variable_overrides.filter(o => o.item_id !== id);
      const updatedSnapshot = { ...currentSnapshot, month_setup: { ...currentSnapshot.month_setup, variable_overrides: filtered }, updated_at: Date.now(), schema_version: 6 };
      await storage.upsertMonth(updatedSnapshot);
      refreshSnapshot();
    }
  };

  const handleCategorySave = async () => {
    if (!editingCategory || !editingCategory.name) return;
    const cat = { ...editingCategory as Category, updated_at: Date.now() };
    const exists = settings.categories.find(c => c.id === cat.id);
    const list = exists
      ? settings.categories.map(c => c.id === cat.id ? cat : c)
      : [...settings.categories, cat];
    await updateSettings({ categories: list });
    setEditingCategory(null);
  };

  const handleCategoryDelete = async (id: string) => {
    if (!confirm('Delete this category? Transactions using it will lose their category label.')) return;
    await updateSettings({ categories: settings.categories.filter(c => c.id !== id) });
  };

  const handleLoanSave = async () => {
    if (!editingLoan || !editingLoan.name) return;
    const loan = {
      ...editingLoan as Loan,
      origination_date: editingLoan.origination_date || '',
      original_principal: Number(editingLoan.original_principal) || 0,
      current_balance: Number(editingLoan.current_balance) || 0,
      interest_rate: Number(editingLoan.interest_rate) || 0,
      maturity_date: editingLoan.maturity_date || '',
      payment_history: editingLoan.payment_history || [],
      updated_at: Date.now()
    };
    const exists = settings.loans.find(l => l.id === loan.id);
    const list = exists
      ? settings.loans.map(l => l.id === loan.id ? loan : l)
      : [...settings.loans, loan];
    await updateSettings({ loans: list });
    setEditingLoan(null);
  };

  const handleLoanDelete = async (id: string) => {
    if (!confirm('Delete this loan?')) return;
    await updateSettings({ loans: settings.loans.filter(l => l.id !== id) });
  };

  const formatTypeLabel = (type: RecurringItemType) => {
    if (type === 'income') return 'Income';
    if (type === 'transfer') return 'Transfer';
    return 'Expense';
  };

  const sortedAccounts = [...settings.accounts].sort((a, b) => {
    let result = 0;
    if (accountSortKey === 'name') {
      result = a.name.localeCompare(b.name);
    } else if (accountSortKey === 'type') {
      result = a.type.localeCompare(b.type);
    } else {
      result = Number(a.included_in_cash_forecast) - Number(b.included_in_cash_forecast);
    }
    if (result === 0) {
      result = a.name.localeCompare(b.name);
    }
    return accountSortDir === 'asc' ? result : -result;
  });
  const sortedCategories = [...settings.categories].sort((a, b) => a.name.localeCompare(b.name));
  const sortedLoans = [...settings.loans].sort((a, b) => a.name.localeCompare(b.name));
  const incomeCategories = sortedCategories.filter(c => c.type === 'income');
  const expenseCategories = sortedCategories.filter(c => c.type === 'expense');
  const cashAccounts = sortedAccounts.filter(acc => acc.type !== 'loan');
  const accountsById = new Map(sortedAccounts.map((acc) => [acc.id, acc]));
  const sortedRecurringItems = [...settings.recurring_items].sort((a, b) => {
    const getAccountName = (item: RecurringItem) => accountsById.get(item.account_id || '')?.name || '';
    let result = 0;
    if (recurringSortKey === 'name') {
      result = a.name.localeCompare(b.name);
    } else if (recurringSortKey === 'cadence') {
      result = a.cadence.localeCompare(b.cadence);
    } else if (recurringSortKey === 'day_rule') {
      result = a.day_rule.localeCompare(b.day_rule);
    } else if (recurringSortKey === 'default_amount') {
      result = a.default_amount - b.default_amount;
    } else if (recurringSortKey === 'type') {
      result = a.type.localeCompare(b.type);
    } else {
      result = getAccountName(a).localeCompare(getAccountName(b));
    }
    if (result === 0) {
      result = a.name.localeCompare(b.name);
    }
    return recurringSortDir === 'asc' ? result : -result;
  });

  const handleAccountSort = (key: 'name' | 'type' | 'included_in_cash_forecast') => {
    setAccountSortDir((prevDir) => (accountSortKey === key ? (prevDir === 'asc' ? 'desc' : 'asc') : 'asc'));
    setAccountSortKey(key);
  };

  const getAccountSortIndicator = (key: 'name' | 'type' | 'included_in_cash_forecast') => {
    if (accountSortKey !== key) return '';
    return accountSortDir === 'asc' ? ' ^' : ' v';
  };

  const handleRecurringSort = (key: 'name' | 'cadence' | 'day_rule' | 'default_amount' | 'type' | 'account') => {
    setRecurringSortDir((prevDir) => (recurringSortKey === key ? (prevDir === 'asc' ? 'desc' : 'asc') : 'asc'));
    setRecurringSortKey(key);
  };

  const getRecurringSortIndicator = (key: 'name' | 'cadence' | 'day_rule' | 'default_amount' | 'type' | 'account') => {
    if (recurringSortKey !== key) return '';
    return recurringSortDir === 'asc' ? ' ^' : ' v';
  };

  const handleAmountKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.currentTarget.blur();
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-20">
      <div>
        <h2 className="text-3xl font-extrabold text-slate-900">Settings</h2>
        <p className="text-slate-500">Configure your local and cloud sync options</p>
      </div>

      <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-6">
        <h3 className="text-lg font-bold text-slate-800 border-b pb-2">Supabase Sync (Optional)</h3>
        <div className="space-y-4">
          <div className="flex items-center space-x-2">
            <input 
              type="checkbox"
              id="supabase_toggle"
              checked={settings.supabase_enabled}
              onChange={(e) => updateSettings({ supabase_enabled: e.target.checked })}
              className="w-4 h-4 rounded text-blue-600"
            />
            <label htmlFor="supabase_toggle" className="text-sm font-medium text-slate-700 font-bold">Enable Cloud Sync</label>
          </div>
          
          {settings.supabase_enabled && (
            <>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">Supabase URL</label>
                <input 
                  type="text"
                  value={settings.supabase_url || ''}
                  onChange={(e) => updateSettings({ supabase_url: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="https://your-id.supabase.co"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">Supabase Anon Key</label>
                <input 
                  type="password"
                  value={settings.supabase_anon_key || ''}
                  onChange={(e) => updateSettings({ supabase_anon_key: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="eyJhbGciOi..."
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase">Email + Password Sign-In</label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <input
                    type="email"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg"
                    placeholder="you@example.com"
                  />
                  <input
                    type="password"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg"
                    placeholder="Password"
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={handleSignIn} variant="primary">
                    Sign In
                  </Button>
                  <Button onClick={handleSignUp} variant="secondary">
                    Sign Up
                  </Button>
                  <Button onClick={handleSignOut} variant="dangerGhost" size="sm">
                    Sign out
                  </Button>
                </div>
                <div className="text-xs text-slate-500">Auth status: <span className="font-bold">{authStatus}</span></div>
              </div>
              <div className="flex items-center gap-4">
                <Button onClick={handleSyncNow} variant="primary">
                  Sync Month Now
                </Button>
                <span className="text-xs text-slate-500">Status: <span className="font-bold">{syncStatus}</span></span>
              </div>
              <div className="p-4 bg-blue-50 text-blue-800 rounded-lg text-xs">
                <p className="font-bold mb-1">SQL Tables Required:</p>
                <code className="block whitespace-pre overflow-x-auto p-2 bg-blue-100 rounded">
{`CREATE TABLE IF NOT EXISTS months (
  user_id UUID REFERENCES auth.users NOT NULL,
  month_id TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, month_id)
);

CREATE TABLE IF NOT EXISTS settings (
  user_id UUID REFERENCES auth.users NOT NULL,
  settings JSONB NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (user_id)
);

CREATE TABLE IF NOT EXISTS tax_tables (
  user_id UUID REFERENCES auth.users NOT NULL,
  tax_year INT NOT NULL,
  tax_table JSONB NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, tax_year)
);`}
                </code>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-6">
        <h3 className="text-lg font-bold text-slate-800 border-b pb-2">General Preferences</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-500 uppercase">Preferred Currency</label>
            <select 
              value={settings.preferred_currency}
              onChange={(e) => updateSettings({ preferred_currency: e.target.value })}
              className="w-full px-3 py-2 border rounded-lg bg-slate-50"
            >
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
              <option value="GBP">GBP (£)</option>
              <option value="JPY">JPY (¥)</option>
            </select>
          </div>
          <div className="flex items-center space-x-2 pt-6">
            <input 
              type="checkbox"
              id="autosave"
              checked={settings.autosave_enabled}
              onChange={(e) => updateSettings({ autosave_enabled: e.target.checked })}
              className="w-4 h-4 rounded text-blue-600"
            />
            <label htmlFor="autosave" className="text-sm font-medium text-slate-700">Autosave enabled</label>
          </div>
        </div>
      </section>

      <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-6">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-bold text-slate-800">Accounts (Global)</h3>
          <Button
            onClick={() => setEditingAccount({
              id: crypto.randomUUID(),
              name: '',
              type: 'checking',
              included_in_cash_forecast: true,
              created_at: Date.now(),
              updated_at: Date.now()
            })}
            variant="primary"
          >
            Add Account
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2 font-bold">
                  <button
                    type="button"
                    onClick={() => handleAccountSort('name')}
                    className="text-left font-bold hover:text-slate-700 select-none"
                  >
                    Account{getAccountSortIndicator('name')}
                  </button>
                </th>
                <th className="px-4 py-2 font-bold">
                  <button
                    type="button"
                    onClick={() => handleAccountSort('type')}
                    className="text-left font-bold hover:text-slate-700 select-none"
                  >
                    Type{getAccountSortIndicator('type')}
                  </button>
                </th>
                <th className="px-4 py-2 font-bold">
                  <button
                    type="button"
                    onClick={() => handleAccountSort('included_in_cash_forecast')}
                    className="text-left font-bold hover:text-slate-700 select-none"
                  >
                    In Forecast?{getAccountSortIndicator('included_in_cash_forecast')}
                  </button>
                </th>
                <th className="px-4 py-2 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedAccounts.map(acc => (
                <tr key={acc.id} className="hover:bg-slate-50 transition">
                  <td className="px-4 py-2 font-semibold text-slate-800">{acc.name}</td>
                  <td className="px-4 py-2 capitalize">{acc.type}</td>
                  <td className="px-4 py-2">{acc.included_in_cash_forecast ? 'Yes' : 'No'}</td>
                  <td className="px-4 py-2 text-right space-x-2">
                    <Button onClick={() => setEditingAccount(acc)} variant="secondary" size="sm">Edit</Button>
                    <Button onClick={() => handleAccountDelete(acc.id)} variant="danger" size="sm">Delete</Button>
                  </td>
                </tr>
              ))}
              {settings.accounts.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-400 italic">
                    No accounts yet. Add one to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-6">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-bold text-slate-800">Recurring Items (Defaults)</h3>
          <Button
            onClick={() => {
              const now = Date.now();
              setEditingRecurring({
                id: crypto.randomUUID(),
                name: '',
                category_id: expenseCategories[0]?.id || '',
                account_id: cashAccounts[0]?.id || '',
                loan_id: undefined,
                cadence: 'monthly',
                default_amount: 0,
                day_rule: '1',
                type: 'expense',
                enabled: true,
                anchor_date: `${currentSnapshot?.id || new Date().toISOString().slice(0, 7)}-01`,
                created_at: now,
                updated_at: now
              });
            }}
            variant="primary"
          >
            Add Recurring Item
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2 font-bold">
                  <button
                    type="button"
                    onClick={() => handleRecurringSort('name')}
                    className="text-left font-bold hover:text-slate-700 select-none"
                  >
                    Item{getRecurringSortIndicator('name')}
                  </button>
                </th>
                <th className="px-4 py-2 font-bold">
                  <button
                    type="button"
                    onClick={() => handleRecurringSort('cadence')}
                    className="text-left font-bold hover:text-slate-700 select-none"
                  >
                    Cadence{getRecurringSortIndicator('cadence')}
                  </button>
                </th>
                <th className="px-4 py-2 font-bold">
                  <button
                    type="button"
                    onClick={() => handleRecurringSort('day_rule')}
                    className="text-left font-bold hover:text-slate-700 select-none"
                  >
                    Day Rule{getRecurringSortIndicator('day_rule')}
                  </button>
                </th>
                <th className="px-4 py-2 font-bold">
                  <button
                    type="button"
                    onClick={() => handleRecurringSort('account')}
                    className="text-left font-bold hover:text-slate-700 select-none"
                  >
                    Account{getRecurringSortIndicator('account')}
                  </button>
                </th>
                <th className="px-4 py-2 font-bold">
                  <button
                    type="button"
                    onClick={() => handleRecurringSort('default_amount')}
                    className="text-left font-bold hover:text-slate-700 select-none"
                  >
                    Default{getRecurringSortIndicator('default_amount')}
                  </button>
                </th>
                <th className="px-4 py-2 font-bold">
                  <button
                    type="button"
                    onClick={() => handleRecurringSort('type')}
                    className="text-left font-bold hover:text-slate-700 select-none"
                  >
                    Type{getRecurringSortIndicator('type')}
                  </button>
                </th>
                <th className="px-4 py-2 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedRecurringItems.map(item => (
                <tr key={item.id} className="hover:bg-slate-50 transition">
                  <td className="px-4 py-2 font-semibold text-slate-800">{item.name}</td>
                  <td className="px-4 py-2 capitalize">{item.cadence}</td>
                  <td className="px-4 py-2">{item.day_rule}</td>
                  <td className="px-4 py-2">{accountsById.get(item.account_id || '')?.name || '-'}</td>
                  <td className="px-4 py-2">{item.default_amount.toFixed(2)}</td>
                  <td className="px-4 py-2">{formatTypeLabel(item.type)}</td>
                  <td className="px-4 py-2 text-right space-x-2">
                    <Button onClick={() => setEditingRecurring(item)} variant="secondary" size="sm">Edit</Button>
                    <Button onClick={() => handleRecurringDelete(item.id)} variant="danger" size="sm">Delete</Button>
                  </td>
                </tr>
              ))}
              {settings.recurring_items.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-400 italic">
                    No recurring items yet. Add one to define defaults.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-6">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-bold text-slate-800">Categories (Global)</h3>
          <Button
            onClick={() => setEditingCategory({
              id: crypto.randomUUID(),
              name: '',
              type: 'expense',
              created_at: Date.now(),
              updated_at: Date.now()
            })}
            variant="primary"
          >
            Add Category
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2 font-bold">Category</th>
                <th className="px-4 py-2 font-bold">Type</th>
                <th className="px-4 py-2 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedCategories.map(cat => (
                <tr key={cat.id} className="hover:bg-slate-50 transition">
                  <td className="px-4 py-2 font-semibold text-slate-800">{cat.name}</td>
                  <td className="px-4 py-2 capitalize">{cat.type}</td>
                  <td className="px-4 py-2 text-right space-x-2">
                    <Button onClick={() => setEditingCategory(cat)} variant="secondary" size="sm">Edit</Button>
                    <Button onClick={() => handleCategoryDelete(cat.id)} variant="danger" size="sm">Delete</Button>
                  </td>
                </tr>
              ))}
              {settings.categories.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-slate-400 italic">
                    No categories yet. Add one to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-6">
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-bold text-slate-800">Loans</h3>
          <Button
            onClick={() => setEditingLoan({
              id: crypto.randomUUID(),
              name: '',
              origination_date: '',
              original_principal: 0,
              current_balance: 0,
              interest_rate: 0,
              maturity_date: '',
              payment_history: [],
              created_at: Date.now(),
              updated_at: Date.now()
            })}
            variant="primary"
          >
            Add Loan
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2 font-bold">Loan</th>
                <th className="px-4 py-2 font-bold">Balance</th>
                <th className="px-4 py-2 font-bold">Original</th>
                <th className="px-4 py-2 font-bold">APR</th>
                <th className="px-4 py-2 font-bold">Maturity</th>
                <th className="px-4 py-2 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedLoans.map(loan => (
                <tr key={loan.id} className="hover:bg-slate-50 transition">
                  <td className="px-4 py-2 font-semibold text-slate-800">{loan.name}</td>
                  <td className="px-4 py-2">{loan.current_balance.toFixed(2)}</td>
                  <td className="px-4 py-2">{loan.original_principal?.toFixed(2) || '-'}</td>
                  <td className="px-4 py-2">{loan.interest_rate.toFixed(2)}%</td>
                  <td className="px-4 py-2">{loan.maturity_date || '-'}</td>
                  <td className="px-4 py-2 text-right space-x-2">
                    <Button onClick={() => setEditingLoan(loan)} variant="secondary" size="sm">Edit</Button>
                    <Button onClick={() => handleLoanDelete(loan.id)} variant="danger" size="sm">Delete</Button>
                  </td>
                </tr>
              ))}
              {sortedLoans.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-slate-400 italic">
                    No loans yet. Add one to track balances.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-6">
        <h3 className="text-lg font-bold text-slate-800 border-b pb-2">Backup & Maintenance</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Button
            onClick={handleExport}
            variant="secondary"
            className="w-full py-3 rounded-xl"
          >
            Export All (JSON)
          </Button>
          <label className="w-full py-3 bg-slate-100 text-slate-700 rounded-xl font-bold hover:bg-slate-200 transition text-center cursor-pointer">
            Import Data
            <input type="file" className="hidden" accept=".json" onChange={handleImport} />
          </label>
        </div>
        <Button
          onClick={handleReset}
          variant="danger"
          className="w-full py-3 rounded-xl"
        >
          Reset Local Database
        </Button>
      </section>

      {editingAccount && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4">
            <h3 className="text-xl font-bold">{editingAccount.id ? 'Edit Account' : 'New Account'}</h3>
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">Account Name</label>
                <input 
                  type="text"
                  value={editingAccount.name}
                  onChange={(e) => setEditingAccount({ ...editingAccount, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="e.g. Chase Total Checking"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">Type</label>
                <select 
                   value={editingAccount.type}
                   onChange={(e) => setEditingAccount({ ...editingAccount, type: e.target.value as AccountType })}
                   className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="checking">Checking</option>
                  <option value="savings">Savings</option>
                  <option value="investment">Investment</option>
                  <option value="loan">Loan</option>
                </select>
              </div>
              <div className="flex items-center space-x-2">
                <input 
                  type="checkbox"
                  id="in_forecast_settings"
                  checked={editingAccount.included_in_cash_forecast}
                  onChange={(e) => setEditingAccount({ ...editingAccount, included_in_cash_forecast: e.target.checked })}
                  className="w-4 h-4 rounded text-blue-600"
                />
                <label htmlFor="in_forecast_settings" className="text-sm font-medium text-slate-700">Include in Cash Forecast Total</label>
              </div>
            </div>
            <div className="flex justify-end space-x-3 pt-4">
              <Button onClick={() => setEditingAccount(null)} variant="secondary">Cancel</Button>
              <Button onClick={handleAccountSave} variant="primary">Save</Button>
            </div>
          </div>
        </div>
      )}

      {editingCategory && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4">
            <h3 className="text-xl font-bold">{editingCategory.id ? 'Edit Category' : 'New Category'}</h3>
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">Category Name</label>
                <input 
                  type="text"
                  value={editingCategory.name}
                  onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="e.g. Utilities"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">Type</label>
                <select 
                   value={editingCategory.type}
                   onChange={(e) => setEditingCategory({ ...editingCategory, type: e.target.value as CategoryType })}
                   className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="income">Income</option>
                  <option value="expense">Expense</option>
                  <option value="transfer">Transfer</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end space-x-3 pt-4">
              <Button onClick={() => setEditingCategory(null)} variant="secondary">Cancel</Button>
              <Button onClick={handleCategorySave} variant="primary">Save</Button>
            </div>
          </div>
        </div>
      )}

      {editingLoan && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4">
            <h3 className="text-xl font-bold">{editingLoan.id ? 'Edit Loan' : 'New Loan'}</h3>
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">Loan Name</label>
                <input 
                  type="text"
                  value={editingLoan.name}
                  onChange={(e) => setEditingLoan({ ...editingLoan, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="e.g. Mortgage"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">Origination Date</label>
                <input 
                  type="date"
                  value={editingLoan.origination_date}
                  onChange={(e) => setEditingLoan({ ...editingLoan, origination_date: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">Original Principal</label>
                <input 
                  type="number"
                  value={editingLoan.original_principal}
                  onChange={(e) => setEditingLoan({ ...editingLoan, original_principal: Number(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">Current Balance</label>
                <input 
                  type="number"
                  value={editingLoan.current_balance}
                  onChange={(e) => setEditingLoan({ ...editingLoan, current_balance: Number(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">Interest Rate (APR %)</label>
                <input 
                  type="number"
                  step="0.01"
                  value={editingLoan.interest_rate}
                  onChange={(e) => setEditingLoan({ ...editingLoan, interest_rate: Number(e.target.value) })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">Maturity Date</label>
                <input 
                  type="date"
                  value={editingLoan.maturity_date}
                  onChange={(e) => setEditingLoan({ ...editingLoan, maturity_date: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
            </div>
            <div className="flex justify-end space-x-3 pt-4">
              <Button onClick={() => setEditingLoan(null)} variant="secondary">Cancel</Button>
              <Button onClick={handleLoanSave} variant="primary">Save</Button>
            </div>
          </div>
        </div>
      )}

      {editingRecurring && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 space-y-4">
            <h3 className="text-xl font-bold">Recurring Item</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1 md:col-span-2">
                <label className="text-xs font-bold text-slate-500 uppercase">Name</label>
                <input
                  type="text"
                  value={editingRecurring.name}
                  onChange={(e) => setEditingRecurring({ ...editingRecurring, name: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">Cadence</label>
                <select
                  value={editingRecurring.cadence}
                  onChange={(e) => setEditingRecurring({ ...editingRecurring, cadence: e.target.value as RecurringItem['cadence'] })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Biweekly</option>
                  <option value="semimonthly">Semi-monthly</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">Day Rule</label>
                <input
                  type="text"
                  value={editingRecurring.day_rule}
                  onChange={(e) => setEditingRecurring({ ...editingRecurring, day_rule: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="1, 15, last"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">Default Amount</label>
                <input
                  type="number"
                  value={editingRecurring.default_amount}
                  onChange={(e) => setEditingRecurring({ ...editingRecurring, default_amount: Number(e.target.value) })}
                  onKeyDown={handleAmountKeyDown}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">Type</label>
                <select
                  value={editingRecurring.type}
                  onChange={(e) => setEditingRecurring({ ...editingRecurring, type: e.target.value as RecurringItemType })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="income">Income</option>
                  <option value="expense">Expense</option>
                  <option value="transfer">Transfer</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">Anchor Date</label>
                <input
                  type="date"
                  value={editingRecurring.anchor_date || `${currentSnapshot?.id || new Date().toISOString().slice(0, 7)}-01`}
                  onChange={(e) => setEditingRecurring({ ...editingRecurring, anchor_date: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">Account</label>
                <select
                  value={editingRecurring.account_id}
                  onChange={(e) => setEditingRecurring({ ...editingRecurring, account_id: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  {cashAccounts.map(acc => (
                    <option key={acc.id} value={acc.id}>{acc.name}</option>
                  ))}
                </select>
              </div>
              {editingRecurring.type === 'transfer' && (
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-500 uppercase">Transfer To</label>
                  <select
                    value={editingRecurring.transfer_account_id || ''}
                    onChange={(e) => setEditingRecurring({ ...editingRecurring, transfer_account_id: e.target.value || undefined })}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="">Select account</option>
                    {sortedAccounts.map(acc => (
                      <option key={acc.id} value={acc.id}>{acc.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">Category</label>
                <select
                  value={editingRecurring.category_id}
                  onChange={(e) => setEditingRecurring({ ...editingRecurring, category_id: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  {[...incomeCategories, ...expenseCategories].map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-500 uppercase">Loan (Optional)</label>
                <select
                  value={editingRecurring.loan_id || ''}
                  onChange={(e) => setEditingRecurring({ ...editingRecurring, loan_id: e.target.value || undefined })}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="">None</option>
                  {sortedLoans.map(loan => (
                    <option key={loan.id} value={loan.id}>{loan.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center space-x-2 md:col-span-2">
                <input
                  type="checkbox"
                  checked={editingRecurring.enabled}
                  onChange={(e) => setEditingRecurring({ ...editingRecurring, enabled: e.target.checked })}
                  className="w-4 h-4"
                />
                <label className="text-sm font-medium text-slate-700">Enabled</label>
              </div>
            </div>
            <div className="flex justify-end space-x-3 pt-4 border-t">
              <Button onClick={() => setEditingRecurring(null)} variant="secondary">Cancel</Button>
              <Button onClick={handleRecurringSave} variant="primary">Save</Button>
            </div>
          </div>
        </div>
      )}

      <div className="text-center py-4">
        <p className="text-xs text-slate-400">CashForecaster Framework v1.0.0 • Local-First</p>
      </div>
    </div>
  );
};

export default SettingsPage;
