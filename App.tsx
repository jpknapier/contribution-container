
import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { HashRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { MonthSnapshot, AppSettings, Account, Category, MonthSetup, StartingBalance } from './types';
import { PayrollSettings } from './src/lib/payroll/types';
import { storage } from './lib/storage';
import { calculateForecast } from './lib/forecasting';
import { roundToCents } from './lib/number';
import Dashboard from './pages/Dashboard';
import MonthDetail from './pages/MonthDetail';
import SettingsPage from './pages/Settings';
import MonthlySetupPage from './pages/MonthlySetup.tsx';
import GainLossPage from './pages/GainLoss.tsx';
import LoanTrackerPage from './pages/LoanTracker.tsx';
import PayrollSettingsPage from './pages/PayrollSettings.tsx';
import TaxTablesPage from './pages/TaxTables.tsx';
import { listTaxTableYears, getTaxTableSet, saveTaxTableSet } from './src/lib/payroll/taxTables';
import { getSupabase, syncMonth, syncSettings, syncTaxTables, fetchRemoteSettings, fetchRemoteMonths, fetchRemoteTaxTables } from './lib/supabase';

interface AppContextType {
  settings: AppSettings;
  currentSnapshot: MonthSnapshot | null;
  setSnapshot: (s: MonthSnapshot) => void;
  saveSnapshot: (s: MonthSnapshot) => Promise<void>;
  saveCurrentSnapshot: () => Promise<void>;
  updateSettings: (s: Partial<AppSettings>) => void;
  isLoading: boolean;
  refreshSnapshot: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used within AppProvider");
  return context;
};

const DEFAULT_SETTINGS: AppSettings = {
  preferred_currency: 'USD',
  autosave_enabled: true,
  last_opened_month: new Date().toISOString().slice(0, 7),
  supabase_enabled: false,
  accounts: [],
  categories: [],
  recurring_items: [],
  gain_loss_history: [],
  investment_valuations: [],
  loans: [],
  running_balance_account_order: [],
  payroll_settings: {
    tax_year: new Date().getFullYear(),
    filing_status: 'single',
    pay_cycle: 'biweekly',
    paycheck_anchor_date: new Date().toISOString().slice(0, 10),
    paycheck_category_id: '',
    salary_annual: 0,
    dependents_count: 0,
    other_income_annual: 0,
    deductions_annual: 0,
    extra_withholding_per_paycheck: 0,
    state_withholding_flat_rate: 0,
    benefits: {
      pre_tax_benefits_per_paycheck: 0,
      post_tax_deductions_per_paycheck: 0,
    },
    fica: {
      include_fica: true,
    },
    '401k': {
      enabled: false,
      contribution_mode: 'percent',
      contribution_value: 0,
      enforce_annual_max: true,
      catch_up_enabled: false,
    },
    bonus_events: [],
  } as PayrollSettings,
  last_sync_at: 0,
  updated_at: Date.now(),
};

const INITIAL_ACCOUNTS: Account[] = [
  { id: 'acc1', name: 'Main Checking', type: 'checking', included_in_cash_forecast: true, created_at: Date.now(), updated_at: Date.now() },
  { id: 'acc2', name: 'Savings', type: 'savings', included_in_cash_forecast: true, created_at: Date.now(), updated_at: Date.now() },
];

const INITIAL_CATEGORIES: Category[] = [
  { id: 'cat0', name: 'Paycheck', type: 'income', created_at: Date.now(), updated_at: Date.now() },
  { id: 'cat1', name: 'Salary', type: 'income', created_at: Date.now(), updated_at: Date.now() },
  { id: 'cat2', name: 'Rent', type: 'expense', created_at: Date.now(), updated_at: Date.now() },
  { id: 'cat3', name: 'Groceries', type: 'expense', created_at: Date.now(), updated_at: Date.now() },
  { id: 'cat4', name: 'Credit Card Payment', type: 'expense', created_at: Date.now(), updated_at: Date.now() },
];

const normalizeAccounts = (accounts: Account[]) => {
  return accounts.map(acc => {
    if ((acc as any).type === 'credit_card') {
      return { ...acc, type: 'loan', included_in_cash_forecast: false } as Account;
    }
    if (acc.type === 'investment') {
      return { ...acc, included_in_cash_forecast: false };
    }
    return acc;
  });
};

const normalizeSettings = (saved: AppSettings | null): AppSettings => {
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    accounts: normalizeAccounts(saved?.accounts || []),
    categories: saved?.categories || [],
    recurring_items: saved?.recurring_items || [],
    gain_loss_history: saved?.gain_loss_history || [],
    investment_valuations: saved?.investment_valuations || [],
    loans: saved?.loans || [],
    running_balance_account_order: saved?.running_balance_account_order || [],
    payroll_settings: saved?.payroll_settings || DEFAULT_SETTINGS.payroll_settings,
    last_sync_at: saved?.last_sync_at || 0,
  };
};

const hasCloudConfig = (settings: AppSettings) => {
  return Boolean(settings.supabase_enabled && settings.supabase_url && settings.supabase_anon_key);
};

const buildDefaultMonthSetup = (
  monthId: string,
  snapshot: MonthSnapshot,
  defaults?: {
    paycheck_schedule?: MonthSetup['paycheck_schedule'];
    paycheck_anchor_date?: string;
    paycheck_category_id?: string;
  }
): MonthSetup => {
  const defaultIncomeCategory = snapshot.categories.find(c => c.type === 'income')?.id || '';
  const defaultDepositAccountId = snapshot.accounts.find(acc => acc.type !== 'loan')?.id || snapshot.accounts[0]?.id || '';
  return {
    paycheck_schedule: defaults?.paycheck_schedule || 'monthly',
    paycheck_anchor_date: defaults?.paycheck_anchor_date || `${monthId}-01`,
    paycheck_deposit_splits: defaultDepositAccountId ? [{
      id: crypto.randomUUID(),
      account_id: defaultDepositAccountId,
      amount: 0
    }] : [],
    paycheck_category_id: defaults?.paycheck_category_id || defaultIncomeCategory,
    paycheck_default_amount: 0,
    paycheck_estimates: [],
    paycheck_overrides: [],
    variable_overrides: [],
    one_offs: [],
    last_generated_at: 0,
    generation_version: 1,
  };
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

const buildStartingBalancesFromPreviousMonth = async (
  monthId: string,
  accounts: Account[],
  categories: Category[]
) => {
  const previousMonthId = getPreviousMonthId(monthId);
  let previousSnapshot = await storage.getMonth(previousMonthId);
  if (!previousSnapshot) {
    const months = await storage.listMonths();
    const fallbackId = months
      .filter(id => id < monthId)
      .sort()
      .at(-1);
    if (fallbackId) {
      previousSnapshot = await storage.getMonth(fallbackId);
    }
  }
  if (!previousSnapshot) {
    return ensureStartingBalances([], accounts);
  }
  const normalizedPrevious = normalizeMonthSnapshot(previousSnapshot, accounts, categories);
  const forecastPoints = calculateForecast(normalizedPrevious);
  if (!forecastPoints.length) {
    return ensureStartingBalances(normalizedPrevious.starting_balances, accounts);
  }
  const lastPoint = forecastPoints[forecastPoints.length - 1];
  return accounts.map(acc => ({
    account_id: acc.id,
    amount: roundToCents(lastPoint.balances[acc.id] ?? 0)
  }));
};

const normalizePaycheckSplits = (monthSetup: MonthSetup | (MonthSetup & { paycheck_deposit_account_id?: string }), accounts: Account[]) => {
  const cashAccounts = accounts.filter(acc => acc.type !== 'loan');
  const fallbackAccountId = cashAccounts[0]?.id || accounts[0]?.id || '';
  const legacyAccountId = monthSetup.paycheck_deposit_account_id || fallbackAccountId;
  let splits = Array.isArray(monthSetup.paycheck_deposit_splits) ? monthSetup.paycheck_deposit_splits : [];
  if (!splits.length && legacyAccountId) {
    splits = [{
      id: crypto.randomUUID(),
      account_id: legacyAccountId,
      amount: 0,
      is_remainder: true
    }];
  }
  const validIds = new Set(cashAccounts.map(acc => acc.id));
  splits = splits
    .map(split => ({
      id: split.id || crypto.randomUUID(),
      account_id: validIds.has(split.account_id) ? split.account_id : fallbackAccountId,
      amount: Number.isFinite(Number(split.amount)) ? Number(split.amount) : 0,
      is_remainder: Boolean(split.is_remainder)
    }))
    .filter(split => split.account_id);
  let remainderAssigned = false;
  splits = splits.map(split => {
    if (!split.is_remainder) return split;
    if (remainderAssigned) {
      return { ...split, is_remainder: false };
    }
    remainderAssigned = true;
    return { ...split, amount: 0 };
  });
  if (!splits.length && fallbackAccountId) {
    splits = [{
      id: crypto.randomUUID(),
      account_id: fallbackAccountId,
      amount: 0,
      is_remainder: true
    }];
  }
  if (!splits.some(split => split.is_remainder) && splits.length === 1) {
    splits = splits.map(split => ({ ...split, is_remainder: true, amount: 0 }));
  }
  return splits;
};

const ensureStartingBalances = (balances: StartingBalance[], accounts: Account[]) => {
  const byId = new Map(balances.map(b => [b.account_id, b.amount]));
  return accounts.map(acc => ({
    account_id: acc.id,
    amount: byId.get(acc.id) ?? 0
  }));
};

const normalizeMonthSnapshot = (snapshot: MonthSnapshot, accounts: Account[], categories: Category[]): MonthSnapshot => {
  const normalized = { ...snapshot };
  normalized.accounts = normalizeAccounts(accounts);
  normalized.categories = categories;
  normalized.starting_balances = ensureStartingBalances(snapshot.starting_balances, accounts);
  if (!normalized.month_setup) {
    normalized.month_setup = buildDefaultMonthSetup(snapshot.id, snapshot);
  }
  if (normalized.month_setup) {
    const incomeCategory = categories.find(c => c.type === 'income')?.id || '';
    if (incomeCategory && !categories.find(c => c.id === normalized.month_setup?.paycheck_category_id)) {
      normalized.month_setup.paycheck_category_id = incomeCategory;
    }
    if (!normalized.month_setup.paycheck_estimates) {
      normalized.month_setup.paycheck_estimates = [];
    }
    normalized.month_setup.paycheck_deposit_splits = normalizePaycheckSplits(normalized.month_setup as MonthSetup, normalized.accounts);
  }
  if (!normalized.schema_version || normalized.schema_version < 6) {
    normalized.schema_version = 6;
  }
  return normalized;
};

const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [currentSnapshot, setCurrentSnapshot] = useState<MonthSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [cloudGate, setCloudGate] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authStatus, setAuthStatus] = useState('');

  const loadCloudData = async (baseSettings: AppSettings) => {
    if (!hasCloudConfig(baseSettings)) return { status: 'disabled' as const };
    const client = getSupabase(baseSettings);
    if (!client) return { status: 'disabled' as const };

    const { data: { user } } = await client.auth.getUser();
    if (!user) return { status: 'auth-required' as const };

    const remoteSettings = await fetchRemoteSettings(baseSettings);
    const remoteMonths = await fetchRemoteMonths(baseSettings);
    const remoteTaxTables = await fetchRemoteTaxTables(baseSettings);
    return { status: 'ok' as const, remoteSettings, remoteMonths, remoteTaxTables };
  };

  const saveSnapshot = async (snapshot: MonthSnapshot, overrideSettings?: AppSettings) => {
    await storage.upsertMonth(snapshot);
    const activeSettings = overrideSettings || settings;
    if (!hasCloudConfig(activeSettings)) return;
    const updated = await syncMonth(snapshot, activeSettings);
    if (updated) {
      const normalized = normalizeMonthSnapshot(updated, activeSettings.accounts, activeSettings.categories);
      setCurrentSnapshot(normalized);
      await storage.upsertMonth(normalized);
    }
  };

  const initData = async () => {
    try {
      await storage.init();
      const savedSettings = await storage.getSettings();
      const monthId = savedSettings?.last_opened_month || DEFAULT_SETTINGS.last_opened_month;
      const existingMonth = await storage.getMonth(monthId);
      let normalizedSettings = normalizeSettings(savedSettings);
      const cloudResult = await loadCloudData(normalizedSettings);
      if (cloudResult.status === 'auth-required') {
        setSettings(normalizedSettings);
        setCloudGate(true);
        setIsLoading(false);
        return;
      }
      if (cloudResult.status === 'ok') {
        let remoteSettings = cloudResult.remoteSettings;
        let remoteMonths = cloudResult.remoteMonths;
        const remoteTaxTables = cloudResult.remoteTaxTables;

        if (!remoteSettings) {
          await syncSettings(normalizedSettings);
          remoteSettings = normalizedSettings;
        }

        if (remoteMonths.length === 0) {
          const localMonthIds = await storage.listMonths();
          if (localMonthIds.length) {
            const localMonths = await Promise.all(localMonthIds.map(id => storage.getMonth(id)));
            for (const local of localMonths) {
              if (local) await syncMonth(local, normalizedSettings);
            }
            remoteMonths = localMonths.filter((m): m is MonthSnapshot => Boolean(m));
          }
        }

        await storage.resetAll();
        const normalizedRemoteSettings = normalizeSettings(remoteSettings);
        setSettings(normalizedRemoteSettings);
        await storage.saveSettings(normalizedRemoteSettings);

        for (const snapshot of remoteMonths) {
          await storage.upsertMonth(snapshot);
        }
        for (const table of remoteTaxTables) {
          await saveTaxTableSet(table);
        }

        const availableMonthIds = remoteMonths.map(m => m.id).sort();
        const targetMonthId = availableMonthIds.includes(normalizedRemoteSettings.last_opened_month)
          ? normalizedRemoteSettings.last_opened_month
          : (availableMonthIds.at(-1) || normalizedRemoteSettings.last_opened_month);
        if (targetMonthId !== normalizedRemoteSettings.last_opened_month) {
          normalizedRemoteSettings.last_opened_month = targetMonthId;
          await storage.saveSettings(normalizedRemoteSettings);
          await syncSettings(normalizedRemoteSettings);
        }

        if (availableMonthIds.length > 0) {
          const snapshot = await storage.getMonth(targetMonthId);
          if (snapshot) {
            const normalized = normalizeMonthSnapshot(snapshot, normalizedRemoteSettings.accounts, normalizedRemoteSettings.categories);
            setCurrentSnapshot(normalized);
            await storage.upsertMonth(normalized);
            setCloudGate(false);
            return;
          }
        }
        const newMonthId = normalizedRemoteSettings.last_opened_month || DEFAULT_SETTINGS.last_opened_month;
        const newMonth: MonthSnapshot = {
          id: newMonthId,
          accounts: normalizedRemoteSettings.accounts,
          categories: normalizedRemoteSettings.categories,
          transactions: [],
          starting_balances: await buildStartingBalancesFromPreviousMonth(newMonthId, normalizedRemoteSettings.accounts, normalizedRemoteSettings.categories),
          schema_version: 6,
          month_setup: buildDefaultMonthSetup(newMonthId, {
            id: newMonthId,
            accounts: normalizedRemoteSettings.accounts,
            categories: normalizedRemoteSettings.categories,
            transactions: [],
            starting_balances: [],
            schema_version: 6,
            updated_at: Date.now(),
            device_id: 'default'
          }, {
            paycheck_schedule: normalizedRemoteSettings.payroll_settings.pay_cycle,
            paycheck_anchor_date: normalizedRemoteSettings.payroll_settings.paycheck_anchor_date || `${newMonthId}-01`,
            paycheck_category_id: normalizedRemoteSettings.payroll_settings.paycheck_category_id || ''
          }),
          updated_at: Date.now(),
          device_id: 'default'
        };
        setCurrentSnapshot(newMonth);
        await saveSnapshot(newMonth, normalizedRemoteSettings);
        setCloudGate(false);
        return;
      }
      if (!normalizedSettings.accounts.length) {
        normalizedSettings = {
          ...normalizedSettings,
          accounts: normalizeAccounts(existingMonth?.accounts?.length ? existingMonth.accounts : INITIAL_ACCOUNTS)
        };
      }
      if (!normalizedSettings.categories.length) {
        normalizedSettings = {
          ...normalizedSettings,
          categories: existingMonth?.categories?.length ? existingMonth.categories : INITIAL_CATEGORIES
        };
      }
      setSettings(normalizedSettings);
      await storage.saveSettings(normalizedSettings);

      if (existingMonth) {
        const normalized = normalizeMonthSnapshot(existingMonth, normalizedSettings.accounts, normalizedSettings.categories);
        setCurrentSnapshot(normalized);
        await saveSnapshot(normalized, normalizedSettings);
      } else {
        const newMonth: MonthSnapshot = {
          id: monthId,
          accounts: normalizedSettings.accounts,
          categories: normalizedSettings.categories,
          transactions: [],
          starting_balances: await buildStartingBalancesFromPreviousMonth(monthId, normalizedSettings.accounts, normalizedSettings.categories),
          schema_version: 6,
          month_setup: buildDefaultMonthSetup(monthId, {
            id: monthId,
            accounts: normalizedSettings.accounts,
            categories: normalizedSettings.categories,
            transactions: [],
            starting_balances: [],
            schema_version: 6,
            updated_at: Date.now(),
            device_id: 'default'
          }, {
            paycheck_schedule: normalizedSettings.payroll_settings.pay_cycle,
            paycheck_anchor_date: normalizedSettings.payroll_settings.paycheck_anchor_date || `${monthId}-01`,
            paycheck_category_id: normalizedSettings.payroll_settings.paycheck_category_id || ''
          }),
          updated_at: Date.now(),
          device_id: 'default'
        };
        setCurrentSnapshot(newMonth);
        await saveSnapshot(newMonth, normalizedSettings);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const loadMonth = async (monthId: string, accountsOverride?: Account[], categoriesOverride?: Category[]) => {
    const accounts = accountsOverride || settings.accounts || INITIAL_ACCOUNTS;
    const categories = categoriesOverride || settings.categories || INITIAL_CATEGORIES;
    const month = await storage.getMonth(monthId);
    if (month) {
      const normalized = normalizeMonthSnapshot(month, accounts, categories);
      setCurrentSnapshot(normalized);
      await saveSnapshot(normalized);
    } else {
      const newMonth: MonthSnapshot = {
        id: monthId,
        accounts: accounts,
        categories: categories,
        transactions: [],
        starting_balances: await buildStartingBalancesFromPreviousMonth(monthId, accounts, categories),
        schema_version: 6,
        month_setup: buildDefaultMonthSetup(monthId, {
          id: monthId,
          accounts: accounts,
          categories: categories,
          transactions: [],
          starting_balances: ensureStartingBalances([], accounts),
          schema_version: 6,
          updated_at: Date.now(),
          device_id: 'default'
        }, {
          paycheck_schedule: settings.payroll_settings.pay_cycle,
          paycheck_anchor_date: settings.payroll_settings.paycheck_anchor_date || `${monthId}-01`,
          paycheck_category_id: settings.payroll_settings.paycheck_category_id || ''
        }),
        updated_at: Date.now(),
        device_id: 'default'
      };
      setCurrentSnapshot(newMonth);
      await saveSnapshot(newMonth);
    }
  };

  const saveCurrentSnapshot = async () => {
    if (currentSnapshot) {
      const updated = { ...currentSnapshot, updated_at: Date.now() };
      await saveSnapshot(updated);
      setCurrentSnapshot(updated);
    }
  };

  const updateSettings = async (newSettings: Partial<AppSettings>) => {
    const updated = { ...settings, ...newSettings, updated_at: Date.now() };
    setSettings(updated);
    await storage.saveSettings(updated);

    let activeSettings = updated;
    if (hasCloudConfig(updated)) {
      const remoteSettings = await syncSettings(updated);
      if (remoteSettings) {
        activeSettings = normalizeSettings(remoteSettings);
        setSettings(activeSettings);
        await storage.saveSettings(activeSettings);
      }
    }

    if ((newSettings.accounts || newSettings.categories) && currentSnapshot) {
      const normalized = normalizeMonthSnapshot(
        currentSnapshot,
        newSettings.accounts || activeSettings.accounts,
        newSettings.categories || activeSettings.categories
      );
      setCurrentSnapshot(normalized);
      await saveSnapshot(normalized);
    }
    if (newSettings.last_opened_month) {
      await loadMonth(newSettings.last_opened_month, activeSettings.accounts, activeSettings.categories);
    }
  };

  useEffect(() => {
    initData();
  }, []);

  const handleCloudSignIn = async () => {
    if (!authEmail || !authPassword) {
      setAuthStatus('Enter email and password.');
      return;
    }
    const client = getSupabase(settings);
    if (!client) {
      setAuthStatus('Supabase not configured.');
      return;
    }
    setAuthStatus('Signing in...');
    const { error } = await client.auth.signInWithPassword({
      email: authEmail,
      password: authPassword
    });
    if (error) {
      setAuthStatus('Sign-in failed.');
      return;
    }
    setAuthStatus('Signed in. Loading data...');
    setCloudGate(false);
    setIsLoading(true);
    await initData();
  };

  const value = useMemo(() => ({
    settings,
    currentSnapshot,
    setSnapshot: setCurrentSnapshot,
    saveSnapshot,
    saveCurrentSnapshot,
    updateSettings,
    isLoading,
    refreshSnapshot: () => { if (currentSnapshot) loadMonth(currentSnapshot.id); }
  }), [settings, currentSnapshot, isLoading, saveSnapshot, updateSettings]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentSnapshot, updateSettings, isLoading, settings } = useApp();
  const location = useLocation();
  const [isSyncing, setIsSyncing] = useState(false);
  const [hasUnsynced, setHasUnsynced] = useState(false);

  const getLatestUpdatedAt = async () => {
    let latest = settings.updated_at || 0;
    const monthIds = await storage.listMonths();
    for (const id of monthIds) {
      const month = await storage.getMonth(id);
      if (month && month.updated_at > latest) {
        latest = month.updated_at;
      }
    }
    const years = await listTaxTableYears();
    for (const year of years) {
      const table = await getTaxTableSet(year);
      if (table && (table.updated_at || 0) > latest) {
        latest = table.updated_at || 0;
      }
    }
    return latest;
  };

  const refreshSyncStatus = async () => {
    const lastSync = settings.last_sync_at || 0;
    if (!lastSync) {
      setHasUnsynced(true);
      return;
    }
    const latest = await getLatestUpdatedAt();
    setHasUnsynced(latest > lastSync);
  };

  useEffect(() => {
    refreshSyncStatus();
  }, [settings.updated_at, currentSnapshot?.updated_at, settings.last_sync_at]);

  const handleSyncAll = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const remoteSettings = await syncSettings(settings);
      if (remoteSettings) {
        await updateSettings(remoteSettings);
      }
      const activeSettings = remoteSettings || settings;
      const monthIds = await storage.listMonths();
      let latestUpdatedAt = Math.max(Date.now(), activeSettings.updated_at || 0);
      for (const id of monthIds) {
        const month = await storage.getMonth(id);
        if (month) {
          const updated = await syncMonth(month, activeSettings);
          if (updated) {
            await storage.upsertMonth(updated);
            latestUpdatedAt = Math.max(latestUpdatedAt, updated.updated_at || 0);
          } else {
            latestUpdatedAt = Math.max(latestUpdatedAt, month.updated_at || 0);
          }
        }
      }
      await syncTaxTables(activeSettings);
      const tablesLatest = await getLatestUpdatedAt();
      latestUpdatedAt = Math.max(latestUpdatedAt, tablesLatest);
      const finalSyncAt = Math.max(Date.now(), latestUpdatedAt);
      await updateSettings({ last_sync_at: finalSyncAt });
      await syncSettings({ ...activeSettings, last_sync_at: finalSyncAt, updated_at: finalSyncAt });
    } finally {
      setIsSyncing(false);
      refreshSyncStatus();
    }
  };

  if (isLoading) return <div className="flex items-center justify-center h-full">Loading storage...</div>;

  return (
    <div className="flex flex-col h-full">
      <header className="bg-slate-800 text-white p-4 shadow-md flex justify-between items-center sticky top-0 z-20">
        <div className="flex items-center space-x-6">
          <h1 className="text-xl font-bold tracking-tight">CashForecast</h1>
          <nav className="hidden md:flex space-x-4">
            <Link to="/" className={`px-2 py-1 rounded transition ${location.pathname === '/' ? 'bg-slate-700' : 'hover:bg-slate-700'}`}>Dashboard</Link>
            <Link to="/month" className={`px-2 py-1 rounded transition ${location.pathname === '/month' ? 'bg-slate-700' : 'hover:bg-slate-700'}`}>Forecast</Link>
            <Link to="/gain-loss" className={`px-2 py-1 rounded transition ${location.pathname === '/gain-loss' ? 'bg-slate-700' : 'hover:bg-slate-700'}`}>Gain/Loss</Link>
            <Link to="/loans" className={`px-2 py-1 rounded transition ${location.pathname === '/loans' ? 'bg-slate-700' : 'hover:bg-slate-700'}`}>Loan Tracker</Link>
            <Link to="/setup" className={`px-2 py-1 rounded transition ${location.pathname === '/setup' ? 'bg-slate-700' : 'hover:bg-slate-700'}`}>Monthly Setup</Link>
            <Link to="/payroll" className={`px-2 py-1 rounded transition ${location.pathname === '/payroll' ? 'bg-slate-700' : 'hover:bg-slate-700'}`}>Payroll</Link>
            <Link to="/tax-tables" className={`px-2 py-1 rounded transition ${location.pathname === '/tax-tables' ? 'bg-slate-700' : 'hover:bg-slate-700'}`}>Tax Tables</Link>
          </nav>
        </div>
        
        <div className="flex items-center space-x-4">
          <input 
            type="month" 
            className="bg-slate-700 text-white px-2 py-1 rounded border border-slate-600 outline-none focus:ring-2 focus:ring-blue-500"
            value={currentSnapshot?.id || ''}
            onChange={(e) => updateSettings({ last_opened_month: e.target.value })}
          />
          <button
            type="button"
            onClick={handleSyncAll}
            title="Sync now"
            className={`w-9 h-9 rounded-full border flex items-center justify-center transition ${
              hasUnsynced ? 'border-red-400 text-red-300 hover:text-red-200' : 'border-green-400 text-green-300 hover:text-green-200'
            } ${isSyncing ? 'opacity-60 cursor-wait' : ''}`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 7h10v10H7z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 7V4h6v3" />
            </svg>
          </button>
          <Link to="/settings" title="Settings">
            <svg className="w-6 h-6 hover:text-blue-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
          </Link>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-4 md:p-8 max-w-7xl mx-auto w-full">
        {children}
      </main>

      <footer className="md:hidden bg-white border-t p-2 fixed bottom-0 left-0 right-0 flex justify-around items-center z-20">
        <Link to="/" className="text-xs flex flex-col items-center text-slate-600">
           <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path></svg>
           Dashboard
        </Link>
        <Link to="/month" className="text-xs flex flex-col items-center text-slate-600">
           <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
           Forecast
        </Link>
        <Link to="/gain-loss" className="text-xs flex flex-col items-center text-slate-600">
           <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8L9 19l-4-4-4 4"></path></svg>
           Gain/Loss
        </Link>
        <Link to="/loans" className="text-xs flex flex-col items-center text-slate-600">
           <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-2.21 0-4 1.79-4 4m4-4c2.21 0 4 1.79 4 4m-4-4v4m0 4a4 4 0 01-4-4m4 4a4 4 0 004-4M3 12h3m12 0h3"></path></svg>
           Loans
        </Link>
        <Link to="/setup" className="text-xs flex flex-col items-center text-slate-600">
           <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
           Setup
        </Link>
        <Link to="/payroll" className="text-xs flex flex-col items-center text-slate-600">
           <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c1.657 0 3-1.343 3-3m-3 3c-1.657 0-3-1.343-3-3m3 3v10m-7-4h14"></path></svg>
           Payroll
        </Link>
        <Link to="/tax-tables" className="text-xs flex flex-col items-center text-slate-600">
           <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4h18v4H3zM3 12h18v8H3z"></path></svg>
           Tax Tables
        </Link>
        <Link to="/settings" className="text-xs flex flex-col items-center text-slate-600">
           <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"></path></svg>
           Settings
        </Link>
      </footer>
    </div>
  );
};

const App: React.FC = () => {
  return (
    <AppProvider>
      <HashRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/month" element={<MonthDetail />} />
            <Route path="/setup" element={<MonthlySetupPage />} />
            <Route path="/gain-loss" element={<GainLossPage />} />
            <Route path="/loans" element={<LoanTrackerPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/payroll" element={<PayrollSettingsPage />} />
            <Route path="/tax-tables" element={<TaxTablesPage />} />
          </Routes>
        </Layout>
      </HashRouter>
    </AppProvider>
  );
};

export default App;
