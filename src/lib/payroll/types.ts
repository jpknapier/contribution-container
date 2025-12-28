export type FilingStatus = 'single' | 'married_joint' | 'head_of_household';
export type PayCycle = 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';
export type ContributionMode = 'percent' | 'fixed_per_paycheck';
export type BonusWithholdingMethod = 'supplemental_flat' | 'regular_annualized';

export interface Payroll401kSettings {
  enabled: boolean;
  contribution_mode: ContributionMode;
  contribution_value: number;
  enforce_annual_max: boolean;
  catch_up_enabled: boolean;
  catch_up_amount_override?: number;
}

export interface PayrollBenefitsSettings {
  pre_tax_benefits_per_paycheck: number;
  post_tax_deductions_per_paycheck: number;
}

export interface PayrollFicaSettings {
  include_fica: boolean;
  ss_wage_base_override?: number;
  additional_medicare_threshold_override?: number;
}

export interface BonusEvent {
  id: string;
  date: string; // YYYY-MM-DD
  gross_amount: number;
  method: BonusWithholdingMethod;
  description?: string;
}

export interface PayrollSettings {
  tax_year: number;
  filing_status: FilingStatus;
  pay_cycle: PayCycle;
  paycheck_anchor_date?: string;
  paycheck_category_id?: string;
  salary_annual: number;
  dependents_count: number;
  dependent_credit_override?: number;
  other_income_annual?: number;
  deductions_annual?: number;
  extra_withholding_per_paycheck?: number;
  state_withholding_flat_rate?: number;
  '401k': Payroll401kSettings;
  benefits: PayrollBenefitsSettings;
  fica: PayrollFicaSettings;
  bonus_events: BonusEvent[];
}

export interface TaxBracket {
  lowerBound: number;
  upperBound: number | null;
  rate: number;
}

export interface DependentCreditRule {
  per_dependent_credit_amount: number;
}

export interface FicaConfig {
  ss_rate: number;
  medicare_rate: number;
  ss_wage_base: number;
  additional_medicare_rate: number;
  additional_medicare_threshold: number | Record<FilingStatus, number>;
}

export interface RetirementLimits {
  k401_employee_max: number;
  k401_catch_up_max: number;
}

export interface TaxTableSet {
  tax_year: number;
  schema_version: number;
  updated_at?: number;
  federal_income_tax_brackets: Record<FilingStatus, TaxBracket[]>;
  standard_deduction: Record<FilingStatus, number>;
  dependent_credit: DependentCreditRule;
  federal_supplemental_withholding_rate?: number;
  fica: FicaConfig;
  retirement: RetirementLimits;
  state_tables?: Record<string, unknown>;
}
