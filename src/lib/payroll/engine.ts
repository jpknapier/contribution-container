import { calculateFederalWithholding } from './federal/withholding';
import { StateTaxPlugin } from './state';
import { BonusEvent, BonusWithholdingMethod, FilingStatus, PayrollSettings, TaxTableSet } from './types';

export interface PayrollPaycheckResult {
  id: string;
  date: string;
  gross: number;
  k401_contribution: number;
  pre_tax_benefits: number;
  taxable_wages: number;
  federal_withholding: number;
  state_withholding: number;
  ss_withholding: number;
  medicare_withholding: number;
  additional_medicare_withholding: number;
  fica_withholding: number;
  post_tax_deductions: number;
  net: number;
  is_bonus: boolean;
  bonus_method?: BonusWithholdingMethod;
  description?: string;
  ytd: {
    gross: number;
    taxable_wages: number;
    k401_contribution: number;
    ss_wages: number;
    medicare_wages: number;
    federal_withholding: number;
    fica_withholding: number;
    net: number;
  };
}

export interface PayrollEngineResult {
  paychecks: PayrollPaycheckResult[];
}

type PaySchedule = PayrollSettings['pay_cycle'];

const parseDate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const formatDate = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getMonthInfo = (monthId: string) => {
  const [year, month] = monthId.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month - 1, daysInMonth);
  return { year, month, daysInMonth, start, end };
};

const getMonthlyDate = (monthId: string, day: number) => {
  const { daysInMonth } = getMonthInfo(monthId);
  const clamped = Math.min(Math.max(day, 1), daysInMonth);
  return `${monthId}-${clamped.toString().padStart(2, '0')}`;
};

const getDatesByInterval = (start: Date, end: Date, anchorDate: Date, intervalDays: number) => {
  let current = new Date(anchorDate);
  while (current < start) {
    current = new Date(current.getFullYear(), current.getMonth(), current.getDate() + intervalDays);
  }
  const dates: string[] = [];
  while (current <= end) {
    if (current >= start) {
      dates.push(formatDate(current));
    }
    current = new Date(current.getFullYear(), current.getMonth(), current.getDate() + intervalDays);
  }
  return dates;
};

const getPayDatesForMonth = (monthId: string, schedule: PaySchedule, anchorDate: string) => {
  const { start, end, daysInMonth } = getMonthInfo(monthId);
  if (schedule === 'weekly') {
    return getDatesByInterval(start, end, parseDate(anchorDate), 7);
  }
  if (schedule === 'biweekly') {
    return getDatesByInterval(start, end, parseDate(anchorDate), 14);
  }
  if (schedule === 'semimonthly') {
    return [
      `${monthId}-15`,
      `${monthId}-${daysInMonth.toString().padStart(2, '0')}`
    ];
  }
  const anchorDay = parseDate(anchorDate).getDate();
  return [getMonthlyDate(monthId, anchorDay)];
};

const getPayPeriodsPerYear = (schedule: PaySchedule) => {
  if (schedule === 'weekly') return 52;
  if (schedule === 'biweekly') return 26;
  if (schedule === 'semimonthly') return 24;
  return 12;
};

const resolveAdditionalMedicareThreshold = (
  threshold: number | Record<FilingStatus, number>,
  filingStatus: FilingStatus
) => {
  if (typeof threshold === 'number') return threshold;
  return threshold[filingStatus];
};

const buildYearToDatePayDates = (monthId: string, schedule: PaySchedule, anchorDate: string) => {
  const year = monthId.split('-')[0];
  const months = [];
  for (let i = 1; i <= Number(monthId.split('-')[1]); i += 1) {
    months.push(`${year}-${String(i).padStart(2, '0')}`);
  }
  return months.flatMap((id) => getPayDatesForMonth(id, schedule, anchorDate));
};

const buildPayrollEvents = (monthId: string, schedule: PaySchedule, anchorDate: string, bonusEvents: BonusEvent[]) => {
  const payDates = buildYearToDatePayDates(monthId, schedule, anchorDate);
  const regularEvents = payDates.map(date => ({
    id: `regular:${date}`,
    date,
    is_bonus: false as const,
  }));
  const bonusEventsInRange = bonusEvents
    .filter(event => event.date.slice(0, 7) <= monthId)
    .map(event => ({
      id: `bonus:${event.id}`,
      date: event.date,
      is_bonus: true as const,
      bonus_method: event.method,
      description: event.description || 'Bonus',
      gross_override: event.gross_amount
    }));
  return [...regularEvents, ...bonusEventsInRange].sort((a, b) => {
    if (a.date === b.date) {
      if (a.is_bonus === b.is_bonus) return 0;
      return a.is_bonus ? 1 : -1;
    }
    return a.date.localeCompare(b.date);
  });
};

export const calculatePayrollForMonth = ({
  monthId,
  schedule,
  anchorDate,
  payrollSettings,
  taxTables,
  stateWithholding,
}: {
  monthId: string;
  schedule: PaySchedule;
  anchorDate: string;
  payrollSettings: PayrollSettings;
  taxTables: TaxTableSet;
  stateWithholding?: StateTaxPlugin;
}): PayrollEngineResult => {
  const payPeriodsPerYear = getPayPeriodsPerYear(schedule);
  const grossPerPaycheck = payrollSettings.salary_annual / payPeriodsPerYear;
  const events = buildPayrollEvents(monthId, schedule, anchorDate, payrollSettings.bonus_events || []);

  let ytdGross = 0;
  let ytdTaxable = 0;
  let ytd401k = 0;
  let ytdSsWages = 0;
  let ytdMedicareWages = 0;
  let ytdFederal = 0;
  let ytdFica = 0;
  let ytdNet = 0;

  const results: PayrollPaycheckResult[] = [];

  events.forEach(event => {
    const isBonus = event.is_bonus;
    const gross = isBonus ? (event.gross_override ?? 0) : grossPerPaycheck;
    const k401Settings = payrollSettings['401k'];
    const k401Max = taxTables.retirement.k401_employee_max
      + (k401Settings.catch_up_enabled
        ? (k401Settings.catch_up_amount_override ?? taxTables.retirement.k401_catch_up_max)
        : 0);

    let k401Contribution = 0;
    if (k401Settings.enabled && !isBonus) {
      const desired = k401Settings.contribution_mode === 'percent'
        ? gross * (k401Settings.contribution_value / 100)
        : k401Settings.contribution_value;
      if (k401Settings.enforce_annual_max) {
        const remaining = Math.max(0, k401Max - ytd401k);
        k401Contribution = Math.min(desired, remaining);
      } else {
        k401Contribution = desired;
      }
    }

    const preTaxBenefits = isBonus ? 0 : payrollSettings.benefits.pre_tax_benefits_per_paycheck;
    const taxableWages = Math.max(0, gross - k401Contribution - preTaxBenefits);

    const standardDeduction = taxTables.standard_deduction[payrollSettings.filing_status];
    const deductionsAnnual = payrollSettings.deductions_annual || 0;
    const otherIncomeAnnual = payrollSettings.other_income_annual || 0;
    const extraWithholding = isBonus ? 0 : (payrollSettings.extra_withholding_per_paycheck || 0);

    let federalWithholding = 0;
    if (isBonus && event.bonus_method === 'supplemental_flat') {
      const supplementalRate = taxTables.federal_supplemental_withholding_rate ?? 0;
      federalWithholding = taxableWages * supplementalRate;
    } else {
      federalWithholding = calculateFederalWithholding({
        taxableWagesPerPaycheck: taxableWages,
        payPeriodsPerYear,
        filingStatus: payrollSettings.filing_status,
        standardDeduction,
        deductionsAnnual,
        otherIncomeAnnual,
        brackets: taxTables.federal_income_tax_brackets[payrollSettings.filing_status],
        dependentCredit: taxTables.dependent_credit.per_dependent_credit_amount,
        dependentsCount: payrollSettings.dependents_count,
        dependentCreditOverride: payrollSettings.dependent_credit_override,
        extraWithholdingPerPaycheck: extraWithholding,
      });
    }

    let ssWithholding = 0;
    let medicareWithholding = 0;
    let additionalMedicareWithholding = 0;
    if (payrollSettings.fica.include_fica) {
      const ssWageBase = payrollSettings.fica.ss_wage_base_override ?? taxTables.fica.ss_wage_base;
      const ssRemaining = Math.max(0, ssWageBase - ytdSsWages);
      const ssTaxable = Math.min(gross, ssRemaining);
      ssWithholding = ssTaxable * taxTables.fica.ss_rate;

      medicareWithholding = gross * taxTables.fica.medicare_rate;
      const threshold = payrollSettings.fica.additional_medicare_threshold_override
        ?? resolveAdditionalMedicareThreshold(taxTables.fica.additional_medicare_threshold, payrollSettings.filing_status);
      const medicareAboveThreshold = Math.max(0, ytdMedicareWages + gross - threshold)
        - Math.max(0, ytdMedicareWages - threshold);
      additionalMedicareWithholding = medicareAboveThreshold * taxTables.fica.additional_medicare_rate;
    }

    const ficaWithholding = ssWithholding + medicareWithholding + additionalMedicareWithholding;
    const flatStateRate = payrollSettings.state_withholding_flat_rate || 0;
    const fallbackStateResult = { withholding: taxableWages * (flatStateRate / 100) };
    const stateResult = stateWithholding
      ? stateWithholding({ gross, taxableWages, filingStatus: payrollSettings.filing_status, date: event.date })
      : fallbackStateResult;
    const postTaxDeductions = isBonus ? 0 : payrollSettings.benefits.post_tax_deductions_per_paycheck;
    const net = gross - k401Contribution - preTaxBenefits - federalWithholding - stateResult.withholding - ficaWithholding - postTaxDeductions;

    ytdGross += gross;
    ytdTaxable += taxableWages;
    ytd401k += k401Contribution;
    ytdSsWages += gross;
    ytdMedicareWages += gross;
    ytdFederal += federalWithholding;
    ytdFica += ficaWithholding;
    ytdNet += net;

    const result: PayrollPaycheckResult = {
      id: event.id,
      date: event.date,
      gross,
      k401_contribution: k401Contribution,
      pre_tax_benefits: preTaxBenefits,
      taxable_wages: taxableWages,
      federal_withholding: federalWithholding,
      state_withholding: stateResult.withholding,
      ss_withholding: ssWithholding,
      medicare_withholding: medicareWithholding,
      additional_medicare_withholding: additionalMedicareWithholding,
      fica_withholding: ficaWithholding,
      post_tax_deductions: postTaxDeductions,
      net,
      is_bonus: isBonus,
      bonus_method: event.bonus_method,
      description: event.description,
      ytd: {
        gross: ytdGross,
        taxable_wages: ytdTaxable,
        k401_contribution: ytd401k,
        ss_wages: ytdSsWages,
        medicare_wages: ytdMedicareWages,
        federal_withholding: ytdFederal,
        fica_withholding: ytdFica,
        net: ytdNet,
      }
    };

    if (event.date.startsWith(monthId)) {
      results.push(result);
    }
  });

  return { paychecks: results };
};
