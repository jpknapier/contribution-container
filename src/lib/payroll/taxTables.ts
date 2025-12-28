import { DB_NAME, DB_VERSION } from '../../../lib/storage';
import { FilingStatus, TaxTableSet, TaxBracket } from './types';

export const TAX_TABLE_SCHEMA_VERSION = 1;
const STORE_NAME = 'tax_tables';

const filingStatuses: FilingStatus[] = ['single', 'married_joint', 'head_of_household'];

const openDb = async (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(new Error('IndexedDB failed to open'));
    request.onsuccess = () => resolve(request.result);
  });
};

const getStore = async (mode: IDBTransactionMode): Promise<IDBObjectStore> => {
  const db = await openDb();
  const transaction = db.transaction(STORE_NAME, mode);
  return transaction.objectStore(STORE_NAME);
};

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const validateBrackets = (brackets: TaxBracket[], path: string, errors: string[]) => {
  if (!Array.isArray(brackets) || brackets.length === 0) {
    errors.push(`${path} must be a non-empty array.`);
    return;
  }
  brackets.forEach((bracket, index) => {
    if (!isNumber(bracket.lowerBound)) {
      errors.push(`${path}[${index}].lowerBound must be a number.`);
    }
    if (!(bracket.upperBound === null || isNumber(bracket.upperBound))) {
      errors.push(`${path}[${index}].upperBound must be a number or null.`);
    }
    if (!isNumber(bracket.rate)) {
      errors.push(`${path}[${index}].rate must be a number.`);
    }
  });
};

export const validateTaxTableSet = (value: unknown) => {
  const errors: string[] = [];
  const data = value as TaxTableSet;

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Tax table must be an object.'] };
  }
  if (!isNumber(data.tax_year)) {
    errors.push('tax_year must be a number.');
  }
  if (!isNumber(data.schema_version)) {
    errors.push('schema_version must be a number.');
  }
  if (data.updated_at !== undefined && !isNumber(data.updated_at)) {
    errors.push('updated_at must be a number when provided.');
  }
  filingStatuses.forEach(status => {
    const brackets = data.federal_income_tax_brackets?.[status];
    validateBrackets(brackets as TaxBracket[], `federal_income_tax_brackets.${status}`, errors);
  });
  filingStatuses.forEach(status => {
    const deduction = data.standard_deduction?.[status];
    if (!isNumber(deduction)) {
      errors.push(`standard_deduction.${status} must be a number.`);
    }
  });
  if (!isNumber(data.dependent_credit?.per_dependent_credit_amount)) {
    errors.push('dependent_credit.per_dependent_credit_amount must be a number.');
  }
  if (data.federal_supplemental_withholding_rate !== undefined && !isNumber(data.federal_supplemental_withholding_rate)) {
    errors.push('federal_supplemental_withholding_rate must be a number when provided.');
  }
  if (!isNumber(data.fica?.ss_rate)) {
    errors.push('fica.ss_rate must be a number.');
  }
  if (!isNumber(data.fica?.medicare_rate)) {
    errors.push('fica.medicare_rate must be a number.');
  }
  if (!isNumber(data.fica?.ss_wage_base)) {
    errors.push('fica.ss_wage_base must be a number.');
  }
  if (!isNumber(data.fica?.additional_medicare_rate)) {
    errors.push('fica.additional_medicare_rate must be a number.');
  }
  const threshold = data.fica?.additional_medicare_threshold;
  if (isNumber(threshold)) {
    // ok
  } else if (threshold && typeof threshold === 'object') {
    filingStatuses.forEach(status => {
      const valueForStatus = (threshold as Record<FilingStatus, number>)[status];
      if (!isNumber(valueForStatus)) {
        errors.push(`fica.additional_medicare_threshold.${status} must be a number.`);
      }
    });
  } else {
    errors.push('fica.additional_medicare_threshold must be a number or object by filing status.');
  }
  if (!isNumber(data.retirement?.k401_employee_max)) {
    errors.push('retirement.k401_employee_max must be a number.');
  }
  if (!isNumber(data.retirement?.k401_catch_up_max)) {
    errors.push('retirement.k401_catch_up_max must be a number.');
  }

  return { valid: errors.length === 0, errors };
};

const normalizeTaxTableSet = (table: TaxTableSet): TaxTableSet => {
  return {
    ...table,
    schema_version: table.schema_version ?? TAX_TABLE_SCHEMA_VERSION,
    updated_at: table.updated_at ?? Date.now(),
  };
};

export const saveTaxTableSet = async (table: TaxTableSet): Promise<void> => {
  const store = await getStore('readwrite');
  const normalized = normalizeTaxTableSet(table);
  return new Promise((resolve, reject) => {
    const request = store.put(normalized);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

export const getTaxTableSet = async (taxYear: number): Promise<TaxTableSet | null> => {
  const store = await getStore('readonly');
  return new Promise((resolve) => {
    const request = store.get(taxYear);
    request.onsuccess = () => resolve(request.result || null);
  });
};

export const listTaxTableYears = async (): Promise<number[]> => {
  const store = await getStore('readonly');
  return new Promise((resolve) => {
    const request = store.getAllKeys();
    request.onsuccess = () => resolve((request.result as number[]) || []);
  });
};

export const deleteTaxTableSet = async (taxYear: number): Promise<void> => {
  const store = await getStore('readwrite');
  return new Promise((resolve, reject) => {
    const request = store.delete(taxYear);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};
