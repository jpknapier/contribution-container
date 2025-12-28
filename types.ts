
import { PayrollSettings } from './src/lib/payroll/types';

export type AccountType = 'checking' | 'savings' | 'investment' | 'loan';
export type CategoryType = 'income' | 'expense' | 'transfer';
export type RecurringCadence = 'monthly' | 'weekly' | 'biweekly' | 'semimonthly';
export type RecurringItemType = 'income' | 'expense' | 'transfer';
export type PaycheckSchedule = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  included_in_cash_forecast: boolean;
  created_at: number;
  updated_at: number;
}

export interface Category {
  id: string;
  name: string;
  type: CategoryType;
  created_at: number;
  updated_at: number;
}

export interface Transaction {
  id: string;
  date: string; // ISO format YYYY-MM-DD
  amount: number; // Positive = Inflow, Negative = Outflow
  account_id: string;
  transfer_account_id?: string;
  transaction_type?: 'income' | 'expense' | 'transfer';
  category_id: string;
  description: string;
  notes?: string;
  loan_id?: string;
  created_at: number;
  updated_at: number;
  source?: 'generated' | 'manual';
  source_item_id?: string;
  generated_batch_id?: string;
}

export interface StartingBalance {
  account_id: string;
  amount: number;
}

export interface LoanPaymentRecord {
  month_id: string; // YYYY-MM
  amount: number;
  interest_accrued?: number;
  balance_before?: number;
  balance_after?: number;
}

export interface Loan {
  id: string;
  name: string;
  origination_date: string; // YYYY-MM-DD
  original_principal: number;
  current_balance: number;
  interest_rate: number; // APR percent
  maturity_date: string; // YYYY-MM-DD
  payment_history: LoanPaymentRecord[];
  created_at: number;
  updated_at: number;
}

export interface GainLossHistoryEntry {
  month_id: string; // YYYY-MM
  balances: StartingBalance[];
}

export interface InvestmentValuationEntry {
  month_id: string; // YYYY-MM
  valuations: StartingBalance[]; // account_id -> market value
}

export interface RecurringItem {
  id: string;
  name: string;
  category_id: string;
  account_id: string;
  transfer_account_id?: string;
  loan_id?: string;
  cadence: RecurringCadence;
  default_amount: number;
  day_rule: string; // e.g. "1", "15", "last"
  type: RecurringItemType;
  enabled: boolean;
  anchor_date?: string; // YYYY-MM-DD for weekly/biweekly anchoring
  created_at: number;
  updated_at: number;
}

export interface PaycheckEntry {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number;
  is_bonus?: boolean;
  description?: string;
}

export interface PaycheckDepositSplit {
  id: string;
  account_id: string;
  amount: number;
  is_remainder?: boolean;
}

export interface VariableOverride {
  item_id: string;
  amount: number;
}

export interface OneOffAdjustment {
  id: string;
  date: string; // YYYY-MM-DD
  description: string;
  amount: number;
  account_id: string;
  transfer_account_id?: string;
  category_id: string;
  loan_id?: string;
  type: RecurringItemType;
}

export interface MonthSetup {
  paycheck_schedule: PaycheckSchedule;
  paycheck_anchor_date: string;
  paycheck_deposit_splits: PaycheckDepositSplit[];
  paycheck_category_id: string;
  paycheck_default_amount: number;
  paycheck_estimates?: PaycheckEntry[];
  paycheck_overrides: PaycheckEntry[];
  variable_overrides: VariableOverride[];
  one_offs: OneOffAdjustment[];
  last_generated_at: number;
  generation_version: number;
}

export interface MonthSnapshot {
  id: string; // YYYY-MM
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  starting_balances: StartingBalance[];
  schema_version: number;
  month_setup?: MonthSetup;
  updated_at: number;
  device_id: string;
}

export interface AppSettings {
  preferred_currency: string;
  autosave_enabled: boolean;
  last_opened_month: string;
  supabase_enabled: boolean;
  supabase_url?: string;
  supabase_anon_key?: string;
  accounts: Account[];
  categories: Category[];
  recurring_items: RecurringItem[];
  gain_loss_history: GainLossHistoryEntry[];
  investment_valuations: InvestmentValuationEntry[];
  loans: Loan[];
  running_balance_account_order: string[];
  payroll_settings: PayrollSettings;
  last_sync_at?: number;
  updated_at: number;
}

export interface ForecastPoint {
  date: string;
  balances: Record<string, number>; // account_id -> balance
  total_cash: number;
}

export interface ForecastSummary {
  projected_end_balance: number;
  lowest_projected_balance: number;
  lowest_balance_date: string;
}
