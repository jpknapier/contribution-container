import { FilingStatus, TaxBracket } from '../types';

export const calculateAnnualTax = (taxableIncome: number, brackets: TaxBracket[]) => {
  if (taxableIncome <= 0) return 0;
  return brackets.reduce((sum, bracket) => {
    const upper = bracket.upperBound ?? Infinity;
    const taxableAtBracket = Math.max(0, Math.min(taxableIncome, upper) - bracket.lowerBound);
    if (taxableAtBracket <= 0) return sum;
    return sum + taxableAtBracket * bracket.rate;
  }, 0);
};

export const calculateFederalWithholding = ({
  taxableWagesPerPaycheck,
  payPeriodsPerYear,
  filingStatus,
  standardDeduction,
  deductionsAnnual,
  otherIncomeAnnual,
  brackets,
  dependentCredit,
  dependentsCount,
  dependentCreditOverride,
  extraWithholdingPerPaycheck,
}: {
  taxableWagesPerPaycheck: number;
  payPeriodsPerYear: number;
  filingStatus: FilingStatus;
  standardDeduction: number;
  deductionsAnnual: number;
  otherIncomeAnnual: number;
  brackets: TaxBracket[];
  dependentCredit: number;
  dependentsCount: number;
  dependentCreditOverride?: number;
  extraWithholdingPerPaycheck: number;
}) => {
  const annualizedWages = taxableWagesPerPaycheck * payPeriodsPerYear;
  const adjustedIncome = annualizedWages + otherIncomeAnnual;
  const totalDeductions = standardDeduction + deductionsAnnual;
  const taxableIncome = Math.max(0, adjustedIncome - totalDeductions);
  const annualTax = calculateAnnualTax(taxableIncome, brackets);
  const credit = dependentCreditOverride ?? (dependentsCount * dependentCredit);
  const annualAfterCredits = Math.max(0, annualTax - credit);
  const perPaycheck = annualAfterCredits / payPeriodsPerYear;
  return Math.max(0, perPaycheck + extraWithholdingPerPaycheck);
};
